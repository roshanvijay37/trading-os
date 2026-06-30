/**
 * Subhasish Pani's 5 EMA Strategy Engine
 * 
 * Rules (as actually enforced by the code — kept in sync with the audit):
 * 1. Timeframe: configurable (CONFIG.SELECTED_TIMEFRAMES, default 5m); each selected timeframe is
 *    scanned independently.
 * 2. Alert candle: a candle ENTIRELY beyond the 5 EMA (Subhasish Pani's rule; see signalCore.js) —
 *    NOT a simple cross.
 * 3. Entry: the next COMPLETED candle breaks the alert candle high/low (bullish/bearish).
 * 4. Stop Loss: alert candle low/high.
 * 5. Risk per trade: CONFIG.RISK_PERCENT (default 0.5%) of capital.
 * 6. No NEW entries after CONFIG.MAX_TIME_ENTRY_HOUR (default 14:00 IST) — EARLIER than Pani's 3 PM;
 *    isValidTradingTime also blocks new entries after 15:00 IST.
 * 7. Square off open positions at 15:15 IST (isSquareOffTime).
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
export function detectAlertCandle(candles, strategy = "EMA5") {
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
  if (strategy === "EMA5_OPTION") {
    // 5 EMA option buying needs the 20-EMA higher-timeframe trend filter.
    const ema20Series = emaSeries(closes, 20);
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
 * Detect breakout from alert candle
 * @param {Object[]} candles - Array of candles
 * @param {Object} alertCandle - The alert candle to check against
 * @returns {Object|null} Breakout signal or null
 */
export function detectBreakout(candles, alertCandle) {
  if (!alertCandle || candles.length < 2) return null;
  
  const latest = candles[candles.length - 1]; // Current forming candle
  const previous = candles[candles.length - 2]; // Just completed candle
  
  const latestHigh = latest[2];
  const latestLow = latest[3];
  const latestClose = latest[4];
  const latestTimestamp = latest[0];
  
  // Bullish breakout: Current candle breaks above alert candle high
  if (alertCandle.type === "BULLISH_ALERT") {
    if (latestHigh > alertCandle.high) {
      return {
        type: "LONG",
        entryPrice: alertCandle.high,
        stopLoss: alertCandle.low,
        target: alertCandle.high + (alertCandle.high - alertCandle.low) * 2, // 1:2 R:R
        alertCandle: alertCandle,
        breakoutCandle: latest,
        timestamp: latestTimestamp,
        risk: alertCandle.high - alertCandle.low,
      };
    }
  }
  
  // Bearish breakout: Current candle breaks below alert candle low
  if (alertCandle.type === "BEARISH_ALERT") {
    if (latestLow < alertCandle.low) {
      return {
        type: "SHORT",
        entryPrice: alertCandle.low,
        stopLoss: alertCandle.high,
        target: alertCandle.low - (alertCandle.high - alertCandle.low) * 2, // 1:2 R:R
        alertCandle: alertCandle,
        breakoutCandle: latest,
        timestamp: latestTimestamp,
        risk: alertCandle.high - alertCandle.low,
      };
    }
  }
  
  return null;
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
 * Get ATM (At The Money) option symbol
 * @param {string} underlying - NIFTY50-INDEX or NIFTYBANK-INDEX
 * @param {number} spotPrice - Current spot price
 * @param {string} type - CE or PE
 * @param {Object} optionChain - Option chain data
 * @returns {string|null} Option symbol
 */
export function getATMOption(underlying, spotPrice, type, optionChain) {
  if (!optionChain || optionChain.length === 0) return null;
  
  // Filter options of the right type (CE/PE)
  const options = optionChain.filter(opt => 
    opt.option_type === type || opt.optionType === type
  );
  
  if (options.length === 0) return null;
  
  // Find closest strike to spot price
  let closest = options[0];
  let minDiff = Math.abs((closest.strike_price || closest.strike) - spotPrice);
  
  for (const opt of options) {
    const strike = opt.strike_price || opt.strike;
    const diff = Math.abs(strike - spotPrice);
    if (diff < minDiff) {
      minDiff = diff;
      closest = opt;
    }
  }
  
  return closest.symbol || closest.tradingSymbol || closest.ts || null;
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
