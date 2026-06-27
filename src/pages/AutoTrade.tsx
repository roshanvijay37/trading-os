import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { autoTradeApi } from "../services/api";
import {
  Play,
  Square,
  Activity,
  XCircle,
  Shield,
  Zap,
  BarChart3,
  Settings,
  AlertTriangle,
  Radio,
  TrendingUp,
  TrendingDown,
  FileText,
  Lock,
  Clock,
  Target,
} from "lucide-react";
import type { BotPosition, BotSignal, BotConfig, BotStatus } from "../types";

export function AutoTrade() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [configForm, setConfigForm] = useState<BotConfig>({
    riskPercent: 0.5,
    maxTradesPerDay: 10,
    paperTrading: false,
    positionSizingMode: "RISK",
    fixedLots: 1,
    selectedStrategies: ["EMA5"],
    selectedInstruments: ["NIFTY", "BANKNIFTY"],
  });
  const [logs, setLogs] = useState<string[]>([]);

  const fetchStatus = async () => {
    try {
      const data = await autoTradeApi.getStatus();
      setStatus(data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to fetch status");
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => {
      fetchStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status) {
      const timestamp = new Date().toLocaleTimeString();
      setLogs((prev) => {
        const entry = `${timestamp} — Status: ${status.isRunning ? "RUNNING" : "STOPPED"} | P&L: ₹${status.dailyPnL || 0} | Positions: ${status.openPositions?.length || 0}`;
        if (prev[0] === entry) return prev;
        return [entry, ...prev].slice(0, 20);
      });
    }
  }, [status?.isRunning, status?.dailyPnL, status?.openPositions?.length]);

  useEffect(() => {
    if (status && !showConfig) {
      setConfigForm((prev) => ({
        ...prev,
        riskPercent: status.riskPercent ?? prev.riskPercent,
        maxTradesPerDay: status.maxTrades ?? prev.maxTradesPerDay,
        paperTrading: status.paperTrading ?? prev.paperTrading,
        positionSizingMode: status.positionSizingMode ?? prev.positionSizingMode,
        fixedLots: status.fixedLots ?? prev.fixedLots,
        selectedStrategies: status.selectedStrategies ?? prev.selectedStrategies,
        selectedInstruments: status.selectedInstruments ?? prev.selectedInstruments,
      }));
    }
  }, [status, showConfig]);

  const handleStart = async () => {
    setLoading(true);
    setError("");
    try {
      await autoTradeApi.start();
      await fetchStatus();
      setLogs((prev) => [`${new Date().toLocaleTimeString()} — Bot STARTED`, ...prev].slice(0, 20));
    } catch (err: any) {
      setError(err.message || "Failed to start");
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setError("");
    try {
      await autoTradeApi.stop();
      await fetchStatus();
      setLogs((prev) => [`${new Date().toLocaleTimeString()} — Bot STOPPED`, ...prev].slice(0, 20));
    } catch (err: any) {
      setError(err.message || "Failed to stop");
    } finally {
      setLoading(false);
    }
  };

  const handleEmergencyStop = async () => {
    if (!window.confirm("EMERGENCY STOP: This will immediately halt all trading activity. Confirm?")) return;
    setLoading(true);
    try {
      await autoTradeApi.emergencyStop();
      await fetchStatus();
      setLogs((prev) => [`${new Date().toLocaleTimeString()} — 🚨 EMERGENCY STOP ACTIVATED`, ...prev].slice(0, 20));
    } catch (err: any) {
      setError(err.message || "Emergency stop failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResetEmergency = async () => {
    if (!window.confirm("Reset emergency stop? This will allow the bot to trade again.")) return;
    setLoading(true);
    try {
      await autoTradeApi.resetEmergency();
      await fetchStatus();
      setLogs((prev) => [`${new Date().toLocaleTimeString()} — Emergency stop CLEARED`, ...prev].slice(0, 20));
    } catch (err: any) {
      setError(err.message || "Failed to reset emergency");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConfig = async () => {
    setLoading(true);
    try {
      await autoTradeApi.updateConfig(configForm);
      await fetchStatus();
      setShowConfig(false);
      setLogs((prev) => [`${new Date().toLocaleTimeString()} — Configuration updated`, ...prev].slice(0, 20));
    } catch (err: any) {
      setError(err.message || "Failed to update config");
    } finally {
      setLoading(false);
    }
  };

  const isRunning = status?.isRunning || false;
  const isEmergency = status?.emergencyStop || false;

  return (
    <div>
      {/* Status Badge */}
      <div className="flex items-center gap-2 mb-5">
        <span className={`flex items-center gap-1.5 rounded-panel border px-2.5 py-1 text-2xs font-medium ${
          isEmergency
            ? "border-loss/20 bg-loss-dim text-loss"
            : isRunning
              ? "border-gain/20 bg-gain-dim text-gain"
              : "border-border bg-surface text-zinc-500"
        }`}>
          <Radio size={9} className={isRunning && !isEmergency ? "animate-pulse" : ""} />
          {isEmergency ? "EMERGENCY" : isRunning ? "LIVE" : "STANDBY"}
        </span>
        <p className="text-2xs text-zinc-600">Institutional-grade automated execution. No manual intervention.</p>
      </div>

      {/* Control Panel */}
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-panel ${
              isEmergency
                ? "bg-loss-dim text-loss"
                : isRunning
                  ? "bg-gain-dim text-gain"
                  : "bg-surface text-zinc-500"
            }`}>
              {isEmergency ? <AlertTriangle size={20} /> : isRunning ? <Activity size={20} className="animate-pulse" /> : <XCircle size={20} />}
            </div>
            <div>
              <p className="text-2xs font-medium text-zinc-200">
                {isEmergency ? "System Halted" : isRunning ? "Strategy Active" : "System Idle"}
              </p>
              <p className="text-2xs text-zinc-600">
                {isRunning
                  ? `Scanning ${status?.selectedStrategies?.join(", ") || "EMA5"} on ${status?.selectedInstruments?.join(" / ") || "NIFTY / BANKNIFTY"}`
                  : "Ready for operator command"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="flex items-center gap-1.5 rounded-panel border border-border bg-panel px-3 py-2 text-2xs font-medium text-zinc-300 transition hover:border-border-hover hover:text-zinc-100"
            >
              <Settings size={13} />
              Config
            </button>
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={loading || isEmergency}
                className="flex items-center gap-1.5 rounded-panel border border-gain/20 bg-gain-dim px-4 py-2 text-2xs font-semibold text-gain transition hover:bg-gain/20 disabled:opacity-50"
              >
                <Play size={14} />
                {loading ? "Starting..." : "Start Bot"}
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-panel border border-warn/20 bg-warn-dim px-4 py-2 text-2xs font-semibold text-warn transition hover:bg-warn/20 disabled:opacity-50"
              >
                <Square size={14} />
                {loading ? "Stopping..." : "Stop Bot"}
              </button>
            )}
            {isEmergency ? (
              <button
                onClick={handleResetEmergency}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-panel border border-gain/20 bg-gain-dim px-3 py-2 text-2xs font-semibold text-gain transition hover:bg-gain/20 disabled:opacity-50"
              >
                <Lock size={14} />
                Reset E-Stop
              </button>
            ) : (
              <button
                onClick={handleEmergencyStop}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-panel border border-loss/20 bg-loss-dim px-3 py-2 text-2xs font-semibold text-loss transition hover:bg-loss/20 disabled:opacity-50"
              >
                <Lock size={14} />
                E-Stop
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="mt-4 rounded-panel border border-loss/20 bg-loss-dim p-3 text-2xs text-loss">
            {error}
          </p>
        )}
      </Card>

      {/* Configuration Panel */}
      {showConfig && (
        <Card className="mt-3 border-warn/20">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-warn">
              <Settings size={13} />
              Strategy Configuration
            </h3>
            <button
              onClick={handleUpdateConfig}
              disabled={loading}
              className="rounded-panel border border-gain/20 bg-gain-dim px-3 py-1.5 text-2xs font-semibold text-gain transition hover:bg-gain/20 disabled:opacity-50"
            >
              Save Config
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="text-2xs text-zinc-600">Sizing Mode</label>
              <select
                value={configForm.positionSizingMode}
                onChange={(e) => setConfigForm({ ...configForm, positionSizingMode: e.target.value })}
                className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
              >
                <option value="RISK">Risk %</option>
                <option value="LOTS">Fixed Lots</option>
              </select>
            </div>
            {configForm.positionSizingMode === "RISK" ? (
              <div>
                <label className="text-2xs text-zinc-600">Risk Per Trade (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={configForm.riskPercent}
                  onChange={(e) => setConfigForm({ ...configForm, riskPercent: parseFloat(e.target.value) })}
                  className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
                />
              </div>
            ) : (
              <div>
                <label className="text-2xs text-zinc-600">Lots Per Trade</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={configForm.fixedLots}
                  onChange={(e) => setConfigForm({ ...configForm, fixedLots: parseInt(e.target.value) })}
                  className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
                />
              </div>
            )}
            <div>
              <label className="text-2xs text-zinc-600">Max Trades/Day</label>
              <input
                type="number"
                min="1"
                max="100"
                value={configForm.maxTradesPerDay}
                onChange={(e) => setConfigForm({ ...configForm, maxTradesPerDay: parseInt(e.target.value) })}
                className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
              />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <input
                type="checkbox"
                checked={configForm.paperTrading}
                onChange={(e) => setConfigForm({ ...configForm, paperTrading: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-border bg-surface"
              />
              <label className="text-2xs text-zinc-600">Paper Trading</label>
            </div>
          </div>
          <div className="mt-3">
            <label className="text-2xs text-zinc-600">Active Strategies</label>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {[
                { id: "EMA5", label: "5 EMA Trend" },
                { id: "EMA5_OPTION", label: "5 EMA Option Buying" },
              ].map((strategy) => (
                <label key={strategy.id} className="flex items-center gap-2 text-2xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={configForm.selectedStrategies.includes(strategy.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...configForm.selectedStrategies, strategy.id]
                        : configForm.selectedStrategies.filter((id) => id !== strategy.id);
                      setConfigForm({ ...configForm, selectedStrategies: next });
                    }}
                    className="h-3.5 w-3.5 rounded border-border bg-surface"
                  />
                  {strategy.label}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <label className="text-2xs text-zinc-600">Active Instruments</label>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {[
                { id: "NIFTY", label: "NIFTY" },
                { id: "BANKNIFTY", label: "BANKNIFTY" },
              ].map((instrument) => (
                <label key={instrument.id} className="flex items-center gap-2 text-2xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={configForm.selectedInstruments.includes(instrument.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...configForm.selectedInstruments, instrument.id]
                        : configForm.selectedInstruments.filter((id) => id !== instrument.id);
                      setConfigForm({ ...configForm, selectedInstruments: next });
                    }}
                    className="h-3.5 w-3.5 rounded border-border bg-surface"
                  />
                  {instrument.label}
                </label>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Status Metrics */}
      {status && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Market Status"
              value={status.marketStatus}
              detail="Exchange connectivity"
              icon={BarChart3}
              tone="green"
            />
            <MetricCard
              label="Trades Today"
              value={`${status.todayTrades} / ${status.maxTrades}`}
              detail="Execution count"
              icon={Zap}
              tone="green"
            />
            <MetricCard
              label="Open Positions"
              value={String(status.openPositions?.length || 0)}
              detail="Active exposure"
              icon={Target}
              tone="green"
            />
            <MetricCard
              label="Capital"
              value={`₹${(status.capital || 0).toLocaleString()}`}
              detail="Deployed base"
              icon={Shield}
              tone="green"
            />
          </div>

          {/* Active Positions */}
          <Card className="mt-5" title="Active Positions" icon={Target} action={<span className="text-2xs text-zinc-600">{status.openPositions?.length || 0} open</span>}>
            {status.openPositions && status.openPositions.length > 0 ? (
              <div className="space-y-1.5">
                {status.openPositions.map((pos: BotPosition) => (
                  <div
                    key={pos.id}
                    className="flex items-center justify-between rounded border border-border-subtle bg-surface px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`rounded px-1.5 py-0.5 text-2xs font-semibold ${
                        pos.pnl >= 0 ? "bg-gain-dim text-gain" : "bg-loss-dim text-loss"
                      }`}>
                        {pos.status}
                      </span>
                      <span className="text-2xs text-zinc-300">{pos.optionSymbol}</span>
                    </div>
                    <div className="flex items-center gap-4 text-2xs text-zinc-500">
                      <span>Qty: {pos.quantity}</span>
                      <span>Entry: ₹{pos.entryPrice}</span>
                      <span>SL: ₹{pos.currentSL}</span>
                      <span className={`font-medium ${pos.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                        {pos.pnl >= 0 ? "+" : ""}₹{pos.pnl.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-2xs text-zinc-600">No active positions.</p>
            )}
          </Card>

          {/* Risk & Performance */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <div className="flex items-center gap-3">
                <div className={`rounded-panel p-2 ${parseFloat(status.dailyPnL || "0") >= 0 ? "bg-gain-dim text-gain" : "bg-loss-dim text-loss"}`}>
                  {parseFloat(status.dailyPnL || "0") >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                </div>
                <div>
                  <p className="text-2xs text-zinc-600">Daily P&L</p>
                  <p className={`font-mono text-base font-semibold ${parseFloat(status.dailyPnL || "0") >= 0 ? "text-gain" : "text-loss"}`}>
                    ₹{status.dailyPnL || 0}
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className={`rounded-panel p-2 ${status.emergencyStop ? "bg-loss-dim text-loss" : "bg-gain-dim text-gain"}`}>
                  <Shield size={18} />
                </div>
                <div>
                  <p className="text-2xs text-zinc-600">Risk System</p>
                  <p className={`font-mono text-base font-semibold ${status.emergencyStop ? "text-loss" : "text-gain"}`}>
                    {status.emergencyStop ? "HALTED" : "ACTIVE"}
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className={`rounded-panel p-2 ${status.paperTrading ? "bg-warn-dim text-warn" : "bg-gain-dim text-gain"}`}>
                  <Lock size={18} />
                </div>
                <div>
                  <p className="text-2xs text-zinc-600">Execution Mode</p>
                  <p className={`font-mono text-base font-semibold ${status.paperTrading ? "text-warn" : "text-gain"}`}>
                    {status.paperTrading ? "PAPER" : "LIVE"}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Recent Signals */}
          {status.recentSignals && status.recentSignals.length > 0 && (
            <Card className="mt-5" title="Recent Signals" icon={Zap}>
              <div className="space-y-1.5">
                {status.recentSignals.slice(0, 5).map((sig: BotSignal, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded border border-border-subtle bg-surface px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`rounded px-1.5 py-0.5 text-2xs font-semibold ${
                        sig.type.includes("BUY") ? "bg-gain-dim text-gain" : "bg-loss-dim text-loss"
                      }`}>
                        {sig.type}
                      </span>
                      <span className="text-2xs text-zinc-300">{sig.underlying}</span>
                    </div>
                    <div className="flex items-center gap-4 text-2xs text-zinc-500">
                      <span>Entry: ₹{sig.entryPrice}</span>
                      <span>SL: ₹{sig.stopLoss}</span>
                      <span>Tgt: ₹{sig.target}</span>
                      <span className={`rounded px-1.5 py-0.5 text-2xs ${
                        sig.status === "EXECUTED" ? "bg-gain-dim text-gain" : "bg-surface text-zinc-500"
                      }`}>
                        {sig.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* System Logs */}
          <Card className="mt-5" title="Execution Logs" icon={FileText} action={<span className="flex items-center gap-1 text-2xs text-zinc-600"><Clock size={10} /> Real-time</span>}>
            <div className="max-h-52 overflow-y-auto space-y-0.5 font-mono text-2xs">
              {logs.length > 0 ? (
                logs.map((log, i) => (
                  <p key={i} className="text-zinc-600">
                    {log}
                  </p>
                ))
              ) : (
                <p className="text-zinc-700">No activity recorded.</p>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
