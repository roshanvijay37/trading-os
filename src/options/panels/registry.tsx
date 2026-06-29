/**
 * Panel registry — the single list the workspace shell renders from. Each entry binds a
 * panel id (used by the command palette / shortcuts) to its group, icon and component.
 * Order matters: the first entry is the default view and Alt+1..9 map to the first nine.
 */

import type { ComponentType } from "react";
import {
  LayoutDashboard, Gauge, Sparkles, ListTree, Sigma, Percent, Waves, Activity,
  Target, CalendarClock, Layers, Waypoints, Boxes, TrendingUp, Scale, Calculator,
  Wallet, ShieldAlert, Landmark, Receipt, Filter, LineChart, Bell, Star, History,
  type LucideIcon,
} from "lucide-react";

import { SummaryPanel } from "./SummaryPanel";
import { SentimentPanel } from "./SentimentPanel";
import { AiInsightsPanel } from "./AiInsightsPanel";
import { OptionChainPanel } from "./OptionChainPanel";
import { GreeksPanel } from "./GreeksPanel";
import { ProbabilityPanel } from "./ProbabilityPanel";
import { IvPanel } from "./IvPanel";
import { VolatilityPanel } from "./VolatilityPanel";
import { MaxPainPanel } from "./MaxPainPanel";
import { ExpiryPanel } from "./ExpiryPanel";
import { OiAnalyticsPanel } from "./OiAnalyticsPanel";
import { FlowPanel } from "./FlowPanel";
import { StrategyBuilderPanel } from "./StrategyBuilderPanel";
import { PayoffPanel } from "./PayoffPanel";
import { StrategyAnalyzerPanel } from "./StrategyAnalyzerPanel";
import { CalculatorsPanel } from "./CalculatorsPanel";
import { ScreenerPanel } from "./ScreenerPanel";
import { ChartsPanel } from "./ChartsPanel";
import { PositionsPanel } from "./PositionsPanel";
import { PortfolioRiskPanel } from "./PortfolioRiskPanel";
import { MarginPanel } from "./MarginPanel";
import { TradeTicketPanel } from "./TradeTicketPanel";
import { AlertsPanel } from "./AlertsPanel";
import { WatchlistPanel } from "./WatchlistPanel";
import { HistoricalPanel } from "./HistoricalPanel";

export type PanelGroup =
  | "Overview"
  | "Chain & Greeks"
  | "Volatility"
  | "OI & Flow"
  | "Strategy"
  | "Positions & Risk"
  | "Execution"
  | "Tools";

export interface PanelDef {
  id: string;
  label: string;
  group: PanelGroup;
  icon: LucideIcon;
  keywords?: string;
  Component: ComponentType;
}

export const PANEL_GROUPS: PanelGroup[] = [
  "Overview",
  "Chain & Greeks",
  "Volatility",
  "OI & Flow",
  "Strategy",
  "Positions & Risk",
  "Execution",
  "Tools",
];

export const PANELS: PanelDef[] = [
  { id: "summary", label: "Summary", group: "Overview", icon: LayoutDashboard, keywords: "institutional dashboard bias gex overview", Component: SummaryPanel },
  { id: "sentiment", label: "Sentiment", group: "Overview", icon: Gauge, keywords: "bullish bearish neutral", Component: SentimentPanel },
  { id: "ai-insights", label: "AI Insights", group: "Overview", icon: Sparkles, keywords: "observations reasoning ai", Component: AiInsightsPanel },

  { id: "option-chain", label: "Option Chain", group: "Chain & Greeks", icon: ListTree, keywords: "strikes ltp bid ask oi iv greeks", Component: OptionChainPanel },
  { id: "greeks", label: "Greeks", group: "Chain & Greeks", icon: Sigma, keywords: "delta gamma theta vega rho vanna charm", Component: GreeksPanel },
  { id: "probability", label: "Probability", group: "Chain & Greeks", icon: Percent, keywords: "itm otm touch distribution pop", Component: ProbabilityPanel },

  { id: "iv", label: "Implied Vol", group: "Volatility", icon: Waves, keywords: "iv smile skew rank percentile surface", Component: IvPanel },
  { id: "volatility", label: "Volatility", group: "Volatility", icon: Activity, keywords: "hv realized atr expected move", Component: VolatilityPanel },
  { id: "max-pain", label: "Max Pain", group: "Volatility", icon: Target, keywords: "max pain expiry zone", Component: MaxPainPanel },
  { id: "expiry", label: "Expiry", group: "Volatility", icon: CalendarClock, keywords: "weekly monthly theta decay gamma crush", Component: ExpiryPanel },

  { id: "oi-analytics", label: "OI Analytics", group: "OI & Flow", icon: Layers, keywords: "open interest buildup support resistance ladder heatmap pcr", Component: OiAnalyticsPanel },
  { id: "flow", label: "Option Flow", group: "OI & Flow", icon: Waypoints, keywords: "large trades premium flow fii dii smart money", Component: FlowPanel },

  { id: "strategy-builder", label: "Strategy Builder", group: "Strategy", icon: Boxes, keywords: "legs templates condor straddle spread", Component: StrategyBuilderPanel },
  { id: "payoff", label: "Payoff Analyzer", group: "Strategy", icon: TrendingUp, keywords: "payoff breakeven max profit loss", Component: PayoffPanel },
  { id: "strategy-analyzer", label: "Strategy Analyzer", group: "Strategy", icon: Scale, keywords: "risk reward pop roi margin expected value", Component: StrategyAnalyzerPanel },
  { id: "calculators", label: "Calculators", group: "Strategy", icon: Calculator, keywords: "black scholes binomial iv margin position size", Component: CalculatorsPanel },

  { id: "positions", label: "Positions", group: "Positions & Risk", icon: Wallet, keywords: "open positions pnl greeks", Component: PositionsPanel },
  { id: "portfolio-risk", label: "Portfolio Risk", group: "Positions & Risk", icon: ShieldAlert, keywords: "net greeks stress scenario gap risk", Component: PortfolioRiskPanel },
  { id: "margin", label: "Margin", group: "Positions & Risk", icon: Landmark, keywords: "available used span exposure simulator", Component: MarginPanel },

  { id: "trade-ticket", label: "Trade Ticket", group: "Execution", icon: Receipt, keywords: "buy sell order basket live", Component: TradeTicketPanel },
  { id: "screener", label: "Screener", group: "Execution", icon: Filter, keywords: "scan highest iv oi volume delta momentum", Component: ScreenerPanel },

  { id: "charts", label: "Charts", group: "Tools", icon: LineChart, keywords: "underlying premium oi iv pcr chart", Component: ChartsPanel },
  { id: "alerts", label: "Alerts", group: "Tools", icon: Bell, keywords: "price iv oi pcr alert", Component: AlertsPanel },
  { id: "watchlist", label: "Watchlist", group: "Tools", icon: Star, keywords: "favorite strikes contracts", Component: WatchlistPanel },
  { id: "historical", label: "Historical", group: "Tools", icon: History, keywords: "history playback iv oi premium", Component: HistoricalPanel },
];
