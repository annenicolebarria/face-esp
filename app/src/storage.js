import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = '@ptc_user_session_v1';
const APP_INSTALLED_KEY = '@ptc_app_installed_v1';

export async function saveSession(session) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession() {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function saveAppInstalled() {
  await AsyncStorage.setItem(APP_INSTALLED_KEY, '1');
}

export async function loadAppInstalled() {
  const raw = await AsyncStorage.getItem(APP_INSTALLED_KEY);
  return raw === '1';
}
