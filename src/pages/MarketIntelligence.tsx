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
    <div className="space-y-5">
      <p className="text-2xs text-zinc-600">Real-time institutional analytics and market breadth indicators.</p>

      {/* Advance Decline */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Advances" value={marketIntel.advanceDecline.advances} icon={TrendingUp} color="gain" />
        <MetricCard label="Declines" value={marketIntel.advanceDecline.declines} icon={TrendingUp} color="loss" />
        <MetricCard label="A/D Ratio" value={marketIntel.advanceDecline.ratio.toFixed(2)} icon={BarChart3} color={marketIntel.advanceDecline.ratio > 1 ? "gain" : "loss"} />
      </div>

      {/* PCR & Max Pain */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-panel border border-border bg-panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <Activity size={12} className="text-zinc-600" />
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">Put/Call Ratio</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-2xs text-zinc-600">Current</span>
              <span className="font-mono text-2xs text-zinc-200">{marketIntel.pcr.current.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-2xs text-zinc-600">Percentile</span>
              <span className="font-mono text-2xs text-zinc-200">{marketIntel.pcr.percentile.toFixed(0)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-2xs text-zinc-600">Interpretation</span>
              <span className="text-2xs text-zinc-400">{marketIntel.pcr.interpretation}</span>
            </div>
          </div>
        </div>

        <div className="rounded-panel border border-border bg-panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <Zap size={12} className="text-zinc-600" />
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">Max Pain</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-2xs text-zinc-600">Strike</span>
              <span className="font-mono text-2xs text-zinc-200">₹{marketIntel.maxPain.strike.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-2xs text-zinc-600">Expected Move</span>
              <span className="font-mono text-2xs text-zinc-200">±{marketIntel.expectedMove.movePercent.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* IV Metrics */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-panel border border-border bg-panel p-4">
          <p className="text-2xs text-zinc-600 mb-1">IV Rank</p>
          <p className="font-mono text-xl font-semibold text-zinc-100">{marketIntel.ivRank.rank.toFixed(0)}</p>
          <p className="text-2xs text-zinc-700">Range: {marketIntel.ivRank.historicalRange[0]} - {marketIntel.ivRank.historicalRange[1]}</p>
        </div>
        <div className="rounded-panel border border-border bg-panel p-4">
          <p className="text-2xs text-zinc-600 mb-1">IV Percentile</p>
          <p className="font-mono text-xl font-semibold text-zinc-100">{marketIntel.ivPercentile.percentile.toFixed(0)}%</p>
          <p className="text-2xs text-zinc-700">{marketIntel.ivPercentile.lookbackDays} day lookback</p>
        </div>
        <div className="rounded-panel border border-border bg-panel p-4">
          <p className="text-2xs text-zinc-600 mb-1">IV Skew</p>
          <p className="font-mono text-xl font-semibold text-zinc-100">{marketIntel.ivSmile.skew.toFixed(3)}</p>
          <p className="text-2xs text-zinc-700">ATM IV: {marketIntel.ivSmile.atmIv.toFixed(2)}%</p>
        </div>
      </div>

      {/* Institutional Flow */}
      <div className="rounded-panel border border-border bg-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Users size={12} className="text-zinc-600" />
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">Institutional Flow</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <FlowItem label="FII Cash" value={marketIntel.institutionalFlow.netFiiCash} />
          <FlowItem label="DII Cash" value={marketIntel.institutionalFlow.netDiiCash} />
          <FlowItem label="FII F&O" value={marketIntel.institutionalFlow.netFiiFno} />
          <FlowItem label="Client F&O" value={marketIntel.institutionalFlow.netClientFno} />
        </div>
      </div>

      {/* Gamma Exposure */}
      <div className="rounded-panel border border-border bg-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye size={12} className="text-zinc-600" />
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">Gamma Exposure</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-2xs text-zinc-600">Total Gamma</p>
            <p className="font-mono text-2xs text-zinc-200">{marketIntel.gammaExposure.totalGamma.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-2xs text-zinc-600">Zero Gamma Level</p>
            <p className="font-mono text-2xs text-zinc-200">₹{marketIntel.gammaExposure.zeroGammaLevel.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-2xs text-zinc-600">Flip Point</p>
            <p className="font-mono text-2xs text-zinc-200">₹{marketIntel.gammaExposure.flipPoint.toLocaleString()}</p>
          </div>
        </div>
        <p className="mt-3 text-2xs text-zinc-700">
          Dealer hedging estimated delta: {marketIntel.gammaExposure.estimatedHedgeDelta.toFixed(0)} contracts
        </p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: React.ElementType; color: string }) {
  const colorClasses: Record<string, string> = {
    gain: "text-gain",
    loss: "text-loss",
    warn: "text-warn",
  };
  return (
    <div className="rounded-panel border border-border bg-panel p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={12} className="text-zinc-600" />
        <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      </div>
      <p className={`font-mono text-2xl font-semibold ${colorClasses[color] || "text-zinc-100"}`}>{value}</p>
    </div>
  );
}

function FlowItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-panel border border-border-subtle bg-surface p-3">
      <p className="text-2xs text-zinc-600">{label}</p>
      <p className={`mt-1 font-mono text-2xs font-semibold ${value >= 0 ? "text-gain" : "text-loss"}`}>
        {value >= 0 ? "+" : ""}₹{(value / 10000000).toFixed(0)}Cr
      </p>
    </div>
  );
}