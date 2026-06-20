import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import { Position } from '../types';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface Props {
  position: Position;
}

export function PositionCard({ position }: Props) {
  const profitable = position.pnl >= 0;
  const pnlColor = profitable ? colors.green : colors.red;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.flex}>
          <Text style={styles.marketName} numberOfLines={2}>
            {position.marketName}
          </Text>
          <View style={styles.outcomePill}>
            <Text style={styles.outcomeText}>{position.outcome}</Text>
          </View>
        </View>
        <View style={[styles.pnlIcon, { backgroundColor: profitable ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)' }]}>
          {profitable
            ? <TrendingUp size={16} color={colors.green} />
            : <TrendingDown size={16} color={colors.red} />}
        </View>
      </View>

      <View style={styles.pnlRow}>
        <Text style={[styles.pnlValue, { color: pnlColor }]}>
          {profitable ? '+' : ''}${position.pnl.toFixed(2)}
        </Text>
        <Text style={[styles.pnlPct, { color: pnlColor }]}>
          {profitable ? '+' : ''}{position.pnlPercentage.toFixed(1)}%
        </Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>Shares</Text>
          <Text style={styles.statValue}>{position.shares.toLocaleString()}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>Avg Price</Text>
          <Text style={styles.statValue}>${position.averagePrice.toFixed(2)}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>Current</Text>
          <Text style={styles.statValue}>${position.currentPrice.toFixed(2)}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statLabel}>Value</Text>
          <Text style={styles.statValue}>${position.value.toLocaleString()}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
    marginBottom: 8,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  flex: { flex: 1, marginRight: 12 },
  marketName: {
    color: colors.white,
    fontSize: 13,
    fontFamily: fonts.medium, fontWeight: '500',
    marginBottom: 6,
  },
  outcomePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(168,85,247,0.25)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  outcomeText: {
    color: '#d8b4fe',
    fontSize: 11,
    fontFamily: fonts.semiBold, fontWeight: '600',
  },
  pnlIcon: {
    padding: 6,
    borderRadius: 8,
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  pnlValue: { fontSize: 14, fontFamily: fonts.bold, fontWeight: '700' },
  pnlPct: { fontSize: 12 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
  statCell: { width: '50%', marginBottom: 4 },
  statLabel: { color: colors.textFaint, fontSize: 11, marginBottom: 2 },
  statValue: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: fonts.medium, fontWeight: '500' },
});
