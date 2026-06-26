import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { autoTradeApi } from "../services/api";
import {
  Play,
  Square,
  Activity,
  XCircle,
  Target,
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
} from "lucide-react";
import type { BotPosition, BotSignal, BotConfig, BotStatus } from "../types";
import { formatCurrency } from "../utils/format";

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white">Trading Bot</h1>
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${
              isEmergency
                ? "bg-rose-400/10 text-rose-300"
                : isRunning
                  ? "bg-lime-400/10 text-lime-300"
                  : "bg-zinc-800 text-zinc-500"
            }`}>
              <Radio size={10} className={isRunning && !isEmergency ? "animate-pulse" : ""} />
              {isEmergency ? "EMERGENCY" : isRunning ? "LIVE" : "STANDBY"}
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Institutional-grade automated execution. No manual intervention.
          </p>
        </div>
      </div>

      {/* Control Panel */}
      <Card className="mt-6 border-zinc-700">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              isEmergency
                ? "bg-rose-400/10 text-rose-300"
                : isRunning
                  ? "bg-lime-400/10 text-lime-300"
                  : "bg-zinc-800 text-zinc-500"
            }`}>
              {isEmergency ? <AlertTriangle size={24} /> : isRunning ? <Activity size={24} className="animate-pulse" /> : <XCircle size={24} />}
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {isEmergency ? "System Halted" : isRunning ? "Strategy Active" : "System Idle"}
              </p>
              <p className="text-xs text-zinc-500">
                {isRunning ? "Scanning 5 EMA crossovers on NIFTY / BANKNIFTY" : "Ready for operator command"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="flex items-center gap-2 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700"
            >
              <Settings size={16} />
              Config
            </button>
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={loading || isEmergency}
                className="flex items-center gap-2 rounded-xl bg-lime-400 px-5 py-2.5 font-semibold text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
              >
                <Play size={18} />
                {loading ? "Starting..." : "Start Bot"}
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-50"
              >
                <Square size={18} />
                {loading ? "Stopping..." : "Stop Bot"}
              </button>
            )}
            <button
              onClick={handleEmergencyStop}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50"
            >
              <Lock size={18} />
              E-Stop
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">
            {error}
          </p>
        )}
      </Card>

      {/* Configuration Panel */}
      {showConfig && (
        <Card className="mt-4 border-amber-400/20">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium text-amber-300">
              <Settings size={16} />
              Strategy Configuration
            </h3>
            <button
              onClick={handleUpdateConfig}
              disabled={loading}
              className="rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
            >
              Save Config
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="text-xs text-zinc-500">Sizing Mode</label>
              <select
                value={configForm.positionSizingMode}
                onChange={(e) => setConfigForm({ ...configForm, positionSizingMode: e.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white"
              >
                <option value="RISK">Risk %</option>
                <option value="LOTS">Fixed Lots</option>
              </select>
            </div>
            {configForm.positionSizingMode === "RISK" ? (
              <div>
                <label className="text-xs text-zinc-500">Risk Per Trade (%)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={configForm.riskPercent}
                  onChange={(e) => setConfigForm({ ...configForm, riskPercent: parseFloat(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white"
                />
              </div>
            ) : (
              <div>
                <label className="text-xs text-zinc-500">Lots Per Trade</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={configForm.fixedLots}
                  onChange={(e) => setConfigForm({ ...configForm, fixedLots: parseInt(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white"
                />
              </div>
            )}
            <div>
              <label className="text-xs text-zinc-500">Max Trades/Day</label>
              <input
                type="number"
                min="1"
                max="100"
                value={configForm.maxTradesPerDay}
                onChange={(e) => setConfigForm({ ...configForm, maxTradesPerDay: parseInt(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <input
                type="checkbox"
                checked={configForm.paperTrading}
                onChange={(e) => setConfigForm({ ...configForm, paperTrading: e.target.checked })}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-950"
              />
              <label className="text-xs text-zinc-500">Paper Trading</label>
            </div>
          </div>
        </Card>
      )}

      {/* Status Metrics */}
      {status && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <Card className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-medium text-white">
                <Target size={16} />
                Active Positions
              </h3>
              <span className="text-xs text-zinc-500">{status.openPositions?.length || 0} open</span>
            </div>
            {status.openPositions && status.openPositions.length > 0 ? (
              <div className="space-y-2">
                {status.openPositions.map((pos: BotPosition) => (
                  <div
                    key={pos.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                        pos.pnl >= 0 ? "bg-lime-400/10 text-lime-300" : "bg-rose-400/10 text-rose-300"
                      }`}>
                        {pos.status}
                      </span>
                      <span className="text-sm text-zinc-300">{pos.optionSymbol}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                      <span>Qty: {pos.quantity}</span>
                      <span>Entry: ₹{pos.entryPrice}</span>
                      <span>SL: ₹{pos.currentSL}</span>
                      <span className={`font-medium ${pos.pnl >= 0 ? "text-lime-300" : "text-rose-300"}`}>
                        {pos.pnl >= 0 ? "+" : ""}₹{pos.pnl.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-600">No active positions.</p>
            )}
          </Card>

          {/* Risk & Performance */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${parseFloat(status.dailyPnL || "0") >= 0 ? "bg-lime-400/10 text-lime-300" : "bg-rose-400/10 text-rose-300"}`}>
                  {parseFloat(status.dailyPnL || "0") >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Daily P&L</p>
                  <p className={`text-lg font-semibold ${parseFloat(status.dailyPnL || "0") >= 0 ? "text-lime-300" : "text-rose-300"}`}>
                    ₹{status.dailyPnL || 0}
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${status.emergencyStop ? "bg-rose-400/10 text-rose-300" : "bg-lime-400/10 text-lime-300"}`}>
                  <Shield size={20} />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Risk System</p>
                  <p className={`text-lg font-semibold ${status.emergencyStop ? "text-rose-300" : "text-lime-300"}`}>
                    {status.emergencyStop ? "HALTED" : "ACTIVE"}
                  </p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${status.paperTrading ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300"}`}>
                  <Lock size={20} />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Execution Mode</p>
                  <p className={`text-lg font-semibold ${status.paperTrading ? "text-amber-300" : "text-emerald-300"}`}>
                    {status.paperTrading ? "PAPER" : "LIVE"}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Recent Signals */}
          {status.recentSignals && status.recentSignals.length > 0 && (
            <Card className="mt-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-medium text-white">
                  <Zap size={16} />
                  Recent Signals
                </h3>
              </div>
              <div className="space-y-2">
                {status.recentSignals.slice(0, 5).map((sig: BotSignal, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                        sig.type.includes("BUY") ? "bg-lime-400/10 text-lime-300" : "bg-rose-400/10 text-rose-300"
                      }`}>
                        {sig.type}
                      </span>
                      <span className="text-sm text-zinc-300">{sig.underlying}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                      <span>Entry: ₹{sig.entryPrice}</span>
                      <span>SL: ₹{sig.stopLoss}</span>
                      <span>Tgt: ₹{sig.target}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                        sig.status === "EXECUTED" ? "bg-lime-400/10 text-lime-300" : "bg-zinc-800 text-zinc-500"
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
          <Card className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-medium text-white">
                <FileText size={16} />
                Execution Logs
              </h3>
              <span className="text-xs text-zinc-500 flex items-center gap-1">
                <Clock size={10} />
                Real-time
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 font-mono text-xs">
              {logs.length > 0 ? (
                logs.map((log, i) => (
                  <p key={i} className="text-zinc-500">
                    {log}
                  </p>
                ))
              ) : (
                <p className="text-zinc-600">No activity recorded.</p>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}