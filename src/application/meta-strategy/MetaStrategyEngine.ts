import {
  SignalEvaluation,
  MetaEvaluation,
  SignalVerdict,
  PortfolioState,
  MarketRegime,
  StrategyConflict,
} from '@domain/meta-strategy/MetaStrategyTypes';
import { EventType, EventEnvelope } from '@domain/events/TradingEvents';
import { globalEventBus } from '@infrastructure/events/EventBus';

interface StrategyHealth {
  strategyId: string;
  recentPnL: number;
  winRate: number;
  sharpe: number;
  maxDrawdown: number;
  consecutiveLosses: number;
  lastSignalTime: string;
  signalFrequency: number;
}

export class MetaStrategyEngine {
  private portfolioState: PortfolioState | null = null;
  private currentRegime: MarketRegime | null = null;
  private strategyHealth = new Map<string, StrategyHealth>();
  private conflicts: StrategyConflict[] = [];
  private recentSignals = new Map<string, SignalEvaluation[]>();
  private readonly maxSignalHistory = 100;
  private readonly varThreshold = 0.02;
  private readonly correlationThreshold = 0.7;
  private readonly concentrationThreshold = 0.3;

  constructor() {
    this.subscribeToEvents();
  }

  private subscribeToEvents(): void {
    globalEventBus.subscribe<SignalEvaluation>(EventType.SIGNAL_GENERATED, async (event) => {
      if (event.payload && typeof event.payload === 'object' && 'signalId' in event.payload) {
        await this.evaluateSignal(event.payload as SignalEvaluation);
      }
    });

    globalEventBus.subscribe<PortfolioState>(EventType.PORTFOLIO_REBALANCED, (event) => {
      this.portfolioState = event.payload as PortfolioState;
    });

    globalEventBus.subscribe<MarketRegime>(EventType.REGIME_CHANGED, (event) => {
      this.currentRegime = event.payload as MarketRegime;
    });
  }

  async evaluateSignal(signal: SignalEvaluation): Promise<MetaEvaluation> {
    const reasoning: string[] = [];
    let verdict = SignalVerdict.APPROVE;
    let finalSize = signal.proposedSize;
    let confidenceAdjustment = 0;

    const riskAssessment = this.assessRisk(signal);
    const executionAssessment = this.assessExecution(signal);

    if (riskAssessment.portfolioVaRImpact > this.varThreshold) {
      verdict = SignalVerdict.REDUCE_SIZE;
      finalSize *= 0.5;
      reasoning.push(`Portfolio VaR would increase by ${(riskAssessment.portfolioVaRImpact * 100).toFixed(2)}%, exceeding threshold`);
    }

    if (riskAssessment.correlationRisk > this.correlationThreshold) {
      verdict = SignalVerdict.HOLD;
      reasoning.push(`Correlation risk ${(riskAssessment.correlationRisk * 100).toFixed(1)}% exceeds threshold`);
    }

    if (riskAssessment.concentrationRisk > this.concentrationThreshold) {
      finalSize *= 0.7;
      reasoning.push(`Concentration risk elevated at ${(riskAssessment.concentrationRisk * 100).toFixed(1)}%`);
    }

    if (riskAssessment.volatilityRisk > 0.8) {
      verdict = verdict === SignalVerdict.APPROVE ? SignalVerdict.REDUCE_SIZE : verdict;
      finalSize *= 0.6;
      reasoning.push(`High volatility environment detected`);
    }

    if (riskAssessment.regimeSuitability < 0.3) {
      verdict = SignalVerdict.REJECT;
      reasoning.push(`Current market regime unsuitable for this strategy`);
    }

    const similarSignal = this.findSimilarRecentSignal(signal);
    if (similarSignal) {
      verdict = SignalVerdict.DELEGATE;
      reasoning.push(`Similar signal recently taken by strategy ${similarSignal.strategyId}`);
    }

    const health = this.strategyHealth.get(signal.strategyId);
    if (health && health.consecutiveLosses > 3) {
      confidenceAdjustment -= 0.2;
      reasoning.push(`Strategy has ${health.consecutiveLosses} consecutive losses`);
    }

    if (executionAssessment.expectedSlippage > 0.001) {
      finalSize *= 0.8;
      reasoning.push(`Expected slippage ${(executionAssessment.expectedSlippage * 100).toFixed(3)}% is elevated`);
    }

    if (reasoning.length === 0) {
      reasoning.push('Signal passes all meta-strategy criteria');
    }

    const evaluation: MetaEvaluation = {
      signalId: signal.signalId,
      verdict,
      finalSize: verdict === SignalVerdict.APPROVE || verdict === SignalVerdict.REDUCE_SIZE ? finalSize : undefined,
      finalEntry: signal.proposedEntry,
      finalStop: signal.proposedStop,
      finalTarget: signal.proposedTarget,
      confidenceAdjustment,
      reasoning,
      riskAssessment,
      executionAssessment,
      timestamp: new Date().toISOString(),
      evaluatorVersion: '2.0.0-institutional',
    };

    this.storeSignal(signal);
    this.publishEvaluation(evaluation, signal);

    return evaluation;
  }

  private assessRisk(signal: SignalEvaluation) {
    const portfolio = this.portfolioState;
    if (!portfolio) {
      return {
        portfolioVaRImpact: 0,
        correlationRisk: 0,
        concentrationRisk: 0,
        liquidityRisk: 0,
        volatilityRisk: 0.5,
        regimeSuitability: 0.5,
      };
    }

    const existingPosition = portfolio.positions.find(
      (p: { symbol: string; strategyId: string }) => p.symbol === signal.symbol && p.strategyId === signal.strategyId
    );

    const positionValue = signal.proposedSize * signal.proposedEntry;
    const portfolioValue = portfolio.totalCapital;
    const varImpact = positionValue / portfolioValue * (1 - signal.confidence);

    const sameSymbolPositions = portfolio.positions.filter((p: { symbol: string }) => p.symbol === signal.symbol);
    const correlationRisk = sameSymbolPositions.length > 0 ? 0.8 : 0.1;

    const strategyAllocation = portfolio.strategyAllocations[signal.strategyId] || 0;
    const concentrationRisk = (strategyAllocation + positionValue) / portfolioValue;

    return {
      portfolioVaRImpact: varImpact,
      correlationRisk,
      concentrationRisk,
      liquidityRisk: 0.3,
      volatilityRisk: this.currentRegime?.regime.includes('volatile') ? 0.9 : 0.3,
      regimeSuitability: this.calculateRegimeSuitability(signal),
    };
  }

  private assessExecution(signal: SignalEvaluation) {
    const urgency = signal.confidence > 0.8 ? 'immediate' : signal.confidence > 0.5 ? 'opportunistic' : 'patient';

    return {
      expectedSlippage: 0.0005 + (1 - signal.confidence) * 0.002,
      marketImpact: signal.proposedSize * 0.0001,
      timingScore: signal.confidence,
      urgency,
    };
  }

  private calculateRegimeSuitability(signal: SignalEvaluation): number {
    if (!this.currentRegime) return 0.5;

    const regime = this.currentRegime.regime;
    const isTrendFollowing = signal.confidence > 0.7;

    if (regime === 'trending_up_strong' && signal.side === 'LONG' && isTrendFollowing) return 0.9;
    if (regime === 'trending_down_strong' && signal.side === 'SHORT' && isTrendFollowing) return 0.9;
    if (regime === 'ranging_tight') return 0.4;
    if (regime === 'volatile_expansion') return 0.2;
    if (regime === 'unknown') return 0.3;

    return 0.6;
  }

  private findSimilarRecentSignal(signal: SignalEvaluation): SignalEvaluation | null {
    const recent = this.recentSignals.get(signal.symbol) || [];
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    return recent.find(
      (s) =>
        s.timestamp > cutoff &&
        s.side === signal.side &&
        Math.abs(s.proposedEntry - signal.proposedEntry) / signal.proposedEntry < 0.005
    ) || null;
  }

  private storeSignal(signal: SignalEvaluation): void {
    const list = this.recentSignals.get(signal.symbol) || [];
    list.push(signal);
    if (list.length > this.maxSignalHistory) list.shift();
    this.recentSignals.set(signal.symbol, list);
  }

  private publishEvaluation(evaluation: MetaEvaluation, originalSignal: SignalEvaluation): void {
    const eventType =
      evaluation.verdict === SignalVerdict.APPROVE
        ? EventType.TRADE_APPROVED
        : EventType.TRADE_REJECTED;

    globalEventBus.publish(
      globalEventBus.createEvent(
        eventType,
        {
          metaEvaluation: evaluation,
          originalSignal,
        },
        'MetaStrategyEngine',
        originalSignal.symbol
      )
    );

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.SIGNAL_ARBITRATED,
        evaluation,
        'MetaStrategyEngine',
        originalSignal.symbol
      )
    );
  }

  detectConflicts(): StrategyConflict[] {
    const active = this.conflicts.filter((c) => !c.resolvedAt);
    const newConflicts: StrategyConflict[] = [];

    for (const [symbol, signals] of this.recentSignals) {
      if (signals.length < 2) continue;

      const latest = signals.slice(-10);
      const longs = latest.filter((s) => s.side === 'LONG');
      const shorts = latest.filter((s) => s.side === 'SHORT');

      if (longs.length > 0 && shorts.length > 0) {
        const conflict: StrategyConflict = {
          id: crypto.randomUUID(),
          symbol,
          strategyA: longs[0].strategyId,
          strategyB: shorts[0].strategyId,
          conflictType: 'opposing_signals',
          severity: 'high',
          description: `Opposing signals on ${symbol}: ${longs[0].strategyId} LONG vs ${shorts[0].strategyId} SHORT`,
          detectedAt: new Date().toISOString(),
        };
        newConflicts.push(conflict);
      }
    }

    this.conflicts.push(...newConflicts);
    return [...active, ...newConflicts];
  }

  updateStrategyHealth(health: StrategyHealth): void {
    this.strategyHealth.set(health.strategyId, health);
  }

  getStrategyHealth(strategyId: string): StrategyHealth | undefined {
    return this.strategyHealth.get(strategyId);
  }

  getAllHealth(): Map<string, StrategyHealth> {
    return new Map(this.strategyHealth);
  }

  getPortfolioState(): PortfolioState | null {
    return this.portfolioState;
  }

  getCurrentRegime(): MarketRegime | null {
    return this.currentRegime;
  }
}

export const metaStrategyEngine = new MetaStrategyEngine();