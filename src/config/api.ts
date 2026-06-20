/**
 * src/config/api.ts
 *
 * Single source of truth for the backend base URL.
 *
 * As of Phase 6, the Node.js proxy (server/, port 3001) has been merged
 * into the Spring Boot backend (spring-server/, port 8080). All API calls
 * — traders, markets, follows, and push-tokens — now go to port 8080.
 *
 * Update ANDROID_HOST below if your dev machine's LAN IP changes (e.g. when
 * testing on a physical device instead of the Android emulator). The
 * emulator's special alias `10.0.2.2` routes to the host machine's
 * localhost and does NOT need to change.
 */
import { Platform } from 'react-native';

const PORT = 8080;

// Used only for Platform.OS === 'android'. `10.0.2.2` works for the Android
// emulator. If running on a physical Android device on the same Wi-Fi
// network, replace this with your host machine's LAN IP (e.g. 192.168.1.50).
const ANDROID_HOST = '10.0.2.2';

export const API_BASE_URL = Platform.select({
  android: `http://${ANDROID_HOST}:${PORT}`,
  ios: `http://localhost:${PORT}`,
  default: `http://localhost:${PORT}`,
});

export const API_PREFIX = `${API_BASE_URL}/api`;
