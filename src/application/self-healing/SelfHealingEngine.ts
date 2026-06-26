import { EventType } from '@domain/events/TradingEvents';
import { globalEventBus } from '@infrastructure/events/EventBus';
import { observabilityEngine } from '@application/observability/ObservabilityEngine';

interface HealingAction {
  id: string;
  component: string;
  actionType: 'RESTART' | 'RECONNECT' | 'FLUSH_CACHE' | 'REDUCE_LOAD' | 'FAILOVER' | 'ALERT_OPERATOR';
  description: string;
  executedAt: string;
  success: boolean;
  result?: string;
}

interface RecoveryProcedure {
  component: string;
  steps: Array<{
    order: number;
    action: string;
    condition?: string;
    timeoutMs: number;
  }>;
}

export class SelfHealingEngine {
  private healingLog: HealingAction[] = [];
  private recoveryProcedures = new Map<string, RecoveryProcedure>();
  private isRunning = false;
  private readonly maxHealingAttempts = 3;
  private healingAttempts = new Map<string, number>();

  constructor() {
    this.subscribeToEvents();
    this.initializeProcedures();
  }

  private subscribeToEvents(): void {
    globalEventBus.subscribe(EventType.BROKER_FAILURE, async (event) => {
      await this.attemptHeal('broker', event.payload as Record<string, unknown>);
    });

    globalEventBus.subscribe(EventType.FEED_FAILURE, async (event) => {
      await this.attemptHeal('feed', event.payload as Record<string, unknown>);
    });

    globalEventBus.subscribe(EventType.LATENCY_SPIKE, async (event) => {
      await this.attemptHeal('latency', event.payload as Record<string, unknown>);
    });

    globalEventBus.subscribe(EventType.SYSTEM_HEALING_STARTED, async (event) => {
      const payload = event.payload as Record<string, unknown>;
      await this.attemptHeal(payload['componentId'] as string, payload);
    });
  }

  private initializeProcedures(): void {
    this.recoveryProcedures.set('broker', {
      component: 'broker',
      steps: [
        { order: 1, action: 'CHECK_CONNECTIVITY', timeoutMs: 5000 },
        { order: 2, action: 'RECONNECT', timeoutMs: 10000 },
        { order: 3, action: 'VERIFY_HEALTH', timeoutMs: 5000 },
        { order: 4, action: 'RESUME_OPERATIONS', timeoutMs: 2000 },
      ],
    });

    this.recoveryProcedures.set('feed', {
      component: 'feed',
      steps: [
        { order: 1, action: 'FLUSH_BUFFER', timeoutMs: 2000 },
        { order: 2, action: 'RECONNECT_WEBSOCKET', timeoutMs: 8000 },
        { order: 3, action: 'RESUBSCRIBE_SYMBOLS', timeoutMs: 5000 },
        { order: 4, action: 'VALIDATE_DATA_QUALITY', timeoutMs: 5000 },
      ],
    });

    this.recoveryProcedures.set('latency', {
      component: 'latency',
      steps: [
        { order: 1, action: 'REDUCE_BATCH_SIZE', timeoutMs: 2000 },
        { order: 2, action: 'PAUSE_NON_CRITICAL', timeoutMs: 3000 },
        { order: 3, action: 'SCALE_RESOURCES', timeoutMs: 10000 },
      ],
    });
  }

  async attemptHeal(component: string, context: Record<string, unknown>): Promise<HealingAction> {
    const attempts = this.healingAttempts.get(component) || 0;
    if (attempts >= this.maxHealingAttempts) {
      const action: HealingAction = {
        id: crypto.randomUUID(),
        component,
        actionType: 'ALERT_OPERATOR',
        description: `Max healing attempts reached for ${component}. Manual intervention required.`,
        executedAt: new Date().toISOString(),
        success: false,
        result: 'MAX_ATTEMPTS_EXCEEDED',
      };
      this.healingLog.push(action);
      return action;
    }

    this.healingAttempts.set(component, attempts + 1);
    const procedure = this.recoveryProcedures.get(component);

    if (!procedure) {
      const action: HealingAction = {
        id: crypto.randomUUID(),
        component,
        actionType: 'ALERT_OPERATOR',
        description: `No recovery procedure defined for ${component}`,
        executedAt: new Date().toISOString(),
        success: false,
      };
      this.healingLog.push(action);
      return action;
    }

    for (const step of procedure.steps) {
      const success = await this.executeStep(component, step, context);
      if (!success) {
        const action: HealingAction = {
          id: crypto.randomUUID(),
          component,
          actionType: 'FAILOVER',
          description: `Step ${step.order} failed: ${step.action}`,
          executedAt: new Date().toISOString(),
          success: false,
        };
        this.healingLog.push(action);
        return action;
      }
    }

    this.healingAttempts.set(component, 0);

    const action: HealingAction = {
      id: crypto.randomUUID(),
      component,
      actionType: 'RESTART',
      description: `Successfully healed ${component} using recovery procedure`,
      executedAt: new Date().toISOString(),
      success: true,
      result: 'RECOVERY_COMPLETE',
    };

    this.healingLog.push(action);

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.SYSTEM_HEALING_COMPLETED,
        { component, action, context },
        'SelfHealingEngine',
        component
      )
    );

    observabilityEngine.updateHealth(component, { status: 'HEALTHY' });

    return action;
  }

  private async executeStep(component: string, step: RecoveryProcedure['steps'][0], context: Record<string, unknown>): Promise<boolean> {
    console.log(`[SelfHealing] Executing step ${step.order} for ${component}: ${step.action}`);

    switch (step.action) {
      case 'CHECK_CONNECTIVITY':
        return await this.simulateCheck(component, context);
      case 'RECONNECT':
        return await this.simulateReconnect(component, context);
      case 'VERIFY_HEALTH':
        return await this.simulateHealthCheck(component);
      case 'RESUME_OPERATIONS':
        return true;
      case 'FLUSH_BUFFER':
        return true;
      case 'RECONNECT_WEBSOCKET':
        return await this.simulateReconnect(component, context);
      case 'RESUBSCRIBE_SYMBOLS':
        return true;
      case 'VALIDATE_DATA_QUALITY':
        return await this.simulateHealthCheck(component);
      case 'REDUCE_BATCH_SIZE':
        return true;
      case 'PAUSE_NON_CRITICAL':
        return true;
      case 'SCALE_RESOURCES':
        return true;
      default:
        return false;
    }
  }

  private async simulateCheck(component: string, context: Record<string, unknown>): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 1000));
    return Math.random() > 0.1;
  }

  private async simulateReconnect(component: string, context: Record<string, unknown>): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 2000));
    return Math.random() > 0.2;
  }

  private async simulateHealthCheck(component: string): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 1000));
    return Math.random() > 0.1;
  }

  addRecoveryProcedure(procedure: RecoveryProcedure): void {
    this.recoveryProcedures.set(procedure.component, procedure);
  }

  getHealingLog(): HealingAction[] {
    return [...this.healingLog];
  }

  getHealingAttempts(component: string): number {
    return this.healingAttempts.get(component) || 0;
  }

  resetAttempts(component: string): void {
    this.healingAttempts.delete(component);
  }
}

export const selfHealingEngine = new SelfHealingEngine();