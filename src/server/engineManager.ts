import { marketMicrostructureEngine } from '@application/market-microstructure/MarketMicrostructureEngine';
import { portfolioOptimizationEngine } from '@application/portfolio/PortfolioOptimizationEngine';
import { observabilityEngine } from '@application/observability/ObservabilityEngine';
import { capitalProtectionEngine } from '@application/capital-protection/CapitalProtectionEngine';
import { selfHealingEngine } from '@application/self-healing/SelfHealingEngine';

export async function startEngines(): Promise<void> {
  marketMicrostructureEngine.start();
  portfolioOptimizationEngine.start();
  observabilityEngine.start();
  selfHealingEngine;

  observabilityEngine.registerComponent('market-microstructure', 'FEED');
  observabilityEngine.registerComponent('portfolio-optimization', 'RISK_ENGINE');
  observabilityEngine.registerComponent('ai-engine', 'AI_ENGINE');
  observabilityEngine.registerComponent('capital-protection', 'RISK_ENGINE');
  observabilityEngine.registerComponent('self-healing', 'EVENT_BUS');

  capitalProtectionEngine.initializeCapital(10000000);

  console.log('[EngineManager] All engines initialized');
}