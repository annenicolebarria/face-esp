import { useEffect, useMemo, useState } from 'react'
import Swal from 'sweetalert2'
import './App.css'

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'devices', label: 'Device Health' },
  { id: 'fan', label: 'Fan Control' },
  { id: 'users', label: 'User Management' },
  { id: 'cctv', label: 'CCTV Monitoring' },
  { id: 'logs', label: 'Attendance Logs' },
  { id: 'settings', label: 'Settings' },
  { id: 'reports', label: 'Reports' },
]

const SUPABASE_URL = 'https://ofvkhrqmswxzdikzsfsw.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_9MoVy3d-me0pPvY9T9FGUQ_cmCJVNwZ'
const ADMIN_LOGIN_PATH = '/admin-login.html'
const ACTIVE_SECTION_STORAGE_KEY = 'adminActiveSection'
const SENSOR_STALE_MS = 15000
const DEVICE_TEST_MIN_LOADING_MS = 2000
const FACE_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window === 'undefined'
    ? 'http://127.0.0.1:4000'
    : `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${window.location.hostname}:4000`)

async function rpcRequest(functionName, body = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
  })

  const responsePayload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(
      responsePayload?.message || responsePayload?.msg || responsePayload?.error_description || 'Request failed.'
    )
    error.status = response.status
    throw error
  }

  return responsePayload
}

function toUserRow(user) {
  const first = String(user.firstName || user.first_name || '').trim()
  const last = String(user.lastName || user.last_name || '').trim()
  return {
    id: user.id,
    name: `${first} ${last}`.trim(),
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    lastSeen: (user.updatedAt || user.updated_at) ? new Date(user.updatedAt || user.updated_at).toLocaleString() : 'N/A',
  }
}

function toLogRow(log) {
  return {
    id: log.id,
    time: (log.detectedAt || log.detected_at) ? new Date(log.detectedAt || log.detected_at).toLocaleString() : 'N/A',
    name: log.userNameSnapshot || log.user_name_snapshot || 'Unknown Face',
    event: log.event,
    camera: log.cameraId || log.camera_id || 'ESP32-CAM-01',
    confidence: Number.isFinite(Number(log.confidence)) ? `${Math.round(Number(log.confidence))}%` : 'N/A',
  }
}

function toCameraRow(camera) {
  return {
    id: camera.cameraId || camera.camera_id,
    area: camera.area || 'Connected camera',
    status: camera.status === 'online' ? 'online' : 'offline',
    lastMotion: (camera.lastDetectedAt || camera.last_detected_at)
      ? new Date(camera.lastDetectedAt || camera.last_detected_at).toLocaleString()
      : 'No detections yet',
    recognized: Number(camera.recognizedToday || camera.recognized_today || 0),
    unrecognized: Number(camera.unrecognizedToday || camera.unrecognized_today || 0),
  }
}

function toSensorSnapshot(sensor) {
  return {
    deviceKey: sensor?.deviceKey || sensor?.device_key || 'acebott-main-01',
    pirState: Boolean(sensor?.pirState ?? sensor?.pir_state),
    fanIsOn: Boolean(sensor?.fanIsOn ?? sensor?.fan_is_on),
    temperatureC:
      sensor?.temperatureC === null || sensor?.temperatureC === undefined
        ? null
        : Number(sensor.temperatureC ?? sensor.temperature_c),
    humidity:
      sensor?.humidity === null || sensor?.humidity === undefined ? null : Number(sensor.humidity),
    createdAt: sensor?.createdAt || sensor?.created_at || null,
    fanUpdatedAt: sensor?.fanUpdatedAt || sensor?.fan_updated_at || null,
    fanUpdatedBy: sensor?.fanUpdatedBy || sensor?.fan_updated_by || 'system',
  }
}

function deriveSensorHealth(sensorSnapshot, now = Date.now()) {
  const snapshotTime = sensorSnapshot.createdAt ? new Date(sensorSnapshot.createdAt).getTime() : null
  const fanUpdateTime = sensorSnapshot.fanUpdatedAt ? new Date(sensorSnapshot.fanUpdatedAt).getTime() : null
  const hasRecentHeartbeat = Number.isFinite(snapshotTime) && now - snapshotTime <= SENSOR_STALE_MS
  const hasDhtReading =
    Number.isFinite(sensorSnapshot.temperatureC) || Number.isFinite(sensorSnapshot.humidity)
  const fanFresh = Number.isFinite(fanUpdateTime) && now - fanUpdateTime <= SENSOR_STALE_MS

  return {
    heartbeatLabel: snapshotTime ? new Date(snapshotTime).toLocaleString() : 'No heartbeat yet',
    dht: {
      label: hasRecentHeartbeat && hasDhtReading ? 'alive' : 'stale',
      detail:
        hasRecentHeartbeat && hasDhtReading
          ? `${sensorSnapshot.temperatureC?.toFixed?.(1) ?? '--'} C | ${sensorSnapshot.humidity?.toFixed?.(1) ?? '--'} %`
          : 'No recent DHT reading',
      online: hasRecentHeartbeat && hasDhtReading,
    },
    pir: {
      label: hasRecentHeartbeat ? (sensorSnapshot.pirState ? 'motion' : 'idle') : 'stale',
      detail: hasRecentHeartbeat ? 'Recent PIR heartbeat received' : 'No recent PIR heartbeat',
      online: hasRecentHeartbeat,
    },
    fan: {
      label: fanFresh || hasRecentHeartbeat ? (sensorSnapshot.fanIsOn ? 'on' : 'off') : 'stale',
      detail:
        fanFresh || hasRecentHeartbeat
          ? `Last update by ${sensorSnapshot.fanUpdatedBy || 'system'}`
          : 'No recent fan sync',
      online: fanFresh || hasRecentHeartbeat,
    },
  }
}

function deriveCameraHealth(cameras) {
  const primaryCamera = cameras[0] || null
  if (!primaryCamera) {
    return {
      label: 'stale',
      detail: 'No camera heartbeat yet',
      online: false,
      cameraId: 'ESP32-CAM-01',
    }
  }

  return {
    label: primaryCamera.status === 'online' ? 'online' : 'offline',
    detail: primaryCamera.lastMotion || 'No detections yet',
    online: primaryCamera.status === 'online',
    cameraId: primaryCamera.id || 'ESP32-CAM-01',
  }
}

function deriveDeviceTestResult(sensorHealth, cameraHealth) {
  const checks = [
    cameraHealth.online,
    sensorHealth.dht.online,
    sensorHealth.pir.online,
    sensorHealth.fan.online,
  ]
  const passing = checks.filter(Boolean).length

  if (passing === checks.length) {
    return {
      status: 'stable',
      badgeClass: 'online',
      message: 'All connected devices responded normally.',
    }
  }

  if (passing === 0) {
    return {
      status: 'offline',
      badgeClass: 'offline',
      message: 'No device heartbeat detected during the test.',
    }
  }

  return {
    status: 'warning',
    badgeClass: 'status-pending',
    message: 'Some devices responded, but one or more still need attention.',
  }
}

function SectionIcon({ id }) {
  if (id === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />
      </svg>
    )
  }

  if (id === 'users') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM5 20a7 7 0 0 1 14 0z" />
      </svg>
    )
  }

  if (id === 'devices') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 4h10v5H7zM9 9v3m6-3v3M6 14h12v6H6zM10 17h4" />
      </svg>
    )
  }

  if (id === 'fan') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12m-1.8 0a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0" />
        <path d="M12 4c2.7 0 4 1.8 4 3.3 0 2-1.7 3.1-4 4.7" />
        <path d="M20 12c0 2.7-1.8 4-3.3 4-2 0-3.1-1.7-4.7-4" />
        <path d="M12 20c-2.7 0-4-1.8-4-3.3 0-2 1.7-3.1 4-4.7" />
        <path d="M4 12c0-2.7 1.8-4 3.3-4 2 0 3.1 1.7 4.7 4" />
      </svg>
    )
  }

  if (id === 'cctv') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9.5l13-5 2.5 5.8L5.6 15zM10 13l1.2 3h5.1l-1.2-3M17 17h2.8" />
      </svg>
    )
  }

  if (id === 'logs') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4" />
      </svg>
    )
  }

  if (id === 'settings') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10.5 3h3l.6 2.1c.6.2 1.1.5 1.6.9l2-.8 1.5 2.6-1.5 1.5c.1.3.1.8.1 1.1s0 .8-.1 1.1l1.5 1.5-1.5 2.6-2-.8c-.5.4-1 .7-1.6.9L13.5 21h-3l-.6-2.1c-.6-.2-1.1-.5-1.6-.9l-2 .8-1.5-2.6 1.5-1.5a7 7 0 0 1 0-2.2L4.8 11l1.5-2.6 2 .8c.5-.4 1-.7 1.6-.9zM12 9.1a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 18h16M7 14V8m5 6V5m5 9v-3" />
    </svg>
  )
}

function App() {
  const [activeSection, setActiveSection] = useState(() => {
    const saved = sessionStorage.getItem(ACTIVE_SECTION_STORAGE_KEY)
    return SECTIONS.some((section) => section.id === saved) ? saved : 'dashboard'
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEnrollmentModalOpen, setIsEnrollmentModalOpen] = useState(false)
  const [searchUser, setSearchUser] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [logFilter, setLogFilter] = useState('recognized')

  const [newUser, setNewUser] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [showCreateConfirmPassword, setShowCreateConfirmPassword] = useState(false)
  const [accountFeedback, setAccountFeedback] = useState({ type: '', message: '' })
  const [selectedEnrollmentUser, setSelectedEnrollmentUser] = useState(null)
  const [enrollmentFiles, setEnrollmentFiles] = useState([])
  const [enrollmentFeedback, setEnrollmentFeedback] = useState({ type: '', message: '' })
  const [isEnrollmentSubmitting, setIsEnrollmentSubmitting] = useState(false)
  const [enrollmentLoadingMessage, setEnrollmentLoadingMessage] = useState(
    'Uploading face images and reloading recognition dataset...'
  )
  const [lastSync, setLastSync] = useState('')
  const [adminAccount, setAdminAccount] = useState(() => {
    return { username: sessionStorage.getItem('adminUsername') || 'admin' }
  })
  const [settingsForm, setSettingsForm] = useState({
    currentPassword: '',
    newUsername: '',
    newPassword: '',
    confirmNewPassword: '',
  })
  const [settingsFeedback, setSettingsFeedback] = useState({ type: '', message: '' })

  const [users, setUsers] = useState([])
  const [logs, setLogs] = useState([])
  const [attendanceLogs, setAttendanceLogs] = useState([])
  const [cameras, setCameras] = useState([])
  const [sensorSnapshot, setSensorSnapshot] = useState(() =>
    toSensorSnapshot({})
  )
  const [isDeviceTestRunning, setIsDeviceTestRunning] = useState(false)
  const [isFanSubmitting, setIsFanSubmitting] = useState(false)
  const [fanControlFeedback, setFanControlFeedback] = useState({ type: '', message: '' })
  const [deviceTestState, setDeviceTestState] = useState({
    status: 'idle',
    badgeClass: 'offline',
    message: 'Run a device test to verify camera, DHT, PIR, and fan health.',
  })

  useEffect(() => {
    const adminAuth = sessionStorage.getItem('adminAuth')
    const adminToken = sessionStorage.getItem('adminToken')
    const adminUsername = sessionStorage.getItem('adminUsername')

    if (adminAuth !== 'true' || !adminToken) {
      window.location.href = ADMIN_LOGIN_PATH
      return
    }

    if (adminUsername) {
      setAdminAccount({ username: adminUsername })
    }

    let isDisposed = false

    const clearAdminSession = () => {
      sessionStorage.removeItem('adminAuth')
      sessionStorage.removeItem('adminToken')
      sessionStorage.removeItem('adminUsername')
      sessionStorage.removeItem(ACTIVE_SECTION_STORAGE_KEY)
      window.location.href = ADMIN_LOGIN_PATH
    }

    const loadAdminData = async () => {
      const requests = await Promise.allSettled([
        rpcRequest('admin_get_users', { session_token: adminToken }),
        rpcRequest('admin_get_logs', { session_token: adminToken, logs_limit: 100 }),
        rpcRequest('admin_get_attendance_logs', { session_token: adminToken, logs_limit: 100 }),
        rpcRequest('admin_get_cameras_summary', { session_token: adminToken }),
        rpcRequest('admin_get_sensor_snapshot', { session_token: adminToken }),
      ])

      if (isDisposed) {
        return
      }

      const [usersResult, logsResult, attendanceLogsResult, camerasResult, sensorResult] = requests
      const failedResult = requests.find(
        (result) => result.status === 'rejected'
      )

      if (failedResult?.reason) {
        const error = failedResult.reason
        if (error.status === 401 || error.status === 403 || /session/i.test(error.message)) {
          clearAdminSession()
          return
        }
      }

      if (usersResult.status === 'fulfilled') {
        setUsers(usersResult.value.map(toUserRow))
      }

      if (logsResult.status === 'fulfilled') {
        setLogs(logsResult.value.map(toLogRow))
      }

      if (attendanceLogsResult.status === 'fulfilled') {
        setAttendanceLogs(attendanceLogsResult.value.map(toLogRow))
      }

      if (camerasResult.status === 'fulfilled') {
        setCameras(camerasResult.value.map(toCameraRow))
      }

      if (sensorResult.status === 'fulfilled') {
        setSensorSnapshot(toSensorSnapshot(sensorResult.value))
      }

      setLastSync(new Date().toLocaleString())
    }

    void loadAdminData()

    const intervalId = window.setInterval(() => {
      if (document.hidden) {
        return
      }
      void loadAdminData()
    }, 5000)

    return () => {
      isDisposed = true
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, activeSection)
  }, [activeSection])

  const stats = useMemo(() => {
    const activeUsers = users.filter((user) => user.status === 'active').length
    const adminUsers = users.filter((user) => user.role === 'admin').length
    const onlineCams = cameras.filter((camera) => camera.status === 'online').length
    const unknownDetections = logs.filter((log) => log.event === 'unrecognized').length

    return {
      totalUsers: users.length,
      activeUsers,
      adminUsers,
      onlineCams,
      totalCams: cameras.length,
      unknownDetections,
    }
  }, [users, logs, cameras])

  const legacySensorHealth = useMemo(() => {
    const snapshotTime = sensorSnapshot.createdAt ? new Date(sensorSnapshot.createdAt).getTime() : null
    const fanUpdateTime = sensorSnapshot.fanUpdatedAt ? new Date(sensorSnapshot.fanUpdatedAt).getTime() : null
    const now = Date.now()
    const hasRecentHeartbeat = Number.isFinite(snapshotTime) && now - snapshotTime <= SENSOR_STALE_MS
    const hasDhtReading =
      Number.isFinite(sensorSnapshot.temperatureC) || Number.isFinite(sensorSnapshot.humidity)
    const fanFresh = Number.isFinite(fanUpdateTime) && now - fanUpdateTime <= SENSOR_STALE_MS

    return {
      heartbeatLabel: snapshotTime ? new Date(snapshotTime).toLocaleString() : 'No heartbeat yet',
      dht: {
        label: hasRecentHeartbeat && hasDhtReading ? 'alive' : 'stale',
        detail:
          hasRecentHeartbeat && hasDhtReading
            ? `${sensorSnapshot.temperatureC?.toFixed?.(1) ?? '--'} °C • ${sensorSnapshot.humidity?.toFixed?.(1) ?? '--'} %`
            : 'No recent DHT reading',
        online: hasRecentHeartbeat && hasDhtReading,
      },
      pir: {
        label: hasRecentHeartbeat ? (sensorSnapshot.pirState ? 'motion' : 'idle') : 'stale',
        detail: hasRecentHeartbeat ? 'Recent PIR heartbeat received' : 'No recent PIR heartbeat',
        online: hasRecentHeartbeat,
      },
      fan: {
        label: fanFresh || hasRecentHeartbeat ? (sensorSnapshot.fanIsOn ? 'on' : 'off') : 'stale',
        detail:
          fanFresh || hasRecentHeartbeat
            ? `Last update by ${sensorSnapshot.fanUpdatedBy || 'system'}`
            : 'No recent fan sync',
        online: fanFresh || hasRecentHeartbeat,
      },
    }
  }, [sensorSnapshot])

  const legacyCameraHealth = useMemo(() => {
    const primaryCamera = cameras[0] || null
    if (!primaryCamera) {
      return {
        label: 'stale',
        detail: 'No camera heartbeat yet',
        online: false,
        cameraId: 'ESP32-CAM-01',
      }
    }

    return {
      label: primaryCamera.status === 'online' ? 'online' : 'offline',
      detail: primaryCamera.lastMotion || 'No detections yet',
      online: primaryCamera.status === 'online',
      cameraId: primaryCamera.id || 'ESP32-CAM-01',
    }
  }, [cameras])

  const sensorHealth = useMemo(() => deriveSensorHealth(sensorSnapshot), [sensorSnapshot])

  const cameraHealth = useMemo(() => deriveCameraHealth(cameras), [cameras])

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        user.name.toLowerCase().includes(searchUser.toLowerCase()) ||
        user.email.toLowerCase().includes(searchUser.toLowerCase())

      const matchesRole = roleFilter === 'all' ? true : user.role === roleFilter
      const matchesStatus = statusFilter === 'all' ? true : user.status === statusFilter

      return matchesSearch && matchesRole && matchesStatus
    })
  }, [users, searchUser, roleFilter, statusFilter])

  const filteredLogs = useMemo(() => {
    if (logFilter === 'recognized') {
      return attendanceLogs
    }
    return attendanceLogs.filter((log) => log.event === logFilter)
  }, [attendanceLogs, logFilter])

  const reportCounts = useMemo(() => {
    const totals = {
      entry: 0,
      exit: 0,
      unrecognized: 0,
    }
    logs.forEach((log) => {
      totals[log.event] += 1
    })
    return totals
  }, [logs])

  const runDeviceTest = async () => {
    const adminToken = sessionStorage.getItem('adminToken')
    if (!adminToken || isDeviceTestRunning) {
      return
    }

    const startedAt = Date.now()
    const waitForMinimumLoading = async () => {
      const remaining = DEVICE_TEST_MIN_LOADING_MS - (Date.now() - startedAt)
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining))
      }
    }

    setIsDeviceTestRunning(true)
    setDeviceTestState({
      status: 'loading',
      badgeClass: 'status-pending',
      message: 'Testing connected devices. Checking latest heartbeats now...',
    })

    try {
      const [cameraResult, sensorResult] = await Promise.all([
        rpcRequest('admin_get_cameras_summary', { session_token: adminToken }),
        rpcRequest('admin_get_sensor_snapshot', { session_token: adminToken }),
      ])
      await waitForMinimumLoading()

      const nextCameras = cameraResult.map(toCameraRow)
      const nextSensorSnapshot = toSensorSnapshot(sensorResult)
      const nextTestState = deriveDeviceTestResult(
        deriveSensorHealth(nextSensorSnapshot),
        deriveCameraHealth(nextCameras)
      )

      setCameras(nextCameras)
      setSensorSnapshot(nextSensorSnapshot)
      setLastSync(new Date().toLocaleString())
      setDeviceTestState(nextTestState)
    } catch (error) {
      await waitForMinimumLoading()
      setDeviceTestState({
        status: 'offline',
        badgeClass: 'offline',
        message: error.message || 'Device test failed. Please try again.',
      })
    } finally {
      setIsDeviceTestRunning(false)
    }
  }

  const applyFanState = (fanState) => {
    setSensorSnapshot((current) => ({
      ...current,
      fanIsOn: Boolean(fanState?.isOn),
      fanUpdatedAt: fanState?.updatedAt || new Date().toISOString(),
      fanUpdatedBy: fanState?.updatedBy || current.fanUpdatedBy || 'system',
    }))
    setLastSync(new Date().toLocaleString())
  }

  const handleFanControl = async (nextIsOn) => {
    const adminToken = sessionStorage.getItem('adminToken')
    if (!adminToken || isFanSubmitting) {
      return
    }

    setIsFanSubmitting(true)
    setFanControlFeedback({ type: '', message: '' })

    try {
      const payload = await rpcRequest('admin_set_fan_state', {
        session_token: adminToken,
        next_is_on: nextIsOn,
      })

      applyFanState(payload)
      setFanControlFeedback({
        type: 'success',
        message: `Fan command sent. Relay is now ${payload.isOn ? 'ON' : 'OFF'}.`,
      })
    } catch (error) {
      setFanControlFeedback({
        type: 'error',
        message: error.message || 'Failed to update fan state.',
      })
    } finally {
      setIsFanSubmitting(false)
    }
  }

  const openEnrollmentModal = (user) => {
    setSelectedEnrollmentUser(user)
    setEnrollmentFiles([])
    setEnrollmentFeedback({ type: '', message: '' })
    setIsEnrollmentModalOpen(true)
  }

  const closeEnrollmentModal = (force = false) => {
    if (isEnrollmentSubmitting && !force) {
      return
    }
    setIsEnrollmentModalOpen(false)
    setSelectedEnrollmentUser(null)
    setEnrollmentFiles([])
    setEnrollmentFeedback({ type: '', message: '' })
  }

  const handleEnrollmentFileChange = (event) => {
    const nextFiles = Array.from(event.target.files || [])
    setEnrollmentFiles(nextFiles)
    setEnrollmentFeedback({ type: '', message: '' })
  }

  const handleFaceEnrollmentSubmit = async (event) => {
    event.preventDefault()

    const adminToken = sessionStorage.getItem('adminToken')
    if (!adminToken || !selectedEnrollmentUser) {
      return
    }

    if (enrollmentFiles.length < 1 || enrollmentFiles.length > 10) {
      setEnrollmentFeedback({
        type: 'error',
        message: 'Select 1 to 10 clear face images before uploading.',
      })
      return
    }

    const formData = new FormData()
    formData.append('userId', String(selectedEnrollmentUser.id))
    enrollmentFiles.forEach((file) => {
      formData.append('images', file)
    })

    setIsEnrollmentSubmitting(true)
    setEnrollmentLoadingMessage('Uploading face images to cloud storage and reloading recognition dataset...')
    setEnrollmentFeedback({
      type: '',
      message: 'Uploading face images to cloud storage and reloading recognition dataset...',
    })

    try {
      const response = await fetch(`${FACE_API_BASE_URL}/api/admin/face-enrollment`, {
        method: 'POST',
        headers: {
          'x-admin-session': adminToken,
        },
        body: formData,
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload?.message || 'Failed to upload face enrollment images.')
      }

      const reloadMessage = payload?.reload?.queued
        ? payload?.reload?.warning || 'Images uploaded. Recognition dataset is reloading in the background.'
        : payload?.reload?.ok
          ? 'Recognition dataset reloaded successfully.'
          : payload?.reload?.error || 'Images uploaded, but recognition reload still needs attention.'

      setEnrollmentFeedback({
        type: 'success',
        message: `${payload.imagesSaved} images added to ${payload.folderName}. Total images: ${payload.totalImages}. ${reloadMessage}`,
      })

      await Swal.fire({
        icon: payload?.reload?.ok ? 'success' : 'warning',
        title: payload?.reload?.queued
          ? 'Images saved and reload queued'
          : payload?.reload?.ok
            ? 'Face enrollment saved'
            : 'Images saved with warning',
        text: `${payload.imagesSaved} images added for ${selectedEnrollmentUser.name}. Total dataset images: ${payload.totalImages}.`,
        confirmButtonColor: '#169c64',
      })

      closeEnrollmentModal(true)
    } catch (error) {
      setEnrollmentFeedback({
        type: 'error',
        message: error.message || 'Failed to upload face images.',
      })
    } finally {
      setIsEnrollmentSubmitting(false)
    }
  }

  const updateUserRole = async (id, role) => {
    if (role !== 'admin' && role !== 'user') return
    const adminToken = sessionStorage.getItem('adminToken')
    if (!adminToken) return

    try {
      const updated = await rpcRequest('admin_update_user', {
        session_token: adminToken,
        target_user_id: id,
        next_role: role,
      })
      setUsers((current) =>
        current.map((user) => (user.id === id ? { ...user, role: updated.role } : user))
      )
    } catch (error) {
      void Swal.fire({
        icon: 'error',
        title: 'Failed to update role',
        text: error.message,
        confirmButtonColor: '#169c64',
      })
    }
  }

  const toggleUserStatus = async (id) => {
    const target = users.find((user) => user.id === id)
    if (!target) return

    const adminToken = sessionStorage.getItem('adminToken')
    if (!adminToken) return

    const nextStatus =
      target.status === 'active'
        ? 'inactive'
        : 'active'
    const actionLabel =
      target.status === 'pending'
        ? 'Approve'
        : nextStatus === 'active'
          ? 'Activate'
          : 'Deactivate'
    const result = await Swal.fire({
      icon: 'question',
      title:
        target.status === 'pending'
          ? 'Approve account?'
          : nextStatus === 'active'
            ? 'Activate account?'
            : 'Deactivate account?',
      text: `${target.name} will be marked as ${nextStatus}.`,
      showCancelButton: true,
      confirmButtonText: actionLabel,
      cancelButtonText: 'Cancel',
      confirmButtonColor: nextStatus === 'active' ? '#169c64' : '#d08a1e',
      cancelButtonColor: '#9aa9a1',
    })

    if (!result.isConfirmed) {
      return
    }

    try {
      const updated = await rpcRequest('admin_update_user', {
        session_token: adminToken,
        target_user_id: id,
        next_status: nextStatus,
      })
      setUsers((current) =>
        current.map((user) => (user.id === id ? { ...user, status: updated.status } : user))
      )
      await Swal.fire({
        icon: 'success',
        title:
          target.status === 'pending'
            ? 'Account approved'
            : nextStatus === 'active'
              ? 'Account activated'
              : 'Account deactivated',
        text: `${target.name} is now ${updated.status}.`,
        confirmButtonColor: '#169c64',
      })
    } catch (error) {
      void Swal.fire({
        icon: 'error',
        title: 'Failed to update status',
        text: error.message,
        confirmButtonColor: '#169c64',
      })
    }
  }

  const deleteUser = async (id) => {
    const target = users.find((user) => user.id === id)
    if (!target) return

    const result = await Swal.fire({
      icon: 'warning',
      title: 'Delete account?',
      text: `${target.name} will be removed permanently.`,
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#d5544f',
      cancelButtonColor: '#9aa9a1',
    })

    if (!result.isConfirmed) {
      return
    }

    const adminToken = sessionStorage.getItem('adminToken')
    if (!adminToken) return

    try {
      const response = await fetch(`${FACE_API_BASE_URL}/api/admin/delete-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-session': adminToken,
        },
        body: JSON.stringify({
          userId: id,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload?.message || 'Failed to delete account.')
      }

      setUsers((current) => current.filter((user) => user.id !== id))
      await Swal.fire({
        icon: 'success',
        title: 'Account deleted',
        text: `${target.name} was removed successfully.${payload.deletedFolders?.length ? ' Face dataset cleaned too.' : ''}`,
        confirmButtonColor: '#169c64',
      })
    } catch (error) {
      void Swal.fire({
        icon: 'error',
        title: 'Failed to delete account',
        text: error.message,
        confirmButtonColor: '#169c64',
      })
    }
  }

  const handleNewUser = async (event) => {
    event.preventDefault()
    const firstName = newUser.firstName.trim()
    const lastName = newUser.lastName.trim()
    const username = newUser.username.trim()
    const email = newUser.email.trim()
    const password = newUser.password.trim()
    const confirmPassword = newUser.confirmPassword.trim()

    if (!firstName || !lastName || !username || !email || !password || !confirmPassword) {
      setAccountFeedback({ type: 'error', message: 'Please complete all fields.' })
      return
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setAccountFeedback({ type: 'error', message: 'Please enter a valid email address.' })
      return
    }

    if (password.length < 6) {
      setAccountFeedback({ type: 'error', message: 'Password must be at least 6 characters.' })
      return
    }

    if (password !== confirmPassword) {
      setAccountFeedback({ type: 'error', message: 'Password and confirm password do not match.' })
      return
    }

    const adminToken = sessionStorage.getItem('adminToken')
    if (!adminToken) {
      setAccountFeedback({
        type: 'error',
        message: 'Session expired. Please login again so account can be saved to database.',
      })
      return
    }

    const fullName = `${firstName} ${lastName}`

    try {
      const createdUser = await rpcRequest('admin_create_user', {
        session_token: adminToken,
        input_first_name: firstName,
        input_last_name: lastName,
        input_username: username,
        input_email: email,
        input_role: 'user',
        input_status: 'active',
        input_password: password,
      })

      setUsers((current) => [
        {
          id: createdUser.id,
          name: `${createdUser.firstName} ${createdUser.lastName}`,
          username: createdUser.username,
          email: createdUser.email,
          role: createdUser.role,
          status: createdUser.status,
          lastSeen: 'Just created',
        },
        ...current,
      ])
      setNewUser({
        firstName: '',
        lastName: '',
        username: '',
        email: '',
        password: '',
        confirmPassword: '',
      })
      setShowCreatePassword(false)
      setShowCreateConfirmPassword(false)
      setAccountFeedback({ type: '', message: '' })
      setIsCreateModalOpen(false)
      await Swal.fire({
        icon: 'success',
        title: 'Account Created',
        text: `${fullName} can now log in to the mobile app.`,
        confirmButtonColor: '#169c64',
      })
    } catch (error) {
      setAccountFeedback({
        type: 'error',
        message: error.message || 'Failed to create account.',
      })
    }
  }

  const exportCsv = (filename, rows) => {
    const csvContent = rows
      .map((row) =>
        row
          .map((value) =>
            `"${String(value)
              .replace(/"/g, '""')
              .replace(/\n/g, ' ')}` + '"'
          )
          .join(',')
      )
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  const exportUsers = () => {
    const rows = [
      ['Name', 'Email', 'Role', 'Status', 'Last Seen'],
      ...users.map((user) => [user.name, user.email, user.role, user.status, user.lastSeen]),
    ]
    exportCsv('admin-users-report.csv', rows)
  }

  const exportLogs = () => {
    const rows = [
      ['Time', 'Name', 'Event', 'Camera', 'Confidence'],
      ...logs.map((log) => [log.time, log.name, log.event, log.camera, log.confidence]),
    ]
    exportCsv('attendance-logs-report.csv', rows)
  }

  const handleLogout = async () => {
    const adminToken = sessionStorage.getItem('adminToken')
    if (adminToken) {
      try {
        await rpcRequest('admin_logout', { session_token: adminToken })
      } catch {}
    }
    await Swal.fire({
      icon: 'success',
      title: 'Logged Out',
      text: 'You have been logged out successfully.',
      timer: 1400,
      showConfirmButton: false,
      timerProgressBar: true,
    })
    sessionStorage.removeItem('adminAuth')
    sessionStorage.removeItem('adminToken')
    sessionStorage.removeItem('adminUsername')
    sessionStorage.removeItem(ACTIVE_SECTION_STORAGE_KEY)
    window.location.href = '/admin-login.html'
  }

  const handleSaveSettings = async (event) => {
    event.preventDefault()
    const currentPassword = settingsForm.currentPassword.trim()
    const newUsername = settingsForm.newUsername.trim()
    const newPassword = settingsForm.newPassword.trim()
    const confirmNewPassword = settingsForm.confirmNewPassword.trim()

    if (!currentPassword) {
      setSettingsFeedback({ type: 'error', message: 'Enter current password to save changes.' })
      return
    }

    const adminToken = sessionStorage.getItem('adminToken')
    if (!adminToken) {
      setSettingsFeedback({ type: 'error', message: 'Session expired. Please login again.' })
      return
    }

    if (!newUsername && !newPassword && !confirmNewPassword) {
      setSettingsFeedback({ type: 'error', message: 'Enter a new username or password to update.' })
      return
    }

    if ((newPassword || confirmNewPassword) && newPassword.length < 6) {
      setSettingsFeedback({ type: 'error', message: 'New password must be at least 6 characters.' })
      return
    }

    if (newPassword !== confirmNewPassword) {
      setSettingsFeedback({ type: 'error', message: 'New password and confirm password do not match.' })
      return
    }

    try {
      const response = await rpcRequest('admin_update_credentials', {
        session_token: adminToken,
        current_password: currentPassword,
        new_username: newUsername,
        new_password: newPassword,
      })

      setAdminAccount({ username: response.admin.username })
      sessionStorage.setItem('adminUsername', response.admin.username)
      setSettingsForm({
        currentPassword: '',
        newUsername: '',
        newPassword: '',
        confirmNewPassword: '',
      })
      setSettingsFeedback({ type: '', message: '' })
      await Swal.fire({
        icon: 'success',
        title: 'Settings Updated',
        text: 'Admin credentials updated successfully.',
        confirmButtonColor: '#169c64',
      })
    } catch (error) {
      setSettingsFeedback({
        type: 'error',
        message: error.message || 'Failed to update settings.',
      })
    }
  }

  return (
    <div className={sidebarCollapsed ? 'admin-app sidebar-collapsed' : 'admin-app'}>
      <aside className="sidebar">
        <div className="brand">
          <p className="brand-kicker">PTC Smart Faculty Office</p>
          <h1>Admin Console</h1>
          <div className="brand-mini" aria-hidden="true">
            <img src="/assets/img/logo.png" alt="" />
          </div>
          <p className="brand-note">
            Roles are limited to <strong>admin</strong> and <strong>user</strong>.
          </p>
        </div>
        <nav className="menu">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={section.id === activeSection ? 'menu-item active' : 'menu-item'}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="menu-icon" aria-hidden="true">
                <SectionIcon id={section.id} />
              </span>
              <span className="menu-label">{section.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className="logout-icon-btn"
            onClick={handleLogout}
            aria-label="Log out"
            title="Log out"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 16l4-4-4-4" />
              <path d="M9 12h10" />
              <path d="M13 5V4H5v16h8v-1" />
            </svg>
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="header fade-in">
          <div className="header-left">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
            >
              <span />
              <span />
              <span />
            </button>
            <div>
              <p className="kicker">Admin Side</p>
              <h2>{SECTIONS.find((section) => section.id === activeSection)?.label}</h2>
            </div>
          </div>
          <div className="header-meta">
            <span>Last sync: {lastSync || 'Syncing...'}</span>
          </div>
        </header>

        {activeSection === 'dashboard' && (
          <section className="page-grid">
            <div className="cards">
              <article className="metric-card fade-in">
                <p>Total Users</p>
                <h3>{stats.totalUsers}</h3>
                <span>{stats.adminUsers} admin accounts</span>
              </article>
              <article className="metric-card fade-in">
                <p>Active Users</p>
                <h3>{stats.activeUsers}</h3>
                <span>with access today</span>
              </article>
              <article className="metric-card fade-in">
                <p>Online Cameras</p>
                <h3>
                  {stats.onlineCams}/{stats.totalCams}
                </h3>
                <span>live camera streams</span>
              </article>
              <article className="metric-card fade-in danger">
                <p>Unrecognized Faces</p>
                <h3>{stats.unknownDetections}</h3>
                <span>flagged today</span>
              </article>
            </div>

            <div className="panels">

              <article className="panel fade-in">
                <h3>Sensor Snapshot</h3>
                <ul className="camera-list">
                  <li>
                    <div>
                      <strong>DHT Sensor</strong>
                      <p>{sensorHealth.dht.detail}</p>
                    </div>
                    <span className={sensorHealth.dht.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.dht.label}
                    </span>
                  </li>
                  <li>
                    <div>
                      <strong>PIR Motion</strong>
                      <p>{sensorHealth.pir.detail}</p>
                    </div>
                    <span className={sensorHealth.pir.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.pir.label}
                    </span>
                  </li>
                  <li>
                    <div>
                      <strong>Fan Relay</strong>
                      <p>{sensorHealth.fan.detail}</p>
                    </div>
                    <span className={sensorHealth.fan.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.fan.label}
                    </span>
                  </li>
                </ul>
              </article>

              <article className="panel fade-in">
                <h3>Latest Activity</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Name</th>
                        <th>Event</th>
                        <th>Camera</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.slice(0, 5).map((log) => (
                        <tr key={log.id}>
                          <td>{log.time}</td>
                          <td>{log.name}</td>
                          <td>
                            <span className={`chip ${log.event}`}>{log.event}</span>
                          </td>
                          <td>{log.camera}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>

          </section>
        )}

        {activeSection === 'devices' && (
          <section className="page-grid devices-page">
            <div className="panels devices-panels">
              <article className="panel fade-in">
                <div className="panel-head">
                  <h3>Live Device Status</h3>
                  <div className="panel-actions">
                    {deviceTestState.status !== 'idle' && (
                      <span className={`badge ${deviceTestState.badgeClass}`}>
                        {isDeviceTestRunning ? 'testing' : deviceTestState.status}
                      </span>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={runDeviceTest}
                      disabled={isDeviceTestRunning}
                    >
                      {isDeviceTestRunning ? 'Testing...' : 'Run Test'}
                    </button>
                  </div>
                </div>
                <p className="panel-note">
                  {isDeviceTestRunning
                    ? 'Testing connected devices. Please wait a moment...'
                    : deviceTestState.message}
                </p>
                <p className="panel-note">Latest Acebott heartbeat: {sensorHealth.heartbeatLabel}</p>
                <ul className="camera-list">
                  <li>
                    <div>
                      <strong>ESP32-CAM</strong>
                      <p>{cameraHealth.cameraId} | {cameraHealth.detail}</p>
                    </div>
                    <span className={cameraHealth.online ? 'badge online' : 'badge offline'}>
                      {cameraHealth.label}
                    </span>
                  </li>
                  <li>
                    <div>
                      <strong>DHT Sensor</strong>
                      <p>{sensorHealth.dht.detail}</p>
                    </div>
                    <span className={sensorHealth.dht.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.dht.label}
                    </span>
                  </li>
                  <li>
                    <div>
                      <strong>PIR Motion</strong>
                      <p>{sensorHealth.pir.detail}</p>
                    </div>
                    <span className={sensorHealth.pir.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.pir.label}
                    </span>
                  </li>
                  <li>
                    <div>
                      <strong>Fan Relay</strong>
                      <p>{sensorHealth.fan.detail}</p>
                    </div>
                    <span className={sensorHealth.fan.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.fan.label}
                    </span>
                  </li>
                </ul>
              </article>
            </div>
          </section>
        )}

        {activeSection === 'fan' && (
          <section className="page-grid">
            <div className="fan-control-grid">
              <article className="panel fade-in">
                <div className="panel-head">
                  <h3>Fan Control</h3>
                  <span className={sensorHealth.fan.online ? 'badge online' : 'badge offline'}>
                    {sensorHealth.fan.label}
                  </span>
                </div>
                <p className="panel-note">
                  Send an ON or OFF command to the Acebott relay. The board applies the latest command on its next sync.
                </p>

                <div className="fan-status-card">
                  <p>Current relay state</p>
                  <strong>{sensorSnapshot.fanIsOn ? 'Fan ON' : 'Fan OFF'}</strong>
                  <span>
                    Last update by {sensorSnapshot.fanUpdatedBy || 'system'}
                    {sensorSnapshot.fanUpdatedAt ? ` on ${new Date(sensorSnapshot.fanUpdatedAt).toLocaleString()}` : ''}
                  </span>
                </div>

                <div className="fan-control-actions">
                  <button
                    type="button"
                    className={`fan-toggle-btn ${sensorSnapshot.fanIsOn ? 'active-on' : ''}`}
                    onClick={() => handleFanControl(true)}
                    disabled={isFanSubmitting}
                  >
                    {isFanSubmitting && !sensorSnapshot.fanIsOn ? 'Sending...' : 'Turn On'}
                  </button>
                  <button
                    type="button"
                    className={`fan-toggle-btn fan-toggle-off ${!sensorSnapshot.fanIsOn ? 'active-off' : ''}`}
                    onClick={() => handleFanControl(false)}
                    disabled={isFanSubmitting}
                  >
                    {isFanSubmitting && sensorSnapshot.fanIsOn ? 'Sending...' : 'Turn Off'}
                  </button>
                </div>

                {fanControlFeedback.message && (
                  <p className={`account-feedback ${fanControlFeedback.type || 'success'}`}>
                    {fanControlFeedback.message}
                  </p>
                )}
              </article>

              <article className="panel fade-in">
                <h3>Relay Status</h3>
                <ul className="camera-list">
                  <li>
                    <div>
                      <strong>Acebott Heartbeat</strong>
                      <p>{sensorHealth.heartbeatLabel}</p>
                    </div>
                    <span className={sensorHealth.pir.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.pir.online ? 'online' : 'stale'}
                    </span>
                  </li>
                  <li>
                    <div>
                      <strong>Fan Relay</strong>
                      <p>{sensorHealth.fan.detail}</p>
                    </div>
                    <span className={sensorHealth.fan.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.fan.label}
                    </span>
                  </li>
                  <li>
                    <div>
                      <strong>PIR Motion</strong>
                      <p>{sensorHealth.pir.detail}</p>
                    </div>
                    <span className={sensorHealth.pir.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.pir.label}
                    </span>
                  </li>
                  <li>
                    <div>
                      <strong>DHT Sensor</strong>
                      <p>{sensorHealth.dht.detail}</p>
                    </div>
                    <span className={sensorHealth.dht.online ? 'badge online' : 'badge offline'}>
                      {sensorHealth.dht.label}
                    </span>
                  </li>
                </ul>
              </article>
            </div>
          </section>
        )}

        {activeSection === 'users' && (
          <section className="page-grid">
            <article className="panel fade-in">
              <div className="panel-head">
                <h3>Filters</h3>
                <button
                  type="button"
                  onClick={() => {
                    setAccountFeedback({ type: '', message: '' })
                    setIsCreateModalOpen(true)
                  }}
                >
                  Create Account
                </button>
              </div>
              <div className="filters">
                <input
                  type="text"
                  value={searchUser}
                  onChange={(event) => setSearchUser(event.target.value)}
                  placeholder="Search by name or email"
                />
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                  <option value="all">All roles</option>
                  <option value="admin">admin</option>
                  <option value="user">user</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All status</option>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                  <option value="pending">pending</option>
                </select>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last Seen</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id}>
                        <td>{user.id}</td>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>
                          <select
                            className="inline-select"
                            value={user.role}
                            onChange={(event) => updateUserRole(user.id, event.target.value)}
                          >
                            <option value="admin">admin</option>
                            <option value="user">user</option>
                          </select>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              user.status === 'active'
                                ? 'status-active'
                                : user.status === 'pending'
                                  ? 'status-pending'
                                  : 'status-inactive'
                            }`}
                          >
                            {user.status}
                          </span>
                        </td>
                        <td>{user.lastSeen}</td>
                        <td>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="icon-button info-button"
                              onClick={() => openEnrollmentModal(user)}
                              aria-label="Enroll face images"
                              title="Enroll face images"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
                                <path d="M8 12c1.2-2 2.8-3 4-3s2.8 1 4 3" />
                                <path d="M9.5 15.5c.7-.9 1.6-1.5 2.5-1.5s1.8.6 2.5 1.5" />
                                <path d="M10 10h.01" />
                                <path d="M14 10h.01" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={
                                user.status === 'active'
                                  ? 'icon-button warning-button'
                                  : 'icon-button success-button'
                              }
                              onClick={() => toggleUserStatus(user.id)}
                              aria-label={
                                user.status === 'pending'
                                  ? 'Approve user'
                                  : user.status === 'active'
                                    ? 'Deactivate user'
                                    : 'Activate user'
                              }
                              title={
                                user.status === 'pending'
                                  ? 'Approve user'
                                  : user.status === 'active'
                                    ? 'Deactivate user'
                                    : 'Activate user'
                              }
                            >
                              {user.status === 'active' ? (
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M6 12h12" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M12 5v14" />
                                  <path d="M5 12h14" />
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              className="icon-button danger-button"
                              onClick={() => deleteUser(user.id)}
                              aria-label="Delete user"
                              title="Delete user"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M9 3h6" />
                                <path d="M4 7h16" />
                                <path d="M6 7l1 13h10l1-13" />
                                <path d="M10 11v5" />
                                <path d="M14 11v5" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {isCreateModalOpen && (
          <div
            className="modal-overlay"
            onClick={() => setIsCreateModalOpen(false)}
            role="presentation"
          >
            <div
              className="modal-card fade-in"
              role="dialog"
              aria-modal="true"
              aria-label="Create account form"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-header">
                <h3>Create Account</h3>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setIsCreateModalOpen(false)}
                  aria-label="Close create account form"
                >
                  x
                </button>
              </div>
              <p className="panel-note">Create a user account for mobile app login.</p>
              <form className="account-form" onSubmit={handleNewUser}>
                <div className="field">
                  <label htmlFor="first-name">First Name</label>
                  <input
                    id="first-name"
                    type="text"
                    placeholder="First name"
                    value={newUser.firstName}
                    onChange={(event) =>
                      setNewUser((current) => ({ ...current, firstName: event.target.value }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="last-name">Last Name</label>
                  <input
                    id="last-name"
                    type="text"
                    placeholder="Last name"
                    value={newUser.lastName}
                    onChange={(event) =>
                      setNewUser((current) => ({ ...current, lastName: event.target.value }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    type="text"
                    placeholder="Username"
                    value={newUser.username}
                    onChange={(event) =>
                      setNewUser((current) => ({ ...current, username: event.target.value }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="email">Email Address</label>
                  <input
                    id="email"
                    type="email"
                    placeholder="Email address"
                    value={newUser.email}
                    onChange={(event) =>
                      setNewUser((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="role-readonly">Role</label>
                  <input id="role-readonly" type="text" value="user" disabled />
                </div>

                <div className="field">
                  <label htmlFor="password">Password</label>
                  <div className="password-field">
                    <input
                      id="password"
                      type={showCreatePassword ? 'text' : 'password'}
                      placeholder="Minimum 6 characters"
                      value={newUser.password}
                      onChange={(event) =>
                        setNewUser((current) => ({ ...current, password: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowCreatePassword((current) => !current)}
                      aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                      title={showCreatePassword ? 'Hide password' : 'Show password'}
                    >
                      {showCreatePassword ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 3l18 18" />
                          <path d="M10.6 10.7a3 3 0 0 0 4.2 4.2" />
                          <path d="M9.4 5.3A10.7 10.7 0 0 1 12 5c5 0 9 4.5 10 7-1 2-3.1 4.3-5.8 5.6" />
                          <path d="M6.2 6.3C3.7 7.7 2 10 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 3-.5" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="confirm-password">Confirm Password</label>
                  <div className="password-field">
                    <input
                      id="confirm-password"
                      type={showCreateConfirmPassword ? 'text' : 'password'}
                      placeholder="Confirm password"
                      value={newUser.confirmPassword}
                      onChange={(event) =>
                        setNewUser((current) => ({ ...current, confirmPassword: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowCreateConfirmPassword((current) => !current)}
                      aria-label={showCreateConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      title={showCreateConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    >
                      {showCreateConfirmPassword ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 3l18 18" />
                          <path d="M10.6 10.7a3 3 0 0 0 4.2 4.2" />
                          <path d="M9.4 5.3A10.7 10.7 0 0 1 12 5c5 0 9 4.5 10 7-1 2-3.1 4.3-5.8 5.6" />
                          <path d="M6.2 6.3C3.7 7.7 2 10 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 3-.5" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="field field--full">
                  <button className="create-account-submit" type="submit">Create Account</button>
                </div>

                {accountFeedback.message && accountFeedback.type === 'error' && (
                  <p className="account-feedback error">{accountFeedback.message}</p>
                )}
              </form>
            </div>
          </div>
        )}

        {isEnrollmentModalOpen && selectedEnrollmentUser && (
          <div
            className="modal-overlay"
            onClick={() => closeEnrollmentModal()}
            role="presentation"
          >
            <div
              className="modal-card fade-in"
              role="dialog"
              aria-modal="true"
              aria-label="Face enrollment form"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-header">
                <h3>Enroll Face Images</h3>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => closeEnrollmentModal()}
                  aria-label="Close face enrollment form"
                >
                  x
                </button>
              </div>
              <p className="panel-note">
                Upload 1 to 10 clear images for <strong>{selectedEnrollmentUser.name}</strong>. New uploads are
                added to the live dataset automatically, then face recognition reloads.
              </p>
              <form className="account-form" onSubmit={handleFaceEnrollmentSubmit}>
                <div className="field">
                  <label htmlFor="enrollment-user-id">User ID</label>
                  <input id="enrollment-user-id" type="text" value={selectedEnrollmentUser.id} disabled />
                </div>

                <div className="field">
                  <label htmlFor="enrollment-user-name">User</label>
                  <input id="enrollment-user-name" type="text" value={selectedEnrollmentUser.name} disabled />
                </div>

                <div className="field field--full">
                  <label htmlFor="enrollment-images">Face Images</label>
                  <input
                    id="enrollment-images"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleEnrollmentFileChange}
                  />
                  <p className="panel-note">Use front-facing, well-lit images. Minimum 1 per upload, maximum 10 per upload.</p>
                </div>

                <div className="field field--full">
                  <div className="enrollment-file-list">
                    {enrollmentFiles.length ? (
                      enrollmentFiles.map((file) => (
                        <span key={`${file.name}-${file.size}`} className="file-chip">
                          {file.name}
                        </span>
                      ))
                    ) : (
                      <p className="panel-note">No images selected yet.</p>
                    )}
                  </div>
                </div>

                <div className="field field--full">
                  <button className="create-account-submit" type="submit" disabled={isEnrollmentSubmitting}>
                    {isEnrollmentSubmitting ? 'Uploading...' : 'Save Face Enrollment'}
                  </button>
                </div>

                {enrollmentFeedback.message && (
                  <p className={`account-feedback ${enrollmentFeedback.type || 'success'}`}>
                    {enrollmentFeedback.message}
                  </p>
                )}
              </form>
            </div>
          </div>
        )}

        {isDeviceTestRunning && (
          <div className="modal-overlay">
            <div className="test-modal" role="dialog" aria-modal="true" aria-labelledby="device-test-title">
              <div className="test-spinner" aria-hidden="true" />
              <h3 id="device-test-title">Testing Devices</h3>
              <p>Checking camera, DHT, PIR, and fan status. Please wait...</p>
            </div>
          </div>
        )}

        {isEnrollmentSubmitting && (
          <div className="modal-overlay">
            <div className="test-modal" role="dialog" aria-modal="true" aria-labelledby="enrollment-loading-title">
              <div className="test-spinner" aria-hidden="true" />
              <h3 id="enrollment-loading-title">Saving Face Images</h3>
              <p>{enrollmentLoadingMessage}</p>
            </div>
          </div>
        )}

        {activeSection === 'cctv' && (
          <section className="page-grid">
            <article className="panel fade-in">
              <h3>Live CCTV Feeds</h3>
              <p className="panel-note">
                Face enrollment is turned off. Detection comes directly from live CCTV streams.
              </p>
              <div className="feed-grid">
                {cameras.length ? (
                  cameras.map((camera) => (
                    <div key={camera.id} className="feed-card">
                      <div className="feed-video">
                        <span>{camera.id}</span>
                        <small>{camera.area}</small>
                      </div>
                      <div className="feed-meta">
                        <span className={camera.status === 'online' ? 'badge online' : 'badge offline'}>
                          {camera.status}
                        </span>
                        <p>Last motion: {camera.lastMotion}</p>
                        <p>Recognized today: {camera.recognized}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="panel-note">No camera feed data yet from the database.</p>
                )}
              </div>
            </article>

            <article className="panel fade-in">
              <h3>Incident Queue</h3>
              <div className="incident-list">
                {logs.filter((log) => log.event === 'unrecognized').length ? (
                  logs
                    .filter((log) => log.event === 'unrecognized')
                    .map((log) => (
                      <div key={log.id} className="incident-card">
                        <strong>{log.camera}</strong>
                        <p>{log.time}</p>
                        <p>
                          {log.name} - confidence {log.confidence}
                        </p>
                      </div>
                    ))
                ) : (
                  <p className="panel-note">No unrecognized incidents in the database.</p>
                )}
              </div>
            </article>
          </section>
        )}

        {activeSection === 'logs' && (
          <section className="page-grid">
            <article className="panel fade-in">
              <h3>Attendance Logs</h3>
              <div className="filters">
                <select value={logFilter} onChange={(event) => setLogFilter(event.target.value)}>
                  <option value="recognized">Recognized only</option>
                  <option value="entry">entry</option>
                  <option value="exit">exit</option>
                </select>
                <button type="button" onClick={exportLogs}>
                  Export Logs CSV
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Name</th>
                      <th>Event</th>
                      <th>Camera</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.length ? (
                      filteredLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{log.time}</td>
                          <td>{log.name}</td>
                          <td>
                            <span className={`chip ${log.event}`}>{log.event}</span>
                          </td>
                          <td>{log.camera}</td>
                          <td>{log.confidence}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5">No attendance logs found in the database.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeSection === 'settings' && (
          <section className="page-grid">
            <article className="panel fade-in">
              <h3>Admin Account Settings</h3>
              <p className="panel-note">
                Change admin username and password used in the login page.
              </p>
              <p className="settings-current">
                Current username: <strong>{adminAccount.username}</strong>
              </p>
              <form className="settings-grid" onSubmit={handleSaveSettings}>
                <div className="field">
                  <label htmlFor="current-password">Current Password</label>
                  <input
                    id="current-password"
                    type="password"
                    placeholder="Enter current password"
                    value={settingsForm.currentPassword}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        currentPassword: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="new-username">New Username</label>
                  <input
                    id="new-username"
                    type="text"
                    placeholder="Leave blank to keep current"
                    value={settingsForm.newUsername}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        newUsername: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="new-password">New Password</label>
                  <input
                    id="new-password"
                    type="password"
                    placeholder="Minimum 6 characters"
                    value={settingsForm.newPassword}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        newPassword: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="confirm-new-password">Confirm New Password</label>
                  <input
                    id="confirm-new-password"
                    type="password"
                    placeholder="Confirm new password"
                    value={settingsForm.confirmNewPassword}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        confirmNewPassword: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="field field--full">
                  <button type="submit">Save Settings</button>
                </div>

                {settingsFeedback.message && (
                  <p
                    className={
                      settingsFeedback.type === 'success'
                        ? 'account-feedback success'
                        : 'account-feedback error'
                    }
                  >
                    {settingsFeedback.message}
                  </p>
                )}
              </form>
            </article>
          </section>
        )}

        {activeSection === 'reports' && (
          <section className="page-grid">
            <div className="cards">
              <article className="metric-card fade-in">
                <p>Entries Today</p>
                <h3>{reportCounts.entry}</h3>
                <span>detected by CCTV</span>
              </article>
              <article className="metric-card fade-in">
                <p>Exits Today</p>
                <h3>{reportCounts.exit}</h3>
                <span>confirmed records</span>
              </article>
              <article className="metric-card fade-in danger">
                <p>Unrecognized Events</p>
                <h3>{reportCounts.unrecognized}</h3>
                <span>requires review</span>
              </article>
            </div>

            <article className="panel fade-in">
              <h3>Quick Export</h3>
              <p className="panel-note">
                Generate reports for review, archive, or audit using the latest Supabase records.
              </p>
              <div className="report-actions">
                <button type="button" onClick={exportUsers}>
                  Export Users CSV
                </button>
                <button type="button" onClick={exportLogs}>
                  Export Attendance CSV
                </button>
              </div>
              <div className="bar-chart">
                <div className="bar">
                  <label>Entries</label>
                  <span style={{ width: `${reportCounts.entry * 14}%` }} />
                </div>
                <div className="bar">
                  <label>Exits</label>
                  <span style={{ width: `${reportCounts.exit * 14}%` }} />
                </div>
                <div className="bar">
                  <label>Unrecognized</label>
                  <span style={{ width: `${reportCounts.unrecognized * 14}%` }} />
                </div>
              </div>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}

export default App


