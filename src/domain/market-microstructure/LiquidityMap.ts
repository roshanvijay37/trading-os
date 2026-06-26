import { z } from 'zod';

export const LiquidityLevelSchema = z.object({
  price: z.number(),
  bidVolume: z.number(),
  askVolume: z.number(),
  bidOrders: z.number().int(),
  askOrders: z.number().int(),
  depthScore: z.number(),
  concentrationRatio: z.number(),
  timestamp: z.string().datetime(),
});

export type LiquidityLevel = z.infer<typeof LiquidityLevelSchema>;

export const LiquidityZoneSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  lowerBound: z.number(),
  upperBound: z.number(),
  type: z.enum(['support', 'resistance', 'neutral', 'iceberg', 'absorption']),
  strength: z.number().min(0).max(1),
  volumeAccumulated: z.number(),
  hits: z.number().int(),
  createdAt: z.string().datetime(),
  lastTestedAt: z.string().datetime().optional(),
  expiryAt: z.string().datetime().optional(),
});

export type LiquidityZone = z.infer<typeof LiquidityZoneSchema>;

export const OrderBookImbalanceSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().datetime(),
  bidDepth: z.number(),
  askDepth: z.number(),
  imbalance: z.number(),
  weightedImbalance: z.number(),
  top10BidVolume: z.number(),
  top10AskVolume: z.number(),
  largeOrderPressure: z.number(),
  signal: z.enum(['bullish', 'bearish', 'neutral']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type OrderBookImbalance = z.infer<typeof OrderBookImbalanceSchema>;

export const MarketPressureSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().datetime(),
  aggressiveBuyVolume: z.number(),
  aggressiveSellVolume: z.number(),
  netPressure: z.number(),
  pressureRatio: z.number(),
  tickPressure: z.array(z.object({
    price: z.number(),
    volume: z.number(),
    side: z.enum(['buy', 'sell']),
    timestamp: z.string().datetime(),
  })),
  smartMoneyFlow: z.number(),
  confidence: z.number().min(0).max(1),
});

export type MarketPressure = z.infer<typeof MarketPressureSchema>;

export const VWAPDeviationSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().datetime(),
  vwap: z.number(),
  currentPrice: z.number(),
  deviation: z.number(),
  deviationPercent: z.number(),
  standardDeviation: z.number(),
  zScore: z.number(),
  percentileRank: z.number(),
  signal: z.enum(['oversold', 'overbought', 'neutral']).optional(),
});

export type VWAPDeviation = z.infer<typeof VWAPDeviationSchema>;

export const IcebergDetectionSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().datetime(),
  detected: z.boolean(),
  icebergPrice: z.number().optional(),
  estimatedTotalSize: z.number().optional(),
  visibleSize: z.number().optional(),
  hiddenRatio: z.number().optional(),
  detectionConfidence: z.number().min(0).max(1),
  method: z.enum(['volume_pattern', 'order_lifetime', 'fill_analysis', 'cross_reference']).optional(),
  evidence: z.array(z.string()).optional(),
});

export type IcebergDetection = z.infer<typeof IcebergDetectionSchema>;

export const ExecutionFootprintSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().datetime(),
  candles: z.array(z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
    delta: z.number(),
    bidVolume: z.number(),
    askVolume: z.number(),
    imbalance: z.number(),
    absorption: z.number(),
    aggressiveEntries: z.number(),
  })),
  sessionDelta: z.number(),
  sessionVolume: z.number(),
  sessionImbalance: z.number(),
  keyLevels: z.array(z.object({
    price: z.number(),
    type: z.enum(['poi', 'absorption', 'exhaustion', 'initiation']),
    strength: z.number(),
  })),
});

export type ExecutionFootprint = z.infer<typeof ExecutionFootprintSchema>;

export const SweepDetectionSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().datetime(),
  sweepDetected: z.boolean(),
  sweepType: z.enum(['liquidity_sweep', 'stop_hunt', 'iceberg_sweep']).optional(),
  sweptLevel: z.number().optional(),
  sweptVolume: z.number().optional(),
  immediateReversal: z.boolean().optional(),
  reversalStrength: z.number().optional(),
  followThrough: z.boolean().optional(),
  confidence: z.number().min(0).max(1),
});

export type SweepDetection = z.infer<typeof SweepDetectionSchema>;

export const VolumeProfileSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().datetime(),
  valueAreaHigh: z.number(),
  valueAreaLow: z.number(),
  pointOfControl: z.number(),
  valueAreaVolume: z.number(),
  totalVolume: z.number(),
  valueAreaRatio: z.number(),
  nodes: z.array(z.object({
    price: z.number(),
    volume: z.number(),
    bidVolume: z.number(),
    askVolume: z.number(),
    isPOC: z.boolean(),
    isValueArea: z.boolean(),
  })),
  lowVolumeNodes: z.array(z.object({
    price: z.number(),
    width: z.number(),
  })),
  highVolumeNodes: z.array(z.object({
    price: z.number(),
    width: z.number(),
  })),
});

export type VolumeProfile = z.infer<typeof VolumeProfileSchema>;