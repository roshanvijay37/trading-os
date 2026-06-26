/**
 * TradingOS — AI Chief Investment Officer
 * Market regime detection and automated portfolio adjustments
 */

import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { Brain, TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle } from "lucide-react";

export function AICIO() {
  const { state, applyCIORecommendation } = useInstitutionalStore();
  const { cioState, dashboard } = state;

  const regimeColors: Record<string, string> = {
    TRENDING_UP: "bg-lime-400/10 text-lime-300",
    TRENDING_DOWN: "bg-rose-400/10 text-rose-300",
    SIDEWAYS: "bg-amber-400/10 text-amber-300",
    VOLATILE: "bg-purple-400/10 text-purple-300",
    LOW_VOLATILITY: "bg-blue-400/10 text-blue-300",
    GAP_DAY: "bg-orange-400/10 text-orange-300",
    EXPIRY_DAY: "bg-cyan-400/10 text-cyan-300",
    EVENT_DAY: "bg-pink-400/10 text-pink-300",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">AI Chief Investment Officer</h1>
        <p className="mt-2 text-sm text-zinc-500">Autonomous market regime detection and portfolio supervision.</p>
      </div>

      {/* Current Regime */}
      <div className={`rounded-xl border p-6 ${regimeColors[cioState.currentRegime] || "bg-zinc-800"}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs opacity-70">Current Market Regime</p>
            <p className="mt-1 text-2xl font-semibold">{cioState.currentRegime.replace("_", " ")}</p>
            <p className="mt-1 text-xs opacity-70">Confidence: {(cioState.regimeConfidence * 100).toFixed(0)}%</p>
          </div>
          <Brain size={40} className="opacity-30" />
        </div>
      </div>

      {/* Market Context */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ContextCard label="VIX Level" value={cioState.marketContext.vixLevel.toFixed(2)} trend={cioState.marketContext.vixTrend} />
        <ContextCard label="PCR Trend" value={cioState.marketContext.pcrTrend} />
        <ContextCard label="OI Buildup" value={cioState.marketContext.oiBuildup} />
        <ContextCard label="A/D Ratio" value={cioState.marketContext.advanceDeclineRatio.toFixed(2)} />
      </div>

      {/* Performance Forecast */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <h3 className="mb-4 text-sm font-medium text-white">Performance Forecast</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <ForecastItem label="Expected Return" value={`${(cioState.performanceForecast.expectedReturn * 100).toFixed(2)}%`} />
          <ForecastItem label="Expected Volatility" value={`${(cioState.performanceForecast.expectedVolatility * 100).toFixed(2)}%`} />
          <ForecastItem label="Win Probability" value={`${(cioState.performanceForecast.winProbability * 100).toFixed(0)}%`} />
        </div>
      </div>

      {/* Active Recommendations */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <h3 className="mb-4 text-sm font-medium text-white">AI Recommendations</h3>
        {cioState.recommendations.length === 0 ? (
          <p className="text-xs text-zinc-600">No active recommendations. Market conditions are stable.</p>
        ) : (
          <div className="space-y-2">
            {cioState.recommendations.filter((r: { applied: boolean }) => !r.applied).map((rec: { id: string; type: string; reason: string; urgency: string; targetValue: number }) => (
              <div key={rec.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <div>
                  <p className="text-xs font-medium text-white">{rec.type.replace("_", " ")}</p>
                  <p className="text-xs text-zinc-500">{rec.reason}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    rec.urgency === "CRITICAL" ? "bg-rose-400/10 text-rose-300" :
                    rec.urgency === "HIGH" ? "bg-orange-400/10 text-orange-300" :
                    rec.urgency === "MEDIUM" ? "bg-amber-400/10 text-amber-300" :
                    "bg-zinc-800 text-zinc-500"
                  }`}>{rec.urgency}</span>
                  <button onClick={() => applyCIORecommendation(rec.id)} className="rounded p-1 text-lime-400 hover:bg-lime-400/10">
                    <CheckCircle size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Adjustments */}
      {cioState.activeAdjustments.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <h3 className="mb-4 text-sm font-medium text-white">Applied Adjustments</h3>
          <div className="space-y-2">
            {cioState.activeAdjustments.map((adj: { id: string; type: string; oldValue: number; newValue: number; reason: string }) => (
              <div key={adj.id} className="flex items-center justify-between rounded-lg bg-zinc-900/50 p-3">
                <div>
                  <p className="text-xs font-medium text-white">{adj.type}</p>
                  <p className="text-xs text-zinc-500">{adj.reason}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">{adj.oldValue.toFixed(2)} → <span className="text-lime-300">{adj.newValue.toFixed(2)}</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContextCard({ label, value, trend }: { label: string; value: string; trend?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-lg font-mono font-semibold text-white">{value}</p>
        {trend && (
          trend === "RISING" ? <TrendingUp size={14} className="text-lime-400" /> :
          trend === "FALLING" ? <TrendingDown size={14} className="text-rose-400" /> :
          <Minus size={14} className="text-zinc-500" />
        )}
      </div>
    </div>
  );
}

function ForecastItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900/50 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">{value}</p>
    </div>
  );
}