import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Zap, Copy, Search } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { useFollowing } from '../hooks/useFollowing';

const POLL_INTERVAL_MS = 60 * 1000;

// ── Phase 4: Advanced Signal Filters ────────────────────────────────────────
// Filters are applied client-side over the merged trade feed:
//   - Outcome:    All / YES / NO
//   - Min size:   preset USDC thresholds
//   - Market:     free-text search over the market title
// (Trade objects from gamma-api don't carry a market "category" field, so a
// market-title search is used in place of a category filter — see Phase 4
// brief for details.)

type OutcomeFilter = 'ALL' | 'YES' | 'NO';

const MIN_SIZE_OPTIONS: { key: number; label: string }[] = [
  { key: 0, label: 'Any size' },
  { key: 100, label: '$100+' },
  { key: 500, label: '$500+' },
  { key: 1000, label: '$1k+' },
  { key: 5000, label: '$5k+' },
];

// ── Polymarket trade shape (data-api.polymarket.com/trades) ────────────────
interface RawTrade {
  transactionHash?: string;
  proxyWallet: string;
  outcome: string;      // "Yes" | "No"
  size: number;         // token amount
  price: number;        // 0-1
  timestamp: number;    // unix seconds
  title?: string;       // market title
  eventSlug?: string;   // event slug for deep-link
  side?: string;
}

interface Trade {
  id: string;
  makerAddress: string;
  marketName: string;
  side: 'YES' | 'NO';
  sizeUSDC: number;
  timestamp: number;
  eventSlug: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function fetchTradesForAddress(address: string): Promise<Trade[]> {
  try {
    const res = await fetch(
      `https://data-api.polymarket.com/trades?user=${address}&limit=50`
    );
    if (!res.ok) return [];
    const json: RawTrade[] = await res.json();
    if (!Array.isArray(json)) return [];

    return json.map((t) => ({
      id: t.transactionHash ?? `${address}-${t.timestamp}`,
      makerAddress: t.proxyWallet ?? address,
      marketName: t.title ?? 'Unknown Market',
      side: t.outcome?.toLowerCase() === 'no' ? 'NO' : 'YES',
      sizeUSDC: (t.size ?? 0) * (t.price ?? 0),
      timestamp: t.timestamp,
      eventSlug: t.eventSlug ?? '',
    }));
  } catch {
    return [];
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

interface TradeCardProps {
  trade: Trade;
  onCopy: () => void;
}

function TradeCard({ trade, onCopy }: TradeCardProps) {
  return (
    <View style={cardStyles.card}>
      {/* Header row */}
      <View style={cardStyles.headerRow}>
        <View style={cardStyles.addressWrap}>
          <Text style={cardStyles.address}>{shortAddress(trade.makerAddress)}</Text>
        </View>
        <Text style={cardStyles.time}>{timeAgo(trade.timestamp)}</Text>
      </View>

      {/* Market name */}
      <Text style={cardStyles.market} numberOfLines={2}>
        {trade.marketName}
      </Text>

      {/* Footer row */}
      <View style={cardStyles.footerRow}>
        <View style={[cardStyles.sideBadge, trade.side === 'YES' ? cardStyles.yesBadge : cardStyles.noBadge]}>
          <Text style={[cardStyles.sideText, trade.side === 'YES' ? cardStyles.yesText : cardStyles.noText]}>
            {trade.side}
          </Text>
        </View>
        <Text style={cardStyles.size}>
          ${trade.sizeUSDC.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDC
        </Text>
        <Pressable onPress={onCopy} style={cardStyles.copyBtn} hitSlop={8}>
          <Copy size={13} color={colors.purple} />
          <Text style={cardStyles.copyText}>Copy Trade</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────

export function SignalFeedScreen() {
  const { followingIds } = useFollowing();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Phase 4: advanced filters
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [minSize, setMinSize] = useState<number>(0);
  const [marketQuery, setMarketQuery] = useState('');

  const fetchAll = useCallback(async () => {
    if (followingIds.length === 0) {
      setTrades([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(followingIds.map(fetchTradesForAddress));
      const merged = results
        .flat()
        .sort((a, b) => b.timestamp - a.timestamp);
      setTrades(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signals');
    } finally {
      setLoading(false);
    }
  }, [followingIds]);

  // Initial fetch + polling at 60s interval.
  // Use a ref for the following IDs so the interval doesn't restart on every
  // follow/unfollow — only the scheduled fetch picks up the latest list.
  const followingIdsRef = useRef(followingIds);
  useEffect(() => {
    followingIdsRef.current = followingIds;
  }, [followingIds]);

  useEffect(() => {
    // Initial fetch
    fetchAll();

    // Poll every 60s using the ref so the interval is stable
    intervalRef.current = setInterval(async () => {
      if (followingIdsRef.current.length === 0) {
        setTrades([]);
        return;
      }
      try {
        const results = await Promise.all(
          followingIdsRef.current.map(fetchTradesForAddress)
        );
        const merged = results.flat().sort((a, b) => b.timestamp - a.timestamp);
        setTrades(merged);
      } catch {
        // silent — keep showing last known data
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — interval is stable, ref tracks followingIds

  const handleCopy = useCallback(async (trade: Trade) => {
    const url = trade.eventSlug
      ? `https://polymarket.com/event/${trade.eventSlug}`
      : `https://polymarket.com`;
    await Clipboard.setStringAsync(url);
    setCopiedId(trade.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Phase 4: apply outcome / min-size / market-name filters
  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (outcomeFilter !== 'ALL' && t.side !== outcomeFilter) return false;
      if (t.sizeUSDC < minSize) return false;
      if (marketQuery && !t.marketName.toLowerCase().includes(marketQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [trades, outcomeFilter, minSize, marketQuery]);

  // ── Empty state ──────────────────────────────────────────────────────
  if (!loading && followingIds.length === 0) {
    return (
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.title}>Signal Feed</Text>
            <Text style={styles.subtitle}>Live trades from followed wallets</Text>
          </View>
          <View style={styles.emptyContainer}>
            <Zap size={48} color={colors.purple} style={{ marginBottom: 16 }} />
            <Text style={styles.emptyTitle}>No signals yet</Text>
            <Text style={styles.emptySub}>
              Follow traders to see their signals here.
            </Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────
  if (loading && trades.length === 0) {
    return (
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.title}>Signal Feed</Text>
            <Text style={styles.subtitle}>Live trades from followed wallets</Text>
          </View>
          <ActivityIndicator size="large" color={colors.purple} style={{ marginTop: 80 }} />
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────
  if (error) {
    return (
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.title}>Signal Feed</Text>
          </View>
          <View style={styles.emptyContainer}>
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={fetchAll} style={styles.retryBtn}>
                <Text style={styles.retryText}>Try Again</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ── Feed ─────────────────────────────────────────────────────────────
  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList
          data={filteredTrades}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View>
              <View style={styles.header}>
                <Text style={styles.title}>Signal Feed</Text>
                <Text style={styles.subtitle}>
                  {filteredTrades.length} signal{filteredTrades.length !== 1 ? 's' : ''}
                  {filteredTrades.length !== trades.length ? ` (of ${trades.length})` : ''} · updates every 60s
                </Text>
              </View>

              {/* Phase 4: Advanced Signal Filters */}
              <View style={styles.filterSection}>
                {/* Outcome filter */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {(['ALL', 'YES', 'NO'] as OutcomeFilter[]).map((opt) => (
                    <Pressable
                      key={opt}
                      style={[styles.chip, outcomeFilter === opt && styles.chipActive]}
                      onPress={() => setOutcomeFilter(opt)}
                    >
                      <Text style={[styles.chipText, outcomeFilter === opt && styles.chipTextActive]}>
                        {opt === 'ALL' ? 'All Outcomes' : opt}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Min size filter */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {MIN_SIZE_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.key}
                      style={[styles.chip, minSize === opt.key && styles.chipActive]}
                      onPress={() => setMinSize(opt.key)}
                    >
                      <Text style={[styles.chipText, minSize === opt.key && styles.chipTextActive]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Market name search */}
                <View style={styles.searchWrap}>
                  <Search size={14} color={colors.textFaint} style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Filter by market name..."
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    value={marketQuery}
                    onChangeText={setMarketQuery}
                  />
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No matching signals</Text>
              <Text style={styles.emptySub}>Try adjusting your filters.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TradeCard
              trade={item}
              onCopy={() => handleCopy(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={fetchAll}
              tintColor={colors.purple}
            />
          }
        />
      </SafeAreaView>
    </LinearGradient>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 16, marginBottom: 12 },
  title: { color: '#fff', fontSize: 24, fontFamily: fonts.semiBold, fontWeight: '600', marginBottom: 4 },
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  filterSection: { paddingBottom: 8 },
  chipRow: { paddingHorizontal: 16, paddingVertical: 6, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipActive: {
    backgroundColor: 'rgba(168,85,247,0.25)',
    borderColor: colors.purple,
  },
  chipText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: fonts.medium, fontWeight: '500' },
  chipTextActive: { color: colors.purple },
  searchWrap: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    justifyContent: 'center',
  },
  searchIcon: { position: 'absolute', left: 14, zIndex: 1 },
  searchInput: {
    paddingLeft: 38,
    paddingRight: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: 13,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { color: '#fff', fontSize: 17, fontFamily: fonts.semiBold, fontWeight: '600', marginBottom: 8 },
  emptySub: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },
  errorCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.4)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    width: '100%',
  },
  errorText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  retryBtn: {
    backgroundColor: 'rgba(139,92,246,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.5)',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: { color: '#fff', fontFamily: fonts.semiBold, fontWeight: '600', fontSize: 14 },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  addressWrap: {
    backgroundColor: 'rgba(139,92,246,0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  address: { color: '#a78bfa', fontSize: 12, fontFamily: fonts.semiBold, fontWeight: '600' },
  time: { color: 'rgba(255,255,255,0.35)', fontSize: 11 },
  market: { color: '#fff', fontSize: 13, fontFamily: fonts.medium, fontWeight: '500', marginBottom: 10, lineHeight: 18 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sideBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  yesBadge: {
    backgroundColor: 'rgba(52,211,153,0.1)',
    borderColor: 'rgba(52,211,153,0.3)',
  },
  noBadge: {
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderColor: 'rgba(248,113,113,0.3)',
  },
  sideText: { fontSize: 11, fontFamily: fonts.bold, fontWeight: '700' },
  yesText: { color: '#34d399' },
  noText: { color: '#f87171' },
  size: { color: 'rgba(255,255,255,0.6)', fontSize: 12, flex: 1 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  copyText: { color: '#a78bfa', fontSize: 12, fontFamily: fonts.medium, fontWeight: '500' },
});
