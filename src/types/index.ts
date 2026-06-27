export type TradeSide = "LONG" | "SHORT";
export type TradeOutcome = "OPEN" | "WIN" | "LOSS" | "BREAKEVEN";

export interface Settings {
  capital: number;
  riskPercent: number;
  dailyLossLimitPercent: number;
  maxTradesPerDay: number;
}

export interface RiskCalculation {
  riskAmount: number;
  stopDistance: number;
  maxQuantity: number;
}

export interface Trade {
  id: string;
  date: string;
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  stopLossPrice: number;
  quantity: number;
  riskAmount: number;
  followedRules: boolean;
  outcome: TradeOutcome;
  pnl: number;
  notes: string;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DisciplineSummary {
  score: number;
  currentStreak: number;
  ruleFollowingTrades: number;
  totalTrades: number;
}

// Market monitoring types
export interface OptionChainItem {
  symbol?: string;
  tradingSymbol?: string;
  ts?: string;
  strike_price?: number;
  strike?: number;
  option_type?: string;
  optionType?: string;
  ltp?: number;
  lp?: number;
  last_price?: number;
  ltpch?: number;
  ch?: number;
  chp?: number;
  ltpchp?: number;
  change_percent?: number;
  oi?: number;
  open_interest?: number;
}

export interface QuoteData {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  oi?: number;
  volume?: number;
  bid?: number;
  ask?: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
}

export interface MarketStatus {
  marketOpen: boolean;
  nextOpen?: string;
  segment?: string;
}

// Bot types
export interface BotPosition {
  id: string;
  optionSymbol: string;
  quantity: number;
  entryPrice: number;
  currentSL: number;
  target: number;
  pnl: number;
  status: string;
  underlying: string;
}

export interface BotSignal {
  type: string;
  entryPrice: number;
  stopLoss: number;
  target: number;
  timestamp: number;
  underlying: string;
  status: string;
}

export interface BotConfig {
  riskPercent: number;
  maxTradesPerDay: number;
  paperTrading: boolean;
  positionSizingMode: string;
  fixedLots: number;
  selectedStrategies: string[];
  selectedInstruments: string[];
}

export interface BotStatus {
  isRunning: boolean;
  marketStatus: string;
  todayTrades: number;
  maxTrades: number;
  openPositions: BotPosition[];
  activeAlerts: Record<string, any>;
  latestData: Record<string, any>;
  recentSignals: BotSignal[];
  capital: number;
  riskPercent: number;
  paperTrading: boolean;
  emergencyStop: boolean;
  positionSizingMode?: string;
  fixedLots?: number;
  selectedStrategies?: string[];
  selectedInstruments?: string[];
  dailyPnL?: string;
  consecutiveLosses?: number;
}
