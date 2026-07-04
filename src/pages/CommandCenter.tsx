/**
 * TradingOS — Command Center
 * Overview + Risk dashboard
 */

import { useState } from "react";
import { Flash, Stat, Tabs } from "../components/ui";
import { RiskDashboard } from "./RiskDashboard";
import { useInstitutionalStore } from "../store/InstitutionalProvider";
import {
  LayoutDashboard,
  Activity,
  TrendingUp,
  TrendingDown,
  Shield,
  Zap,
  Bot,
} from "lucide-react";

export function CommandCenter() {
  const { state } = useInstitutionalStore();
  const { dashboard, portfolioRisk } = state;

  const [activeTab, setActiveTab] = useState<"overview" | "risk">("overview");

  return (
    <div className="space-y-5">
      {/* Tab Switcher */}
      <Tabs
        tabs={[
          { id: "overview", label: "Overview", icon: LayoutDashboard },
          { id: "risk", label: "Risk", icon: Shield },
        ]}
        value={activeTab}
        onChange={(id) => setActiveTab(id as "overview" | "risk")}
      />

      {activeTab === "overview" ? (
        <div className="space-y-5">
          {/* Metric Row */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Bot Status"
              value={<Flash value={dashboard.botStatus}>{dashboard.botStatus}</Flash>}
              icon={Bot}
              tone={dashboard.botStatus === "RUNNING" ? "green" : "amber"}
            />
            <Stat
              label="Portfolio P&L"
              value={
                <Flash value={dashboard.portfolioPnL}>
                  {`${dashboard.portfolioPnL >= 0 ? "+" : ""}${dashboard.portfolioPnL.toFixed(2)}%`}
                </Flash>
              }
              icon={dashboard.portfolioPnL >= 0 ? TrendingUp : TrendingDown}
              tone={dashboard.portfolioPnL >= 0 ? "green" : "rose"}
            />
            <Stat
              label="Today's Trades"
              value={<Flash value={dashboard.todaysTrades}>{dashboard.todaysTrades}</Flash>}
              icon={Activity}
              tone="blue"
            />
            <Stat
              label="Risk Status"
              value={<Flash value={dashboard.riskStatus}>{dashboard.riskStatus}</Flash>}
              icon={Shield}
              tone={dashboard.riskStatus === "HEALTHY" ? "green" : dashboard.riskStatus === "WARNING" ? "amber" : "rose"}
            />
          </div>

          {/* Capital + Risk */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-panel border border-border bg-panel p-4">
              <p className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Capital Used</p>
              <p className="mt-1 font-mono text-lg font-semibold text-zinc-100">{dashboard.capitalUsed.toFixed(1)}%</p>
              <div className="mt-2 h-1 rounded-full bg-surface">
                <div className="h-full rounded-full bg-gain" style={{ width: `${Math.min(dashboard.capitalUsed, 100)}%` }} />
              </div>
            </div>
            <div className="rounded-panel border border-border bg-panel p-4">
              <p className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Daily Risk Used</p>
              <p className="mt-1 font-mono text-lg font-semibold text-zinc-100">{portfolioRisk.dailyRiskUsed.toFixed(1)}%</p>
              <div className="mt-2 h-1 rounded-full bg-surface">
                <div className="h-full rounded-full bg-warn" style={{ width: `${Math.min(portfolioRisk.dailyRiskUsed, 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Health + Execution */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-panel border border-border bg-panel p-4">
              <div className="flex items-center gap-2">
                <Activity size={12} className="text-zinc-600" />
                <h3 className="text-2xs font-medium uppercase tracking-wider text-zinc-500">Health Score</h3>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-mono text-2xl font-semibold text-gain">{dashboard.healthScore}</span>
                <span className="mb-1 text-2xs text-zinc-600">/ 100</span>
              </div>
            </div>
            <div className="rounded-panel border border-border bg-panel p-4">
              <div className="flex items-center gap-2">
                <Zap size={12} className="text-zinc-600" />
                <h3 className="text-2xs font-medium uppercase tracking-wider text-zinc-500">Execution Score</h3>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-mono text-2xl font-semibold text-gain">{dashboard.executionScore}</span>
                <span className="mb-1 text-2xs text-zinc-600">/ 100</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <RiskDashboard />
      )}
    </div>
  );
}
