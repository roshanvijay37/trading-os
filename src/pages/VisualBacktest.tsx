import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time } from "lightweight-charts";
import { Play, BarChart3, TrendingUp, TrendingDown, Target, Shield, Activity, Zap, Calendar, Clock, Layers, Settings, Palette, X, RotateCcw, Eye } from "lucide-react";
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

interface ChartResult {
  summary: any;
  candles: any[];
  trades: any[];
}

interface ChartTheme {
  name: string;
  bg: string;
  text: string;
  grid: string;
  border: string;
  upColor: string;
  downColor: string;
  wickUp: string;
  wickDown: string;
  crosshair: string;
}

const PRESETS: Record<string, ChartTheme> = {
  midnight: {
    name: "Midnight",
    bg: "#0c0c0e",
    text: "#a1a1aa",
    grid: "#1c1c1f",
    border: "#27272a",
    upColor: "#22c55e",
    downColor: "#ef4444",
    wickUp: "#22c55e",
    wickDown: "#ef4444",
    crosshair: "#52525b",
  },
  tradingview: {
    name: "TradingView",
    bg: "#131722",
    text: "#d1d4dc",
    grid: "#2a2e39",
    border: "#2a2e39",
    upColor: "#26a69a",
    downColor: "#ef5350",
    wickUp: "#26a69a",
    wickDown: "#ef5350",
    crosshair: "#758696",
  },
  ocean: {
    name: "Ocean",
    bg: "#0a1628",
    text: "#94a3b8",
    grid: "#1e293b",
    border: "#334155",
    upColor: "#06b6d4",
    downColor: "#f43f5e",
    wickUp: "#06b6d4",
    wickDown: "#f43f5e",
    crosshair: "#64748b",
  },
  amber: {
    name: "Amber",
    bg: "#1a150f",
    text: "#d4c5b0",
    grid: "#2d2418",
    border: "#3d3220",
    upColor: "#f59e0b",
    downColor: "#ef4444",
    wickUp: "#f59e0b",
    wickDown: "#ef4444",
    crosshair: "#78716c",
  },
};

const LS_KEY = "vb-theme";

function getSavedTheme(): ChartTheme {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return PRESETS.midnight;
}

function saveTheme(t: ChartTheme) {
  localStorage.setItem(LS_KEY, JSON.stringify(t));
}

function ChartPanel({ title, symbol, result, loading, theme }: { title: string; symbol: string; result: ChartResult | null; loading: boolean; theme: ChartTheme }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const initChart = useCallback(() => {
    const container = containerRef.current;
    if (!container || chartRef.current) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: theme.bg },
        textColor: theme.text,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      rightPriceScale: { 
        borderColor: theme.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: { 
        borderColor: theme.border, 
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: theme.crosshair, width: 1, style: 2 },
        horzLine: { color: theme.crosshair, width: 1, style: 2 },
      },
      width: container.clientWidth,
      height: 420,
    });

    const series = chart.addCandlestickSeries({
      upColor: theme.upColor,
      downColor: theme.downColor,
      borderUpColor: theme.upColor,
      borderDownColor: theme.downColor,
      wickUpColor: theme.wickUp,
      wickDown: theme.wickDown,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({ width: container.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);
  }, [theme]);

  useEffect(() => {
    initChart();
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [initChart]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !result?.candles?.length) return;

    try {
      const candles: CandlestickData[] = result.candles
        .filter((c: any) => 
          c != null && c.open != null && c.high != null && c.low != null && c.close != null && c.datetime &&
          !isNaN(Number(c.open)) && !isNaN(Number(c.high)) && !isNaN(Number(c.low)) && !isNaN(Number(c.close))
        )
        .map((c: any) => ({
          time: Math.floor(new Date(c.datetime).getTime() / 1000) as Time,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        }))
        .sort((a: any, b: any) => (a.time as number) - (b.time as number));

      const uniqueCandles = candles.filter((c: any, i: number, arr: any[]) => 
        i === 0 || (arr[i - 1].time as number) !== (c.time as number)
      );

      if (uniqueCandles.length > 0) {
        series.setData(uniqueCandles);
        
        if (uniqueCandles.length > 200) {
          chart.timeScale().setVisibleLogicalRange({ 
            from: uniqueCandles.length - 200, 
            to: uniqueCandles.length - 1 
          });
        } else {
          chart.timeScale().fitContent();
        }

        if (result.trades?.length > 0) {
          const markers = result.trades.flatMap((t: any) => {
            const entryTime = Math.floor(new Date(t.entryTime).getTime() / 1000) as Time;
            const exitTime = Math.floor(new Date(t.exitTime).getTime() / 1000) as Time;
            return [
              {
                time: entryTime,
                position: t.side === "LONG" ? "belowBar" : "aboveBar",
                color: t.side === "LONG" ? theme.upColor : theme.downColor,
                shape: t.side === "LONG" ? "arrowUp" : "arrowDown",
                text: `${t.side}`,
                size: 2,
              },
              {
                time: exitTime,
                position: t.pnl >= 0 ? "aboveBar" : "belowBar",
                color: t.pnl >= 0 ? theme.upColor : theme.downColor,
                shape: "square",
                text: `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}`,
                size: 1,
              },
            ];
          });
          // @ts-ignore
          series.setMarkers(markers);
        }
      }
    } catch (err) {
      console.error(`[VisualBacktest] ${title} render error:`, err);
    }
  }, [result, title, theme]);

  const s = result?.summary;

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 backdrop-blur-sm overflow-hidden shadow-xl shadow-black/20">
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-lime-400 shadow-[0_0_8px_rgba(163,230,53,0.4)]" />
          <h2 className="text-sm font-semibold text-white tracking-wide">{title}</h2>
          <span className="text-[11px] text-zinc-500 font-mono">{symbol}</span>
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-lime-400 rounded-full animate-spin" />
            Processing...
          </div>
        )}
      </div>

      <div ref={containerRef} style={{ width: "100%", height: 420 }} />

      {s && (
        <div className="px-5 py-4 border-t border-zinc-800/60 bg-zinc-950/40">
          <div className="grid grid-cols-5 gap-3">
            <StatPill icon={<TrendingUp size={13} />} label="Return" value={`${s.totalReturn >= 0 ? "+" : ""}${s.totalReturn.toFixed(1)}%`} positive={s.totalReturn >= 0} />
            <StatPill icon={<Target size={13} />} label="Win Rate" value={`${s.winRate.toFixed(0)}%`} positive={s.winRate >= 50} />
            <StatPill icon={<Activity size={13} />} label="Trades" value={`${s.totalTrades}`} />
            <StatPill icon={<BarChart3 size={13} />} label="Profit Factor" value={s.profitFactor.toFixed(2)} positive={s.profitFactor >= 1} />
            <StatPill icon={<Shield size={13} />} label="Expectancy" value={`₹${s.expectancy?.toFixed(0) || 0}`} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatPill({ icon, label, value, positive }: { icon: any; label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/60 px-3 py-2.5 hover:border-zinc-700/60 transition-colors">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-zinc-500">{icon}</span>
        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-base font-bold ${positive === true ? "text-emerald-400" : positive === false ? "text-rose-400" : "text-zinc-200"}`}>
        {value}
      </div>
    </div>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="flex items-center gap-2">
        <input 
          type="color" 
          value={value} 
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded-lg border border-zinc-700 bg-transparent cursor-pointer"
        />
        <span className="text-[10px] font-mono text-zinc-500 uppercase">{value}</span>
      </div>
    </div>
  );
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
  const [showSettings, setShowSettings] = useState(false);

  const [theme, setTheme] = useState<ChartTheme>(getSavedTheme);

  const [niftyResult, setNiftyResult] = useState<ChartResult | null>(null);
  const [bankNiftyResult, setBankNiftyResult] = useState<ChartResult | null>(null);
  const [niftyLoading, setNiftyLoading] = useState(false);
  const [bankNiftyLoading, setBankNiftyLoading] = useState(false);

  const applyPreset = (preset: ChartTheme) => {
    setTheme({ ...preset });
    saveTheme(preset);
  };

  const updateThemeColor = (key: keyof ChartTheme, value: string) => {
    const updated = { ...theme, [key]: value };
    setTheme(updated);
    saveTheme(updated);
  };

  const runBacktest = async () => {
    setRunning(true);
    setNiftyLoading(true);
    setBankNiftyLoading(true);
    setNiftyResult(null);
    setBankNiftyResult(null);

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

      setNiftyResult(niftyData as ChartResult);
      setBankNiftyResult(bankNiftyData as ChartResult);
    } catch (err: any) {
      console.error("Backtest error:", err);
    } finally {
      setRunning(false);
      setNiftyLoading(false);
      setBankNiftyLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3 tracking-tight">
            <Zap size={28} className="text-lime-400" />
            Visual Backtest
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            Interactive charts with customizable themes and precise entry/exit markers
          </p>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
            showSettings 
              ? "bg-lime-400 text-zinc-950" 
              : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-200"
          }`}
        >
          <Palette size={16} />
          Theme
        </button>
      </div>

      {/* Theme Settings Panel */}
      {showSettings && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/80 backdrop-blur-sm p-5 shadow-xl shadow-black/20 animate-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Settings size={15} className="text-zinc-400" />
              Chart Appearance
            </h3>
            <button 
              onClick={() => setShowSettings(false)}
              className="text-zinc-500 hover:text-zinc-300 transition"
            >
              <X size={16} />
            </button>
          </div>

          {/* Presets */}
          <div className="mb-5">
            <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Presets</p>
            <div className="flex gap-2">
              {Object.values(PRESETS).map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all border ${
                    theme.name === preset.name
                      ? "border-lime-400/50 bg-lime-400/10 text-lime-300"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <span className="w-3 h-3 rounded-full" style={{ background: preset.upColor }} />
                  <span className="w-3 h-3 rounded-full" style={{ background: preset.downColor }} />
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Colors */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            <ColorInput label="Background" value={theme.bg} onChange={(v) => updateThemeColor("bg", v)} />
            <ColorInput label="Text" value={theme.text} onChange={(v) => updateThemeColor("text", v)} />
            <ColorInput label="Grid" value={theme.grid} onChange={(v) => updateThemeColor("grid", v)} />
            <ColorInput label="Border" value={theme.border} onChange={(v) => updateThemeColor("border", v)} />
            <ColorInput label="Bullish" value={theme.upColor} onChange={(v) => updateThemeColor("upColor", v)} />
            <ColorInput label="Bearish" value={theme.downColor} onChange={(v) => updateThemeColor("downColor", v)} />
            <ColorInput label="Wick Up" value={theme.wickUp} onChange={(v) => updateThemeColor("wickUp", v)} />
            <ColorInput label="Wick Down" value={theme.wickDown} onChange={(v) => updateThemeColor("wickDown", v)} />
            <ColorInput label="Crosshair" value={theme.crosshair} onChange={(v) => updateThemeColor("crosshair", v)} />
          </div>
        </div>
      )}

      {/* Control Panel */}
      <div className="rounded-2xl border border-zinc-800/60 bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 backdrop-blur-sm p-5 shadow-xl shadow-black/20">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px]">
            <label className="flex items-center gap-1.5 mb-2 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              <Layers size={12} />
              Strategy
            </label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full rounded-xl border border-zinc-700/60 bg-zinc-950/80 px-3.5 py-2.5 text-sm text-white outline-none focus:border-lime-400/60 transition hover:border-zinc-600"
            >
              {strategies.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1.5 mb-2 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              <Clock size={12} />
              Timeframe
            </label>
            <div className="flex gap-1.5">
              {timeframes.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setResolution(t.value)}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    resolution === t.value
                      ? "bg-lime-400 text-zinc-950 shadow-[0_0_12px_rgba(163,230,53,0.25)]"
                      : "bg-zinc-950/80 text-zinc-400 border border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 mb-2 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              <Calendar size={12} />
              Period
            </label>
            <div className="flex items-center gap-2">
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-xl border border-zinc-700/60 bg-zinc-950/80 px-3.5 py-2.5 text-xs text-white outline-none focus:border-lime-400/60" />
              <span className="text-zinc-600">→</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-xl border border-zinc-700/60 bg-zinc-950/80 px-3.5 py-2.5 text-xs text-white outline-none focus:border-lime-400/60" />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Capital</label>
            <input type="number" value={capital} onChange={(e) => setCapital(Number(e.target.value))} step={100000} className="w-28 rounded-xl border border-zinc-700/60 bg-zinc-950/80 px-3.5 py-2.5 text-xs text-white outline-none focus:border-lime-400/60" />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-medium text-zinc-400 uppercase tracking-wider">R:R</label>
            <input type="number" value={targetMult} onChange={(e) => setTargetMult(Number(e.target.value))} step={0.5} className="w-16 rounded-xl border border-zinc-700/60 bg-zinc-950/80 px-3.5 py-2.5 text-xs text-white outline-none focus:border-lime-400/60" />
          </div>

          <button
            onClick={runBacktest}
            disabled={running}
            className="ml-auto flex items-center gap-2.5 rounded-xl bg-lime-400 px-7 py-3 text-sm font-bold text-zinc-950 transition-all hover:bg-lime-300 hover:shadow-[0_0_20px_rgba(163,230,53,0.3)] disabled:opacity-50 disabled:hover:shadow-none"
          >
            {running ? (
              <><div className="w-4 h-4 border-2 border-zinc-800 border-t-transparent rounded-full animate-spin" />Running...</>
            ) : (
              <><Play size={17} fill="currentColor" />Run Backtest</>
            )}
          </button>
        </div>
      </div>

      {/* Charts */}
      <div className="space-y-5">
        <ChartPanel title="Nifty 50" symbol="NSE:NIFTY50-INDEX" result={niftyResult} loading={niftyLoading} theme={theme} />
        <ChartPanel title="Bank Nifty" symbol="NSE:NIFTYBANK-INDEX" result={bankNiftyResult} loading={bankNiftyLoading} theme={theme} />
      </div>
    </div>
  );
}