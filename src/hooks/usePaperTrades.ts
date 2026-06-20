/**
 * usePaperTrades — fetch and manage a user's paper trading portfolio.
 *
 * copyPositions(targetAddress) mirrors the target wallet's open Polymarket
 * positions into the authenticated user's paper portfolio via the backend.
 * Follows are stored locally; the JWT from useWalletAuth is attached.
 */
import { useState, useEffect, useCallback } from 'react';
import { API_PREFIX } from '../config/api';

export interface PaperTrade {
  id: number;
  targetAddress: string;
  marketId: string;
  marketTitle: string | null;
  outcome: string | null;
  entryPrice: number;
  shares: number;
  livePrice: number | null;
  unrealisedPnl: number | null;
  pnlPercentage: number | null;
  createdAt: string;
}

export interface PaperPortfolio {
  trades: PaperTrade[];
  portfolioSummary: {
    totalTrades: number;
    totalUnrealisedPnl: number;
    groupedByTarget: Record<string, PaperTrade[]>;
  };
}

interface UsePaperTradesOptions {
  userAddress: string | null;
  getJwt: () => string | null;
}

export function usePaperTrades({ userAddress, getJwt }: UsePaperTradesOptions) {
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState<string | null>(null); // targetAddress being copied
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userAddress) {
      setPortfolio(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_PREFIX}/paper-trades/${userAddress}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data: PaperPortfolio = await res.json();
      setPortfolio(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load paper portfolio');
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  // Load on mount and when userAddress changes
  useEffect(() => {
    refresh();
  }, [refresh]);

  const copyPositions = useCallback(async (targetAddress: string) => {
    if (!userAddress) return;
    const jwt = getJwt();
    if (!jwt) {
      setError('Sign in to copy positions');
      return;
    }

    setCopyLoading(targetAddress);
    setError(null);
    try {
      const res = await fetch(`${API_PREFIX}/paper-trades`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ userAddress, targetAddress }),
      });

      if (res.status === 401 || res.status === 403) {
        setError('Authentication required — please sign in again');
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Failed to copy positions');
        return;
      }

      // Reload portfolio after successful copy
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy positions');
    } finally {
      setCopyLoading(null);
    }
  }, [userAddress, getJwt, refresh]);

  return { portfolio, loading, copyLoading, error, refresh, copyPositions };
}
