/**
 * EMA5T Strategy Engine — Subhasish Pani's 5-EMA rule + the strict trend gate validated
 * over 6 years of FYERS data (2026-07 research; see strategy-research memory/audit).
 *
 * Rules (as actually enforced by the code):
 * 1. Timeframes: CONFIG.SELECTED_TIMEFRAMES (validated set: 15/30/60m), each scanned independently.
 * 2. Alert candle: a candle ENTIRELY beyond the 5 EMA (see signalCore.js) — NOT a simple cross.
 * 3. Trend gate (EMA5T): the alert only arms when its close sits on the trend side of the
 *    15m EMA20 computed WITHOUT the latest bar — no lookahead; live sees what the backtest saw.
 * 4. Entry: resting stop order AT the alert high/low (managed in autoTrader.manageFuturesPending).
 * 5. Stop Loss: alert candle low/high; target 1:2.
 * 6. No NEW entries after CONFIG.MAX_TIME_ENTRY_HOUR (14:00 IST); square-off 15:15 IST.
 *
 * The legacy EMA5/EMA5_OPTION option-buying flow was removed 2026-07-04 (user request);
 * git history retains it, and the Backtest Lab still backtests options separately.
 */

import { randomUUID } from "crypto";
// Shared 5-EMA + alert rule — the SAME definition the backtest uses (single source of truth).
import { calculateEMA as emaSeries, detectAlert } from "./signalCore.js";

// Store candles in memory (in production, use Redis/DB)
const candleStore = new Map();
const signalStore = [];
const MAX_STORED_SIGNALS = 100;

/**
 * Last EMA value over the provided closes, SMA-seeded — now IDENTICAL to the backtest engine.
 * Previously this seeded from the first close and was fed only 5 closes (slice(-5)), so the
 * live 5-EMA diverged from the backtested one and the bot fired on different candles. Pass the
 * full recent close history; returns null when there are fewer than `period` closes.
 * @param {number[]} closes
 * @param {number} [period]
 * @returns {number|null}
 */
export function calculateEMA(closes, period = 5) {
  const series = emaSeries(closes, period);
  if (series.length === 0) return null;
  return Math.round(series[series.length - 1] * 100) / 100;
}

/**
 * Detect alert candle pattern
 * @param {Object[]} candles - Array of candles [timestamp, open, high, low, close, volume]
 * @returns {Object|null} Alert candle info or null
 */
export function detectAlertCandle(candles, strategy = "EMA5", trendEmaPeriod = 20) {
  // Need the alert candle (the latest completed candle) plus enough history to seed the EMA.
  if (candles.length < 6) return null;

  const closes = candles.map((c) => c[4]);

  // 5-EMA at the most recent close — the same bar the backtest uses to judge the alert candle
  // (backtest: alert = bar i-1 judged against the EMA at bar i). Computed over the FULL close
  // history via the shared SMA-seeded EMA, not a 5-close window.
  const ema5Series = emaSeries(closes, 5);
  if (ema5Series.length === 0) return null;
  const ema5 = ema5Series[ema5Series.length - 1];

  // Alert candle = the candle just before the latest one. detectBreakout then checks whether
  // the latest candle takes out its high/low — mirroring the backtest exactly (alert = i-1,
  // breakout = i) and replacing the old cross-over rule with the "entirely beyond EMA" rule.
  const alertBar = candles[candles.length - 2];
  const close = alertBar[4];
  const high = alertBar[2];
  const low = alertBar[3];
  const open = alertBar[1];

  let trendEma = null;
  if (strategy === "EMA5T") {
    // EMA5T (futures, 2026-07 validation): STRICT trend gate — a trendEmaPeriod-EMA computed
    // over closes EXCLUDING the latest bar, compared against the ALERT bar's close. The alert
    // bar and everything the gate reads were fully closed before any entry could trigger, so
    // live and backtest see identical information (the backtest's "no-lookahead" filter).
    // Defaults to 20 (the validated period) — pass CONFIG.TREND_EMA_PERIOD to override.
    const ema20Series = emaSeries(closes.slice(0, -1), trendEmaPeriod);
    if (ema20Series.length === 0) return null;
    trendEma = ema20Series[ema20Series.length - 1];
  }

  const type = detectAlert({ close, high, low, ema: ema5, trendEma });
  if (!type) return null;

  return {
    type: type === "BULLISH" ? "BULLISH_ALERT" : "BEARISH_ALERT",
    candle: alertBar,
    ema5: Math.round(ema5 * 100) / 100,
    strategy,
    timestamp: alertBar[0],
    high,
    low,
    close,
    open,
  };
}

/**
 * Check if it's valid trading time
 * @returns {boolean}
 */
export function isValidTradingTime() {
  // Compute IST explicitly from UTC. Using getHours()/getMinutes() relies on the server's
  // local timezone — on a UTC production host that shifts the whole trading window by 5.5h.
  const now = new Date();
  const istMinutes = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  const timeDecimal = istMinutes / 60;

  // Market hours: 9:15 AM to 3:30 PM IST
  // No new positions after 3:00 PM
  return timeDecimal >= 9.25 && timeDecimal < 15.0;
}

/**
 * Check if it's time to square off (3:15 PM)
 * @returns {boolean}
 */
export function isSquareOffTime() {
  // IST explicitly from UTC (see isValidTradingTime) — square-off at 15:15 IST must not
  // drift with the server's local timezone.
  const now = new Date();
  const istMinutes = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  const hours = Math.floor(istMinutes / 60);
  const minutes = istMinutes % 60;

  return hours === 15 && minutes >= 15;
}

/**
 * Store signal for reference
 * @param {Object} signal - Signal object
 */
export function storeSignal(signal) {
  signalStore.unshift({
    ...signal,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  
  // Keep only last 100 signals
  if (signalStore.length > MAX_STORED_SIGNALS) {
    signalStore.pop();
  }
}

/**
 * Get recent signals
 * @param {number} limit - Number of signals to return
 * @returns {Object[]} Recent signals
 */
export function getRecentSignals(limit = 20) {
  return signalStore.slice(0, limit);
}

/**
 * Clear signal store
 */
export function clearSignals() {
  signalStore.length = 0;
}
