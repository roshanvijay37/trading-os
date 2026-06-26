/**
 * TradingOS — Backtest Lab
 * Merged Backtest + Visual Backtest
 */

import { useState, useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi } from "lightweight-charts";
import { Play, RotateCcw, TrendingUp, TrendingDown, Shield, BarChart3, Table, LineChart, Eye } from "lucide-react";
import { backtestApi } from "../services/api";

interface Trade {
  id: number;
  entryTime: string;
  exitTime: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
  barsHeld: number;
}

interface EquityPoint {
  date: string;
  equity: number;
}

interface BacktestResult {
  success: boolean;
  symbol: string;
  summary: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalReturn: number;
    totalPnL: number;
    maxDrawdown: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    finalCapital: number;
  };
  trades: Trade[];
  equityCurve: EquityPoint[];
}

const strategies = [
  { value: "EMA5", label: "5 EMA Trend" },
  { value: "EMA5_OPTION", label: "5 EMA Option" },
  { value: "RSI", label: "RSI 2-Period" },
  { value: "TRAFFIC_LIGHT", label: "Traffic Light" },
  { value: "INSIDE_CANDLE", label: "Inside Candle" },
  { value: "VWAP_REVERSAL", label: "VWAP Reversal" },
  { value: "ORB", label: "Opening Range Breakout" },
  { value: "CPR_BREAKOUT", label: "CPR Breakout" },
  { value: "EMA9_20", label: "9/20 EMA Crossover" },
  { value: "FAILED_BREAKOUT", label: "Failed Breakout" },
  { value: "OPENING_MOMENTUM", label: "Opening Momentum" },
  { value: "MEAN_REVERSION", label: "Mean Reversion" },
  { value: "BOLLINGER_BREAKOUT", label: "Bollinger Breakout" },
  { value: "SUPERTREND", label: "SuperTrend" },
  { value: "OPTION_MOMENTUM", label: "Option Momentum" },
  { value: "PRICE_ACTION", label: "Price Action" },
  { value: "CUSTOM", label: "Custom Strategy" },
];

export function BacktestLab() {
  const [symbol, setSymbol] = useState("NSE:NIFTYBANK-INDEX");
  const [resolution, setResolution] = useState("5");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1825);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [strategy, setStrategy] = useState("EMA5");
  const [capital, setCapital] = useState(1000000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [targetMult, setTargetMult] = useState(2);
  const [slippage, setSlippage] = useState(0.02);
  const [capitalMode, setCapitalMode] = useState<"COMPOUND" | "FIXED">("COMPOUND");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [viewMode, setViewMode] = useState<"both" | "table" | "chart">("both");

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const runBacktest = async () => {
    if (!fromDate || !toDate) return;
    setLoading(true);
    try {
      const res = await backtestApi.run({
        symbol,
        resolution,
        fromDate,
        toDate,
        strategy,
        capital,
        riskPercent,
        targetMultiplier: targetMult,
        slippage,
        capitalMode,
      });
      setResult(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!result || !chartContainerRef.current || viewMode === "table") return;
    if (!result.equityCurve || result.equityCurve.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    try {
      const chart = createChart(chartContainerRef.current, {
        layout: { background: { type: ColorType.Solid, color: "#08080a" }, textColor: "#71717a" },
        grid: { vertLines: { color: "#131318" }, horzLines: { color: "#131318" } },
        rightPriceScale: { borderColor: "#23232a" },
        timeScale: { borderColor: "#23232a" },
        width: chartContainerRef.current.clientWidth,
        height: 380,
      });

      const lineSeries = chart.addLineSeries({
        color: "#10b981",
        lineWidth: 1,
        lastValueVisible: true,
        priceLineVisible: true,
      });

      const lineData = result.equityCurve.map((pt: EquityPoint) => ({
        time: pt.date as any,
        value: pt.equity,
      }));

      lineSeries.setData(lineData);

      const markers = result.trades.map((trade: Trade) => ({
        time: trade.entryTime.split("T")[0] as any,
        position: (trade.side === "LONG" ? "belowBar" : "aboveBar") as any,
        color: trade.side === "LONG" ? "#10b981" : "#ef4444",
        shape: (trade.side === "LONG" ? "arrowUp" : "arrowDown") as any,
        text: `${trade.side[0]} @ ${trade.entryPrice.toFixed(0)}`,
        size: 1,
      }));

      if (markers.length > 0) {
        lineSeries.setMarkers(markers);
      }

      chart.timeScale().fitContent();
      chartRef.current = chart;

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }
      };
    } catch (err) {
      console.error("[BacktestLab] Chart error:", err);
    }
  }, [result, viewMode]);

  const sum = result?.summary;

  return (
    <div className="space-y-5">
      <p className="text-2xs text-zinc-600">Run backtests. View results as table and chart.</p>

      {/* Form */}
      <div className="rounded-panel border border-border bg-panel p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Symbol</label>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover">
              <option value="NSE:NIFTY50-INDEX">NIFTY 50</option>
              <option value="NSE:NIFTYBANK-INDEX">BANKNIFTY</option>
              <option value="NSE:FINNIFTY-INDEX">FINNIFTY</option>
              <option value="BSE:SENSEX-INDEX">SENSEX</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Strategy</label>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover">
              {strategies.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Resolution</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover">
              <option value="1">1 minute</option>
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="D">Daily</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Capital (₹)</label>
            <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Risk %</label>
            <input type="number" step="0.1" value={riskPercent} onChange={(e) => setRiskPercent(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Target R:R</label>
            <input type="number" step="0.1" value={targetMult} onChange={(e) => setTargetMult(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Slippage %</label>
            <input type="number" step="0.01" value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Capital Mode</label>
            <select value={capitalMode} onChange={(e) => setCapitalMode(e.target.value as "COMPOUND" | "FIXED")} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover">
              <option value="COMPOUND">Compounding</option>
              <option value="FIXED">Fixed</option>
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button onClick={runBacktest} disabled={loading} className="flex-1 rounded-panel border border-gain/20 bg-gain-dim py-2 text-2xs font-medium text-gain transition hover:bg-gain/20 disabled:opacity-50">
              {loading ? "Running..." : <span className="flex items-center justify-center gap-2"><Play size={12} /> Run</span>}
            </button>
            <button onClick={() => setResult(null)} className="rounded-panel border border-border-subtle bg-surface p-2 text-zinc-500 hover:text-zinc-300">
              <RotateCcw size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* View Toggle */}
      {result && (
        <div className="flex gap-1.5">
          {[
            { key: "both", label: "Both", icon: Eye },
            { key: "table", label: "Table", icon: Table },
            { key: "chart", label: "Chart", icon: LineChart },
          ].map((v) => (
            <button
              key={v.key}
              onClick={() => setViewMode(v.key as any)}
              className={`flex items-center gap-1.5 rounded-panel border px-3 py-1.5 text-2xs transition ${
                viewMode === v.key ? "border-border-hover bg-surface text-zinc-200" : "border-border-subtle bg-panel text-zinc-500 hover:border-border-hover"
              }`}
            >
              <v.icon size={11} /> {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {result && sum && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Total Trades" value={sum.totalTrades} icon={BarChart3} />
            <SummaryCard label="Win Rate" value={`${sum.winRate.toFixed(1)}%`} icon={sum.winRate >= 50 ? TrendingUp : TrendingDown} color={sum.winRate >= 50 ? "gain" : "loss"} />
            <SummaryCard label="Total Return" value={`${sum.totalReturn >= 0 ? "+" : ""}${sum.totalReturn.toFixed(2)}%`} icon={sum.totalReturn >= 0 ? TrendingUp : TrendingDown} color={sum.totalReturn >= 0 ? "gain" : "loss"} />
            <SummaryCard label="Max Drawdown" value={`${sum.maxDrawdown.toFixed(2)}%`} icon={Shield} color="loss" />
          </div>

          {(viewMode === "both" || viewMode === "table") && (
            <div className="rounded-panel border border-border bg-panel p-4">
              <h3 className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">
                <Table size={12} className="text-zinc-600" /> Trade Log
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-2xs">
                  <thead>
                    <tr className="border-b border-border text-zinc-600">
                      <th className="px-2 py-2 text-left font-medium">#</th>
                      <th className="px-2 py-2 text-left font-medium">Side</th>
                      <th className="px-2 py-2 text-right font-medium">Entry</th>
                      <th className="px-2 py-2 text-right font-medium">Exit</th>
                      <th className="px-2 py-2 text-right font-medium">P&L</th>
                      <th className="px-2 py-2 text-right font-medium">%</th>
                      <th className="px-2 py-2 text-left font-medium">Reason</th>
                      <th className="px-2 py-2 text-right font-medium">Bars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t: Trade) => (
                      <tr key={t.id} className="border-b border-border-subtle">
                        <td className="px-2 py-2 text-zinc-600">{t.id}</td>
                        <td className="px-2 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-2xs font-medium ${t.side === "LONG" ? "bg-gain-dim text-gain" : "bg-loss-dim text-loss"}`}>{t.side}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-zinc-300">{t.entryPrice.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono text-zinc-300">{t.exitPrice.toFixed(2)}</td>
                        <td className={`px-2 py-2 text-right font-mono ${t.pnl >= 0 ? "text-gain" : "text-loss"}`}>{t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(0)}</td>
                        <td className={`px-2 py-2 text-right font-mono ${t.pnlPercent >= 0 ? "text-gain" : "text-loss"}`}>{t.pnlPercent >= 0 ? "+" : ""}{t.pnlPercent.toFixed(2)}%</td>
                        <td className="px-2 py-2 text-zinc-600">{t.exitReason}</td>
                        <td className="px-2 py-2 text-right text-zinc-600">{t.barsHeld}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(viewMode === "both" || viewMode === "chart") && (
            <div className="rounded-panel border border-border bg-panel p-4">
              <h3 className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">
                <LineChart size={12} className="text-zinc-600" /> Equity Chart
              </h3>
              <div ref={chartContainerRef} className="w-full" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color = "zinc" }: { label: string; value: string | number; icon: React.ElementType; color?: string }) {
  const colors: Record<string, string> = { gain: "text-gain", loss: "text-loss", zinc: "text-zinc-100" };
  return (
    <div className="rounded-panel border border-border bg-panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={12} className="text-zinc-600" />
        <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      </div>
      <p className={`font-mono text-xl font-semibold ${colors[color] || "text-zinc-100"}`}>{value}</p>
    </div>
  );
}