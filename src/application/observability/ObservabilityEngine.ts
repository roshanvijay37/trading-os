import {
  ComponentHealth,
  SystemHealth,
  Metric,
  Alert,
  HealthStatus,
} from '@domain/observability/HealthTypes';
import { EventType } from '@domain/events/TradingEvents';
import { globalEventBus } from '@infrastructure/events/EventBus';

export class ObservabilityEngine {
  private components = new Map<string, ComponentHealth>();
  private metrics = new Map<string, Metric[]>();
  private alerts: Alert[] = [];
  private readonly maxMetricsPerComponent = 10000;
  private isRunning = false;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.checkInterval = setInterval(() => this.runHealthChecks(), 5000);
    console.log('[ObservabilityEngine] Started');
  }

  stop(): void {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('[ObservabilityEngine] Stopped');
  }

  registerComponent(componentId: string, componentType: ComponentHealth['componentType']): void {
    const health: ComponentHealth = {
      componentId,
      componentType,
      status: 'UNKNOWN',
      latencyMs: 0,
      errorRate: 0,
      throughput: 0,
      lastCheck: new Date().toISOString(),
      uptimeSeconds: 0,
      memoryUsageMb: 0,
      cpuUsagePercent: 0,
      queueDepth: 0,
    };
    this.components.set(componentId, health);
  }

  updateHealth(componentId: string, update: Partial<ComponentHealth>): void {
    const existing = this.components.get(componentId);
    if (!existing) return;

    const updated: ComponentHealth = {
      ...existing,
      ...update,
      lastCheck: new Date().toISOString(),
    };

    this.components.set(componentId, updated);
    this.recordMetric(`${componentId}_latency`, updated.latencyMs, { component: componentId });
    this.recordMetric(`${componentId}_error_rate`, updated.errorRate, { component: componentId });
    this.recordMetric(`${componentId}_throughput`, updated.throughput, { component: componentId });

    if (updated.status === 'CRITICAL' || updated.status === 'UNHEALTHY') {
      this.triggerAlert(componentId, updated.status, updated);
    }
  }

  recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
    const metric: Metric = {
      name,
      value,
      timestamp: new Date().toISOString(),
      labels,
    };

    const existing = this.metrics.get(name) || [];
    existing.push(metric);
    if (existing.length > this.maxMetricsPerComponent) {
      existing.shift();
    }
    this.metrics.set(name, existing);
  }

  private triggerAlert(componentId: string, status: HealthStatus, details: ComponentHealth): void {
    const alert: Alert = {
      id: crypto.randomUUID(),
      severity: status === 'CRITICAL' ? 'emergency' : 'critical',
      component: componentId,
      metric: 'health_status',
      threshold: 1,
      currentValue: status === 'CRITICAL' ? 3 : 2,
      message: `Component ${componentId} is ${status}. Latency: ${details.latencyMs}ms, Error rate: ${(details.errorRate * 100).toFixed(2)}%`,
      triggeredAt: new Date().toISOString(),
      autoResolved: false,
      correlationId: crypto.randomUUID(),
    };

    this.alerts.push(alert);

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.ANOMALY_DETECTED,
        alert,
        'ObservabilityEngine',
        componentId
      )
    );

    if (status === 'CRITICAL') {
      globalEventBus.publish(
        globalEventBus.createEvent(
          EventType.EMERGENCY_STOP_ACTIVATED,
          { reason: `Critical health on ${componentId}`, alert },
          'ObservabilityEngine',
          'system'
        )
      );
    }
  }

  private runHealthChecks(): void {
    for (const [id, health] of this.components) {
      if (health.status === 'CRITICAL') {
        globalEventBus.publish(
          globalEventBus.createEvent(
            EventType.SYSTEM_HEALING_STARTED,
            { componentId: id, health },
            'ObservabilityEngine',
            id
          )
        );
      }
    }

    const systemHealth = this.calculateSystemHealth();
    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.STRATEGY_HEALTH_CHANGED,
        systemHealth,
        'ObservabilityEngine',
        'system'
      )
    );
  }

  private calculateSystemHealth(): SystemHealth {
    const components = Array.from(this.components.values());
    const statuses = components.map((c) => c.status);

    let overallStatus: HealthStatus = 'HEALTHY';
    if (statuses.includes('CRITICAL')) overallStatus = 'CRITICAL';
    else if (statuses.includes('UNHEALTHY')) overallStatus = 'UNHEALTHY';
    else if (statuses.includes('DEGRADED')) overallStatus = 'DEGRADED';

    const activeAlerts = this.alerts.filter((a) => !a.resolvedAt).length;
    const criticalAlerts = this.alerts.filter((a) => a.severity === 'emergency' && !a.resolvedAt).length;

    return {
      timestamp: new Date().toISOString(),
      overallStatus,
      components,
      activeAlerts,
      criticalAlerts,
      meanTimeBetweenFailures: this.calculateMTBF(),
      meanTimeToRecovery: this.calculateMTTR(),
      availabilityPercent: this.calculateAvailability(),
    };
  }

  private calculateMTBF(): number {
    const failures = this.alerts.filter((a) => a.severity === 'critical' || a.severity === 'emergency');
    if (failures.length < 2) return Infinity;
    const totalTime = Date.now() - new Date(failures[0].triggeredAt).getTime();
    return totalTime / failures.length / 1000 / 3600;
  }

  private calculateMTTR(): number {
    const resolved = this.alerts.filter((a) => a.resolvedAt);
    if (resolved.length === 0) return 0;
    const totalRecovery = resolved.reduce((s, a) => {
      return s + (new Date(a.resolvedAt!).getTime() - new Date(a.triggeredAt).getTime());
    }, 0);
    return totalRecovery / resolved.length / 1000 / 60;
  }

  private calculateAvailability(): number {
    const totalChecks = this.components.size;
    if (totalChecks === 0) return 100;
    const healthy = Array.from(this.components.values()).filter((c) => c.status === 'HEALTHY').length;
    return (healthy / totalChecks) * 100;
  }

  getComponentHealth(componentId: string): ComponentHealth | undefined {
    return this.components.get(componentId);
  }

  getAllHealth(): ComponentHealth[] {
    return Array.from(this.components.values());
  }

  getSystemHealth(): SystemHealth {
    return this.calculateSystemHealth();
  }

  getMetrics(name: string): Metric[] {
    return this.metrics.get(name) || [];
  }

  getAlerts(activeOnly: boolean = false): Alert[] {
    if (activeOnly) return this.alerts.filter((a) => !a.resolvedAt);
    return [...this.alerts];
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledgedAt = new Date().toISOString();
    }
  }

  resolveAlert(alertId: string, auto: boolean = false): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.resolvedAt = new Date().toISOString();
      alert.autoResolved = auto;
    }
  }
}

export const observabilityEngine = new ObservabilityEngine();