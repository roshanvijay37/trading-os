/**
 * TradingOS — Backtest Lab
 * Merged Backtest + Visual Backtest
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { createChart, ColorType, IChartApi, Time, LineStyle } from "lightweight-charts";
import { Play, RotateCcw, TrendingUp, TrendingDown, Shield, BarChart3, Table, LineChart, Eye, Download, Filter } from "lucide-react";
import { backtestApi } from "../services/api";
import { downloadBacktestPdf } from "../lib/backtestPdfReport";
import { computeBacktestAnalytics, filterTradesByDate, type DateFilterPreset } from "../lib/backtestAnalytics";

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
  sl?: number; // index level of the stop-loss (for the candle-chart overlay)
  target?: number; // index level of the target
  riskAtEntry?: number; // rupees risked at entry — feeds R-multiple stats
}

interface EquityPoint {
  date: string;
  equity: number;
}

interface Candle {
  timestamp: number; // epoch ms
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface BacktestResult {
  success: boolean;
  symbol: string;
  instrumentSource?: "INDEX" | "FUTURES";
  tradedSymbol?: string; // exact symbol candles were fetched for (differs from `symbol` in FUTURES mode)
  summary: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalReturn: number;
    totalPnL: number;
    maxDrawdown: number;
    profitFactor: number; // gross profit / gross loss (standard definition)
    payoffRatio: number; // avg win / avg loss (what this codebase used to mislabel as profitFactor)
    avgWin: number;
    avgLoss: number;
    finalCapital: number;
  };
  advanced?: {
    streaks: {
      maxConsecutiveWins: number;
      maxConsecutiveLosses: number;
      currentStreak: number; // signed: +3 = on a 3-win streak, -2 = on a 2-loss streak
      winStreakHistogram: Record<string, number>;
      lossStreakHistogram: Record<string, number>;
    };
    extremes: { largestWin: number; largestLoss: number };
    duration: { avgBarsHeldWin: number; avgBarsHeldLoss: number; avgBarsHeldAll: number };
    exitReasons: Record<string, { count: number; totalPnL: number; avgPnL: number }>;
    rMultiple: { avg: number; min: number; max: number; coveredTrades: number };
    riskAdjusted: { sharpe: number; sortino: number; cagr: number; calmar: number; recoveryFactor: number };
    kellyPercent: number;
    yearly: { year: string; trades: number; winRate: number; totalPnL: number }[];
    byHourIST: { hour: number; trades: number; winRate: number; totalPnL: number }[];
    byDayOfWeek: { day: string; trades: number; winRate: number; totalPnL: number }[];
  };
  trades: Trade[];
  equityCurve: EquityPoint[];
  candles?: Candle[];
}

export function BacktestLab() {
  const [symbol, setSymbol] = useState("NSE:NIFTYBANK-INDEX");
  const [resolution, setResolution] = useState("15");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1825);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [capital, setCapital] = useState(1000000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [targetMult, setTargetMult] = useState(2);
  const [slippage, setSlippage] = useState(0.02);
  const [capitalMode, setCapitalMode] = useState<"COMPOUND" | "FIXED">("COMPOUND");
  // Live-parity risk gates — same figures the live bot's own config uses by default, but
  // editable here rather than silently hardcoded (matches the bot's own config, not a
  // separate backtest-only assumption).
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(10);
  const [maxRiskPerDayPercent, setMaxRiskPerDayPercent] = useState(2);
  // Position sizing: "RISK" scales qty with riskPercent/stop distance (this engine's original
  // behaviour). EMA5T never does that live — autoTrader.js hardcodes exactly 1 lot every trade,
  // regardless of risk%. Default to "LOTS"/1 here so a fresh backtest matches what the bot
  // actually trades; "RISK" is kept for the older risk-scaled comparison mode.
  const [positionSizingMode, setPositionSizingMode] = useState<"RISK" | "LOTS">("LOTS");
  const [fixedLots, setFixedLots] = useState(1);
  // EMA5T only: INDEX has years of history but isn't the literal traded instrument; FUTURES is
  // the actual live contract, with real availability that varies by contract (see resolveFuturesRange).
  const [instrumentSource, setInstrumentSource] = useState<"INDEX" | "FUTURES">("INDEX");
  const [resolvingRange, setResolvingRange] = useState(false);
  const [resolvedFuturesSymbol, setResolvedFuturesSymbol] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"both" | "table" | "chart" | "candles">("both");
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);
  // Post-hoc filter over an already-completed run's trades — re-slices a long multi-year result
  // (e.g. "this year only") instantly, client-side, without re-running the backtest.
  const [dateFilter, setDateFilter] = useState<DateFilterPreset>("ALL");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Post-hoc date filter: re-slice the already-completed run's trades client-side, then
  // recompute every stat for just that window — no new backend call, no re-running the sim.
  // Declared before the effects below (which depend on it) since a dependency array is evaluated
  // synchronously during render, unlike an effect's own body.
  const filteredTrades = useMemo(() => {
    if (!result) return [];
    return filterTradesByDate(result.trades || [], dateFilter, customFrom, customTo);
  }, [result, dateFilter, customFrom, customTo]);

  // The account's equity going INTO the filtered window — the equity value right after whatever
  // trade immediately precedes the window's first included trade, or the original starting
  // capital if the window starts at (or before) the very first trade in the run.
  const baselineCapital = useMemo(() => {
    if (!result || dateFilter === "ALL" || filteredTrades.length === 0) return capital;
    const allTrades = result.trades || [];
    const allEquity = result.equityCurve || [];
    const idx = allTrades.findIndex((t) => t.id === filteredTrades[0].id);
    if (idx <= 0) return capital;
    return allEquity[idx - 1]?.equity ?? capital;
  }, [result, filteredTrades, dateFilter, capital]);

  const filteredAnalytics = useMemo(() => {
    if (dateFilter === "ALL") return null;
    return computeBacktestAnalytics(filteredTrades, baselineCapital);
  }, [dateFilter, filteredTrades, baselineCapital]);

  const sum = dateFilter === "ALL" ? result?.summary : filteredAnalytics?.summary;
  const adv = dateFilter === "ALL" ? result?.advanced : filteredAnalytics?.advanced;
  const displayedEquityCurve = dateFilter === "ALL" ? (result?.equityCurve || []) : (filteredAnalytics?.equityCurve || []);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleContainerRef = useRef<HTMLDivElement>(null);
  const candleChartRef = useRef<IChartApi | null>(null);
  const prevInstrumentSourceRef = useRef(instrumentSource);

  // Futures mode: auto-fill From/To to the contract's REAL available window (resolved server-side —
  // FYERS has no "list active contracts" or date-range endpoint, so guessing dates wastes a run).
  // Switching back to Index restores the full-history default rather than leaving a short window set.
  useEffect(() => {
    const prev = prevInstrumentSourceRef.current;
    prevInstrumentSourceRef.current = instrumentSource;

    if (instrumentSource === "FUTURES") {
      let cancelled = false;
      setResolvingRange(true);
      setError(null);
      backtestApi.resolveFuturesRange(symbol)
        .then((res) => {
          if (cancelled) return;
          setFromDate(res.earliestDate);
          setToDate(res.latestDate);
          setResolvedFuturesSymbol(res.tradedSymbol);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setError(err?.message || "Could not resolve futures date range");
          setResolvedFuturesSymbol(null);
        })
        .finally(() => {
          if (!cancelled) setResolvingRange(false);
        });
      return () => {
        cancelled = true;
      };
    } else if (prev === "FUTURES") {
      const d = new Date();
      d.setDate(d.getDate() - 1825);
      setFromDate(d.toISOString().split("T")[0]);
      setToDate(new Date().toISOString().split("T")[0]);
      setResolvedFuturesSymbol(null);
    }
  }, [instrumentSource, symbol]);

  const runBacktest = async () => {
    if (!fromDate || !toDate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await backtestApi.run({
        symbol,
        resolution,
        fromDate,
        toDate,
        strategy: "EMA5T",
        capital,
        riskPercent,
        targetMultiplier: targetMult,
        // "Slippage %" → the decimal fraction the engine expects (e.g. 0.02% → 0.0002).
        slippage: slippage / 100,
        capitalMode,
        pricingModel: "INDEX",
        instrumentSource,
        maxTradesPerDay,
        maxRiskPerDayPercent,
        positionSizingMode,
        fixedLots,
      });
      setResult(res);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Backtest failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!result || !chartContainerRef.current || viewMode === "table") return;
    if (!Array.isArray(displayedEquityCurve) || displayedEquityCurve.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    try {
      const container = chartContainerRef.current;
      const width = container.clientWidth || container.offsetWidth || Math.min(window.innerWidth - 64, 800);
      if (!width || width <= 0) return;

      const chart = createChart(container, {
        layout: { background: { type: ColorType.Solid, color: "#08080a" }, textColor: "#71717a" },
        grid: { vertLines: { color: "#131318" }, horzLines: { color: "#131318" } },
        rightPriceScale: { borderColor: "#23232a" },
        timeScale: { borderColor: "#23232a" },
        width,
        height: 380,
      });

      const lineSeries = chart.addLineSeries({
        color: "#10b981",
        lineWidth: 1,
        lastValueVisible: true,
        priceLineVisible: true,
      });

      // Sanitize equity curve: validate every point, convert ISO dates to Unix timestamps (seconds),
      // deduplicate by time, and sort ascending.
      const rawLineData = displayedEquityCurve
        .filter((pt: any): pt is EquityPoint => {
          const ts = pt.date ? Math.floor(new Date(pt.date).getTime() / 1000) : NaN;
          const value = typeof pt.equity === "number" && !isNaN(pt.equity) ? pt.equity : NaN;
          return !isNaN(ts) && !isNaN(value);
        })
        .map((pt) => ({
          time: Math.floor(new Date(pt.date).getTime() / 1000) as Time,
          value: pt.equity,
        }));

      const timeMap = new Map<number, number>();
      for (const pt of rawLineData) {
        timeMap.set(pt.time as number, pt.value);
      }
      const lineData = Array.from(timeMap.entries())
        .map(([time, value]) => ({ time: time as Time, value }))
        .sort((a, b) => (a.time as number) - (b.time as number));

      if (lineData.length > 0) {
        lineSeries.setData(lineData);
      }

      // Sanitize markers: only include trades with valid entryTime and entryPrice.
      const markers = Array.isArray(filteredTrades)
        ? filteredTrades
            .filter((trade: Trade) => trade.entryTime && typeof trade.entryPrice === "number" && !isNaN(trade.entryPrice))
            .map((trade: Trade) => ({
              time: Math.floor(new Date(trade.entryTime).getTime() / 1000) as Time,
              position: (trade.side === "LONG" ? "belowBar" : "aboveBar") as any,
              color: trade.side === "LONG" ? "#10b981" : "#ef4444",
              shape: (trade.side === "LONG" ? "arrowUp" : "arrowDown") as any,
              text: `${trade.side[0]} @ ${(trade.entryPrice ?? 0).toFixed(0)}`,
              size: 1,
            }))
        : [];
      if (markers.length > 0) {
        lineSeries.setMarkers(markers);
      }

      if (lineData.length > 0) {
        chart.timeScale().fitContent();
      }
      chartRef.current = chart;

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          const w = chartContainerRef.current.clientWidth || chartContainerRef.current.offsetWidth;
          if (w > 0) chartRef.current.applyOptions({ width: w });
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
  }, [result, viewMode, displayedEquityCurve, filteredTrades]);

  // When a new result loads (or the filter changes), preselect the first VISIBLE trade so its
  // SL/target show on the candle chart.
  useEffect(() => {
    setSelectedTradeId(filteredTrades?.[0]?.id ?? null);
  }, [result, filteredTrades]);

  // Candlestick chart: the INDEX price series with per-trade entry/exit markers, plus the SL and
  // target levels of the SELECTED trade drawn as short segments spanning entry→exit. Candles and
  // SL/target are both index levels, so they overlay correctly in Index and Black-Scholes modes.
  useEffect(() => {
    if (!result || !candleContainerRef.current) return;
    if (viewMode !== "both" && viewMode !== "candles") return;
    if (!Array.isArray(result.candles) || result.candles.length === 0) return;

    if (candleChartRef.current) {
      candleChartRef.current.remove();
      candleChartRef.current = null;
    }

    try {
      const container = candleContainerRef.current;
      const width = container.clientWidth || container.offsetWidth || Math.min(window.innerWidth - 64, 800);
      if (!width || width <= 0) return;

      const chart = createChart(container, {
        layout: { background: { type: ColorType.Solid, color: "#08080a" }, textColor: "#71717a" },
        grid: { vertLines: { color: "#131318" }, horzLines: { color: "#131318" } },
        rightPriceScale: { borderColor: "#23232a" },
        timeScale: { borderColor: "#23232a", timeVisible: true, secondsVisible: false },
        width,
        height: 420,
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
        borderVisible: false,
      });

      // Candles → dedupe by time + sort ascending (multi-day FYERS fetches can overlap).
      const cmap = new Map<number, { time: Time; open: number; high: number; low: number; close: number }>();
      for (const c of result.candles) {
        const time = Math.floor((c.timestamp ?? 0) / 1000);
        if (!time || [c.open, c.high, c.low, c.close].some((v) => typeof v !== "number" || isNaN(v))) continue;
        cmap.set(time, { time: time as Time, open: c.open, high: c.high, low: c.low, close: c.close });
      }
      const candleData = Array.from(cmap.values()).sort((a, b) => (a.time as number) - (b.time as number));
      if (candleData.length === 0) return;
      candleSeries.setData(candleData);

      // Entry (▲ long / ▼ short) + exit (● green win / red loss) markers — only for trades
      // currently within the applied date filter (candles themselves still span the full run).
      const markers = (filteredTrades || [])
        .filter((t) => t.entryTime && t.exitTime)
        .flatMap((t) => {
          const win = (t.pnl ?? 0) >= 0;
          const et = Math.floor(new Date(t.entryTime).getTime() / 1000);
          const xt = Math.floor(new Date(t.exitTime).getTime() / 1000);
          return [
            { time: et as Time, position: (t.side === "LONG" ? "belowBar" : "aboveBar") as any, color: t.side === "LONG" ? "#10b981" : "#ef4444", shape: (t.side === "LONG" ? "arrowUp" : "arrowDown") as any, text: `${t.side[0]}#${t.id}`, size: 1 },
            { time: xt as Time, position: (t.side === "LONG" ? "aboveBar" : "belowBar") as any, color: win ? "#10b981" : "#ef4444", shape: "circle" as any, text: `${t.exitReason} ${win ? "+" : ""}${(t.pnl ?? 0).toFixed(0)}`, size: 1 },
          ];
        })
        .sort((a, b) => (a.time as number) - (b.time as number));
      if (markers.length) candleSeries.setMarkers(markers);

      // SL (red) + target (green) of the selected trade, spanning its entry→exit.
      const sel = (filteredTrades || []).find((t) => t.id === selectedTradeId);
      if (sel && sel.entryTime && sel.exitTime) {
        const et = Math.floor(new Date(sel.entryTime).getTime() / 1000);
        const xt = Math.floor(new Date(sel.exitTime).getTime() / 1000);
        const drawLevel = (level: number | undefined, color: string) => {
          if (typeof level !== "number" || isNaN(level) || xt <= et) return;
          const s = chart.addLineSeries({ color, lineWidth: 2, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
          s.setData([{ time: et as Time, value: level }, { time: xt as Time, value: level }]);
        };
        drawLevel(sel.sl, "#ef4444");
        drawLevel(sel.target, "#10b981");
      }

      chart.timeScale().fitContent();
      candleChartRef.current = chart;

      const handleResize = () => {
        if (candleContainerRef.current && candleChartRef.current) {
          const w = candleContainerRef.current.clientWidth || candleContainerRef.current.offsetWidth;
          if (w > 0) candleChartRef.current.applyOptions({ width: w });
        }
      };
      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
        if (candleChartRef.current) {
          candleChartRef.current.remove();
          candleChartRef.current = null;
        }
      };
    } catch (err) {
      console.error("[BacktestLab] Candle chart error:", err);
    }
  }, [result, viewMode, selectedTradeId, filteredTrades]);

  // Shareable PDF: aggregate performance numbers only — no strategy name, timeframe, rule
  // mechanics, exit-reason/time-of-day breakdowns, or per-trade log (see backtestPdfReport.ts
  // for exactly what's deliberately left out and why). Reflects whatever filter is currently
  // applied, so "download PDF" always matches what's on screen.
  const handleDownloadPdf = () => {
    if (!result || !sum) return;
    const periodFrom = dateFilter === "ALL" ? fromDate : filteredTrades[0]?.exitTime.slice(0, 10) || fromDate;
    const periodTo = dateFilter === "ALL" ? toDate : filteredTrades[filteredTrades.length - 1]?.exitTime.slice(0, 10) || toDate;
    downloadBacktestPdf({
      summary: sum,
      advanced: adv,
      equityCurve: displayedEquityCurve,
      symbol,
      fromDate: periodFrom,
      toDate: periodTo,
      capital: dateFilter === "ALL" ? capital : baselineCapital,
    });
  };

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
            </select>
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Strategy</label>
            <div className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-400">5 EMA Trend (EMA5T)</div>
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Data Source</label>
            <select value={instrumentSource} onChange={(e) => setInstrumentSource(e.target.value as "INDEX" | "FUTURES")} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover">
              <option value="INDEX">Index (full history)</option>
              <option value="FUTURES">Futures (current contract only)</option>
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
          {instrumentSource === "FUTURES" && (
            <div className="sm:col-span-2 lg:col-span-4 -mt-1 rounded-panel border border-border-subtle bg-surface px-3 py-2 text-3xs text-zinc-500">
              {resolvingRange
                ? "Resolving the current contract and its available date range…"
                : resolvedFuturesSymbol
                ? <>From/To auto-set to the real available window for <span className="font-mono text-zinc-300">{resolvedFuturesSymbol}</span> — narrow it further if you want, but it won't go any wider than this.</>
                : "Futures history is limited to the current contract's lifetime — From/To will auto-fill once resolved."}
            </div>
          )}
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Resolution</label>
            <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover">
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Capital (₹)</label>
            <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Position Sizing</label>
            <select value={positionSizingMode} onChange={(e) => setPositionSizingMode(e.target.value as "RISK" | "LOTS")} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover">
              <option value="LOTS">Fixed Lots (matches live)</option>
              <option value="RISK">Risk % (scales with capital)</option>
            </select>
          </div>
          {positionSizingMode === "RISK" ? (
            <div>
              <label className="mb-1 block text-2xs text-zinc-600">Risk %</label>
              <input type="number" step="0.1" value={riskPercent} onChange={(e) => setRiskPercent(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-2xs text-zinc-600">Lots Per Trade</label>
              <input type="number" min="1" max="100" value={fixedLots} onChange={(e) => setFixedLots(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
            </div>
          )}
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
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Max Trades/Day</label>
            <input type="number" min="1" max="100" value={maxTradesPerDay} onChange={(e) => setMaxTradesPerDay(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-zinc-600">Daily Loss Limit %</label>
            <input type="number" step="0.1" min="0.5" max="10" value={maxRiskPerDayPercent} onChange={(e) => setMaxRiskPerDayPercent(Number(e.target.value))} className="w-full rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover" />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button onClick={runBacktest} disabled={loading || resolvingRange} className="flex-1 rounded-panel border border-gain/20 bg-gain-dim py-2 text-2xs font-medium text-gain transition hover:bg-gain/20 disabled:opacity-50">
              {loading ? "Running..." : resolvingRange ? "Resolving..." : <span className="flex items-center justify-center gap-2"><Play size={12} /> Run</span>}
            </button>
            <button onClick={() => { setResult(null); setError(null); }} className="rounded-panel border border-border-subtle bg-surface p-2 text-zinc-500 hover:text-zinc-300">
              <RotateCcw size={12} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-panel border border-loss/20 bg-loss-dim px-3 py-2 text-2xs text-loss">{error}</div>
      )}

      {/* Date Filter — re-slices the already-completed run's trades/stats client-side */}
      {result && (
        <div className="flex flex-wrap items-center gap-2 rounded-panel border border-border-subtle bg-panel px-3 py-2">
          <span className="flex items-center gap-1.5 text-2xs text-zinc-500">
            <Filter size={11} /> View period
          </span>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilterPreset)}
            className="rounded-panel border border-border-subtle bg-surface px-2 py-1 text-2xs text-zinc-200 outline-none focus:border-border-hover"
          >
            <option value="ALL">All time</option>
            <option value="THIS_YEAR">This year</option>
            <option value="LAST_12M">Last 12 months</option>
            <option value="LAST_3M">Last 3 months</option>
            <option value="CUSTOM">Custom range</option>
          </select>
          {dateFilter === "CUSTOM" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-panel border border-border-subtle bg-surface px-2 py-1 text-2xs text-zinc-200 outline-none focus:border-border-hover"
              />
              <span className="text-2xs text-zinc-600">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-panel border border-border-subtle bg-surface px-2 py-1 text-2xs text-zinc-200 outline-none focus:border-border-hover"
              />
            </>
          )}
          {dateFilter !== "ALL" && (
            <span className="text-2xs text-zinc-600">
              {filteredTrades.length} of {result.trades?.length ?? 0} trades shown
            </span>
          )}
        </div>
      )}

      {/* View Toggle */}
      {result && (
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex gap-1.5">
            {[
              { key: "both", label: "Both", icon: Eye },
              { key: "candles", label: "Candles", icon: BarChart3 },
              { key: "table", label: "Table", icon: Table },
              { key: "chart", label: "Equity", icon: LineChart },
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
          <button
            onClick={handleDownloadPdf}
            title="Download a shareable PDF — performance numbers only, no strategy details"
            className="flex items-center gap-1.5 rounded-panel border border-border-subtle bg-panel px-3 py-1.5 text-2xs text-zinc-400 transition hover:border-border-hover hover:text-zinc-200"
          >
            <Download size={11} /> Download PDF
          </button>
        </div>
      )}

      {/* Results */}
      {result && sum && (
        <>
          <div className="rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-500">
            {result.instrumentSource === "FUTURES" ? (
              <>
                <span className="font-semibold text-zinc-300">Futures model.</span> Traded on the actual contract <span className="font-mono text-zinc-300">{result.tradedSymbol}</span> — the literal live instrument, but only a short recent window (FYERS has no expired-contract history).
              </>
            ) : (
              <>
                <span className="font-semibold text-zinc-300">Index model.</span> P&amp;L is on the index in points — not the same as the futures contract's P&amp;L (contract point value &amp; basis differ). Switch Data Source to Futures for the exact instrument (short history only).
              </>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Total Trades" value={sum.totalTrades} icon={BarChart3} />
            <SummaryCard label="Win Rate" value={`${sum.winRate.toFixed(1)}%`} icon={sum.winRate >= 50 ? TrendingUp : TrendingDown} color={sum.winRate >= 50 ? "gain" : "loss"} />
            <SummaryCard label="Total Return" value={`${sum.totalReturn >= 0 ? "+" : ""}${sum.totalReturn.toFixed(2)}%`} icon={sum.totalReturn >= 0 ? TrendingUp : TrendingDown} color={sum.totalReturn >= 0 ? "gain" : "loss"} />
            <SummaryCard label="Max Drawdown" value={`${sum.maxDrawdown.toFixed(2)}%`} icon={Shield} color="loss" />
          </div>

          {adv && (
            <div className="space-y-4">
              <div>
                <h3 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-zinc-400">Performance Ratios</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryCard label="Profit Factor" value={sum.profitFactor.toFixed(2)} icon={sum.profitFactor >= 1 ? TrendingUp : TrendingDown} color={sum.profitFactor >= 1 ? "gain" : "loss"} />
                  <SummaryCard label="Payoff Ratio" value={sum.payoffRatio.toFixed(2)} icon={BarChart3} />
                  <SummaryCard label="Avg R-Multiple" value={`${adv.rMultiple.avg >= 0 ? "+" : ""}${adv.rMultiple.avg.toFixed(2)}R`} icon={adv.rMultiple.avg >= 0 ? TrendingUp : TrendingDown} color={adv.rMultiple.avg >= 0 ? "gain" : "loss"} />
                  <SummaryCard label="Kelly % (advisory)" value={`${adv.kellyPercent.toFixed(1)}%`} icon={Shield} />
                </div>
                <p className="mt-1.5 text-3xs text-zinc-600">
                  Profit Factor = gross profit ÷ gross loss. Payoff Ratio = avg win ÷ avg loss. R-multiple normalizes P&amp;L by the risk taken per trade ({adv.rMultiple.coveredTrades}/{sum.totalTrades} trades have a recorded risk amount). Kelly % is the raw full-Kelly figure — practitioners typically size at half-Kelly or less, not this number directly.
                </p>
              </div>

              <div>
                <h3 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-zinc-400">Risk-Adjusted Returns</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <SummaryCard label="Sharpe" value={adv.riskAdjusted.sharpe.toFixed(2)} icon={TrendingUp} />
                  <SummaryCard label="Sortino" value={adv.riskAdjusted.sortino.toFixed(2)} icon={TrendingUp} />
                  <SummaryCard label="CAGR" value={`${adv.riskAdjusted.cagr.toFixed(2)}%`} icon={adv.riskAdjusted.cagr >= 0 ? TrendingUp : TrendingDown} color={adv.riskAdjusted.cagr >= 0 ? "gain" : "loss"} />
                  <SummaryCard label="Calmar" value={adv.riskAdjusted.calmar.toFixed(2)} icon={Shield} />
                  <SummaryCard label="Recovery Factor" value={adv.riskAdjusted.recoveryFactor.toFixed(2)} icon={Shield} />
                </div>
                <p className="mt-1.5 text-3xs text-zinc-600">
                  Sharpe/Sortino are annualized from daily P&amp;L (252-trading-day convention), relative to starting capital. CAGR is annualized over the tested date range. Calmar = CAGR ÷ Max Drawdown. Recovery Factor = Total Return % ÷ Max Drawdown %.
                </p>
              </div>

              <div>
                <h3 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-zinc-400">Streaks</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <SummaryCard label="Max Consec. Wins" value={adv.streaks.maxConsecutiveWins} icon={TrendingUp} color="gain" />
                  <SummaryCard label="Max Consec. Losses" value={adv.streaks.maxConsecutiveLosses} icon={TrendingDown} color="loss" />
                  <SummaryCard
                    label="Current Streak"
                    value={adv.streaks.currentStreak === 0 ? "—" : `${adv.streaks.currentStreak > 0 ? "+" : ""}${adv.streaks.currentStreak}`}
                    icon={adv.streaks.currentStreak >= 0 ? TrendingUp : TrendingDown}
                    color={adv.streaks.currentStreak >= 0 ? "gain" : "loss"}
                  />
                  <SummaryCard label="Largest Win" value={`₹${adv.extremes.largestWin.toLocaleString("en-IN")}`} icon={TrendingUp} color="gain" />
                  <SummaryCard label="Largest Loss" value={`₹${adv.extremes.largestLoss.toLocaleString("en-IN")}`} icon={TrendingDown} color="loss" />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <StreakHistogramTable title="Losing streaks (length → occurrences)" histogram={adv.streaks.lossStreakHistogram} tone="loss" />
                  <StreakHistogramTable title="Winning streaks (length → occurrences)" histogram={adv.streaks.winStreakHistogram} tone="gain" />
                </div>
              </div>

              <div className="rounded-panel border border-border bg-panel p-4">
                <h3 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-zinc-400">Exit Reason Breakdown</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-2xs">
                    <thead>
                      <tr className="border-b border-border text-zinc-600">
                        <th className="px-2 py-2 text-left font-medium">Reason</th>
                        <th className="px-2 py-2 text-right font-medium">Count</th>
                        <th className="px-2 py-2 text-right font-medium">Avg P&amp;L</th>
                        <th className="px-2 py-2 text-right font-medium">Total P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(adv.exitReasons).map(([reason, r]) => (
                        <tr key={reason} className="border-b border-border-subtle">
                          <td className="px-2 py-2 text-zinc-300">{reason}</td>
                          <td className="px-2 py-2 text-right text-zinc-400">{r.count}</td>
                          <td className={`px-2 py-2 text-right font-mono ${r.avgPnL >= 0 ? "text-gain" : "text-loss"}`}>₹{r.avgPnL.toLocaleString("en-IN")}</td>
                          <td className={`px-2 py-2 text-right font-mono ${r.totalPnL >= 0 ? "text-gain" : "text-loss"}`}>₹{r.totalPnL.toLocaleString("en-IN")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-3xs text-zinc-600">
                  Avg hold: {adv.duration.avgBarsHeldWin.toFixed(1)} bars on wins, {adv.duration.avgBarsHeldLoss.toFixed(1)} bars on losses ({adv.duration.avgBarsHeldAll.toFixed(1)} overall).
                </p>
              </div>

              {adv.yearly.length > 1 && (
                <div className="rounded-panel border border-border bg-panel p-4">
                  <h3 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-zinc-400">Yearly Consistency</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-2xs">
                      <thead>
                        <tr className="border-b border-border text-zinc-600">
                          <th className="px-2 py-2 text-left font-medium">Year</th>
                          <th className="px-2 py-2 text-right font-medium">Trades</th>
                          <th className="px-2 py-2 text-right font-medium">Win Rate</th>
                          <th className="px-2 py-2 text-right font-medium">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adv.yearly.map((y) => (
                          <tr key={y.year} className="border-b border-border-subtle">
                            <td className="px-2 py-2 text-zinc-300">{y.year}</td>
                            <td className="px-2 py-2 text-right text-zinc-400">{y.trades}</td>
                            <td className="px-2 py-2 text-right text-zinc-400">{y.winRate.toFixed(1)}%</td>
                            <td className={`px-2 py-2 text-right font-mono ${y.totalPnL >= 0 ? "text-gain" : "text-loss"}`}>₹{y.totalPnL.toLocaleString("en-IN")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-3xs text-zinc-600">Is the edge consistent every year, or carried by one good year? A useful cross-check against curve-fitting.</p>
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-panel border border-border bg-panel p-4">
                  <h3 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-zinc-400">By Entry Hour (IST)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-2xs">
                      <thead>
                        <tr className="border-b border-border text-zinc-600">
                          <th className="px-2 py-2 text-left font-medium">Hour</th>
                          <th className="px-2 py-2 text-right font-medium">Trades</th>
                          <th className="px-2 py-2 text-right font-medium">Win Rate</th>
                          <th className="px-2 py-2 text-right font-medium">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adv.byHourIST.map((h) => (
                          <tr key={h.hour} className="border-b border-border-subtle">
                            <td className="px-2 py-2 text-zinc-300">{h.hour}:00</td>
                            <td className="px-2 py-2 text-right text-zinc-400">{h.trades}</td>
                            <td className="px-2 py-2 text-right text-zinc-400">{h.winRate.toFixed(1)}%</td>
                            <td className={`px-2 py-2 text-right font-mono ${h.totalPnL >= 0 ? "text-gain" : "text-loss"}`}>₹{h.totalPnL.toLocaleString("en-IN")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-panel border border-border bg-panel p-4">
                  <h3 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-zinc-400">By Day of Week</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-2xs">
                      <thead>
                        <tr className="border-b border-border text-zinc-600">
                          <th className="px-2 py-2 text-left font-medium">Day</th>
                          <th className="px-2 py-2 text-right font-medium">Trades</th>
                          <th className="px-2 py-2 text-right font-medium">Win Rate</th>
                          <th className="px-2 py-2 text-right font-medium">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adv.byDayOfWeek.map((d) => (
                          <tr key={d.day} className="border-b border-border-subtle">
                            <td className="px-2 py-2 text-zinc-300">{d.day}</td>
                            <td className="px-2 py-2 text-right text-zinc-400">{d.trades}</td>
                            <td className="px-2 py-2 text-right text-zinc-400">{d.winRate.toFixed(1)}%</td>
                            <td className={`px-2 py-2 text-right font-mono ${d.totalPnL >= 0 ? "text-gain" : "text-loss"}`}>₹{d.totalPnL.toLocaleString("en-IN")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(viewMode === "both" || viewMode === "candles") && result.candles && result.candles.length > 0 && (
            <div className="rounded-panel border border-border bg-panel p-4">
              <h3 className="mb-3 flex flex-wrap items-center justify-between gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">
                <span className="flex items-center gap-2"><BarChart3 size={12} className="text-zinc-600" /> Price &amp; Trades</span>
                <span className="flex flex-wrap items-center gap-3 text-3xs normal-case tracking-normal text-zinc-500">
                  <span><span className="text-gain">▲</span> long</span>
                  <span><span className="text-loss">▼</span> short</span>
                  <span><span className="text-gain">●</span>/<span className="text-loss">●</span> exit win/loss</span>
                  <span className="text-loss">- - SL</span>
                  <span className="text-gain">- - target</span>
                </span>
              </h3>
              <div ref={candleContainerRef} className="w-full" />
              <p className="mt-2 text-3xs text-zinc-600">
                Click a trade row below to highlight its stop-loss &amp; target on the chart.
              </p>
            </div>
          )}

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
                    {Array.isArray(filteredTrades) && filteredTrades.map((t: Trade) => (
                      <tr key={t.id} onClick={() => setSelectedTradeId(t.id)} className={`cursor-pointer border-b border-border-subtle transition ${selectedTradeId === t.id ? "bg-surface" : "hover:bg-surface/50"}`}>
                        <td className="px-2 py-2 text-zinc-600">{t.id}</td>
                        <td className="px-2 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-2xs font-medium ${t.side === "LONG" ? "bg-gain-dim text-gain" : "bg-loss-dim text-loss"}`}>{t.side}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-zinc-300">{(t.entryPrice ?? 0).toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-mono text-zinc-300">{(t.exitPrice ?? 0).toFixed(2)}</td>
                        <td className={`px-2 py-2 text-right font-mono ${t.pnl >= 0 ? "text-gain" : "text-loss"}`}>{t.pnl >= 0 ? "+" : ""}{(t.pnl ?? 0).toFixed(0)}</td>
                        <td className={`px-2 py-2 text-right font-mono ${t.pnlPercent >= 0 ? "text-gain" : "text-loss"}`}>{t.pnlPercent >= 0 ? "+" : ""}{(t.pnlPercent ?? 0).toFixed(2)}%</td>
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

function StreakHistogramTable({ title, histogram, tone }: { title: string; histogram: Record<string, number>; tone: "gain" | "loss" }) {
  const entries = Object.entries(histogram)
    .map(([len, count]) => ({ len: Number(len), count }))
    .sort((a, b) => a.len - b.len);
  return (
    <div className="rounded-panel border border-border bg-panel p-4">
      <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h4>
      {entries.length === 0 ? (
        <p className="text-2xs text-zinc-600">None</p>
      ) : (
        <div className="space-y-1">
          {entries.map((e) => (
            <div key={e.len} className="flex items-center gap-2 text-2xs">
              <span className="w-16 text-zinc-500">{e.len} in a row</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-surface">
                <div
                  className={`h-full ${tone === "gain" ? "bg-gain/50" : "bg-loss/50"}`}
                  style={{ width: `${Math.min(100, (e.count / Math.max(...entries.map((x) => x.count))) * 100)}%` }}
                />
              </div>
              <span className="w-8 text-right text-zinc-400">{e.count}×</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
