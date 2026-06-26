/**
 * Subhasish Pani's 5 EMA Strategy Engine
 * 
 * Rules:
 * 1. Use 5-minute timeframe
 * 2. Alert candle: Price crosses below/above 5 EMA (bearish/bullish alert)
 * 3. Entry: Next candle breaks alert candle high/low (bullish/bearish)
 * 4. Stop Loss: Alert candle low/high
 * 5. Risk per trade: 1% of capital
 * 6. No trading after 3:00 PM for new positions
 * 7. Square off by 3:15 PM
 */

import { getSession } from "../routes/auth.js";

// Store candles in memory (in production, use Redis/DB)
const candleStore = new Map();
const signalStore = [];
const MAX_STORED_SIGNALS = 100;

/**
 * Calculate 5-period EMA
 * @param {number[]} closes - Array of closing prices
 * @returns {number} EMA value
 */
export function calculateEMA(closes) {
  if (closes.length < 5) return null;
  
  const multiplier = 2 / (5 + 1);
  let ema = closes[0];
  
  for (let i = 1; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }
  
  return Math.round(ema * 100) / 100;
}

/**
 * Detect alert candle pattern
 * @param {Object[]} candles - Array of candles [timestamp, open, high, low, close, volume]
 * @returns {Object|null} Alert candle info or null
 */
export function detectAlertCandle(candles) {
  if (candles.length < 2) return null;
  
  const current = candles[candles.length - 1]; // Latest complete candle
  const previous = candles[candles.length - 2]; // Previous candle
  
  const currentClose = current[4];
  const previousClose = previous[4];
  const currentOpen = current[1];
  const previousOpen = previous[1];
  
  // Calculate 5 EMA for previous candles (need at least 5 candles before current)
  const closesForEMA = candles.slice(0, -1).map(c => c[4]);
  if (closesForEMA.length < 5) return null;
  
  const ema5 = calculateEMA(closesForEMA.slice(-5));
  if (!ema5) return null;
  
  // Bullish alert: Previous candle closed below 5 EMA, current candle closes above 5 EMA
  const bullishAlert = previousClose < ema5 && currentClose > ema5;
  
  // Bearish alert: Previous candle closed above 5 EMA, current candle closes below 5 EMA
  const bearishAlert = previousClose > ema5 && currentClose < ema5;
  
  if (!bullishAlert && !bearishAlert) return null;
  
  return {
    type: bullishAlert ? "BULLISH_ALERT" : "BEARISH_ALERT",
    candle: current,
    ema5: ema5,
    timestamp: current[0],
    high: current[2],
    low: current[3],
    close: currentClose,
    open: currentOpen,
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
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeDecimal = hours + minutes / 60;
  
  // Market hours: 9:15 AM to 3:30 PM IST
  // No new positions after 3:00 PM
  return timeDecimal >= 9.25 && timeDecimal < 15.0;
}

/**
 * Check if it's time to square off (3:15 PM)
 * @returns {boolean}
 */
export function isSquareOffTime() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  
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
    id: crypto.randomUUID(),
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