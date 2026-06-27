import type { FastifyInstance } from 'fastify';
import { globalEventBus } from '@infrastructure/events/EventBus';
import { metaStrategyEngine } from '@application/meta-strategy/MetaStrategyEngine';
import { portfolioOptimizationEngine } from '@application/portfolio/PortfolioOptimizationEngine';
import { observabilityEngine } from '@application/observability/ObservabilityEngine';
import { researchLab } from '@application/research/ResearchLab';
import { aiEngine } from '@application/ai/AIEngine';
import { capitalProtectionEngine } from '@application/capital-protection/CapitalProtectionEngine';
import { selfHealingEngine } from '@application/self-healing/SelfHealingEngine';
import { marketMicrostructureEngine } from '@application/market-microstructure/MarketMicrostructureEngine';
import { EventType } from '@domain/events/TradingEvents';

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  server.get('/api/system/health', async () => {
    return observabilityEngine.getSystemHealth();
  });

  server.get('/api/system/events', async () => {
    return globalEventBus.getRecentEvents(500);
  });

  server.get('/api/system/events/:type', async (request) => {
    const { type } = request.params as { type: string };
    return globalEventBus.getEventsByType(type as EventType);
  });

  server.get('/api/portfolio/metrics', async () => {
    return portfolioOptimizationEngine.getMetrics();
  });

  server.get('/api/portfolio/allocation', async () => {
    return portfolioOptimizationEngine.getCurrentAllocation();
  });

  server.get('/api/meta-strategy/conflicts', async () => {
    return metaStrategyEngine.detectConflicts();
  });

  server.get('/api/meta-strategy/health', async () => {
    return Object.fromEntries(metaStrategyEngine.getAllHealth());
  });

  server.get('/api/research/hypotheses', async () => {
    return researchLab.getAllHypotheses();
  });

  server.post('/api/research/hypothesis', async (request) => {
    const body = request.body as Parameters<typeof researchLab.createHypothesis>[0];
    return researchLab.createHypothesis(body);
  });

  server.get('/api/capital/state', async () => {
    return capitalProtectionEngine.getState();
  });

  server.get('/api/capital/config', async () => {
    return capitalProtectionEngine.getConfig();
  });

  server.get('/api/observability/components', async () => {
    return observabilityEngine.getAllHealth();
  });

  server.get('/api/observability/alerts', async () => {
    return observabilityEngine.getAlerts(true);
  });

  server.get('/api/ai/results', async () => {
    return aiEngine.getResults();
  });

  server.get('/api/self-healing/log', async () => {
    return selfHealingEngine.getHealingLog();
  });

  server.get('/api/market-microstructure/liquidity/:symbol', async (request) => {
    const { symbol } = request.params as { symbol: string };
    return marketMicrostructureEngine.getLiquidityZones(symbol);
  });

  server.get('/api/market-microstructure/volume-profile/:symbol', async (request) => {
    const { symbol } = request.params as { symbol: string };
    return marketMicrostructureEngine.getVolumeProfile(symbol);
  });

  server.get('/api/ws/events', { websocket: true }, (connection) => {
    const unsubscribe = globalEventBus.subscribePattern(/.*/, (event) => {
      connection.socket.send(JSON.stringify(event));
    });

    connection.socket.on('close', () => {
      unsubscribe();
    });
  });
}