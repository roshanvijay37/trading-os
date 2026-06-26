import { useEffect, useRef, useState } from "react";
import { LineChart, Activity, Clock, Calendar } from "lucide-react";
import { backtestApi } from "../services/api";

interface Candle {
  timestamp: number;
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

let holidayCache: { date: string; name: string }[] = [];

async function fetchHolidays(): Promise<{ date: string; name: string }[]> {
  if (holidayCache.length > 0) return holidayCache;
  try {
    const data = await backtestApi.getHolidays();
    if (data.holidays) {
      holidayCache = data.holidays;
      return holidayCache;
    }
  } catch {
    // Fallback to empty if API fails
  }
  return [];
}

function isMarketHoliday(holidays: { date: string; name: string }[]): boolean {
  const iso = new Date().toISOString().split("T")[0];
  return holidays.some((h) => h.date === iso);
}

function getHolidayName(holidays: { date: string; name: string }[]): string | null {
  const iso = new Date().toISOString().split("T")[0];
  const found = holidays.find((h) => h.date === iso);
  return found ? found.name : null;
}

function getMarketStatusText(holidays: { date: string; name: string }[]): string {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0) return "Sunday — Market Closed";
  if (day === 6) return "Saturday — Market Closed";
  const holidayName = getHolidayName(holidays);
  if (holidayName) {
    return `Holiday — ${holidayName}`;
  }
  const utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  const ist = (utc + 330) % (24 * 60);
  const h = Math.floor(ist / 60);
  const m = ist % 60;
  if (h === 9 && m < 15) return "Pre-market";
  if (h < 9 || h > 15 || (h === 15 && m >= 30)) return "Market Closed";
  return "Market Open — Auto-refreshing";
}

function isMarketOpen(holidays: { date: string; name: string }[]): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (isMarketHoliday(holidays)) return false;
  const utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  const ist = (utc + 330) % (24 * 60);
  const h = Math.floor(ist / 60);
  const m = ist % 60;
  if (h < 9 || h > 15) return false;
  if (h === 9 && m < 15) return false;
  if (h === 15 && m > 30) return false;
  return true;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function Chart() {
  const [symbol, setSymbol] = useState("NSE:NIFTYBANK-INDEX");
  const [resolution, setResolution] = useState("5");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [holidays, setHolidays] = useState<{ date: string; name: string }[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const symbols = [
    { value: "NSE:NIFTYBANK-INDEX", label: "BANKNIFTY" },
    { value: "NSE:NIFTY50-INDEX", label: "NIFTY 50" },
    { value: "NSE:FINNIFTY-INDEX", label: "FINNIFTY" },
    { value: "BSE:SENSEX", label: "SENSEX" },
  ];

  const timeframes = [
    { value: "1", label: "1m" },
    { value: "5", label: "5m" },
    { value: "15", label: "15m" },
    { value: "30", label: "30m" },
    { value: "60", label: "1h" },
    { value: "D", label: "D" },
  ];

  // Load holidays once on mount
  useEffect(() => {
    fetchHolidays().then((h) => {
      setHolidays(h);
      setMarketOpen(isMarketOpen(h));
    });
  }, []);

  const fetchData = async () => {
    try {
      const to = new Date();
      const from = new Date();
      const daysBack = resolution === "D" ? 90 : 2;
      from.setDate(from.getDate() - daysBack);

      const data = await backtestApi.run({
        symbol,
        resolution,
        fromDate: from.toISOString().split("T")[0],
        toDate: to.toISOString().split("T")[0],
        strategy: "RSI",
        rsiPeriod: 14,
        capital: 100000,
        riskPercent: 1,
        capitalMode: "FIXED",
      });

      if (data.candles && data.candles.length > 0) {
        const parsed: Candle[] = data.candles.map((c: any) => ({
          timestamp: c.timestamp,
          datetime: c.datetime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
        setCandles(parsed);
        setLastUpdate(new Date().toLocaleTimeString("en-IN"));
        setError("");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load chart data");
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));

    const statusInterval = setInterval(() => {
      setMarketOpen(isMarketOpen(holidays));
    }, 60000);

    return () => {
      clearInterval(statusInterval);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [symbol, resolution, holidays]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (marketOpen) {
      intervalRef.current = setInterval(() => {
        fetchData();
      }, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [marketOpen, symbol, resolution]);

  const renderCandlestickChart = () => {
    if (candles.length < 2) return null;

    const width = 900;
    const height = 420;
    const padding = { top: 20, right: 60, bottom: 40, left: 10 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const visibleCandles = candles.slice(-120);
    const highs = visibleCandles.map((c) => c.high);
    const lows = visibleCandles.map((c) => c.low);
    const maxH = Math.max(...highs);
    const minL = Math.min(...lows);
    const range = maxH - minL || 1;

    const maxVol = Math.max(...visibleCandles.map((c) => c.volume));
    const volH = chartH * 0.15;

    const xScale = (i: number) => padding.left + (i / (visibleCandles.length - 1)) * chartW;
    const yScale = (p: number) => padding.top + chartH - ((p - minL) / range) * chartH;
    const yVol = (v: number) => padding.top + chartH - (v / maxVol) * volH;

    const candleWidth = Math.max(2, (chartW / visibleCandles.length) * 0.6);

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 500 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padding.top + t * chartH;
          const price = maxH - t * range;
          return (
            <g key={t}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#27272a" strokeWidth={1} />
              <text x={width - padding.right + 5} y={y + 4} fill="#52525b" fontSize={10}>
                {price.toFixed(1)}
              </text>
            </g>
          );
        })}

        {visibleCandles.map((c, i) => {
          const x = xScale(i);
          const isGreen = c.close >= c.open;
          return (
            <rect
              key={`vol-${i}`}
              x={x - candleWidth / 2}
              y={yVol(c.volume)}
              width={candleWidth}
              height={padding.top + chartH - yVol(c.volume)}
              fill={isGreen ? "#365314" : "#450a0a"}
              opacity={0.5}
            />
          );
        })}

        {visibleCandles.map((c, i) => {
          const x = xScale(i);
          const isGreen = c.close >= c.open;
          const color = isGreen ? "#a3e635" : "#f87171";
          const bodyTop = yScale(Math.max(c.open, c.close));
          const bodyBottom = yScale(Math.min(c.open, c.close));
          const bodyH = Math.max(1, bodyBottom - bodyTop);

          return (
            <g key={`candle-${i}`}>
              <line x1={x} y1={yScale(c.high)} x2={x} y2={yScale(c.low)} stroke={color} strokeWidth={1} />
              <rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyH} fill={color} rx={1} />
            </g>
          );
        })}

        {visibleCandles.map((c, i) => {
          if (i % Math.ceil(visibleCandles.length / 6) !== 0) return null;
          const x = xScale(i);
          const label = resolution === "D" ? formatDateShort(c.datetime) : formatTime(c.datetime);
          return (
            <text key={`time-${i}`} x={x} y={height - 10} fill="#52525b" fontSize={9} textAnchor="middle">
              {label}
            </text>
          );
        })}
      </svg>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Live Chart</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {getMarketStatusText(holidays)}
          </p>
        </div>
        <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
          marketOpen ? "bg-lime-400/10 text-lime-300" : "bg-zinc-800 text-zinc-500"
        }`}>
          <Activity size={12} className={marketOpen ? "animate-pulse" : ""} />
          {marketOpen ? "LIVE" : "CLOSED"}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center gap-2">
          <LineChart size={16} className="text-zinc-500" />
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
          >
            {symbols.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Clock size={16} className="text-zinc-500" />
          <div className="flex rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden">
            {timeframes.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setResolution(tf.value)}
                className={`px-3 py-2 text-xs font-medium transition ${
                  resolution === tf.value
                    ? "bg-lime-400/20 text-lime-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {lastUpdate && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-600 ml-auto">
            <Calendar size={12} />
            Last update: {lastUpdate}
          </div>
        )}
      </div>

      {loading && candles.length === 0 && (
        <div className="mt-8 flex items-center justify-center text-zinc-500">
          <Activity size={20} className="mr-2 animate-spin" />
          Loading chart data...
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {candles.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-medium text-white">
                {symbols.find((s) => s.value === symbol)?.label}
              </h2>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                {timeframes.find((t) => t.value === resolution)?.label}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-zinc-500">
              <span>O: {candles[candles.length - 1].open.toFixed(2)}</span>
              <span>H: {candles[candles.length - 1].high.toFixed(2)}</span>
              <span>L: {candles[candles.length - 1].low.toFixed(2)}</span>
              <span className={candles[candles.length - 1].close >= candles[candles.length - 1].open ? "text-lime-300" : "text-rose-300"}>
                C: {candles[candles.length - 1].close.toFixed(2)}
              </span>
            </div>
          </div>
          {renderCandlestickChart()}

          <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-600">
            <span>Showing last {Math.min(120, candles.length)} candles</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-lime-400" /> Bullish
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-rose-400" /> Bearish
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}