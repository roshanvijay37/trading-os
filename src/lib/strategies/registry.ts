/**
 * TradingOS — Strategy Registry
 * Single Source of Truth for ALL Trading Strategies
 *
 * Philosophy: One implementation. Backtest and Live use the same code.
 */

import type { StrategyDefinition, StrategyId } from "../../types/institutional";

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  {
    id: "EMA5",
    name: "5 EMA Trend Strategy",
    description: "Subhasish Pani's 5 EMA alert candle breakout system. Trades pullbacks to 5 EMA in trending markets.",
    category: "TREND_FOLLOWING",
    author: "Subhasish Pani",
    version: "1.0.0",
    parameters: [
      { name: "emaPeriod", type: "number", label: "EMA Period", description: "EMA lookback period", defaultValue: 5, min: 3, max: 50, step: 1 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance as % of price", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold position", defaultValue: 12, min: 3, max: 50, step: 1 },
      { name: "slippage", type: "number", label: "Slippage %", description: "Execution slippage estimate", defaultValue: 0.02, min: 0, max: 0.5, step: 0.01 },
    ],
    supportedTimeframes: ["1", "5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX", "NSE:FINNIFTY-INDEX"],
    minConfidence: 0.6,
    defaultAllocation: 20,
  },
  {
    id: "EMA5_OPTION",
    name: "5 EMA Option Buying",
    description: "5 EMA strategy adapted for option buying with trend filter on higher timeframe.",
    category: "OPTION",
    author: "Subhasish Pani",
    version: "1.0.0",
    parameters: [
      { name: "emaPeriod", type: "number", label: "EMA Period", description: "EMA lookback period", defaultValue: 5, min: 3, max: 50, step: 1 },
      { name: "trendEmaPeriod", type: "number", label: "Trend EMA Period", description: "Higher timeframe trend filter", defaultValue: 20, min: 10, max: 100, step: 5 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 8, min: 3, max: 30, step: 1 },
    ],
    supportedTimeframes: ["5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.65,
    defaultAllocation: 15,
  },
  {
    id: "RSI",
    name: "RSI 2-Period Mean Reversion",
    description: "Larry Connors' RSI-2 mean reversion strategy. Extreme RSI readings signal reversions.",
    category: "MEAN_REVERSION",
    author: "Larry Connors",
    version: "1.0.0",
    parameters: [
      { name: "rsiPeriod", type: "number", label: "RSI Period", description: "RSI calculation period", defaultValue: 2, min: 2, max: 14, step: 1 },
      { name: "oversoldThreshold", type: "number", label: "Oversold Level", description: "RSI oversold threshold", defaultValue: 10, min: 5, max: 30, step: 1 },
      { name: "overboughtThreshold", type: "number", label: "Overbought Level", description: "RSI overbought threshold", defaultValue: 90, min: 70, max: 95, step: 1 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 5, min: 2, max: 20, step: 1 },
    ],
    supportedTimeframes: ["5", "15", "60"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.55,
    defaultAllocation: 10,
  },
  {
    id: "TRAFFIC_LIGHT",
    name: "Traffic Light System",
    description: "Multi-timeframe trend following with EMA20/EMA50 cross and pullback entries.",
    category: "TREND_FOLLOWING",
    author: "Subhasish Pani",
    version: "1.0.0",
    parameters: [
      { name: "fastEma", type: "number", label: "Fast EMA", description: "Fast EMA period", defaultValue: 20, min: 5, max: 50, step: 1 },
      { name: "slowEma", type: "number", label: "Slow EMA", description: "Slow EMA period", defaultValue: 50, min: 20, max: 200, step: 5 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 15, min: 5, max: 50, step: 1 },
    ],
    supportedTimeframes: ["15", "30", "60"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.6,
    defaultAllocation: 15,
  },
  {
    id: "INSIDE_CANDLE",
    name: "Inside Candle Breakout",
    description: "Breakout from inside candle pattern with mother candle as reference.",
    category: "BREAKOUT",
    author: "Price Action",
    version: "1.0.0",
    parameters: [
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 10, min: 3, max: 30, step: 1 },
    ],
    supportedTimeframes: ["5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.55,
    defaultAllocation: 10,
  },
  {
    id: "VWAP_REVERSAL",
    name: "VWAP Reversal",
    description: "Anant Ladha's VWAP reversal strategy. Price reclaiming VWAP with volume confirmation.",
    category: "MEAN_REVERSION",
    author: "Anant Ladha",
    version: "1.0.0",
    parameters: [
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 8, min: 3, max: 20, step: 1 },
      { name: "volumeMultiplier", type: "number", label: "Volume Multiplier", description: "Min volume vs previous candle", defaultValue: 1.2, min: 1, max: 3, step: 0.1 },
    ],
    supportedTimeframes: ["5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.6,
    defaultAllocation: 10,
  },
  {
    id: "ORB",
    name: "Opening Range Breakout",
    description: "First 15-minute range breakout with momentum continuation.",
    category: "BREAKOUT",
    author: "Toby Crabel",
    version: "1.0.0",
    parameters: [
      { name: "orbMinutes", type: "number", label: "ORB Minutes", description: "Opening range duration", defaultValue: 15, min: 5, max: 60, step: 5 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 20, min: 5, max: 50, step: 1 },
    ],
    supportedTimeframes: ["5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.55,
    defaultAllocation: 10,
  },
  {
    id: "CPR_BREAKOUT",
    name: "CPR Breakout",
    description: "Vivek Bajaj's Central Pivot Range breakout with volume confirmation.",
    category: "BREAKOUT",
    author: "Vivek Bajaj",
    version: "1.0.0",
    parameters: [
      { name: "emaPeriod", type: "number", label: "EMA Period", description: "Trend filter EMA", defaultValue: 20, min: 10, max: 50, step: 5 },
      { name: "volumeMultiplier", type: "number", label: "Volume Multiplier", description: "Min volume vs previous", defaultValue: 1.2, min: 1, max: 3, step: 0.1 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 12, min: 3, max: 30, step: 1 },
    ],
    supportedTimeframes: ["15", "30", "60"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.6,
    defaultAllocation: 10,
  },
  {
    id: "EMA9_20",
    name: "9/20 EMA Crossover",
    description: "Power of Stocks' 9/20 EMA crossover with pullback entry in trending markets.",
    category: "TREND_FOLLOWING",
    author: "Power of Stocks",
    version: "1.0.0",
    parameters: [
      { name: "fastEma", type: "number", label: "Fast EMA", description: "Fast EMA period", defaultValue: 9, min: 5, max: 20, step: 1 },
      { name: "slowEma", type: "number", label: "Slow EMA", description: "Slow EMA period", defaultValue: 20, min: 10, max: 50, step: 1 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 10, min: 3, max: 30, step: 1 },
    ],
    supportedTimeframes: ["5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.6,
    defaultAllocation: 10,
  },
  {
    id: "FAILED_BREAKOUT",
    name: "Failed Breakout",
    description: "Al Brooks style failed breakout reversals. Trap pattern recognition.",
    category: "MEAN_REVERSION",
    author: "Al Brooks",
    version: "1.0.0",
    parameters: [
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 8, min: 3, max: 20, step: 1 },
    ],
    supportedTimeframes: ["5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.55,
    defaultAllocation: 10,
  },
  {
    id: "OPENING_MOMENTUM",
    name: "Opening Momentum",
    description: "First 20-minute momentum capture with ATR-based targets.",
    category: "MOMENTUM",
    author: "Intraday Momentum",
    version: "1.0.0",
    parameters: [
      { name: "openingMinutes", type: "number", label: "Opening Window", description: "Minutes after open to trade", defaultValue: 20, min: 10, max: 60, step: 5 },
      { name: "atrPeriod", type: "number", label: "ATR Period", description: "ATR calculation period", defaultValue: 14, min: 5, max: 30, step: 1 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "ATR multiplier for target", defaultValue: 1.5, min: 0.5, max: 3, step: 0.5 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 6, min: 2, max: 15, step: 1 },
    ],
    supportedTimeframes: ["1", "5"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.55,
    defaultAllocation: 5,
  },
  {
    id: "MEAN_REVERSION",
    name: "Mean Reversion",
    description: "Statistical mean reversion using Bollinger Bands and RSI confluence.",
    category: "MEAN_REVERSION",
    version: "1.0.0",
    parameters: [
      { name: "bbPeriod", type: "number", label: "BB Period", description: "Bollinger Bands period", defaultValue: 20, min: 10, max: 50, step: 1 },
      { name: "bbStdDev", type: "number", label: "BB StdDev", description: "Standard deviation multiplier", defaultValue: 2, min: 1, max: 4, step: 0.5 },
      { name: "rsiPeriod", type: "number", label: "RSI Period", description: "RSI period", defaultValue: 14, min: 5, max: 30, step: 1 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 1.5, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 8, min: 3, max: 20, step: 1 },
    ],
    supportedTimeframes: ["5", "15", "60"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.6,
    defaultAllocation: 10,
  },
  {
    id: "BOLLINGER_BREAKOUT",
    name: "Bollinger Breakout",
    description: "Volatility expansion breakout using Bollinger Band squeeze.",
    category: "BREAKOUT",
    version: "1.0.0",
    parameters: [
      { name: "bbPeriod", type: "number", label: "BB Period", description: "Bollinger Bands period", defaultValue: 20, min: 10, max: 50, step: 1 },
      { name: "bbStdDev", type: "number", label: "BB StdDev", description: "Standard deviation multiplier", defaultValue: 2, min: 1, max: 4, step: 0.5 },
      { name: "squeezeThreshold", type: "number", label: "Squeeze Threshold", description: "Band width threshold", defaultValue: 0.1, min: 0.05, max: 0.3, step: 0.01 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 10, min: 3, max: 30, step: 1 },
    ],
    supportedTimeframes: ["5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.6,
    defaultAllocation: 10,
  },
  {
    id: "SUPERTREND",
    name: "SuperTrend",
    description: "ATR-based trend following with dynamic stop loss.",
    category: "TREND_FOLLOWING",
    version: "1.0.0",
    parameters: [
      { name: "atrPeriod", type: "number", label: "ATR Period", description: "ATR calculation period", defaultValue: 10, min: 5, max: 30, step: 1 },
      { name: "multiplier", type: "number", label: "Multiplier", description: "ATR multiplier", defaultValue: 3, min: 1, max: 10, step: 0.5 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 15, min: 5, max: 50, step: 1 },
    ],
    supportedTimeframes: ["5", "15", "30"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.6,
    defaultAllocation: 15,
  },
  {
    id: "OPTION_MOMENTUM",
    name: "Option Momentum",
    description: "Options-specific momentum strategy using OI and volume surge.",
    category: "OPTION",
    version: "1.0.0",
    parameters: [
      { name: "volumeThreshold", type: "number", label: "Volume Threshold", description: "Min volume vs average", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "oiThreshold", type: "number", label: "OI Threshold", description: "Min OI change %", defaultValue: 10, min: 5, max: 50, step: 5 },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 1.5, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 5, min: 2, max: 15, step: 1 },
    ],
    supportedTimeframes: ["1", "5"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.65,
    defaultAllocation: 10,
  },
  {
    id: "PRICE_ACTION",
    name: "Price Action",
    description: "Pure price action patterns: pin bars, engulfing, morning/evening stars.",
    category: "TREND_FOLLOWING",
    version: "1.0.0",
    parameters: [
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 8, min: 3, max: 20, step: 1 },
    ],
    supportedTimeframes: ["5", "15"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.55,
    defaultAllocation: 10,
  },
  {
    id: "CUSTOM",
    name: "Custom Strategy",
    description: "User-defined custom strategy with configurable parameters.",
    category: "CUSTOM",
    version: "1.0.0",
    parameters: [
      { name: "customLogic", type: "string", label: "Strategy Logic", description: "Custom strategy parameters", defaultValue: "" },
      { name: "slBuffer", type: "number", label: "SL Buffer %", description: "Stop loss distance", defaultValue: 0.005, min: 0.001, max: 0.05, step: 0.001 },
      { name: "targetMultiplier", type: "number", label: "Target Multiplier", description: "R:R ratio", defaultValue: 2, min: 1, max: 5, step: 0.5 },
      { name: "maxHoldBars", type: "number", label: "Max Hold Bars", description: "Maximum bars to hold", defaultValue: 10, min: 3, max: 30, step: 1 },
    ],
    supportedTimeframes: ["1", "5", "15", "30", "60"],
    supportedInstruments: ["NSE:NIFTYBANK-INDEX", "NSE:NIFTY50-INDEX"],
    minConfidence: 0.5,
    defaultAllocation: 5,
  },
];

export function getStrategyById(id: StrategyId): StrategyDefinition | undefined {
  return STRATEGY_DEFINITIONS.find((s) => s.id === id);
}

export function getStrategiesByCategory(category: StrategyDefinition["category"]): StrategyDefinition[] {
  return STRATEGY_DEFINITIONS.filter((s) => s.category === category);
}

export function getAllStrategyIds(): StrategyId[] {
  return STRATEGY_DEFINITIONS.map((s) => s.id);
}

export function getDefaultStrategyConfig(strategyId: StrategyId) {
  const def = getStrategyById(strategyId);
  if (!def) return null;

  const params: Record<string, number | boolean | string> = {};
  for (const p of def.parameters) {
    params[p.name] = p.defaultValue;
  }

  return {
    strategyId,
    enabled: false,
    capitalAllocationPercent: def.defaultAllocation,
    riskPercent: 1,
    maxTrades: 10,
    maxConsecutiveLosses: 3,
    tradingSession: "FULL" as const,
    allowedSymbols: def.supportedInstruments,
    allowedExpiry: "WEEKLY" as const,
    allowedDays: [1, 2, 3, 4, 5], // Mon-Fri
    maxDrawdown: 5,
    dailyLossLimit: 10000,
    cooldownAfterLoss: 30,
    confidenceThreshold: def.minConfidence,
    priority: 5,
    executionWeight: 1,
    parameters: params,
  };
}

export const STRATEGY_CATEGORIES = [
  { value: "TREND_FOLLOWING", label: "Trend Following" },
  { value: "MEAN_REVERSION", label: "Mean Reversion" },
  { value: "MOMENTUM", label: "Momentum" },
  { value: "BREAKOUT", label: "Breakout" },
  { value: "OPTION", label: "Option Strategies" },
  { value: "CUSTOM", label: "Custom" },
] as const;