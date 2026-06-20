/**
 * DiscoverScreen.tsx
 *
 * 6th tab — Browse active Polymarket markets with category filters and
 * sort options. Data is proxied through /api/markets on the backend
 * (mirrors the /api/traders pattern), with a direct-API fallback.
 *
 * Watchlist: any market can be pinned via the pin icon on its card. Pinned
 * markets show up under a "Pinned" filter chip and track YES-price movement
 * over time (persisted locally via useWatchlist / AsyncStorage — no backend
 * involved, same pattern as usePortfolioHistory).
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Compass, TrendingUp, Droplets, Clock, AlertCircle, Pin } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { API_PREFIX } from '../config/api';
import { useWatchlist } from '../hooks/useWatchlist';

// ── Backend / API URLs ─────────────────────────────────────────────────────
// As of Phase 6, /api/markets is served by the Spring Boot backend
// (spring-server/, port 8080) — the Node.js proxy has been merged in.

const MARKETS_PROXY_URL = `${API_PREFIX}/markets`;
const MARKETS_DIRECT_URL = 'https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=50';

// ── Types ──────────────────────────────────────────────────────────────────

interface RawMarket {
  id?: string;
  conditionId?: string;
  question: string;
  category?: string;
  tags?: string[];
  events?: { title?: string }[];
  volume24hr?: number;
  volumeNum?: number;
  liquidityNum?: number;
  endDate?: string;
  outcomes?: string;       // JSON-encoded array, e.g. '["Yes","No"]'
  outcomePrices?: string;  // JSON-encoded array, e.g. '["0.53","0.47"]'
  active?: boolean;
  closed?: boolean;
}

interface Market {
  id: string;
  question: string;
  category: string;
  volume24h: number;
  liquidity: number;
  endDateIso: string | null;
  yesPrice: number;
  noPrice: number;
}

type SortKey = 'volume' | 'liquidity' | 'newest';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'volume', label: 'Volume' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'newest', label: 'Newest' },
];

// Sentinel value for selectedCategory that means "show only pinned markets"
// rather than an actual market category.
const PINNED_FILTER = '__pinned__';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function daysUntil(isoDate: string | null): string {
  if (!isoDate) return 'No end date';
  const diff = Math.round((new Date(isoDate).getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return 'Closed';
  if (diff === 0) return 'Closes today';
  if (diff === 1) return 'Closes tomorrow';
  return `Closes in ${diff}d`;
}

function formatDelta(currentYes: number, firstYes: number): string {
  const diffCents = Math.round((currentYes - firstYes) * 100);
  if (diffCents === 0) return 'flat since pinned';
  const sign = diffCents > 0 ? '+' : '';
  return `${sign}${diffCents}¢ YES since pinned`;
}

function mapMarket(raw: RawMarket): Market {
  let outcomes: string[] = [];
  let prices: number[] = [];
  try {
    outcomes = raw.outcomes ? JSON.parse(raw.outcomes) : [];
    prices = raw.outcomePrices ? JSON.parse(raw.outcomePrices).map(Number) : [];
  } catch {
    // leave defaults
  }

  const yesIdx = outcomes.findIndex((o) => o?.toLowerCase() === 'yes');
  const noIdx = outcomes.findIndex((o) => o?.toLowerCase() === 'no');

  const tag = raw.category ?? raw.tags?.[0] ?? raw.events?.[0]?.title ?? 'Other';

  return {
    id: raw.id ?? raw.conditionId ?? raw.question,
    question: raw.question ?? 'Unknown Market',
    category: tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase(),
    volume24h: raw.volume24hr ?? raw.volumeNum ?? 0,
    liquidity: raw.liquidityNum ?? 0,
    endDateIso: raw.endDate ?? null,
    yesPrice: yesIdx >= 0 ? prices[yesIdx] : prices[0] ?? 0.5,
    noPrice: noIdx >= 0 ? prices[noIdx] : prices[1] ?? 0.5,
  };
}

async function fetchMarkets(): Promise<Market[]> {
  let res: Response;
  try {
    res = await fetch(MARKETS_PROXY_URL);
    if (!res.ok) throw new Error(`proxy ${res.status}`);
  } catch {
    res = await fetch(MARKETS_DIRECT_URL);
    if (!res.ok) throw new Error(`direct API ${res.status}`);
  }

  const json = await res.json();
  // gamma-api returns either an array or { data: [...] }
  const raw: RawMarket[] = Array.isArray(json) ? json : json.data ?? [];
  return raw.filter((m) => m.active !== false && m.closed !== true).map(mapMarket);
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CategoryBadge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function PriceBar({ yes, no }: { yes: number; no: number }) {
  const yesPct = Math.round(yes * 100);
  const noPct = Math.round(no * 100);
  return (
    <View style={styles.priceRow}>
      <View style={styles.priceBarWrap}>
        <View style={[styles.priceBarFill, { flex: yes, backgroundColor: colors.green }]} />
        <View style={[styles.priceBarFill, { flex: no, backgroundColor: colors.red }]} />
      </View>
      <View style={styles.priceLabelRow}>
        <Text style={[styles.priceLabel, { color: colors.green }]}>YES {yesPct}¢</Text>
        <Text style={[styles.priceLabel, { color: colors.red }]}>NO {noPct}¢</Text>
      </View>
    </View>
  );
}

function MarketCard({
  market,
  pinned,
  onTogglePin,
  pinDelta,
}: {
  market: Market;
  pinned: boolean;
  onTogglePin: () => void;
  pinDelta: string | null;
}) {
  const closing = daysUntil(market.endDateIso);
  const closingColor = closing === 'Closed' ? colors.red : closing.includes('today') ? colors.yellow : colors.textMuted;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <CategoryBadge label={market.category} />
        <View style={styles.cardTopRight}>
          <Text style={[styles.closing, { color: closingColor }]}>{closing}</Text>
          <Pressable
            onPress={onTogglePin}
            style={styles.pinBtn}
            hitSlop={8}
            accessibilityLabel={pinned ? 'Unpin market' : 'Pin market'}
          >
            <Pin
              size={15}
              color={pinned ? colors.yellow : colors.textFainter}
              fill={pinned ? colors.yellow : 'transparent'}
            />
          </Pressable>
        </View>
      </View>
      <Text style={styles.question} numberOfLines={3}>{market.question}</Text>
      <PriceBar yes={market.yesPrice} no={market.noPrice} />
      {pinned && pinDelta && <Text style={styles.pinDelta}>{pinDelta}</Text>}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <TrendingUp size={11} color={colors.textFaint} />
          <Text style={styles.statText}>{formatUSD(market.volume24h)} 24h vol</Text>
        </View>
        <View style={styles.statItem}>
          <Droplets size={11} color={colors.textFaint} />
          <Text style={styles.statText}>{formatUSD(market.liquidity)} liq</Text>
        </View>
      </View>
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export function DiscoverScreen() {
  const [allMarkets, setAllMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const { pinnedIds, isPinned, togglePin, getHistory, recordPrices } = useWatchlist();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const markets = await fetchMarkets();
      setAllMarkets(markets);
      recordPrices(markets.map((m) => ({ id: m.id, yesPrice: m.yesPrice })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load markets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [recordPrices]);

  useEffect(() => { load(); }, [load]);

  // Derive categories list from data
  const categories = React.useMemo(() => {
    const cats = Array.from(new Set(allMarkets.map((m) => m.category))).sort();
    return cats;
  }, [allMarkets]);

  // Filter + sort
  const filtered = React.useMemo(() => {
    let list = selectedCategory === PINNED_FILTER
      ? allMarkets.filter((m) => pinnedIds.includes(m.id))
      : selectedCategory
      ? allMarkets.filter((m) => m.category === selectedCategory)
      : allMarkets;

    if (sortKey === 'volume') list = [...list].sort((a, b) => b.volume24h - a.volume24h);
    else if (sortKey === 'liquidity') list = [...list].sort((a, b) => b.liquidity - a.liquidity);
    else if (sortKey === 'newest') list = [...list].sort((a, b) => {
      const da = a.endDateIso ? new Date(a.endDateIso).getTime() : 0;
      const db = b.endDateIso ? new Date(b.endDateIso).getTime() : 0;
      return db - da;
    });

    return list;
  }, [allMarkets, selectedCategory, sortKey, pinnedIds]);

  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Compass size={20} color={colors.purple} />
            <Text style={styles.title}>Discover</Text>
          </View>
          <Text style={styles.subtitle}>{allMarkets.length} active markets</Text>
        </View>

        {/* Filter bar */}
        {!loading && !error && (
          <View style={styles.filterSection}>
            {/* Sort chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {SORT_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  style={[styles.chip, sortKey === opt.key && styles.chipActive]}
                  onPress={() => setSortKey(opt.key)}
                >
                  <Text style={[styles.chipText, sortKey === opt.key && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Category chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {pinnedIds.length > 0 && (
                <Pressable
                  style={[styles.chip, styles.pinChip, selectedCategory === PINNED_FILTER && styles.pinChipActive]}
                  onPress={() => setSelectedCategory(selectedCategory === PINNED_FILTER ? null : PINNED_FILTER)}
                >
                  <Pin size={11} color={selectedCategory === PINNED_FILTER ? colors.yellow : colors.textMuted} />
                  <Text style={[styles.chipText, selectedCategory === PINNED_FILTER && { color: colors.yellow }]}>
                    {' '}Pinned ({pinnedIds.length})
                  </Text>
                </Pressable>
              )}
              <Pressable
                style={[styles.chip, selectedCategory === null && styles.chipActive]}
                onPress={() => setSelectedCategory(null)}
              >
                <Text style={[styles.chipText, selectedCategory === null && styles.chipTextActive]}>
                  All
                </Text>
              </Pressable>
              {categories.map((cat) => (
                <Pressable
                  key={cat}
                  style={[styles.chip, selectedCategory === cat && styles.chipActive]}
                  onPress={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
                >
                  <Text style={[styles.chipText, selectedCategory === cat && styles.chipTextActive]}>
                    {cat}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Loading */}
        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.purple} />
            <Text style={styles.loadingText}>Loading markets…</Text>
          </View>
        )}

        {/* Error */}
        {!loading && error && (
          <View style={styles.centered}>
            <View style={styles.errorCard}>
              <AlertCircle size={28} color={colors.red} />
              <Text style={styles.errorTitle}>Couldn't load markets</Text>
              <Text style={styles.errorMessage}>{error}</Text>
              <Pressable style={styles.retryBtn} onPress={() => load()}>
                <Text style={styles.retryText}>Try Again</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Empty */}
        {!loading && !error && filtered.length === 0 && (
          <View style={styles.centered}>
            <Compass size={40} color={colors.textFainter} />
            <Text style={styles.emptyTitle}>
              {selectedCategory === PINNED_FILTER ? 'No pinned markets yet' : 'No markets found'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {selectedCategory === PINNED_FILTER
                ? 'Tap the pin icon on a market to track it here'
                : 'Try a different category or sort'}
            </Text>
          </View>
        )}

        {/* List */}
        {!loading && !error && filtered.length > 0 && (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const pinned = isPinned(item.id);
              const hist = pinned ? getHistory(item.id) : [];
              const pinDelta = hist.length > 0 ? formatDelta(item.yesPrice, hist[0].yesPrice) : null;
              return (
                <MarketCard
                  market={item}
                  pinned={pinned}
                  onTogglePin={() => togglePin(item.id)}
                  pinDelta={pinDelta}
                />
              );
            }}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load(true)}
                tintColor={colors.purple}
              />
            }
          />
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.white, fontSize: 22, fontFamily: fonts.bold, fontWeight: '700' },
  subtitle: { color: colors.textFaint, fontSize: 12 },
  filterSection: { paddingBottom: 4 },
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
  chipText: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.medium, fontWeight: '500' },
  chipTextActive: { color: colors.purple },
  pinChip: { flexDirection: 'row', alignItems: 'center' },
  pinChipActive: {
    backgroundColor: 'rgba(250,204,21,0.18)',
    borderColor: colors.yellow,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { color: colors.textFaint, marginTop: 12, fontSize: 14 },
  errorCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    maxWidth: 300,
  },
  errorTitle: { color: colors.white, fontSize: 16, fontFamily: fonts.semiBold, fontWeight: '600' },
  errorMessage: { color: colors.textFaint, fontSize: 13, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    backgroundColor: colors.purpleStrong,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryText: { color: colors.white, fontSize: 13, fontFamily: fonts.semiBold, fontWeight: '600' },
  emptyTitle: { color: colors.white, fontSize: 16, fontFamily: fonts.semiBold, fontWeight: '600', marginTop: 12 },
  emptySubtitle: { color: colors.textFaint, fontSize: 13, marginTop: 4 },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100 },
  // Market card
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTopRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pinBtn: { padding: 2 },
  badge: {
    backgroundColor: 'rgba(139,92,246,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.35)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { color: colors.purple, fontSize: 10, fontFamily: fonts.semiBold, fontWeight: '600' },
  closing: { fontSize: 11 },
  question: { color: colors.white, fontSize: 13, fontFamily: fonts.medium, fontWeight: '500', lineHeight: 18, marginBottom: 12 },
  priceRow: { marginBottom: 10 },
  priceBarWrap: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginBottom: 6,
  },
  priceBarFill: { height: 6 },
  priceLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  priceLabel: { fontSize: 11, fontFamily: fonts.semiBold, fontWeight: '600' },
  pinDelta: { color: colors.yellow, fontSize: 11, fontFamily: fonts.medium, fontWeight: '500', marginTop: -4, marginBottom: 10 },
  statsRow: { flexDirection: 'row', gap: 16 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: colors.textFaint, fontSize: 11 },
});