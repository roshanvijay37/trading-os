/**
 * Pure mappers that turn the backend auto-trader status into the institutional
 * store's dashboard / portfolio-risk shapes. Kept pure (no React, no fetch) so the
 * derivation is unit-testable and the same logic feeds every store-backed page.
 */
import type { DashboardState, PortfolioRiskState } from "../types/institutional";

type MarketStatus = DashboardState["marketStatus"];

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * The backend reports a richer set of statuses (SATURDAY_CLOSED, HOLIDAY - X, ...);
 * collapse anything outside the dashboard union to CLOSED so the typed store stays valid.
 */
export function normalizeMarketStatus(s: unknown): MarketStatus {
  if (s === "OPEN" || s === "PRE_OPEN" || s === "POST_CLOSE") return s;
  return "CLOSED";
}

export interface LiveStatus {
  capital?: number | string;
  dailyPnL?: number | string;
  todayTrades?: number;
  consecutiveLosses?: number;
  isRunning?: boolean;
  emergencyStop?: boolean;
  marketStatus?: string;
  /** Daily-loss circuit-breaker as a % of capital. Defaults to the backend default (2%). */
  maxRiskPerDayPercent?: number;
  openPositions?: Array<{ avgFillPrice?: number; quantity?: number }>;
  health?: { healthScore?: number };
  executionStats?: { executionScore?: number };
}

export interface LiveMetrics {
  dashboard: Partial<DashboardState>;
  portfolioRisk: Partial<PortfolioRiskState>;
}

export function deriveLiveMetrics(status: LiveStatus): LiveMetrics {
  const capital = num(status.capital);
  const dailyPnL = num(status.dailyPnL);
  const open = Array.isArray(status.openPositions) ? status.openPositions : [];

  // Premium deployed across open option positions (price x qty).
  const totalExposure = open.reduce((s, p) => s + num(p.avgFillPrice) * num(p.quantity), 0);
  const capitalUtilized = capital > 0 ? clamp((totalExposure / capital) * 100, 0, 1000) : 0;
  const portfolioPnLPct = capital > 0 ? (dailyPnL / capital) * 100 : 0;

  // % of the daily-loss budget consumed (only losses count toward "risk used").
  const maxRiskPct = num(status.maxRiskPerDayPercent) || 2;
  const dailyLossLimit = capital * (maxRiskPct / 100);
  const dailyRiskUsed = dailyLossLimit > 0 ? clamp((Math.max(0, -dailyPnL) / dailyLossLimit) * 100, 0, 999) : 0;

  // Best-available intraday drawdown: today's loss as a % of capital.
  const portfolioDrawdown = capital > 0 ? Math.max(0, (-dailyPnL / capital) * 100) : 0;

  const botStatus: DashboardState["botStatus"] = status.emergencyStop
    ? "EMERGENCY"
    : status.isRunning
      ? "RUNNING"
      : "STOPPED";

  const riskStatus: DashboardState["riskStatus"] =
    dailyRiskUsed >= 100 ? "CRITICAL" : dailyRiskUsed >= 80 ? "WARNING" : "HEALTHY";

  const dashboard: Partial<DashboardState> = {
    botStatus,
    portfolioPnL: portfolioPnLPct,
    todaysTrades: num(status.todayTrades),
    riskStatus,
    capitalUsed: capitalUtilized,
    capitalTotal: capital,
    marketStatus: normalizeMarketStatus(status.marketStatus),
  };
  // Real health / execution scores from the backend — only set when present so an older
  // backend (without these fields) never clobbers them with undefined.
  if (status.health && Number.isFinite(Number(status.health.healthScore))) {
    dashboard.healthScore = Math.round(num(status.health.healthScore));
  }
  if (status.executionStats && Number.isFinite(Number(status.executionStats.executionScore))) {
    dashboard.executionScore = Math.round(num(status.executionStats.executionScore));
  }

  return {
    dashboard,
    portfolioRisk: {
      totalExposure,
      capitalUtilized,
      dailyRiskUsed,
      portfolioDrawdown,
    },
  };
}
