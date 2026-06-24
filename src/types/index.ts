export type EmotionStatus = "SAFE" | "COOLDOWN" | "TRADE_DENIED";
export type TradeSide = "LONG" | "SHORT";
export type TradeOutcome = "OPEN" | "WIN" | "LOSS" | "BREAKEVEN";

export interface Settings {
  capital: number;
  riskPercent: number;
  dailyLossLimitPercent: number;
  maxTradesPerDay: number;
}

export interface EmotionAnswers {
  greedScore: number;
  recoveringLosses: boolean;
  missedPreviousMove: boolean;
  increasingLotSize: boolean;
}

export interface EmotionEvaluation {
  status: EmotionStatus;
  score: number;
  reasons: string[];
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
  emotionStatus: EmotionStatus;
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
