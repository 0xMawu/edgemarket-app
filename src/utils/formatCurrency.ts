/**
 * Currency and number formatting utilities.
 *
 * formatCompact(n)  — compact with suffix: "$1.2K", "$4.6M", "$7.9B"
 *                     uses 1 decimal place when < 10, 0 when >= 10
 * formatPnl(n)      — signed compact: "+$1.2K" / "-$456"
 * formatPct(n)      — percentage rounded to nearest integer: "62%"
 * formatFull(n)     — full dollar amount with commas: "$1,234,567"
 */

/**
 * Compact currency — matches how Bloomberg, Robinhood, Polymarket display values.
 *
 *   0–999        → "$999"          (whole dollars, no suffix)
 *   1,000–9,999  → "$1.2K"         (1 decimal)
 *   10,000–999,999 → "$12K"        (no decimal)
 *   1M–9.9M      → "$1.2M"
 *   10M+         → "$12M"
 *   1B+          → "$1.2B"
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000_000) {
    const scaled = abs / 1_000_000_000;
    return `${sign}$${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)}B`;
  }
  if (abs >= 1_000_000) {
    const scaled = abs / 1_000_000;
    return `${sign}$${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)}M`;
  }
  if (abs >= 1_000) {
    const scaled = abs / 1_000;
    return `${sign}$${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)}K`;
  }
  // Under $1,000 — show whole dollars
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

/**
 * Full dollar amount with thousand-separator commas. No suffix.
 * Used where precision matters more than brevity.
 *
 * Examples:
 *   1234567  → "$1,234,567"
 *   99.5     → "$100"  (rounded to whole dollars)
 */
export function formatFull(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

/**
 * Signed compact P&L.
 *
 * Examples:
 *   1500    → "+$1.5K"
 *   -250    → "-$250"
 *   0       → "$0"
 */
export function formatPnl(value: number): string {
  if (value === 0) return '$0';
  const prefix = value > 0 ? '+' : '';
  return prefix + formatCompact(value);
}

/**
 * Percentage with proper comma formatting for large values.
 *
 * Examples:
 *   7.8       → "7.8%"
 *   62.3      → "62%"
 *   1234.5    → "1,235%"
 *   50000     → "50,000%"
 */
export function formatPct(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs < 10) return `${sign}${abs.toFixed(1)}%`;
  // Round to integer and add comma separator
  return `${sign}${Math.round(abs).toLocaleString('en-US')}%`;
}
