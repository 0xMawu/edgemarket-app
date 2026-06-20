import { useState, useEffect, useCallback } from 'react';
import { Account, Position } from '../types';
import { API_PREFIX } from '../config/api';

// ── Backend proxy (avoids CORS + rate-limit issues) ────────────────────────
// As of Phase 6, /api/traders is served by the Spring Boot backend
// (spring-server/, port 8080) — the Node.js proxy has been merged in.
const LEADERBOARD_URL = `${API_PREFIX}/traders`;

// Fallback: hit Polymarket directly if the local backend isn't running
// (e.g. spring-server/ not started). Prevents "Network
// request failed" from killing the whole screen.
const DIRECT_LEADERBOARD_URL =
  'https://data-api.polymarket.com/v1/leaderboard?limit=20&orderBy=PNL&timePeriod=ALL';

// Direct Polymarket positions endpoint — fetch up to 50 positions per trader
// (10 was too few to get enough resolved positions for win rate calculation)
const POSITIONS_URL = (address: string) =>
  `https://data-api.polymarket.com/positions?user=${address}&limit=50&sortBy=CASHPNL&sortDirection=DESC`;

// Closed trades endpoint — used to calculate win rate from actual trade history
// Fetch last 100 trades per trader for accurate win rate calculation
const TRADES_URL = (address: string) =>
  `https://data-api.polymarket.com/trades?user=${address}&limit=100&sortBy=TIMESTAMP&sortDirection=DESC`;

// ── Leaderboard response shape ─────────────────────────────────────────────
interface LeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName?: string;
  vol: number;
  pnl: number;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
}

// ── Positions response shape ───────────────────────────────────────────────
interface PolymarketPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  title?: string;
  slug?: string;
  outcome?: string;
  redeemable: boolean;
}

// ── Trade response shape ───────────────────────────────────────────────────
// Note: the data-api /trades endpoint returns individual order fills.
// cashPnl is only present on REDEEM-type entries, not on regular BUY/SELL fills.
// Win rate is better derived from positions (resolved markets).
interface PolymarketTrade {
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  cashPnl?: number;
  timestamp: number;
  type?: string;       // 'BUY' | 'SELL' | 'REDEEM' (from some API versions)
  outcomeIndex?: number;
  conditionId?: string;
}

// ── Mappers ────────────────────────────────────────────────────────────────

function mapPosition(pos: PolymarketPosition, index: number): Position {
  return {
    id: pos.asset ?? `pos-${index}`,
    marketName: pos.title ?? 'Unknown Market',
    outcome: pos.outcome ?? 'Yes',
    shares: pos.size,
    averagePrice: pos.avgPrice,
    currentPrice: pos.curPrice,
    value: pos.currentValue,
    pnl: pos.cashPnl,
    pnlPercentage: pos.percentPnl,
  };
}

/**
 * Calculate win rate from positions (most reliable) or trades with cashPnl.
 *
 * Priority:
 * 1. Trades where cashPnl is present — these are actual resolved outcomes.
 * 2. Positions with redeemable=true or curPrice near 0/1 — resolved markets.
 * 3. null — not enough data to compute a meaningful win rate.
 *
 * The heuristic fallback (mapping PnL to a win rate) is intentionally removed
 * because it produces the same value for all profitable traders.
 */
function calcWinRate(
  trades: PolymarketTrade[],
  positions: PolymarketPosition[],
): number | null {
  // Method 1: trades that have a real cashPnl (REDEEM entries)
  const settledTrades = trades.filter((t) => typeof t.cashPnl === 'number');
  if (settledTrades.length >= 3) {
    const wins = settledTrades.filter((t) => (t.cashPnl ?? 0) > 0).length;
    return Math.round((wins / settledTrades.length) * 100);
  }

  // Method 2: resolved positions — curPrice near 1 = won, near 0 = lost
  // redeemable=true means the market resolved and this side won ($1 each)
  // curPrice < 0.02 on a held position means the market resolved against you
  const resolvedPositions = positions.filter(
    (p) => p.redeemable || p.curPrice <= 0.02 || p.curPrice >= 0.95
  );
  if (resolvedPositions.length >= 3) {
    const wins = resolvedPositions.filter(
      (p) => p.redeemable || p.curPrice >= 0.95
    ).length;
    return Math.round((wins / resolvedPositions.length) * 100);
  }

  // Method 3: open positions with positive cashPnl (unrealised winners)
  const positionsWithPnl = positions.filter(
    (p) => typeof p.cashPnl === 'number'
  );
  if (positionsWithPnl.length >= 3) {
    const wins = positionsWithPnl.filter((p) => p.cashPnl > 0).length;
    return Math.round((wins / positionsWithPnl.length) * 100);
  }

  // Not enough resolved data to show a meaningful win rate
  return null;
}

// Raw positions fetched per address — needed for calcWinRate and for mapping
type RawPositionMap = Map<string, PolymarketPosition[]>;

function mapEntry(
  entry: LeaderboardEntry,
  rawPositions: PolymarketPosition[],
  trades: PolymarketTrade[],
): Account {
  const totalPnL = entry.pnl ?? 0;
  const totalVolume = entry.vol ?? 0;
  const profitability = totalVolume > 0 ? (totalPnL / totalVolume) * 100 : 0;
  const winRate = calcWinRate(trades, rawPositions);
  const openPositions = rawPositions.map(mapPosition);

  return {
    id: `account-${entry.rank}`,
    address: entry.proxyWallet,
    username: entry.userName || entry.xUsername || undefined,
    totalVolume,
    profitability,
    totalPnL,
    winRate,
    lastActive: new Date().toISOString(),
    openPositions,
  };
}

async function fetchRawPositions(address: string): Promise<PolymarketPosition[]> {
  try {
    const res = await fetch(POSITIONS_URL(address));
    if (!res.ok) return [];
    const json: PolymarketPosition[] = await res.json();
    if (!Array.isArray(json)) return [];
    return json;
  } catch {
    return [];
  }
}

// Kept for ProfileScreen's fetchWalletData which only needs mapped Position[]
async function fetchPositions(address: string): Promise<PolymarketPosition[]> {
  return fetchRawPositions(address);
}

async function fetchTrades(address: string): Promise<PolymarketTrade[]> {
  try {
    const res = await fetch(TRADES_URL(address));
    if (!res.ok) return [];
    const json: PolymarketTrade[] = await res.json();
    if (!Array.isArray(json)) return [];
    return json;
  } catch {
    return [];
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export interface UsePolymarketResult {
  accounts: Account[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetch positions only for a single wallet address (profile P&L display).
 * Trades are not needed here — win rate is only shown on the leaderboard.
 */
export async function fetchWalletData(address: string): Promise<{
  positions: Position[];
  totalPnL: number;
  winRate: number | null;
}> {
  const rawPositions = await fetchRawPositions(address);
  const positions = rawPositions.map(mapPosition);
  const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0);
  // Win rate for own wallet: derive from positions only (no trades fetch = faster)
  const winRate = calcWinRate([], rawPositions);
  return { positions, totalPnL, winRate };
}

/**
 * Fetch minimal account data for a specific wallet address.
 * Used to display followed traders who may not be in the leaderboard top 20.
 */
export async function fetchAccountData(address: string): Promise<Account> {
  const rawPositions = await fetchRawPositions(address);
  const positions = rawPositions.map(mapPosition);
  const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0);
  const winRate = calcWinRate([], rawPositions);
  return {
    id: `account-${address}`,
    address,
    totalVolume: 0,
    profitability: 0,
    totalPnL,
    winRate,
    lastActive: new Date().toISOString(),
    openPositions: positions,
  };
}

export function usePolymarket(): UsePolymarketResult {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch leaderboard — fast, single request
      let res: Response;
      try {
        res = await fetch(LEADERBOARD_URL);
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
      } catch (proxyErr) {
        console.warn('[usePolymarket] backend proxy unreachable, falling back to direct API:', proxyErr);
        res = await fetch(DIRECT_LEADERBOARD_URL);
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
      }

      const json: LeaderboardEntry[] = await res.json();
      if (!Array.isArray(json)) throw new Error('Unexpected API response format');

      // 2. Show base accounts immediately — no positions/trades yet
      const baseAccounts = json.map((e) => mapEntry(e, [], []));
      setAccounts(baseAccounts);
      setLoading(false); // unblock UI immediately

      // 3. Enrich top 10 only in batches of 3 — positions + trades for win rate.
      // Ranks 11-20 keep base data (PnL/volume from leaderboard is sufficient for display).
      const ENRICH_COUNT = 10;
      const BATCH = 3;
      for (let i = 0; i < Math.min(json.length, ENRICH_COUNT); i += BATCH) {
        const batch = json.slice(i, i + BATCH);
        const [posResults, tradeResults] = await Promise.all([
          Promise.all(batch.map((e) => fetchRawPositions(e.proxyWallet))),
          Promise.all(batch.map((e) => fetchTrades(e.proxyWallet))),
        ]);

        // Merge enriched data into the existing accounts array
        setAccounts((prev) => {
          const next = [...prev];
          batch.forEach((entry, bIdx) => {
            const idx = next.findIndex((a) => a.address === entry.proxyWallet);
            if (idx !== -1) {
              next[idx] = mapEntry(entry, posResults[bIdx], tradeResults[bIdx]);
            }
          });
          return next;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load traders';
      setError(message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { accounts, loading, error, refresh: fetchData };
}
