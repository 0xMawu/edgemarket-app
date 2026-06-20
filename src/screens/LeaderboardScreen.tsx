/**
 * LeaderboardScreen.tsx
 *
 * Phase 4 — Merges the former "All Accounts" and "Top Accounts" tabs into a
 * single screen to simplify the tab bar from 6 tabs down to 5.
 *
 * - Search box (from the old AllAccountsScreen)
 * - Segmented sort control: All / Top Profit / Top Volume
 *   - "All": original unsorted order from the API, no rank badges
 *   - "Top Profit" / "Top Volume": sorted + ranked (from old TopAccountsScreen)
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList,
  ActivityIndicator, Pressable, RefreshControl,
} from 'react-native';
import { Search, ListFilter, TrendingUp, BarChart2, Award } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountCard } from '../components/AccountCard';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { useFollowing } from '../hooks/useFollowing';
import { usePolymarket } from '../hooks/usePolymarket';

// Local sort type for this screen — extends the old SortType with an
// unranked "all" option. Defined here (not in src/types/index.ts) per the
// "extend via new types if needed, don't modify these" rule.
type LeaderboardSort = 'all' | 'profit' | 'volume' | 'winrate';

const SORT_OPTIONS: { key: LeaderboardSort; label: string; icon: typeof ListFilter }[] = [
  { key: 'all',     label: 'All',        icon: ListFilter },
  { key: 'profit',  label: 'Top Profit', icon: TrendingUp },
  { key: 'volume',  label: 'Top Volume', icon: BarChart2  },
  { key: 'winrate', label: 'Win Rate',   icon: Award      },
];

export function LeaderboardScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<LeaderboardSort>('all');
  const { followingIds, toggleFollow } = useFollowing();
  const { accounts, loading, error, refresh } = usePolymarket();

  const filtered = useMemo(() => {
    if (!searchQuery) return accounts;
    const q = searchQuery.toLowerCase();
    return accounts.filter(
      (acc) =>
        acc.address.toLowerCase().includes(q) ||
        acc.username?.toLowerCase().includes(q)
    );
  }, [searchQuery, accounts]);

  const sorted = useMemo(() => {
    if (sort === 'all') return filtered;
    return [...filtered].sort((a, b) => {
      if (sort === 'profit')  return b.totalPnL - a.totalPnL;
      if (sort === 'volume')  return b.totalVolume - a.totalVolume;
      if (sort === 'winrate') {
        // Accounts with null win rate (insufficient data) go to the bottom
        const wA = a.winRate ?? -1;
        const wB = b.winRate ?? -1;
        return wB - wA;
      }
      return 0;
    });
  }, [sort, filtered]);

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.purple} />
          <Text style={styles.loadingText}>Loading traders…</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={refresh}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.address}
        renderItem={({ item, index }) => (
          <AccountCard
            account={item}
            isFollowing={followingIds.includes(item.address)}
            onToggleFollow={toggleFollow}
            rank={sort === 'all' ? undefined : index + 1}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No accounts found</Text>
        }
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={colors.purple}
            colors={[colors.purple]}
          />
        }
      />
    );
  };

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
          <Text style={styles.eyebrow}>EdgeMarket</Text>
          <Text style={styles.title}>Leaderboard</Text>
          <Text style={styles.subtitle}>Browse and rank tracked wallets</Text>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Search size={15} color={colors.textFaint} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by address or username..."
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Sort segmented control */}
        <View style={styles.sortRow}>
          {SORT_OPTIONS.map(({ key, label, icon: Icon }) => (
            <Pressable
              key={key}
              style={[styles.sortBtn, sort === key && styles.sortBtnActive]}
              onPress={() => setSort(key)}
            >
              <Icon size={14} color={sort === key ? colors.white : colors.textFaint} />
              <Text style={[styles.sortBtnText, sort === key && styles.sortBtnTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {renderContent()}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 16, marginBottom: 16 },
  eyebrow: { color: colors.purple, fontSize: 13, marginBottom: 4 },
  title: { color: colors.white, fontSize: 24, fontFamily: fonts.semiBold, fontWeight: '600', marginBottom: 4 },
  subtitle: { color: colors.textMuted, fontSize: 13 },
  searchWrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    justifyContent: 'center',
  },
  searchIcon: { position: 'absolute', left: 14, zIndex: 1 },
  searchInput: {
    paddingLeft: 40,
    paddingRight: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.white,
    fontSize: 13,
  },
  sortRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  sortBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  sortBtnActive: {
    backgroundColor: colors.purpleStrong,
    borderColor: colors.purple,
  },
  sortBtnText: { color: colors.textFaint, fontSize: 12, fontFamily: fonts.medium, fontWeight: '500' },
  sortBtnTextActive: { color: colors.white },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
  emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 15 },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  loadingText: { color: colors.textMuted, fontSize: 14, marginTop: 8 },
  errorText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.purple,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryBtnText: { color: colors.purple, fontSize: 14, fontFamily: fonts.semiBold, fontWeight: '600' },
});
