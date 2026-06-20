/**
 * useWalletAuth — manual wallet address entry + AsyncStorage persistence
 *                 + JWT authentication (SIWE-style).
 *
 * Tasks 12.1 / 12.2 / 12.3:
 *  12.1 – Core auth state: jwt, authStatus, authenticate(), clearAuth(),
 *          and updated disconnect() that also wipes JWT.
 *  12.2 – Startup rehydration: loads both wallet and JWT on mount via
 *          Promise.all; validates JWT exp before restoring auth state.
 *  12.3 – Proactive refresh timer: schedules clearTimeout 60 s before JWT
 *          expiry so the UI can prompt the user to re-authenticate.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ethers } from 'ethers';
import { API_PREFIX } from '../config/api';

const WALLET_KEY = '@edgemarket/wallet';
const JWT_KEY    = '@edgemarket/jwt';

// ─── Public types ────────────────────────────────────────────────────────────

export type AuthStatus =
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'error';

export interface WalletAuthState {
  // existing
  walletAddress: string | null;
  isConnected:   boolean;
  connect:        (address: string) => Promise<void>;
  disconnect:     () => Promise<void>;
  // new (tasks 12.1–12.3)
  jwt:            string | null;
  authStatus:     AuthStatus;
  authenticate:   (privateKey: string, nonce: string) => Promise<void>;
  clearAuth:      () => Promise<void>;
  storeJwt:       (token: string) => Promise<void>;  // store JWT and update state
  rehydrating:    boolean;  // true while loading from AsyncStorage on startup
}

// ─── JWT helpers ─────────────────────────────────────────────────────────────

/** Decode the `exp` claim from a JWT without verifying the signature. */
function getJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useWalletAuth(): WalletAuthState {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [jwt,           setJwt]           = useState<string | null>(null);
  const [authStatus,    setAuthStatus]    = useState<AuthStatus>('unauthenticated');
  const [rehydrating,   setRehydrating]   = useState<boolean>(true);

  // Holds the proactive-refresh timer so we can cancel it on demand (task 12.3)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Cancel any pending proactive-refresh timer. */
  const cancelRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  /**
   * Schedule a proactive-refresh timer for 60 s before JWT expiry (task 12.3).
   * On fire: clear auth state so the UI knows to prompt Step-2 re-auth.
   */
  const scheduleRefresh = useCallback((exp: number) => {
    cancelRefreshTimer();
    const msUntilRefresh = (exp - 60) * 1000 - Date.now();
    if (msUntilRefresh <= 0) {
      // Already within the 60-second window — treat as expired immediately.
      setAuthStatus('unauthenticated');
      setJwt(null);
      AsyncStorage.removeItem(JWT_KEY).catch(console.error);
      return;
    }
    refreshTimerRef.current = setTimeout(() => {
      setAuthStatus('unauthenticated');
      setJwt(null);
      AsyncStorage.removeItem(JWT_KEY).catch(console.error);
    }, msUntilRefresh);
  }, [cancelRefreshTimer]);

  // ── Task 12.2 — Startup rehydration ────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(WALLET_KEY),
      AsyncStorage.getItem(JWT_KEY),
    ])
      .then(([storedWallet, storedJwt]) => {
        if (storedWallet) {
          setWalletAddress(storedWallet);
        }

        if (storedJwt) {
          const exp = getJwtExp(storedJwt);
          if (exp !== null && exp * 1000 > Date.now()) {
            setJwt(storedJwt);
            setAuthStatus('authenticated');
            scheduleRefresh(exp);
          } else {
            setAuthStatus('unauthenticated');
            AsyncStorage.removeItem(JWT_KEY).catch(console.error);
          }
        } else {
          setAuthStatus('unauthenticated');
        }
      })
      .catch(console.error)
      .finally(() => setRehydrating(false));

    // Cancel the timer when the component unmounts.
    return () => {
      cancelRefreshTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Task 12.1 — clearAuth ──────────────────────────────────────────────────
  const clearAuth = useCallback(async () => {
    cancelRefreshTimer();
    await AsyncStorage.removeItem(JWT_KEY);
    setJwt(null);
    setAuthStatus('unauthenticated');
  }, [cancelRefreshTimer]);

  // ── Existing: connect ──────────────────────────────────────────────────────
  const connect = useCallback(async (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) throw new Error('Address cannot be empty');
    await AsyncStorage.setItem(WALLET_KEY, trimmed);
    setWalletAddress(trimmed);
  }, []);

  // ── Existing: disconnect (now also wipes JWT — task 12.1) ─────────────────
  const disconnect = useCallback(async () => {
    await AsyncStorage.removeItem(WALLET_KEY);
    setWalletAddress(null);
    await clearAuth();
  }, [clearAuth]);

  // ── Task 12.1 — authenticate ───────────────────────────────────────────────
  const authenticate = useCallback(
    async (privateKey: string, nonce: string) => {
      if (!walletAddress) throw new Error('No wallet connected');

      setAuthStatus('authenticating');

      try {
        // Construct the deterministic challenge message (must match server-side).
        const challengeMessage =
          'Sign in to EdgeMarket\nAddress: ' +
          walletAddress.toLowerCase() +
          '\nNonce: ' +
          nonce;

        // Sign on-device — private key never leaves this scope.
        const wallet    = new ethers.Wallet(privateKey);
        const signature = await wallet.signMessage(challengeMessage);

        // Clear the private key from local scope immediately after signing.
        privateKey = '';   // eslint-disable-line no-param-reassign

        // Submit signature to the server.
        const response = await fetch(`${API_PREFIX}/auth/verify`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ address: walletAddress, signature }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(
            (error as { error?: string }).error ?? 'Authentication failed',
          );
        }

        const { token } = (await response.json()) as { token: string };

        // Persist and activate the JWT.
        await AsyncStorage.setItem(JWT_KEY, token);
        setJwt(token);
        setAuthStatus('authenticated');

        // Arm the proactive-refresh timer (task 12.3).
        const exp = getJwtExp(token);
        if (exp !== null) {
          scheduleRefresh(exp);
        }
      } catch (err) {
        setAuthStatus('error');
        throw err;
      }
    },
    [walletAddress, scheduleRefresh],
  );

  // ── storeJwt — called by ProfileScreen after modal success ───────────────
  const storeJwt = useCallback(async (token: string) => {
    await AsyncStorage.setItem(JWT_KEY, token);
    setJwt(token);
    setAuthStatus('authenticated');
    const exp = getJwtExp(token);
    if (exp !== null) {
      scheduleRefresh(exp);
    }
  }, [scheduleRefresh]);

  // ─────────────────────────────────────────────────────────────────────────
  return {
    walletAddress,
    isConnected: walletAddress !== null,
    connect,
    disconnect,
    jwt,
    authStatus,
    authenticate,
    clearAuth,
    storeJwt,
    rehydrating,
  };
}
