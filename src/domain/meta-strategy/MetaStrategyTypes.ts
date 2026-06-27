import { z } from 'zod';

export enum SignalVerdict {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  HOLD = 'HOLD',
  REDUCE_SIZE = 'REDUCE_SIZE',
  MODIFY_PRICE = 'MODIFY_PRICE',
  DELEGATE = 'DELEGATE',
}

export const SignalEvaluationSchema = z.object({
  signalId: z.string().uuid(),
  strategyId: z.string(),
  symbol: z.string(),
  side: z.enum(['LONG', 'SHORT']),
  proposedSize: z.number().positive(),
  proposedEntry: z.number().positive(),
  proposedStop: z.number().positive(),
  proposedTarget: z.number().positive(),
  confidence: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
});

export type SignalEvaluation = z.infer<typeof SignalEvaluationSchema>;

export const MetaEvaluationSchema = z.object({
  signalId: z.string().uuid(),
  verdict: z.nativeEnum(SignalVerdict),
  finalSize: z.number().optional(),
  finalEntry: z.number().optional(),
  finalStop: z.number().optional(),
  finalTarget: z.number().optional(),
  confidenceAdjustment: z.number(),
  reasoning: z.array(z.string()),
  riskAssessment: z.object({
    portfolioVaRImpact: z.number(),
    correlationRisk: z.number(),
    concentrationRisk: z.number(),
    liquidityRisk: z.number(),
    volatilityRisk: z.number(),
    regimeSuitability: z.number(),
  }),
  executionAssessment: z.object({
    expectedSlippage: z.number(),
    marketImpact: z.number(),
    timingScore: z.number(),
    urgency: z.enum(['immediate', 'opportunistic', 'patient']),
  }),
  timestamp: z.string().datetime(),
  evaluatorVersion: z.string(),
});

export type MetaEvaluation = z.infer<typeof MetaEvaluationSchema>;

export const StrategyConflictSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string(),
  strategyA: z.string(),
  strategyB: z.string(),
  conflictType: z.enum(['opposing_signals', 'correlation_spike', 'capital_overallocation', 'timing_collision']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string(),
  detectedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolution: z.string().optional(),
});

export type StrategyConflict = z.infer<typeof StrategyConflictSchema>;

export const MarketRegimeSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  regime: z.enum([
    'trending_up_strong',
    'trending_up_weak',
    'trending_down_strong',
    'trending_down_weak',
    'ranging_tight',
    'ranging_wide',
    'volatile_expansion',
    'volatile_contraction',
    'accumulation',
    'distribution',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
  features: z.record(z.number()),
  duration: z.number(),
  transitions: z.array(z.object({
    from: z.string(),
    to: z.string(),
    probability: z.number(),
    timestamp: z.string().datetime(),
  })),
});

export type MarketRegime = z.infer<typeof MarketRegimeSchema>;

export const PortfolioStateSchema = z.object({
  timestamp: z.string().datetime(),
  totalCapital: z.number().positive(),
  allocatedCapital: z.number(),
  availableCapital: z.number(),
  totalExposure: z.number(),
  grossExposure: z.number(),
  netExposure: z.number(),
  positions: z.array(z.object({
    symbol: z.string(),
    strategyId: z.string(),
    side: z.enum(['LONG', 'SHORT']),
    size: z.number(),
    entryPrice: z.number(),
    currentPrice: z.number(),
    unrealizedPnL: z.number(),
    marginUsed: z.number(),
  })),
  strategyAllocations: z.record(z.number()),
  sectorExposures: z.record(z.number()),
  var95: z.number(),
  var99: z.number(),
  expectedShortfall: z.number(),
  maxDrawdown: z.number(),
  sharpeRatio: z.number(),
  sortinoRatio: z.number(),
});

export type PortfolioState = z.infer<typeof PortfolioStateSchema>;