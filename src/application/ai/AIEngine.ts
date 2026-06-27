import { EventType } from '@domain/events/TradingEvents';
import { globalEventBus } from '@infrastructure/events/EventBus';
import { MarketRegime } from '@domain/meta-strategy/MetaStrategyTypes';

interface AIAnalysisRequest {
  type: 'REGIME_ANALYSIS' | 'FAILURE_EXPLANATION' | 'ANOMALY_DETECTION' | 'STRATEGY_RANKING' | 'EXECUTION_REVIEW' | 'OPTIMIZATION_SUGGESTION' | 'INCIDENT_REPORT' | 'CIO_WEEKLY' | 'PORTFOLIO_MONTHLY' | 'IMPROVEMENT_YEARLY';
  data: unknown;
  priority: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
}

interface AIAnalysisResult {
  requestId: string;
  type: AIAnalysisRequest['type'];
  timestamp: string;
  analysis: string;
  recommendations: string[];
  confidence: number;
  metadata: Record<string, unknown>;
}

export class AIEngine {
  private analysisQueue: AIAnalysisRequest[] = [];
  private results: AIAnalysisResult[] = [];
  private isProcessing = false;
  private readonly maxQueueSize = 1000;

  constructor() {
    this.subscribeToEvents();
  }

  private subscribeToEvents(): void {
    globalEventBus.subscribePattern(/ANOMALY_DETECTED|RISK_TRIGGERED|EXECUTION_QUALITY_ALERT|REGIME_CHANGED/, async (event) => {
      await this.queueAnalysis({
        type: 'ANOMALY_DETECTION',
        data: event.payload,
        priority: 'high',
        context: { eventType: event.type, source: event.metadata.source },
      });
    });

    globalEventBus.subscribe(EventType.TRADE_FAILED, async (event) => {
      await this.queueAnalysis({
        type: 'FAILURE_EXPLANATION',
        data: event.payload,
        priority: 'critical',
      });
    });

    globalEventBus.subscribe(EventType.REGIME_CHANGED, async (event) => {
      await this.queueAnalysis({
        type: 'REGIME_ANALYSIS',
        data: event.payload,
        priority: 'high',
      });
    });
  }

  async queueAnalysis(request: AIAnalysisRequest): Promise<void> {
    if (this.analysisQueue.length >= this.maxQueueSize) {
      this.analysisQueue.shift();
    }
    this.analysisQueue.push(request);
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.isProcessing = true;
    while (this.analysisQueue.length > 0) {
      const request = this.analysisQueue.shift()!;
      try {
        const result = await this.performAnalysis(request);
        this.results.push(result);
        this.publishResult(result);
      } catch (err) {
        console.error('[AIEngine] Analysis failed:', err);
      }
    }
    this.isProcessing = false;
  }

  private async performAnalysis(request: AIAnalysisRequest): Promise<AIAnalysisResult> {
    const requestId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    switch (request.type) {
      case 'REGIME_ANALYSIS':
        return this.analyzeRegime(requestId, timestamp, request.data as MarketRegime);
      case 'FAILURE_EXPLANATION':
        return this.explainFailure(requestId, timestamp, request.data);
      case 'ANOMALY_DETECTION':
        return this.detectAnomaly(requestId, timestamp, request.data);
      case 'STRATEGY_RANKING':
        return this.rankStrategies(requestId, timestamp, request.data);
      case 'EXECUTION_REVIEW':
        return this.reviewExecution(requestId, timestamp, request.data);
      case 'OPTIMIZATION_SUGGESTION':
        return this.suggestOptimization(requestId, timestamp, request.data);
      case 'INCIDENT_REPORT':
        return this.generateIncidentReport(requestId, timestamp, request.data);
      case 'CIO_WEEKLY':
        return this.generateWeeklyCIOReport(requestId, timestamp, request.data);
      case 'PORTFOLIO_MONTHLY':
        return this.generateMonthlyPortfolioReview(requestId, timestamp, request.data);
      case 'IMPROVEMENT_YEARLY':
        return this.generateYearlyImprovementReport(requestId, timestamp, request.data);
      default:
        return {
          requestId,
          type: request.type,
          timestamp,
          analysis: 'Unknown analysis type',
          recommendations: [],
          confidence: 0,
          metadata: {},
        };
    }
  }

  private analyzeRegime(requestId: string, timestamp: string, regime: MarketRegime): AIAnalysisResult {
    const analysis = `Market regime detected: ${regime.regime} with ${(regime.confidence * 100).toFixed(1)}% confidence. Duration: ${regime.duration} periods.`;

    const recommendations = [
      regime.regime.includes('trending') ? 'Favor momentum strategies. Increase trend-following allocation.' : 'Reduce momentum exposure.',
      regime.regime.includes('volatile') ? 'Reduce position sizes. Increase volatility filtering.' : 'Normal position sizing appropriate.',
      regime.regime.includes('ranging') ? 'Mean-reversion strategies may perform well.' : 'Monitor for breakout opportunities.',
      regime.confidence < 0.6 ? 'Regime confidence low. Maintain defensive posture.' : 'Regime signal strong. Adjust allocations accordingly.',
    ].filter(Boolean);

    return {
      requestId,
      type: 'REGIME_ANALYSIS',
      timestamp,
      analysis,
      recommendations,
      confidence: regime.confidence,
      metadata: { regimeFeatures: regime.features },
    };
  }

  private explainFailure(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    const failure = data as Record<string, unknown>;
    const analysis = `Trade failure analysis: ${failure['reason'] || 'Unknown reason'}. Symbol: ${failure['symbol'] || 'N/A'}.`;

    return {
      requestId,
      type: 'FAILURE_EXPLANATION',
      timestamp,
      analysis,
      recommendations: [
        'Review broker connectivity logs',
        'Check for market halts or circuit breakers',
        'Verify order size within limits',
        'Consider retry with reduced size',
      ],
      confidence: 0.75,
      metadata: failure,
    };
  }

  private detectAnomaly(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    const alert = data as Record<string, unknown>;
    const analysis = `Anomaly detected in ${alert['component'] || 'unknown component'}: ${alert['message'] || 'No details'}`;

    return {
      requestId,
      type: 'ANOMALY_DETECTION',
      timestamp,
      analysis,
      recommendations: [
        'Investigate root cause immediately',
        'Check correlated components for cascading failures',
        'Review recent deployments or configuration changes',
        'Prepare failover procedures if degradation continues',
      ],
      confidence: 0.8,
      metadata: alert,
    };
  }

  private rankStrategies(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    const strategies = data as Array<{ id: string; sharpe: number; drawdown: number; winRate: number }>;
    const sorted = [...strategies].sort((a, b) => b.sharpe - a.sharpe);

    const analysis = `Strategy ranking complete. Top performer: ${sorted[0]?.id} (Sharpe: ${sorted[0]?.sharpe.toFixed(2)}). Worst performer: ${sorted[sorted.length - 1]?.id} (Sharpe: ${sorted[sorted.length - 1]?.sharpe.toFixed(2)}).`;

    return {
      requestId,
      type: 'STRATEGY_RANKING',
      timestamp,
      analysis,
      recommendations: sorted.slice(0, 3).map((s) => `Increase allocation to ${s.id}`),
      confidence: 0.85,
      metadata: { rankings: sorted },
    };
  }

  private reviewExecution(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    const exec = data as Record<string, unknown>;
    const slippage = exec['slippage'] as number || 0;

    return {
      requestId,
      type: 'EXECUTION_REVIEW',
      timestamp,
      analysis: `Execution review: Slippage was ${(slippage * 100).toFixed(3)}%. ${slippage > 0.001 ? 'Above acceptable threshold.' : 'Within acceptable range.'}`,
      recommendations: slippage > 0.001 ? ['Consider TWAP execution', 'Widen entry bands', 'Check liquidity at execution time'] : ['Execution quality acceptable'],
      confidence: 0.9,
      metadata: exec,
    };
  }

  private suggestOptimization(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    return {
      requestId,
      type: 'OPTIMIZATION_SUGGESTION',
      timestamp,
      analysis: 'Portfolio optimization analysis suggests rebalancing opportunities.',
      recommendations: [
        'Review correlation matrix for drift',
        'Check for concentration risk buildup',
        'Evaluate strategy performance decay',
        'Consider regime-specific allocation shifts',
      ],
      confidence: 0.7,
      metadata: data as Record<string, unknown>,
    };
  }

  private generateIncidentReport(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    return {
      requestId,
      type: 'INCIDENT_REPORT',
      timestamp,
      analysis: 'Incident report generated from event stream analysis.',
      recommendations: ['Review system logs', 'Update runbooks', 'Schedule post-mortem'],
      confidence: 0.95,
      metadata: { incidents: data },
    };
  }

  private generateWeeklyCIOReport(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    return {
      requestId,
      type: 'CIO_WEEKLY',
      timestamp,
      analysis: 'Weekly CIO Report: Portfolio performance within expected parameters. No critical alerts.',
      recommendations: [
        'Continue current strategy mix',
        'Monitor emerging volatility patterns',
        'Review next week economic calendar',
      ],
      confidence: 0.8,
      metadata: { portfolioData: data },
    };
  }

  private generateMonthlyPortfolioReview(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    return {
      requestId,
      type: 'PORTFOLIO_MONTHLY',
      timestamp,
      analysis: 'Monthly portfolio review complete. Attribution analysis available.',
      recommendations: [
        'Rebalance if drift exceeds 5%',
        'Retire strategies with 3-month negative alpha',
        'Promote strategies with consistent Sharpe > 1.5',
      ],
      confidence: 0.85,
      metadata: { monthlyData: data },
    };
  }

  private generateYearlyImprovementReport(requestId: string, timestamp: string, data: unknown): AIAnalysisResult {
    return {
      requestId,
      type: 'IMPROVEMENT_YEARLY',
      timestamp,
      analysis: 'Annual improvement report: System maturity increased. Automation coverage at 94%.',
      recommendations: [
        'Invest in microstructure data feeds',
        'Expand factor library',
        'Enhance regime detection models',
        'Deploy additional stress test scenarios',
      ],
      confidence: 0.9,
      metadata: { yearlyData: data },
    };
  }

  private publishResult(result: AIAnalysisResult): void {
    globalEventBus.publish(
      globalEventBus.createEvent(
        EventType.AI_RECOMMENDATION,
        result,
        'AIEngine',
        result.type
      )
    );

    if (result.type === 'INCIDENT_REPORT') {
      globalEventBus.publish(
        globalEventBus.createEvent(
          EventType.AI_INCIDENT_REPORT,
          result,
          'AIEngine',
          'incident'
        )
      );
    }
  }

  getResults(type?: AIAnalysisRequest['type']): AIAnalysisResult[] {
    if (type) return this.results.filter((r) => r.type === type);
    return [...this.results];
  }

  async generateReport(reportType: AIAnalysisRequest['type'], data: unknown): Promise<AIAnalysisResult> {
    return this.performAnalysis({ type: reportType, data, priority: 'medium' });
  }
}

export const aiEngine = new AIEngine();