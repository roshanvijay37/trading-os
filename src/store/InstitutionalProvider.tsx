/**
 * TradingOS — Institutional Store
 * Central state management using React Context + useReducer
 */

import { createContext, useContext, useReducer, useCallback, useMemo, type ReactNode } from "react";
import type {
  StrategyConfig,
  StrategyState,
  StrategyId,
  PortfolioRiskState,
  AICIOState,
  ExecutionState,
  BotHealthState,
  DashboardState,
  MarketIntelligence,
  PlatformSettings,
} from "../types/institutional";
import { getDefaultStrategyConfig, STRATEGY_DEFINITIONS } from "../lib/strategies/registry";

// ─── Initialize Strategy States ─────────────────────────────────
function initStrategyConfigs(): Record<StrategyId, StrategyConfig> {
  const configs = {} as Record<StrategyId, StrategyConfig>;
  for (const def of STRATEGY_DEFINITIONS) {
    const config = getDefaultStrategyConfig(def.id);
    if (config) configs[def.id] = config;
  }
  return configs;
}

function initStrategyStates(): Record<StrategyId, StrategyState> {
  const states = {} as Record<StrategyId, StrategyState>;
  for (const def of STRATEGY_DEFINITIONS) {
    const config = getDefaultStrategyConfig(def.id);
    if (config) {
      states[def.id] = {
        config,
        isRunning: false,
        isPaused: false,
        positions: [],
        todayTrades: 0,
        todayPnL: 0,
        winRate: 0,
        drawdown: 0,
        dailyRiskUsed: 0,
        signalsGenerated: 0,
        signalsExecuted: 0,
        signalsRejected: 0,
        lastTradeTime: null,
        cooldownUntil: null,
        status: "DISABLED",
        version: def.version,
      };
    }
  }
  return states;
}

// ─── Default States ─────────────────────────────────────────────
const defaultPortfolioRisk: PortfolioRiskState = {
  totalExposure: 0, portfolioDrawdown: 0, dailyRiskUsed: 0, capitalUtilized: 0,
  strategyExposure: {} as Record<StrategyId, number>, directionalExposure: 0,
  deltaExposure: 0, gammaExposure: 0, thetaExposure: 0, vegaExposure: 0,
  netPremiumRisk: 0, maxPortfolioLoss: 0, maxDailyLoss: 0, maxWeeklyLoss: 0, maxMonthlyLoss: 0,
  var95: 0, var99: 0, beta: 0, correlationMatrix: {}, stressTestResults: [],
  limits: {
    maxPortfolioDrawdown: 10, maxDailyLoss: 50000, maxWeeklyLoss: 100000, maxMonthlyLoss: 200000,
    maxStrategyConcentration: 50, maxDirectionalExposure: 100, maxDeltaExposure: 100,
    maxGammaExposure: 50, maxVegaExposure: 50, maxTotalPositions: 20, maxSinglePositionSize: 25,
  },
  breaches: [],
};

const defaultCIOState: AICIOState = {
  currentRegime: "TRENDING_UP", regimeConfidence: 0.7, lastRegimeChange: new Date().toISOString(),
  recommendations: [], activeAdjustments: [],
  marketContext: {
    advanceDeclineRatio: 1, sectorStrength: {}, marketBreadth: 0.5, indexStrength: 0,
    vixLevel: 15, vixTrend: "STABLE", oiBuildup: "MIXED", pcrTrend: "STABLE", unusualActivity: false,
  },
  performanceForecast: {
    expectedReturn: 0, expectedVolatility: 0, expectedDrawdown: 0,
    winProbability: 0.5, sharpeEstimate: 1, confidence: 0.6,
  },
};

const defaultExecutionState: ExecutionState = {
  activeOrders: [], pendingOrders: [], rejectedOrders: [], retryQueue: [], executionLogs: [],
  stats: { totalOrders: 0, filledOrders: 0, rejectedOrders: 0, retriedOrders: 0, avgFillPrice: 0, avgSlippage: 0, avgExecutionLatency: 0, executionScore: 100, partialFillRate: 0, rejectionRate: 0 },
  brokerHealth: { status: "HEALTHY", ping: 50, lastSuccess: new Date().toISOString(), errorRate: 0, reconnectCount: 0 },
  exchangeHealth: { status: "HEALTHY", lastTick: new Date().toISOString(), tickLag: 0 },
};

const defaultBotHealth: BotHealthState = {
  overallStatus: "HEALTHY", healthScore: 100, components: [], lastUpdated: new Date().toISOString(),
};

const defaultDashboard: DashboardState = {
  portfolioPnL: 0, strategyPnL: {} as Record<StrategyId, number>, botStatus: "STOPPED", riskStatus: "HEALTHY",
  capitalUsed: 0, capitalTotal: 1000000, todaysTrades: 0, dailyLimit: 10,
  brokerStatus: defaultExecutionState.brokerHealth, exchangeStatus: defaultExecutionState.exchangeHealth,
  marketStatus: "CLOSED", signalQueue: 0, executionQueue: 0, runningStrategies: 0, pausedStrategies: 0,
  healthScore: 100, executionScore: 100, currentMarketRegime: "TRENDING_UP",
  alerts: [], warnings: [], recentLogs: [],
};

const defaultMarketIntel: MarketIntelligence = {
  advanceDecline: { advances: 0, declines: 0, unchanged: 0, ratio: 1, trend: "NEUTRAL" },
  sectorStrength: [],
  marketBreadth: { above20EMA: 0, above50EMA: 0, above200EMA: 0, newHighs: 0, newLows: 0, mcClellanOscillator: 0, bullishPercent: 50 },
  indexStrength: [],
  oiHeatmap: { strikes: [], callOI: [], putOI: [], callOIChange: [], putOIChange: [], maxPainStrike: 0, timestamp: new Date().toISOString() },
  oiShift: { strike: 0, callShift: 0, putShift: 0, netShift: 0, significance: "LOW" },
  pcr: { current: 1, change: 0, percentile: 50, trend: "STABLE", interpretation: "Neutral" },
  maxPain: { strike: 0, painValue: 0, nearestStrikes: [] },
  expectedMove: { move: 0, movePercent: 0, upperBound: 0, lowerBound: 0, confidence: 0.68 },
  ivRank: { current: 0, rank: 50, historicalRange: [10, 30] },
  ivPercentile: { current: 0, percentile: 50, lookbackDays: 30 },
  ivSmile: { strikes: [], ivValues: [], atmIv: 0, skew: 0 },
  gammaExposure: { totalGamma: 0, gammaByStrike: {}, zeroGammaLevel: 0, flipPoint: 0, estimatedHedgeDelta: 0 },
  dealerPositioning: { netDelta: 0, netGamma: 0, hedgeDirection: "NEUTRAL", estimatedPnl: 0 },
  blockTrades: [], unusualOptionActivity: [], volumeSpikes: [],
  institutionalFlow: { netFiiCash: 0, netDiiCash: 0, netFiiFno: 0, netClientFno: 0, fiiIndexLong: 0, fiiIndexShort: 0, fiiStockLong: 0, fiiStockShort: 0, trend: "NEUTRAL" },
  oiBuildup: { symbol: "", strike: 0, type: "CE", oiChange: 0, priceChange: 0, interpretation: "LONG_BUILDUP", timestamp: new Date().toISOString() },
  oiUnwinding: { symbol: "", strike: 0, type: "CE", oiChange: 0, priceChange: 0, interpretation: "LONG_UNWINDING", timestamp: new Date().toISOString() },
  lastUpdated: new Date().toISOString(),
};

const defaultSettings: PlatformSettings = {
  broker: { broker: "FYERS", apiKey: "", apiSecret: "", redirectUrl: "", defaultExchange: "NSE", enableRateLimiting: true },
  risk: { maxDailyLoss: 50000, maxWeeklyLoss: 100000, maxMonthlyLoss: 200000, maxDrawdown: 10, maxConsecutiveLosses: 5, maxOpenPositions: 20, maxSinglePositionSize: 25, maxPortfolioConcentration: 50, enableCircuitBreakers: true, enableTrailingStop: true, trailingStopType: "ATR", trailingStopValue: 2 },
  capital: { totalCapital: 1000000, reservePercent: 20, maxUtilization: 80, rebalancingFrequency: "DAILY", compoundProfits: true },
  strategies: { defaultAllocation: 10, minConfidence: 0.6, enableAutoPause: true, autoPauseThreshold: 5, strategyCooldown: 30 },
  sessions: { preMarket: false, regularSession: true, postMarket: false, customSessions: [] },
  notifications: { email: false, sms: false, webhook: false, webhookUrl: "", alertOnTrade: true, alertOnRisk: true, alertOnError: true, alertOnDailySummary: true },
  paperTrading: { enabled: true, virtualCapital: 1000000, mirrorLivePrices: true, slippageSimulation: 0.02 },
  emergencyStop: { enableEmergencyStop: true, emergencyContact: "", autoSquareOff: true, autoSquareOffTime: "15:15" },
  execution: { orderType: "LIMIT", limitBuffer: 0.3, smartRetry: true, maxRetries: 3, retryDelay: 2000, orderSplitting: true, maxOrderSize: 1000, slippageProtection: true, maxSlippage: 0.5 },
  aiEngine: { enableAIReasoning: true, enableCIO: true, enableTradeReview: true, enableSelfImprovement: true, confidenceThreshold: 0.6, minTradeGrade: "B", modelType: "RULE_BASED" },
  logging: { logLevel: "INFO", logToFile: true, logRetentionDays: 30, auditEnabled: true },
  reports: { autoGenerateDaily: true, autoGenerateWeekly: true, autoGenerateMonthly: true, exportFormat: ["PDF", "EXCEL"], emailReports: false },
  replay: { defaultSpeed: 1, maxSpeed: 10, enableIndicators: true, enableSignals: true },
  simulation: { defaultScenarios: ["BROKER_FAILURE", "FLASH_CRASH", "HIGH_SLIPPAGE"], stressTestCount: 10, monteCarloRuns: 1000 },
  backup: { autoBackup: true, backupFrequency: "DAILY", backupRetention: 30, cloudBackup: false },
  audit: { auditEnabled: true, auditRetention: 90, auditLevel: "DETAILED" },
};

// ─── State Type ─────────────────────────────────────────────────
interface InstitutionalState {
  strategyConfigs: Record<StrategyId, StrategyConfig>;
  strategyStates: Record<StrategyId, StrategyState>;
  portfolioRisk: PortfolioRiskState;
  cioState: AICIOState;
  executionState: ExecutionState;
  botHealth: BotHealthState;
  dashboard: DashboardState;
  marketIntel: MarketIntelligence;
  settings: PlatformSettings;
  isRunning: boolean;
  isEmergencyStop: boolean;
  paperTrading: boolean;
}

const initialState: InstitutionalState = {
  strategyConfigs: initStrategyConfigs(),
  strategyStates: initStrategyStates(),
  portfolioRisk: defaultPortfolioRisk,
  cioState: defaultCIOState,
  executionState: defaultExecutionState,
  botHealth: defaultBotHealth,
  dashboard: defaultDashboard,
  marketIntel: defaultMarketIntel,
  settings: defaultSettings,
  isRunning: false,
  isEmergencyStop: false,
  paperTrading: true,
};

// ─── Actions ────────────────────────────────────────────────────
type Action =
  | { type: "SET_STRATEGY_CONFIG"; id: StrategyId; config: Partial<StrategyConfig> }
  | { type: "TOGGLE_STRATEGY"; id: StrategyId }
  | { type: "ENABLE_STRATEGY"; id: StrategyId }
  | { type: "DISABLE_STRATEGY"; id: StrategyId }
  | { type: "PAUSE_STRATEGY"; id: StrategyId }
  | { type: "RESUME_STRATEGY"; id: StrategyId }
  | { type: "SET_PORTFOLIO_RISK"; risk: Partial<PortfolioRiskState> }
  | { type: "ADD_RISK_BREACH"; breach: PortfolioRiskState["breaches"][0] }
  | { type: "RESOLVE_RISK_BREACH"; id: string }
  | { type: "SET_CIO"; cio: Partial<AICIOState> }
  | { type: "APPLY_CIO_REC"; id: string }
  | { type: "SET_EXECUTION"; exec: Partial<ExecutionState> }
  | { type: "SET_BOT_HEALTH"; health: Partial<BotHealthState> }
  | { type: "SET_DASHBOARD"; dash: Partial<DashboardState> }
  | { type: "ADD_ALERT"; alert: DashboardState["alerts"][0] }
  | { type: "ACK_ALERT"; id: string }
  | { type: "SET_MARKET_INTEL"; intel: Partial<MarketIntelligence> }
  | { type: "SET_SETTINGS"; settings: Partial<PlatformSettings> }
  | { type: "SET_RUNNING"; running: boolean }
  | { type: "SET_EMERGENCY"; stopped: boolean }
  | { type: "SET_PAPER"; paper: boolean }
  | { type: "EMERGENCY_STOP_ALL" }
  | { type: "RESET_EMERGENCY" }
  | { type: "START_ALL" }
  | { type: "STOP_ALL" };

// ─── Reducer ────────────────────────────────────────────────────
function reducer(state: InstitutionalState, action: Action): InstitutionalState {
  switch (action.type) {
    case "SET_STRATEGY_CONFIG": {
      const { id, config } = action;
      return {
        ...state,
        strategyConfigs: { ...state.strategyConfigs, [id]: { ...state.strategyConfigs[id], ...config } },
        strategyStates: { ...state.strategyStates, [id]: { ...state.strategyStates[id], config: { ...state.strategyStates[id].config, ...config } } },
      };
    }
    case "TOGGLE_STRATEGY": {
      const id = action.id;
      const enabled = !state.strategyConfigs[id].enabled;
      return {
        ...state,
        strategyConfigs: { ...state.strategyConfigs, [id]: { ...state.strategyConfigs[id], enabled } },
        strategyStates: { ...state.strategyStates, [id]: { ...state.strategyStates[id], config: { ...state.strategyStates[id].config, enabled }, status: enabled ? "ACTIVE" : "DISABLED" } },
      };
    }
    case "ENABLE_STRATEGY": {
      const id = action.id;
      return {
        ...state,
        strategyConfigs: { ...state.strategyConfigs, [id]: { ...state.strategyConfigs[id], enabled: true } },
        strategyStates: { ...state.strategyStates, [id]: { ...state.strategyStates[id], config: { ...state.strategyStates[id].config, enabled: true }, status: "ACTIVE" } },
      };
    }
    case "DISABLE_STRATEGY": {
      const id = action.id;
      return {
        ...state,
        strategyConfigs: { ...state.strategyConfigs, [id]: { ...state.strategyConfigs[id], enabled: false } },
        strategyStates: { ...state.strategyStates, [id]: { ...state.strategyStates[id], config: { ...state.strategyStates[id].config, enabled: false }, status: "DISABLED", isRunning: false } },
      };
    }
    case "PAUSE_STRATEGY": {
      const id = action.id;
      return { ...state, strategyStates: { ...state.strategyStates, [id]: { ...state.strategyStates[id], isPaused: true, status: "PAUSED" } } };
    }
    case "RESUME_STRATEGY": {
      const id = action.id;
      return { ...state, strategyStates: { ...state.strategyStates, [id]: { ...state.strategyStates[id], isPaused: false, status: "ACTIVE" } } };
    }
    case "SET_PORTFOLIO_RISK":
      return { ...state, portfolioRisk: { ...state.portfolioRisk, ...action.risk } };
    case "ADD_RISK_BREACH":
      return { ...state, portfolioRisk: { ...state.portfolioRisk, breaches: [...state.portfolioRisk.breaches, action.breach] } };
    case "RESOLVE_RISK_BREACH":
      return { ...state, portfolioRisk: { ...state.portfolioRisk, breaches: state.portfolioRisk.breaches.map((b) => b.id === action.id ? { ...b, resolved: true, resolvedAt: new Date().toISOString() } : b) } };
    case "SET_CIO":
      return { ...state, cioState: { ...state.cioState, ...action.cio } };
    case "APPLY_CIO_REC":
      return { ...state, cioState: { ...state.cioState, recommendations: state.cioState.recommendations.map((r) => r.id === action.id ? { ...r, applied: true, appliedAt: new Date().toISOString() } : r) } };
    case "SET_EXECUTION":
      return { ...state, executionState: { ...state.executionState, ...action.exec } };
    case "SET_BOT_HEALTH":
      return { ...state, botHealth: { ...state.botHealth, ...action.health } };
    case "SET_DASHBOARD":
      return { ...state, dashboard: { ...state.dashboard, ...action.dash } };
    case "ADD_ALERT":
      return { ...state, dashboard: { ...state.dashboard, alerts: [action.alert, ...state.dashboard.alerts].slice(0, 100) } };
    case "ACK_ALERT":
      return { ...state, dashboard: { ...state.dashboard, alerts: state.dashboard.alerts.map((a) => a.id === action.id ? { ...a, acknowledged: true } : a) } };
    case "SET_MARKET_INTEL":
      return { ...state, marketIntel: { ...state.marketIntel, ...action.intel } };
    case "SET_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case "SET_RUNNING":
      return { ...state, isRunning: action.running, dashboard: { ...state.dashboard, botStatus: action.running ? "RUNNING" : "STOPPED" } };
    case "SET_EMERGENCY":
      return { ...state, isEmergencyStop: action.stopped, dashboard: { ...state.dashboard, botStatus: action.stopped ? "EMERGENCY" : state.isRunning ? "RUNNING" : "STOPPED" } };
    case "SET_PAPER":
      return { ...state, paperTrading: action.paper };
    case "EMERGENCY_STOP_ALL": {
      const newStates = { ...state.strategyStates };
      for (const id of Object.keys(newStates) as StrategyId[]) {
        newStates[id] = { ...newStates[id], isRunning: false, status: "HALTED" };
      }
      return {
        ...state,
        isEmergencyStop: true, isRunning: false, strategyStates: newStates,
        dashboard: {
          ...state.dashboard,
          botStatus: "EMERGENCY", riskStatus: "CRITICAL",
          alerts: [{
            id: `emergency-${Date.now()}`, type: "CRITICAL", title: "EMERGENCY STOP ACTIVATED",
            message: "All strategies halted. Manual intervention required.",
            timestamp: new Date().toISOString(), acknowledged: false, source: "RISK_ENGINE",
          }, ...state.dashboard.alerts],
        },
      };
    }
    case "RESET_EMERGENCY":
      return { ...state, isEmergencyStop: false, dashboard: { ...state.dashboard, botStatus: state.isRunning ? "RUNNING" : "STOPPED", riskStatus: "HEALTHY" } };
    case "START_ALL": {
      const newStates = { ...state.strategyStates };
      for (const id of Object.keys(newStates) as StrategyId[]) {
        if (state.strategyConfigs[id].enabled) {
          newStates[id] = { ...newStates[id], isRunning: true, status: "ACTIVE" };
        }
      }
      return { ...state, isRunning: true, strategyStates: newStates, dashboard: { ...state.dashboard, botStatus: "RUNNING", runningStrategies: Object.values(newStates).filter((s) => s.isRunning).length } };
    }
    case "STOP_ALL": {
      const newStates = { ...state.strategyStates };
      for (const id of Object.keys(newStates) as StrategyId[]) {
        newStates[id] = { ...newStates[id], isRunning: false, status: "PAUSED" };
      }
      return { ...state, isRunning: false, strategyStates: newStates, dashboard: { ...state.dashboard, botStatus: "STOPPED", runningStrategies: 0 } };
    }
    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────
interface ContextValue {
  state: InstitutionalState;
  dispatch: React.Dispatch<Action>;
}

const InstitutionalContext = createContext<ContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────
export function InstitutionalProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return (
    <InstitutionalContext.Provider value={value}>
      {children}
    </InstitutionalContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────
export function useInstitutionalStore() {
  const ctx = useContext(InstitutionalContext);
  if (!ctx) throw new Error("useInstitutionalStore must be used within InstitutionalProvider");
  const { state, dispatch } = ctx;

  return {
    state,
    dispatch,

    // Strategy actions
    setStrategyConfig: useCallback((id: StrategyId, config: Partial<StrategyConfig>) => dispatch({ type: "SET_STRATEGY_CONFIG", id, config }), [dispatch]),
    toggleStrategy: useCallback((id: StrategyId) => dispatch({ type: "TOGGLE_STRATEGY", id }), [dispatch]),
    enableStrategy: useCallback((id: StrategyId) => dispatch({ type: "ENABLE_STRATEGY", id }), [dispatch]),
    disableStrategy: useCallback((id: StrategyId) => dispatch({ type: "DISABLE_STRATEGY", id }), [dispatch]),
    pauseStrategy: useCallback((id: StrategyId) => dispatch({ type: "PAUSE_STRATEGY", id }), [dispatch]),
    resumeStrategy: useCallback((id: StrategyId) => dispatch({ type: "RESUME_STRATEGY", id }), [dispatch]),

    // Risk actions
    setPortfolioRisk: useCallback((risk: Partial<PortfolioRiskState>) => dispatch({ type: "SET_PORTFOLIO_RISK", risk }), [dispatch]),
    addRiskBreach: useCallback((breach: PortfolioRiskState["breaches"][0]) => dispatch({ type: "ADD_RISK_BREACH", breach }), [dispatch]),
    resolveRiskBreach: useCallback((id: string) => dispatch({ type: "RESOLVE_RISK_BREACH", id }), [dispatch]),

    // CIO actions
    setCIOState: useCallback((cio: Partial<AICIOState>) => dispatch({ type: "SET_CIO", cio }), [dispatch]),
    applyCIORecommendation: useCallback((id: string) => dispatch({ type: "APPLY_CIO_REC", id }), [dispatch]),

    // Other actions
    setExecutionState: useCallback((exec: Partial<ExecutionState>) => dispatch({ type: "SET_EXECUTION", exec }), [dispatch]),
    setBotHealth: useCallback((health: Partial<BotHealthState>) => dispatch({ type: "SET_BOT_HEALTH", health }), [dispatch]),
    setDashboard: useCallback((dash: Partial<DashboardState>) => dispatch({ type: "SET_DASHBOARD", dash }), [dispatch]),
    addAlert: useCallback((alert: DashboardState["alerts"][0]) => dispatch({ type: "ADD_ALERT", alert }), [dispatch]),
    acknowledgeAlert: useCallback((id: string) => dispatch({ type: "ACK_ALERT", id }), [dispatch]),
    setMarketIntel: useCallback((intel: Partial<MarketIntelligence>) => dispatch({ type: "SET_MARKET_INTEL", intel }), [dispatch]),
    setSettings: useCallback((settings: Partial<PlatformSettings>) => dispatch({ type: "SET_SETTINGS", settings }), [dispatch]),

    // Platform actions
    setRunning: useCallback((running: boolean) => dispatch({ type: "SET_RUNNING", running }), [dispatch]),
    setEmergencyStop: useCallback((stopped: boolean) => dispatch({ type: "SET_EMERGENCY", stopped }), [dispatch]),
    setPaperTrading: useCallback((paper: boolean) => dispatch({ type: "SET_PAPER", paper }), [dispatch]),
    emergencyStopAll: useCallback(() => dispatch({ type: "EMERGENCY_STOP_ALL" }), [dispatch]),
    resetEmergencyStop: useCallback(() => dispatch({ type: "RESET_EMERGENCY" }), [dispatch]),
    startAllStrategies: useCallback(() => dispatch({ type: "START_ALL" }), [dispatch]),
    stopAllStrategies: useCallback(() => dispatch({ type: "STOP_ALL" }), [dispatch]),

    // Derived selectors
    enabledStrategies: useCallback(() => (Object.keys(state.strategyConfigs) as StrategyId[]).filter((id) => state.strategyConfigs[id].enabled), [state.strategyConfigs]),
    totalAllocation: useCallback(() => (Object.values(state.strategyConfigs) as StrategyConfig[]).filter((c) => c.enabled).reduce((sum, c) => sum + c.capitalAllocationPercent, 0), [state.strategyConfigs]),
    activeStrategyCount: useCallback(() => (Object.values(state.strategyConfigs) as StrategyConfig[]).filter((c) => c.enabled).length, [state.strategyConfigs]),
  };
}