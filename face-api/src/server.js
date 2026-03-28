require('dotenv').config()

const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const multer = require('multer')
const { pool, query } = require('./db')
const { signAdminToken, signUserToken, requireAuth, requireRole } = require('./auth')

const app = express()

const port = Number(process.env.PORT || 4000)
const isProduction = process.env.NODE_ENV === 'production'
const cameraSharedToken = String(process.env.CAMERA_SHARED_TOKEN || '').trim()
const deviceSharedToken = String(process.env.DEVICE_SHARED_TOKEN || cameraSharedToken).trim()
const supabaseUrl = String(
  process.env.SUPABASE_URL || 'https://ofvkhrqmswxzdikzsfsw.supabase.co'
).replace(/\/+$/, '')
const supabaseStorageApiKey = String(
  process.env.SUPABASE_STORAGE_API_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    'sb_publishable_9MoVy3d-me0pPvY9T9FGUQ_cmCJVNwZ'
).trim()
const faceEnrollmentBucket = String(process.env.FACE_ENROLLMENT_BUCKET || 'face-enrollment').trim()
const recognitionServiceUrl = String(
  process.env.RECOGNITION_SERVICE_URL ||
    (isProduction ? 'https://ptc-face-recognition.onrender.com' : 'http://127.0.0.1:8001')
).replace(/\/+$/, '')
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const enrollmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 12 * 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    if (String(file.mimetype || '').startsWith('image/')) {
      callback(null, true)
      return
    }
    callback(new Error('Only image uploads are allowed.'))
  },
})

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Origin not allowed by CORS'))
      }
    },
  })
)
app.use(express.json())

const requireAdmin = [requireAuth, requireRole('admin')]
const requireUser = [requireAuth, requireRole('user')]

function isValidRole(role) {
  return role === 'admin' || role === 'user'
}

function isValidStatus(status) {
  return status === 'active' || status === 'inactive' || status === 'pending'
}

function isValidEvent(event) {
  return event === 'entry' || event === 'exit' || event === 'unrecognized'
}

function requireCameraToken(req, res, next) {
  if (!cameraSharedToken) {
    return res.status(500).json({ message: 'Missing CAMERA_SHARED_TOKEN on server.' })
  }

  const token = String(req.headers['x-camera-token'] || '').trim()
  if (!token || token !== cameraSharedToken) {
    return res.status(401).json({ message: 'Invalid camera token.' })
  }

  return next()
}

function requireDeviceToken(req, res, next) {
  if (!deviceSharedToken) {
    return res.status(500).json({ message: 'Missing DEVICE_SHARED_TOKEN on server.' })
  }

  const token = String(req.headers['x-device-token'] || req.headers['x-camera-token'] || '').trim()
  if (!token || token !== deviceSharedToken) {
    return res.status(401).json({ message: 'Invalid device token.' })
  }

  return next()
}

function normalizePersonName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function sanitizeDatasetSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
}

function getDatasetExtension(file) {
  const mime = String(file?.mimetype || '').toLowerCase()
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  return '.jpg'
}

function buildDatasetFolderName(userRow) {
  const firstName = sanitizeDatasetSegment(userRow.first_name)
  const lastName = sanitizeDatasetSegment(userRow.last_name)
  return [userRow.id, firstName, lastName].filter(Boolean).join('_')
}

function encodeStorageObjectPath(storagePath) {
  return String(storagePath || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function buildFaceEnrollmentPublicUrl(storagePath) {
  return `${supabaseUrl}/storage/v1/object/public/${faceEnrollmentBucket}/${encodeStorageObjectPath(storagePath)}`
}

async function ensureFaceEnrollmentBucket() {
  await query(
    `INSERT INTO storage.buckets (id, name, public)
     VALUES ($1, $1, true)
     ON CONFLICT (id) DO UPDATE
     SET public = EXCLUDED.public`,
    [faceEnrollmentBucket]
  )
}

async function uploadEnrollmentImageToStorage(storagePath, file) {
  if (!supabaseStorageApiKey || !supabaseUrl) {
    throw new Error('Supabase storage is not configured.')
  }

  const objectPath = encodeStorageObjectPath(storagePath)
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${faceEnrollmentBucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: supabaseStorageApiKey,
      Authorization: `Bearer ${supabaseStorageApiKey}`,
      'Content-Type': file.mimetype || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file.buffer,
  })

  if (!response.ok) {
    const payload = await response.text().catch(() => '')
    throw new Error(
      payload || `Supabase storage upload failed with status ${response.status}.`
    )
  }
}

async function assertAdminSession(sessionToken) {
  if (!sessionToken) {
    const error = new Error('Admin session is required.')
    error.statusCode = 401
    throw error
  }

  try {
    const result = await query(`SELECT public.admin_assert_session($1) AS "adminId"`, [sessionToken])
    return result.rows[0]?.adminId || null
  } catch (error) {
    error.statusCode = 401
    throw error
  }
}

async function reloadRecognitionDataset() {
  try {
    const response = await fetch(`${recognitionServiceUrl}/reload-dataset`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return {
        ok: false,
        error: `Recognition reload failed with status ${response.status}.`,
      }
    }

    const payload = await response.json().catch(() => ({}))
    return {
      ok: true,
      payload,
    }
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      return {
        ok: true,
        queued: true,
        warning: 'Recognition reload request timed out while the dataset is rebuilding in the background.',
      }
    }
    return {
      ok: false,
      error: `Recognition service unavailable: ${error.message}`,
    }
  }
}

async function saveEnrollmentImages(userRow, files) {
  const targetFolderName = buildDatasetFolderName(userRow)
  await ensureFaceEnrollmentBucket()

  const existingOrderResult = await query(
    `SELECT COALESCE(MAX(capture_order), 0)::int AS "maxOrder"
     FROM public.face_enrollment_images
     WHERE user_id = $1`,
    [userRow.id]
  )
  const startingOrder = Number(existingOrderResult.rows[0]?.maxOrder || 0)

  const metadataRows = []

  for (const [index, file] of files.entries()) {
    const order = startingOrder + index + 1
    const extension = getDatasetExtension(file)
    const filename = `${String(order).padStart(2, '0')}${extension}`
    const storagePath = `${targetFolderName}/${filename}`
    const publicUrl = buildFaceEnrollmentPublicUrl(storagePath)

    await uploadEnrollmentImageToStorage(storagePath, file)

    metadataRows.push({
      poseKey: `image_${String(order).padStart(4, '0')}`,
      poseLabel: `Image ${order}`,
      captureOrder: order,
      storagePath,
      publicUrl,
      contentType: file.mimetype || 'image/jpeg',
      fileSize: file.size || file.buffer.length,
    })
  }

  for (const row of metadataRows) {
    await query(
      `INSERT INTO public.face_enrollment_images (
        user_id,
        pose_key,
        pose_label,
        capture_order,
        storage_path,
        public_url,
        content_type,
        file_size
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userRow.id,
        row.poseKey,
        row.poseLabel,
        row.captureOrder,
        row.storagePath,
        row.publicUrl,
        row.contentType,
        row.fileSize,
      ]
    )
  }

  return {
    folderName: targetFolderName,
    imageCount: metadataRows.length,
    totalImages: startingOrder + metadataRows.length,
  }
}

async function removeEnrollmentDataset(userRow) {
  const datasetRows = await query(
    `SELECT storage_path
     FROM public.face_enrollment_images
     WHERE user_id = $1`,
    [userRow.id]
  )

  await query('DELETE FROM public.face_enrollment_images WHERE user_id = $1', [userRow.id])

  return [...new Set(datasetRows.rows
    .map((row) => String(row.storage_path || '').split('/')[0])
    .filter(Boolean))]
}

async function getFaceEnrollmentDatasetManifest() {
  const [usersResult, imagesResult] = await Promise.all([
    query('SELECT id FROM public.users ORDER BY id ASC'),
    query(
      `SELECT
        i.user_id AS "userId",
        u.first_name AS "firstName",
        u.last_name AS "lastName",
        i.capture_order AS "captureOrder",
        i.storage_path AS "storagePath",
        i.public_url AS "publicUrl"
      FROM public.face_enrollment_images i
      JOIN public.users u ON u.id = i.user_id
      ORDER BY i.user_id ASC, i.capture_order ASC`
    ),
  ])

  return {
    activeUserIds: usersResult.rows.map((row) => Number(row.id)).filter(Number.isFinite),
    images: imagesResult.rows.map((row) => ({
      userId: Number(row.userId),
      label: [row.firstName, row.lastName].filter(Boolean).join(' ').trim(),
      captureOrder: Number(row.captureOrder || 0),
      storagePath: row.storagePath,
      publicUrl: row.publicUrl || buildFaceEnrollmentPublicUrl(row.storagePath),
    })),
  }
}

async function ensureCoreSystemRows() {
  await query(
    `INSERT INTO fan_state (device_key, is_on, updated_at, updated_by_label)
     VALUES ('main_fan', FALSE, NOW(), 'system')
     ON CONFLICT (device_key) DO NOTHING`
  )
}

async function getCameraSummaryRows() {
  const result = await query(
    `SELECT
      c.camera_id AS "cameraId",
      c.area,
      CASE
        WHEN COALESCE(logs.last_detected_at, c.last_seen_at) >= NOW() - INTERVAL '2 minutes'
          THEN 'online'
        ELSE 'offline'
      END AS status,
      COALESCE(logs.last_detected_at, c.last_seen_at) AS "lastDetectedAt",
      COALESCE(logs.recognized_today, 0)::int AS "recognizedToday",
      COALESCE(logs.unrecognized_today, 0)::int AS "unrecognizedToday"
    FROM cameras c
    LEFT JOIN (
      SELECT
        camera_id,
        MAX(detected_at) AS last_detected_at,
        COUNT(*) FILTER (
          WHERE detected_at::date = CURRENT_DATE AND event IN ('entry', 'exit')
        ) AS recognized_today,
        COUNT(*) FILTER (
          WHERE detected_at::date = CURRENT_DATE AND event = 'unrecognized'
        ) AS unrecognized_today
      FROM attendance_logs
      GROUP BY camera_id
    ) logs ON logs.camera_id = c.camera_id
    ORDER BY c.camera_id ASC`
  )

  return result.rows
}

async function getFanStateRow() {
  await ensureCoreSystemRows()
  const result = await query(
    `SELECT
      device_key AS "deviceKey",
      is_on AS "isOn",
      updated_at AS "updatedAt",
      updated_by_user_id AS "updatedByUserId",
      updated_by_label AS "updatedBy"
    FROM fan_state
    WHERE device_key = 'main_fan'
    LIMIT 1`
  )

  return result.rows[0]
}

async function getLatestSensorSnapshot(deviceKey = null) {
  const result = await query(
    `SELECT
      device_key AS "deviceKey",
      pir_state AS "pirState",
      fan_is_on AS "fanIsOn",
      temperature_c AS "temperatureC",
      humidity,
      created_at AS "createdAt"
    FROM sensor_logs
    WHERE ($1::text IS NULL OR device_key = $1)
    ORDER BY created_at DESC
    LIMIT 1`,
    [deviceKey]
  )

  return result.rows[0] || null
}

async function resolveLogUser(client, { userId, userNameSnapshot }) {
  if (Number.isFinite(userId)) {
    const userById = await client.query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", username, email
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    )

    if (userById.rowCount) {
      return userById.rows[0]
    }
  }

  const normalizedName = normalizePersonName(userNameSnapshot)
  if (!normalizedName) {
    return null
  }

  const userByName = await client.query(
    `SELECT id, first_name AS "firstName", last_name AS "lastName", username, email
     FROM users
     WHERE LOWER(TRIM(CONCAT_WS(' ', first_name, last_name))) = $1
     LIMIT 1`,
    [normalizedName]
  )

  return userByName.rows[0] || null
}

async function insertSensorLog({
  deviceKey,
  pirState,
  fanIsOn,
  temperatureC,
  humidity,
  createdAt,
}) {
  const result = await query(
    `INSERT INTO sensor_logs (
      device_key,
      pir_state,
      fan_is_on,
      temperature_c,
      humidity,
      created_at
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      COALESCE($6::timestamptz, NOW())
    )
    RETURNING
      id,
      device_key AS "deviceKey",
      pir_state AS "pirState",
      fan_is_on AS "fanIsOn",
      temperature_c AS "temperatureC",
      humidity,
      created_at AS "createdAt"`,
    [deviceKey, pirState, fanIsOn, temperatureC, humidity, createdAt]
  )

  return result.rows[0]
}

async function setFanStateWithClient(
  client,
  { isOn, updatedByUserId = null, updatedByLabel = 'system', forceEvent = false }
) {
  const nextIsOn = Boolean(isOn)
  const currentResult = await client.query(
    `SELECT
      is_on AS "isOn"
    FROM fan_state
    WHERE device_key = 'main_fan'
    LIMIT 1
    FOR UPDATE`
  )

  const current = currentResult.rows[0] || null
  const stateChanged = !current || current.isOn !== nextIsOn

  await client.query(
    `INSERT INTO fan_state (device_key, is_on, updated_at, updated_by_user_id, updated_by_label)
     VALUES ('main_fan', $1, NOW(), $2, $3)
     ON CONFLICT (device_key)
     DO UPDATE SET
       is_on = EXCLUDED.is_on,
       updated_at = NOW(),
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_by_label = EXCLUDED.updated_by_label`,
    [nextIsOn, updatedByUserId, updatedByLabel]
  )

  let event = null
  if (stateChanged || forceEvent) {
    const eventResult = await client.query(
      `INSERT INTO fan_events (device_key, is_on, updated_by_user_id, updated_by_label)
       VALUES ('main_fan', $1, $2, $3)
       RETURNING id, is_on AS "isOn", updated_by_label AS "by", created_at AS "at"`,
      [nextIsOn, updatedByUserId, updatedByLabel]
    )
    event = eventResult.rows[0]
  }

  const stateResult = await client.query(
    `SELECT
      is_on AS "isOn",
      updated_at AS "updatedAt",
      updated_by_label AS "updatedBy"
    FROM fan_state
    WHERE device_key = 'main_fan'
    LIMIT 1`
  )

  return {
    ...stateResult.rows[0],
    event,
    stateChanged,
  }
}

async function insertAttendanceLog({
  userId,
  userNameSnapshot,
  cameraId,
  event,
  confidence,
  detectedAt,
}) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const resolvedUser = await resolveLogUser(client, { userId, userNameSnapshot })
    const resolvedUserId = resolvedUser?.id ?? null
    const resolvedLabel =
      String(userNameSnapshot || '').trim() ||
      [resolvedUser?.firstName, resolvedUser?.lastName].filter(Boolean).join(' ').trim() ||
      null

    await client.query(
      `INSERT INTO cameras (camera_id, area, status, last_seen_at)
       VALUES ($1, 'Connected camera', 'online', COALESCE($2::timestamptz, NOW()))
       ON CONFLICT (camera_id)
       DO UPDATE SET
         status = 'online',
         last_seen_at = COALESCE($2::timestamptz, NOW())`,
      [cameraId, detectedAt]
    )

    const inserted = await client.query(
      `INSERT INTO attendance_logs (
        user_id, user_name_snapshot, camera_id, event, confidence, detected_at
      ) VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
      RETURNING
        id,
        user_id AS "userId",
        user_name_snapshot AS "userNameSnapshot",
        camera_id AS "cameraId",
        event,
        confidence,
        detected_at AS "detectedAt",
        created_at AS "createdAt"`,
      [resolvedUserId, resolvedLabel, cameraId, event, confidence, detectedAt]
    )

    let fanState = null
    if (event === 'entry' && resolvedLabel) {
      fanState = await setFanStateWithClient(client, {
        isOn: true,
        updatedByUserId: resolvedUserId,
        updatedByLabel: resolvedLabel,
      })
    }

    await client.query('COMMIT')
    return {
      ...inserted.rows[0],
      fanState,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function upsertCameraHeartbeat(cameraId, seenAt = null) {
  const result = await query(
    `INSERT INTO cameras (camera_id, area, status, last_seen_at)
     VALUES ($1, 'Connected camera', 'online', COALESCE($2::timestamptz, NOW()))
     ON CONFLICT (camera_id)
     DO UPDATE SET
       status = 'online',
       last_seen_at = COALESCE($2::timestamptz, NOW())
     RETURNING
       camera_id AS "cameraId",
       area,
       status,
       last_seen_at AS "lastSeenAt"`,
    [cameraId, seenAt]
  )

  return result.rows[0]
}

app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1')
    res.json({ ok: true, service: 'face-api' })
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Database connection failed.' })
  }
})

app.get('/api/device/fan-state', requireDeviceToken, async (req, res) => {
  const deviceKey = String(req.query.deviceKey || 'acebott-main-01').trim()

  try {
    const [fanState, sensorSnapshot] = await Promise.all([
      getFanStateRow(),
      getLatestSensorSnapshot(deviceKey || null),
    ])

    return res.json({
      deviceKey,
      isOn: Boolean(fanState?.isOn),
      updatedAt: fanState?.updatedAt || null,
      updatedBy: fanState?.updatedBy || 'system',
      sensorSnapshot,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch device fan state.', detail: error.message })
  }
})

app.post('/api/device/sensor-logs', requireDeviceToken, async (req, res) => {
  const deviceKey = String(req.body.deviceKey || '').trim()
  const createdAt = req.body.createdAt ? String(req.body.createdAt) : null
  const pirState = req.body.pirState
  const fanIsOn = req.body.fanIsOn
  const temperatureC = req.body.temperatureC === null || req.body.temperatureC === undefined
    ? null
    : Number(req.body.temperatureC)
  const humidity = req.body.humidity === null || req.body.humidity === undefined
    ? null
    : Number(req.body.humidity)

  if (!deviceKey) {
    return res.status(400).json({ message: 'deviceKey is required.' })
  }

  if (typeof pirState !== 'boolean' || typeof fanIsOn !== 'boolean') {
    return res.status(400).json({ message: 'pirState and fanIsOn must be boolean.' })
  }

  if (temperatureC !== null && !Number.isFinite(temperatureC)) {
    return res.status(400).json({ message: 'temperatureC must be a valid number or null.' })
  }

  if (humidity !== null && !Number.isFinite(humidity)) {
    return res.status(400).json({ message: 'humidity must be a valid number or null.' })
  }

  try {
    const inserted = await insertSensorLog({
      deviceKey,
      pirState,
      fanIsOn,
      temperatureC,
      humidity,
      createdAt,
    })

    return res.status(201).json(inserted)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to save sensor log.', detail: error.message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' })
  }

  try {
    const result = await query(
      `SELECT id, username, password_hash, is_active
       FROM admins
       WHERE username = $1
       LIMIT 1`,
      [username]
    )

    if (!result.rowCount || !result.rows[0].is_active) {
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    const admin = result.rows[0]
    const passwordOk = await bcrypt.compare(password, admin.password_hash)

    if (!passwordOk) {
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    await query('UPDATE admins SET last_login_at = NOW() WHERE id = $1', [admin.id])

    const token = signAdminToken(admin)
    return res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: 'Login failed.', detail: error.message })
  }
})

app.post('/api/user-auth/login', async (req, res) => {
  const identity = String(req.body.username || req.body.email || '').trim().toLowerCase()
  const password = String(req.body.password || '')

  if (!identity || !password) {
    return res.status(400).json({ message: 'Username/email and password are required.' })
  }

  try {
    const result = await query(
      `SELECT id, first_name, last_name, username, email, role, status, password_hash
       FROM users
       WHERE (LOWER(username) = $1 OR LOWER(email) = $1)
       LIMIT 1`,
      [identity]
    )

    if (!result.rowCount) {
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    const user = result.rows[0]

    if (user.role !== 'user' || !user.password_hash) {
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    if (user.status === 'pending') {
      return res.status(403).json({ message: 'Your registration is pending admin approval.' })
    }

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Your account is inactive. Please contact the admin.' })
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash)
    if (!passwordOk) {
      return res.status(401).json({ message: 'Invalid credentials.' })
    }

    const token = signUserToken(user)
    return res.json({
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    })
  } catch (error) {
    return res.status(500).json({ message: 'User login failed.', detail: error.message })
  }
})

app.get('/api/user/me', ...requireUser, async (req, res) => {
  try {
    const result = await query(
      `SELECT
        id,
        first_name AS "firstName",
        last_name AS "lastName",
        username,
        email,
        role,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM users
      WHERE id = $1
      LIMIT 1`,
      [req.auth.sub]
    )

    if (!result.rowCount) {
      return res.status(404).json({ message: 'User account not found.' })
    }

    return res.json(result.rows[0])
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user.', detail: error.message })
  }
})

app.put('/api/user/profile', ...requireUser, async (req, res) => {
  const firstName =
    req.body.firstName === undefined ? null : String(req.body.firstName || '').trim()
  const lastName = req.body.lastName === undefined ? null : String(req.body.lastName || '').trim()
  const username = req.body.username === undefined ? null : String(req.body.username || '').trim()
  const email =
    req.body.email === undefined ? null : String(req.body.email || '').trim().toLowerCase()

  if (firstName === null && lastName === null && username === null && email === null) {
    return res.status(400).json({ message: 'Provide firstName, lastName, username, or email.' })
  }

  if (firstName !== null && !firstName) {
    return res.status(400).json({ message: 'firstName cannot be empty.' })
  }

  if (lastName !== null && !lastName) {
    return res.status(400).json({ message: 'lastName cannot be empty.' })
  }

  if (username !== null && !username) {
    return res.status(400).json({ message: 'username cannot be empty.' })
  }

  if (email !== null && (!email || !/^\S+@\S+\.\S+$/.test(email))) {
    return res.status(400).json({ message: 'Enter a valid email address.' })
  }

  try {
    const updates = []
    const values = []
    let position = 1

    if (firstName !== null) {
      updates.push(`first_name = $${position}`)
      values.push(firstName)
      position += 1
    }

    if (lastName !== null) {
      updates.push(`last_name = $${position}`)
      values.push(lastName)
      position += 1
    }

    if (username !== null) {
      updates.push(`username = $${position}`)
      values.push(username)
      position += 1
    }

    if (email !== null) {
      updates.push(`email = $${position}`)
      values.push(email)
      position += 1
    }

    updates.push('updated_at = NOW()')
    values.push(req.auth.sub)

    const updated = await query(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE id = $${position}
       RETURNING
        id,
        first_name AS "firstName",
        last_name AS "lastName",
        username,
        email,
        role,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      values
    )

    if (!updated.rowCount) {
      return res.status(404).json({ message: 'User account not found.' })
    }

    return res.json({
      message: 'Profile updated.',
      user: updated.rows[0],
    })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Username or email already in use.' })
    }
    return res.status(500).json({ message: 'Failed to update profile.', detail: error.message })
  }
})

app.put('/api/user/password', ...requireUser, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '')
  const newPassword = String(req.body.newPassword || '')

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword and newPassword are required.' })
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'newPassword must be at least 6 characters.' })
  }

  try {
    const userResult = await query(
      'SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1',
      [req.auth.sub]
    )

    if (!userResult.rowCount) {
      return res.status(404).json({ message: 'User account not found.' })
    }

    const user = userResult.rows[0]
    if (!user.password_hash) {
      return res.status(400).json({ message: 'Password is not set for this account.' })
    }

    const passwordOk = await bcrypt.compare(currentPassword, user.password_hash)
    if (!passwordOk) {
      return res.status(401).json({ message: 'Current password is incorrect.' })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      passwordHash,
      req.auth.sub,
    ])

    return res.json({ message: 'Password updated successfully.' })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update password.', detail: error.message })
  }
})

app.get('/api/user/logs', ...requireUser, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200)
  try {
    const userResult = await query(
      'SELECT first_name, last_name FROM users WHERE id = $1 LIMIT 1',
      [req.auth.sub]
    )

    if (!userResult.rowCount) {
      return res.status(404).json({ message: 'User account not found.' })
    }

    const fullName = `${userResult.rows[0].first_name} ${userResult.rows[0].last_name}`
    const logsResult = await query(
      `SELECT
        id,
        user_id AS "userId",
        user_name_snapshot AS "userNameSnapshot",
        camera_id AS "cameraId",
        event,
        confidence,
        detected_at AS "detectedAt"
      FROM attendance_logs
      WHERE user_id = $1 OR user_name_snapshot = $2
      ORDER BY detected_at DESC
      LIMIT $3`,
      [req.auth.sub, fullName, limit]
    )

    return res.json(logsResult.rows)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user logs.', detail: error.message })
  }
})

app.get('/api/user/global/logs', ...requireUser, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 300)
  try {
    const result = await query(
      `SELECT
        id,
        user_id AS "userId",
        user_name_snapshot AS "userNameSnapshot",
        camera_id AS "cameraId",
        event,
        confidence,
        detected_at AS "detectedAt",
        created_at AS "createdAt"
      FROM attendance_logs
      ORDER BY detected_at DESC
      LIMIT $1`,
      [limit]
    )

    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch global logs.', detail: error.message })
  }
})

app.get('/api/user/fan', ...requireUser, async (req, res) => {
  try {
    const fanState = await getFanStateRow()
    return res.json({
      isOn: fanState.isOn,
      updatedAt: fanState.updatedAt,
      updatedBy: fanState.updatedBy,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch fan state.', detail: error.message })
  }
})

app.post('/api/user/fan', ...requireUser, async (req, res) => {
  if (typeof req.body.isOn !== 'boolean') {
    return res.status(400).json({ message: 'isOn must be boolean.' })
  }

  const client = await pool.connect()

  try {
    const updatedBy = req.auth.username || `user:${req.auth.sub}`

    await client.query('BEGIN')
    const fanState = await setFanStateWithClient(client, {
      isOn: req.body.isOn,
      updatedByUserId: req.auth.sub,
      updatedByLabel: updatedBy,
    })

    await client.query('COMMIT')

    return res.json(fanState)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    return res.status(500).json({ message: 'Failed to update fan state.', detail: error.message })
  } finally {
    client.release()
  }
})

app.get('/api/user/notifications', ...requireUser, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200)
  try {
    const userResult = await query(
      'SELECT first_name, last_name FROM users WHERE id = $1 LIMIT 1',
      [req.auth.sub]
    )

    if (!userResult.rowCount) {
      return res.status(404).json({ message: 'User account not found.' })
    }

    const fullName = `${userResult.rows[0].first_name} ${userResult.rows[0].last_name}`
    const detectionsResult = await query(
      `SELECT
        id,
        user_name_snapshot AS "userNameSnapshot",
        camera_id AS "cameraId",
        event,
        confidence,
        detected_at AS "detectedAt"
      FROM attendance_logs
      WHERE user_id = $1 OR user_name_snapshot = $2
      ORDER BY detected_at DESC
      LIMIT $3`,
      [req.auth.sub, fullName, limit]
    )

    const detectionNotifications = detectionsResult.rows.map((log) => ({
      id: `det-${log.id}`,
      type: 'detection',
      title:
        log.event === 'entry'
          ? 'You were detected entering'
          : log.event === 'exit'
            ? 'You were detected exiting'
            : 'Unrecognized detection alert',
      message: `${log.cameraId} - confidence ${Math.round(Number(log.confidence || 0))}%`,
      at: log.detectedAt,
    }))

    const fanEventsResult = await query(
      `SELECT
        id,
        is_on AS "isOn",
        updated_by_label AS "by",
        created_at AS "at"
      FROM fan_events
      ORDER BY created_at DESC
      LIMIT $1`,
      [limit]
    )

    const fanNotifications = fanEventsResult.rows.map((event) => ({
      id: `fan-${event.id}`,
      type: 'fan',
      title: event.isOn ? 'Fan switched ON' : 'Fan switched OFF',
      message: `Changed by ${event.by}`,
      at: event.at,
    }))

    const combined = [...detectionNotifications, ...fanNotifications]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limit)

    return res.json(combined)
  } catch (error) {
    return res
      .status(500)
      .json({ message: 'Failed to fetch notifications.', detail: error.message })
  }
})

app.get('/api/admin/me', ...requireAdmin, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, username, created_at, updated_at, last_login_at FROM admins WHERE id = $1 LIMIT 1',
      [req.auth.sub]
    )

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Admin account not found.' })
    }

    return res.json(result.rows[0])
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch admin.', detail: error.message })
  }
})

app.put('/api/admin/credentials', ...requireAdmin, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '')
  const newUsername = String(req.body.newUsername || '').trim()
  const newPassword = String(req.body.newPassword || '')

  if (!currentPassword) {
    return res.status(400).json({ message: 'Current password is required.' })
  }

  if (!newUsername && !newPassword) {
    return res.status(400).json({ message: 'Provide a new username or new password.' })
  }

  if (newPassword && newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters.' })
  }

  try {
    const adminResult = await query(
      'SELECT id, username, password_hash FROM admins WHERE id = $1 LIMIT 1',
      [req.auth.sub]
    )

    if (!adminResult.rowCount) {
      return res.status(404).json({ message: 'Admin account not found.' })
    }

    const admin = adminResult.rows[0]
    const passwordOk = await bcrypt.compare(currentPassword, admin.password_hash)

    if (!passwordOk) {
      return res.status(401).json({ message: 'Current password is incorrect.' })
    }

    const updates = []
    const values = []
    let position = 1

    if (newUsername) {
      updates.push(`username = $${position}`)
      values.push(newUsername)
      position += 1
    }

    if (newPassword) {
      const passwordHash = await bcrypt.hash(newPassword, 10)
      updates.push(`password_hash = $${position}`)
      values.push(passwordHash)
      position += 1
    }

    updates.push('updated_at = NOW()')
    values.push(admin.id)

    const updated = await query(
      `UPDATE admins
       SET ${updates.join(', ')}
       WHERE id = $${position}
       RETURNING id, username, updated_at`,
      values
    )

    return res.json({
      message: 'Admin credentials updated.',
      admin: updated.rows[0],
    })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Username is already in use.' })
    }
    return res.status(500).json({ message: 'Failed to update credentials.', detail: error.message })
  }
})

app.get('/api/users', ...requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT
        id,
        first_name AS "firstName",
        last_name AS "lastName",
        username,
        email,
        role,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM users
      ORDER BY created_at DESC`
    )
    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch users.', detail: error.message })
  }
})

app.post('/api/users', ...requireAdmin, async (req, res) => {
  const firstName = String(req.body.firstName || '').trim()
  const lastName = String(req.body.lastName || '').trim()
  const username = String(req.body.username || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const role = String(req.body.role || 'user').trim().toLowerCase()
  const status = String(req.body.status || 'active').trim().toLowerCase()
  const password = String(req.body.password || '')

  if (!firstName || !lastName || !username || !email) {
    return res.status(400).json({ message: 'firstName, lastName, username, and email are required.' })
  }

  if (!isValidRole(role)) {
    return res.status(400).json({ message: 'role must be admin or user.' })
  }

  if (!isValidStatus(status)) {
    return res.status(400).json({ message: 'status must be active, inactive, or pending.' })
  }

  if (password && password.length < 6) {
    return res.status(400).json({ message: 'password must be at least 6 characters.' })
  }

  try {
    const passwordHash = password ? await bcrypt.hash(password, 10) : null
    const inserted = await query(
      `INSERT INTO users (
        first_name, last_name, username, email, role, status, password_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        first_name AS "firstName",
        last_name AS "lastName",
        username,
        email,
        role,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [firstName, lastName, username, email, role, status, passwordHash]
    )

    return res.status(201).json(inserted.rows[0])
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Username or email already exists.' })
    }
    return res.status(500).json({ message: 'Failed to create user.', detail: error.message })
  }
})

app.patch('/api/users/:id', ...requireAdmin, async (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ message: 'Invalid user id.' })
  }

  const role = req.body.role ? String(req.body.role).trim().toLowerCase() : null
  const status = req.body.status ? String(req.body.status).trim().toLowerCase() : null

  if (!role && !status) {
    return res.status(400).json({ message: 'Provide role or status to update.' })
  }

  if (role && !isValidRole(role)) {
    return res.status(400).json({ message: 'role must be admin or user.' })
  }

  if (status && !isValidStatus(status)) {
    return res.status(400).json({ message: 'status must be active, inactive, or pending.' })
  }

  try {
    const updates = []
    const values = []
    let position = 1

    if (role) {
      updates.push(`role = $${position}`)
      values.push(role)
      position += 1
    }

    if (status) {
      updates.push(`status = $${position}`)
      values.push(status)
      position += 1
    }

    updates.push('updated_at = NOW()')
    values.push(userId)

    const updated = await query(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE id = $${position}
       RETURNING
         id,
         first_name AS "firstName",
         last_name AS "lastName",
         username,
         email,
         role,
         status,
         updated_at AS "updatedAt"`,
      values
    )

    if (!updated.rowCount) {
      return res.status(404).json({ message: 'User not found.' })
    }

    return res.json(updated.rows[0])
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update user.', detail: error.message })
  }
})

app.delete('/api/users/:id', ...requireAdmin, async (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ message: 'Invalid user id.' })
  }

  try {
    const deleted = await query(
      `DELETE FROM users
       WHERE id = $1
       RETURNING id, first_name AS "firstName", last_name AS "lastName", email, role`,
      [userId]
    )

    if (!deleted.rowCount) {
      return res.status(404).json({ message: 'User not found.' })
    }

    return res.json({
      message: 'User deleted successfully.',
      user: deleted.rows[0],
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete user.', detail: error.message })
  }
})

app.get('/api/logs', ...requireAdmin, async (req, res) => {
  const event = req.query.event ? String(req.query.event).trim().toLowerCase() : null
  const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).trim() : null
  const dateTo = req.query.dateTo ? String(req.query.dateTo).trim() : null
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500)

  if (event && event !== 'all' && !isValidEvent(event)) {
    return res.status(400).json({ message: 'event filter must be entry, exit, or unrecognized.' })
  }

  const where = []
  const values = []
  let position = 1

  if (event && event !== 'all') {
    where.push(`event = $${position}`)
    values.push(event)
    position += 1
  }

  if (dateFrom) {
    where.push(`detected_at >= $${position}`)
    values.push(dateFrom)
    position += 1
  }

  if (dateTo) {
    where.push(`detected_at <= $${position}`)
    values.push(dateTo)
    position += 1
  }

  values.push(limit)
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  try {
    const result = await query(
      `SELECT
        id,
        user_id AS "userId",
        user_name_snapshot AS "userNameSnapshot",
        camera_id AS "cameraId",
        event,
        confidence,
        detected_at AS "detectedAt",
        created_at AS "createdAt"
      FROM attendance_logs
      ${whereClause}
      ORDER BY detected_at DESC
      LIMIT $${position}`,
      values
    )

    return res.json(result.rows)
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch logs.', detail: error.message })
  }
})

app.get('/api/cameras/summary', ...requireAdmin, async (req, res) => {
  try {
    return res.json(await getCameraSummaryRows())
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch camera summary.', detail: error.message })
  }
})

app.get('/api/user/cameras', ...requireUser, async (req, res) => {
  try {
    return res.json(await getCameraSummaryRows())
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user cameras.', detail: error.message })
  }
})

app.post('/api/logs', ...requireAdmin, async (req, res) => {
  const userId = req.body.userId ? Number(req.body.userId) : null
  const userNameSnapshot = String(req.body.userNameSnapshot || '').trim() || null
  const cameraId = String(req.body.cameraId || '').trim()
  const event = String(req.body.event || '').trim().toLowerCase()
  const confidence = req.body.confidence === undefined ? null : Number(req.body.confidence)
  const detectedAt = req.body.detectedAt ? String(req.body.detectedAt) : null

  if (!cameraId || !isValidEvent(event)) {
    return res.status(400).json({ message: 'cameraId and valid event are required.' })
  }

  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) {
    return res.status(400).json({ message: 'confidence must be a number from 0 to 100.' })
  }

  try {
    const inserted = await insertAttendanceLog({
      userId,
      userNameSnapshot,
      cameraId,
      event,
      confidence,
      detectedAt,
    })

    return res.status(201).json(inserted)
  } catch (error) {
    if (error.code === '23503') {
      return res.status(400).json({ message: 'userId does not exist.' })
    }
    return res.status(500).json({ message: 'Failed to create log.', detail: error.message })
  }
})

app.post('/api/camera/logs', requireCameraToken, async (req, res) => {
  const userId = req.body.userId ? Number(req.body.userId) : null
  const userNameSnapshot = String(req.body.userNameSnapshot || '').trim() || null
  const cameraId = String(req.body.cameraId || '').trim()
  const event = String(req.body.event || '').trim().toLowerCase()
  const confidence = req.body.confidence === undefined ? null : Number(req.body.confidence)
  const detectedAt = req.body.detectedAt ? String(req.body.detectedAt) : null

  if (!cameraId || !isValidEvent(event)) {
    return res.status(400).json({ message: 'cameraId and valid event are required.' })
  }

  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) {
    return res.status(400).json({ message: 'confidence must be a number from 0 to 100.' })
  }

  try {
    const inserted = await insertAttendanceLog({
      userId,
      userNameSnapshot,
      cameraId,
      event,
      confidence,
      detectedAt,
    })

    return res.status(201).json(inserted)
  } catch (error) {
    if (error.code === '23503') {
      return res.status(400).json({ message: 'userId does not exist.' })
    }
    return res.status(500).json({ message: 'Failed to create camera log.', detail: error.message })
  }
})

app.post('/api/camera/heartbeat', requireCameraToken, async (req, res) => {
  const cameraId = String(req.body.cameraId || '').trim()
  const seenAt = req.body.seenAt ? String(req.body.seenAt) : null

  if (!cameraId) {
    return res.status(400).json({ message: 'cameraId is required.' })
  }

  try {
    const camera = await upsertCameraHeartbeat(cameraId, seenAt)
    return res.json({
      ok: true,
      camera,
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update camera heartbeat.', detail: error.message })
  }
})

app.get('/api/dashboard/summary', ...requireAdmin, async (req, res) => {
  try {
    const [usersResult, logsResult] = await Promise.all([
      query(
        `SELECT
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_users,
          COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_users
        FROM users`
      ),
      query(
        `SELECT
          COUNT(*)::int AS total_logs,
          COUNT(*) FILTER (WHERE event = 'entry')::int AS entries,
          COUNT(*) FILTER (WHERE event = 'exit')::int AS exits,
          COUNT(*) FILTER (WHERE event = 'unrecognized')::int AS unrecognized
        FROM attendance_logs
        WHERE detected_at::date = CURRENT_DATE`
      ),
    ])

    return res.json({
      users: usersResult.rows[0],
      today: logsResult.rows[0],
    })
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard summary.', detail: error.message })
  }
})

app.post('/api/admin/face-enrollment', enrollmentUpload.array('images', 10), async (req, res) => {
  const sessionToken = String(req.headers['x-admin-session'] || req.body.sessionToken || '').trim()
  const userId = Number(req.body.userId)
  const files = Array.isArray(req.files) ? req.files : []

  if (!Number.isFinite(userId)) {
    return res.status(400).json({ message: 'userId is required.' })
  }

  if (files.length < 1 || files.length > 10) {
    return res.status(400).json({ message: 'Upload 1 to 10 face images for enrollment.' })
  }

  try {
    await assertAdminSession(sessionToken)

    const userResult = await query(
      `SELECT id, first_name, last_name, email
       FROM public.users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    )

    if (!userResult.rowCount) {
      return res.status(404).json({ message: 'User not found.' })
    }

    const enrollment = await saveEnrollmentImages(userResult.rows[0], files)
    const reloadResult = await reloadRecognitionDataset()

    return res.status(201).json({
      ok: true,
      userId,
      folderName: enrollment.folderName,
      imagesSaved: enrollment.imageCount,
      totalImages: enrollment.totalImages,
      reload: reloadResult,
    })
  } catch (error) {
    const statusCode = error.statusCode || 500
    return res.status(statusCode).json({
      message: error.message || 'Failed to enroll face images.',
    })
  }
})

app.get('/api/internal/face-enrollment-dataset', requireCameraToken, async (req, res) => {
  try {
    return res.json({
      ok: true,
      ...(await getFaceEnrollmentDatasetManifest()),
    })
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to load face enrollment dataset manifest.',
      detail: error.message,
    })
  }
})

app.post('/api/admin/delete-user', async (req, res) => {
  const sessionToken = String(req.headers['x-admin-session'] || req.body.sessionToken || '').trim()
  const userId = Number(req.body.userId)

  if (!Number.isFinite(userId)) {
    return res.status(400).json({ message: 'userId is required.' })
  }

  try {
    await assertAdminSession(sessionToken)

    const userResult = await query(
      `SELECT id, first_name, last_name, email
       FROM public.users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    )

    if (!userResult.rowCount) {
      return res.status(404).json({ message: 'User not found.' })
    }

    const userRow = userResult.rows[0]
    const deletedFolders = await removeEnrollmentDataset(userRow)

    await query(`DELETE FROM public.users WHERE id = $1`, [userId])

    const reloadResult = await reloadRecognitionDataset()

    return res.json({
      ok: true,
      id: userId,
      deletedFolders,
      reload: reloadResult,
    })
  } catch (error) {
    const statusCode = error.statusCode || 500
    return res.status(statusCode).json({
      message: error.message || 'Failed to delete user.',
    })
  }
})

app.get('/api/admin/fan-state', async (req, res) => {
  const sessionToken = String(req.headers['x-admin-session'] || req.query.sessionToken || '').trim()

  try {
    await assertAdminSession(sessionToken)

    const [fanState, sensorSnapshot] = await Promise.all([
      getFanStateRow(),
      getLatestSensorSnapshot('acebott-main-01'),
    ])

    return res.json({
      isOn: Boolean(fanState?.isOn),
      updatedAt: fanState?.updatedAt || null,
      updatedBy: fanState?.updatedBy || 'system',
      sensorSnapshot,
    })
  } catch (error) {
    const statusCode = error.statusCode || 500
    return res.status(statusCode).json({
      message: error.message || 'Failed to fetch fan state.',
    })
  }
})

app.post('/api/admin/fan-state', async (req, res) => {
  const sessionToken = String(req.headers['x-admin-session'] || req.body.sessionToken || '').trim()

  if (typeof req.body.isOn !== 'boolean') {
    return res.status(400).json({ message: 'isOn must be boolean.' })
  }

  const client = await pool.connect()

  try {
    const adminId = await assertAdminSession(sessionToken)
    const adminResult = await query(
      'SELECT username FROM admins WHERE id = $1 LIMIT 1',
      [adminId]
    )
    const updatedByLabel = adminResult.rows[0]?.username || `admin:${adminId}`

    await client.query('BEGIN')
    const fanState = await setFanStateWithClient(client, {
      isOn: req.body.isOn,
      updatedByUserId: null,
      updatedByLabel,
      forceEvent: true,
    })
    await client.query('COMMIT')

    return res.json(fanState)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const statusCode = error.statusCode || 500
    return res.status(statusCode).json({
      message: error.message || 'Failed to update fan state.',
    })
  } finally {
    client.release()
  }
})

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: 'Each face image must be 12 MB or smaller.',
      })
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        message: 'Upload up to 10 face images at a time.',
      })
    }

    return res.status(400).json({
      message: error.message || 'Face image upload failed.',
    })
  }

  if (error) {
    return res.status(500).json({
      message: error.message || 'Unexpected server error.',
    })
  }

  return next()
})

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' })
})

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in environment variables.')
  process.exit(1)
}

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in environment variables.')
  process.exit(1)
}

app.listen(port, () => {
  console.log(`face-api running on http://localhost:${port}`)
})
