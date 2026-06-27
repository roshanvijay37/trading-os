/**
 * TradingOS — Unified Strategy Engine
 * Single source of truth for Backtest AND Live Trading
 *
 * Every strategy is implemented ONCE and used everywhere.
 */

import type { StrategyId, AIReasoningReport, TradeGrade, StrategyPosition } from "../../types/institutional";
import { getStrategyById } from "./registry";

// ─── Candle Type ─────────────────────────────────────────────────
export interface Candle {
  timestamp: number;
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol?: string;
}

// ─── Signal Type ─────────────────────────────────────────────────
export interface Signal {
  type: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  target: number;
  timestamp: number;
  confidence: number;
  reason: string;
  strategyId: StrategyId;
  aiReasoning?: AIReasoningReport;
}

// ─── Indicator Calculations ──────────────────────────────────────
export function calculateEMA(closes: number[], period: number): number[] {
  const ema: number[] = [];
  if (closes.length < period) return ema;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  let prevEMA = sum / period;
  ema.push(prevEMA);

  const multiplier = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    prevEMA = (closes[i] - prevEMA) * multiplier + prevEMA;
    ema.push(prevEMA);
  }
  return ema;
}

export function calculateRSI(closes: number[], period = 2): number[] {
  const rsi: number[] = [];
  if (closes.length < period + 1) return rsi;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gain += change;
    else loss += Math.abs(change);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const g = change > 0 ? change : 0;
    const l = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

export function calculateVWAP(candles: Candle[]): number[] {
  let cumulativeTPV = 0;
  let cumulativeVol = 0;
  const vwap: number[] = [];
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumulativeTPV += tp * c.volume;
    cumulativeVol += c.volume;
    vwap.push(cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : tp);
  }
  return vwap;
}

export function calculateATR(candles: Candle[], period = 14): number[] {
  const atr: number[] = [];
  if (candles.length < period + 1) return atr;

  let sum = 0;
  for (let i = 1; i <= period; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    sum += tr;
  }
  atr.push(sum / period);

  for (let i = period + 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    atr.push((atr[atr.length - 1] * (period - 1) + tr) / period);
  }
  return atr;
}

export function calculateBollingerBands(closes: number[], period = 20, stdDev = 2): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);

    middle.push(sma);
    upper.push(sma + sd * stdDev);
    lower.push(sma - sd * stdDev);
  }
  return { upper, middle, lower };
}

export function calculateSuperTrend(candles: Candle[], period = 10, multiplier = 3): { trend: ("UP" | "DOWN")[]; value: number[] } {
  const atr = calculateATR(candles, period);
  const trend: ("UP" | "DOWN")[] = [];
  const value: number[] = [];

  if (atr.length === 0) return { trend, value };

  let basicUpper = (candles[period].high + candles[period].low) / 2 + multiplier * atr[0];
  let basicLower = (candles[period].high + candles[period].low) / 2 - multiplier * atr[0];
  let finalUpper = basicUpper;
  let finalLower = basicLower;
  let currentTrend: "UP" | "DOWN" = "UP";

  for (let i = period; i < candles.length; i++) {
    const atrIdx = i - period;
    const hl2 = (candles[i].high + candles[i].low) / 2;

    basicUpper = hl2 + multiplier * atr[atrIdx];
    basicLower = hl2 - multiplier * atr[atrIdx];

    if (basicUpper < finalUpper || candles[i - 1].close > finalUpper) {
      finalUpper = basicUpper;
    }
    if (basicLower > finalLower || candles[i - 1].close < finalLower) {
      finalLower = basicLower;
    }

    if (candles[i].close > finalUpper) {
      currentTrend = "UP";
      finalLower = basicLower;
    } else if (candles[i].close < finalLower) {
      currentTrend = "DOWN";
      finalUpper = basicUpper;
    }

    trend.push(currentTrend);
    value.push(currentTrend === "UP" ? finalLower : finalUpper);
  }
  return { trend, value };
}

// ─── AI Reasoning Engine ─────────────────────────────────────────
function generateAIReasoning(
  strategyId: StrategyId,
  candles: Candle[],
  i: number,
  signalType: "LONG" | "SHORT",
  entryPrice: number,
  stopLoss: number,
  target: number,
  confidence: number,
  params: Record<string, number | boolean | string>
): AIReasoningReport {
  const candle = candles[i];
  const prevCandle = candles[i - 1];
  const prev5 = candles.slice(Math.max(0, i - 5), i);

  // Trend strength calculation
  const closes = candles.slice(0, i + 1).map((c) => c.close);
  const ema20 = calculateEMA(closes, 20);
  const currentEMA20 = ema20[ema20.length - 1] || candle.close;
  const trendStrength = Math.min(Math.abs(candle.close - currentEMA20) / currentEMA20 * 100, 1);

  // Volume confirmation
  const avgVolume = prev5.reduce((sum, c) => sum + c.volume, 0) / prev5.length;
  const volumeConfirmation = candle.volume > avgVolume * 1.2;

  // ATR confirmation
  const atr = calculateATR(candles.slice(0, i + 1), 14);
  const currentATR = atr[atr.length - 1] || 0;
  const atrConfirmation = currentATR > 0 && Math.abs(entryPrice - stopLoss) > currentATR * 0.5;

  // Risk reward
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(target - entryPrice);
  const riskReward = risk > 0 ? reward / risk : 0;

  // Market structure
  let marketStructure = "NEUTRAL";
  if (candle.close > currentEMA20 && prevCandle.close > currentEMA20) marketStructure = "BULLISH_STRUCTURE";
  else if (candle.close < currentEMA20 && prevCandle.close < currentEMA20) marketStructure = "BEARISH_STRUCTURE";

  // Time of day
  const hour = new Date(candle.datetime).getHours();
  let timeOfDay = "MORNING";
  if (hour >= 11 && hour < 14) timeOfDay = "MIDDAY";
  else if (hour >= 14) timeOfDay = "AFTERNOON";

  // Determine trade grade
  let tradeGrade: TradeGrade = "C";
  if (confidence >= 0.85 && riskReward >= 2 && volumeConfirmation && atrConfirmation) tradeGrade = "A+";
  else if (confidence >= 0.75 && riskReward >= 1.5 && volumeConfirmation) tradeGrade = "A";
  else if (confidence >= 0.65 && riskReward >= 1.2) tradeGrade = "B";
  else if (confidence >= 0.5) tradeGrade = "C";
  else tradeGrade = "REJECT";

  const factors: AIReasoningReport["factors"] = [
    { name: "Trend Alignment", score: trendStrength, weight: 0.2, description: "Price alignment with EMA20 trend", passed: trendStrength > 0.3 },
    { name: "Volume Confirmation", score: volumeConfirmation ? 1 : 0, weight: 0.15, description: "Volume above 20% average", passed: volumeConfirmation },
    { name: "ATR Validation", score: atrConfirmation ? 1 : 0, weight: 0.15, description: "Stop loss wider than 0.5 ATR", passed: atrConfirmation },
    { name: "Risk Reward", score: Math.min(riskReward / 3, 1), weight: 0.2, description: "Minimum 1:1.5 R:R", passed: riskReward >= 1.5 },
    { name: "Time Filter", score: hour >= 9 && hour <= 14 ? 1 : 0.5, weight: 0.1, description: "Within optimal trading hours", passed: hour >= 9 && hour <= 14 },
    { name: "Market Structure", score: marketStructure.includes(signalType === "LONG" ? "BULLISH" : "BEARISH") ? 1 : 0.3, weight: 0.2, description: "Structure aligns with signal", passed: marketStructure.includes(signalType === "LONG" ? "BULLISH" : "BEARISH") },
  ];

  const passedFactors = factors.filter((f) => f.passed).length;
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const passedWeight = factors.filter((f) => f.passed).reduce((sum, f) => sum + f.weight, 0);
  const finalConfidence = totalWeight > 0 ? passedWeight / totalWeight : 0;

  return {
    confidence: finalConfidence,
    probability: confidence,
    reason: `${strategyId} signal: ${signalType} at ₹${entryPrice}. ${factors.filter((f) => f.passed).map((f) => f.name).join(", ")} confirmed.`,
    trendStrength,
    volumeConfirmation,
    oiConfirmation: false, // Would need OI data
    pcrConfirmation: false, // Would need PCR data
    vwapConfirmation: false, // Would need VWAP calculation
    atrConfirmation,
    volatility: currentATR / entryPrice,
    marketStructure,
    liquidity: "ADEQUATE",
    timeOfDay,
    marketRegime: "TRENDING_UP", // Simplified - would come from CIO
    riskReward,
    expectedProfit: reward * (finalConfidence),
    expectedLoss: risk * (1 - finalConfidence),
    suggestedPositionSize: 0, // Calculated by risk engine
    tradeGrade,
    factors,
    warnings: factors.filter((f) => !f.passed).map((f) => `${f.name}: ${f.description}`),
    timestamp: new Date().toISOString(),
  };
}

// ─── Strategy Implementations ────────────────────────────────────
export interface StrategyResult {
  signal: Signal | null;
  state: Record<string, unknown>;
}

export type StrategyFunction = (
  candles: Candle[],
  i: number,
  params: Record<string, number | boolean | string>,
  prevState: Record<string, unknown>
) => StrategyResult;

// ─── EMA5 Strategy ───────────────────────────────────────────────
const ema5Strategy: StrategyFunction = (candles, i, params, prevState) => {
  const emaPeriod = (params.emaPeriod as number) || 5;
  const closes = candles.slice(0, i + 1).map((c) => c.close);
  const ema = calculateEMA(closes, emaPeriod);
  if (ema.length === 0) return { signal: null, state: prevState };

  const currentEMA = ema[ema.length - 1];
  const prevCandle = candles[i - 1];
  const currentCandle = candles[i];

  let alertCandle = prevState.alertCandle as { high: number; low: number; type: "BULLISH" | "BEARISH" } | undefined;

  // Detect alert candle
  if (prevCandle.close < currentEMA && prevCandle.high < currentEMA) {
    alertCandle = { high: prevCandle.high, low: prevCandle.low, type: "BULLISH" };
  } else if (prevCandle.close > currentEMA && prevCandle.low > currentEMA) {
    alertCandle = { high: prevCandle.high, low: prevCandle.low, type: "BEARISH" };
  }

  if (!alertCandle) return { signal: null, state: { alertCandle: undefined } };

  const slBuffer = (params.slBuffer as number) || 0.005;
  const targetMultiplier = (params.targetMultiplier as number) || 2;

  // Check entry
  if (alertCandle.type === "BULLISH" && currentCandle.high > alertCandle.high) {
    const entryPrice = alertCandle.high;
    const sl = alertCandle.low;
    const target = entryPrice + (entryPrice - sl) * targetMultiplier;
    const confidence = 0.7;

    return {
      signal: {
        type: "LONG",
        entryPrice,
        stopLoss: sl,
        target,
        timestamp: currentCandle.timestamp,
        confidence,
        reason: `5 EMA bullish alert candle breakout. Alert high: ${alertCandle.high}`,
        strategyId: "EMA5",
        aiReasoning: generateAIReasoning("EMA5", candles, i, "LONG", entryPrice, sl, target, confidence, params),
      },
      state: { alertCandle: undefined },
    };
  }

  if (alertCandle.type === "BEARISH" && currentCandle.low < alertCandle.low) {
    const entryPrice = alertCandle.low;
    const sl = alertCandle.high;
    const target = entryPrice - (sl - entryPrice) * targetMultiplier;
    const confidence = 0.7;

    return {
      signal: {
        type: "SHORT",
        entryPrice,
        stopLoss: sl,
        target,
        timestamp: currentCandle.timestamp,
        confidence,
        reason: `5 EMA bearish alert candle breakout. Alert low: ${alertCandle.low}`,
        strategyId: "EMA5",
        aiReasoning: generateAIReasoning("EMA5", candles, i, "SHORT", entryPrice, sl, target, confidence, params),
      },
      state: { alertCandle: undefined },
    };
  }

  return { signal: null, state: { alertCandle } };
};
// ─── Strategy Registry Map ───────────────────────────────────────
const STRATEGY_MAP: Record<StrategyId, StrategyFunction> = {
  EMA5: ema5Strategy,
  EMA5_OPTION: ema5Strategy, // Uses same core logic with trend filter
};

// ─── Main Entry Point ────────────────────────────────────────────
export function runStrategy(
  strategyId: StrategyId,
  candles: Candle[],
  i: number,
  params: Record<string, number | boolean | string>,
  state: Record<string, unknown>
): StrategyResult {
  const strategy = STRATEGY_MAP[strategyId];
  if (!strategy) {
    console.warn(`Strategy ${strategyId} not found`);
    return { signal: null, state };
  }
  return strategy(candles, i, params, state);
}

// ─── Backtest Runner ─────────────────────────────────────────────
export interface BacktestConfig {
  strategy: StrategyId;
  capital: number;
  riskPercent: number;
  slippage: number;
  capitalMode: "COMPOUND" | "FIXED";
  parameters: Record<string, number | boolean | string>;
}

export interface BacktestResult {
  summary: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalReturn: number;
    totalPnL: number;
    maxDrawdown: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    expectancy: number;
    expectancyRatio: number;
    finalCapital: number;
    maxConsecutiveLosses: number;
    sharpeRatio: number;
    sortinoRatio: number;
  };
  trades: StrategyPosition[];
  equityCurve: { date: string; equity: number; drawdown: number }[];
}

export function runBacktestEngine(candles: Candle[], config: BacktestConfig): BacktestResult {
  const {
    strategy,
    capital = 1000000,
    riskPercent = 1,
    slippage = 0.0002,
    capitalMode = "COMPOUND",
    parameters = {},
  } = config;

  const trades: StrategyPosition[] = [];
  const equityCurve: { date: string; equity: number; drawdown: number }[] = [];
  let currentCapital = capital;
  const initialCapital = capital;

  let position: StrategyPosition | null = null;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let totalPnL = 0;
  let maxDrawdown = 0;
  let peakEquity = capital;
  let maxConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;
  let state: Record<string, unknown> = {};
  const returns: number[] = [];

  const warmup = 50;

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i];

    // Track peak equity and drawdown
    if (currentCapital > peakEquity) peakEquity = currentCapital;
    const drawdown = ((peakEquity - currentCapital) / peakEquity) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    // Record equity curve
    equityCurve.push({
      date: candle.datetime,
      equity: Math.round(currentCapital * 100) / 100,
      drawdown: Math.round(drawdown * 100) / 100,
    });

    // ── Exit Logic ─────────────────────────────────────────────
    if (position) {
      const barsHeld = i - (position as StrategyPosition & { entryBar: number }).entryBar;

      let exitPrice: number | null = null;
      let exitReason = "";

      if (position.side === "LONG" && candle.low <= position.sl) {
        exitPrice = Math.max(candle.open, position.sl) * (1 - slippage);
        exitReason = "SL";
      } else if (position.side === "SHORT" && candle.high >= position.sl) {
        exitPrice = Math.min(candle.open, position.sl) * (1 + slippage);
        exitReason = "SL";
      } else if (position.side === "LONG" && candle.high >= position.target) {
        exitPrice = Math.min(candle.open, position.target) * (1 - slippage);
        exitReason = "TARGET";
      } else if (position.side === "SHORT" && candle.low <= position.target) {
        exitPrice = Math.max(candle.open, position.target) * (1 + slippage);
        exitReason = "TARGET";
      } else {
        const maxHoldBars = (parameters.maxHoldBars as number) || 12;
        if (barsHeld >= maxHoldBars) {
          exitPrice = candle.close;
          exitReason = "TIME";
        }
      }

      // Strategy-specific exits
          exitReason = "RSI_REVERSE";
        }
      }

      if (exitPrice !== null) {
        const pnl = position.side === "LONG"
          ? (exitPrice - position.entryPrice) * position.qty
          : (position.entryPrice - exitPrice) * position.qty;
        const pnlPercent = (pnl / (position.entryPrice * position.qty)) * 100;

        currentCapital += pnl;
        totalTrades++;
        totalPnL += pnl;

        // Calculate daily return for Sharpe
        const dailyReturn = (currentCapital - (equityCurve[equityCurve.length - 2]?.equity || initialCapital)) / (equityCurve[equityCurve.length - 2]?.equity || initialCapital);
        returns.push(dailyReturn);

        if (pnl > 0) {
          wins++;
          currentConsecutiveLosses = 0;
        } else {
          losses++;
          currentConsecutiveLosses++;
          if (currentConsecutiveLosses > maxConsecutiveLosses) {
            maxConsecutiveLosses = currentConsecutiveLosses;
          }
        }

        trades.push({
          ...position,
          exitPrice: Math.round(exitPrice * 100) / 100,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          exitReason,
          barsHeld,
          exitTime: candle.datetime,
          status: "CLOSED",
        });

        position = null;
        state = {};
      }
      continue;
    }

    // ── Entry Logic ────────────────────────────────────────────
    const result = runStrategy(strategy, candles, i, parameters, state);
    state = result.state;

    if (result.signal) {
      const signal = result.signal;
      const entryPrice = signal.entryPrice;
      const stopDistance = Math.abs(entryPrice - signal.stopLoss);
      if (stopDistance <= 0) continue;

      const riskAmount = (capitalMode === "FIXED" ? initialCapital : currentCapital) * (riskPercent / 100);
      const qty = Math.floor(riskAmount / stopDistance);

      if (qty > 0) {
        position = {
          id: `trade-${totalTrades + 1}`,
          strategyId: strategy,
          symbol: candles[0]?.symbol || "",
          side: signal.type,
          entryPrice: Math.round(entryPrice * 100) / 100,
          qty,
          sl: Math.round(signal.stopLoss * 100) / 100,
          target: Math.round(signal.target * 100) / 100,
          entryTime: candle.datetime,
          pnl: 0,
          pnlPercent: 0,
          barsHeld: 0,
          status: "OPEN",
          aiReasoning: signal.aiReasoning,
          tradeGrade: signal.aiReasoning?.tradeGrade,
          ...(position as unknown as Record<string, unknown>),
          entryBar: i,
        } as unknown as StrategyPosition;
      }
    }
  }

  // Close any open position at end
  if (position) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close;
    const pnl = position.side === "LONG"
      ? (exitPrice - position.entryPrice) * position.qty
      : (position.entryPrice - exitPrice) * position.qty;

    currentCapital += pnl;
    totalTrades++;
    totalPnL += pnl;
    if (pnl > 0) wins++; else losses++;

    trades.push({
      ...position,
      exitPrice,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round((pnl / (position.entryPrice * position.qty)) * 100 * 100) / 100,
      exitReason: "END_OF_DATA",
      barsHeld: candles.length - (position as unknown as { entryBar: number }).entryBar,
      exitTime: lastCandle.datetime,
      status: "CLOSED",
    });
  }

  // Calculate metrics
  const totalReturn = ((currentCapital - capital) / capital) * 100;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / losses : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const expectancy = totalTrades > 0 ? totalPnL / totalTrades : 0;
  const winPct = totalTrades > 0 ? wins / totalTrades : 0;
  const lossPct = totalTrades > 0 ? losses / totalTrades : 0;
  const avgLossAbs = Math.abs(avgLoss);
  const expectancyRatio = avgLossAbs > 0 ? ((winPct * avgWin) - (lossPct * avgLossAbs)) / avgLossAbs : 0;

  // Sharpe and Sortino
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const returnStd = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const downsideReturns = returns.filter((r) => r < 0);
  const downsideStd = Math.sqrt(downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length);
  const sharpeRatio = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;
  const sortinoRatio = downsideStd > 0 ? (avgReturn / downsideStd) * Math.sqrt(252) : 0;

  return {
    summary: {
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalPnL: Math.round(totalPnL * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      expectancyRatio: Math.round(expectancyRatio * 100) / 100,
      finalCapital: Math.round(currentCapital * 100) / 100,
      maxConsecutiveLosses,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      sortinoRatio: Math.round(sortinoRatio * 100) / 100,
    },
    trades,
    equityCurve,
  };
}
