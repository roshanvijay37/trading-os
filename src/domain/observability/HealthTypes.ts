import { z } from 'zod';

export const HealthStatusSchema = z.enum(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'CRITICAL', 'UNKNOWN']);

export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const ComponentHealthSchema = z.object({
  componentId: z.string(),
  componentType: z.enum([
    'STRATEGY',
    'BROKER',
    'FEED',
    'WEBSOCKET',
    'DATABASE',
    'API',
    'AI_ENGINE',
    'RISK_ENGINE',
    'EXECUTION_ENGINE',
    'RESEARCH_ENGINE',
    'EVENT_BUS',
    'CACHE',
  ]),
  status: HealthStatusSchema,
  latencyMs: z.number(),
  errorRate: z.number(),
  throughput: z.number(),
  lastCheck: z.string().datetime(),
  uptimeSeconds: z.number(),
  memoryUsageMb: z.number(),
  cpuUsagePercent: z.number(),
  queueDepth: z.number(),
  details: z.record(z.unknown()).optional(),
});

export type ComponentHealth = z.infer<typeof ComponentHealthSchema>;

export const SystemHealthSchema = z.object({
  timestamp: z.string().datetime(),
  overallStatus: HealthStatusSchema,
  components: z.array(ComponentHealthSchema),
  activeAlerts: z.number().int(),
  criticalAlerts: z.number().int(),
  meanTimeBetweenFailures: z.number(),
  meanTimeToRecovery: z.number(),
  availabilityPercent: z.number(),
});

export type SystemHealth = z.infer<typeof SystemHealthSchema>;

export const MetricSchema = z.object({
  name: z.string(),
  value: z.number(),
  timestamp: z.string().datetime(),
  labels: z.record(z.string()).optional(),
  unit: z.string().optional(),
});

export type Metric = z.infer<typeof MetricSchema>;

export const AlertSchema = z.object({
  id: z.string().uuid(),
  severity: z.enum(['info', 'warning', 'critical', 'emergency']),
  component: z.string(),
  metric: z.string(),
  threshold: z.number(),
  currentValue: z.number(),
  message: z.string(),
  triggeredAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
  autoResolved: z.boolean(),
  correlationId: z.string().uuid(),
});

export type Alert = z.infer<typeof AlertSchema>;