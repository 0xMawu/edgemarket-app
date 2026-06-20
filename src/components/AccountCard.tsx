import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Copy, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Account } from '../types';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { PositionCard } from './PositionCard';
import { formatCompact, formatPnl, formatPct } from '../utils/formatCurrency';

interface Props {
  account: Account;
  isFollowing: boolean;
  onToggleFollow: (id: string) => void;
  rank?: number;
}

function formatTimestamp(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AccountCard({ account, isFollowing, onToggleFollow, rank }: Props) {
  const [expanded, setExpanded] = useState(false);
  const profitColor = account.profitability >= 0 ? colors.green : colors.red;
  const pnlColor = account.totalPnL >= 0 ? colors.green : colors.red;

  const copyAddress = async () => {
    await Clipboard.setStringAsync(account.address);
    Alert.alert('Copied', 'Address copied to clipboard');
  };

  const openPolygonscan = () => {
    Linking.openURL(`https://polygonscan.com/address/${account.address}`);
  };

  const shortAddress = `${account.address.slice(0, 6)}...${account.address.slice(-4)}`;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {rank !== undefined && (
            <View style={[
              styles.rankBadge,
              rank === 1 ? { backgroundColor: colors.yellow }
              : rank === 2 ? { backgroundColor: colors.gray }
              : rank === 3 ? { backgroundColor: colors.orange }
              : { backgroundColor: 'rgba(255,255,255,0.15)' },
            ]}>
              <Text style={styles.rankText}>{rank}</Text>
            </View>
          )}
          <View style={styles.flex}>
            {account.username ? (
              <Text style={styles.username}>{account.username}</Text>
            ) : null}
            <View style={styles.addressRow}>
              <Text style={styles.address}>{shortAddress}</Text>
              <Pressable onPress={copyAddress} style={styles.iconBtn}>
                <Copy size={11} color={colors.textFaint} />
              </Pressable>
              <Pressable onPress={openPolygonscan} style={styles.iconBtn}>
                <ExternalLink size={11} color={colors.textFaint} />
              </Pressable>
            </View>
            <Text style={styles.lastActive}>Active {formatTimestamp(account.lastActive)}</Text>
          </View>
        </View>

        <Pressable
          style={[styles.followBtn, isFollowing && styles.followBtnActive]}
          onPress={() => onToggleFollow(account.address)}
        >
          <Text style={[styles.followBtnText, isFollowing && { color: colors.purple }]}>
            {isFollowing ? 'Unfollow' : 'Follow'}
          </Text>
        </Pressable>
      </View>

      {/* Stats */}
      <View style={styles.statsGrid}>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>Total Volume</Text>
          <Text style={styles.statValue}>{formatCompact(account.totalVolume)}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>Profitability</Text>
          <Text style={[styles.statValue, { color: profitColor }]}>
            {account.profitability >= 0 ? '+' : ''}{formatPct(account.profitability)}
          </Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>Total P&L</Text>
          <Text style={[styles.statValue, { color: pnlColor }]}>
            {formatPnl(account.totalPnL)}
          </Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>Win Rate</Text>
          <Text style={styles.statValue}>
            {account.winRate !== null ? formatPct(account.winRate) : '--'}
          </Text>
        </View>
      </View>

      {/* Position badge + expand */}
      {account.openPositions.length > 0 && (
        <Pressable style={styles.expandBtn} onPress={() => setExpanded(!expanded)}>
          <View style={styles.positionsBadge}>
            <Text style={styles.positionsBadgeText}>
              {account.openPositions.length} open position{account.openPositions.length !== 1 ? 's' : ''}
            </Text>
          </View>
          {expanded
            ? <ChevronUp size={14} color={colors.textFaint} />
            : <ChevronDown size={14} color={colors.textFaint} />}
        </Pressable>
      )}

      {expanded && (
        <View style={styles.positionsList}>
          {account.openPositions.map((pos) => (
            <PositionCard key={pos.id} position={pos} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { color: colors.white, fontSize: 13, fontFamily: fonts.bold, fontWeight: '700' },
  flex: { flex: 1 },
  username: {
    color: colors.white,
    fontSize: 15,
    fontFamily: fonts.semiBold, fontWeight: '600',
    marginBottom: 4,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  address: { color: colors.textFaint, fontSize: 11 },
  iconBtn: {
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
  },
  lastActive: { color: colors.textFainter, fontSize: 11 },
  followBtn: {
    borderWidth: 1,
    borderColor: colors.purple,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.purpleStrong,
  },
  followBtnActive: {
    backgroundColor: 'transparent',
  },
  followBtnText: { color: colors.white, fontSize: 12, fontFamily: fonts.medium, fontWeight: '500' },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statCell: {
    width: '47%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 10,
  },
  statLabel: { color: colors.textFaint, fontSize: 11, marginBottom: 4 },
  statValue: { color: colors.white, fontSize: 14, fontFamily: fonts.semiBold, fontWeight: '600' },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
  },
  positionsBadge: {
    backgroundColor: 'rgba(168,85,247,0.2)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  positionsBadgeText: { color: '#d8b4fe', fontSize: 12 },
  positionsList: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
});
