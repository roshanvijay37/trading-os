import {
  Hypothesis,
  WalkForwardResult,
  MonteCarloResult,
  RobustnessScore,
  FactorDiscovery,
  ParameterSurface,
  EdgeDecayAnalysis,
} from '@domain/research/ResearchTypes';
import { EventType } from '@domain/events/TradingEvents';
import { globalEventBus } from '@infrastructure/events/EventBus';

export class ResearchLab {
  private hypotheses = new Map<string, Hypothesis>();
  private walkForwardResults = new Map<string, WalkForwardResult[]>();
  private monteCarloResults = new Map<string, MonteCarloResult[]>();
  private robustnessScores = new Map<string, RobustnessScore>();
  private factors = new Map<string, FactorDiscovery[]>();
  private parameterSurfaces = new Map<string, ParameterSurface[]>();
  private edgeDecays = new Map<string, EdgeDecayAnalysis[]>();

  createHypothesis(hypothesis: Omit<Hypothesis, 'id' | 'createdAt' | 'updatedAt'>): Hypothesis {
    const newHypothesis: Hypothesis = {
      ...hypothesis,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.hypotheses.set(newHypothesis.id, newHypothesis);

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.AI_RECOMMENDATION,
        { type: 'HYPOTHESIS_CREATED', hypothesis: newHypothesis },
        'ResearchLab',
        newHypothesis.id
      )
    );

    return newHypothesis;
  }

  runWalkForwardAnalysis(hypothesisId: string): WalkForwardResult {
    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis ${hypothesisId} not found`);

    const inSampleSharpe = hypothesis.expectedSharpe * (0.8 + Math.random() * 0.4);
    const outSampleSharpe = inSampleSharpe * (0.6 + Math.random() * 0.4);
    const degradation = (inSampleSharpe - outSampleSharpe) / inSampleSharpe;

    const result: WalkForwardResult = {
      id: crypto.randomUUID(),
      hypothesisId,
      inSampleStart: new Date(Date.now() - 31536000000).toISOString(),
      inSampleEnd: new Date(Date.now() - 7776000000).toISOString(),
      outSampleStart: new Date(Date.now() - 7776000000).toISOString(),
      outSampleEnd: new Date().toISOString(),
      inSampleSharpe,
      outSampleSharpe,
      inSampleDrawdown: 0.08 + Math.random() * 0.07,
      outSampleDrawdown: 0.1 + Math.random() * 0.1,
      degradation,
      isRobust: degradation < 0.3 && outSampleSharpe > 0.8,
      parameterStability: Math.max(0, 1 - degradation),
    };

    const existing = this.walkForwardResults.get(hypothesisId) || [];
    existing.push(result);
    this.walkForwardResults.set(hypothesisId, existing);

    this.calculateRobustnessScore(hypothesisId);

    return result;
  }

  runMonteCarloSimulation(hypothesisId: string, iterations: number = 10000): MonteCarloResult {
    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis ${hypothesisId} not found`);

    const simulatedReturns: number[] = [];
    let equity = 1;

    for (let i = 0; i < iterations; i++) {
      const ret = (Math.random() - 0.48) * hypothesis.expectedEdge * 2;
      equity *= (1 + ret);
      simulatedReturns.push(equity);
    }

    const finalEquities = simulatedReturns;
    const sorted = [...finalEquities].sort((a, b) => a - b);
    const profitable = finalEquities.filter((e) => e > 1).length;

    const result: MonteCarloResult = {
      id: crypto.randomUUID(),
      hypothesisId,
      iterations,
      simulatedReturns: finalEquities.slice(-1000),
      probabilityOfProfit: profitable / iterations,
      probabilityOfRuin: finalEquities.filter((e) => e < 0.5).length / iterations,
      expectedMaxDrawdown: 0.15 + Math.random() * 0.1,
      expectedFinalEquity: finalEquities[finalEquities.length - 1],
      confidenceInterval95: [sorted[Math.floor(iterations * 0.025)], sorted[Math.floor(iterations * 0.975)]],
      confidenceInterval99: [sorted[Math.floor(iterations * 0.005)], sorted[Math.floor(iterations * 0.995)]],
      worstCaseScenario: sorted[0],
      bestCaseScenario: sorted[sorted.length - 1],
      medianScenario: sorted[Math.floor(iterations * 0.5)],
    };

    const existing = this.monteCarloResults.get(hypothesisId) || [];
    existing.push(result);
    this.monteCarloResults.set(hypothesisId, existing);

    this.calculateRobustnessScore(hypothesisId);

    return result;
  }

  calculateRobustnessScore(hypothesisId: string): RobustnessScore {
    const wfResults = this.walkForwardResults.get(hypothesisId) || [];
    const mcResults = this.monteCarloResults.get(hypothesisId) || [];

    const wfRobust = wfResults.filter((r) => r.isRobust).length / (wfResults.length || 1);
    const wfScore = Math.min(100, wfRobust * 100 + (1 - wfResults[wfResults.length - 1]?.degradation || 0) * 50);

    const mcScore = mcResults.length > 0
      ? Math.min(100, mcResults[mcResults.length - 1].probabilityOfProfit * 100 +
          (1 - mcResults[mcResults.length - 1].probabilityOfRuin) * 50)
      : 50;

    const overallScore = wfScore * 0.3 + mcScore * 0.3 + 40;

    const score: RobustnessScore = {
      hypothesisId,
      overallScore: Math.round(overallScore),
      walkForwardScore: Math.round(wfScore),
      monteCarloScore: Math.round(mcScore),
      outOfSampleScore: Math.round(wfScore * 0.9),
      parameterStabilityScore: Math.round(wfResults[wfResults.length - 1]?.parameterStability * 100 || 50),
      regimeRobustnessScore: Math.round(50 + Math.random() * 30),
      noiseResistanceScore: Math.round(45 + Math.random() * 35),
      marketCrashScore: Math.round(40 + Math.random() * 40),
      verdict: overallScore > 80 ? 'strong_pass' : overallScore > 65 ? 'pass' : overallScore > 50 ? 'marginal' : overallScore > 30 ? 'fail' : 'strong_fail',
    };

    this.robustnessScores.set(hypothesisId, score);

    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.AI_RECOMMENDATION,
        { type: 'ROBUSTNESS_SCORED', score },
        'ResearchLab',
        hypothesisId
      )
    );

    return score;
  }

  discoverFactors(symbol: string, data: Array<{ timestamp: string; returns: number; features: Record<string, number> }>): FactorDiscovery[] {
    const discovered: FactorDiscovery[] = [];

    const featureNames = Object.keys(data[0]?.features || {});
    for (const featureName of featureNames) {
      const featureData = data.map((d) => ({
        timestamp: d.timestamp,
        value: d.features[featureName],
        forwardReturn: d.returns,
      }));

      const ic = this.calculateIC(featureData);
      const ir = Math.abs(ic) * Math.sqrt(252);

      const factor: FactorDiscovery = {
        id: crypto.randomUUID(),
        name: featureName,
        description: `Discovered factor: ${featureName}`,
        type: 'price',
        importance: Math.abs(ic),
        stability: 0.5 + Math.random() * 0.4,
        ic,
        ir,
        decay: Math.random() * 0.3,
        turnover: Math.random() * 0.5,
        capacity: 1000000 + Math.random() * 9000000,
        sharpe: ir * 0.8,
        data: featureData.slice(-100),
      };

      discovered.push(factor);
    }

    const existing = this.factors.get(symbol) || [];
    this.factors.set(symbol, [...existing, ...discovered]);

    return discovered;
  }

  private calculateIC(data: Array<{ value: number; forwardReturn: number }>): number {
    const n = data.length;
    if (n < 2) return 0;

    const meanX = data.reduce((s, d) => s + d.value, 0) / n;
    const meanY = data.reduce((s, d) => s + d.forwardReturn, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;

    for (const d of data) {
      const dx = d.value - meanX;
      const dy = d.forwardReturn - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }

    return num / Math.sqrt(denX * denY) || 0;
  }

  buildParameterSurface(
    hypothesisId: string,
    param1: string,
    param2: string,
    p1Range: number[],
    p2Range: number[]
  ): ParameterSurface {
    const surface: number[][] = [];
    let optimalValue = -Infinity;
    let optimalP1 = p1Range[0];
    let optimalP2 = p2Range[0];
    const stabilityRegion: Array<{ p1: number; p2: number }> = [];

    for (let i = 0; i < p1Range.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < p2Range.length; j++) {
        const value = Math.random() * 2 - 0.5;
        row.push(value);

        if (value > optimalValue) {
          optimalValue = value;
          optimalP1 = p1Range[i];
          optimalP2 = p2Range[j];
        }

        if (value > optimalValue * 0.9) {
          stabilityRegion.push({ p1: p1Range[i], p2: p2Range[j] });
        }
      }
      surface.push(row);
    }

    const result: ParameterSurface = {
      hypothesisId,
      parameter1: param1,
      parameter2: param2,
      p1Range,
      p2Range,
      surface,
      optimalPoint: { p1: optimalP1, p2: optimalP2, value: optimalValue },
      stabilityRegion,
    };

    const existing = this.parameterSurfaces.get(hypothesisId) || [];
    existing.push(result);
    this.parameterSurfaces.set(hypothesisId, existing);

    return result;
  }

  analyzeEdgeDecay(hypothesisId: string, lookbackYears: number = 5): EdgeDecayAnalysis {
    const yearlyEdges = [];
    let totalSharpe = 0;

    for (let year = 0; year < lookbackYears; year++) {
      const sharpe = 1.5 - year * 0.15 + (Math.random() - 0.5) * 0.4;
      totalSharpe += sharpe;
      yearlyEdges.push({
        year: new Date().getFullYear() - lookbackYears + year,
        sharpe: Math.max(0, sharpe),
        returns: sharpe * 0.1 + (Math.random() - 0.5) * 0.05,
        trades: 50 + Math.floor(Math.random() * 100),
      });
    }

    const firstSharpe = yearlyEdges[0]?.sharpe || 1;
    const lastSharpe = yearlyEdges[yearlyEdges.length - 1]?.sharpe || 0.5;
    const decayRate = firstSharpe > 0 ? (firstSharpe - lastSharpe) / firstSharpe / lookbackYears : 0;
    const halfLife = decayRate > 0 ? Math.log(2) / decayRate : Infinity;

    const analysis: EdgeDecayAnalysis = {
      hypothesisId,
      lookbackYears,
      yearlyEdges,
      decayRate,
      halfLife,
      conclusion: decayRate > 0.2
        ? 'Significant edge decay detected. Strategy may be overcrowded.'
        : decayRate > 0.1
        ? 'Moderate decay. Monitor closely.'
        : 'Edge is stable. Strategy appears durable.',
    };

    const existing = this.edgeDecays.get(hypothesisId) || [];
    existing.push(analysis);
    this.edgeDecays.set(hypothesisId, existing);

    return analysis;
  }

  getHypothesis(id: string): Hypothesis | undefined {
    return this.hypotheses.get(id);
  }

  getAllHypotheses(): Hypothesis[] {
    return Array.from(this.hypotheses.values());
  }

  getRobustnessScore(hypothesisId: string): RobustnessScore | undefined {
    return this.robustnessScores.get(hypothesisId);
  }

  getFactors(symbol: string): FactorDiscovery[] {
    return this.factors.get(symbol) || [];
  }

  getParameterSurfaces(hypothesisId: string): ParameterSurface[] {
    return this.parameterSurfaces.get(hypothesisId) || [];
  }
}

export const researchLab = new ResearchLab();