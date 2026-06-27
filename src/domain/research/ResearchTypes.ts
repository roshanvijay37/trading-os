import { z } from 'zod';

export const HypothesisSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  type: z.enum(['momentum', 'mean_reversion', 'statistical_arbitrage', 'factor', 'microstructure', 'sentiment', 'custom']),
  features: z.array(z.string()),
  expectedEdge: z.number(),
  expectedSharpe: z.number(),
  timeframe: z.enum(['intraday', 'swing', 'positional', 'long_term']),
  assetClasses: z.array(z.string()),
  status: z.enum(['draft', 'testing', 'validated', 'rejected', 'production', 'retired']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  testResults: z.array(z.object({
    testType: z.string(),
    result: z.number(),
    pValue: z.number(),
    passed: z.boolean(),
    timestamp: z.string().datetime(),
  })).optional(),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const WalkForwardResultSchema = z.object({
  id: z.string().uuid(),
  hypothesisId: z.string(),
  inSampleStart: z.string().datetime(),
  inSampleEnd: z.string().datetime(),
  outSampleStart: z.string().datetime(),
  outSampleEnd: z.string().datetime(),
  inSampleSharpe: z.number(),
  outSampleSharpe: z.number(),
  inSampleDrawdown: z.number(),
  outSampleDrawdown: z.number(),
  degradation: z.number(),
  isRobust: z.boolean(),
  parameterStability: z.number(),
});

export type WalkForwardResult = z.infer<typeof WalkForwardResultSchema>;

export const MonteCarloResultSchema = z.object({
  id: z.string().uuid(),
  hypothesisId: z.string(),
  iterations: z.number().int(),
  simulatedReturns: z.array(z.number()),
  probabilityOfProfit: z.number(),
  probabilityOfRuin: z.number(),
  expectedMaxDrawdown: z.number(),
  expectedFinalEquity: z.number(),
  confidenceInterval95: z.tuple([z.number(), z.number()]),
  confidenceInterval99: z.tuple([z.number(), z.number()]),
  worstCaseScenario: z.number(),
  bestCaseScenario: z.number(),
  medianScenario: z.number(),
});

export type MonteCarloResult = z.infer<typeof MonteCarloResultSchema>;

export const RobustnessScoreSchema = z.object({
  hypothesisId: z.string(),
  overallScore: z.number().min(0).max(100),
  walkForwardScore: z.number().min(0).max(100),
  monteCarloScore: z.number().min(0).max(100),
  outOfSampleScore: z.number().min(0).max(100),
  parameterStabilityScore: z.number().min(0).max(100),
  regimeRobustnessScore: z.number().min(0).max(100),
  noiseResistanceScore: z.number().min(0).max(100),
  marketCrashScore: z.number().min(0).max(100),
  verdict: z.enum(['strong_pass', 'pass', 'marginal', 'fail', 'strong_fail']),
});

export type RobustnessScore = z.infer<typeof RobustnessScoreSchema>;

export const FactorDiscoverySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  type: z.enum(['price', 'volume', 'volatility', 'fundamental', 'sentiment', 'macro', 'microstructure']),
  importance: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  ic: z.number(),
  ir: z.number(),
  decay: z.number(),
  turnover: z.number(),
  capacity: z.number(),
  sharpe: z.number(),
  data: z.array(z.object({
    timestamp: z.string().datetime(),
    value: z.number(),
    forwardReturn: z.number(),
  })),
});

export type FactorDiscovery = z.infer<typeof FactorDiscoverySchema>;

export const ParameterSurfaceSchema = z.object({
  hypothesisId: z.string(),
  parameter1: z.string(),
  parameter2: z.string(),
  p1Range: z.array(z.number()),
  p2Range: z.array(z.number()),
  surface: z.array(z.array(z.number())),
  optimalPoint: z.object({ p1: z.number(), p2: z.number(), value: z.number() }),
  stabilityRegion: z.array(z.object({ p1: z.number(), p2: z.number() })),
});

export type ParameterSurface = z.infer<typeof ParameterSurfaceSchema>;

export const EdgeDecayAnalysisSchema = z.object({
  hypothesisId: z.string(),
  lookbackYears: z.number(),
  yearlyEdges: z.array(z.object({
    year: z.number(),
    sharpe: z.number(),
    returns: z.number(),
    trades: z.number(),
  })),
  decayRate: z.number(),
  halfLife: z.number(),
  conclusion: z.string(),
});

export type EdgeDecayAnalysis = z.infer<typeof EdgeDecayAnalysisSchema>;