import { supabase } from './supabase';

function normalizeError(error, fallback) {
  if (error?.message) {
    return new Error(error.message);
  }

  return new Error(fallback);
}

async function rpcRequest(functionName, payload = {}, fallback = 'Request failed.') {
  const { data, error } = await supabase.rpc(functionName, payload);

  if (error) {
    throw normalizeError(error, fallback);
  }

  return data;
}

function mapProfile(row) {
  if (!row) return null;

  return {
    id: row.id,
    firstName: row.firstName || row.first_name,
    lastName: row.lastName || row.last_name,
    username: row.username,
    email: row.email,
    profileImageUrl: row.profileImageUrl || row.profile_image_url || null,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt || row.created_at,
    updatedAt: row.updatedAt || row.updated_at,
  };
}

async function resolveUploadBody(asset) {
  if (asset?.file) {
    return asset.file;
  }

  if (!asset?.uri) {
    throw new Error('Selected image is invalid.');
  }

  const response = await fetch(asset.uri);
  if (!response.ok) {
    throw new Error('Failed to read the selected image.');
  }

  return response.blob();
}

function mapLog(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userNameSnapshot: row.user_name_snapshot,
    cameraId: row.camera_id,
    event: row.event,
    confidence: row.confidence,
    detectedAt: row.detected_at,
    createdAt: row.created_at,
  };
}

function mapCamera(row) {
  return {
    cameraId: row.camera_id,
    area: row.area,
    status: row.status,
    lastDetectedAt: row.last_detected_at,
    recognizedToday: Number(row.recognized_today || 0),
    unrecognizedToday: Number(row.unrecognized_today || 0),
  };
}

function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    at: row.at,
  };
}

function mapSensorSnapshot(row) {
  return {
    deviceKey: row?.deviceKey || row?.device_key || 'acebott-main-01',
    pirState: Boolean(row?.pirState ?? row?.pir_state),
    fanIsOn: Boolean(row?.fanIsOn ?? row?.fan_is_on),
    temperatureC:
      row?.temperatureC === null || row?.temperatureC === undefined
        ? null
        : Number(row.temperatureC ?? row.temperature_c),
    humidity:
      row?.humidity === null || row?.humidity === undefined ? null : Number(row.humidity),
    createdAt: row?.createdAt || row?.created_at || null,
    fanUpdatedAt: row?.fanUpdatedAt || row?.fan_updated_at || null,
    fanUpdatedBy: row?.fanUpdatedBy || row?.fan_updated_by || 'system',
  };
}

export async function apiUserLogin(identity, password) {
  const data = await rpcRequest(
    'app_login',
    {
      login_identity: String(identity || '').trim(),
      login_password: String(password || ''),
    },
    'Invalid credentials.'
  );

  return {
    token: data.token,
    user: mapProfile(data.user),
  };
}

export async function apiUserLogout(token) {
  if (!token) return { ok: true };
  return rpcRequest('app_logout', { session_token: token }, 'Failed to log out.');
}

export async function apiGetUserMe(token) {
  const data = await rpcRequest(
    'app_validate_session',
    { session_token: token },
    'Failed to load current user.'
  );
  return mapProfile(data);
}

export async function apiGetUserLogs(token, limit = 30) {
  const data = await rpcRequest(
    'app_get_my_logs',
    { session_token: token, logs_limit: Number(limit) },
    'Failed to fetch user logs.'
  );
  return (data || []).map(mapLog);
}

export async function apiGetGlobalLogs(token, limit = 80) {
  const data = await rpcRequest(
    'app_get_global_logs',
    { session_token: token, logs_limit: Number(limit) },
    'Failed to fetch global logs.'
  );
  return (data || []).map(mapLog);
}

export async function apiGetUserCameras(token) {
  const data = await rpcRequest(
    'app_get_cameras_summary',
    { session_token: token },
    'Failed to fetch camera summary.'
  );
  return (data || []).map(mapCamera);
}

export async function apiGetSensorSnapshot(token) {
  const data = await rpcRequest(
    'app_get_sensor_snapshot',
    { session_token: token },
    'Failed to fetch sensor snapshot.'
  );

  return mapSensorSnapshot(data || {});
}

export async function apiGetFanStatus(token) {
  const data = await rpcRequest(
    'app_get_fan_state',
    { session_token: token },
    'Failed to fetch fan state.'
  );

  return {
    isOn: Boolean(data?.isOn),
    updatedAt: data?.updatedAt || null,
    updatedBy: data?.updatedBy || 'system',
  };
}

export async function apiSetFanStatus(token, isOn) {
  const data = await rpcRequest(
    'app_set_fan_state',
    { session_token: token, next_is_on: Boolean(isOn) },
    'Failed to update fan state.'
  );

  return {
    isOn: Boolean(data?.isOn),
    updatedAt: data?.updatedAt || null,
    updatedBy: data?.updatedBy || 'system',
  };
}

export async function apiGetUserNotifications(token, limit = 50) {
  const data = await rpcRequest(
    'app_get_notifications',
    { session_token: token, item_limit: Number(limit) },
    'Failed to fetch notifications.'
  );
  return (data || []).map(mapNotification);
}

export async function apiUpdateUserProfile(token, profile) {
  const data = await rpcRequest(
    'app_update_profile',
    {
      session_token: token,
      input_first_name: String(profile.firstName || '').trim(),
      input_last_name: String(profile.lastName || '').trim(),
      input_username: String(profile.username || '').trim(),
      input_email: String(profile.email || '').trim().toLowerCase(),
      input_profile_image_url: profile.profileImageUrl ? String(profile.profileImageUrl).trim() : null,
    },
    'Failed to update profile.'
  );

  return {
    message: data?.message || 'Profile updated.',
    user: mapProfile(data?.user),
  };
}

export async function apiChangeUserPassword(token, currentPassword, newPassword) {
  return rpcRequest(
    'app_change_password',
    {
      session_token: token,
      current_password: String(currentPassword || ''),
      new_password: String(newPassword || ''),
    },
    'Failed to update password.'
  );
}

export async function apiUploadUserProfilePhoto(userId, asset) {
  const normalizedUserId = Number(userId);
  if (!Number.isFinite(normalizedUserId)) {
    throw new Error('Missing user ID for profile photo upload.');
  }

  const objectPath = `users/${normalizedUserId}/avatar`;
  const contentType = String(asset?.mimeType || '').startsWith('image/')
    ? String(asset.mimeType)
    : 'image/jpeg';
  const body = await resolveUploadBody(asset);

  const { error } = await supabase.storage.from('profile-pictures').upload(objectPath, body, {
    cacheControl: '3600',
    upsert: true,
    contentType,
  });

  if (error) {
    throw normalizeError(error, 'Failed to upload profile photo.');
  }

  const { data } = supabase.storage.from('profile-pictures').getPublicUrl(objectPath);

  return {
    objectPath,
    publicUrl: `${data.publicUrl}?v=${Date.now()}`,
  };
}

export async function apiRemoveUserProfilePhoto(userId) {
  const normalizedUserId = Number(userId);
  if (!Number.isFinite(normalizedUserId)) {
    throw new Error('Missing user ID for profile photo removal.');
  }

  const objectPath = `users/${normalizedUserId}/avatar`;
  const { error } = await supabase.storage.from('profile-pictures').remove([objectPath]);

  if (error) {
    throw normalizeError(error, 'Failed to remove profile photo.');
  }

  return { ok: true };
}
