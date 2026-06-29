/**
 * Volatility analytics: historical / realized vol from candles, expected moves from IV,
 * ATR, and IV smile/skew extraction from the live chain. All COMPUTED.
 */

import type { EnrichedChain } from "../types";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Close-to-close annualized historical volatility (decimal) over the last `window` candles. */
export function historicalVolatility(candles: Candle[], window = 20, periodsPerYear = 252): number {
  if (candles.length < window + 1) return 0;
  const slice = candles.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].close > 0) rets.push(Math.log(slice[i].close / slice[i - 1].close));
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

/** Parkinson high-low realized volatility estimator (more efficient than close-to-close). */
export function parkinsonVolatility(candles: Candle[], window = 20, periodsPerYear = 252): number {
  if (candles.length < window) return 0;
  const slice = candles.slice(-window);
  const k = 1 / (4 * Math.log(2));
  let sum = 0;
  let n = 0;
  for (const c of slice) {
    if (c.high > 0 && c.low > 0) {
      sum += k * Math.log(c.high / c.low) ** 2;
      n++;
    }
  }
  if (n === 0) return 0;
  return Math.sqrt((sum / n) * periodsPerYear);
}

/** Wilder ATR over the candle series. */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Wilder smoothing.
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

export interface ExpectedMoves {
  daily: number;
  weekly: number;
  expiry: number;
  dailyPct: number;
  weeklyPct: number;
  expiryPct: number;
}

/** Expected moves from an annualized IV: spot × σ × √(days/365). */
export function expectedMoves(spot: number, iv: number, daysToExpiry: number): ExpectedMoves {
  const move = (days: number) => (spot > 0 && iv > 0 && days > 0 ? spot * iv * Math.sqrt(days / 365) : 0);
  const daily = move(1);
  const weekly = move(7);
  const expiry = move(Math.max(1, daysToExpiry));
  return {
    daily,
    weekly,
    expiry,
    dailyPct: spot > 0 ? (daily / spot) * 100 : 0,
    weeklyPct: spot > 0 ? (weekly / spot) * 100 : 0,
    expiryPct: spot > 0 ? (expiry / spot) * 100 : 0,
  };
}

export interface SmilePoint {
  strike: number;
  ceIv: number;
  peIv: number;
  /** IV used for the smile: PE IV below spot, CE IV above (the side with more time value). */
  iv: number;
}

/** IV smile across strikes (the real per-strike IV solved in chain.ts). */
export function ivSmile(chain: EnrichedChain): SmilePoint[] {
  return chain.rows
    .map((row) => {
      const ceIv = row.ce.iv;
      const peIv = row.pe.iv;
      const iv = row.strike >= chain.spot ? ceIv || peIv : peIv || ceIv;
      return { strike: row.strike, ceIv, peIv, iv };
    })
    .filter((p) => p.iv > 0);
}

export interface SkewSummary {
  atmIv: number;
  /** 25-delta-ish put minus call skew, in vol points. */
  skew: number;
  callWingIv: number;
  putWingIv: number;
}

/** Skew = OTM-put IV minus OTM-call IV (positive = the usual equity put skew). */
export function ivSkew(chain: EnrichedChain, wingSteps = 4): SkewSummary {
  const interval = chain.instrument.strikeInterval;
  const atmRow = chain.rows.find((r) => r.isAtm);
  const atmIv = atmRow ? atmRow.ce.iv || atmRow.pe.iv : 0;
  const putStrike = chain.atmStrike - wingSteps * interval;
  const callStrike = chain.atmStrike + wingSteps * interval;
  const putRow = chain.rows.find((r) => r.strike === putStrike);
  const callRow = chain.rows.find((r) => r.strike === callStrike);
  const putWingIv = putRow ? putRow.pe.iv : 0;
  const callWingIv = callRow ? callRow.ce.iv : 0;
  return {
    atmIv,
    putWingIv,
    callWingIv,
    skew: putWingIv > 0 && callWingIv > 0 ? (putWingIv - callWingIv) * 100 : 0,
  };
}

/** Average / highest / lowest of the solved per-strike IVs across the chain. */
export function ivSummary(chain: EnrichedChain): { avg: number; high: number; low: number } {
  const ivs: number[] = [];
  for (const row of chain.rows) {
    if (row.ce.iv > 0) ivs.push(row.ce.iv);
    if (row.pe.iv > 0) ivs.push(row.pe.iv);
  }
  if (ivs.length === 0) return { avg: 0, high: 0, low: 0 };
  return {
    avg: ivs.reduce((a, b) => a + b, 0) / ivs.length,
    high: Math.max(...ivs),
    low: Math.min(...ivs),
  };
}
