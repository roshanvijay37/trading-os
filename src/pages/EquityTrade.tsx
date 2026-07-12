import { useEffect, useRef, useState } from "react";
import { Banknote, Play, Square, AlertTriangle, Activity } from "lucide-react";
import { equityTradeApi } from "../services/api";

/**
 * Equity MIS trader — the isolated cash-equity EMA5T service (5 volatile scrips, 60m, MIS
 * intraday). Completely separate from the futures bot: own backend service, state, audit.
 * Paper-first: the paper/live switch is server-guarded (blocked while running).
 */

interface EquityScrip {
  name: string;
  symbol: string;
  enabled: boolean;
  tradesToday: number;
  committedMargin: number;
}

interface EquityPosition {
  id: string;
  side: "LONG" | "SHORT";
  optionSymbol: string;
  underlying: string;
  quantity: number;
  avgFillPrice: number;
  stopLoss: number;
  currentSL: number;
  target: number;
  currentLTP?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  pnl?: number;
  status: string;
  entryTime: string;
  exitTime?: string;
  exitReason?: string;
  exitPrice?: number;
}

interface EquityPending {
  scrip: string;
  dir: "LONG" | "SHORT";
  level: number;
  stopLoss: number;
  qty: number;
  entryOrderId: string | null;
  skippedReason: string | null;
  createdAt: string;
}

interface EquityStatus {
  isRunning: boolean;
  marketStatus: string;
  paperTrading: boolean;
  emergencyStop: boolean;
  scrips: EquityScrip[];
  perScripCapital: number;
  riskPerTrade: number;
  leverage: number;
  trendEmaPeriod: number;
  targetMultiplier: number;
  timeframeMinutes: number;
  maxTradesPerScripPerDay: number;
  dailyLossCap: number;
  dailyRealizedPnL: string;
  openPositions: EquityPosition[];
  closedPositions: EquityPosition[];
  pendingEntries: EquityPending[];
  misWindow: { entries: string; squareOff: string };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function EquityTrade() {
  const [status, setStatus] = useState<EquityStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [form, setForm] = useState({
    riskPerTrade: 2000,
    perScripCapital: 50000,
    leverage: 4,
    trendEmaPeriod: 12,
    targetMultiplier: 3,
    maxTradesPerScripPerDay: 3,
    dailyLossCap: 6000,
    scripEnabled: {} as Record<string, boolean>,
  });
  const seq = useRef(0);

  const fetchStatus = async () => {
    const mySeq = ++seq.current;
    try {
      const s = await equityTradeApi.getStatus();
      if (mySeq !== seq.current) return;
      setStatus(s);
      setError("");
      if (!showConfig) {
        setForm((prev) => ({
          ...prev,
          riskPerTrade: s.riskPerTrade ?? prev.riskPerTrade,
          perScripCapital: s.perScripCapital ?? prev.perScripCapital,
          leverage: s.leverage ?? prev.leverage,
          trendEmaPeriod: s.trendEmaPeriod ?? prev.trendEmaPeriod,
          targetMultiplier: s.targetMultiplier ?? prev.targetMultiplier,
          maxTradesPerScripPerDay: s.maxTradesPerScripPerDay ?? prev.maxTradesPerScripPerDay,
          dailyLossCap: s.dailyLossCap ?? prev.dailyLossCap,
          scripEnabled: Object.fromEntries((s.scrips || []).map((x: EquityScrip) => [x.name, x.enabled])),
        }));
      }
    } catch (err: any) {
      if (mySeq === seq.current) setError(err?.message || "Status fetch failed");
    }
  };

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConfig]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const dailyPnL = Number(status?.dailyRealizedPnL || 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`flex items-center gap-1.5 rounded-panel border px-2.5 py-1 text-2xs font-medium ${
            status?.isRunning ? "border-gain/20 bg-gain-dim text-gain" : "border-border bg-surface text-zinc-500"
          }`}
        >
          <Activity size={9} className={status?.isRunning ? "animate-pulse" : ""} />
          {status?.isRunning ? "RUNNING" : "STOPPED"}
        </span>
        <span className="rounded-panel border border-border bg-surface px-2.5 py-1 text-2xs text-zinc-500">
          NSE {status?.marketStatus ?? "…"}
        </span>
        <span
          className={`rounded-panel border px-2.5 py-1 text-2xs font-medium ${
            status?.paperTrading ? "border-info/20 bg-info-dim text-info" : "border-loss/30 bg-loss-dim text-loss"
          }`}
        >
          {status?.paperTrading ? "PAPER" : "LIVE MIS"}
        </span>
        <span className="text-2xs text-zinc-600">
          EMA5T · {status?.timeframeMinutes ?? 60}m · entries {status?.misWindow?.entries ?? "09:15–14:00"} · square-off{" "}
          {status?.misWindow?.squareOff ?? "15:10"}
        </span>
        <span className={`ml-auto font-mono text-2xs ${dailyPnL >= 0 ? "text-gain" : "text-loss"}`}>
          Day P&L: {inr(dailyPnL)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => act(() => equityTradeApi.start())}
          disabled={busy || status?.isRunning}
          className="flex items-center gap-2 rounded-panel border border-gain/20 bg-gain-dim px-4 py-2 text-2xs font-medium text-gain transition hover:bg-gain/20 disabled:opacity-50"
        >
          <Play size={12} /> Start
        </button>
        <button
          onClick={() => act(() => equityTradeApi.stop())}
          disabled={busy || !status?.isRunning}
          className="flex items-center gap-2 rounded-panel border border-border bg-surface px-4 py-2 text-2xs font-medium text-zinc-300 transition hover:border-border-hover disabled:opacity-50"
        >
          <Square size={12} /> Stop
        </button>
        <button
          onClick={() => act(() => equityTradeApi.emergencyStop(!status?.emergencyStop))}
          disabled={busy}
          className={`flex items-center gap-2 rounded-panel border px-4 py-2 text-2xs font-medium transition disabled:opacity-50 ${
            status?.emergencyStop
              ? "border-loss/40 bg-loss-dim text-loss"
              : "border-border bg-surface text-zinc-400 hover:border-loss/30 hover:text-loss"
          }`}
        >
          <AlertTriangle size={12} /> {status?.emergencyStop ? "E-Stop ON (click to clear)" : "Emergency Stop"}
        </button>
        <button
          onClick={() => setShowConfig((v) => !v)}
          className="ml-auto rounded-panel border border-border bg-surface px-4 py-2 text-2xs text-zinc-400 transition hover:border-border-hover"
        >
          {showConfig ? "Close Config" : "Config"}
        </button>
      </div>

      {error && <div className="rounded-panel border border-loss/20 bg-loss-dim px-3 py-2 text-2xs text-loss">{error}</div>}

      {showConfig && (
        <div className="rounded-panel border border-border bg-panel p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Risk / trade (₹)", "riskPerTrade", 100],
                ["Capital / scrip (₹)", "perScripCapital", 1000],
                ["MIS leverage (×)", "leverage", 1],
                ["Trend EMA", "trendEmaPeriod", 1],
                ["Target R:R", "targetMultiplier", 0.5],
                ["Max trades / scrip / day", "maxTradesPerScripPerDay", 1],
                ["Daily loss cap (₹)", "dailyLossCap", 500],
              ] as const
            ).map(([label, key, step]) => (
              <div key={key}>
                <label className="mb-1 block text-2xs text-zinc-600">{label}</label>
                <input
                  type="number"
                  step={step}
                  value={form[key] as number}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <label className="text-2xs text-zinc-600">Scrips</label>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {(status?.scrips || []).map((s) => (
                <label key={s.name} className="flex items-center gap-2 text-2xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={form.scripEnabled[s.name] ?? s.enabled}
                    onChange={(e) => setForm({ ...form, scripEnabled: { ...form.scripEnabled, [s.name]: e.target.checked } })}
                    className="h-3.5 w-3.5 rounded border-border bg-surface"
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() =>
                act(() => equityTradeApi.updateConfig(form)).then(() => setShowConfig(false))
              }
              disabled={busy}
              className="rounded-panel border border-gain/20 bg-gain-dim px-4 py-2 text-2xs font-medium text-gain transition hover:bg-gain/20 disabled:opacity-50"
            >
              Save Config
            </button>
            <p className="text-3xs text-zinc-600">
              Paper/live and paper-mode changes are server-guarded (blocked while running). Live MIS requires the
              verify-before-live checklist (rates, short availability, RMS timing).
            </p>
          </div>
        </div>
      )}

      {/* Scrip tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(status?.scrips || []).map((s) => (
          <div key={s.name} className={`rounded-panel border p-3 ${s.enabled ? "border-border bg-panel" : "border-border-subtle bg-surface opacity-60"}`}>
            <div className="flex items-center justify-between">
              <span className="text-2xs font-semibold text-zinc-300">{s.name}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-gain" : "bg-zinc-600"}`} />
            </div>
            <p className="mt-1 font-mono text-3xs text-zinc-600">{s.symbol}</p>
            <p className="mt-2 text-3xs text-zinc-500">
              Trades today: {s.tradesToday} / {status?.maxTradesPerScripPerDay ?? 3}
            </p>
            <p className="text-3xs text-zinc-500">Margin used: {inr(s.committedMargin || 0)} / {inr(status?.perScripCapital || 50000)}</p>
          </div>
        ))}
      </div>

      {/* Pending entries */}
      {(status?.pendingEntries?.length ?? 0) > 0 && (
        <div className="rounded-panel border border-border bg-panel p-4">
          <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">Resting Entries</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-2xs">
              <thead className="text-zinc-600">
                <tr>
                  <th className="py-1 pr-4">Scrip</th><th className="py-1 pr-4">Dir</th><th className="py-1 pr-4">Entry</th>
                  <th className="py-1 pr-4">SL</th><th className="py-1 pr-4">Qty</th><th className="py-1 pr-4">State</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {status!.pendingEntries.map((p) => (
                  <tr key={p.scrip} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-4">{p.scrip}</td>
                    <td className={`py-1.5 pr-4 ${p.dir === "LONG" ? "text-gain" : "text-loss"}`}>{p.dir}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.level.toFixed(2)}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.stopLoss.toFixed(2)}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.qty}</td>
                    <td className="py-1.5 pr-4 text-zinc-500">{p.entryOrderId ? "ARMED" : `SKIPPED (${p.skippedReason || "?"})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Open positions */}
      <div className="rounded-panel border border-border bg-panel p-4">
        <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">
          Open Positions ({status?.openPositions?.length ?? 0})
        </h2>
        {(status?.openPositions?.length ?? 0) === 0 ? (
          <p className="text-2xs text-zinc-600">No open positions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-2xs">
              <thead className="text-zinc-600">
                <tr>
                  <th className="py-1 pr-4">Scrip</th><th className="py-1 pr-4">Dir</th><th className="py-1 pr-4">Qty</th>
                  <th className="py-1 pr-4">Entry</th><th className="py-1 pr-4">LTP</th><th className="py-1 pr-4">SL</th>
                  <th className="py-1 pr-4">Target</th><th className="py-1 pr-4">Unrealized</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {status!.openPositions.map((p) => (
                  <tr key={p.id} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-4">{p.underlying}</td>
                    <td className={`py-1.5 pr-4 ${p.side === "LONG" ? "text-gain" : "text-loss"}`}>{p.side}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.quantity}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.avgFillPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-4 font-mono">{(p.currentLTP ?? 0).toFixed(2)}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.currentSL.toFixed(2)}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.target.toFixed(2)}</td>
                    <td className={`py-1.5 pr-4 font-mono ${(p.unrealizedPnl ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                      {inr(p.unrealizedPnl ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closed today */}
      <div className="rounded-panel border border-border bg-panel p-4">
        <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">
          Closed Today ({status?.closedPositions?.length ?? 0})
        </h2>
        {(status?.closedPositions?.length ?? 0) === 0 ? (
          <p className="text-2xs text-zinc-600">No closed trades today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-2xs">
              <thead className="text-zinc-600">
                <tr>
                  <th className="py-1 pr-4">Scrip</th><th className="py-1 pr-4">Dir</th><th className="py-1 pr-4">Qty</th>
                  <th className="py-1 pr-4">Entry</th><th className="py-1 pr-4">Exit</th><th className="py-1 pr-4">Reason</th>
                  <th className="py-1 pr-4">P&L</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {status!.closedPositions.map((p) => (
                  <tr key={p.id} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-4">{p.underlying}</td>
                    <td className={`py-1.5 pr-4 ${p.side === "LONG" ? "text-gain" : "text-loss"}`}>{p.side}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.quantity}</td>
                    <td className="py-1.5 pr-4 font-mono">{p.avgFillPrice.toFixed(2)}</td>
                    <td className="py-1.5 pr-4 font-mono">{(p.exitPrice ?? 0).toFixed(2)}</td>
                    <td className="py-1.5 pr-4 text-zinc-500">{p.exitReason}</td>
                    <td className={`py-1.5 pr-4 font-mono ${(p.pnl ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>{inr(p.pnl ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="flex items-center gap-2 text-3xs text-zinc-600">
        <Banknote size={10} />
        Isolated from the futures bot (own service, state, audit). Validated basket: PF 4–5.4 @60m across all five
        names, survives 5× slippage. Paper results are net of cash-intraday statutory charges.
      </p>
    </div>
  );
}
