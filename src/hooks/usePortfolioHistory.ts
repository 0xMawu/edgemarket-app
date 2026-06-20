/**
 * usePortfolioHistory.ts
 *
 * Builds a rolling P&L time series by sampling the aggregate open-position
 * value on every usePolymarket refresh and persisting the last N samples to
 * AsyncStorage (keyed by wallet address).
 *
 * This is the "option 2" approach from the brief: Polymarket's positions
 * endpoint doesn't expose a historical P&L series, so we build one locally.
 * The chart is labelled "Since you started tracking" to set correct expectations.
 *
 * Max samples: 20 (configurable via MAX_SAMPLES).
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PnLSample {
  timestamp: number; // unix ms
  totalPnL: number;
  totalValue: number;
}

const MAX_SAMPLES = 20;
const KEY = (addr: string) => `@edgemarket/portfolio_history_${addr.toLowerCase()}`;

export interface UsePortfolioHistoryResult {
  samples: PnLSample[];
  addSample: (totalPnL: number, totalValue: number) => Promise<void>;
  clearHistory: () => Promise<void>;
}

export function usePortfolioHistory(walletAddress: string | null): UsePortfolioHistoryResult {
  const [samples, setSamples] = useState<PnLSample[]>([]);

  // Load persisted samples when wallet changes
  useEffect(() => {
    if (!walletAddress) {
      setSamples([]);
      return;
    }
    AsyncStorage.getItem(KEY(walletAddress))
      .then((raw) => {
        if (raw) {
          const parsed: PnLSample[] = JSON.parse(raw);
          if (Array.isArray(parsed)) setSamples(parsed);
        } else {
          setSamples([]);
        }
      })
      .catch(() => setSamples([]));
  }, [walletAddress]);

  const addSample = useCallback(
    async (totalPnL: number, totalValue: number) => {
      if (!walletAddress) return;
      const newSample: PnLSample = { timestamp: Date.now(), totalPnL, totalValue };
      setSamples((prev) => {
        const updated = [...prev, newSample].slice(-MAX_SAMPLES);
        AsyncStorage.setItem(KEY(walletAddress!), JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    },
    [walletAddress],
  );

  const clearHistory = useCallback(async () => {
    if (!walletAddress) return;
    await AsyncStorage.removeItem(KEY(walletAddress));
    setSamples([]);
  }, [walletAddress]);

  return { samples, addSample, clearHistory };
}
