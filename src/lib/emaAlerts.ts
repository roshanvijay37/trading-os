/**
 * Client-side mirror of the EMA5T alert rule — server/src/services/signalCore.js's detectAlert
 * combined with emaStrategy.js's detectAlertCandle indexing. Used ONLY to mark alert candles on
 * the live Chart page; it is NOT wired into any trading decision (read-only visual aid).
 *
 * The indexing is the part most likely to go subtly wrong, so it's worth spelling out: candle i
 * is judged as an alert using the 5-EMA computed THROUGH candle i+1 (not i itself) and the 20-EMA
 * computed THROUGH candle i (not i+1) — this asymmetry is intentional and matches exactly what
 * emaStrategy.js's detectAlertCandle does for live detection (and what the backtest's EMA5T branch
 * replays). Because candle i+1 must exist, the LAST candle in the input can never be marked.
 *
 * Keep in sync with signalCore.js/emaStrategy.js if either changes.
 */
import { calculateEMA } from "./strategies/engine";

export type AlertType = "BULLISH" | "BEARISH";

export interface AlertCandle {
  close: number;
  high: number;
  low: number;
}

export interface AlertPoint {
  /** Index into the candles array passed to findEmaAlerts. */
  index: number;
  type: AlertType;
}

function detectAlert(close: number, high: number, low: number, ema: number, trendEma: number | null): AlertType | null {
  if (!(ema > 0)) return null;
  if (trendEma !== null) {
    if (close > trendEma && close < ema && high < ema) return "BULLISH";
    if (close < trendEma && close > ema && low > ema) return "BEARISH";
    return null;
  }
  if (close < ema && high < ema) return "BULLISH";
  if (close > ema && low > ema) return "BEARISH";
  return null;
}

/**
 * Finds 5-EMA alert candles, gated by the 20-EMA trend filter by default (EMA5T — the strategy
 * the live/paper bot actually trades). Pass `{ trendGate: false }` for the plain (legacy EMA5,
 * ungated) rule instead.
 */
export function findEmaAlerts(candles: AlertCandle[], opts: { trendGate?: boolean } = {}): AlertPoint[] {
  const trendGate = opts.trendGate !== false;
  const closes = candles.map((c) => c.close);
  const ema5Series = calculateEMA(closes, 5); // aligned to closes[4 .. end]
  const ema20Series = trendGate ? calculateEMA(closes, 20) : null; // aligned to closes[19 .. end]

  const alerts: AlertPoint[] = [];
  for (let i = 0; i <= candles.length - 2; i++) {
    const ema5Idx = i + 1 - 4; // value AT candle i+1
    if (ema5Idx < 0) continue;
    const ema5 = ema5Series[ema5Idx];

    let trendEma: number | null = null;
    if (trendGate) {
      const ema20Idx = i - 19; // value AT candle i
      if (ema20Idx < 0) continue;
      trendEma = ema20Series![ema20Idx];
    }

    const { close, high, low } = candles[i];
    const type = detectAlert(close, high, low, ema5, trendEma);
    if (type) alerts.push({ index: i, type });
  }
  return alerts;
}
