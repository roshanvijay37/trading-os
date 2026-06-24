import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time } from "lightweight-charts";
import { Play, BarChart3, TrendingUp, TrendingDown, Target, Shield, Activity, Zap, Calendar, Clock, Layers } from "lucide-react";
import { backtestApi } from "../services/api";

const strategies = [
  { value: "RSI", label: "RSI 2-Period", desc: "Mean reversion" },
  { value: "EMA5", label: "5 EMA", desc: "Alert Candle breakout" },
  { value: "EMA5_OPTION", label: "5 EMA Option", desc: "Trend + 5 EMA" },
  { value: "TRAFFIC_LIGHT", label: "Traffic Light", desc: "Pullback continuation" },
  { value: "INSIDE_CANDLE", label: "Inside Candle", desc: "Mother/Inside BO" },
  { value: "VWAP_REVERSAL", label: "VWAP Reversal", desc: "Reclaim with volume" },
  { value: "ORB", label: "ORB", desc: "Opening range breakout" },
  { value: "CPR_BREAKOUT", label: "CPR Breakout", desc: "Pivot + volume" },
  { value: "EMA9_20", label: "9/20 EMA", desc: "Pullback to 9 EMA" },
  { value: "FAILED_BREAKOUT", label: "Failed BO", desc: "Support reclaim" },
  { value: "OPENING_MOMENTUM", label: "Opening Momentum", desc: "9:20 momentum" },
];

const timeframes = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "D", label: "Daily" },
];

interface ChartState {
  result: any;
  loading: boolean;
  error: string;
}

export function VisualBacktest() {
  const [strategy, setStrategy] = useState("EMA5");
  const [resolution, setResolution] = useState("15");
  const [fromDate, setFromDate] = useState("2026-05-01");
  const [toDate, setToDate] = useState("2026-06-24");
  const [capital, setCapital] = useState(1000000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [targetMult, setTargetMult] = useState(2);
  const [running, setRunning] = useState(false);

  const [nifty, setNifty] = useState<ChartState>({ result: null, loading: false, error: "" });
  const [bankNifty, setBankNifty] = useState<ChartState>({ result: null, loading: false, error: "" });

  const niftyChartRef = useRef<HTMLDivElement>(null);
  const bankNiftyChartRef = useRef<HTMLDivElement>(null);
  const niftyChartApi = useRef<IChartApi | null>(null);
  const bankNiftyChartApi = useRef<IChartApi | null>(null);
  const niftySeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bankNiftySeries = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Initialize charts
  useEffect(() => {
    const initChart = (container: HTMLDivElement, chartRef: React.MutableRefObject<IChartApi | null>, seriesRef: React.MutableRefObject<ISeriesApi<"Candlestick"> | null>) => {
      if (!container || chartRef.current) return;
      
      const chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: "#0c0c0e" },
          textColor: "#71717a",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "#1a1a1e" },
          horzLines: { color: "#1a1a1e" },
        },
        rightPriceScale: { 
          borderColor: "#27272a",
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: { 
          borderColor: "#27272a", 
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: 1,
          vertLine: { color: "#3f3f46", width: 1, style: 2 },
          horzLine: { color: "#3f3f46", width: 1, style: 2 },
        },
        width: container.clientWidth,
        height: 420,
      });
      
      chartRef.current = chart;
      seriesRef.current = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
    };

    if (niftyChartRef.current) initChart(niftyChartRef.current, niftyChartApi, niftySeries);
    if (bankNiftyChartRef.current) initChart(bankNiftyChartRef.current, bankNiftyChartApi, bankNiftySeries);

    const handleResize = () => {
      if (niftyChartRef.current && niftyChartApi.current) {
        niftyChartApi.current.applyOptions({ width: niftyChartRef.current.clientWidth });
      }
      if (bankNiftyChartRef.current && bankNiftyChartApi.current) {
        bankNiftyChartApi.current.applyOptions({ width: bankNiftyChartRef.current.clientWidth });
      }
    };
    
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const renderTradesOnChart = (series: ISeriesApi<"Candlestick">, trades: any[]) => {
    if (!trades?.length) return;

    const markers = trades.flatMap((t: any) => {
      const entryTime = Math.floor(new Date(t.entryTime).getTime() / 1000) as Time;
      const exitTime = Math.floor(new Date(t.exitTime).getTime() / 1000) as Time;
      return [
        {
          time: entryTime,
          position: t.side === "LONG" ? "belowBar" : "aboveBar",
          color: t.side === "LONG" ? "#22c55e" : "#ef4444",
          shape: t.side === "LONG" ? "arrowUp" : "arrowDown",
          text: `${t.side}`,
          size: 2,
        },
        {
          time: exitTime,
          position: t.pnl >= 0 ? "aboveBar" : "belowBar",
          color: t.pnl >= 0 ? "#22c55e" : "#ef4444",
          shape: "square",
          text: `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}`,
          size: 1,
        },
      ];
    });

    // @ts-ignore
    series.setMarkers(markers);
  };

  const runBacktest = async () => {
    setRunning(true);
    setNifty({ result: null, loading: true, error: "" });
    setBankNifty({ result: null, loading: true, error: "" });

    try {
      const [niftyData, bankNiftyData] = await Promise.all([
        backtestApi.run({
          symbol: "NSE:NIFTY50-INDEX",
          resolution,
          fromDate,
          toDate,
          strategy,
          capital,
          riskPercent,
          targetMultiplier: targetMult,
        }),
        backtestApi.run({
          symbol: "NSE:NIFTYBANK-INDEX",
          resolution,
          fromDate,
          toDate,
          strategy,
          capital,
          riskPercent,
          targetMultiplier: targetMult,
        }),
      ]);

      setNifty({ result: niftyData, loading: false, error: "" });
      setBankNifty({ result: bankNiftyData, loading: false, error: "" });

      // Render Nifty
      if (niftySeries.current && niftyData.candles?.length > 0) {
        const candles: CandlestickData[] = niftyData.candles.map((c: any) => ({
          time: Math.floor(new Date(c.datetime).getTime() / 1000) as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        niftySeries.current.setData(candles);
        if (niftyData.trades?.length > 0) {
          renderTradesOnChart(niftySeries.current, niftyData.trades);
        }
        setTimeout(() => niftyChartApi.current?.timeScale().fitContent(), 100);
      }

      // Render Bank Nifty
      if (bankNiftySeries.current && bankNiftyData.candles?.length > 0) {
        const candles: CandlestickData[] = bankNiftyData.candles.map((c: any) => ({
          time: Math.floor(new Date(c.datetime).getTime() / 1000) as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        bankNiftySeries.current.setData(candles);
        if (bankNiftyData.trades?.length > 0) {
          renderTradesOnChart(bankNiftySeries.current, bankNiftyData.trades);
        }
        setTimeout(() => bankNiftyChartApi.current?.timeScale().fitContent(), 100);
      }
    } catch (err: any) {
      setNifty({ result: null, loading: false, error: err.message });
      setBankNifty({ result: null, loading: false, error: err.message });
    } finally {
      setRunning(false);
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  const MetricCard = ({ icon, label, value, color }: { icon: any; label: string; value: string; color: string }) => {
    const colorMap: Record<string, string> = {
      green: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      red: "text-rose-400 bg-rose-500/10 border-rose-500/20",
      blue: "text-sky-400 bg-sky-500/10 border-sky-500/20",
      amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      zinc: "text-zinc-400 bg-zinc-800 border-zinc-700",
    };
    
    return (
      <div className={`rounded-lg border p-3 ${colorMap[color] || colorMap.zinc}`}>
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-[10px] font-medium opacity-70 uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-lg font-bold">{value}</div>
      </div>
    );
  };

  const ChartPanel = ({ title, symbol, state, chartRef }: { title: string; symbol: string; state: ChartState; chartRef: React.RefObject<HTMLDivElement> }) => {
    const s = state.result?.summary;
    
    return (
      <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-lime-400" />
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            <span className="text-xs text-zinc-500">{symbol}</span>
          </div>
          {state.loading && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <div className="w-3 h-3 border-2 border-zinc-600 border-t-lime-400 rounded-full animate-spin" />
              Loading...
            </div>
          )}
        </div>

        {/* Chart */}
        <div ref={chartRef} className="w-full" style={{ height: 420 }} />

        {/* Stats */}
        {s && (
          <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/50">
            <div className="grid grid-cols-5 gap-2">
              <MetricCard 
                icon={<TrendingUp size={14} />} 
                label="Return" 
                value={`${s.totalReturn >= 0 ? "+" : ""}${s.totalReturn.toFixed(1)}%`} 
                color={s.totalReturn >= 0 ? "green" : "red"} 
              />
              <MetricCard 
                icon={<Target size={14} />} 
                label="Win Rate" 
                value={`${s.winRate.toFixed(0)}%`} 
                color="blue" 
              />
              <MetricCard 
                icon={<Activity size={14} />} 
                label="Trades" 
                value={`${s.totalTrades}`} 
                color="zinc" 
              />
              <MetricCard 
                icon={<BarChart3 size={14} />} 
                label="Profit Factor" 
                value={s.profitFactor.toFixed(2)} 
                color={s.profitFactor >= 1 ? "green" : "red"} 
              />
              <MetricCard 
                icon={<Shield size={14} />} 
                label="Expectancy" 
                value={`₹${s.expectancy?.toFixed(0) || 0}`} 
                color="amber" 
              />
            </div>
          </div>
        )}

        {state.error && (
          <div className="px-4 py-3 border-t border-rose-500/20 bg-rose-500/5 text-xs text-rose-300">
            {state.error}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Zap size={24} className="text-lime-400" />
            Visual Backtest
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            See exact entry and exit points on Nifty & Bank Nifty charts
          </p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Strategy */}
          <div className="min-w-[200px]">
            <label className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
              <Layers size={12} />
              Strategy
            </label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-lime-400 transition"
            >
              {strategies.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-zinc-600">
              {strategies.find(s => s.value === strategy)?.desc}
            </p>
          </div>

          {/* Timeframe */}
          <div>
            <label className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
              <Clock size={12} />
              Timeframe
            </label>
            <div className="flex gap-1">
              {timeframes.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setResolution(t.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                    resolution === t.value
                      ? "bg-lime-400 text-zinc-950"
                      : "bg-zinc-900 text-zinc-400 border border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date Range */}
          <div>
            <label className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
              <Calendar size={12} />
              Period
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-lime-400"
              />
              <span className="text-zinc-600">→</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-lime-400"
              />
            </div>
          </div>

          {/* Capital */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-zinc-400 uppercase tracking-wide">Capital</label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              step={100000}
              className="w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-lime-400"
            />
          </div>

          {/* R:R */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-zinc-400 uppercase tracking-wide">R:R</label>
            <input
              type="number"
              value={targetMult}
              onChange={(e) => setTargetMult(Number(e.target.value))}
              step={0.5}
              className="w-16 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none focus:border-lime-400"
            />
          </div>

          {/* Run Button */}
          <button
            onClick={runBacktest}
            disabled={running}
            className="ml-auto flex items-center gap-2 rounded-lg bg-lime-400 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? (
              <>
                <div className="w-4 h-4 border-2 border-zinc-800 border-t-transparent rounded-full animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play size={16} fill="currentColor" />
                Run Backtest
              </>
            )}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-emerald-500" />
          Bullish candle
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-500" />
          Bearish candle
        </span>
        <span className="flex items-center gap-1.5">
          <TrendingUp size={12} className="text-emerald-400" />
          LONG entry
        </span>
        <span className="flex items-center gap-1.5">
          <TrendingDown size={12} className="text-red-400" />
          SHORT entry
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-emerald-400" />
          Win exit
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-red-400" />
          Loss exit
        </span>
      </div>

      {/* Charts */}
      <div className="space-y-4">
        <ChartPanel 
          title="Nifty 50" 
          symbol="NSE:NIFTY50-INDEX" 
          state={nifty} 
          chartRef={niftyChartRef} 
        />
        <ChartPanel 
          title="Bank Nifty" 
          symbol="NSE:NIFTYBANK-INDEX" 
          state={bankNifty} 
          chartRef={bankNiftyChartRef} 
        />
      </div>
    </div>
  );
}