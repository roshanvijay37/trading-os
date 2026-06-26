/**
 * TradingOS — Backtest Lab
 * Merged Backtest + Visual Backtest
 * Run once. See both table and chart.
 */

import { useState, useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi } from "lightweight-charts";
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

  // Initialize chart when result changes
  useEffect(() => {
    if (!result || !chartContainerRef.current || viewMode === "table") return;
    if (!result.equityCurve || result.equityCurve.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    try {
      const chart = createChart(chartContainerRef.current, {
        layout: { background: { type: ColorType.Solid, color: "#09090b" }, textColor: "#a1a1aa" },
        grid: { vertLines: { color: "#18181b" }, horzLines: { color: "#18181b" } },
        rightPriceScale: { borderColor: "#27272a" },
        timeScale: { borderColor: "#27272a" },
        width: chartContainerRef.current.clientWidth,
        height: 400,
      });

      const lineSeries = chart.addLineSeries({
        color: "#22c55e",
        lineWidth: 2,
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
        color: trade.side === "LONG" ? "#22c55e" : "#ef4444",
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Backtest Lab</h1>
        <p className="mt-2 text-sm text-zinc-500">Run backtests. View results as table and chart.</p>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Symbol</label>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white">
              <option value="NSE:NIFTY50-INDEX">NIFTY 50</option>
              <option value="NSE:NIFTYBANK-INDEX">BANKNIFTY</option>
              <option value="NSE:FINNIFTY-INDEX">FINNIFTY</option>
              <option value="BSE:SENSEX-INDEX">SENSEX</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Strategy</label>
            <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white">
              {strategies.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Resolution</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white">
              <option value="1">1 minute</option>
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="D">Daily</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Capital (₹)</label>
            <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Risk %</label>
            <input type="number" step="0.1" value={riskPercent} onChange={(e) => setRiskPercent(Number(e.target.value))} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Target R:R</label>
            <input type="number" step="0.1" value={targetMult} onChange={(e) => setTargetMult(Number(e.target.value))} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Slippage %</label>
            <input type="number" step="0.01" value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Capital Mode</label>
            <select value={capitalMode} onChange={(e) => setCapitalMode(e.target.value as "COMPOUND" | "FIXED")} className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white">
              <option value="COMPOUND">Compounding</option>
              <option value="FIXED">Fixed</option>
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button onClick={runBacktest} disabled={loading} className="flex-1 rounded-lg bg-lime-400/10 py-2 text-sm font-medium text-lime-300 transition hover:bg-lime-400/20 disabled:opacity-50">
              {loading ? "Running..." : <span className="flex items-center justify-center gap-2"><Play size={14} /> Run</span>}
            </button>
            <button onClick={() => setResult(null)} className="rounded-lg bg-zinc-800 p-2 text-zinc-400 hover:text-white">
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* View Toggle */}
      {result && (
        <div className="flex gap-2">
          {[
            { key: "both", label: "Both", icon: Eye },
            { key: "table", label: "Table", icon: Table },
            { key: "chart", label: "Chart", icon: LineChart },
          ].map((v) => (
            <button
              key={v.key}
              onClick={() => setViewMode(v.key as any)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition ${
                viewMode === v.key ? "bg-lime-400/10 text-lime-300" : "text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <v.icon size={12} /> {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {result && sum && (
        <>
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Total Trades" value={sum.totalTrades} icon={BarChart3} />
            <SummaryCard label="Win Rate" value={`${sum.winRate.toFixed(1)}%`} icon={sum.winRate >= 50 ? TrendingUp : TrendingDown} color={sum.winRate >= 50 ? "lime" : "rose"} />
            <SummaryCard label="Total Return" value={`${sum.totalReturn >= 0 ? "+" : ""}${sum.totalReturn.toFixed(2)}%`} icon={sum.totalReturn >= 0 ? TrendingUp : TrendingDown} color={sum.totalReturn >= 0 ? "lime" : "rose"} />
            <SummaryCard label="Max Drawdown" value={`${sum.maxDrawdown.toFixed(2)}%`} icon={Shield} color="rose" />
          </div>

          {/* Table View */}
          {(viewMode === "both" || viewMode === "table") && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <h3 className="mb-3 text-sm font-medium text-white flex items-center gap-2">
                <Table size={14} className="text-zinc-500" /> Trade Log
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="px-2 py-2 text-left">#</th>
                      <th className="px-2 py-2 text-left">Side</th>
                      <th className="px-2 py-2 text-right">Entry</th>
                      <th className="px-2 py-2 text-right">Exit</th>
                      <th className="px-2 py-2 text-right">P&L</th>
                      <th className="px-2 py-2 text-right">%</th>
                      <th className="px-2 py-2 text-left">Reason</th>
                      <th className="px-2 py-2 text-right">Bars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t: Trade) => (
                      <tr key={t.id} className="border-b border-zinc-800/50">
                        <td className="px-2 py-2 text-zinc-500">{t.id}</td>
                        <td className="px-2 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${t.side === "LONG" ? "bg-lime-400/10 text-lime-300" : "bg-rose-400/10 text-rose-300"}`}>{t.side}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-zinc-300">{t.entryPrice.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono text-zinc-300">{t.exitPrice.toFixed(2)}</td>
                        <td className={`px-2 py-2 text-right font-mono ${t.pnl >= 0 ? "text-lime-300" : "text-rose-300"}`}>{t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(0)}</td>
                        <td className={`px-2 py-2 text-right font-mono ${t.pnlPercent >= 0 ? "text-lime-300" : "text-rose-300"}`}>{t.pnlPercent >= 0 ? "+" : ""}{t.pnlPercent.toFixed(2)}%</td>
                        <td className="px-2 py-2 text-zinc-500">{t.exitReason}</td>
                        <td className="px-2 py-2 text-right text-zinc-500">{t.barsHeld}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Chart View */}
          {(viewMode === "both" || viewMode === "chart") && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <h3 className="mb-3 text-sm font-medium text-white flex items-center gap-2">
                <LineChart size={14} className="text-zinc-500" /> Equity Chart
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
  const colors: Record<string, string> = { lime: "text-lime-300", rose: "text-rose-300", zinc: "text-white" };
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-zinc-500" />
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <p className={`font-mono text-xl font-semibold ${colors[color] || "text-white"}`}>{value}</p>
    </div>
  );
}