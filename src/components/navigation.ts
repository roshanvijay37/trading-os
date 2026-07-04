/**
 * The app's page list — single source of truth for the sidebar (Layout), the page-title
 * header, and the global command palette. Keywords feed palette fuzzy search.
 */

import {
  BookOpen,
  Bot,
  CandlestickChart,
  LineChart,
  Radar,
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
  { to: "/", label: "Trading Bot", icon: Bot, group: "Operations", keywords: "auto trade bot start stop emergency estop config paper ema5t futures dashboard home" },
  { to: "/chart", label: "Live Chart", icon: LineChart, group: "Operations", keywords: "candles price nifty banknifty sensex chart" },
  { to: "/options", label: "Options", icon: CandlestickChart, group: "Trading Desk", keywords: "options terminal chain workspace desk" },
  { to: "/backtest", label: "Backtest Lab", icon: TestTube, group: "Research", keywords: "backtest history simulate equity trades" },
  { to: "/market-intelligence", label: "Market Intel", icon: Radar, group: "Research", keywords: "pcr max pain vix iv rank breadth fii dii gex intelligence" },
  { to: "/journal", label: "Journal", icon: BookOpen, group: "Records", keywords: "trades journal log notes reports performance discipline win rate" },
];
