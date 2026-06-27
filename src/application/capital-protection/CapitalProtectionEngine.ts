import { EventType } from '@domain/events/TradingEvents';
import { globalEventBus } from '@infrastructure/events/EventBus';

interface CapitalProtectionConfig {
  maxDailyLossPercent: number;
  maxWeeklyLossPercent: number;
  maxMonthlyLossPercent: number;
  maxDrawdownPercent: number;
  maxPositionSizePercent: number;
  maxSectorExposurePercent: number;
  circuitBreakerThreshold: number;
  emergencyStopDrawdown: number;
  coolingOffMinutes: number;
}

interface CapitalState {
  totalCapital: number;
  peakCapital: number;
  dailyPnL: number;
  weeklyPnL: number;
  monthlyPnL: number;
  currentDrawdown: number;
  maxDrawdownReached: number;
  lastTradeTime: string;
  isEmergencyStopped: boolean;
  isCircuitBreakerActive: boolean;
  coolingOffUntil: string | null;
}

export class CapitalProtectionEngine {
  private config: CapitalProtectionConfig = {
    maxDailyLossPercent: 0.03,
    maxWeeklyLossPercent: 0.06,
    maxMonthlyLossPercent: 0.10,
    maxDrawdownPercent: 0.15,
    maxPositionSizePercent: 0.20,
    maxSectorExposurePercent: 0.40,
    circuitBreakerThreshold: 0.05,
    emergencyStopDrawdown: 0.20,
    coolingOffMinutes: 30,
  };

  private state: CapitalState = {
    totalCapital: 0,
    peakCapital: 0,
    dailyPnL: 0,
    weeklyPnL: 0,
    monthlyPnL: 0,
    currentDrawdown: 0,
    maxDrawdownReached: 0,
    lastTradeTime: new Date().toISOString(),
    isEmergencyStopped: false,
    isCircuitBreakerActive: false,
    coolingOffUntil: null,
  };

  private dailyLimitReached = false;
  private weeklyLimitReached = false;
  private monthlyLimitReached = false;

  constructor() {
    this.subscribeToEvents();
  }

  private subscribeToEvents(): void {
    globalEventBus.subscribe(EventType.TRADE_FILLED, (event) => {
      this.updatePnL(event.payload as Record<string, unknown>);
    });

    globalEventBus.subscribe(EventType.POSITION_CLOSED, (event) => {
      this.updatePnL(event.payload as Record<string, unknown>);
    });
  }

  configure(config: Partial<CapitalProtectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  initializeCapital(amount: number): void {
    this.state.totalCapital = amount;
    this.state.peakCapital = amount;
    this.state.dailyPnL = 0;
    this.state.weeklyPnL = 0;
    this.state.monthlyPnL = 0;
    this.state.isEmergencyStopped = false;
    this.state.isCircuitBreakerActive = false;
    this.state.coolingOffUntil = null;
    this.dailyLimitReached = false;
    this.weeklyLimitReached = false;
    this.monthlyLimitReached = false;
  }

  private updatePnL(tradeData: Record<string, unknown>): void {
    if (this.state.isEmergencyStopped) return;

    const pnl = (tradeData['realizedPnL'] as number) || 0;
    this.state.dailyPnL += pnl;
    this.state.weeklyPnL += pnl;
    this.state.monthlyPnL += pnl;
    this.state.totalCapital += pnl;

    if (this.state.totalCapital > this.state.peakCapital) {
      this.state.peakCapital = this.state.totalCapital;
    }

    this.state.currentDrawdown = (this.state.peakCapital - this.state.totalCapital) / this.state.peakCapital;
    if (this.state.currentDrawdown > this.state.maxDrawdownReached) {
      this.state.maxDrawdownReached = this.state.currentDrawdown;
    }

    this.checkLimits();
  }

  private checkLimits(): void {
    const dailyLossPercent = Math.abs(this.state.dailyPnL) / this.state.totalCapital;
    const weeklyLossPercent = Math.abs(this.state.weeklyPnL) / this.state.totalCapital;
    const monthlyLossPercent = Math.abs(this.state.monthlyPnL) / this.state.totalCapital;

    if (dailyLossPercent >= this.config.maxDailyLossPercent && !this.dailyLimitReached) {
      this.dailyLimitReached = true;
      this.triggerCircuitBreaker('DAILY_LIMIT_REACHED', `Daily loss limit ${(this.config.maxDailyLossPercent * 100).toFixed(1)}% reached`);
    }

    if (weeklyLossPercent >= this.config.maxWeeklyLossPercent && !this.weeklyLimitReached) {
      this.weeklyLimitReached = true;
      this.triggerCircuitBreaker('WEEKLY_LIMIT_REACHED', `Weekly loss limit ${(this.config.maxWeeklyLossPercent * 100).toFixed(1)}% reached`);
    }

    if (monthlyLossPercent >= this.config.maxMonthlyLossPercent && !this.monthlyLimitReached) {
      this.monthlyLimitReached = true;
      this.triggerCircuitBreaker('MONTHLY_LIMIT_REACHED', `Monthly loss limit ${(this.config.maxMonthlyLossPercent * 100).toFixed(1)}% reached`);
    }

    if (this.state.currentDrawdown >= this.config.maxDrawdownPercent && !this.state.isCircuitBreakerActive) {
      this.triggerCircuitBreaker('MAX_DRAWDOWN_REACHED', `Max drawdown ${(this.config.maxDrawdownPercent * 100).toFixed(1)}% reached`);
    }

    if (this.state.currentDrawdown >= this.config.emergencyStopDrawdown) {
      this.emergencyStop('EMERGENCY_STOP_DRAWDOWN', `Emergency stop: Drawdown ${(this.state.currentDrawdown * 100).toFixed(1)}% exceeded limit`);
    }
  }

  private triggerCircuitBreaker(reason: string, message: string): void {
    this.state.isCircuitBreakerActive = true;
    const coolingOff = new Date(Date.now() + this.config.coolingOffMinutes * 60000).toISOString();
    this.state.coolingOffUntil = coolingOff;

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.CIRCUIT_BREAKER_TRIPPED,
        { reason, message, coolingOffUntil: coolingOff, state: this.state },
        'CapitalProtectionEngine',
        'capital'
      )
    );
  }

  private emergencyStop(reason: string, message: string): void {
    this.state.isEmergencyStopped = true;

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.EMERGENCY_STOP_ACTIVATED,
        { reason, message, state: this.state },
        'CapitalProtectionEngine',
        'capital'
      )
    );

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.CAPITAL_PRESERVATION_TRIGGERED,
        { action: 'EMERGENCY_STOP_ALL', reason, state: this.state },
        'CapitalProtectionEngine',
        'capital'
      )
    );
  }

  checkPositionSize(positionValue: number): { allowed: boolean; maxAllowed: number; reason?: string } {
    if (this.state.isEmergencyStopped) {
      return { allowed: false, maxAllowed: 0, reason: 'Emergency stop active' };
    }

    if (this.state.isCircuitBreakerActive) {
      const now = new Date();
      const coolingOff = this.state.coolingOffUntil ? new Date(this.state.coolingOffUntil) : null;
      if (coolingOff && now < coolingOff) {
        return { allowed: false, maxAllowed: 0, reason: 'Circuit breaker cooling off' };
      }
      this.state.isCircuitBreakerActive = false;
    }

    const maxPosition = this.state.totalCapital * this.config.maxPositionSizePercent;
    if (positionValue > maxPosition) {
      return {
        allowed: false,
        maxAllowed: maxPosition,
        reason: `Position size ${(positionValue / this.state.totalCapital * 100).toFixed(1)}% exceeds max ${(this.config.maxPositionSizePercent * 100).toFixed(1)}%`,
      };
    }

    return { allowed: true, maxAllowed: maxPosition };
  }

  checkExposure(exposure: Record<string, number>): { allowed: boolean; violations: string[] } {
    const violations: string[] = [];

    for (const [sector, amount] of Object.entries(exposure)) {
      const sectorPercent = amount / this.state.totalCapital;
      if (sectorPercent > this.config.maxSectorExposurePercent) {
        violations.push(`Sector ${sector} exposure ${(sectorPercent * 100).toFixed(1)}% exceeds ${(this.config.maxSectorExposurePercent * 100).toFixed(1)}%`);
      }
    }

    return { allowed: violations.length === 0, violations };
  }

  resetDaily(): void {
    this.state.dailyPnL = 0;
    this.dailyLimitReached = false;
  }

  resetWeekly(): void {
    this.state.weeklyPnL = 0;
    this.weeklyLimitReached = false;
  }

  resetMonthly(): void {
    this.state.monthlyPnL = 0;
    this.monthlyLimitReached = false;
  }

  getState(): CapitalState {
    return { ...this.state };
  }

  getConfig(): CapitalProtectionConfig {
    return { ...this.config };
  }

  isTradingAllowed(): boolean {
    if (this.state.isEmergencyStopped) return false;
    if (this.state.isCircuitBreakerActive) {
      const now = new Date();
      const coolingOff = this.state.coolingOffUntil ? new Date(this.state.coolingOffUntil) : null;
      if (coolingOff && now < coolingOff) return false;
      this.state.isCircuitBreakerActive = false;
    }
    return true;
  }
}

export const capitalProtectionEngine = new CapitalProtectionEngine();