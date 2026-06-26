/**
 * TradingOS — Market Intelligence
 * Institutional-grade market analytics
 */

import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { Activity, BarChart3, Eye, TrendingUp, Users, Zap } from "lucide-react";

export function MarketIntelligencePage() {
  const { state } = useInstitutionalStore();
  const { marketIntel } = state;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Market Intelligence</h1>
        <p className="mt-2 text-sm text-zinc-500">Real-time institutional analytics and market breadth indicators.</p>
      </div>

      {/* Advance Decline */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Advances" value={marketIntel.advanceDecline.advances} icon={TrendingUp} color="lime" />
        <MetricCard label="Declines" value={marketIntel.advanceDecline.declines} icon={TrendingUp} color="rose" />
        <MetricCard label="A/D Ratio" value={marketIntel.advanceDecline.ratio.toFixed(2)} icon={BarChart3} color={marketIntel.advanceDecline.ratio > 1 ? "lime" : "rose"} />
      </div>

      {/* PCR & Max Pain */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Activity size={14} className="text-zinc-500" />
            <h3 className="text-sm font-medium text-white">Put/Call Ratio</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Current</span>
              <span className="font-mono text-sm text-white">{marketIntel.pcr.current.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Percentile</span>
              <span className="font-mono text-sm text-white">{marketIntel.pcr.percentile.toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Interpretation</span>
              <span className="text-xs text-zinc-300">{marketIntel.pcr.interpretation}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Zap size={14} className="text-zinc-500" />
            <h3 className="text-sm font-medium text-white">Max Pain</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Strike</span>
              <span className="font-mono text-sm text-white">₹{marketIntel.maxPain.strike.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-zinc-500">Expected Move</span>
              <span className="font-mono text-sm text-white">±{marketIntel.expectedMove.movePercent.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* IV Metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <p className="text-xs text-zinc-500 mb-1">IV Rank</p>
          <p className="font-mono text-xl font-semibold text-white">{marketIntel.ivRank.rank.toFixed(0)}</p>
          <p className="text-xs text-zinc-600">Range: {marketIntel.ivRank.historicalRange[0]} - {marketIntel.ivRank.historicalRange[1]}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <p className="text-xs text-zinc-500 mb-1">IV Percentile</p>
          <p className="font-mono text-xl font-semibold text-white">{marketIntel.ivPercentile.percentile.toFixed(0)}%</p>
          <p className="text-xs text-zinc-600">{marketIntel.ivPercentile.lookbackDays} day lookback</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <p className="text-xs text-zinc-500 mb-1">IV Skew</p>
          <p className="font-mono text-xl font-semibold text-white">{marketIntel.ivSmile.skew.toFixed(3)}</p>
          <p className="text-xs text-zinc-600">ATM IV: {marketIntel.ivSmile.atmIv.toFixed(2)}%</p>
        </div>
      </div>

      {/* Institutional Flow */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users size={14} className="text-zinc-500" />
          <h3 className="text-sm font-medium text-white">Institutional Flow</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <FlowItem label="FII Cash" value={marketIntel.institutionalFlow.netFiiCash} />
          <FlowItem label="DII Cash" value={marketIntel.institutionalFlow.netDiiCash} />
          <FlowItem label="FII F&O" value={marketIntel.institutionalFlow.netFiiFno} />
          <FlowItem label="Client F&O" value={marketIntel.institutionalFlow.netClientFno} />
        </div>
      </div>

      {/* OI Heatmap Placeholder */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye size={14} className="text-zinc-500" />
          <h3 className="text-sm font-medium text-white">OI Heatmap</h3>
        </div>
        <p className="text-xs text-zinc-600">Live OI heatmap visualization with strike-wise open interest data.</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: React.ElementType; color: string }) {
  const colorClasses: Record<string, string> = {
    lime: "text-lime-300",
    rose: "text-rose-300",
    amber: "text-amber-300",
  };
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-zinc-500" />
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <p className={`font-mono text-2xl font-semibold ${colorClasses[color] || "text-white"}`}>{value}</p>
    </div>
  );
}

function FlowItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-zinc-900/50 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-sm font-semibold ${value >= 0 ? "text-lime-300" : "text-rose-300"}`}>
        {value >= 0 ? "+" : ""}₹{(value / 10000000).toFixed(0)}Cr
      </p>
    </div>
  );
}