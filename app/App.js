import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import MaterialCommunityIcons from './node_modules/expo/node_modules/@expo/vector-icons/MaterialCommunityIcons';
import {
  apiChangeUserPassword,
  apiGetFanStatus,
  apiGetSensorSnapshot,
  apiGetUserCameras,
  apiGetGlobalLogs,
  apiGetUserMe,
  apiGetUserNotifications,
  apiRemoveUserProfilePhoto,
  apiUploadUserProfilePhoto,
  apiUpdateUserProfile,
  apiSetFanStatus,
  apiUserLogin,
  apiUserLogout,
} from './src/api';
import { clearSession, loadAppInstalled, loadSession, saveAppInstalled, saveSession } from './src/storage';

const MENU_ITEMS = [
  { id: 'overview', label: 'Dashboard', icon: 'view-dashboard-outline' },
  { id: 'global', label: 'Fan Control', icon: 'fan' },
  { id: 'notifications', label: 'Alerts', icon: 'bell-outline' },
  { id: 'settings', label: 'Settings', icon: 'cog-outline' },
];
const APP_SENSOR_STALE_MS = 15000;

function isStandaloneWebApp() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return 'U';
  return parts.map((part) => part[0]?.toUpperCase() || '').join('');
}

function ProfileAvatar({ uri, name, size = 72, style }) {
  return (
    <View
      style={[
        styles.profileAvatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        style,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
        />
      ) : (
        <MaterialCommunityIcons
          name="account"
          size={Math.round(size * 0.45)}
          color="#0f6a45"
        />
      )}
    </View>
  );
}

function LoginScreen({ busy, error, onLogin }) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const canSubmit = identity.trim().length > 0 && password.length > 0 && !busy;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.loginRoot} keyboardShouldPersistTaps="handled">
        <View style={styles.loginBgOverlay} />
        <Image source={require('./assets/ptc-logo.png')} style={styles.loginBgLogo} blurRadius={2} />
        <View style={styles.loginCard}>
          <Text style={styles.brandTitle}>PTC Smart Faculty Office</Text>
          <Text style={styles.loginSubtitle}>User Login</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Username or Email</Text>
            <TextInput
              value={identity}
              onChangeText={setIdentity}
              placeholder="Enter Username or Email"
              placeholderTextColor="#7d8d96"
              style={styles.input}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor="#7d8d96"
              style={styles.input}
              secureTextEntry
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            style={[styles.primaryButton, !canSubmit && styles.disabledButton]}
            onPress={() => onLogin(identity, password)}
            disabled={!canSubmit}
          >
            {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Log In</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InstallGuideScreen({
  installReady,
  installBusy,
  onInstall,
  onSkip,
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.installGuideScroll}>
        <View style={styles.installGuideHero}>
          <Image source={require('./assets/ptc-logo.png')} style={styles.installGuideLogo} />
          <Text style={styles.installGuideEyebrow}>PTC User App</Text>
          <Text style={styles.installGuideTitle}>Install the app before logging in.</Text>
          <Text style={styles.installGuideLead}>
            This app works as a PWA. Install it on your phone or desktop so it opens like a normal app.
          </Text>
        </View>

        <View style={styles.installGuidePanel}>
          <Text style={styles.installGuidePanelTitle}>Quick Steps</Text>
          <View style={styles.installGuideStep}>
            <Text style={styles.installGuideStepNumber}>1</Text>
            <Text style={styles.installGuideStepText}>Tap the install button below or use your browser menu.</Text>
          </View>
          <View style={styles.installGuideStep}>
            <Text style={styles.installGuideStepNumber}>2</Text>
            <Text style={styles.installGuideStepText}>Add the app to your home screen or desktop.</Text>
          </View>
          <View style={styles.installGuideStep}>
            <Text style={styles.installGuideStepNumber}>3</Text>
            <Text style={styles.installGuideStepText}>After install, open the app from your home screen or desktop.</Text>
          </View>
        </View>

        <View style={styles.installGuidePanel}>
          <Text style={styles.installGuidePanelTitle}>Browser Guide</Text>
          <Text style={styles.installGuidePlatformTitle}>Chrome or Edge on Desktop</Text>
          <Text style={styles.installGuidePlatformText}>
            Look for the install icon in the address bar, or open the browser menu and choose Install app.
          </Text>

          <Text style={styles.installGuidePlatformTitle}>Android Chrome</Text>
          <Text style={styles.installGuidePlatformText}>
            Open the three-dot menu, then tap Install app or Add to Home screen.
          </Text>

          <Text style={styles.installGuidePlatformTitle}>iPhone Safari</Text>
          <Text style={styles.installGuidePlatformText}>
            Tap Share, then choose Add to Home Screen.
          </Text>
        </View>

        <View style={styles.installGuideActions}>
          <Pressable
            style={[
              styles.primaryButton,
              styles.installActionButton,
              (!installReady || installBusy) && styles.disabledButton,
            ]}
            onPress={onInstall}
            disabled={!installReady || installBusy}
          >
            {installBusy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {installReady ? 'Install App' : 'Install Option Not Available Here'}
              </Text>
            )}
          </Pressable>

          <Pressable style={styles.installSkipButton} onPress={onSkip}>
            <Text style={styles.installSkipButtonText}>Skip for now</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function GlyphTile({ label, icon, accent = '#35c76c', background = '#e7f9ee', textColor = '#29a757' }) {
  return (
    <View style={[styles.glyphTile, { backgroundColor: background, borderColor: `${accent}20` }]}>
      {icon ? (
        <MaterialCommunityIcons name={icon} size={20} color={textColor} />
      ) : (
        <Text style={[styles.glyphTileText, { color: textColor }]}>{label}</Text>
      )}
    </View>
  );
}

function VitalCard({
  glyph,
  icon,
  title,
  value,
  hint,
  badge,
  accent = '#35c76c',
  background = '#e7f9ee',
  textColor = '#29a757',
  cardBackground = '#ffffff',
  cardBorderColor = '#e2ebe5',
}) {
  return (
    <View style={[styles.vitalCard, { backgroundColor: cardBackground, borderColor: cardBorderColor }]}>
      <GlyphTile
        label={glyph}
        icon={icon}
        accent="#35c76c"
        background="#e7f9ee"
        textColor="#29a757"
      />
      <View style={styles.vitalTextWrap}>
        <View style={styles.vitalHeaderRow}>
          <Text style={styles.vitalTitle}>{title}</Text>
          {badge ? (
            <View style={[styles.vitalBadge, { backgroundColor: background, borderColor: `${accent}22` }]}>
              <Text style={[styles.vitalBadgeText, { color: textColor }]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.vitalValue}>{value}</Text>
        {hint ? <Text style={styles.vitalHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function DashboardChip({ icon, text }) {
  return (
    <View style={styles.dashboardChip}>
      <MaterialCommunityIcons name={icon} size={14} color="#dff7e7" />
      <Text style={styles.dashboardChipText}>{text}</Text>
    </View>
  );
}

function DashboardPage({ profile, globalLogs, fanState, cameras, sensorSnapshot }) {
  const { width } = useWindowDimensions();
  const useTwoColumns = width >= 680;
  const onlineCount = cameras.filter((camera) => camera.status === 'online').length;
  const displayName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || 'User Account';

  const latestRecognized = useMemo(
    () => globalLogs.find((log) => log.event === 'entry' || log.event === 'exit') || null,
    [globalLogs]
  );

  const latestDetectedAt = useMemo(() => {
    const cameraTimes = cameras
      .map((camera) => camera.lastDetectedAt)
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => !Number.isNaN(value));

    const logTimes = globalLogs
      .map((log) => log.detectedAt)
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => !Number.isNaN(value));

    const values = [...cameraTimes, ...logTimes];
    if (!values.length) return null;
    return new Date(Math.max(...values)).toISOString();
  }, [cameras, globalLogs]);

  const officeStatus = useMemo(() => {
    if (latestRecognized?.event === 'entry') return 'Occupied';
    if (latestRecognized?.event === 'exit') return 'Vacant';
    if (onlineCount > 0) return 'Monitoring';
    return 'Offline';
  }, [latestRecognized?.event, onlineCount]);

  const motionDetected = Boolean(sensorSnapshot?.pirState);
  const sensorUpdatedAt = sensorSnapshot?.createdAt || latestDetectedAt;
  const sensorSnapshotTime = sensorSnapshot?.createdAt ? new Date(sensorSnapshot.createdAt).getTime() : NaN;
  const fanUpdatedTime = fanState?.updatedAt ? new Date(fanState.updatedAt).getTime() : NaN;
  const hasFreshSensorData = Number.isFinite(sensorSnapshotTime) && Date.now() - sensorSnapshotTime <= APP_SENSOR_STALE_MS;
  const hasFreshFanState = Number.isFinite(fanUpdatedTime) && Date.now() - fanUpdatedTime <= APP_SENSOR_STALE_MS;
  const hasTemperature = Number.isFinite(sensorSnapshot?.temperatureC);
  const hasHumidity = Number.isFinite(sensorSnapshot?.humidity);

  const positiveTone = {
    accent: '#1ea764',
    background: '#eaf8ef',
    textColor: '#1b9b59',
    cardBackground: '#fbfefb',
    cardBorderColor: '#dceee2',
  };

  const neutralTone = {
    accent: '#2596c8',
    background: '#e8f7ff',
    textColor: '#1b85b5',
    cardBackground: '#fbfeff',
    cardBorderColor: '#d9edf7',
  };

  const negativeTone = {
    accent: '#d9534f',
    background: '#fff0ef',
    textColor: '#c94743',
    cardBackground: '#fffafa',
    cardBorderColor: '#f2dcda',
  };

  const dashboardCards = [
    {
      key: 'temp',
      icon: 'thermometer',
      title: 'Temperature',
      value: hasFreshSensorData && hasTemperature ? `${sensorSnapshot.temperatureC.toFixed(1)} °C` : 'No live data',
      hint: hasFreshSensorData
        ? `Updated ${formatDateTime(sensorUpdatedAt)}`
        : 'Acebott is offline or stale',
      badge: hasFreshSensorData && hasTemperature ? 'Live' : 'Offline',
      ...(hasFreshSensorData && hasTemperature ? neutralTone : negativeTone),
    },
    {
      key: 'humidity',
      icon: 'water-percent',
      title: 'Humidity',
      value: hasFreshSensorData && hasHumidity ? `${sensorSnapshot.humidity.toFixed(1)} %` : 'No live data',
      hint: hasFreshSensorData
        ? `Updated ${formatDateTime(sensorUpdatedAt)}`
        : 'Acebott is offline or stale',
      badge: hasFreshSensorData && hasHumidity ? 'Live' : 'Offline',
      ...(hasFreshSensorData && hasHumidity ? neutralTone : negativeTone),
    },
    {
      key: 'motion',
      icon: 'motion-sensor',
      title: 'Motion',
      value: hasFreshSensorData ? (motionDetected ? 'Motion detected' : 'No motion') : 'No live motion',
      hint: hasFreshSensorData
        ? `Updated ${formatDateTime(sensorUpdatedAt)}`
        : 'No recent PIR heartbeat',
      badge: hasFreshSensorData ? (motionDetected ? 'Active' : 'Idle') : 'Offline',
      ...(hasFreshSensorData ? (motionDetected ? positiveTone : neutralTone) : negativeTone),
    },
    {
      key: 'fan',
      icon: 'fan',
      title: 'Fan Status',
      value: hasFreshFanState ? (fanState?.isOn ? 'Fan ON' : 'Fan OFF') : 'No live fan data',
      hint: hasFreshFanState
        ? `Updated ${formatDateTime(fanState.updatedAt)}`
        : 'No recent fan sync',
      badge: hasFreshFanState ? (fanState?.isOn ? 'Running' : 'Standby') : 'Offline',
      ...(hasFreshFanState ? (fanState?.isOn ? positiveTone : neutralTone) : negativeTone),
    },
  ];

  return (
    <>
      <View style={styles.dashboardHero}>
        <View style={styles.dashboardHeroTop}>
          <View style={styles.dashboardHeroCopy}>
            <Text style={styles.dashboardHeroEyebrow}>Faculty Office Monitor</Text>
            <Text style={styles.dashboardHeroTitle}>{officeStatus}</Text>
            <Text style={styles.dashboardHeroLead}>
              {latestDetectedAt
                ? `Latest activity ${formatDateTime(latestDetectedAt)}`
                : 'Waiting for fresh detections from your devices'}
            </Text>
          </View>
          <View style={styles.dashboardHeroProfile}>
            <ProfileAvatar uri={profile?.profileImageUrl} name={displayName} size={68} />
            <Text style={styles.dashboardHeroProfileName}>{displayName}</Text>
          </View>
        </View>

        <View style={styles.dashboardHeroChips}>
          <DashboardChip icon="cctv" text={`${onlineCount} camera${onlineCount === 1 ? '' : 's'} online`} />
          <DashboardChip icon="fan" text={hasFreshFanState ? (fanState?.isOn ? 'Fan active' : 'Fan idle') : 'Fan stale'} />
          <DashboardChip icon="motion-sensor" text={hasFreshSensorData ? (motionDetected ? 'Motion live' : 'No motion') : 'Motion stale'} />
        </View>
      </View>

      <View style={[styles.dashboardPanel, useTwoColumns && styles.dashboardPanelWide]}>
        {dashboardCards.map((card) => (
          <View key={card.key} style={[styles.dashboardPanelItem, useTwoColumns && styles.dashboardPanelItemHalf]}>
            <VitalCard
              icon={card.icon}
              title={card.title}
              value={card.value}
              hint={card.hint}
              badge={card.badge}
              accent={card.accent}
              background={card.background}
              textColor={card.textColor}
              cardBackground={card.cardBackground}
              cardBorderColor={card.cardBorderColor}
            />
          </View>
        ))}
      </View>

    </>
  );
}

function GlobalPage({ fanState, fanBusy, onToggleFan, cameras, sensorSnapshot }) {
  return (
    <>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Main Fan</Text>
        <View style={styles.controlStatusCard}>
          <View style={styles.controlStatusRow}>
            <GlyphTile icon="fan" />
            <View style={styles.controlStatusCopy}>
              <Text style={styles.controlStatusValue}>{fanState?.isOn ? 'Fan ON' : 'Fan OFF'}</Text>
              <Text style={styles.controlStatusMeta}>
                {fanState?.updatedAt ? `Last changed ${formatDateTime(fanState.updatedAt)}` : 'No updates yet'}
              </Text>
              <Text style={styles.controlStatusMeta}>Updated by {fanState?.updatedBy || 'system'}</Text>
            </View>
          </View>

          <View style={styles.fanToggleWrap}>
            {fanBusy ? <ActivityIndicator size="small" color="#2dbf67" /> : null}
            <Switch
              value={Boolean(fanState?.isOn)}
              onValueChange={onToggleFan}
              disabled={fanBusy}
              trackColor={{ false: '#d4ddd7', true: '#9ae0b4' }}
              thumbColor={fanState?.isOn ? '#1c8f4e' : '#f8fbf8'}
              ios_backgroundColor="#d4ddd7"
            />
          </View>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Sensor Snapshot</Text>
        <View style={styles.deviceRow}>
          <GlyphTile icon="motion-sensor" />
          <View style={styles.deviceRowCopy}>
            <Text style={styles.deviceName}>
              {sensorSnapshot?.pirState ? 'Motion detected' : 'No motion'}
            </Text>
            <Text style={styles.deviceMeta}>
              {sensorSnapshot?.createdAt
                ? `Updated ${formatDateTime(sensorSnapshot.createdAt)}`
                : 'Waiting for Acebott sensor log'}
            </Text>
            <Text style={styles.deviceMeta}>
              Temperature:{' '}
              {Number.isFinite(sensorSnapshot?.temperatureC)
                ? `${sensorSnapshot.temperatureC.toFixed(1)} °C`
                : 'N/A'}
              {'  '}|{'  '}
              Humidity:{' '}
              {Number.isFinite(sensorSnapshot?.humidity)
                ? `${sensorSnapshot.humidity.toFixed(1)} %`
                : 'N/A'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Connected Cameras</Text>
        {cameras.length === 0 ? (
          <Text style={styles.emptyText}>No camera records yet.</Text>
        ) : (
          cameras.map((camera) => (
            <View key={camera.cameraId} style={styles.deviceRow}>
              <GlyphTile icon="cctv" />
              <View style={styles.deviceRowCopy}>
                <Text style={styles.deviceName}>{camera.cameraId}</Text>
                <Text style={styles.deviceMeta}>{camera.area || 'Connected camera'}</Text>
                <Text style={styles.deviceMeta}>
                  {String(camera.status || 'offline').toUpperCase()}
                  {camera.lastDetectedAt ? ` • ${formatDateTime(camera.lastDetectedAt)}` : ''}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </>
  );
}

function NotificationsPage({ notifications, viewedNotificationIds, onViewNotification, onMarkAllNotificationsRead }) {
  function getNotificationTone(item) {
    const haystack = `${item?.title || ''} ${item?.message || ''} ${item?.type || ''}`.toLowerCase();

    if (haystack.includes('off') || haystack.includes('alert') || haystack.includes('warning')) {
      return {
        icon: 'alert-circle-outline',
        badge: 'Alert',
        accent: '#d9534f',
        soft: '#fff0ef',
        text: '#c94743',
      };
    }

    if (haystack.includes('on') || haystack.includes('success') || haystack.includes('updated')) {
      return {
        icon: 'check-circle-outline',
        badge: 'Update',
        accent: '#1ea764',
        soft: '#eaf8ef',
        text: '#1b9b59',
      };
    }

    return {
      icon: 'bell-outline',
      badge: 'Notice',
      accent: '#2596c8',
      soft: '#e8f7ff',
      text: '#1b85b5',
    };
  }

  return (
    <View style={styles.panel}>
      <View style={styles.notificationsHead}>
        <View>
          <Text style={styles.panelTitle}>Notifications</Text>
          <Text style={styles.notificationsSubhead}>
            {notifications.length} recent {notifications.length === 1 ? 'update' : 'updates'}
          </Text>
        </View>
        <Pressable
          style={styles.notificationsCounter}
          onPress={onMarkAllNotificationsRead}
          disabled={notifications.length === 0}
        >
          <MaterialCommunityIcons name="bell-check-outline" size={18} color="#1b9b59" />
        </Pressable>
      </View>
      {notifications.length === 0 ? (
        <Text style={styles.emptyText}>No notifications yet.</Text>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => String(item.id)}
          scrollEnabled={false}
          ItemSeparatorComponent={() => <View style={styles.listGap} />}
          renderItem={({ item }) => {
            const tone = getNotificationTone(item);

            const isViewed = viewedNotificationIds.includes(item.id);

            return (
              <Pressable
                style={[styles.notificationCard, isViewed && styles.notificationCardViewed]}
                onPress={() => onViewNotification(item.id)}
              >
                <View
                  style={[
                    styles.notificationIconWrap,
                    styles.notificationCardNoSelect,
                    isViewed && styles.notificationIconWrapViewed,
                    { backgroundColor: tone.soft, borderColor: `${tone.accent}22` },
                  ]}
                >
                  <MaterialCommunityIcons name={tone.icon} size={18} color={tone.text} />
                </View>

                <View style={styles.notificationBody}>
                  <View style={styles.notificationTopRow}>
                    <Text
                      selectable={false}
                      style={[styles.notificationTitle, styles.notificationCardNoSelect, isViewed && styles.notificationTitleViewed]}
                    >
                      {item.title}
                    </Text>
                    <View
                      style={[
                        styles.notificationBadge,
                        isViewed && styles.notificationBadgeViewed,
                        { backgroundColor: tone.soft, borderColor: `${tone.accent}22` },
                      ]}
                    >
                      <Text
                        selectable={false}
                        style={[
                          styles.notificationBadgeText,
                          styles.notificationCardNoSelect,
                          { color: tone.text },
                          isViewed && styles.notificationBadgeTextViewed,
                        ]}
                      >
                        {tone.badge}
                      </Text>
                    </View>
                  </View>
                  <Text
                    selectable={false}
                    style={[
                      styles.notificationMessage,
                      styles.notificationCardNoSelect,
                      isViewed && styles.notificationMessageViewed,
                    ]}
                  >
                    {item.message}
                  </Text>
                  <View style={styles.notificationMetaRow}>
                    <Text
                      selectable={false}
                      style={[styles.notificationTime, styles.notificationCardNoSelect, isViewed && styles.notificationMetaViewed]}
                    >
                      {formatDateTime(item.at)}
                    </Text>
                    <Text
                      selectable={false}
                      style={[styles.notificationMetaDot, styles.notificationCardNoSelect, isViewed && styles.notificationMetaViewed]}
                    >
                      •
                    </Text>
                    <Text
                      selectable={false}
                      style={[styles.notificationMetaLabel, styles.notificationCardNoSelect, isViewed && styles.notificationMetaViewed]}
                    >
                      PTC User App
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function SettingsField({
  icon,
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
  keyboardType,
  secureTextEntry,
  editable = true,
}) {
  return (
    <View style={[styles.settingsFieldCard, !editable && styles.settingsFieldCardLocked]}>
      <View style={styles.settingsFieldIcon}>
        <MaterialCommunityIcons name={icon} size={18} color="#20995a" />
      </View>
      <View style={styles.settingsFieldBody}>
        <Text style={styles.settingsFieldLabel}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          style={[styles.settingsFieldInput, !editable && styles.settingsFieldInputLocked]}
          placeholder={placeholder}
          placeholderTextColor="#89a092"
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          editable={editable}
          selectTextOnFocus={editable}
        />
      </View>
    </View>
  );
}

function SettingsPage({
  profileForm,
  passwordForm,
  settingsBusy,
  settingsFeedback,
  settingsFeedbackTarget,
  profileImagePreviewUrl,
  onChangeProfileField,
  onChangePasswordField,
  onPickProfileImage,
  onRemoveProfileImage,
  onResetProfileImageState,
  onResetProfileForm,
  onResetPasswordForm,
  onClearSettingsFeedback,
  onSaveProfile,
  onChangePassword,
  onLogout,
}) {
  const { width } = useWindowDimensions();
  const useTwoColumns = width >= 720;
  const displayName = `${profileForm.firstName || ''} ${profileForm.lastName || ''}`.trim() || 'User Account';
  const [profileEditing, setProfileEditing] = useState(false);
  const [passwordEditing, setPasswordEditing] = useState(false);
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [passwordSnapshot, setPasswordSnapshot] = useState(null);

  function handleToggleProfileEditing() {
    if (settingsBusy) return;

    if (profileEditing) {
      if (profileSnapshot) {
        onResetProfileForm(profileSnapshot);
      }
      onResetProfileImageState();
      onClearSettingsFeedback();
      setProfileEditing(false);
      return;
    }

    setProfileSnapshot({ ...profileForm });
    onClearSettingsFeedback();
    setProfileEditing(true);
  }

  function handleTogglePasswordEditing() {
    if (settingsBusy) return;

    if (passwordEditing) {
      onResetPasswordForm(passwordSnapshot || { currentPassword: '', newPassword: '', confirmPassword: '' });
      onClearSettingsFeedback();
      setPasswordEditing(false);
      return;
    }

    setPasswordSnapshot({ ...passwordForm });
    onClearSettingsFeedback();
    setPasswordEditing(true);
  }

  async function handleSaveProfilePress() {
    const ok = await onSaveProfile();
    if (ok) {
      setProfileSnapshot(null);
      setProfileEditing(false);
    }
  }

  async function handleSavePasswordPress() {
    const ok = await onChangePassword();
    if (ok) {
      setPasswordSnapshot(null);
      setPasswordEditing(false);
    }
  }

  return (
    <>
      <View style={styles.settingsHero}>
        <ProfileAvatar uri={profileImagePreviewUrl} name={displayName} size={88} />
        <View style={styles.settingsHeroCopy}>
          <View style={styles.settingsHeroTopRow}>
            <Text style={styles.settingsHeroEyebrow}>Account Settings</Text>
            <Pressable style={styles.settingsHeroLogoutButton} onPress={onLogout}>
              <MaterialCommunityIcons name="logout-variant" size={16} color="#ffffff" />
            </Pressable>
          </View>
          <Text style={styles.settingsHeroName}>{displayName}</Text>
          <Text style={styles.settingsHeroMeta}>{profileForm.email || profileForm.username || 'No email on file'}</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.settingsSectionHead}>
          <View style={styles.settingsSectionBadge}>
            <MaterialCommunityIcons name="account-edit-outline" size={18} color="#1d8d52" />
          </View>
          <View style={styles.settingsSectionCopy}>
            <Text style={[styles.panelTitle, styles.settingsSectionTitle]}>Profile</Text>
            <Text style={styles.settingsHint}>Keep your personal details up to date.</Text>
          </View>
          <Pressable
            style={styles.settingsEditButton}
            onPress={handleToggleProfileEditing}
            disabled={settingsBusy}
          >
            <MaterialCommunityIcons
              name={profileEditing ? 'close' : 'pencil-outline'}
              size={16}
              color="#87978f"
            />
          </Pressable>
        </View>

        <View style={[styles.settingsFieldGrid, useTwoColumns && styles.settingsFieldGridWide]}>
          <View style={styles.settingsFieldSlot}>
            <View style={styles.settingsPhotoCard}>
              <View style={styles.settingsPhotoPreviewWrap}>
                <ProfileAvatar uri={profileImagePreviewUrl} name={displayName} size={84} />
                {profileEditing ? (
                  <View style={styles.settingsPhotoActions}>
                    <Pressable
                      style={[styles.settingsPhotoButton, settingsBusy && styles.disabledButton]}
                      onPress={onPickProfileImage}
                      disabled={settingsBusy}
                    >
                      <MaterialCommunityIcons name="image-plus" size={16} color="#ffffff" />
                      <Text style={styles.settingsPhotoButtonText}>Choose Photo</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.settingsPhotoButtonGhost, settingsBusy && styles.disabledButton]}
                      onPress={onRemoveProfileImage}
                      disabled={settingsBusy}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={16} color="#d65c57" />
                      <Text style={styles.settingsPhotoButtonGhostText}>Remove</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          <View style={[styles.settingsFieldSlot, useTwoColumns && styles.settingsFieldSlotHalf]}>
            <SettingsField
              icon="account-outline"
              label="First Name"
              value={profileForm.firstName}
              onChangeText={(value) => onChangeProfileField('firstName', value)}
              placeholder="First name"
              editable={profileEditing}
            />
          </View>

          <View style={[styles.settingsFieldSlot, useTwoColumns && styles.settingsFieldSlotHalf]}>
            <SettingsField
              icon="account-outline"
              label="Last Name"
              value={profileForm.lastName}
              onChangeText={(value) => onChangeProfileField('lastName', value)}
              placeholder="Last name"
              editable={profileEditing}
            />
          </View>

          <View style={[styles.settingsFieldSlot, useTwoColumns && styles.settingsFieldSlotHalf]}>
            <SettingsField
              icon="at"
              label="Username"
              value={profileForm.username}
              onChangeText={(value) => onChangeProfileField('username', value)}
              placeholder="Username"
              autoCapitalize="none"
              editable={profileEditing}
            />
          </View>

          <View style={[styles.settingsFieldSlot, useTwoColumns && styles.settingsFieldSlotHalf]}>
            <SettingsField
              icon="email-outline"
              label="Email"
              value={profileForm.email}
              onChangeText={(value) => onChangeProfileField('email', value)}
              placeholder="Email address"
              autoCapitalize="none"
              keyboardType="email-address"
              editable={profileEditing}
            />
          </View>
        </View>

        {profileEditing ? (
          <Pressable style={[styles.formAction, settingsBusy && styles.disabledButton]} onPress={handleSaveProfilePress}>
            {settingsBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.formActionText}>Save Profile Changes</Text>
            )}
          </Pressable>
        ) : null}

        {settingsFeedbackTarget === 'profile' && settingsFeedback.text ? (
          <Text
            style={settingsFeedback.type === 'success' ? styles.settingsSuccessText : styles.settingsErrorText}
          >
            {settingsFeedback.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.panel}>
        <View style={styles.settingsSectionHead}>
          <View style={styles.settingsSectionBadge}>
            <MaterialCommunityIcons name="shield-lock-outline" size={18} color="#1d8d52" />
          </View>
          <View style={styles.settingsSectionCopy}>
            <Text style={[styles.panelTitle, styles.settingsSectionTitle]}>Security</Text>
            <Text style={styles.settingsHint}>Change your password and keep your account protected.</Text>
          </View>
          <Pressable
            style={styles.settingsEditButton}
            onPress={handleTogglePasswordEditing}
            disabled={settingsBusy}
          >
            <MaterialCommunityIcons
              name={passwordEditing ? 'close' : 'pencil-outline'}
              size={16}
              color="#87978f"
            />
          </Pressable>
        </View>

        <View style={styles.settingsSecurityNote}>
          <MaterialCommunityIcons name="information-outline" size={16} color="#1b85b5" />
          <Text style={styles.settingsSecurityNoteText}>Use at least 6 characters and avoid reusing old passwords.</Text>
        </View>

        <SettingsField
          icon="lock-outline"
          label="Current Password"
          value={passwordForm.currentPassword}
          onChangeText={(value) => onChangePasswordField('currentPassword', value)}
          placeholder="Current password"
          secureTextEntry
          editable={passwordEditing}
        />

        <SettingsField
          icon="key-outline"
          label="New Password"
          value={passwordForm.newPassword}
          onChangeText={(value) => onChangePasswordField('newPassword', value)}
          placeholder="At least 6 characters"
          secureTextEntry
          editable={passwordEditing}
        />

        <SettingsField
          icon="shield-check-outline"
          label="Confirm New Password"
          value={passwordForm.confirmPassword}
          onChangeText={(value) => onChangePasswordField('confirmPassword', value)}
          placeholder="Confirm new password"
          secureTextEntry
          editable={passwordEditing}
        />

        {passwordEditing ? (
          <Pressable style={[styles.formAction, settingsBusy && styles.disabledButton]} onPress={handleSavePasswordPress}>
            {settingsBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.formActionText}>Save Password Changes</Text>
            )}
          </Pressable>
        ) : null}

        {settingsFeedbackTarget === 'password' && settingsFeedback.text ? (
          <Text
            style={settingsFeedback.type === 'success' ? styles.settingsSuccessText : styles.settingsErrorText}
          >
            {settingsFeedback.text}
          </Text>
        ) : null}
      </View>

    </>
  );
}

function MainScreen({
  profile,
  globalLogs,
  cameras,
  notifications,
  viewedNotificationIds,
  fanState,
  sensorSnapshot,
  fanBusy,
  currentPage,
  onNavigate,
  onViewNotification,
  onToggleFan,
  profileForm,
  passwordForm,
  settingsBusy,
  settingsFeedback,
  settingsFeedbackTarget,
  profileImagePreviewUrl,
  onChangeProfileField,
  onChangePasswordField,
  onPickProfileImage,
  onRemoveProfileImage,
  onResetProfileImageState,
  onResetProfileForm,
  onResetPasswordForm,
  onClearSettingsFeedback,
  onSaveProfile,
  onChangePassword,
  onLogout,
  appError,
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.mainShell}>
        <ScrollView style={styles.pageScroll} contentContainerStyle={styles.appContainer}>
          {appError ? <Text style={styles.errorText}>{appError}</Text> : null}

          {currentPage === 'overview' ? (
            <DashboardPage
              profile={profile}
              globalLogs={globalLogs}
              fanState={fanState}
              cameras={cameras}
              sensorSnapshot={sensorSnapshot}
            />
          ) : null}
          {currentPage === 'global' ? (
            <GlobalPage
              fanState={fanState}
              fanBusy={fanBusy}
              onToggleFan={onToggleFan}
              cameras={cameras}
              sensorSnapshot={sensorSnapshot}
            />
          ) : null}
          {currentPage === 'notifications' ? (
            <NotificationsPage
              notifications={notifications}
              viewedNotificationIds={viewedNotificationIds}
              onViewNotification={onViewNotification}
              onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
            />
          ) : null}
          {currentPage === 'settings' ? (
            <SettingsPage
              profileForm={profileForm}
              passwordForm={passwordForm}
              settingsBusy={settingsBusy}
              settingsFeedback={settingsFeedback}
              settingsFeedbackTarget={settingsFeedbackTarget}
              profileImagePreviewUrl={profileImagePreviewUrl}
              onChangeProfileField={onChangeProfileField}
              onChangePasswordField={onChangePasswordField}
              onPickProfileImage={onPickProfileImage}
              onRemoveProfileImage={onRemoveProfileImage}
              onResetProfileImageState={onResetProfileImageState}
              onResetProfileForm={onResetProfileForm}
              onResetPasswordForm={onResetPasswordForm}
              onClearSettingsFeedback={onClearSettingsFeedback}
              onSaveProfile={onSaveProfile}
              onChangePassword={onChangePassword}
              onLogout={onLogout}
            />
          ) : null}
        </ScrollView>

        <View style={styles.bottomNav}>
          {MENU_ITEMS.map((item) => (
            <Pressable
              key={item.id}
              style={styles.bottomNavItem}
              onPress={() => onNavigate(item.id)}
            >
              <View style={[styles.bottomNavIcon, currentPage === item.id && styles.bottomNavIconActive]}>
                <MaterialCommunityIcons
                  name={item.icon}
                  size={18}
                  color={currentPage === item.id ? '#2dbf67' : '#8a9690'}
                />
              </View>
              <Text style={[styles.bottomNavText, currentPage === item.id && styles.bottomNavTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [auth, setAuth] = useState({ token: null });
  const [showInstallGuide, setShowInstallGuide] = useState(() => !isStandaloneWebApp());
  const [installReady, setInstallReady] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [profile, setProfile] = useState(null);
  const [globalLogs, setGlobalLogs] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [viewedNotificationIds, setViewedNotificationIds] = useState([]);
  const [fanState, setFanState] = useState({ isOn: false, updatedAt: null, updatedBy: null });
  const [sensorSnapshot, setSensorSnapshot] = useState({
    deviceKey: 'acebott-main-01',
    pirState: false,
    fanIsOn: false,
    temperatureC: null,
    humidity: null,
    createdAt: null,
    fanUpdatedAt: null,
    fanUpdatedBy: null,
  });

  const [currentPage, setCurrentPage] = useState('overview');
  const [loginBusy, setLoginBusy] = useState(false);
  const [fanBusy, setFanBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [appError, setAppError] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState({ type: '', text: '' });
  const [settingsFeedbackTarget, setSettingsFeedbackTarget] = useState('');
  const [profileImageDraft, setProfileImageDraft] = useState(null);
  const [profileImageRemoved, setProfileImageRemoved] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    profileImageUrl: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  async function refreshProfile(token) {
    const data = await apiGetUserMe(token);
    setProfile(data);
    return data;
  }

  async function refreshGlobal(token) {
    const [logs, fan, cameraRows, sensor] = await Promise.all([
      apiGetGlobalLogs(token, 120),
      apiGetFanStatus(token),
      apiGetUserCameras(token),
      apiGetSensorSnapshot(token),
    ]);
    setGlobalLogs(logs);
    setFanState(fan);
    setCameras(cameraRows);
    setSensorSnapshot(sensor);
    return { logs, fan, cameraRows, sensor };
  }

  async function refreshNotifications(token) {
    const data = await apiGetUserNotifications(token, 80);
    setNotifications(data);
    return data;
  }

  function handleViewNotification(notificationId) {
    setViewedNotificationIds((current) =>
      current.includes(notificationId) ? current : [...current, notificationId]
    );
  }

  function handleMarkAllNotificationsRead() {
    setViewedNotificationIds(notifications.map((item) => item.id));
  }

  async function hydrateSession(token) {
    const [me] = await Promise.all([
      refreshProfile(token),
      refreshGlobal(token),
      refreshNotifications(token),
    ]);
    await saveSession({ token, user: me });
    setAuth({ token });
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        const appInstalled = await loadAppInstalled();
        setShowInstallGuide(!(isStandaloneWebApp() || appInstalled));
        const session = await loadSession();
        if (!session?.token) {
          return;
        }
        await hydrateSession(session.token);
      } catch {
        await clearSession();
      } finally {
        setBooting(false);
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return undefined;
    }

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPromptEvent(event);
      setInstallReady(true);
    }

    function handleAppInstalled() {
      saveAppInstalled().catch(() => {});
      setInstallPromptEvent(null);
      setInstallReady(false);
      setShowInstallGuide(false);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    setProfileForm({
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      username: profile.username || '',
      email: profile.email || '',
      profileImageUrl: profile.profileImageUrl || '',
    });
    setProfileImageDraft(null);
    setProfileImageRemoved(false);
  }, [profile?.id, profile?.firstName, profile?.lastName, profile?.username, profile?.email, profile?.profileImageUrl]);

  useEffect(() => {
    if (!auth.token) {
      return undefined;
    }

    let disposed = false;

    const refreshRealtime = async () => {
      try {
        await refreshGlobal(auth.token);
      } catch (error) {
        if (!disposed) {
          setAppError(error.message || 'Failed to refresh latest device data.');
        }
      }
    };

    const realtimeIntervalId = setInterval(() => {
      if (Platform.OS === 'web' && typeof document !== 'undefined' && document.hidden) {
        return;
      }
      void refreshRealtime();
    }, 2500);

    const notificationIntervalId = setInterval(() => {
      if (Platform.OS === 'web' && typeof document !== 'undefined' && document.hidden) {
        return;
      }
      if (currentPage !== 'notifications') {
        return;
      }
      void refreshNotifications(auth.token).catch(() => {});
    }, 12000);

    return () => {
      disposed = true;
      clearInterval(realtimeIntervalId);
      clearInterval(notificationIntervalId);
    };
  }, [auth.token, currentPage]);

  async function handleLogin(identity, password) {
    setLoginBusy(true);
    setLoginError('');
    try {
      const data = await apiUserLogin(identity, password);
      await hydrateSession(data.token);
      setCurrentPage('overview');
    } catch (error) {
      setLoginError(error.message || 'Login failed.');
    } finally {
      setLoginBusy(false);
    }
  }

  function handleChangeProfileField(field, value) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  function handleChangePasswordField(field, value) {
    setPasswordForm((current) => ({ ...current, [field]: value }));
  }

  function handleResetProfileForm(nextForm) {
    setProfileForm({
      firstName: nextForm?.firstName || '',
      lastName: nextForm?.lastName || '',
      username: nextForm?.username || '',
      email: nextForm?.email || '',
      profileImageUrl: nextForm?.profileImageUrl || '',
    });
  }

  function handleResetProfileImageState() {
    setProfileImageDraft(null);
    setProfileImageRemoved(false);
  }

  function handleResetPasswordForm(nextForm) {
    setPasswordForm({
      currentPassword: nextForm?.currentPassword || '',
      newPassword: nextForm?.newPassword || '',
      confirmPassword: nextForm?.confirmPassword || '',
    });
  }

  function handleClearSettingsFeedback() {
    setSettingsFeedback({ type: '', text: '' });
    setSettingsFeedbackTarget('');
  }

  async function handlePickProfileImage() {
    setSettingsBusy(true);
    setSettingsFeedbackTarget('profile');
    setSettingsFeedback({ type: '', text: '' });

    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          throw new Error('Media library permission is required to choose a profile photo.');
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri && !asset?.file) {
        throw new Error('Failed to read the selected image.');
      }

      setProfileImageDraft(asset);
      setProfileImageRemoved(false);
      setProfileForm((current) => ({ ...current, profileImageUrl: asset.uri || current.profileImageUrl || '' }));
      setSettingsFeedback({ type: 'success', text: 'Photo selected. Save profile changes to apply it.' });
    } catch (error) {
      setSettingsFeedback({ type: 'error', text: error.message || 'Failed to choose a profile photo.' });
    } finally {
      setSettingsBusy(false);
    }
  }

  function handleRemoveProfileImage() {
    setProfileImageDraft(null);
    setProfileImageRemoved(true);
    setProfileForm((current) => ({ ...current, profileImageUrl: '' }));
    setSettingsFeedbackTarget('profile');
    setSettingsFeedback({ type: 'success', text: 'Photo will be removed when you save your profile.' });
  }

  async function handleSaveProfile() {
    if (!auth.token) return false;
    setSettingsBusy(true);
    setSettingsFeedbackTarget('profile');
    setSettingsFeedback({ type: '', text: '' });
    setAppError('');

    const payload = {
      firstName: profileForm.firstName.trim(),
      lastName: profileForm.lastName.trim(),
      username: profileForm.username.trim(),
      email: profileForm.email.trim(),
      profileImageUrl: profileImageRemoved ? null : (profileForm.profileImageUrl || '').trim() || null,
    };

    if (!payload.firstName || !payload.lastName || !payload.username || !payload.email) {
      setSettingsBusy(false);
      setSettingsFeedback({ type: 'error', text: 'Please complete all profile fields.' });
      return false;
    }

    try {
      let nextProfileImageUrl = payload.profileImageUrl;

      if (profile?.id && profileImageRemoved) {
        await apiRemoveUserProfilePhoto(profile.id);
        nextProfileImageUrl = null;
      }

      if (profile?.id && profileImageDraft) {
        const uploaded = await apiUploadUserProfilePhoto(profile.id, profileImageDraft);
        nextProfileImageUrl = uploaded.publicUrl;
      }

      const result = await apiUpdateUserProfile(auth.token, {
        ...payload,
        profileImageUrl: nextProfileImageUrl,
      });
      setProfile(result.user);
      setProfileImageDraft(null);
      setProfileImageRemoved(false);
      await saveSession({ token: auth.token, user: result.user });
      setSettingsFeedback({ type: 'success', text: 'Profile updated successfully.' });
      return true;
    } catch (error) {
      setSettingsFeedback({ type: 'error', text: error.message || 'Failed to update profile.' });
      return false;
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleChangePassword() {
    if (!auth.token) return false;
    setSettingsBusy(true);
    setSettingsFeedbackTarget('password');
    setSettingsFeedback({ type: '', text: '' });

    const currentPassword = passwordForm.currentPassword.trim();
    const newPassword = passwordForm.newPassword.trim();
    const confirmPassword = passwordForm.confirmPassword.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setSettingsBusy(false);
      setSettingsFeedback({ type: 'error', text: 'Please complete all password fields.' });
      return false;
    }

    if (newPassword.length < 6) {
      setSettingsBusy(false);
      setSettingsFeedback({ type: 'error', text: 'New password must be at least 6 characters.' });
      return false;
    }

    if (newPassword !== confirmPassword) {
      setSettingsBusy(false);
      setSettingsFeedback({ type: 'error', text: 'New password and confirm password do not match.' });
      return false;
    }

    try {
      await apiChangeUserPassword(auth.token, currentPassword, newPassword);
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setSettingsFeedback({ type: 'success', text: 'Password updated successfully.' });
      return true;
    } catch (error) {
      setSettingsFeedback({ type: 'error', text: error.message || 'Failed to update password.' });
      return false;
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleToggleFan(nextState) {
    if (!auth.token) return;
    setFanBusy(true);
    setAppError('');
    try {
      const updated = await apiSetFanStatus(auth.token, nextState);
      setFanState({
        isOn: updated.isOn,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      });
      await refreshGlobal(auth.token);
      if (currentPage === 'notifications') {
        await refreshNotifications(auth.token);
      }
    } catch (error) {
      setAppError(error.message || 'Failed to update fan state.');
    } finally {
      setFanBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await apiUserLogout(auth.token);
    } catch {}
    await clearSession();
    const appInstalled = await loadAppInstalled();
    setShowInstallGuide(!(isStandaloneWebApp() || appInstalled));
    setAuth({ token: null });
    setProfile(null);
    setGlobalLogs([]);
    setCameras([]);
    setNotifications([]);
    setViewedNotificationIds([]);
    setFanState({ isOn: false, updatedAt: null, updatedBy: null });
    setSensorSnapshot({
      deviceKey: 'acebott-main-01',
      pirState: false,
      fanIsOn: false,
      temperatureC: null,
      humidity: null,
      createdAt: null,
      fanUpdatedAt: null,
      fanUpdatedBy: null,
    });
    setAppError('');
    setLoginError('');
    setSettingsFeedback({ type: '', text: '' });
    setSettingsFeedbackTarget('');
    setProfileForm({
      firstName: '',
      lastName: '',
      username: '',
      email: '',
      profileImageUrl: '',
    });
    setProfileImageDraft(null);
    setProfileImageRemoved(false);
    setPasswordForm({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  }

  async function handleInstallApp() {
    if (!installPromptEvent) return;
    setInstallBusy(true);

    try {
      await installPromptEvent.prompt();
      if (installPromptEvent.userChoice) {
        const choice = await installPromptEvent.userChoice;
        if (choice?.outcome === 'accepted') {
          await saveAppInstalled();
          setShowInstallGuide(false);
        }
      }
      setInstallPromptEvent(null);
      setInstallReady(false);
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleSkipInstallGuide() {
    await saveAppInstalled();
    setShowInstallGuide(false);
  }

  const profileImagePreviewUrl = profileImageRemoved
    ? ''
    : profileImageDraft?.uri || profileForm.profileImageUrl || profile?.profileImageUrl || '';

  if (booting) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.bootSplash}>
          <ActivityIndicator size="large" color="#36ab6a" />
          <Text style={styles.bootText}>Loading app...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!auth.token) {
    if (showInstallGuide) {
      return (
        <InstallGuideScreen
          installReady={installReady}
          installBusy={installBusy}
          onInstall={handleInstallApp}
          onSkip={handleSkipInstallGuide}
        />
      );
    }

    return (
      <LoginScreen
        busy={loginBusy}
        error={loginError}
        onLogin={handleLogin}
      />
    );
  }

    return (
        <MainScreen
          profile={profile}
          globalLogs={globalLogs}
          cameras={cameras}
          notifications={notifications}
          viewedNotificationIds={viewedNotificationIds}
          fanState={fanState}
          sensorSnapshot={sensorSnapshot}
          fanBusy={fanBusy}
          currentPage={currentPage}
        onNavigate={setCurrentPage}
        onViewNotification={handleViewNotification}
        onToggleFan={handleToggleFan}
      profileForm={profileForm}
      passwordForm={passwordForm}
      settingsBusy={settingsBusy}
      settingsFeedback={settingsFeedback}
      settingsFeedbackTarget={settingsFeedbackTarget}
      profileImagePreviewUrl={profileImagePreviewUrl}
      onChangeProfileField={handleChangeProfileField}
      onChangePasswordField={handleChangePasswordField}
      onPickProfileImage={handlePickProfileImage}
      onRemoveProfileImage={handleRemoveProfileImage}
      onResetProfileImageState={handleResetProfileImageState}
      onResetProfileForm={handleResetProfileForm}
      onResetPasswordForm={handleResetPasswordForm}
      onClearSettingsFeedback={handleClearSettingsFeedback}
        onSaveProfile={handleSaveProfile}
        onChangePassword={handleChangePassword}
        onLogout={handleLogout}
        appError={appError}
      />
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7f3',
  },
  bootSplash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f4f7f3',
  },
  bootText: {
    color: '#567061',
    fontSize: 16,
  },
  installGuideScroll: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 28,
    paddingBottom: 34,
    backgroundColor: '#00653f',
    gap: 16,
  },
  installGuideHero: {
    alignItems: 'center',
    paddingTop: 10,
  },
  installGuideLogo: {
    width: 92,
    height: 92,
    marginBottom: 14,
  },
  installGuideEyebrow: {
    color: '#d0f1dd',
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  installGuideTitle: {
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    textAlign: 'center',
    maxWidth: 360,
  },
  installGuideLead: {
    marginTop: 12,
    color: '#e6f7ec',
    fontSize: 15,
    textAlign: 'center',
    maxWidth: 360,
  },
  installGuidePanel: {
    backgroundColor: 'rgba(244, 251, 246, 0.98)',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#bfe0ca',
    gap: 12,
  },
  installGuidePanelTitle: {
    color: '#12412d',
    fontSize: 18,
    fontWeight: '800',
  },
  installGuideStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  installGuideStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1f8f4a',
    color: '#ffffff',
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 28,
    overflow: 'hidden',
  },
  installGuideStepText: {
    flex: 1,
    color: '#426d58',
    fontSize: 14,
  },
  installGuidePlatformTitle: {
    color: '#12412d',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  installGuidePlatformText: {
    color: '#4f7a65',
    fontSize: 13,
    lineHeight: 19,
  },
  installGuideActions: {
    gap: 10,
    marginTop: 4,
  },
  installActionButton: {
    marginTop: 0,
  },
  loginRoot: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 32,
    backgroundColor: '#00653f',
    overflow: 'hidden',
    minHeight: '100%',
  },
  loginBgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 34, 18, 0.25)',
  },
  loginBgLogo: {
    position: 'absolute',
    right: -150,
    top: '50%',
    width: 620,
    height: 620,
    marginTop: -310,
    opacity: 0.72,
    transform: [{ scale: 1.03 }],
  },
  loginCard: {
    backgroundColor: 'rgba(2, 80, 49, 0.92)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: 'rgba(94, 223, 118, 0.55)',
    zIndex: 2,
    maxWidth: 360,
    width: '100%',
    alignSelf: 'center',
  },
  brandTitle: {
    fontSize: 29,
    fontWeight: '800',
    color: '#f8fffa',
  },
  loginSubtitle: {
    marginTop: 6,
    marginBottom: 16,
    color: 'rgba(232, 250, 239, 0.96)',
    fontSize: 16,
  },
  authToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  authToggleButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(191, 224, 202, 0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  authToggleButtonActive: {
    backgroundColor: '#dff7e7',
    borderColor: '#d7c92f',
  },
  authToggleText: {
    color: '#dff7e7',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  authToggleTextActive: {
    color: '#115a37',
  },
  inputGroup: {
    marginBottom: 11,
  },
  inputLabel: {
    fontSize: 11,
    color: 'rgba(227, 248, 235, 0.96)',
    marginBottom: 5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#98dcb0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#1f3028',
    fontSize: 15,
  },
  errorText: {
    color: '#c74d4d',
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  successText: {
    color: '#1d8e4d',
    marginBottom: 10,
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: '#e5f7eb',
    borderWidth: 1,
    borderColor: '#bfe0ca',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  registerSummaryCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(230, 247, 236, 0.96)',
    borderWidth: 1,
    borderColor: '#bfe0ca',
    gap: 4,
  },
  registerSummaryEyebrow: {
    color: '#1a7248',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  registerSummaryTitle: {
    color: '#154b31',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  registerSummaryText: {
    color: '#265741',
    fontSize: 13,
  },
  cameraConfigCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: '#d6e8dc',
    gap: 4,
  },
  cameraConfigLabel: {
    color: '#1c7e50',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cameraConfigValue: {
    color: '#174530',
    fontSize: 13,
    fontWeight: '700',
  },
  cameraConfigHint: {
    color: '#4f6f5f',
    fontSize: 12,
    lineHeight: 18,
  },
  formHint: {
    color: 'rgba(232, 250, 239, 0.9)',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  captureProgressCard: {
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(225, 244, 232, 0.94)',
    borderWidth: 1,
    borderColor: '#bfe0ca',
  },
  captureProgressTitle: {
    color: '#1a6c44',
    fontSize: 13,
    fontWeight: '800',
  },
  captureProgressText: {
    marginTop: 4,
    color: '#335b48',
    fontSize: 12,
  },
  registerActionRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  registerActionPrimary: {
    flex: 1,
  },
  secondaryButton: {
    minWidth: 84,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c8dbcf',
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: '#eaf7ef',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    height: 44,
    borderRadius: 10,
    backgroundColor: '#2fae4d',
    borderWidth: 1,
    borderColor: '#d7c92f',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  enrollmentStatusCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: '#d9e8de',
  },
  enrollmentStatusEyebrow: {
    color: '#1d7a4f',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  enrollmentStatusTitle: {
    marginTop: 6,
    color: '#1a3b2c',
    fontSize: 16,
    fontWeight: '800',
  },
  enrollmentStatusText: {
    marginTop: 6,
    color: '#4d6f5d',
    fontSize: 13,
    lineHeight: 19,
  },
  enrollmentProgressLabel: {
    marginTop: 8,
    color: '#1d6e47',
    fontSize: 12,
    fontWeight: '700',
  },
  faceCaptureCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: 1,
    borderColor: '#d6e8dc',
    gap: 10,
  },
  faceCaptureCardAccepted: {
    borderColor: '#7bc994',
    backgroundColor: 'rgba(238, 249, 242, 0.98)',
  },
  faceCaptureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  faceCaptureCopy: {
    flex: 1,
    gap: 4,
  },
  faceCaptureStepText: {
    color: '#1c7e50',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  faceCaptureTitle: {
    color: '#143c2a',
    fontSize: 16,
    fontWeight: '800',
  },
  faceCaptureInstruction: {
    color: '#4f6f5f',
    fontSize: 12,
    lineHeight: 18,
  },
  faceCaptureStatusBadge: {
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eef4f0',
    borderWidth: 1,
    borderColor: '#d8e5dc',
    alignItems: 'center',
  },
  faceCaptureStatusBadgeAccepted: {
    backgroundColor: '#dff7e7',
    borderColor: '#8ecda1',
  },
  faceCaptureStatusText: {
    color: '#547061',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  faceCaptureStatusTextAccepted: {
    color: '#186d43',
  },
  faceCapturePreview: {
    width: '100%',
    height: 190,
    borderRadius: 12,
    backgroundColor: '#dfe9e2',
    borderWidth: 1,
    borderColor: '#d3e2d8',
  },
  faceCapturePlaceholder: {
    height: 190,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d6e8dc',
    borderStyle: 'dashed',
    backgroundColor: '#eef5f0',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  faceCapturePlaceholderText: {
    color: '#4b6c5b',
    fontSize: 13,
    fontWeight: '600',
  },
  captureStepError: {
    color: '#b94b4b',
    fontSize: 12,
    fontWeight: '600',
  },
  faceCaptureActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  faceCaptureActionButton: {
    flex: 1,
    marginTop: 0,
  },
  installSkipButton: {
    marginTop: 12,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(210, 234, 219, 0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  installSkipButtonText: {
    color: '#dff7e7',
    fontSize: 13,
    fontWeight: '700',
  },
  appContainer: {
    paddingTop: 14,
    paddingBottom: 110,
    backgroundColor: '#f4f7f3',
  },
  mainShell: {
    flex: 1,
    backgroundColor: '#f4f7f3',
    position: 'relative',
  },
  pageScroll: {
    flex: 1,
    backgroundColor: '#f4f7f3',
  },
  panel: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#e3ece6',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1f2b24',
    marginBottom: 12,
  },
  settingsHero: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderRadius: 24,
    backgroundColor: '#0f6a45',
    borderWidth: 1,
    borderColor: '#1a7d55',
    shadowColor: '#0b462f',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  settingsHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  settingsHeroLogoutButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsHeroCopy: {
    flex: 1,
  },
  settingsHeroEyebrow: {
    color: '#bde8cf',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  settingsHeroName: {
    marginTop: 12,
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
  },
  settingsHeroMeta: {
    marginTop: 8,
    color: '#dff7e7',
    fontSize: 13,
  },
  settingsSectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  settingsSectionBadge: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#e7f8ed',
    borderWidth: 1,
    borderColor: '#cfead8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsSectionCopy: {
    flex: 1,
  },
  settingsSectionTitle: {
    marginBottom: 0,
  },
  settingsEditButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsHint: {
    color: '#4f7a65',
    fontSize: 13,
    marginTop: 4,
    lineHeight: 19,
  },
  settingsFieldGrid: {
    gap: 0,
  },
  settingsFieldGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  settingsFieldSlot: {
    width: '100%',
  },
  settingsFieldSlotHalf: {
    width: '48.5%',
  },
  settingsPhotoCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dcebe1',
    backgroundColor: '#f8fbf8',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  settingsPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingsPhotoHint: {
    marginTop: 4,
    color: '#5f7b6c',
    fontSize: 13,
    lineHeight: 18,
  },
  settingsPhotoPreviewWrap: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  settingsPhotoActions: {
    flex: 1,
    gap: 10,
  },
  settingsPhotoButton: {
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: '#1f8f4a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  settingsPhotoButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  settingsPhotoButtonGhost: {
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f1d1cf',
    backgroundColor: '#fff7f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  settingsPhotoButtonGhostText: {
    color: '#d65c57',
    fontSize: 13,
    fontWeight: '800',
  },
  settingsFieldCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dcebe1',
    backgroundColor: '#f8fbf8',
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 10,
  },
  settingsFieldCardLocked: {
    opacity: 0.74,
  },
  settingsFieldIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#e9f8ee',
    borderWidth: 1,
    borderColor: '#d1ead8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsFieldBody: {
    flex: 1,
  },
  settingsFieldLabel: {
    color: '#60816f',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  settingsFieldInput: {
    marginTop: 5,
    color: '#1a3f2f',
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
  },
  settingsFieldInputLocked: {
    color: '#6f887c',
  },
  settingsSecurityNote: {
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d8edf7',
    backgroundColor: '#f4fbff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsSecurityNoteText: {
    flex: 1,
    color: '#547686',
    fontSize: 12,
    lineHeight: 18,
  },
  formAction: {
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: '#1f8f4a',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    shadowColor: '#0f6a45',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  formActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  settingsSuccessText: {
    marginTop: 12,
    color: '#177143',
    fontWeight: '700',
    fontSize: 13,
    backgroundColor: '#e8f7ee',
    borderWidth: 1,
    borderColor: '#cfe8d7',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  settingsErrorText: {
    marginTop: 12,
    color: '#b24242',
    fontWeight: '700',
    fontSize: 13,
    backgroundColor: '#fff2f2',
    borderWidth: 1,
    borderColor: '#f4d5d5',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  glyphTile: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  glyphTileText: {
    fontSize: 18,
    fontWeight: '800',
  },
  dashboardPanel: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  dashboardPanelWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dashboardPanelItem: {
    width: '100%',
  },
  dashboardPanelItemHalf: {
    width: '48.5%',
  },
  dashboardHero: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 24,
    backgroundColor: '#0d6a45',
    borderWidth: 1,
    borderColor: '#167f55',
    shadowColor: '#0b462f',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  dashboardHeroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  dashboardHeroProfile: {
    alignItems: 'center',
    gap: 8,
  },
  dashboardHeroProfileName: {
    color: '#e7f8ed',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    maxWidth: 92,
  },
  dashboardHeroCopy: {
    flex: 1,
  },
  dashboardHeroEyebrow: {
    color: '#bde8cf',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  dashboardHeroTitle: {
    marginTop: 8,
    color: '#ffffff',
    fontSize: 29,
    fontWeight: '900',
  },
  dashboardHeroLead: {
    marginTop: 8,
    color: '#dff7e7',
    fontSize: 13,
    lineHeight: 20,
  },
  dashboardHeroChips: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dashboardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  dashboardChipText: {
    color: '#effcf4',
    fontSize: 12,
    fontWeight: '700',
  },
  profileAvatar: {
    backgroundColor: '#dff4e7',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  vitalCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    minHeight: 118,
  },
  vitalTextWrap: {
    flex: 1,
  },
  vitalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  vitalTitle: {
    color: '#2a2e2b',
    fontSize: 12,
    letterSpacing: 0.8,
    fontWeight: '800',
    textTransform: 'uppercase',
    flex: 1,
  },
  vitalBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  vitalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  vitalValue: {
    marginTop: 8,
    color: '#22342b',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
  vitalHint: {
    marginTop: 6,
    color: '#73847b',
    fontSize: 12,
    lineHeight: 17,
  },
  emptyText: {
    color: '#58766a',
    fontSize: 14,
  },
  listGap: {
    height: 10,
  },
  logCard: {
    backgroundColor: '#f8fbf8',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e3ece6',
    padding: 14,
    gap: 8,
  },
  logCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  logCardTitleWrap: {
    flex: 1,
  },
  logCardName: {
    color: '#242c27',
    fontSize: 15,
    fontWeight: '800',
  },
  logCardMeta: {
    marginTop: 2,
    color: '#71827a',
    fontSize: 12,
  },
  logBadge: {
    fontSize: 11,
    fontWeight: '800',
    backgroundColor: '#edf7ef',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  logCardDetail: {
    color: '#54645d',
    fontSize: 13,
  },
  logCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logCardTime: {
    color: '#7d8d86',
    fontSize: 12,
  },
  logCardConfidence: {
    color: '#2a7b52',
    fontWeight: '800',
    fontSize: 13,
  },
  controlStatusCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e3ece6',
    backgroundColor: '#f8fbf8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  controlStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fanToggleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  controlStatusCopy: {
    flex: 1,
  },
  controlStatusValue: {
    color: '#26302a',
    fontSize: 18,
    fontWeight: '800',
  },
  controlStatusMeta: {
    marginTop: 2,
    color: '#71827a',
    fontSize: 12,
  },
  notificationsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  notificationsSubhead: {
    marginTop: -4,
    color: '#6e8377',
    fontSize: 12,
  },
  notificationsCounter: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#eaf8ef',
    borderWidth: 1,
    borderColor: '#d4eadb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationCard: {
    backgroundColor: '#fcfefd',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e3ece6',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    cursor: 'pointer',
  },
  notificationCardViewed: {
    backgroundColor: '#f8fbf9',
  },
  notificationCardNoSelect: {
    userSelect: 'none',
  },
  notificationIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  notificationIconWrapViewed: {
    opacity: 0.8,
  },
  notificationBody: {
    flex: 1,
  },
  notificationTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  notificationTitle: {
    color: '#173127',
    fontWeight: '800',
    fontSize: 14,
    flex: 1,
    cursor: 'pointer',
  },
  notificationTitleViewed: {
    fontWeight: '600',
    color: '#456457',
  },
  notificationBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    cursor: 'pointer',
  },
  notificationBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  notificationBadgeTextViewed: {
    opacity: 0.75,
  },
  notificationMessage: {
    marginTop: 6,
    color: '#4f6f60',
    fontSize: 13,
    lineHeight: 19,
    cursor: 'pointer',
  },
  notificationMessageViewed: {
    color: '#698274',
  },
  notificationMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notificationTime: {
    color: '#698274',
    fontSize: 12,
    cursor: 'pointer',
  },
  notificationMetaDot: {
    color: '#9ab0a4',
    fontSize: 12,
    lineHeight: 12,
    cursor: 'pointer',
  },
  notificationMetaLabel: {
    color: '#8ba094',
    fontSize: 11,
    fontWeight: '700',
    cursor: 'pointer',
  },
  notificationMetaViewed: {
    color: '#90a59a',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#edf1ee',
  },
  deviceRowCopy: {
    flex: 1,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1f2b24',
  },
  deviceMeta: {
    color: '#6e7b74',
    fontSize: 12,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e4ebe6',
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 8,
    zIndex: 20,
    elevation: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  bottomNavIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: '#eff5f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavIconActive: {
    backgroundColor: '#dff6e7',
  },
  bottomNavIconText: {
    color: '#8a9690',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 19,
  },
  bottomNavIconTextActive: {
    color: '#2dbf67',
  },
  bottomNavText: {
    color: '#9aa59f',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  bottomNavTextActive: {
    color: '#2dbf67',
  },
});
