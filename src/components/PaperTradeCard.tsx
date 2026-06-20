/**
 * PaperTradeCard — displays a user's paper (simulated) trading portfolio.
 *
 * Shows a summary header with total unrealised P&L, then one row per trade
 * with live price, entry price, and P&L. A "Copy Positions" button appears
 * for each followed trader in both empty and non-empty states.
 */
import React from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
} from 'react-native';
import { TrendingUp, RefreshCw } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { formatPnl, formatPct, formatCompact } from '../utils/formatCurrency';
import type { PaperPortfolio, PaperTrade } from '../hooks/usePaperTrades';

interface Props {
  portfolio: PaperPortfolio | null;
  loading: boolean;
  copyLoading: string | null;  // targetAddress currently being copied
  error: string | null;
  followedTraders: string[];   // addresses the user follows
  onCopyPositions: (targetAddress: string) => void;
  onRefresh: () => void;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function TradeRow({ trade }: { trade: PaperTrade }) {
  const pnlColor = trade.unrealisedPnl === null
    ? colors.textFaint
    : trade.unrealisedPnl >= 0 ? colors.green : colors.red;

  return (
    <View style={styles.tradeRow}>
      <View style={styles.tradeFlex}>
        <Text style={styles.tradeMarket} numberOfLines={2}>
          {trade.marketTitle ?? trade.marketId.slice(0, 12) + '…'}
        </Text>
        <Text style={styles.tradeMeta}>
          {trade.outcome ?? '—'} · {trade.shares.toFixed(2)} shares
          · entry {(trade.entryPrice * 100).toFixed(1)}¢
          · live {trade.livePrice !== null ? `${(trade.livePrice * 100).toFixed(1)}¢` : '—'}
        </Text>
      </View>
      <View style={styles.tradePnlWrap}>
        <Text style={[styles.tradePnl, { color: pnlColor }]}>
          {trade.unrealisedPnl !== null ? formatPnl(trade.unrealisedPnl) : '—'}
        </Text>
        {trade.pnlPercentage !== null && (
          <Text style={[styles.tradePct, { color: pnlColor }]}>
            {formatPct(trade.pnlPercentage)}
          </Text>
        )}
      </View>
    </View>
  );
}

export function PaperTradeCard({
  portfolio,
  loading,
  copyLoading,
  error,
  followedTraders,
  onCopyPositions,
  onRefresh,
}: Props) {
  const hasTrades = (portfolio?.trades.length ?? 0) > 0;
  const totalPnl  = portfolio?.portfolioSummary.totalUnrealisedPnl ?? 0;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <TrendingUp size={15} color={colors.purple} />
          <Text style={styles.cardTitle}>Paper Portfolio</Text>
        </View>
        <Pressable onPress={onRefresh} hitSlop={8} disabled={loading}>
          <RefreshCw size={14} color={loading ? colors.textFainter : colors.textFaint} />
        </Pressable>
      </View>

      {/* Error */}
      {error ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={onRefresh} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Loading skeleton */}
      {loading && !hasTrades ? (
        <ActivityIndicator color={colors.purple} style={{ marginVertical: 16 }} />
      ) : null}

      {/* Summary row */}
      {hasTrades && !loading ? (
        <>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{portfolio!.portfolioSummary.totalTrades}</Text>
              <Text style={styles.summaryLabel}>Positions</Text>
            </View>
            <View style={[styles.summaryCell, styles.summaryCellBorder]}>
              <Text style={[
                styles.summaryValue,
                { color: totalPnl >= 0 ? colors.green : colors.red },
              ]}>
                {formatPnl(totalPnl)}
              </Text>
              <Text style={styles.summaryLabel}>Unrealised P&L</Text>
            </View>
          </View>

          {/* Trade rows grouped by target */}
          {Object.entries(portfolio!.portfolioSummary.groupedByTarget).map(([target, trades]) => (
            <View key={target} style={styles.targetGroup}>
              <View style={styles.targetHeader}>
                <Text style={styles.targetLabel}>Copying {shortAddr(target)}</Text>
                <Pressable
                  style={[styles.copyBtn, copyLoading === target && styles.copyBtnLoading]}
                  onPress={() => onCopyPositions(target)}
                  disabled={!!copyLoading}
                >
                  {copyLoading === target
                    ? <ActivityIndicator size="small" color={colors.white} />
                    : <Text style={styles.copyBtnText}>Refresh</Text>}
                </Pressable>
              </View>
              {trades.map((trade) => (
                <TradeRow key={trade.id} trade={trade} />
              ))}
            </View>
          ))}
        </>
      ) : null}

      {/* Empty state */}
      {!hasTrades && !loading && !error ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>No paper positions yet.</Text>
          <Text style={styles.emptySubtext}>
            Copy a followed trader's positions to start paper trading.
          </Text>
        </View>
      ) : null}

      {/* Copy Positions buttons — shown for every followed trader */}
      {followedTraders.length > 0 ? (
        <View style={styles.copySection}>
          <Text style={styles.copySectionLabel}>Copy positions from:</Text>
          {followedTraders.map((addr) => (
            <Pressable
              key={addr}
              style={[styles.copyTraderBtn, copyLoading === addr && styles.copyBtnLoading]}
              onPress={() => onCopyPositions(addr)}
              disabled={!!copyLoading}
            >
              {copyLoading === addr
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Text style={styles.copyTraderBtnText}>{shortAddr(addr)}</Text>}
            </Pressable>
          ))}
        </View>
      ) : null}
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
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: {
    color: colors.white,
    fontSize: 14,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
  },
  errorWrap: { marginBottom: 12 },
  errorText: { color: colors.red, fontSize: 12, marginBottom: 8 },
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  retryText: { color: colors.red, fontSize: 12, fontFamily: fonts.semiBold, fontWeight: '600' },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  summaryCell: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  summaryCellBorder: { borderLeftWidth: 1, borderLeftColor: colors.cardBorder },
  summaryValue: {
    color: colors.white,
    fontSize: 16,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },
  summaryLabel: { color: colors.textFaint, fontSize: 11, marginTop: 3 },
  targetGroup: { marginBottom: 12 },
  targetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  targetLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    fontWeight: '500',
  },
  copyBtn: {
    backgroundColor: colors.purpleStrong,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 64,
    alignItems: 'center',
  },
  copyBtnLoading: { opacity: 0.6 },
  copyBtnText: { color: colors.white, fontSize: 12, fontFamily: fonts.semiBold, fontWeight: '600' },
  tradeRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  tradeFlex: { flex: 1, paddingRight: 8 },
  tradeMarket: {
    color: colors.white,
    fontSize: 12,
    fontFamily: fonts.medium,
    fontWeight: '500',
    marginBottom: 3,
  },
  tradeMeta: { color: colors.textFaint, fontSize: 10 },
  tradePnlWrap: { alignItems: 'flex-end', justifyContent: 'center' },
  tradePnl: { fontSize: 13, fontFamily: fonts.semiBold, fontWeight: '600' },
  tradePct: { fontSize: 10, marginTop: 2 },
  emptyWrap: { paddingVertical: 16, alignItems: 'center' },
  emptyText: {
    color: colors.white,
    fontSize: 13,
    fontFamily: fonts.medium,
    fontWeight: '500',
    marginBottom: 4,
  },
  emptySubtext: { color: colors.textFaint, fontSize: 12, textAlign: 'center' },
  copySection: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: 12 },
  copySectionLabel: { color: colors.textFaint, fontSize: 11, marginBottom: 8 },
  copyTraderBtn: {
    backgroundColor: colors.purpleStrong,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  copyTraderBtnText: {
    color: colors.white,
    fontSize: 13,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
  },
});
