/**
 * TradingOS — Institutional Grade Autonomous Trading Platform
 * Core Type Definitions
 *
 * Philosophy: "I do not trade. I supervise."
 */

// ─────────────────────────────────────────────────────────────────
// STRATEGY SYSTEM
// ─────────────────────────────────────────────────────────────────

export type StrategyId =
  | "EMA5"
  | "EMA5_OPTION";

export interface StrategyDefinition {
  id: StrategyId;
  name: string;
  description: string;
  category: "TREND_FOLLOWING" | "OPTION";
  author?: string;
  version: string;
  parameters: StrategyParameter[];
  supportedTimeframes: string[];
  supportedInstruments: string[];
  minConfidence: number;
  defaultAllocation: number; // % of portfolio
}

export interface StrategyParameter {
  name: string;
  type: "number" | "boolean" | "string" | "select";
  label: string;
  description: string;
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
}

export interface StrategyConfig {
  strategyId: StrategyId;
  enabled: boolean;
  capitalAllocationPercent: number; // 0-100
  riskPercent: number;
  maxTrades: number;
  maxConsecutiveLosses: number;
  tradingSession: "FULL" | "MORNING" | "AFTERNOON" | "CUSTOM";
  customSessionStart?: string; // HH:mm
  customSessionEnd?: string; // HH:mm
  allowedSymbols: string[];
  allowedExpiry: "WEEKLY" | "MONTHLY" | "BOTH";
  allowedDays: number[]; // 0-6, 0 = Sunday
  maxDrawdown: number; // %
  dailyLossLimit: number; // absolute
  cooldownAfterLoss: number; // minutes
  confidenceThreshold: number; // 0-1
  priority: number; // 1-10
  executionWeight: number; // 0-1
  parameters: Record<string, number | boolean | string>;
}

export interface StrategyState {
  config: StrategyConfig;
  isRunning: boolean;
  isPaused: boolean;
  positions: StrategyPosition[];
  todayTrades: number;
  todayPnL: number;
  winRate: number;
  drawdown: number;
  dailyRiskUsed: number;
  signalsGenerated: number;
  signalsExecuted: number;
  signalsRejected: number;
  lastTradeTime: string | null;
  cooldownUntil: string | null;
  status: "ACTIVE" | "PAUSED" | "COOLDOWN" | "HALTED" | "DISABLED";
  version: string;
}

export interface StrategyPosition {
  id: string;
  strategyId: StrategyId;
  symbol: string;
  optionSymbol?: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice?: number;
  qty: number;
  sl: number;
  target: number;
  currentSL?: number;
  entryTime: string;
  exitTime?: string;
  exitReason?: string;
  pnl: number;
  pnlPercent: number;
  barsHeld: number;
  status: "OPEN" | "CLOSED";
  aiReasoning?: AIReasoningReport;
  tradeGrade?: TradeGrade;
}

// ─────────────────────────────────────────────────────────────────
// AI DECISION ENGINE
// ─────────────────────────────────────────────────────────────────

export interface AIReasoningReport {
  confidence: number; // 0-1
  probability: number; // 0-1
  reason: string;
  trendStrength: number;
  volumeConfirmation: boolean;
  oiConfirmation: boolean;
  pcrConfirmation: boolean;
  vwapConfirmation: boolean;
  atrConfirmation: boolean;
  volatility: number;
  marketStructure: string;
  liquidity: string;
  timeOfDay: string;
  marketRegime: MarketRegime;
  riskReward: number;
  expectedProfit: number;
  expectedLoss: number;
  suggestedPositionSize: number;
  tradeGrade: TradeGrade;
  factors: AIReasoningFactor[];
  warnings: string[];
  timestamp: string;
}

export interface AIReasoningFactor {
  name: string;
  score: number; // 0-1
  weight: number;
  description: string;
  passed: boolean;
}

export type TradeGrade = "A+" | "A" | "B" | "C" | "REJECT";

export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "SIDEWAYS"
  | "VOLATILE"
  | "LOW_VOLATILITY"
  | "GAP_DAY"
  | "EXPIRY_DAY"
  | "EVENT_DAY";

// ─────────────────────────────────────────────────────────────────
// AI CHIEF INVESTMENT OFFICER
// ─────────────────────────────────────────────────────────────────

export interface AICIOState {
  currentRegime: MarketRegime;
  regimeConfidence: number;
  lastRegimeChange: string;
  recommendations: CIORecommendation[];
  activeAdjustments: CIOAdjustment[];
  marketContext: MarketContext;
  performanceForecast: PerformanceForecast;
}

export interface CIORecommendation {
  id: string;
  type: "INCREASE_ALLOCATION" | "REDUCE_ALLOCATION" | "PAUSE_STRATEGY" | "RESUME_STRATEGY" | "ADJUST_CONFIDENCE" | "REDUCE_POSITION_SIZE";
  strategyId?: StrategyId;
  targetValue: number;
  reason: string;
  urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  timestamp: string;
  applied: boolean;
  appliedAt?: string;
}

export interface CIOAdjustment {
  id: string;
  type: string;
  strategyId?: StrategyId;
  oldValue: number;
  newValue: number;
  reason: string;
  timestamp: string;
}

export interface MarketContext {
  advanceDeclineRatio: number;
  sectorStrength: Record<string, number>;
  marketBreadth: number;
  indexStrength: number;
  vixLevel: number;
  vixTrend: "RISING" | "FALLING" | "STABLE";
  oiBuildup: "LONG" | "SHORT" | "MIXED";
  pcrTrend: "RISING" | "FALLING" | "STABLE";
  unusualActivity: boolean;
}

export interface PerformanceForecast {
  expectedReturn: number;
  expectedVolatility: number;
  expectedDrawdown: number;
  winProbability: number;
  sharpeEstimate: number;
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────
// PORTFOLIO RISK ENGINE
// ─────────────────────────────────────────────────────────────────

export interface PortfolioRiskState {
  totalExposure: number;
  portfolioDrawdown: number;
  dailyRiskUsed: number;
  capitalUtilized: number;
  strategyExposure: Record<StrategyId, number>;
  directionalExposure: number; // net long/short
  deltaExposure: number;
  gammaExposure: number;
  thetaExposure: number;
  vegaExposure: number;
  netPremiumRisk: number;
  maxPortfolioLoss: number;
  maxDailyLoss: number;
  maxWeeklyLoss: number;
  maxMonthlyLoss: number;
  var95: number; // Value at Risk
  var99: number;
  beta: number;
  correlationMatrix: Record<string, Record<string, number>>;
  stressTestResults: StressTestResult[];
  limits: RiskLimits;
  breaches: RiskBreach[];
}

export interface RiskLimits {
  maxPortfolioDrawdown: number;
  maxDailyLoss: number;
  maxWeeklyLoss: number;
  maxMonthlyLoss: number;
  maxStrategyConcentration: number;
  maxDirectionalExposure: number;
  maxDeltaExposure: number;
  maxGammaExposure: number;
  maxVegaExposure: number;
  maxTotalPositions: number;
  maxSinglePositionSize: number;
}

export interface RiskBreach {
  id: string;
  type: string;
  severity: "WARNING" | "CRITICAL" | "EMERGENCY";
  description: string;
  value: number;
  limit: number;
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
  actionTaken: string;
}

export interface StressTestResult {
  scenario: string;
  description: string;
  estimatedLoss: number;
  estimatedDrawdown: number;
  portfolioImpact: number;
  worstAffectedStrategy: StrategyId;
  pass: boolean;
}

// ─────────────────────────────────────────────────────────────────
// MARKET INTELLIGENCE
// ─────────────────────────────────────────────────────────────────

export interface MarketIntelligence {
  advanceDecline: AdvanceDeclineData;
  sectorStrength: SectorStrengthData[];
  marketBreadth: MarketBreadthData;
  indexStrength: IndexStrengthData[];
  oiHeatmap: OIHeatmapData;
  oiShift: OIShiftData;
  pcr: PCRData;
  maxPain: MaxPainData;
  expectedMove: ExpectedMoveData;
  ivRank: IVRankData;
  ivPercentile: IVPercentileData;
  ivSmile: IVSmileData;
  gammaExposure: GammaExposureData;
  dealerPositioning: DealerPositioningData;
  blockTrades: BlockTrade[];
  unusualOptionActivity: UnusualOptionActivity[];
  volumeSpikes: VolumeSpike[];
  institutionalFlow: InstitutionalFlowData;
  oiBuildup: OIBuildupData;
  oiUnwinding: OIUnwindingData;
  lastUpdated: string;
}

export interface AdvanceDeclineData {
  advances: number;
  declines: number;
  unchanged: number;
  ratio: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
}

export interface SectorStrengthData {
  sector: string;
  strength: number; // -1 to 1
  change: number;
  volumeRatio: number;
  leaders: string[];
}

export interface MarketBreadthData {
  above20EMA: number;
  above50EMA: number;
  above200EMA: number;
  newHighs: number;
  newLows: number;
  mcClellanOscillator: number;
  bullishPercent: number;
}

export interface IndexStrengthData {
  index: string;
  spot: number;
  change: number;
  changePercent: number;
  oi: number;
  oiChange: number;
  pcr: number;
  vix: number;
  ivRank: number;
  trend: string;
}

export interface OIHeatmapData {
  strikes: number[];
  callOI: number[];
  putOI: number[];
  callOIChange: number[];
  putOIChange: number[];
  maxPainStrike: number;
  timestamp: string;
}

export interface OIShiftData {
  strike: number;
  callShift: number;
  putShift: number;
  netShift: number;
  significance: "HIGH" | "MEDIUM" | "LOW";
}

export interface PCRData {
  current: number;
  change: number;
  percentile: number;
  trend: string;
  interpretation: string;
}

export interface MaxPainData {
  strike: number;
  painValue: number;
  nearestStrikes: { strike: number; pain: number }[];
}

export interface ExpectedMoveData {
  move: number;
  movePercent: number;
  upperBound: number;
  lowerBound: number;
  confidence: number;
}

export interface IVRankData {
  current: number;
  rank: number;
  historicalRange: [number, number];
}

export interface IVPercentileData {
  current: number;
  percentile: number;
  lookbackDays: number;
}

export interface IVSmileData {
  strikes: number[];
  ivValues: number[];
  atmIv: number;
  skew: number;
}

export interface GammaExposureData {
  totalGamma: number;
  gammaByStrike: Record<number, number>;
  zeroGammaLevel: number;
  flipPoint: number;
  estimatedHedgeDelta: number;
}

export interface DealerPositioningData {
  netDelta: number;
  netGamma: number;
  hedgeDirection: "LONG" | "SHORT" | "NEUTRAL";
  estimatedPnl: number;
}

export interface BlockTrade {
  id: string;
  symbol: string;
  quantity: number;
  price: number;
  value: number;
  side: "BUY" | "SELL";
  timestamp: string;
  significance: "HIGH" | "MEDIUM" | "LOW";
}

export interface UnusualOptionActivity {
  symbol: string;
  strike: number;
  expiry: string;
  type: "CE" | "PE";
  volume: number;
  oi: number;
  volumeOiRatio: number;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  timestamp: string;
}

export interface VolumeSpike {
  symbol: string;
  currentVolume: number;
  averageVolume: number;
  ratio: number;
  timestamp: string;
}

export interface InstitutionalFlowData {
  netFiiCash: number;
  netDiiCash: number;
  netFiiFno: number;
  netClientFno: number;
  fiiIndexLong: number;
  fiiIndexShort: number;
  fiiStockLong: number;
  fiiStockShort: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
}

export interface OIBuildupData {
  symbol: string;
  strike: number;
  type: "CE" | "PE";
  oiChange: number;
  priceChange: number;
  interpretation: "LONG_BUILDUP" | "SHORT_BUILDUP" | "LONG_UNWINDING" | "SHORT_COVERING";
  timestamp: string;
}

export interface OIUnwindingData {
  symbol: string;
  strike: number;
  type: "CE" | "PE";
  oiChange: number;
  priceChange: number;
  interpretation: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────
// EXECUTION ENGINE
// ─────────────────────────────────────────────────────────────────

export interface ExecutionState {
  activeOrders: ActiveOrder[];
  pendingOrders: PendingOrder[];
  rejectedOrders: RejectedOrder[];
  retryQueue: RetryQueueItem[];
  executionLogs: ExecutionLog[];
  stats: ExecutionStats;
  brokerHealth: BrokerHealth;
  exchangeHealth: ExchangeHealth;
}

export interface ActiveOrder {
  id: string;
  strategyId: StrategyId;
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | "SL" | "SL-M";
  qty: number;
  price: number;
  stopPrice?: number;
  status: "PENDING" | "PARTIAL" | "FILLED" | "REJECTED" | "CANCELLED";
  filledQty: number;
  avgFillPrice: number;
  placedAt: string;
  lastUpdated: string;
  retryCount: number;
  slippage: number;
  executionLatency: number;
  brokerOrderId?: string;
}

export interface PendingOrder {
  id: string;
  orderId: string;
  symbol: string;
  status: string;
  placedAt: string;
}

export interface RejectedOrder {
  id: string;
  orderId: string;
  symbol: string;
  reason: string;
  retryEligible: boolean;
  rejectedAt: string;
}

export interface RetryQueueItem {
  orderId: string;
  symbol: string;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: string;
  reason: string;
}

export interface ExecutionLog {
  id: string;
  timestamp: string;
  type: "ORDER_PLACED" | "ORDER_FILLED" | "ORDER_REJECTED" | "ORDER_RETRY" | "ORDER_CANCELLED" | "SLIPPAGE_ALERT" | "PARTIAL_FILL";
  orderId: string;
  symbol: string;
  details: Record<string, unknown>;
}

export interface ExecutionStats {
  totalOrders: number;
  filledOrders: number;
  rejectedOrders: number;
  retriedOrders: number;
  avgFillPrice: number;
  avgSlippage: number;
  avgExecutionLatency: number;
  executionScore: number; // 0-100
  partialFillRate: number;
  rejectionRate: number;
}

export interface BrokerHealth {
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  ping: number;
  lastSuccess: string;
  errorRate: number;
  reconnectCount: number;
}

export interface ExchangeHealth {
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  lastTick: string;
  tickLag: number;
}

// ─────────────────────────────────────────────────────────────────
// BOT HEALTH
// ─────────────────────────────────────────────────────────────────

export interface BotHealthState {
  overallStatus: "HEALTHY" | "DEGRADED" | "CRITICAL";
  healthScore: number; // 0-100
  components: BotHealthComponent[];
  lastUpdated: string;
}

export interface BotHealthComponent {
  name: string;
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  metric: string;
  value: number;
  threshold: number;
  trend: "IMPROVING" | "STABLE" | "DEGRADING";
}

export interface SystemMetrics {
  cpuUsage: number;
  ramUsage: number;
  diskUsage: number;
  latency: number;
  brokerLatency: number;
  exchangeLatency: number;
  websocketLatency: number;
  signalQueueSize: number;
  executionQueueSize: number;
  pendingOrders: number;
  rejectedOrders: number;
  disconnectCount: number;
  reconnectCount: number;
  databaseHealth: "HEALTHY" | "DEGRADED" | "DOWN";
  apiHealth: "HEALTHY" | "DEGRADED" | "DOWN";
  websocketHealth: "HEALTHY" | "DEGRADED" | "DOWN";
  lastError: string | null;
  uptime: number;
}

// ─────────────────────────────────────────────────────────────────
// AI TRADE REVIEW
// ─────────────────────────────────────────────────────────────────

export interface TradeReview {
  id: string;
  tradeId: string;
  strategyId: StrategyId;
  grade: TradeGrade;
  entryQuality: number; // 0-100
  exitQuality: number; // 0-100
  executionQuality: number; // 0-100
  riskManagement: number; // 0-100
  mistakes: TradeMistake[];
  suggestions: string[];
  chartSnapshot?: string;
  replayData?: TradeReplayData;
  reasoning: string;
  confidence: number;
  expectedOutcome: number;
  actualOutcome: number;
  variance: number;
  aiComments: string;
  tags: string[];
  timestamp: string;
}

export interface TradeMistake {
  type: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  impact: number;
}

export interface TradeReplayData {
  candles: CandleData[];
  indicators: Record<string, number[]>;
  signals: SignalPoint[];
  entries: EntryPoint[];
  exits: ExitPoint[];
}

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SignalPoint {
  time: string;
  price: number;
  type: string;
  confidence: number;
}

export interface EntryPoint {
  time: string;
  price: number;
  qty: number;
}

export interface ExitPoint {
  time: string;
  price: number;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────
// REPORTING
// ─────────────────────────────────────────────────────────────────

export interface PerformanceReport {
  id: string;
  period: string;
  generatedAt: string;
  portfolioSummary: PortfolioSummary;
  strategyReports: StrategyPerformanceReport[];
  riskMetrics: RiskMetrics;
  executionMetrics: ExecutionMetrics;
  tradeDistribution: TradeDistribution;
  timeAnalysis: TimeAnalysis;
  comparisons: ComparisonData[];
}

export interface PortfolioSummary {
  startingCapital: number;
  endingCapital: number;
  totalReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  recoveryFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  sqn: number;
  avgHoldingTime: number;
  equityCurve: EquityPoint[];
}

export interface StrategyPerformanceReport {
  strategyId: StrategyId;
  totalTrades: number;
  winRate: number;
  totalPnL: number;
  maxDrawdown: number;
  profitFactor: number;
  sharpeRatio: number;
  avgHoldingTime: number;
  mae: number; // Maximum Adverse Excursion
  mfe: number; // Maximum Favorable Excursion
  gradeDistribution: Record<TradeGrade, number>;
}

export interface RiskMetrics {
  var95: number;
  var99: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  avgDrawdown: number;
  drawdownDuration: number;
  ulcerIndex: number;
  painRatio: number;
}

export interface ExecutionMetrics {
  avgSlippage: number;
  avgLatency: number;
  fillRate: number;
  partialFillRate: number;
  rejectionRate: number;
  executionScore: number;
}

export interface TradeDistribution {
  byHour: Record<number, { trades: number; winRate: number; pnl: number }>;
  byWeekday: Record<string, { trades: number; winRate: number; pnl: number }>;
  byMonth: Record<string, { trades: number; winRate: number; pnl: number }>;
  byStrategy: Record<StrategyId, { trades: number; winRate: number; pnl: number }>;
  byGrade: Record<TradeGrade, { trades: number; winRate: number; pnl: number }>;
}

export interface TimeAnalysis {
  bestHour: number;
  worstHour: number;
  bestWeekday: string;
  worstWeekday: string;
  bestMonth: string;
  worstMonth: string;
  seasonalityScore: number;
}

export interface ComparisonData {
  metric: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
  drawdown: number;
}

// ─────────────────────────────────────────────────────────────────
// JOURNAL
// ─────────────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  date: string;
  tradeId: string;
  strategyId: StrategyId;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPercent: number;
  screenshot?: string;
  chartImage?: string;
  indicators: string[];
  reason: string;
  confidence: number;
  execution: string;
  risk: string;
  exit: string;
  profit: string;
  lessons: string;
  aiComments: string;
  tags: string[];
  grade: TradeGrade;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────
// REPLAY & SIMULATION
// ─────────────────────────────────────────────────────────────────

export interface ReplayState {
  isPlaying: boolean;
  currentDate: string;
  currentTime: string;
  speed: number; // 1x, 2x, 5x, 10x
  currentCandle: number;
  totalCandles: number;
  strategyStates: Record<StrategyId, StrategyState>;
  visibleSignals: SignalPoint[];
  visibleTrades: TradeReview[];
}

export interface SimulationConfig {
  name: string;
  scenario: SimulationScenario;
  duration: number; // days
  startDate: string;
  strategies: StrategyId[];
  parameters: Record<string, unknown>;
}

export type SimulationScenario =
  | "BROKER_FAILURE"
  | "INTERNET_FAILURE"
  | "EXCHANGE_FAILURE"
  | "ORDER_REJECTION"
  | "HIGH_LATENCY"
  | "HIGH_SLIPPAGE"
  | "GAP_UP"
  | "GAP_DOWN"
  | "FLASH_CRASH"
  | "HOLIDAY"
  | "HALF_DAY"
  | "LOW_LIQUIDITY";

export interface SimulationResult {
  id: string;
  config: SimulationConfig;
  portfolioSummary: PortfolioSummary;
  riskBreaches: RiskBreach[];
  strategySurvival: Record<StrategyId, boolean>;
  recoveryTime: number;
  maxDrawdownDuring: number;
  lessons: string[];
}

// ─────────────────────────────────────────────────────────────────
// NATURAL LANGUAGE COMMAND CENTER
// ─────────────────────────────────────────────────────────────────

export interface NLQuery {
  id: string;
  query: string;
  intent: string;
  entities: Record<string, string>;
  filters: QueryFilter[];
  timeRange?: { from: string; to: string };
  generatedSql?: string;
  result: unknown;
  confidence: number;
  executionTime: number;
  timestamp: string;
}

export interface QueryFilter {
  field: string;
  operator: "eq" | "gt" | "lt" | "gte" | "lte" | "in" | "between";
  value: unknown;
}

// ─────────────────────────────────────────────────────────────────
// STRATEGY VERSIONING
// ─────────────────────────────────────────────────────────────────

export interface StrategyVersion {
  id: string;
  strategyId: StrategyId;
  version: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  performance: PortfolioSummary;
  createdAt: string;
  createdBy: string;
  isActive: boolean;
  rollbackTarget?: string;
  changeHistory: VersionChange[];
}

export interface VersionChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────

export interface DashboardState {
  portfolioPnL: number;
  strategyPnL: Record<StrategyId, number>;
  botStatus: "RUNNING" | "STOPPED" | "EMERGENCY";
  riskStatus: "HEALTHY" | "WARNING" | "CRITICAL";
  capitalUsed: number;
  capitalTotal: number;
  todaysTrades: number;
  dailyLimit: number;
  brokerStatus: BrokerHealth;
  exchangeStatus: ExchangeHealth;
  marketStatus: "OPEN" | "CLOSED" | "PRE_OPEN" | "POST_CLOSE";
  signalQueue: number;
  executionQueue: number;
  runningStrategies: number;
  pausedStrategies: number;
  healthScore: number;
  executionScore: number;
  currentMarketRegime: MarketRegime;
  aiCioRecommendation: string;
  alerts: DashboardAlert[];
  warnings: DashboardAlert[];
  recentLogs: string[];
}

export interface DashboardAlert {
  id: string;
  type: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL";
  title: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  source: string;
}

// ─────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────

export interface PlatformSettings {
  broker: BrokerSettings;
  risk: RiskSettings;
  capital: CapitalSettings;
  strategies: StrategySettings;
  sessions: TradingSessionSettings;
  notifications: NotificationSettings;
  paperTrading: PaperTradingSettings;
  emergencyStop: EmergencySettings;
  execution: ExecutionSettings;
  aiEngine: AIEngineSettings;
  logging: LoggingSettings;
  reports: ReportSettings;
  replay: ReplaySettings;
  simulation: SimulationSettings;
  backup: BackupSettings;
  audit: AuditSettings;
}

export interface BrokerSettings {
  broker: "FYERS" | "ZERODHA" | "ANGEL_ONE" | "ALICE_BLUE";
  apiKey: string;
  apiSecret: string;
  redirectUrl: string;
  defaultExchange: string;
  enableRateLimiting: boolean;
}

export interface RiskSettings {
  maxDailyLoss: number;
  maxWeeklyLoss: number;
  maxMonthlyLoss: number;
  maxDrawdown: number;
  maxConsecutiveLosses: number;
  maxOpenPositions: number;
  maxSinglePositionSize: number;
  maxPortfolioConcentration: number;
  enableCircuitBreakers: boolean;
  enableTrailingStop: boolean;
  trailingStopType: "PERCENT" | "ATR" | "POINTS";
  trailingStopValue: number;
}

export interface CapitalSettings {
  totalCapital: number;
  reservePercent: number;
  maxUtilization: number;
  rebalancingFrequency: "DAILY" | "WEEKLY" | "MONTHLY";
  compoundProfits: boolean;
}

export interface StrategySettings {
  defaultAllocation: number;
  minConfidence: number;
  enableAutoPause: boolean;
  autoPauseThreshold: number;
  strategyCooldown: number;
}

export interface TradingSessionSettings {
  preMarket: boolean;
  regularSession: boolean;
  postMarket: boolean;
  customSessions: CustomSession[];
}

export interface CustomSession {
  name: string;
  start: string;
  end: string;
  enabled: boolean;
}

export interface NotificationSettings {
  email: boolean;
  sms: boolean;
  webhook: boolean;
  webhookUrl: string;
  alertOnTrade: boolean;
  alertOnRisk: boolean;
  alertOnError: boolean;
  alertOnDailySummary: boolean;
}

export interface PaperTradingSettings {
  enabled: boolean;
  virtualCapital: number;
  mirrorLivePrices: boolean;
  slippageSimulation: number;
}

export interface EmergencySettings {
  enableEmergencyStop: boolean;
  emergencyContact: string;
  autoSquareOff: boolean;
  autoSquareOffTime: string;
}

export interface ExecutionSettings {
  orderType: "LIMIT" | "MARKET" | "HYBRID";
  limitBuffer: number;
  smartRetry: boolean;
  maxRetries: number;
  retryDelay: number;
  orderSplitting: boolean;
  maxOrderSize: number;
  slippageProtection: boolean;
  maxSlippage: number;
}

export interface AIEngineSettings {
  enableAIReasoning: boolean;
  enableCIO: boolean;
  enableTradeReview: boolean;
  enableSelfImprovement: boolean;
  confidenceThreshold: number;
  minTradeGrade: TradeGrade;
  modelType: "RULE_BASED" | "ML_ENSEMBLE" | "LLM";
}

export interface LoggingSettings {
  logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  logToFile: boolean;
  logRetentionDays: number;
  auditEnabled: boolean;
}

export interface ReportSettings {
  autoGenerateDaily: boolean;
  autoGenerateWeekly: boolean;
  autoGenerateMonthly: boolean;
  exportFormat: ("PDF" | "EXCEL" | "CSV")[];
  emailReports: boolean;
}

export interface ReplaySettings {
  defaultSpeed: number;
  maxSpeed: number;
  enableIndicators: boolean;
  enableSignals: boolean;
}

export interface SimulationSettings {
  defaultScenarios: SimulationScenario[];
  stressTestCount: number;
  monteCarloRuns: number;
}

export interface BackupSettings {
  autoBackup: boolean;
  backupFrequency: "HOURLY" | "DAILY" | "WEEKLY";
  backupRetention: number;
  cloudBackup: boolean;
}

export interface AuditSettings {
  auditEnabled: boolean;
  auditRetention: number;
  auditLevel: "BASIC" | "DETAILED" | "FULL";
}
