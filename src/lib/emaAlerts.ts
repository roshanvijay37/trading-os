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
  // Optional: only needed for the gap-adjusted fill check in resolveEmaAlerts. Callers that omit
  // it (e.g. existing tests) simply get no gap adjustment, never a crash.
  open?: number;
  close: number;
  high: number;
  low: number;
}

export type TradeOutcome = "TARGET" | "SL" | "OPEN" | "NOT_TRIGGERED";

export interface ResolvedAlert {
  alertIndex: number;
  type: AlertType;
  entry: number;
  sl: number;
  target: number;
  /** Index of the candle whose high/low first crossed the entry level, or null if it never did. */
  triggerIndex: number | null;
  outcome: TradeOutcome;
  /** Index of the candle where the outcome resolved (TARGET/SL only). */
  outcomeIndex: number | null;
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

/**
 * Simulates each alert forward through the candle history to see what actually happened —
 * nominal entry = alert candle's high/low, SL = alert candle's low/high, target = entry ± 2x
 * risk (matches autoTrader.js's EMA5T entry math exactly).
 *
 * Three rules mirrored from the real system, all load-bearing for correctness:
 *  1. A resting entry order is cancelled the moment a NEWER alert appears (autoTrader.js's
 *     manageFuturesPending: "a previous resting order... must be cancelled before arming the
 *     new one") — so the trigger search for alert k is bounded by alert k+1's candle index.
 *     Once actually triggered, later alerts don't affect the now-open position.
 *  2. When a single candle's range spans BOTH the SL and target, SL wins — this matches
 *     routes/backtest.js's if/else-if exit-check order (SL checked before target), the
 *     conservative convention for resolving intrabar ambiguity from OHLC-only data.
 *  3. If the triggering candle's OPEN already cleared the nominal entry level, the market gapped
 *     straight through it — the real fill happens at (or near) the open, not the stale nominal
 *     level. The SL stays at the alert candle's fixed structural level, but the target is
 *     recomputed from the real (gap-adjusted) entry to preserve the intended risk:reward — this
 *     mirrors checkEntryOrderFill/computeGapAdjustedTarget (autoTrader.js) and buildPosition
 *     (routes/backtest.js) exactly. Keep this in sync if any of those change.
 */
export function resolveEmaAlerts(candles: AlertCandle[], alerts: AlertPoint[]): ResolvedAlert[] {
  return alerts.map((alert, k) => {
    const alertCandle = candles[alert.index];
    const isBullish = alert.type === "BULLISH";
    const nominalEntry = isBullish ? alertCandle.high : alertCandle.low;
    const sl = isBullish ? alertCandle.low : alertCandle.high;

    const nextAlertIndex = k + 1 < alerts.length ? alerts[k + 1].index : candles.length;

    let triggerIndex: number | null = null;
    for (let i = alert.index + 1; i < nextAlertIndex && i < candles.length; i++) {
      const c = candles[i];
      if (isBullish ? c.high >= nominalEntry : c.low <= nominalEntry) {
        triggerIndex = i;
        break;
      }
    }

    if (triggerIndex === null) {
      const risk = Math.abs(nominalEntry - sl);
      const target = isBullish ? nominalEntry + 2 * risk : nominalEntry - 2 * risk;
      return { alertIndex: alert.index, type: alert.type, entry: nominalEntry, sl, target, triggerIndex: null, outcome: "NOT_TRIGGERED", outcomeIndex: null };
    }

    // Gap-adjusted fill (rule 3 above). `open` is optional — callers that don't supply it
    // (e.g. existing tests) just get no gap adjustment, never a crash.
    const triggerCandle = candles[triggerIndex];
    const triggerOpen = triggerCandle.open;
    const gappedThrough = triggerOpen !== undefined && (isBullish ? triggerOpen >= nominalEntry : triggerOpen <= nominalEntry);
    const entry = gappedThrough ? (triggerOpen as number) : nominalEntry;
    const risk = Math.abs(entry - sl);
    const target = isBullish ? entry + 2 * risk : entry - 2 * risk;

    let outcome: TradeOutcome = "OPEN";
    let outcomeIndex: number | null = null;
    for (let i = triggerIndex; i < candles.length; i++) {
      const c = candles[i];
      if (isBullish ? c.low <= sl : c.high >= sl) {
        outcome = "SL";
        outcomeIndex = i;
        break;
      }
      if (isBullish ? c.high >= target : c.low <= target) {
        outcome = "TARGET";
        outcomeIndex = i;
        break;
      }
    }

    return { alertIndex: alert.index, type: alert.type, entry, sl, target, triggerIndex, outcome, outcomeIndex };
  });
}
