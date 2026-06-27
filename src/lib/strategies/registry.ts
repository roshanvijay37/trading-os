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
  { value: "OPTION", label: "Option Strategies" },
] as const;
