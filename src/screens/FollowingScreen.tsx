import React from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Star } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AccountCard } from '../components/AccountCard';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { useFollowing } from '../hooks/useFollowing';
import { usePolymarket } from '../hooks/usePolymarket';

export function FollowingScreen() {
  const { followingIds, toggleFollow } = useFollowing();
  const { accounts, loading } = usePolymarket();

  // Filter live accounts down to those the user follows (matched by address)
  const followingAccounts = accounts.filter((acc) => followingIds.includes(acc.address));

  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>EdgeMarket</Text>
          <Text style={styles.title}>Following</Text>
          <Text style={styles.subtitle}>Wallets you're tracking</Text>
        </View>

        {/* While initial data loads, show spinner rather than wrongly showing empty state */}
        {loading && followingIds.length > 0 ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={colors.purple} />
          </View>
        ) : followingAccounts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Star size={32} color={colors.purple} />
            </View>
            <Text style={styles.emptyTitle}>Not following anyone yet</Text>
            <Text style={styles.emptyText}>
              Go to "All Accounts" and tap Follow on traders you want to track.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>
                Following {followingAccounts.length} account{followingAccounts.length !== 1 ? 's' : ''}
              </Text>
            </View>
            <FlatList
              data={followingAccounts}
              keyExtractor={(item) => item.address}
              renderItem={({ item }) => (
                <AccountCard
                  account={item}
                  isFollowing={true}
                  onToggleFollow={toggleFollow}
                />
              )}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
            />
          </>
        )}
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
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(168,85,247,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: colors.white,
    fontSize: 18,
    fontFamily: fonts.semiBold, fontWeight: '600',
    marginBottom: 10,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  countBadge: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: 'rgba(168,85,247,0.15)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  countText: { color: '#d8b4fe', fontSize: 13, fontFamily: fonts.medium, fontWeight: '500' },
  list: { paddingHorizontal: 16, paddingBottom: 100 },
});
