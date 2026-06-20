/**
 * useFollowing — module-level state with AsyncStorage persistence.
 *
 * Follows are now stored locally in AsyncStorage so they survive app restarts
 * without needing the backend. The server sync is attempted as a best-effort
 * fire-and-forget — if the backend is unreachable, local state is preserved.
 *
 * Priority order:
 *  1. Local AsyncStorage (always works, even offline)
 *  2. Server sync (overwrites local when backend is reachable and responds)
 */

import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_PREFIX } from '../config/api';
import { apiRequest } from '../utils/apiClient';

const STORAGE_KEY = '@edgemarket/following_ids';

// Module-level state — persists across screen navigations
let _followingIds: string[] = [];
let _userAddress: string | null = null;
let _getJwt: (() => string | null) = () => null;
let _onUnauthorized: () => Promise<void> = async () => {};
let _loaded = false; // ensures AsyncStorage is only loaded once
let _listeners: Array<() => void> = [];

function notify() {
  _listeners.forEach((fn) => fn());
}

function saveLocal(ids: string[]) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids)).catch(() => {});
}

/** Load persisted IDs from AsyncStorage on first call. */
async function loadLocal() {
  if (_loaded) return;
  _loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _followingIds = parsed;
        notify();
      }
    }
  } catch {
    // storage unavailable — start with empty list
  }
}

/** Called from ProfileScreen once a wallet connects. */
export function setFollowingUserAddress(address: string | null) {
  _userAddress = address;
}

export function setFollowingAuth(getJwt: () => string | null, onUnauthorized: () => Promise<void>) {
  _getJwt = getJwt;
  _onUnauthorized = onUnauthorized;
}

export function useFollowing() {
  const [, forceRender] = useState(0);

  // Subscribe to module-level state changes
  useEffect(() => {
    const handler = () => forceRender((n) => n + 1);
    _listeners.push(handler);
    // Load from AsyncStorage on first mount
    loadLocal();
    return () => {
      _listeners = _listeners.filter((l) => l !== handler);
    };
  }, []);

  /**
   * Replace local list with addresses from the server.
   * Also persists the server list to AsyncStorage so it's available offline.
   */
  const syncFromServer = (addresses: string[]) => {
    const normalised = addresses.map((a) => a.toLowerCase());
    _followingIds = normalised;
    saveLocal(normalised);
    notify();
  };

  /**
   * Toggle follow state.
   * 1. Optimistically updates in-memory state immediately.
   * 2. Persists to AsyncStorage (always).
   * 3. Attempts server sync if wallet is connected (best-effort, silent on failure).
   */
  const toggleFollow = (id: string) => {
    const normalised = id.toLowerCase();
    const isFollowing = _followingIds.includes(normalised);

    // Optimistic update + local persist
    const updated = isFollowing
      ? _followingIds.filter((x) => x !== normalised)
      : [..._followingIds, normalised];

    _followingIds = updated;
    saveLocal(updated);
    notify();

    // Best-effort server sync — silent on failure
    if (_userAddress) {
      const method = isFollowing ? 'DELETE' : 'POST';
      apiRequest(
        `${API_PREFIX}/follows`,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: _userAddress, targetAddress: normalised }),
        },
        _getJwt,
        _onUnauthorized,
      ).catch(() => {});
    }
  };

  return {
    followingIds: _followingIds,
    toggleFollow,
    syncFromServer,
  };
}
