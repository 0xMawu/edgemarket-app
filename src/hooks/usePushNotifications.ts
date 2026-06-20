/**
 * usePushNotifications.ts
 *
 * Handles Expo push notification registration.
 *
 * NOTE: expo-notifications is compatible with Expo SDK 51 / RN 0.74.
 * Install with: npx expo install expo-notifications expo-device
 *
 * If the install fails (e.g. managed workflow restrictions), the hook
 * degrades gracefully — permissionStatus stays 'unavailable' and
 * pushToken stays null. The ProfileScreen uses this to fall back to
 * an in-app badge counter instead of OS push notifications.
 *
 * API CALLS NOTE (Task 15.2):
 * This hook contains no direct calls to the Spring Boot backend.
 * The /api/push-tokens POST and DELETE requests are centralised in
 * ProfileScreen.tsx, which uses apiClient.apiRequest() for authenticated
 * access (see task 14.3). This hook's sole responsibility is device-level
 * permission management and Expo push token retrieval.
 */

import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

// Lazy imports so the app doesn't crash if the packages aren't installed yet.
let Notifications: typeof import('expo-notifications') | null = null;
let Device: typeof import('expo-device') | null = null;

try {
  Notifications = require('expo-notifications');
  Device = require('expo-device');
} catch {
  console.warn('[usePushNotifications] expo-notifications / expo-device not installed.');
}

export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface UsePushNotificationsResult {
  pushToken: string | null;
  permissionStatus: PermissionStatus;
  requestPermission: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const initialised = useRef(false);

  const requestPermission = async () => {
    if (!Notifications || !Device) {
      setPermissionStatus('unavailable');
      return;
    }

    // Physical device required for push tokens
    if (!Device.isDevice) {
      console.warn('[usePushNotifications] Push notifications require a physical device.');
      setPermissionStatus('unavailable');
      return;
    }

    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;

      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      setPermissionStatus(finalStatus as PermissionStatus);

      if (finalStatus !== 'granted') return;

      const tokenData = await Notifications.getExpoPushTokenAsync();
      setPushToken(tokenData.data);

      // Android requires a notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('trade-alerts', {
          name: 'Trade Alerts',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#a855f7',
        });
      }
    } catch (err) {
      console.warn('[usePushNotifications] Error requesting permissions:', err);
      setPermissionStatus('unavailable');
    }
  };

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    if (!Notifications || !Device) {
      setPermissionStatus('unavailable');
      return;
    }

    // Check existing permission status without prompting on first load
    Notifications.getPermissionsAsync()
      .then(({ status }) => {
        setPermissionStatus(status as PermissionStatus);
        // If already granted, get the token immediately
        if (status === 'granted' && Device!.isDevice) {
          return Notifications!.getExpoPushTokenAsync().then((t) => setPushToken(t.data));
        }
      })
      .catch(() => setPermissionStatus('unavailable'));
  }, []);

  return { pushToken, permissionStatus, requestPermission };
}
