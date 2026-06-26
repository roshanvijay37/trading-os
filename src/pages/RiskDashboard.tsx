/**
 * TradingOS — Portfolio Risk Dashboard
 * Institutional-grade risk monitoring
 */

import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { AlertTriangle, Shield, TrendingDown, Activity, DollarSign, BarChart3, Lock } from "lucide-react";

export function RiskDashboard() {
  const { state } = useInstitutionalStore();
  const { portfolioRisk, dashboard } = state;

  const riskMetrics = [
    { label: "Total Exposure", value: `₹${portfolioRisk.totalExposure.toLocaleString()}`, icon: DollarSign, status: portfolioRisk.totalExposure > portfolioRisk.limits.maxDirectionalExposure * 10000 ? "critical" : "healthy" },
    { label: "Portfolio Drawdown", value: `${portfolioRisk.portfolioDrawdown.toFixed(2)}%`, icon: TrendingDown, status: portfolioRisk.portfolioDrawdown > portfolioRisk.limits.maxPortfolioDrawdown ? "critical" : portfolioRisk.portfolioDrawdown > 5 ? "warning" : "healthy" },
    { label: "Daily Risk Used", value: `₹${portfolioRisk.dailyRiskUsed.toLocaleString()}`, icon: Activity, status: portfolioRisk.dailyRiskUsed > portfolioRisk.limits.maxDailyLoss * 0.8 ? "warning" : "healthy" },
    { label: "Capital Utilized", value: `${portfolioRisk.capitalUtilized.toFixed(1)}%`, icon: BarChart3, status: portfolioRisk.capitalUtilized > 90 ? "warning" : "healthy" },
    { label: "VaR (95%)", value: `₹${portfolioRisk.var95.toLocaleString()}`, icon: Shield, status: "healthy" },
    { label: "Directional Exposure", value: `${portfolioRisk.directionalExposure.toFixed(0)}%`, icon: Lock, status: Math.abs(portfolioRisk.directionalExposure) > portfolioRisk.limits.maxDirectionalExposure ? "critical" : "healthy" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Portfolio Risk Engine</h1>
        <p className="mt-2 text-sm text-zinc-500">Real-time risk monitoring and portfolio-level circuit breakers.</p>
      </div>

      {/* Risk Status Banner */}
      <div className={`rounded-xl border p-4 ${dashboard.riskStatus === "CRITICAL" ? "border-rose-400/20 bg-rose-400/10" : dashboard.riskStatus === "WARNING" ? "border-amber-400/20 bg-amber-400/10" : "border-lime-400/20 bg-lime-400/10"}`}>
        <div className="flex items-center gap-3">
          <Shield size={20} className={dashboard.riskStatus === "CRITICAL" ? "text-rose-300" : dashboard.riskStatus === "WARNING" ? "text-amber-300" : "text-lime-300"} />
          <div>
            <p className={`text-sm font-medium ${dashboard.riskStatus === "CRITICAL" ? "text-rose-300" : dashboard.riskStatus === "WARNING" ? "text-amber-300" : "text-lime-300"}`}>
              Risk Status: {dashboard.riskStatus}
            </p>
            <p className="text-xs text-zinc-500">Portfolio-level risk limits are actively monitored.</p>
          </div>
        </div>
      </div>

      {/* Risk Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {riskMetrics.map((metric) => (
          <div key={metric.label} className={`rounded-xl border p-4 ${metric.status === "critical" ? "border-rose-400/20 bg-rose-400/5" : metric.status === "warning" ? "border-amber-400/20 bg-amber-400/5" : "border-zinc-800 bg-zinc-950/50"}`}>
            <div className="flex items-center gap-2 mb-2">
              <metric.icon size={14} className={metric.status === "critical" ? "text-rose-400" : metric.status === "warning" ? "text-amber-400" : "text-zinc-500"} />
              <span className="text-xs text-zinc-500">{metric.label}</span>
            </div>
            <p className={`text-xl font-mono font-semibold ${metric.status === "critical" ? "text-rose-300" : metric.status === "warning" ? "text-amber-300" : "text-white"}`}>
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      {/* Risk Limits */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <h3 className="mb-4 text-sm font-medium text-white">Risk Limits</h3>
        <div className="space-y-3">
          {Object.entries(portfolioRisk.limits).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">{key.replace(/([A-Z])/g, " $1").trim()}</span>
              <span className="font-mono text-xs text-zinc-300">{typeof value === "number" ? value.toLocaleString() : value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Breaches */}
      {portfolioRisk.breaches.length > 0 && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-rose-300">
            <AlertTriangle size={14} /> Active Risk Breaches
          </h3>
          <div className="space-y-2">
            {portfolioRisk.breaches.filter((b) => !b.resolved).map((breach) => (
              <div key={breach.id} className="flex items-center justify-between rounded-lg bg-zinc-950/50 p-3">
                <div>
                  <p className="text-xs font-medium text-rose-300">{breach.type}</p>
                  <p className="text-xs text-zinc-500">{breach.description}</p>
                </div>
                <span className="rounded px-2 py-0.5 text-[10px] font-medium bg-rose-400/10 text-rose-300">{breach.severity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stress Test Results */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <h3 className="mb-4 text-sm font-medium text-white">Stress Test Results</h3>
        {portfolioRisk.stressTestResults.length === 0 ? (
          <p className="text-xs text-zinc-600">No stress tests run. Use Simulation Lab to run scenarios.</p>
        ) : (
          <div className="space-y-2">
            {portfolioRisk.stressTestResults.map((result) => (
              <div key={result.scenario} className={`flex items-center justify-between rounded-lg p-3 ${result.pass ? "border border-lime-400/20 bg-lime-400/5" : "border border-rose-400/20 bg-rose-400/5"}`}>
                <div>
                  <p className="text-xs font-medium text-white">{result.scenario}</p>
                  <p className="text-xs text-zinc-500">{result.description}</p>
                </div>
                <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${result.pass ? "bg-lime-400/10 text-lime-300" : "bg-rose-400/10 text-rose-300"}`}>
                  {result.pass ? "PASS" : "FAIL"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}