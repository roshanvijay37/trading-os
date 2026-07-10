import { useEffect, useRef, useState } from "react";
import { ConfirmDialog, Flash, Panel, SkeletonStat, Stat, toast } from "../components/ui";
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
    maxRiskPerDay: 2,
    // Fail-SAFE: never initialize the form to live money. Before the first /status sync
    // resolves, a Save must not be able to flip a paper bot live.
    paperTrading: true,
    positionSizingMode: "RISK",
    fixedLots: 1,
    // Matches the backend's CONFIG.ALLOW_CORRELATED_TRADES default (false) — blocks Bank Nifty
    // and Nifty from both being open/pending at once until the operator opts in.
    allowCorrelatedTrades: false,
    selectedStrategies: ["EMA5"],
    selectedInstruments: ["NIFTY", "BANKNIFTY"],
    selectedTimeframes: [5],
    // EMA5T's no-lookahead trend gate — matches the backend's CONFIG.TREND_EMA_PERIOD default.
    // Changing this live-trades a DIFFERENT rule than the 6-year validation actually tested.
    trendEmaPeriod: 20,
    // Reward:risk multiple on the alert candle's stop distance — matches CONFIG.TARGET_MULTIPLIER.
    // The 6-year validation used 2 (1:2 RR); treat any non-default value as unvalidated.
    targetMultiplier: 2,
    // MCX gold contract (only used when GOLD is selected) — matches CONFIG.GOLD_CONTRACT default.
    goldContract: "GOLDM",
    // Optional VIX-regime filter (OFF by default) — matches CONFIG.MIN_VIX_FILTER/MIN_VIX. When on,
    // only trade EMA5T while India VIX >= minVix (momentum works in elevated vol, chops when quiet).
    minVixFilter: false,
    minVix: 15,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [confirmAction, setConfirmAction] = useState<"estop" | "reset" | "go-live" | null>(null);
  // Staleness: if the status poll keeps failing, the LIVE badge / positions / P&L would otherwise
  // keep showing the last-good snapshot forever with no cue — an operator could reasonably read
  // silence as "all fine" while actually blind to what the bot is really doing.
  const [statusStale, setStatusStale] = useState(false);
  const lastStatusAtRef = useRef<number | null>(null);
  const STALE_THRESHOLD_MS = 15000; // 3 missed 5s polls
  // Request-sequencing guard: an older /status response that resolves AFTER a newer one must
  // never overwrite it (e.g. click Stop, see it succeed, then a late in-flight poll flips the
  // badge back to "LIVE" with no error shown at all).
  const fetchSeq = useRef(0);

  const fetchStatus = async () => {
    const seq = ++fetchSeq.current;
    try {
      const data = await autoTradeApi.getStatus();
      if (seq !== fetchSeq.current) return; // a newer request has since been issued — discard
      setStatus(data);
      setError("");
      lastStatusAtRef.current = Date.now();
      setStatusStale(false);
    } catch (err: any) {
      if (seq !== fetchSeq.current) return;
      setError(err.message || "Failed to fetch status");
      if (lastStatusAtRef.current && Date.now() - lastStatusAtRef.current > STALE_THRESHOLD_MS) {
        setStatusStale(true);
      }
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const data = await autoTradeApi.getAuditLog(50);
      if (Array.isArray(data.logs)) {
        setAuditLogs(data.logs);
      }
    } catch (err: any) {
      // Silent — audit logs are optional UI candy
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchAuditLogs();
    const interval = setInterval(() => {
      fetchStatus();
      fetchAuditLogs();
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
        maxRiskPerDay: status.maxRiskPerDay ?? prev.maxRiskPerDay,
        paperTrading: status.paperTrading ?? prev.paperTrading,
        positionSizingMode: status.positionSizingMode ?? prev.positionSizingMode,
        fixedLots: status.fixedLots ?? prev.fixedLots,
        allowCorrelatedTrades: status.allowCorrelatedTrades ?? prev.allowCorrelatedTrades,
        selectedStrategies: status.selectedStrategies ?? prev.selectedStrategies,
        selectedInstruments: status.selectedInstruments ?? prev.selectedInstruments,
        selectedTimeframes: status.selectedTimeframes ?? prev.selectedTimeframes,
        trendEmaPeriod: status.trendEmaPeriod ?? prev.trendEmaPeriod,
        targetMultiplier: status.targetMultiplier ?? prev.targetMultiplier,
        minVixFilter: status.minVixFilter ?? prev.minVixFilter,
        minVix: status.minVix ?? prev.minVix,
        goldContract: status.goldContract ?? prev.goldContract,
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
      toast.success("Trading bot started", { id: "bot-action" });
    } catch (err: any) {
      setError(err.message || "Failed to start");
      toast.error(err.message || "Failed to start the bot", { id: "bot-action" });
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
      toast.info("Trading bot stopped", { id: "bot-action" });
    } catch (err: any) {
      setError(err.message || "Failed to stop");
      toast.error(err.message || "Failed to stop the bot", { id: "bot-action" });
    } finally {
      setLoading(false);
    }
  };

  const handleEmergencyStop = async () => {
    setConfirmAction(null);
    setLoading(true);
    try {
      await autoTradeApi.emergencyStop();
      await fetchStatus();
      setLogs((prev) => [`${new Date().toLocaleTimeString()} — 🚨 EMERGENCY STOP ACTIVATED`, ...prev].slice(0, 20));
      toast.warn("Emergency stop activated — all trading halted", { id: "bot-action" });
    } catch (err: any) {
      setError(err.message || "Emergency stop failed");
      toast.error(err.message || "Emergency stop failed", { id: "bot-action" });
    } finally {
      setLoading(false);
    }
  };

  const handleResetEmergency = async () => {
    setConfirmAction(null);
    setLoading(true);
    try {
      await autoTradeApi.resetEmergency();
      await fetchStatus();
      setLogs((prev) => [`${new Date().toLocaleTimeString()} — Emergency stop CLEARED`, ...prev].slice(0, 20));
      toast.success("Emergency stop cleared — bot may trade again", { id: "bot-action" });
    } catch (err: any) {
      setError(err.message || "Failed to reset emergency");
      toast.error(err.message || "Failed to reset emergency stop", { id: "bot-action" });
    } finally {
      setLoading(false);
    }
  };

  // Gate before actually saving: if this Save would flip PAPER_TRADING off (real broker orders),
  // require an explicit confirmation first, matching Emergency Stop/Reset — previously the ONLY
  // control that can switch the bot to live money was bundled into the generic Save Config
  // action with no confirmation at all, so a mis-click could silently go live.
  const handleSaveConfigClick = () => {
    // Only skip the confirmation when we KNOW the bot is already live (status.paperTrading===false).
    // If status hasn't loaded yet (null, e.g. on first page load or a stuck /status poll), treat a
    // requested paperTrading:false the same as a genuine paper→live flip rather than silently
    // skipping the dialog just because we can't yet prove it isn't one.
    const goingLive = status?.paperTrading !== false && configForm.paperTrading === false;
    if (goingLive) {
      setConfirmAction("go-live");
      return;
    }
    handleUpdateConfig();
  };

  const handleUpdateConfig = async () => {
    setConfirmAction(null);
    setLoading(true);
    try {
      await autoTradeApi.updateConfig(configForm);
      await fetchStatus();
      setShowConfig(false);
      setLogs((prev) => [`${new Date().toLocaleTimeString()} — Configuration updated`, ...prev].slice(0, 20));
      toast.success("Bot configuration saved", { id: "bot-action" });
    } catch (err: any) {
      setError(err.message || "Failed to update config");
      toast.error(err.message || "Failed to update config", { id: "bot-action" });
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
        {statusStale && (
          <span
            className="flex items-center gap-1.5 rounded-panel border border-warn/20 bg-warn-dim px-2.5 py-1 text-2xs font-medium text-warn"
            title="The status poll has been failing — everything below may be out of date, not necessarily what the bot is actually doing right now."
          >
            <AlertTriangle size={9} />
            STALE
          </span>
        )}
        <p className="text-2xs text-zinc-600">Institutional-grade automated execution. No manual intervention.</p>
      </div>

      {/* Control Panel */}
      <Panel>
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
                  ? `Scanning ${status?.selectedStrategies?.join(", ") || "EMA5"} on ${status?.selectedInstruments?.join(" / ") || "NIFTY / BANKNIFTY"} @ ${(status?.selectedTimeframes ?? [5]).map((t) => (t === 60 ? "1h" : `${t}m`)).join(" + ")}`
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
                onClick={() => setConfirmAction("reset")}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-panel border border-gain/20 bg-gain-dim px-3 py-2 text-2xs font-semibold text-gain transition hover:bg-gain/20 disabled:opacity-50"
              >
                <Lock size={14} />
                Reset E-Stop
              </button>
            ) : (
              <button
                onClick={() => setConfirmAction("estop")}
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
      </Panel>

      {/* Configuration Panel */}
      {showConfig && (
        <Panel className="mt-3 border-warn/20">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-warn">
              <Settings size={13} />
              Strategy Configuration
            </h3>
            <button
              onClick={handleSaveConfigClick}
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
              <p className="mt-1 text-2xs text-zinc-600">
                EMA5T (the live strategy) always trades exactly 1 lot per entry — this setting does not resize live orders yet.
              </p>
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
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    setConfigForm({ ...configForm, riskPercent: Number.isFinite(n) ? n : 0 });
                  }}
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
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setConfigForm({ ...configForm, fixedLots: Number.isFinite(n) ? n : 1 });
                  }}
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
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setConfigForm({ ...configForm, maxTradesPerDay: Number.isFinite(n) ? n : 1 });
                }}
                className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
              />
            </div>
            <div>
              <label className="text-2xs text-zinc-600">Daily Loss Limit (%)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="10"
                value={configForm.maxRiskPerDay}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setConfigForm({ ...configForm, maxRiskPerDay: Number.isFinite(n) ? n : 2 });
                }}
                className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
              />
            </div>
            <div>
              <label className="text-2xs text-zinc-600">Trend EMA Period</label>
              <input
                type="number"
                min="5"
                max="50"
                step="1"
                value={configForm.trendEmaPeriod}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setConfigForm({ ...configForm, trendEmaPeriod: Number.isFinite(n) ? n : 20 });
                }}
                className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
              />
            </div>
            <div>
              <label className="text-2xs text-zinc-600">Target R:R</label>
              <input
                type="number"
                min="0.5"
                max="5"
                step="0.1"
                value={configForm.targetMultiplier}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setConfigForm({ ...configForm, targetMultiplier: Number.isFinite(n) ? n : 2 });
                }}
                className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-2xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={configForm.minVixFilter}
                  onChange={(e) => setConfigForm({ ...configForm, minVixFilter: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border bg-surface"
                />
                VIX filter — only trade when VIX ≥
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                disabled={!configForm.minVixFilter}
                value={configForm.minVix}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setConfigForm({ ...configForm, minVix: Number.isFinite(n) ? n : 15 });
                }}
                className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover disabled:opacity-40"
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
            <div className="flex flex-col gap-1 pt-5">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={configForm.allowCorrelatedTrades}
                  onChange={(e) => setConfigForm({ ...configForm, allowCorrelatedTrades: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-border bg-surface"
                />
                <label className="text-2xs text-zinc-600">Allow Correlated Trades (Bank Nifty + Nifty concurrently)</label>
              </div>
              <p className="text-2xs text-zinc-600">
                When off, only one of the two underlyings can have an open or pending position at a time.
              </p>
            </div>
          </div>
          <div className="mt-3">
            <label className="text-2xs text-zinc-600">Active Strategies</label>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {[
                { id: "EMA5T", label: "EMA5-Trend Futures" },
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
            <label className="text-2xs text-zinc-600">Timeframes</label>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {[
                { id: 5, label: "5 Minutes" },
                { id: 15, label: "15 Minutes" },
                { id: 30, label: "30 Minutes" },
                { id: 60, label: "1 Hour" },
              ].map((tf) => (
                <label key={tf.id} className="flex items-center gap-2 text-2xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={configForm.selectedTimeframes.includes(tf.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...configForm.selectedTimeframes, tf.id]
                        : configForm.selectedTimeframes.filter((id) => id !== tf.id);
                      setConfigForm({ ...configForm, selectedTimeframes: next });
                    }}
                    className="h-3.5 w-3.5 rounded border-border bg-surface"
                  />
                  {tf.label}
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
                { id: "GOLD", label: "GOLD (MCX)" },
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
            {configForm.selectedInstruments.includes("GOLD") && (
              <div className="mt-3">
                <label className="text-2xs text-zinc-600">Gold Contract</label>
                <select
                  value={configForm.goldContract}
                  onChange={(e) => setConfigForm({ ...configForm, goldContract: e.target.value as "GOLDM" | "GOLD" })}
                  className="mt-1 w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
                >
                  <option value="GOLDM">GOLDM mini (₹10/point, ~₹80k margin)</option>
                  <option value="GOLD">GOLD big (₹100/point, ~₹6-8L margin)</option>
                </select>
                <p className="mt-1.5 text-3xs text-zinc-600">
                  Gold trades its own session automatically: entries 09:00–22:00 IST, square-off 23:15. Same EMA5T
                  rules and global risk gates; independent of the index correlation filter. Contract can't change
                  while the bot is running.
                </p>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Initial load — skeleton tiles until the first status fetch lands */}
      {!status && !error && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </div>
      )}

      {/* Status Metrics */}
      {status && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Market Status"
              value={status.marketStatus}
              sub={
                status.marketStatusByInstrument && status.selectedInstruments?.includes("GOLD")
                  ? `NSE ${status.marketStatusByInstrument.NIFTY ?? "?"} · MCX ${status.marketStatusByInstrument.GOLD ?? "?"}`
                  : "Exchange connectivity"
              }
              icon={BarChart3}
              tone="green"
            />
            <Stat
              label="Trades Today"
              value={`${status.todayTrades} / ${status.maxTrades}`}
              sub="Execution count"
              icon={Zap}
              tone="green"
            />
            <Stat
              label="Open Positions"
              value={String(status.openPositions?.length || 0)}
              sub="Active exposure"
              icon={Target}
              tone="green"
            />
            <Stat
              label="Capital"
              value={`₹${(status.capital || 0).toLocaleString()}`}
              sub="Deployed base"
              icon={Shield}
              tone="green"
            />
          </div>

          {/* Active Positions */}
          <Panel className="mt-5" title="Active Positions" icon={Target} actions={<span className="text-2xs text-zinc-600">{status.openPositions?.length || 0} open</span>}>
            {status.openPositions && status.openPositions.length > 0 ? (
              <div className="space-y-1.5">
                {status.openPositions.map((pos: BotPosition) => (
                  <div
                    key={pos.id}
                    className="flex flex-col gap-2 rounded border border-border-subtle bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`rounded px-1.5 py-0.5 text-2xs font-semibold ${
                        pos.pnl >= 0 ? "bg-gain-dim text-gain" : "bg-loss-dim text-loss"
                      }`}>
                        {pos.status}
                      </span>
                      <span className="text-2xs text-zinc-300">{pos.optionSymbol}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-zinc-500">
                      <span>Qty: {pos.quantity}</span>
                      <span>Avg Fill: ₹{pos.avgFillPrice ?? pos.entryPrice}</span>
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
          </Panel>

          {/* Risk & Performance */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Panel>
              <div className="flex items-center gap-3">
                <div className={`rounded-panel p-2 ${parseFloat(status.dailyPnL || "0") >= 0 ? "bg-gain-dim text-gain" : "bg-loss-dim text-loss"}`}>
                  {parseFloat(status.dailyPnL || "0") >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                </div>
                <div>
                  <p className="text-2xs text-zinc-600">Daily P&L</p>
                  <p className={`font-mono text-base font-semibold ${parseFloat(status.dailyPnL || "0") >= 0 ? "text-gain" : "text-loss"}`}>
                    <Flash value={parseFloat(status.dailyPnL || "0")}>₹{parseFloat(status.dailyPnL || "0").toFixed(2)}</Flash>
                  </p>
                </div>
              </div>
            </Panel>
            <Panel>
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
            </Panel>
            <Panel>
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
            </Panel>
            <Panel>
              <div className="flex items-center gap-3">
                <div className={`rounded-panel p-2 ${status.tickStatus?.isConnected ? "bg-gain-dim text-gain" : "bg-warn-dim text-warn"}`}>
                  <Radio size={18} />
                </div>
                <div>
                  <p className="text-2xs text-zinc-600">Tick Feed</p>
                  <p className={`font-mono text-base font-semibold ${status.tickStatus?.isConnected ? "text-gain" : "text-warn"}`}>
                    {status.tickStatus?.isConnected ? "LIVE" : "REST"}
                  </p>
                  {status.tickStatus?.isConnected && (
                    <p className="text-3xs text-zinc-600">
                      {Object.entries(status.tickStatus.tickCounts || {}).map(([k, v]) => `${k}:${v}`).join(" ")}
                    </p>
                  )}
                </div>
              </div>
            </Panel>
          </div>

          {/* Data Source Visibility */}
          <Panel className="mt-5" title="Data Sources" icon={Radio}>
            {auditLogs.filter((log) => log.type === "DATA_SOURCE").length > 0 ? (
              <div className="space-y-1.5">
                {auditLogs
                  .filter((log) => log.type === "DATA_SOURCE")
                  .slice(-5)
                  .map((log: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded border border-border-subtle bg-surface px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-3xs font-semibold ${
                            log.source === "websocket" ? "bg-gain-dim text-gain" : "bg-warn-dim text-warn"
                          }`}
                        >
                          {log.source === "websocket" ? "WS" : log.source?.toUpperCase() || "REST"}
                        </span>
                        <span className="text-2xs text-zinc-300">{log.symbol}</span>
                      </div>
                      <span className="text-3xs text-zinc-600">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-2xs text-zinc-600">No data source events yet.</p>
            )}
          </Panel>

          {/* Recent Signals */}
          {status.recentSignals && status.recentSignals.length > 0 && (
            <Panel className="mt-5" title="Recent Signals" icon={Zap}>
              <div className="space-y-1.5">
                {status.recentSignals.slice(0, 5).map((sig: BotSignal, i: number) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 rounded border border-border-subtle bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`rounded px-1.5 py-0.5 text-2xs font-semibold ${
                        sig.type.includes("BUY") ? "bg-gain-dim text-gain" : "bg-loss-dim text-loss"
                      }`}>
                        {sig.type}
                      </span>
                      <span className="text-2xs text-zinc-300">{sig.underlying}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-zinc-500">
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
            </Panel>
          )}

          {/* System Logs */}
          <Panel className="mt-5" title="Execution Logs" icon={FileText} actions={<span className="flex items-center gap-1 text-2xs text-zinc-600"><Clock size={10} /> Real-time</span>}>
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
          </Panel>
        </>
      )}

      <ConfirmDialog
        open={confirmAction === "estop"}
        tone="rose"
        title="Emergency stop"
        body="This will immediately halt all trading activity and block new entries until the emergency stop is reset."
        confirmLabel="Halt all trading"
        onConfirm={handleEmergencyStop}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === "reset"}
        tone="green"
        title="Reset emergency stop"
        body="This clears the emergency stop and allows the bot to trade again."
        confirmLabel="Allow trading"
        onConfirm={handleResetEmergency}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === "go-live"}
        tone="rose"
        title="Switch to LIVE trading"
        body="This turns off paper trading — the bot will place REAL orders with REAL money on your FYERS account. Make sure you've reviewed the configuration before continuing."
        confirmLabel="Go live"
        onConfirm={handleUpdateConfig}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
