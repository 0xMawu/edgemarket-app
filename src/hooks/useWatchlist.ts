/**
 * useWatchlist.ts
 *
 * Persists pinned market IDs and tracks their YES-price history via
 * AsyncStorage. Used by DiscoverScreen to let users pin markets and
 * see price movement since pinning.
 *
 * API:
 *  - pinnedIds:    string[]  — array of pinned market IDs
 *  - isPinned:     (id) => boolean
 *  - togglePin:    (id) => void   — pin or unpin a market
 *  - getHistory:   (id) => PricePoint[]  — ordered oldest→newest
 *  - recordPrices: (prices: { id, yesPrice }[]) => void
 *                  — call once after each fetch to update history for
 *                    currently pinned markets
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PricePoint {
  timestamp: number; // unix ms
  yesPrice: number;
}

type PriceHistory = Record<string, PricePoint[]>; // marketId → history

const PINNED_KEY = '@edgemarket/watchlist_pinned';
const HISTORY_KEY = '@edgemarket/watchlist_history';
const MAX_HISTORY_PER_MARKET = 50;

export interface UseWatchlistResult {
  pinnedIds: string[];
  isPinned: (id: string) => boolean;
  togglePin: (id: string) => void;
  getHistory: (id: string) => PricePoint[];
  recordPrices: (prices: { id: string; yesPrice: number }[]) => void;
}

export function useWatchlist(): UseWatchlistResult {
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<PriceHistory>({});

  // Load persisted state on mount
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(PINNED_KEY),
      AsyncStorage.getItem(HISTORY_KEY),
    ])
      .then(([rawPinned, rawHistory]) => {
        if (rawPinned) {
          const parsed = JSON.parse(rawPinned);
          if (Array.isArray(parsed)) setPinnedIds(parsed);
        }
        if (rawHistory) {
          const parsed = JSON.parse(rawHistory);
          if (parsed && typeof parsed === 'object') setHistory(parsed);
        }
      })
      .catch(() => {
        // storage read failed — start fresh
      });
  }, []);

  const isPinned = useCallback(
    (id: string) => pinnedIds.includes(id),
    [pinnedIds],
  );

  const togglePin = useCallback(
    (id: string) => {
      setPinnedIds((prev) => {
        const next = prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id];
        AsyncStorage.setItem(PINNED_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });

      // When unpinning, clean up the price history for that market
      setHistory((prev) => {
        if (!prev[id]) return prev;
        const { [id]: _removed, ...rest } = prev;
        AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(rest)).catch(() => {});
        return rest;
      });
    },
    [],
  );

  const getHistory = useCallback(
    (id: string): PricePoint[] => history[id] ?? [],
    [history],
  );

  /**
   * Called after every market fetch. Appends a new price point for each
   * currently pinned market — skipping if the price hasn't changed to
   * avoid noisy flat lines.
   */
  const recordPrices = useCallback(
    (prices: { id: string; yesPrice: number }[]) => {
      setPinnedIds((currentPinned) => {
        if (currentPinned.length === 0) return currentPinned;

        setHistory((prevHistory) => {
          const now = Date.now();
          let changed = false;
          const next = { ...prevHistory };

          for (const { id, yesPrice } of prices) {
            if (!currentPinned.includes(id)) continue;

            const existing = next[id] ?? [];
            const last = existing[existing.length - 1];

            // Skip if price hasn't moved (avoid storing duplicates)
            if (last && last.yesPrice === yesPrice) continue;

            changed = true;
            next[id] = [
              ...existing,
              { timestamp: now, yesPrice },
            ].slice(-MAX_HISTORY_PER_MARKET);
          }

          if (!changed) return prevHistory;
          AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });

        return currentPinned;
      });
    },
    [],
  );

  return { pinnedIds, isPinned, togglePin, getHistory, recordPrices };
}
