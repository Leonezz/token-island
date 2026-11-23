/** Number / token / cost formatting shared by the widget, CLI, badges and pages. */

function trimZero(value: string): string {
  return value.includes('.') ? value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : value;
}

/**
 * Compact token count for dense UI: 942 / 12.4K / 1.24M / 3.1B.
 * Two decimals are kept for small mantissas, which is what makes a Dynamic
 * Island style counter readable at a glance.
 */
export function formatTokens(n: number, opts: { space?: boolean; maxDecimals?: number } = {}): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  const space = opts.space ? ' ' : '';

  if (abs < 1_000) {
    if (n > 0 && n < 1) return '<1';
    return `${sign}${abs}`;
  }

  const [divisor, suffix] =
    abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const scaled = abs / divisor;

  let decimals: number;
  if (scaled < 10) decimals = 2;
  else if (scaled < 100) decimals = 1;
  else decimals = 0;
  if (opts.maxDecimals !== undefined) decimals = Math.min(decimals, opts.maxDecimals);

  return `${sign}${trimZero(scaled.toFixed(decimals))}${space}${suffix}`;
}

/** Full precision with thousands separators: 1,234,567. */
export function formatTokensFull(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/** Estimated cost. `null` means "model has no known price". */
export function formatCost(usd: number | null | undefined, opts: { approx?: boolean } = {}): string {
  const prefix = opts.approx ? '~' : '';
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '—';
  const abs = Math.abs(usd);
  if (abs === 0) return `${prefix}$0`;
  if (abs >= 10_000) return `${prefix}$${formatTokens(abs)}`;
  if (abs >= 100) return `${prefix}$${Math.round(abs)}`;
  if (abs >= 10) return `${prefix}$${trimZero(abs.toFixed(2))}`;
  if (abs >= 1) return `${prefix}$${trimZero(abs.toFixed(2))}`;
  if (abs >= 0.01) return `${prefix}$${trimZero(abs.toFixed(2))}`;
  if (abs >= 0.0001) return `${prefix}<$0.01`;
  return `${prefix}<$0.0001`;
}

/** Cost with an explicit estimate marker, e.g. `~$1.24`. */
export function formatCostApprox(usd: number | null | undefined): string {
  return formatCost(usd, { approx: true });
}

/** 0.4213 -> "42%"; 0.004 -> "<1%"; 0 -> "0%". */
export function formatPercent(ratio: number, decimals = 0): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  const pct = ratio * 100;
  if (pct < 1) return '<1%';
  return `${trimZero(pct.toFixed(decimals === 0 && pct < 10 ? 1 : decimals))}%`;
}

/** Compact latency / duration. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec < 10 ? trimZero(sec.toFixed(1)) : Math.round(sec)}s`;
  const min = sec / 60;
  if (min < 60) return `${min < 10 ? trimZero(min.toFixed(1)) : Math.round(min)}m`;
  const hours = min / 60;
  return `${hours < 10 ? trimZero(hours.toFixed(1)) : Math.round(hours)}h`;
}

/** Relative "time ago" label, kept short for the island. */
export function formatRelative(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const delta = Math.max(0, now - ts);
  if (delta < 15_000) return 'just now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.round(delta / 86_400_000)}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

/** HH:MM in the host's local time. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Clips a label with an ellipsis to at most `max` characters. */
export function truncateLabel(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return `${value.slice(0, max - 1)}…`;
}

/** Percent of a total, safe for 0 totals. */
export function share(part: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(1, Math.max(0, part / total));
}
