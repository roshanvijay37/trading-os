/**
 * Shared signal primitives — the SINGLE source of truth for the 5-EMA alert rule and the
 * EMA used by BOTH the backtest (server/src/routes/backtest.js) and live trading
 * (server/src/services/emaStrategy.js → autoTrader.js).
 *
 * Before this module the two paths disagreed: the backtest used an SMA-seeded EMA and the
 * "candle entirely beyond the EMA" alert rule (Subhasish Pani's actual rule), while live
 * used a first-close-seeded EMA over only 5 closes and a CROSS-OVER alert rule. That meant
 * the bot fired on different candles than the ones backtested. Both now call these.
 */

/**
 * Exponential moving average, seeded with the SMA of the first `period` closes.
 * Returns an array of EMA values aligned to closes[period-1 .. end] (so the LAST element
 * is the EMA at the most recent close). Empty array if there are fewer closes than period.
 * This is the canonical definition (identical to src/lib/strategies/engine.ts).
 */
export function calculateEMA(closes, period) {
  const ema = [];
  if (closes.length < period) return ema;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  let prevEMA = sum / period;
  ema.push(prevEMA);

  const multiplier = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    prevEMA = (closes[i] - prevEMA) * multiplier + prevEMA;
    ema.push(prevEMA);
  }
  return ema;
}

/**
 * Classify a single (alert-candidate) candle against its EMA — Subhasish Pani's rule.
 *  - BULLISH alert: the candle is ENTIRELY below the 5-EMA (close < ema AND high < ema).
 *  - BEARISH alert: the candle is ENTIRELY above the 5-EMA (close > ema AND low > ema).
 * When `trendEma` is supplied (EMA5_OPTION), the candle must also be on the correct side
 * of the higher-timeframe trend (close above trendEma for bullish, below for bearish).
 *
 * @returns {"BULLISH"|"BEARISH"|null}
 */
export function detectAlert({ close, high, low, ema, trendEma = null }) {
  if (!(ema > 0)) return null;
  if (trendEma !== null && trendEma !== undefined) {
    if (close > trendEma && close < ema && high < ema) return "BULLISH";
    if (close < trendEma && close > ema && low > ema) return "BEARISH";
    return null;
  }
  if (close < ema && high < ema) return "BULLISH";
  if (close > ema && low > ema) return "BEARISH";
  return null;
}
