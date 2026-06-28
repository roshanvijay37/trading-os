/**
 * Market breadth (advance / decline) derived from the NIFTY 50 constituent basket.
 *
 * FYERS does not expose a dedicated breadth endpoint, but it DOES quote individual stocks via
 * /quotes. So we fetch the constituents and count advancers vs decliners ourselves — a real,
 * live, FYERS-sourced breadth read (of the NIFTY 50 large-cap universe, labelled as such in the
 * UI). The compute is pure so it can be unit-tested without a broker session.
 *
 * NOTE: NIFTY 50 membership drifts as the index is reconstituted (twice a year). Review this list
 * periodically. A stale/renamed symbol is harmless — FYERS returns s:"error" for it and we skip
 * it, so breadth is still computed over whatever constituents resolved (reported via `counted`).
 */

// FYERS symbol format: NSE:<SYMBOL>-EQ. 50 names — fits one /quotes call (FYERS caps at 50/req).
export const NIFTY50_SYMBOLS = [
  "NSE:ADANIENT-EQ", "NSE:ADANIPORTS-EQ", "NSE:APOLLOHOSP-EQ", "NSE:ASIANPAINT-EQ", "NSE:AXISBANK-EQ",
  "NSE:BAJAJ-AUTO-EQ", "NSE:BAJFINANCE-EQ", "NSE:BAJAJFINSV-EQ", "NSE:BEL-EQ", "NSE:BHARTIARTL-EQ",
  "NSE:CIPLA-EQ", "NSE:COALINDIA-EQ", "NSE:DRREDDY-EQ", "NSE:EICHERMOT-EQ", "NSE:ETERNAL-EQ",
  "NSE:GRASIM-EQ", "NSE:HCLTECH-EQ", "NSE:HDFCBANK-EQ", "NSE:HDFCLIFE-EQ", "NSE:HEROMOTOCO-EQ",
  "NSE:HINDALCO-EQ", "NSE:HINDUNILVR-EQ", "NSE:ICICIBANK-EQ", "NSE:INDUSINDBK-EQ", "NSE:INFY-EQ",
  "NSE:ITC-EQ", "NSE:JIOFIN-EQ", "NSE:JSWSTEEL-EQ", "NSE:KOTAKBANK-EQ", "NSE:LT-EQ",
  "NSE:M&M-EQ", "NSE:MARUTI-EQ", "NSE:NESTLEIND-EQ", "NSE:NTPC-EQ", "NSE:ONGC-EQ",
  "NSE:POWERGRID-EQ", "NSE:RELIANCE-EQ", "NSE:SBILIFE-EQ", "NSE:SBIN-EQ", "NSE:SHRIRAMFIN-EQ",
  "NSE:SUNPHARMA-EQ", "NSE:TATACONSUM-EQ", "NSE:TATAMOTORS-EQ", "NSE:TATASTEEL-EQ", "NSE:TCS-EQ",
  "NSE:TECHM-EQ", "NSE:TITAN-EQ", "NSE:TRENT-EQ", "NSE:ULTRACEMCO-EQ", "NSE:WIPRO-EQ",
];

function num(x) {
  if (x == null) return null;
  const n = typeof x === "number" ? x : parseFloat(String(x));
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Pull a day-change figure out of one FYERS quote value object. Prefers the explicit change `ch`,
 * falls back to last - prev_close, then to the change-percent sign. Returns null if undeterminable.
 */
export function changeFromQuoteValue(v) {
  if (!v || typeof v !== "object") return null;
  const ch = num(v.ch);
  if (ch != null) return ch;
  const lp = num(v.lp ?? v.ltp);
  const prev = num(v.prev_close_price ?? v.prev_close ?? v.c);
  if (lp != null && prev != null) return round2(lp - prev);
  const chp = num(v.chp); // last resort: sign only
  return chp != null ? chp : null;
}

/**
 * Compute advance/decline breadth from a FYERS /quotes response array.
 * Each item looks like { n: "NSE:RELIANCE-EQ", s: "ok", v: { ch, chp, lp, prev_close_price, ... } }.
 * Pure; tolerant of errored/empty items.
 */
export function computeBreadth(quotes) {
  let advances = 0, declines = 0, unchanged = 0, counted = 0;
  for (const q of Array.isArray(quotes) ? quotes : []) {
    if (!q) continue;
    if (q.s && q.s !== "ok") continue; // skip symbols FYERS could not resolve
    const ch = changeFromQuoteValue(q.v ?? q);
    if (ch == null) continue;
    counted++;
    if (ch > 0) advances++;
    else if (ch < 0) declines++;
    else unchanged++;
  }

  if (counted === 0) {
    return { advances: 0, declines: 0, unchanged: 0, counted: 0, ratio: 0, advancePercent: 0, trend: "NEUTRAL" };
  }

  const ratio = declines > 0 ? round2(advances / declines) : advances; // all-up edge case -> advances
  const advancePercent = round2((advances / counted) * 100);
  const trend = advancePercent >= 60 ? "BULLISH" : advancePercent <= 40 ? "BEARISH" : "NEUTRAL";

  return { advances, declines, unchanged, counted, ratio, advancePercent, trend };
}
