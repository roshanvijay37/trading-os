/**
 * TradingOS — Strategy Manager
 * Institutional-grade strategy configuration and management
 *
 * Philosophy: "I do not trade. I supervise."
 */

import { useState } from "react";
import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { STRATEGY_DEFINITIONS, STRATEGY_CATEGORIES, getStrategyById } from "../lib/strategies/registry";
import type { StrategyId, StrategyConfig } from "../types/institutional";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Filter,
  Pause,
  Play,
  Settings,
  Shield,
  Sliders,
  TrendingUp,
  X,
  XCircle,
  Zap,
} from "lucide-react";

export function StrategyManager() {
  const {
    state,
    toggleStrategy,
    setStrategyConfig,
    enableStrategy,
    disableStrategy,
    pauseStrategy,
    resumeStrategy,
    totalAllocation,
    enabledStrategies,
  } = useInstitutionalStore();

  const [selectedStrategy, setSelectedStrategy] = useState<StrategyId | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const allocation = totalAllocation();
  const enabled = enabledStrategies();
  const isOverAllocated = allocation > 100;

  const filteredStrategies = filterCategory
    ? STRATEGY_DEFINITIONS.filter((s) => s.category === filterCategory)
    : STRATEGY_DEFINITIONS;

  const selectedConfig = selectedStrategy ? state.strategyConfigs[selectedStrategy] : null;
  const selectedDef = selectedStrategy ? getStrategyById(selectedStrategy) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Strategy Manager</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Configure and manage autonomous trading strategies. Enabled strategies run simultaneously.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`rounded-lg px-4 py-2 text-sm font-medium ${isOverAllocated ? "bg-rose-400/10 text-rose-300" : allocation === 100 ? "bg-lime-400/10 text-lime-300" : "bg-amber-400/10 text-amber-300"}`}>
            <span className="font-mono">{allocation.toFixed(0)}%</span> Allocated
          </div>
          <div className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-400">
            <span className="font-mono text-white">{enabled.length}</span> Active
          </div>
        </div>
      </div>

      {/* Allocation Warning */}
      {isOverAllocated && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4">
          <AlertTriangle size={20} className="text-rose-300" />
          <div>
            <p className="text-sm font-medium text-rose-300">Over-allocated Portfolio</p>
            <p className="text-xs text-rose-400/70">Total allocation exceeds 100%. Reduce individual strategy allocations.</p>
          </div>
        </div>
      )}

      {/* Category Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCategory(null)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${!filterCategory ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800"}`}
        >
          All Strategies
        </button>
        {STRATEGY_CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setFilterCategory(filterCategory === cat.value ? null : cat.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${filterCategory === cat.value ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800"}`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Strategy List */}
      <div className="grid gap-3">
        {filteredStrategies.map((def) => {
          const config = state.strategyConfigs[def.id];
          const stratState = state.strategyStates[def.id];
          const isEnabled = config.enabled;
          const isSelected = selectedStrategy === def.id;

          return (
            <div
              key={def.id}
              className={`rounded-xl border transition-all ${isSelected ? "border-amber-400/30 bg-zinc-900/80" : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-700"}`}
            >
              <div className="flex items-center gap-4 p-4">
                {/* Checkbox */}
                <button
                  onClick={() => toggleStrategy(def.id)}
                  className={`flex h-6 w-6 items-center justify-center rounded border transition ${isEnabled ? "border-lime-400 bg-lime-400/10 text-lime-300" : "border-zinc-700 text-transparent"}`}
                >
                  {isEnabled && <Check size={14} />}
                </button>

                {/* Strategy Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{def.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getCategoryColor(def.category)}`}>
                      {def.category.replace("_", " ")}
                    </span>
                    {def.author && (
                      <span className="text-[10px] text-zinc-600">by {def.author}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{def.description}</p>
                </div>

                {/* Status Badge */}
                <div className="flex items-center gap-3">
                  {isEnabled && (
                    <>
                      <div className="text-right">
                        <p className="text-xs text-zinc-500">Allocation</p>
                        <p className="font-mono text-sm text-white">{config.capitalAllocationPercent}%</p>
                      </div>
                      <div className={`rounded-lg px-2 py-1 text-[10px] font-medium ${getStatusColor(stratState.status)}`}>
                        {stratState.status}
                      </div>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setSelectedStrategy(isSelected ? null : def.id);
                      setShowConfig(isSelected ? false : true);
                    }}
                    className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
                  >
                    {isSelected ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                </div>
              </div>

              {/* Expanded Configuration */}
              {isSelected && config && (
                <div className="border-t border-zinc-800 p-4">
                  <StrategyConfigPanel
                    strategyId={def.id}
                    config={config}
                    def={def}
                    onUpdate={(updates) => setStrategyConfig(def.id, updates)}
                    onEnable={() => enableStrategy(def.id)}
                    onDisable={() => disableStrategy(def.id)}
                    onPause={() => pauseStrategy(def.id)}
                    onResume={() => resumeStrategy(def.id)}
                    isRunning={stratState.isRunning}
                    isPaused={stratState.isPaused}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Strategy Details Modal */}
      {selectedConfig && selectedDef && showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-950 p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium text-white">{selectedDef.name}</h2>
                <p className="text-xs text-zinc-500">{selectedDef.description}</p>
              </div>
              <button onClick={() => setShowConfig(false)} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900">
                <X size={18} />
              </button>
            </div>
            <StrategyConfigPanel
              strategyId={selectedDef.id}
              config={selectedConfig}
              def={selectedDef}
              onUpdate={(updates) => setStrategyConfig(selectedDef.id, updates)}
              onEnable={() => enableStrategy(selectedDef.id)}
              onDisable={() => disableStrategy(selectedDef.id)}
              onPause={() => pauseStrategy(selectedDef.id)}
              onResume={() => resumeStrategy(selectedDef.id)}
              isRunning={state.strategyStates[selectedDef.id].isRunning}
              isPaused={state.strategyStates[selectedDef.id].isPaused}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Strategy Config Panel ──────────────────────────────────────
function StrategyConfigPanel({
  strategyId,
  config,
  def,
  onUpdate,
  onEnable,
  onDisable,
  onPause,
  onResume,
  isRunning,
  isPaused,
}: {
  strategyId: StrategyId;
  config: StrategyConfig;
  def: ReturnType<typeof getStrategyById>;
  onUpdate: (c: Partial<StrategyConfig>) => void;
  onEnable: () => void;
  onDisable: () => void;
  onPause: () => void;
  onResume: () => void;
  isRunning: boolean;
  isPaused: boolean;
}) {
  if (!def) return null;

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        {!config.enabled ? (
          <button onClick={onEnable} className="flex items-center gap-2 rounded-lg bg-lime-400/10 px-4 py-2 text-sm font-medium text-lime-300 transition hover:bg-lime-400/20">
            <Zap size={14} /> Enable Strategy
          </button>
        ) : (
          <>
            {isRunning && !isPaused ? (
              <button onClick={onPause} className="flex items-center gap-2 rounded-lg bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-400/20">
                <Pause size={14} /> Pause
              </button>
            ) : (
              <button onClick={onResume} className="flex items-center gap-2 rounded-lg bg-lime-400/10 px-4 py-2 text-sm font-medium text-lime-300 transition hover:bg-lime-400/20">
                <Play size={14} /> Resume
              </button>
            )}
            <button onClick={onDisable} className="flex items-center gap-2 rounded-lg bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-400/20">
              <XCircle size={14} /> Disable
            </button>
          </>
        )}
      </div>

      {/* Capital & Risk */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ConfigField
          label="Capital Allocation %"
          value={config.capitalAllocationPercent}
          onChange={(v) => onUpdate({ capitalAllocationPercent: Number(v) })}
          min={0}
          max={100}
          step={1}
          icon={DollarSign}
        />
        <ConfigField
          label="Risk Per Trade %"
          value={config.riskPercent}
          onChange={(v) => onUpdate({ riskPercent: Number(v) })}
          min={0.1}
          max={5}
          step={0.1}
          icon={Shield}
        />
        <ConfigField
          label="Max Trades / Day"
          value={config.maxTrades}
          onChange={(v) => onUpdate({ maxTrades: Number(v) })}
          min={1}
          max={50}
          step={1}
          icon={Activity}
        />
        <ConfigField
          label="Max Consecutive Losses"
          value={config.maxConsecutiveLosses}
          onChange={(v) => onUpdate({ maxConsecutiveLosses: Number(v) })}
          min={1}
          max={10}
          step={1}
          icon={AlertTriangle}
        />
        <ConfigField
          label="Confidence Threshold"
          value={config.confidenceThreshold}
          onChange={(v) => onUpdate({ confidenceThreshold: Number(v) })}
          min={0}
          max={1}
          step={0.05}
          icon={Filter}
        />
        <ConfigField
          label="Cooldown After Loss (min)"
          value={config.cooldownAfterLoss}
          onChange={(v) => onUpdate({ cooldownAfterLoss: Number(v) })}
          min={0}
          max={120}
          step={5}
          icon={Clock}
        />
      </div>

      {/* Strategy-specific Parameters */}
      <div>
        <h4 className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
          <Sliders size={12} /> Strategy Parameters
        </h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {def.parameters.map((param) => (
            <ConfigField
              key={param.name}
              label={param.label}
              value={config.parameters[param.name] as number}
              onChange={(v) => onUpdate({ parameters: { ...config.parameters, [param.name]: Number(v) } })}
              min={param.min}
              max={param.max}
              step={param.step}
              icon={Settings}
            />
          ))}
        </div>
      </div>

      {/* Trading Session */}
      <div>
        <h4 className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
          <Clock size={12} /> Trading Session
        </h4>
        <div className="flex flex-wrap gap-2">
          {(["FULL", "MORNING", "AFTERNOON", "CUSTOM"] as const).map((session) => (
            <button
              key={session}
              onClick={() => onUpdate({ tradingSession: session })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${config.tradingSession === session ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800"}`}
            >
              {session}
            </button>
          ))}
        </div>
      </div>

      {/* Allowed Symbols */}
      <div>
        <h4 className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
          <TrendingUp size={12} /> Allowed Symbols
        </h4>
        <div className="flex flex-wrap gap-2">
          {def.supportedInstruments.map((sym) => (
            <span
              key={sym}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${config.allowedSymbols.includes(sym) ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900 text-zinc-600"}`}
            >
              {sym.replace("NSE:", "").replace("-INDEX", "")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Config Field Component ─────────────────────────────────────
function ConfigField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  icon: Icon,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={12} className="text-zinc-600" />
        <label className="text-xs text-zinc-500">{label}</label>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full rounded bg-zinc-900 px-2 py-1.5 font-mono text-sm text-white outline-none focus:ring-1 focus:ring-amber-400/50"
        />
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-1 w-20 accent-amber-400"
        />
      </div>
    </div>
  );
}

// ─── Helper Functions ───────────────────────────────────────────
function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    TREND_FOLLOWING: "bg-blue-400/10 text-blue-300",
    MEAN_REVERSION: "bg-purple-400/10 text-purple-300",
    MOMENTUM: "bg-orange-400/10 text-orange-300",
    BREAKOUT: "bg-pink-400/10 text-pink-300",
    OPTION: "bg-cyan-400/10 text-cyan-300",
    CUSTOM: "bg-zinc-400/10 text-zinc-300",
  };
  return colors[category] || "bg-zinc-400/10 text-zinc-300";
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    ACTIVE: "bg-lime-400/10 text-lime-300",
    PAUSED: "bg-amber-400/10 text-amber-300",
    COOLDOWN: "bg-orange-400/10 text-orange-300",
    HALTED: "bg-rose-400/10 text-rose-300",
    DISABLED: "bg-zinc-800 text-zinc-500",
  };
  return colors[status] || "bg-zinc-800 text-zinc-500";
}