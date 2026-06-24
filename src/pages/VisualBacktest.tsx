import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time } from "lightweight-charts";
import { Play, BarChart3 } from "lucide-react";
import { backtestApi } from "../services/api";

interface TradeMarker {
  time: number;
  entryPrice: number;
  exitPrice: number;
  side: "LONG" | "SHORT";
  pnl: number;
  exitReason: string;
}

const strategies = [
  { value: "RSI", label: "RSI 2-Period" },
  { value: "EMA5", label: "5 EMA" },
  { value: "EMA5_OPTION", label: "5 EMA Option Buying" },
  { value: "TRAFFIC_LIGHT", label: "Traffic Light" },
  { value: "INSIDE_CANDLE", label: "Inside Candle" },
  { value: "VWAP_REVERSAL", label: "VWAP Reversal" },
  { value: "ORB", label: "Opening Range Breakout" },
  { value: "CPR_BREAKOUT", label: "CPR Breakout" },
  { value: "EMA9_20", label: "9/20 EMA" },
  { value: "FAILED_BREAKOUT", label: "Failed Breakout" },
  { value: "OPENING_MOMENTUM", label: "Opening Momentum" },
];

const timeframes = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "D", label: "Daily" },
];

export function VisualBacktest() {
  const [strategy, setStrategy] = useState("EMA5");
  const [resolution, setResolution] = useState("15");
  const [fromDate, setFromDate] = useState("2026-05-01");
  const [toDate, setToDate] = useState("2026-06-24");
  const [capital, setCapital] = useState(1000000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [targetMult, setTargetMult] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [niftyResult, setNiftyResult] = useState<any>(null);
  const [bankNiftyResult, setBankNiftyResult] = useState<any>(null);

  const niftyChartRef = useRef<HTMLDivElement>(null);
  const bankNiftyChartRef = useRef<HTMLDivElement>(null);
  const niftyChartApi = useRef<IChartApi | null>(null);
  const bankNiftyChartApi = useRef<IChartApi | null>(null);
  const niftySeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bankNiftySeries = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (niftyChartRef.current && !niftyChartApi.current) {
      const chart = createChart(niftyChartRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#09090b" },
          textColor: "#a1a1aa",
        },
        grid: {
          vertLines: { color: "#18181b" },
          horzLines: { color: "#18181b" },
        },
        rightPriceScale: { borderColor: "#27272a" },
        timeScale: { borderColor: "#27272a", timeVisible: true },
        width: niftyChartRef.current.clientWidth,
        height: 400,
      });
      niftyChartApi.current = chart;
      niftySeries.current = chart.addCandlestickSeries({
        upColor: "#a3e635",
        downColor: "#f43f5e",
        borderUpColor: "#a3e635",
        borderDownColor: "#f43f5e",
        wickUpColor: "#a3e635",
        wickDownColor: "#f43f5e",
      });
    }

    if (bankNiftyChartRef.current && !bankNiftyChartApi.current) {
      const chart = createChart(bankNiftyChartRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#09090b" },
          textColor: "#a1a1aa",
        },
        grid: {
          vertLines: { color: "#18181b" },
          horzLines: { color: "#18181b" },
        },
        rightPriceScale: { borderColor: "#27272a" },
        timeScale: { borderColor: "#27272a", timeVisible: true },
        width: bankNiftyChartRef.current.clientWidth,
        height: 400,
      });
      bankNiftyChartApi.current = chart;
      bankNiftySeries.current = chart.addCandlestickSeries({
        upColor: "#a3e635",
        downColor: "#f43f5e",
        borderUpColor: "#a3e635",
        borderDownColor: "#f43f5e",
        wickUpColor: "#a3e635",
        wickDownColor: "#f43f5e",
      });
    }

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

  const renderTradesOnChart = (chart: IChartApi, series: ISeriesApi<"Candlestick">, trades: any[]) => {
    // Remove existing markers
    // @ts-ignore
    if (series.markers) series.setMarkers([]);

    const markers = trades.flatMap((t: any) => {
      const entryTime = Math.floor(new Date(t.entryTime).getTime() / 1000) as Time;
      const exitTime = Math.floor(new Date(t.exitTime).getTime() / 1000) as Time;
      return [
        {
          time: entryTime,
          position: t.side === "LONG" ? "belowBar" : "aboveBar",
          color: t.side === "LONG" ? "#a3e635" : "#f43f5e",
          shape: t.side === "LONG" ? "arrowUp" : "arrowDown",
          text: `${t.side} @${t.entryPrice.toFixed(0)}`,
          size: 2,
        },
        {
          time: exitTime,
          position: t.pnl >= 0 ? "aboveBar" : "belowBar",
          color: t.pnl >= 0 ? "#22c55e" : "#ef4444",
          shape: "circle",
          text: `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)} (${t.exitReason})`,
          size: 1,
        },
      ];
    });

    // @ts-ignore
    series.setMarkers(markers);
  };

  const runVisualBacktest = async () => {
    setLoading(true);
    setError("");
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

      setNiftyResult(niftyData);
      setBankNiftyResult(bankNiftyData);

      // Render candles
      if (niftySeries.current) {
        const candles: CandlestickData[] = niftyData.candles?.map((c: any) => ({
          time: Math.floor(new Date(c.datetime).getTime() / 1000) as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })) || [];
        niftySeries.current.setData(candles);
        if (niftyData.trades?.length > 0) {
          renderTradesOnChart(niftyChartApi.current!, niftySeries.current, niftyData.trades);
        }
        niftyChartApi.current?.timeScale().fitContent();
      }

      if (bankNiftySeries.current) {
        const candles: CandlestickData[] = bankNiftyData.candles?.map((c: any) => ({
          time: Math.floor(new Date(c.datetime).getTime() / 1000) as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })) || [];
        bankNiftySeries.current.setData(candles);
        if (bankNiftyData.trades?.length > 0) {
          renderTradesOnChart(bankNiftyChartApi.current!, bankNiftySeries.current, bankNiftyData.trades);
        }
        bankNiftyChartApi.current?.timeScale().fitContent();
      }
    } catch (err: any) {
      setError(err.message || "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  const SummaryCard = ({ title, result }: { title: string; result: any }) => {
    if (!result) return null;
    const s = result.summary;
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-3 text-sm font-medium text-white flex items-center gap-2">
          <BarChart3 size={16} className="text-lime-400" />
          {title} — {result.strategy}
        </h3>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="rounded bg-zinc-900 p-2">
            <p className="text-zinc-500">Return</p>
            <p className={`font-bold ${s.totalReturn >= 0 ? "text-lime-400" : "text-rose-400"}`}>
              {s.totalReturn.toFixed(2)}%
            </p>
          </div>
          <div className="rounded bg-zinc-900 p-2">
            <p className="text-zinc-500">Win Rate</p>
            <p className="font-bold text-sky-400">{s.winRate.toFixed(1)}%</p>
          </div>
          <div className="rounded bg-zinc-900 p-2">
            <p className="text-zinc-500">Trades</p>
            <p className="font-bold text-white">{s.totalTrades}</p>
          </div>
          <div className="rounded bg-zinc-900 p-2">
            <p className="text-zinc-500">Profit Factor</p>
            <p className={`font-bold ${s.profitFactor >= 1 ? "text-lime-400" : "text-rose-400"}`}>
              {s.profitFactor.toFixed(2)}
            </p>
          </div>
          <div className="rounded bg-zinc-900 p-2">
            <p className="text-zinc-500">Expectancy</p>
            <p className="font-bold text-amber-400">₹{s.expectancy?.toFixed(0) || 0}</p>
          </div>
          <div className="rounded bg-zinc-900 p-2">
            <p className="text-zinc-500">Max DD</p>
            <p className="font-bold text-rose-400">{s.maxDrawdown.toFixed(2)}%</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Visual Backtest</h1>
        <p className="mt-1 text-sm text-zinc-500">
          See trades on Nifty & Bank Nifty charts with entry/exit markers
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Strategy</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {strategies.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Timeframe</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {timeframes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Capital</label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">R:R</label>
            <input
              type="number"
              value={targetMult}
              onChange={(e) => setTargetMult(Number(e.target.value))}
              step={0.5}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            />
          </div>
        </div>
        <button
          onClick={runVisualBacktest}
          disabled={loading}
          className="mt-4 flex items-center gap-2 rounded-lg bg-lime-400 px-5 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
        >
          <Play size={16} />
          {loading ? "Running..." : "Run Visual Backtest"}
        </button>
        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">Nifty 50</h2>
          <div ref={niftyChartRef} className="rounded-xl border border-zinc-800 bg-zinc-950" />
          {niftyResult && <SummaryCard title="Nifty 50" result={niftyResult} />}
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">Bank Nifty</h2>
          <div ref={bankNiftyChartRef} className="rounded-xl border border-zinc-800 bg-zinc-950" />
          {bankNiftyResult && <SummaryCard title="Bank Nifty" result={bankNiftyResult} />}
        </div>
      </div>

      {/* Legend */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <p className="text-xs text-zinc-500">
          <span className="text-lime-400">↑ Green arrow</span> = LONG entry | 
          <span className="text-rose-400"> ↓ Red arrow</span> = SHORT entry | 
          <span className="text-green-500"> ● Green circle</span> = Winning exit | 
          <span className="text-red-500"> ● Red circle</span> = Losing exit
        </p>
      </div>
    </div>
  );
}