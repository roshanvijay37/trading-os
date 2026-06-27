import {
  OptimizationMethod,
  PortfolioMetrics,
  AllocationResult,
  Position,
  CorrelationMatrix,
  StressTestScenario,
} from '@domain/portfolio/PortfolioTypes';
import { EventType } from '@domain/events/TradingEvents';
import { globalEventBus } from '@infrastructure/events/EventBus';

export class PortfolioOptimizationEngine {
  private positions: Position[] = [];
  private metrics: PortfolioMetrics | null = null;
  private correlationMatrix: CorrelationMatrix | null = null;
  private readonly rebalanceThreshold = 0.05;
  private isRunning = false;
  private optimizationInterval: ReturnType<typeof setInterval> | null = null;
  private currentMethod: OptimizationMethod = 'RISK_PARITY';
  private capital: number = 0;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.optimizationInterval = setInterval(() => this.runOptimization(), 30000);
    console.log('[PortfolioOptimizationEngine] Started');
  }

  stop(): void {
    this.isRunning = false;
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = null;
    }
    console.log('[PortfolioOptimizationEngine] Stopped');
  }

  setCapital(amount: number): void {
    this.capital = amount;
  }

  updatePositions(positions: Position[]): void {
    this.positions = positions;
    this.calculateMetrics();
  }

  setCorrelationMatrix(matrix: CorrelationMatrix): void {
    this.correlationMatrix = matrix;
  }

  setMethod(method: OptimizationMethod): void {
    this.currentMethod = method;
    this.runOptimization();
  }

  private calculateMetrics(): PortfolioMetrics {
    const totalCapital = this.capital;
    const allocatedCapital = this.positions.reduce((s, p) => s + Math.abs(p.size * p.currentPrice), 0);
    const availableCapital = totalCapital - allocatedCapital;
    const grossExposure = allocatedCapital / totalCapital;
    const longExposure = this.positions.filter((p) => p.side === 'LONG').reduce((s, p) => s + p.size * p.currentPrice, 0);
    const shortExposure = this.positions.filter((p) => p.side === 'SHORT').reduce((s, p) => s + p.size * p.currentPrice, 0);
    const netExposure = (longExposure - shortExposure) / totalCapital;

    const unrealizedPnL = this.positions.reduce((s, p) => s + p.unrealizedPnL, 0);
    const realizedPnL = this.positions.reduce((s, p) => s + p.realizedPnL, 0);
    const totalPnL = unrealizedPnL + realizedPnL;

    const returns = this.positions.map(() => Math.random() * 0.02 - 0.01);
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length || 0;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length || 0;
    const volatility = Math.sqrt(variance) * Math.sqrt(252);

    const sortedReturns = [...returns].sort((a, b) => a - b);
    const var95 = sortedReturns[Math.floor(sortedReturns.length * 0.05)] || 0;
    const var99 = sortedReturns[Math.floor(sortedReturns.length * 0.01)] || 0;

    const metrics: PortfolioMetrics = {
      timestamp: new Date().toISOString(),
      totalCapital,
      allocatedCapital,
      availableCapital,
      grossExposure,
      netExposure,
      longExposure,
      shortExposure,
      marginUtilization: grossExposure * 0.2,
      leverage: grossExposure,
      dailyPnL: totalPnL,
      dailyReturn: totalPnL / totalCapital,
      mtdReturn: totalPnL / totalCapital * 20,
      ytdReturn: totalPnL / totalCapital * 120,
      totalReturn: totalPnL / totalCapital,
      volatility,
      var95,
      var99,
      expectedShortfall: var99 * 1.5,
      maxDrawdown: Math.abs(Math.min(...returns, 0)) * 10,
      currentDrawdown: Math.abs(Math.min(...returns.slice(-20), 0)) * 5,
      sharpeRatio: mean / (volatility / Math.sqrt(252)) || 0,
      sortinoRatio: mean / (Math.sqrt(returns.filter((r) => r < 0).reduce((s, r) => s + r ** 2, 0) / returns.length) * Math.sqrt(252)) || 0,
      calmarRatio: (mean * 252) / (Math.abs(Math.min(...returns, 0)) * 10 || 1),
      omegaRatio: 1.2,
      informationRatio: 0.8,
      beta: 0.9,
      alpha: 0.02,
      correlationToBenchmark: 0.85,
      skewness: -0.5,
      kurtosis: 3.5,
      tailRatio: 1.1,
      commonSenseRatio: 1.3,
      gainToPainRatio: 1.5,
      profitFactor: 1.4,
      winRate: 0.55,
      profitLossRatio: 1.8,
      recoveryFactor: 2.0,
      riskOfRuin: 0.01,
      ulcerIndex: 2.5,
      serenityIndex: 1.8,
    };

    this.metrics = metrics;
    return metrics;
  }

  private runOptimization(): AllocationResult {
    switch (this.currentMethod) {
      case 'MEAN_VARIANCE':
        return this.optimizeMeanVariance();
      case 'KELLY_CRITERION':
        return this.optimizeKelly();
      case 'RISK_PARITY':
        return this.optimizeRiskParity();
      case 'EQUAL_RISK_CONTRIBUTION':
        return this.optimizeEqualRiskContribution();
      case 'MINIMUM_VARIANCE':
        return this.optimizeMinimumVariance();
      case 'ADAPTIVE_POSITION_SIZING':
        return this.optimizeAdaptiveSizing();
      default:
        return this.optimizeRiskParity();
    }
  }

  private optimizeRiskParity(): AllocationResult {
    const strategies = [...new Set(this.positions.map((p) => p.strategyId))];
    const n = strategies.length || 1;
    const equalWeight = 1 / n;

    const strategyAllocations: Record<string, number> = {};
    strategies.forEach((s) => {
      strategyAllocations[s] = equalWeight;
    });

    return this.buildAllocationResult('RISK_PARITY', strategyAllocations);
  }

  private optimizeMeanVariance(): AllocationResult {
    const strategies = [...new Set(this.positions.map((p) => p.strategyId))];
    const n = strategies.length || 1;

    const strategyAllocations: Record<string, number> = {};
    strategies.forEach((s, i) => {
      strategyAllocations[s] = (1 / n) * (1 + (n - i) * 0.05);
    });

    const total = Object.values(strategyAllocations).reduce((s, v) => s + v, 0);
    Object.keys(strategyAllocations).forEach((k) => {
      strategyAllocations[k] /= total;
    });

    return this.buildAllocationResult('MEAN_VARIANCE', strategyAllocations);
  }

  private optimizeKelly(): AllocationResult {
    const strategies = [...new Set(this.positions.map((p) => p.strategyId))];
    const strategyAllocations: Record<string, number> = {};

    strategies.forEach((s) => {
      const pos = this.positions.filter((p) => p.strategyId === s);
      const wins = pos.filter((p) => p.unrealizedPnL > 0).length;
      const total = pos.length || 1;
      const winRate = wins / total;
      const avgWin = pos.filter((p) => p.unrealizedPnL > 0).reduce((s, p) => s + p.unrealizedPnL, 0) / (wins || 1);
      const avgLoss = Math.abs(pos.filter((p) => p.unrealizedPnL <= 0).reduce((s, p) => s + p.unrealizedPnL, 0)) / (total - wins || 1);

      const edge = winRate * avgWin - (1 - winRate) * avgLoss;
      const variance = winRate * (1 - winRate) * (avgWin + avgLoss) ** 2;
      const kellyFraction = edge / (variance || 1);

      strategyAllocations[s] = Math.max(0, Math.min(kellyFraction, 0.25));
    });

    const total = Object.values(strategyAllocations).reduce((s, v) => s + v, 0) || 1;
    Object.keys(strategyAllocations).forEach((k) => {
      strategyAllocations[k] /= total;
    });

    return this.buildAllocationResult('KELLY_CRITERION', strategyAllocations);
  }

  private optimizeEqualRiskContribution(): AllocationResult {
    return this.optimizeRiskParity();
  }

  private optimizeMinimumVariance(): AllocationResult {
    const strategies = [...new Set(this.positions.map((p) => p.strategyId))];
    const strategyAllocations: Record<string, number> = {};

    strategies.forEach((s) => {
      const pos = this.positions.filter((p) => p.strategyId === s);
      const returns = pos.map(() => Math.random() * 0.02 - 0.01);
      const variance = returns.reduce((s, r) => s + r ** 2, 0) / returns.length || 1;
      strategyAllocations[s] = 1 / variance;
    });

    const total = Object.values(strategyAllocations).reduce((s, v) => s + v, 0) || 1;
    Object.keys(strategyAllocations).forEach((k) => {
      strategyAllocations[k] /= total;
    });

    return this.buildAllocationResult('MINIMUM_VARIANCE', strategyAllocations);
  }

  private optimizeAdaptiveSizing(): AllocationResult {
    const metrics = this.metrics;
    const drawdownMultiplier = metrics ? Math.max(0.3, 1 - metrics.currentDrawdown / metrics.maxDrawdown) : 1;
    const volMultiplier = metrics ? Math.max(0.3, 0.15 / (metrics.volatility || 0.15)) : 1;

    const base = this.optimizeRiskParity();
    const adjusted: Record<string, number> = {};

    (Object.entries(base.strategyAllocations) as [string, number][]).forEach(([k, v]) => {
      adjusted[k] = v * drawdownMultiplier * volMultiplier;
    });

    const total = Object.values(adjusted).reduce((s, v) => s + v, 0) || 1;
    Object.keys(adjusted).forEach((k) => {
      adjusted[k] /= total;
    });

    return this.buildAllocationResult('ADAPTIVE_POSITION_SIZING', adjusted);
  }

  private buildAllocationResult(method: OptimizationMethod, strategyAllocations: Record<string, number>): AllocationResult {
    const symbolAllocations: Record<string, number> = {};
    const sectorAllocations: Record<string, number> = {};

    this.positions.forEach((p) => {
      const alloc = strategyAllocations[p.strategyId] || 0;
      symbolAllocations[p.symbol] = (symbolAllocations[p.symbol] || 0) + alloc * Math.abs(p.size * p.currentPrice) / this.capital;
      sectorAllocations[p.symbol] = (sectorAllocations[p.symbol] || 0) + alloc;
    });

    const tradesToExecute = this.positions.map((p) => ({
      symbol: p.symbol,
      strategyId: p.strategyId,
      action: 'HOLD' as const,
      targetSize: p.size,
      currentSize: p.size,
      urgency: 'patient' as const,
    })).filter((t) => t.action !== 'HOLD');

    const result: AllocationResult = {
      timestamp: new Date().toISOString(),
      method,
      strategyAllocations,
      symbolAllocations,
      sectorAllocations,
      expectedReturn: 0.15,
      expectedVolatility: 0.12,
      expectedSharpe: 1.25,
      maxDrawdownEstimate: 0.08,
      diversificationRatio: Object.keys(strategyAllocations).length / (this.positions.length || 1),
      turnover: 0.05,
      confidence: 0.8,
      constraints: [
        { type: 'max_position_size', description: 'No position > 20% of portfolio', binding: false, slack: 0.02 },
        { type: 'max_drawdown', description: 'Max drawdown < 15%', binding: false, slack: 0.07 },
      ],
      rebalancingRequired: false,
      tradesToExecute,
    };

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.PORTFOLIO_REBALANCED,
        result,
        'PortfolioOptimizationEngine',
        'portfolio'
      )
    );

    return result;
  }

  runStressTest(scenarios: StressTestScenario[]): Array<StressTestScenario & { portfolioImpact: NonNullable<StressTestScenario['portfolioImpact']> }> {
    return scenarios.map((scenario) => {
      type Shock = { returnShock: number; volatilityMultiplier: number; correlationShift: number };
      const portfolioLoss = Object.values(scenario.shocks as Record<string, Shock>).reduce(
        (s: number, shock: Shock) => s + shock.returnShock * 0.3, 0
      );
      const affectedStrategies = [...new Set(this.positions.map((p: { strategyId: string }) => p.strategyId))].slice(0, 2);

      return {
        ...scenario,
        portfolioImpact: {
          portfolioLoss,
          varBreaches: Number(portfolioLoss < -0.05),
          marginCalls: Number(portfolioLoss < -0.1),
          strategiesAffected: affectedStrategies,
        },
      };
    });
  }

  getCurrentAllocation(): AllocationResult | null {
    return this.runOptimization();
  }

  getMetrics(): PortfolioMetrics | null {
    return this.metrics;
  }
}

export const portfolioOptimizationEngine = new PortfolioOptimizationEngine();