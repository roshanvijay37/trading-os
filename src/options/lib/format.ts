/**
 * Display formatters for the Options Workspace. Built on the app-wide `formatCurrency`
 * (Indian numbering) and extended with compact lakh/crore, vol, Greek and time helpers.
 */

export { formatCurrency } from "../../utils/format";

const EN_IN = "en-IN";

/** Compact Indian-style large number: 1,23,456 → "1.23L", 1,20,00,000 → "1.20Cr". */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toLocaleString(EN_IN)}`;
}

/** Plain integer with Indian grouping. */
export function int(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString(EN_IN);
}

/** Fixed-decimal number, dash for non-finite/zero-by-absence. */
export function dec(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(EN_IN, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Signed value with explicit +/−. */
export function signed(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "—";
  const s = n >= 0 ? "+" : "-";
  return `${s}${Math.abs(n).toLocaleString(EN_IN, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** Percentage (input already in percent units). */
export function pct(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(dp)}%`;
}

/** IV / vol decimal → percent string (0.142 → "14.2%"). */
export function volPct(sigma: number, dp = 1): string {
  if (!Number.isFinite(sigma) || sigma <= 0) return "—";
  return `${(sigma * 100).toFixed(dp)}%`;
}

/** ₹ amount, signed, compact for large P/L. */
export function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${compact(Math.abs(n))}`;
}

/** Rupee with grouping, no decimals. */
export function rupee(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.round(Math.abs(n)).toLocaleString(EN_IN)}`;
}

export function fmtTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString(EN_IN, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/** Color class for a signed value, matching the app's gain/loss/zinc tokens. */
export function toneClass(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "text-zinc-400";
  return n > 0 ? "text-gain" : "text-loss";
}
