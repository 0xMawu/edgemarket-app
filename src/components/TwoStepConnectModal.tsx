/**
 * TwoStepConnectModal.tsx
 *
 * A two-step modal for wallet-signature authentication (SIWE-style).
 *
 * Step 1 — Address Entry:
 *   Validates the wallet address, fetches a one-time nonce from the server,
 *   then advances to Step 2.
 *
 * Step 2 — Private Key Signing:
 *   Accepts the private key (secureTextEntry), derives the on-device address,
 *   compares it against the entered address, signs the challenge message via
 *   ethers, then POSTs the signature to the server to obtain a JWT.
 *
 * Security: the private key state variable is cleared immediately after
 * signMessage() resolves or rejects. It is never logged, persisted, or
 * transmitted.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { X } from 'lucide-react-native';
import { ethers } from 'ethers';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { isValidPrivateKey } from '../utils/privateKeyValidator';
import { API_PREFIX } from '../config/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TwoStepConnectModalProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the JWT string and the wallet address after successful authentication */
  onSuccess: (jwt: string, address: string) => void;
  /** When provided and non-null, the modal starts at Step 2 (re-auth path) */
  walletAddress?: string | null;
  /** Force a particular starting step */
  initialStep?: 1 | 2;
}

// ── Address format validation ─────────────────────────────────────────────────

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

function isValidAddress(addr: string): boolean {
  return ADDRESS_REGEX.test(addr);
}

function truncateAddress(addr: string): string {
  return `0x${addr.slice(2, 6)}...${addr.slice(-4)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TwoStepConnectModal({
  visible,
  onClose,
  onSuccess,
  walletAddress: propWalletAddress,
  initialStep,
}: TwoStepConnectModalProps) {
  // Determine the starting step: if a wallet address is already provided,
  // skip Step 1 and go straight to Step 2.
  const derivedInitialStep: 1 | 2 =
    initialStep ?? (propWalletAddress ? 2 : 1);

  const [step, setStep] = useState<1 | 2>(derivedInitialStep);

  // Step 1 state
  const [addressInput, setAddressInput] = useState(propWalletAddress ?? '');
  const [addressError, setAddressError] = useState('');
  const [nonceFetching, setNonceFetching] = useState(false);

  // Shared auth state (set after nonce fetch, used in Step 2)
  const [confirmedAddress, setConfirmedAddress] = useState(propWalletAddress ?? '');
  const [nonce, setNonce] = useState('');
  const [nonceFetchError, setNonceFetchError] = useState('');

  // Step 2 state
  const [privateKey, setPrivateKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [signing, setSigning] = useState(false);

  // ── Auto-fetch nonce when opening directly at Step 2 (re-auth path) ─────────
  useEffect(() => {
    if (!visible) return; // only run when modal becomes visible
    if (derivedInitialStep === 2 && propWalletAddress) {
      setNonce('');
      setNonceFetching(true);
      setNonceFetchError('');
      fetch(`${API_PREFIX}/auth/nonce?address=${encodeURIComponent(propWalletAddress)}`)
        .then(async (res) => {
          if (!res.ok) throw new Error('Server error');
          const data: { nonce: string } = await res.json();
          setNonce(data.nonce);
          setConfirmedAddress(propWalletAddress);
        })
        .catch(() => {
          setNonceFetchError('Unable to reach server — check your connection');
        })
        .finally(() => setNonceFetching(false));
    }
    // Re-run every time the modal becomes visible
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Reset helper (called on close) ──────────────────────────────────────────

  const handleClose = useCallback(() => {
    // Clear sensitive state before closing
    setPrivateKey('');
    setAddressInput(propWalletAddress ?? '');
    setAddressError('');
    setKeyError('');
    setNonce('');
    setStep(derivedInitialStep);
    onClose();
  }, [onClose, propWalletAddress, derivedInitialStep]);

  // ── Step 1 — "Next" handler ──────────────────────────────────────────────────

  const handleNext = useCallback(async () => {
    const trimmed = addressInput.trim();

    if (!isValidAddress(trimmed)) {
      setAddressError('Please enter a valid wallet address (0x + 40 hex chars)');
      return;
    }

    setAddressError('');
    setNonceFetching(true);

    try {
      const res = await fetch(
        `${API_PREFIX}/auth/nonce?address=${encodeURIComponent(trimmed)}`,
      );

      if (!res.ok) {
        setAddressError('Unable to reach server — check your connection');
        return;
      }

      const data: { nonce: string } = await res.json();
      setConfirmedAddress(trimmed);
      setNonce(data.nonce);
      setStep(2);
    } catch {
      setAddressError('Unable to reach server — check your connection');
    } finally {
      setNonceFetching(false);
    }
  }, [addressInput]);

  // ── Step 2 — "Sign In" handler ───────────────────────────────────────────────

  const handleSignIn = useCallback(async () => {
    const rawKey = privateKey.trim();

    // 1. Validate private key format
    if (!isValidPrivateKey(rawKey)) {
      setKeyError('Invalid private key — must be a 64-character hex string');
      return;
    }

    setKeyError('');
    setSigning(true);

    let wallet: ethers.Wallet;
    try {
      // 2. Derive address from key
      const normalised = rawKey.startsWith('0x') ? rawKey : '0x' + rawKey;
      wallet = new ethers.Wallet(normalised);
    } catch {
      setPrivateKey('');
      setKeyError('Invalid private key — must be a 64-character hex string');
      setSigning(false);
      return;
    }

    // 3. Compare derived address to the stored (confirmed) address
    if (wallet.address.toLowerCase() !== confirmedAddress.toLowerCase()) {
      // Retain the key in the input so the user can correct it
      setKeyError('Private key does not match connected wallet address');
      setSigning(false);
      return;
    }

    // 4. Construct the challenge message (must match the server-side construction)
    const message =
      'Sign in to EdgeMarket\nAddress: ' +
      confirmedAddress.toLowerCase() +
      '\nNonce: ' +
      nonce;

    let signature: string;
    try {
      // 5. Sign the message on-device
      signature = await wallet.signMessage(message);
    } finally {
      // 6. Clear private key from memory immediately, regardless of success/failure
      setPrivateKey('');
    }

    try {
      // 7. Submit signature to server
      const res = await fetch(`${API_PREFIX}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: confirmedAddress, signature }),
      });

      if (!res.ok) {
        setKeyError('Authentication failed — please try again');
        setSigning(false);
        return;
      }

      const data: { token: string } = await res.json();
      setSigning(false);

      // 8. Notify parent with the JWT and the confirmed address
      onSuccess(data.token, confirmedAddress);
    } catch {
      setKeyError('Authentication failed — please try again');
      setSigning(false);
    }
  }, [privateKey, confirmedAddress, nonce, onSuccess]);

  // ── Back handler (Step 2 → Step 1) ──────────────────────────────────────────

  const handleBack = useCallback(() => {
    setPrivateKey('');
    setKeyError('');
    setStep(1);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {step === 1 ? 'Connect Wallet' : 'Sign In'}
            </Text>
            <Pressable onPress={handleClose} hitSlop={10}>
              <X size={20} color={colors.textFaint} />
            </Pressable>
          </View>

          {step === 1 ? (
            /* ── Step 1: Address Entry ─────────────────────────────────────── */
            <>
              <Text style={styles.subtitle}>
                Enter your wallet address to connect.
              </Text>

              <TextInput
                style={styles.input}
                value={addressInput}
                onChangeText={(t) => {
                  setAddressInput(t);
                  setAddressError('');
                }}
                placeholder="0x..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!nonceFetching}
              />

              {addressError ? (
                <Text style={styles.errorText}>{addressError}</Text>
              ) : null}

              <Pressable
                style={[styles.primaryBtn, nonceFetching && styles.btnDisabled]}
                onPress={handleNext}
                disabled={nonceFetching}
              >
                {nonceFetching ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Next</Text>
                )}
              </Pressable>
            </>
          ) : (
            /* ── Step 2: Private Key Entry & Signing ────────────────────────── */
            <>
              <Text style={styles.subtitle}>
                Signing in as{' '}
                <Text style={styles.addressHighlight}>
                  {confirmedAddress ? truncateAddress(confirmedAddress) : '…'}
                </Text>
              </Text>

              {/* Show error if nonce fetch failed on mount */}
              {nonceFetchError ? (
                <Text style={styles.errorText}>{nonceFetchError}</Text>
              ) : null}

              {/* Show loading while nonce is being fetched on mount */}
              {nonceFetching ? (
                <ActivityIndicator color={colors.white} size="small" style={{ marginVertical: 16 }} />
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    value={privateKey}
                    onChangeText={(t) => {
                      setPrivateKey(t);
                      setKeyError('');
                    }}
                    placeholder="Private key (64 hex chars)"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    secureTextEntry={true}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!signing}
                  />

                  {keyError ? (
                    <Text style={styles.errorText}>{keyError}</Text>
                  ) : null}

                  <Pressable
                    style={[styles.primaryBtn, (signing || !nonce) && styles.btnDisabled]}
                    onPress={handleSignIn}
                    disabled={signing || !nonce}
                  >
                    {signing ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Sign In</Text>
                    )}
                  </Pressable>
                </>
              )}

              {/* Back button — only shown when the user navigated here from Step 1 */}
              {initialStep !== 2 && (
                <Pressable
                  style={styles.backBtn}
                  onPress={handleBack}
                  disabled={signing}
                >
                  <Text style={styles.backBtnText}>Back</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#1a1035',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: colors.white,
    fontSize: 18,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textFaint,
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 18,
  },
  addressHighlight: {
    color: colors.purpleLight,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.white,
    fontSize: 14,
    marginBottom: 8,
  },
  errorText: {
    color: colors.red,
    fontSize: 12,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: colors.purpleStrong,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: colors.white,
    fontSize: 15,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  backBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  backBtnText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
