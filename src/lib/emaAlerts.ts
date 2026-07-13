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
  // Optional: only needed for the gap-adjusted fill check and the entry-cutoff check in
  // resolveEmaAlerts. Callers that omit either (e.g. existing tests) simply get no gap
  // adjustment / no cutoff check, never a crash.
  open?: number;
  /** Epoch SECONDS. Needed to determine whether the trigger candle falls at/after the entry cutoff. */
  time?: number;
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
  /**
   * True when the trigger (fill) candle falls at/after CONFIG.MAX_TIME_ENTRY_HOUR (14:00 IST) —
   * the live/paper bot's canTakeTrade gate refuses any new entry from that point on
   * (server/src/services/autoTrader.js's checkTimeFilter), so a signal like this would never
   * actually become a trade no matter how the price moved afterward. False (never blocked) when
   * `time` wasn't supplied on the candles, or the alert never triggered at all.
   */
  pastEntryCutoff: boolean;
}

// Matches CONFIG.MAX_TIME_ENTRY_HOUR's default in server/src/services/autoTrader.js — no new
// EMA5T entries at/after 14:00 IST. Hardcoded here at the same fidelity level as this file's other
// mirrored constants (the 2x target multiplier, 0.05% stop-fill slippage): a reasonable default,
// not a live read of the bot's actual running config.
const MAX_TIME_ENTRY_HOUR = 14;

/** IST wall-clock hour (0-23) for an epoch-SECONDS timestamp, matching checkTimeFilter's math
 * exactly (India has no DST, so a fixed +5:30 offset is exact). */
function istHourOf(epochSec: number): number {
  const utcMinutesOfDay = Math.floor(epochSec / 60) % 1440;
  const istMinutes = (utcMinutesOfDay + 330) % 1440;
  return Math.floor(istMinutes / 60);
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
 * Finds 5-EMA alert candles, gated by a slower trend-EMA filter by default (EMA5T — the strategy
 * the live/paper bots actually trade). `trendPeriod` selects the gate's EMA length: defaults to
 * the legacy 20, while the Chart page passes the live config's 12 (autoTrader.js and
 * equityTrader.js both run TREND_EMA_PERIOD 12). Pass `{ trendGate: false }` for the plain
 * (legacy EMA5, ungated) rule instead.
 */
export function findEmaAlerts(candles: AlertCandle[], opts: { trendGate?: boolean; trendPeriod?: number } = {}): AlertPoint[] {
  const trendGate = opts.trendGate !== false;
  const trendPeriod = opts.trendPeriod ?? 20;
  const closes = candles.map((c) => c.close);
  const ema5Series = calculateEMA(closes, 5); // aligned to closes[4 .. end]
  const trendSeries = trendGate ? calculateEMA(closes, trendPeriod) : null; // aligned to closes[trendPeriod-1 .. end]

  const alerts: AlertPoint[] = [];
  for (let i = 0; i <= candles.length - 2; i++) {
    const ema5Idx = i + 1 - 4; // value AT candle i+1
    if (ema5Idx < 0) continue;
    const ema5 = ema5Series[ema5Idx];

    let trendEma: number | null = null;
    if (trendGate) {
      const trendIdx = i - (trendPeriod - 1); // value AT candle i
      if (trendIdx < 0) continue;
      trendEma = trendSeries![trendIdx];
    }

    const { close, high, low } = candles[i];
    const type = detectAlert(close, high, low, ema5, trendEma);
    if (type) alerts.push({ index: i, type });
  }
  return alerts;
}

/**
 * Simulates each alert forward through the candle history to see what actually happened —
 * nominal entry = alert candle's high/low, SL = alert candle's low/high, target = entry ±
 * targetMultiplier × risk (matches autoTrader.js's EMA5T entry math exactly; default 2 is the
 * legacy R:R, the Chart page passes the live config's 3).
 *
 * Four rules mirrored from the real system, all load-bearing for correctness:
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
 *  4. A trigger at/after 14:00 IST is flagged via pastEntryCutoff — the bot's canTakeTrade gate
 *     (checkTimeFilter) refuses any new entry from that point on, so a "signal" like this would
 *     never actually become a trade no matter how price moved afterward.
 */
export function resolveEmaAlerts(
  candles: AlertCandle[],
  alerts: AlertPoint[],
  // entryCutoffHour: per-instrument entry cutoff (IST hour). Defaults to the NSE 14:00 rule;
  // the Chart page passes 22 for MCX gold (its validated profile allows entries 09:00–22:00).
  opts: { entryCutoffHour?: number; targetMultiplier?: number } = {},
): ResolvedAlert[] {
  const entryCutoffHour = opts.entryCutoffHour ?? MAX_TIME_ENTRY_HOUR;
  const targetMultiplier = opts.targetMultiplier ?? 2;
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
      const target = isBullish ? nominalEntry + targetMultiplier * risk : nominalEntry - targetMultiplier * risk;
      return { alertIndex: alert.index, type: alert.type, entry: nominalEntry, sl, target, triggerIndex: null, outcome: "NOT_TRIGGERED", outcomeIndex: null, pastEntryCutoff: false };
    }

    // Gap-adjusted fill (rule 3 above). `open` is optional — callers that don't supply it
    // (e.g. existing tests) just get no gap adjustment, never a crash.
    const triggerCandle = candles[triggerIndex];
    const triggerOpen = triggerCandle.open;
    const gappedThrough = triggerOpen !== undefined && (isBullish ? triggerOpen >= nominalEntry : triggerOpen <= nominalEntry);
    const entry = gappedThrough ? (triggerOpen as number) : nominalEntry;
    const risk = Math.abs(entry - sl);
    const target = isBullish ? entry + targetMultiplier * risk : entry - targetMultiplier * risk;
    const pastEntryCutoff = triggerCandle.time !== undefined && istHourOf(triggerCandle.time) >= entryCutoffHour;

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

    return { alertIndex: alert.index, type: alert.type, entry, sl, target, triggerIndex, outcome, outcomeIndex, pastEntryCutoff };
  });
}
