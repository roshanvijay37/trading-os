/**
 * The app's page list — single source of truth for the sidebar (Layout), the page-title
 * header, and the global command palette. Keywords feed palette fuzzy search.
 */

import {
  BarChart3,
  BookOpen,
  Bot,
  CandlestickChart,
  LayoutDashboard,
  LineChart,
  Radar,
  Settings,
  ShieldCheck,
  Swords,
  TestTube,
  type LucideIcon,
} from "lucide-react";

export interface NavItemDef {
  to: string;
  label: string;
  icon: LucideIcon;
  group: string;
  keywords?: string;
}

export const navigation: NavItemDef[] = [
  { to: "/", label: "Command Center", icon: LayoutDashboard, group: "Operations", keywords: "dashboard home overview ai cio chat regime" },
  { to: "/trading-bot", label: "Trading Bot", icon: Bot, group: "Operations", keywords: "auto trade bot start stop emergency estop config paper" },
  { to: "/strategy-manager", label: "Strategies", icon: Swords, group: "Operations", keywords: "strategy manager allocation ema" },
  { to: "/chart", label: "Live Chart", icon: LineChart, group: "Operations", keywords: "candles price nifty banknifty sensex chart" },
  { to: "/options", label: "Options", icon: CandlestickChart, group: "Trading Desk", keywords: "options terminal chain workspace desk" },
  { to: "/backtest", label: "Backtest Lab", icon: TestTube, group: "Research", keywords: "backtest history simulate equity trades" },
  { to: "/market-intelligence", label: "Market Intel", icon: Radar, group: "Research", keywords: "pcr max pain vix iv rank breadth fii dii gex intelligence" },
  { to: "/risk-dashboard", label: "Risk Engine", icon: ShieldCheck, group: "Risk", keywords: "risk limits breaches stress exposure drawdown" },
  { to: "/journal", label: "Journal", icon: BookOpen, group: "Records", keywords: "trades journal log notes" },
  { to: "/reports", label: "Reports", icon: BarChart3, group: "Records", keywords: "reports performance discipline win rate" },
  { to: "/settings", label: "Settings", icon: Settings, group: "System", keywords: "settings capital risk percent limits" },
];
