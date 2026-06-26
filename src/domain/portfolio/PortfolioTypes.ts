import { z } from 'zod';

export const OptimizationMethodSchema = z.enum([
  'MEAN_VARIANCE',
  'KELLY_CRITERION',
  'RISK_PARITY',
  'EQUAL_RISK_CONTRIBUTION',
  'MAXIMUM_DIVERSIFICATION',
  'MINIMUM_VARIANCE',
  'ADAPTIVE_POSITION_SIZING',
  'MAXIMUM_DECORRELATION',
]);

export type OptimizationMethod = z.infer<typeof OptimizationMethodSchema>;

export const PositionSchema = z.object({
  symbol: z.string(),
  strategyId: z.string(),
  side: z.enum(['LONG', 'SHORT']),
  size: z.number(),
  entryPrice: z.number(),
  currentPrice: z.number(),
  unrealizedPnL: z.number(),
  realizedPnL: z.number(),
  marginUsed: z.number(),
  openTime: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export type Position = z.infer<typeof PositionSchema>;

export const PortfolioMetricsSchema = z.object({
  timestamp: z.string().datetime(),
  totalCapital: z.number(),
  allocatedCapital: z.number(),
  availableCapital: z.number(),
  grossExposure: z.number(),
  netExposure: z.number(),
  longExposure: z.number(),
  shortExposure: z.number(),
  marginUtilization: z.number(),
  leverage: z.number(),
  dailyPnL: z.number(),
  dailyReturn: z.number(),
  mtdReturn: z.number(),
  ytdReturn: z.number(),
  totalReturn: z.number(),
  volatility: z.number(),
  var95: z.number(),
  var99: z.number(),
  expectedShortfall: z.number(),
  maxDrawdown: z.number(),
  currentDrawdown: z.number(),
  sharpeRatio: z.number(),
  sortinoRatio: z.number(),
  calmarRatio: z.number(),
  omegaRatio: z.number(),
  informationRatio: z.number(),
  beta: z.number(),
  alpha: z.number(),
  correlationToBenchmark: z.number(),
  skewness: z.number(),
  kurtosis: z.number(),
  tailRatio: z.number(),
  commonSenseRatio: z.number(),
  gainToPainRatio: z.number(),
  profitFactor: z.number(),
  winRate: z.number(),
  profitLossRatio: z.number(),
  recoveryFactor: z.number(),
  riskOfRuin: z.number(),
  ulcerIndex: z.number(),
  serenityIndex: z.number(),
});

export type PortfolioMetrics = z.infer<typeof PortfolioMetricsSchema>;

export const AllocationResultSchema = z.object({
  timestamp: z.string().datetime(),
  method: OptimizationMethodSchema,
  strategyAllocations: z.record(z.number()),
  symbolAllocations: z.record(z.number()),
  sectorAllocations: z.record(z.number()),
  expectedReturn: z.number(),
  expectedVolatility: z.number(),
  expectedSharpe: z.number(),
  maxDrawdownEstimate: z.number(),
  diversificationRatio: z.number(),
  turnover: z.number(),
  confidence: z.number(),
  constraints: z.array(z.object({
    type: z.string(),
    description: z.string(),
    binding: z.boolean(),
    slack: z.number(),
  })),
  rebalancingRequired: z.boolean(),
  tradesToExecute: z.array(z.object({
    symbol: z.string(),
    strategyId: z.string(),
    action: z.enum(['INCREASE', 'DECREASE', 'OPEN', 'CLOSE']),
    targetSize: z.number(),
    currentSize: z.number(),
    urgency: z.enum(['immediate', 'opportunistic', 'patient']),
  })),
});

export type AllocationResult = z.infer<typeof AllocationResultSchema>;

export const CorrelationMatrixSchema = z.object({
  timestamp: z.string().datetime(),
  symbols: z.array(z.string()),
  matrix: z.array(z.array(z.number())),
  lookbackDays: z.number(),
  method: z.enum(['pearson', 'spearman', 'kendall', 'mutual_information']),
  regimeConditional: z.boolean(),
  currentRegime: z.string().optional(),
});

export type CorrelationMatrix = z.infer<typeof CorrelationMatrixSchema>;

export const StressTestScenarioSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  shocks: z.record(z.object({
    returnShock: z.number(),
    volatilityMultiplier: z.number(),
    correlationShift: z.number(),
  })),
  portfolioImpact: z.object({
    portfolioLoss: z.number(),
    varBreaches: z.number(),
    marginCalls: z.number(),
    strategiesAffected: z.array(z.string()),
  }).optional(),
});

export type StressTestScenario = z.infer<typeof StressTestScenarioSchema>;