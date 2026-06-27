import { z } from 'zod';

export const EventMetadataSchema = z.object({
  eventId: z.string().uuid(),
  timestamp: z.string().datetime(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  source: z.string(),
  version: z.number().int().positive(),
  partitionKey: z.string(),
  traceId: z.string().optional(),
});

export type EventMetadata = z.infer<typeof EventMetadataSchema>;

export const BaseEventSchema = z.object({
  type: z.string(),
  payload: z.record(z.unknown()),
  metadata: EventMetadataSchema,
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

export enum EventType {
  SIGNAL_GENERATED = 'SIGNAL_GENERATED',
  SIGNAL_VALIDATED = 'SIGNAL_VALIDATED',
  SIGNAL_REJECTED = 'SIGNAL_REJECTED',
  SIGNAL_ARBITRATED = 'SIGNAL_ARBITRATED',
  TRADE_APPROVED = 'TRADE_APPROVED',
  TRADE_REJECTED = 'TRADE_REJECTED',
  TRADE_EXECUTED = 'TRADE_EXECUTED',
  TRADE_FAILED = 'TRADE_FAILED',
  TRADE_FILLED = 'TRADE_FILLED',
  TRADE_PARTIAL_FILL = 'TRADE_PARTIAL_FILL',
  POSITION_OPENED = 'POSITION_OPENED',
  POSITION_CLOSED = 'POSITION_CLOSED',
  POSITION_MODIFIED = 'POSITION_MODIFIED',
  RISK_TRIGGERED = 'RISK_TRIGGERED',
  RISK_BREACHED = 'RISK_BREACHED',
  CIRCUIT_BREAKER_TRIPPED = 'CIRCUIT_BREAKER_TRIPPED',
  CIRCUIT_BREAKER_RESET = 'CIRCUIT_BREAKER_RESET',
  EMERGENCY_STOP_ACTIVATED = 'EMERGENCY_STOP_ACTIVATED',
  CAPITAL_PRESERVATION_TRIGGERED = 'CAPITAL_PRESERVATION_TRIGGERED',
  PORTFOLIO_REBALANCED = 'PORTFOLIO_REBALANCED',
  ALLOCATION_CHANGED = 'ALLOCATION_CHANGED',
  STRATEGY_ENABLED = 'STRATEGY_ENABLED',
  STRATEGY_DISABLED = 'STRATEGY_DISABLED',
  STRATEGY_HEALTH_CHANGED = 'STRATEGY_HEALTH_CHANGED',
  STRATEGY_RETIRED = 'STRATEGY_RETIRED',
  BROKER_FAILURE = 'BROKER_FAILURE',
  BROKER_RECONNECTED = 'BROKER_RECONNECTED',
  FEED_FAILURE = 'FEED_FAILURE',
  FEED_RECOVERED = 'FEED_RECOVERED',
  LATENCY_SPIKE = 'LATENCY_SPIKE',
  ANOMALY_DETECTED = 'ANOMALY_DETECTED',
  REGIME_CHANGED = 'REGIME_CHANGED',
  AI_RECOMMENDATION = 'AI_RECOMMENDATION',
  AI_INCIDENT_REPORT = 'AI_INCIDENT_REPORT',
  EXECUTION_QUALITY_ALERT = 'EXECUTION_QUALITY_ALERT',
  LIQUIDITY_VOID_DETECTED = 'LIQUIDITY_VOID_DETECTED',
  MARKET_PRESSURE_ALERT = 'MARKET_PRESSURE_ALERT',
  SYSTEM_HEALING_STARTED = 'SYSTEM_HEALING_STARTED',
  SYSTEM_HEALING_COMPLETED = 'SYSTEM_HEALING_COMPLETED',
  STATE_RECOVERED = 'STATE_RECOVERED',
  AUDIT_GENERATED = 'AUDIT_GENERATED',
  DAILY_LIMIT_REACHED = 'DAILY_LIMIT_REACHED',
  WEEKLY_REVIEW_GENERATED = 'WEEKLY_REVIEW_GENERATED',
  MONTHLY_REVIEW_GENERATED = 'MONTHLY_REVIEW_GENERATED',
}

export interface EventEnvelope<T = unknown> {
  readonly type: EventType;
  readonly payload: T;
  readonly metadata: EventMetadata;
}

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void> | void;

export interface IEventBus {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  subscribe<T>(type: EventType, handler: EventHandler<T>): () => void;
  subscribePattern<T>(pattern: RegExp, handler: EventHandler<T>): () => void;
  getEventStream(): AsyncGenerator<EventEnvelope>;
}