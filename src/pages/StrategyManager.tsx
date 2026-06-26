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
    <div className="space-y-5">
      {/* Header + Stats */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xs text-zinc-600">Configure and manage autonomous trading strategies</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`rounded-panel border px-3 py-1.5 text-2xs font-medium ${isOverAllocated ? "border-loss/20 bg-loss-dim text-loss" : allocation === 100 ? "border-gain/20 bg-gain-dim text-gain" : "border-warn/20 bg-warn-dim text-warn"}`}>
            <span className="font-mono">{allocation.toFixed(0)}%</span> Allocated
          </div>
          <div className="rounded-panel border border-border bg-panel px-3 py-1.5 text-2xs text-zinc-500">
            <span className="font-mono text-zinc-300">{enabled.length}</span> Active
          </div>
        </div>
      </div>

      {/* Allocation Warning */}
      {isOverAllocated && (
        <div className="flex items-center gap-3 rounded-panel border border-loss/20 bg-loss-dim p-4">
          <AlertTriangle size={16} className="text-loss" />
          <div>
            <p className="text-2xs font-medium text-loss">Over-allocated Portfolio</p>
            <p className="text-2xs text-zinc-500">Total allocation exceeds 100%. Reduce individual strategy allocations.</p>
          </div>
        </div>
      )}

      {/* Category Filters */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilterCategory(null)}
          className={`rounded-panel border px-3 py-1.5 text-2xs font-medium transition ${!filterCategory ? "border-border-hover bg-surface text-zinc-200" : "border-border-subtle bg-panel text-zinc-500 hover:border-border-hover"}`}
        >
          All Strategies
        </button>
        {STRATEGY_CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setFilterCategory(filterCategory === cat.value ? null : cat.value)}
            className={`rounded-panel border px-3 py-1.5 text-2xs font-medium transition ${filterCategory === cat.value ? "border-border-hover bg-surface text-zinc-200" : "border-border-subtle bg-panel text-zinc-500 hover:border-border-hover"}`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Strategy List */}
      <div className="space-y-2">
        {filteredStrategies.map((def) => {
          const config = state.strategyConfigs[def.id];
          const stratState = state.strategyStates[def.id];
          const isEnabled = config.enabled;
          const isSelected = selectedStrategy === def.id;

          return (
            <div
              key={def.id}
              className={`rounded-panel border transition-all ${isSelected ? "border-warn/20 bg-panel" : "border-border bg-panel hover:border-border-hover"}`}
            >
              <div className="flex items-center gap-3 p-3">
                <button
                  onClick={() => toggleStrategy(def.id)}
                  className={`flex h-5 w-5 items-center justify-center rounded border transition ${isEnabled ? "border-gain bg-gain-dim text-gain" : "border-border-subtle text-transparent"}`}
                >
                  {isEnabled && <Check size={12} />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-medium text-zinc-200">{def.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-2xs font-medium ${getCategoryColor(def.category)}`}>
                      {def.category.replace("_", " ")}
                    </span>
                    {def.author && (
                      <span className="text-2xs text-zinc-700">by {def.author}</span>
                    )}
                  </div>
                  <p className="truncate text-2xs text-zinc-600">{def.description}</p>
                </div>

                <div className="flex items-center gap-3">
                  {isEnabled && (
                    <>
                      <div className="text-right">
                        <p className="text-2xs text-zinc-600">Allocation</p>
                        <p className="font-mono text-2xs text-zinc-200">{config.capitalAllocationPercent}%</p>
                      </div>
                      <div className={`rounded-panel border px-2 py-0.5 text-2xs font-medium ${getStatusColor(stratState.status)}`}>
                        {stratState.status}
                      </div>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setSelectedStrategy(isSelected ? null : def.id);
                      setShowConfig(isSelected ? false : true);
                    }}
                    className="rounded p-1.5 text-zinc-600 transition hover:bg-surface hover:text-zinc-300"
                  >
                    {isSelected ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>
              </div>

              {isSelected && config && (
                <div className="border-t border-border-subtle p-4">
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

      {/* Modal */}
      {selectedConfig && selectedDef && showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-panel border border-border bg-surface p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-zinc-200">{selectedDef.name}</h2>
                <p className="text-2xs text-zinc-600">{selectedDef.description}</p>
              </div>
              <button onClick={() => setShowConfig(false)} className="rounded p-1.5 text-zinc-500 hover:bg-panel">
                <X size={16} />
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
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {!config.enabled ? (
          <button onClick={onEnable} className="flex items-center gap-1.5 rounded-panel border border-gain/20 bg-gain-dim px-3 py-1.5 text-2xs font-medium text-gain transition hover:bg-gain/20">
            <Zap size={12} /> Enable Strategy
          </button>
        ) : (
          <>
            {isRunning && !isPaused ? (
              <button onClick={onPause} className="flex items-center gap-1.5 rounded-panel border border-warn/20 bg-warn-dim px-3 py-1.5 text-2xs font-medium text-warn transition hover:bg-warn/20">
                <Pause size={12} /> Pause
              </button>
            ) : (
              <button onClick={onResume} className="flex items-center gap-1.5 rounded-panel border border-gain/20 bg-gain-dim px-3 py-1.5 text-2xs font-medium text-gain transition hover:bg-gain/20">
                <Play size={12} /> Resume
              </button>
            )}
            <button onClick={onDisable} className="flex items-center gap-1.5 rounded-panel border border-loss/20 bg-loss-dim px-3 py-1.5 text-2xs font-medium text-loss transition hover:bg-loss/20">
              <XCircle size={12} /> Disable
            </button>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ConfigField label="Capital Allocation %" value={config.capitalAllocationPercent} onChange={(v) => onUpdate({ capitalAllocationPercent: Number(v) })} min={0} max={100} step={1} icon={DollarSign} />
        <ConfigField label="Risk Per Trade %" value={config.riskPercent} onChange={(v) => onUpdate({ riskPercent: Number(v) })} min={0.1} max={5} step={0.1} icon={Shield} />
        <ConfigField label="Max Trades / Day" value={config.maxTrades} onChange={(v) => onUpdate({ maxTrades: Number(v) })} min={1} max={50} step={1} icon={Activity} />
        <ConfigField label="Max Consecutive Losses" value={config.maxConsecutiveLosses} onChange={(v) => onUpdate({ maxConsecutiveLosses: Number(v) })} min={1} max={10} step={1} icon={AlertTriangle} />
        <ConfigField label="Confidence Threshold" value={config.confidenceThreshold} onChange={(v) => onUpdate({ confidenceThreshold: Number(v) })} min={0} max={1} step={0.05} icon={Filter} />
        <ConfigField label="Cooldown After Loss (min)" value={config.cooldownAfterLoss} onChange={(v) => onUpdate({ cooldownAfterLoss: Number(v) })} min={0} max={120} step={5} icon={Clock} />
      </div>

      <div>
        <h4 className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
          <Sliders size={11} /> Strategy Parameters
        </h4>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      <div>
        <h4 className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
          <Clock size={11} /> Trading Session
        </h4>
        <div className="flex flex-wrap gap-2">
          {(["FULL", "MORNING", "AFTERNOON", "CUSTOM"] as const).map((session) => (
            <button
              key={session}
              onClick={() => onUpdate({ tradingSession: session })}
              className={`rounded-panel border px-3 py-1.5 text-2xs font-medium transition ${config.tradingSession === session ? "border-border-hover bg-surface text-zinc-200" : "border-border-subtle bg-panel text-zinc-500 hover:border-border-hover"}`}
            >
              {session}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
          <TrendingUp size={11} /> Allowed Symbols
        </h4>
        <div className="flex flex-wrap gap-2">
          {def.supportedInstruments.map((sym) => (
            <span
              key={sym}
              className={`rounded-panel border px-3 py-1.5 text-2xs font-medium ${config.allowedSymbols.includes(sym) ? "border-border-hover bg-surface text-zinc-300" : "border-border-subtle bg-panel text-zinc-600"}`}
            >
              {sym.replace("NSE:", "").replace("-INDEX", "")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

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
    <div className="rounded-panel border border-border-subtle bg-surface p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon size={11} className="text-zinc-700" />
        <label className="text-2xs text-zinc-600">{label}</label>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full rounded border border-border-subtle bg-panel px-2 py-1.5 font-mono text-2xs text-zinc-200 outline-none focus:border-border-hover"
        />
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-1 w-16 accent-gain"
        />
      </div>
    </div>
  );
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    TREND_FOLLOWING: "border-info/20 bg-info-dim text-info",
    MEAN_REVERSION: "border-info/20 bg-info-dim text-info",
    MOMENTUM: "border-warn/20 bg-warn-dim text-warn",
    BREAKOUT: "border-warn/20 bg-warn-dim text-warn",
    OPTION: "border-info/20 bg-info-dim text-info",
    CUSTOM: "border-border-subtle bg-panel text-zinc-500",
  };
  return colors[category] || "border-border-subtle bg-panel text-zinc-500";
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    ACTIVE: "border-gain/20 bg-gain-dim text-gain",
    PAUSED: "border-warn/20 bg-warn-dim text-warn",
    COOLDOWN: "border-warn/20 bg-warn-dim text-warn",
    HALTED: "border-loss/20 bg-loss-dim text-loss",
    DISABLED: "border-border-subtle bg-panel text-zinc-600",
  };
  return colors[status] || "border-border-subtle bg-panel text-zinc-600";
}