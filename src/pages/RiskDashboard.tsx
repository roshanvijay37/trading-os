/**
 * TradingOS — Portfolio Risk Dashboard
 * Institutional-grade risk monitoring
 */

import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { Badge, Panel, Row } from "../components/ui";
import { AlertTriangle, Shield, TrendingDown, Activity, DollarSign, BarChart3, Lock } from "lucide-react";

export function RiskDashboard() {
  const { state } = useInstitutionalStore();
  const { portfolioRisk, dashboard } = state;

  const riskMetrics = [
    { label: "Total Exposure", value: `₹${portfolioRisk.totalExposure.toLocaleString()}`, icon: DollarSign, status: portfolioRisk.totalExposure > portfolioRisk.limits.maxDirectionalExposure * 10000 ? "critical" : "healthy" },
    { label: "Portfolio Drawdown", value: `${portfolioRisk.portfolioDrawdown.toFixed(2)}%`, icon: TrendingDown, status: portfolioRisk.portfolioDrawdown > portfolioRisk.limits.maxPortfolioDrawdown ? "critical" : portfolioRisk.portfolioDrawdown > 5 ? "warning" : "healthy" },
    { label: "Daily Risk Used", value: `${portfolioRisk.dailyRiskUsed.toFixed(1)}%`, icon: Activity, status: portfolioRisk.dailyRiskUsed >= 100 ? "critical" : portfolioRisk.dailyRiskUsed >= 80 ? "warning" : "healthy" },
    { label: "Capital Utilized", value: `${portfolioRisk.capitalUtilized.toFixed(1)}%`, icon: BarChart3, status: portfolioRisk.capitalUtilized > 90 ? "warning" : "healthy" },
    { label: "VaR (95%)", value: `₹${portfolioRisk.var95.toLocaleString()}`, icon: Shield, status: "healthy" },
    { label: "Directional Exposure", value: `${portfolioRisk.directionalExposure.toFixed(0)}%`, icon: Lock, status: Math.abs(portfolioRisk.directionalExposure) > portfolioRisk.limits.maxDirectionalExposure ? "critical" : "healthy" },
  ];

  return (
    <div className="space-y-5">
      {/* Risk Status Banner */}
      <div className={`rounded-panel border p-4 ${dashboard.riskStatus === "CRITICAL" ? "border-loss/20 bg-loss-dim" : dashboard.riskStatus === "WARNING" ? "border-warn/20 bg-warn-dim" : "border-gain/20 bg-gain-dim"}`}>
        <div className="flex items-center gap-3">
          <Shield size={16} className={dashboard.riskStatus === "CRITICAL" ? "text-loss" : dashboard.riskStatus === "WARNING" ? "text-warn" : "text-gain"} />
          <div>
            <p className={`text-2xs font-medium ${dashboard.riskStatus === "CRITICAL" ? "text-loss" : dashboard.riskStatus === "WARNING" ? "text-warn" : "text-gain"}`}>
              Risk Status: {dashboard.riskStatus}
            </p>
            <p className="text-2xs text-zinc-600">Portfolio-level risk limits are actively monitored.</p>
          </div>
        </div>
      </div>

      {/* Risk Metrics Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {riskMetrics.map((metric) => (
          <div key={metric.label} className={`rounded-panel border p-4 ${metric.status === "critical" ? "border-loss/20 bg-loss-dim/50" : metric.status === "warning" ? "border-warn/20 bg-warn-dim/50" : "border-border bg-panel"}`}>
            <div className="mb-2 flex items-center gap-2">
              <metric.icon size={12} className={metric.status === "critical" ? "text-loss" : metric.status === "warning" ? "text-warn" : "text-zinc-600"} />
              <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{metric.label}</span>
            </div>
            <p className={`font-mono text-xl font-semibold ${metric.status === "critical" ? "text-loss" : metric.status === "warning" ? "text-warn" : "text-zinc-100"}`}>
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      {/* Risk Limits */}
      <Panel title="Risk Limits" icon={Shield}>
        <div className="space-y-1">
          {Object.entries(portfolioRisk.limits).map(([key, value]) => (
            <Row
              key={key}
              label={key.replace(/([A-Z])/g, " $1").trim()}
              value={typeof value === "number" ? value.toLocaleString() : value}
              valueClass="text-zinc-300"
            />
          ))}
        </div>
      </Panel>

      {/* Risk Breaches */}
      {portfolioRisk.breaches.length > 0 && (
        <div className="rounded-panel border border-loss/20 bg-loss-dim/50 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-loss">
            <AlertTriangle size={12} /> Active Risk Breaches
          </h3>
          <div className="space-y-2">
            {portfolioRisk.breaches.filter((b) => !b.resolved).map((breach) => (
              <div key={breach.id} className="flex items-center justify-between rounded border border-border-subtle bg-surface p-3">
                <div>
                  <p className="text-2xs font-medium text-loss">{breach.type}</p>
                  <p className="text-2xs text-zinc-600">{breach.description}</p>
                </div>
                <Badge tone="rose">{breach.severity}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stress Test Results */}
      <Panel title="Stress Test Results" icon={Activity}>
        {portfolioRisk.stressTestResults.length === 0 ? (
          <p className="text-2xs text-zinc-700">No stress tests run. Use Simulation Lab to run scenarios.</p>
        ) : (
          <div className="space-y-2">
            {portfolioRisk.stressTestResults.map((result) => (
              <div key={result.scenario} className={`flex items-center justify-between rounded border p-3 ${result.pass ? "border-gain/20 bg-gain-dim/50" : "border-loss/20 bg-loss-dim/50"}`}>
                <div>
                  <p className="text-2xs font-medium text-zinc-200">{result.scenario}</p>
                  <p className="text-2xs text-zinc-600">{result.description}</p>
                </div>
                <Badge tone={result.pass ? "green" : "rose"}>{result.pass ? "PASS" : "FAIL"}</Badge>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}