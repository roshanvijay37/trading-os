import { useEffect, useRef, useState } from "react";
import { LineChart, Activity, Clock, Calendar } from "lucide-react";
import { CandlesChart } from "../components/charts/CandlesChart";
import { Flash } from "../components/ui/Flash";
import { Skeleton } from "../components/ui/Skeleton";
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
      const daysBack = resolution === "D" ? 90 : 7;
      from.setDate(from.getDate() - daysBack);

      const data = await backtestApi.run({
        symbol,
        resolution,
        fromDate: from.toISOString().split("T")[0],
        toDate: to.toISOString().split("T")[0],
        strategy: "EMA5",
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
      } else if (data.error) {
        setError(data.error);
      } else {
        setError("No candle data returned for this symbol/timeframe. If today is a weekend or holiday, the last trading session may not be in the requested range.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load chart data");
    }
  };

  // Drop the old series the moment instrument/timeframe changes: the chart unmounts
  // (skeleton shows) and CandlesChart's fitKey is then consumed against the NEW data.
  // Without this, the fitKey change fires while stale candles are still mounted, the
  // fit is burned on the old data, and the new bars render at the old zoom level.
  useEffect(() => {
    setCandles([]);
  }, [symbol, resolution]);

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

  // Map to lightweight-charts shape: epoch seconds (CandlesChart dedupes/sorts/guards).
  const chartCandles = candles.map((c) => ({
    time: Math.floor((c.timestamp ?? 0) / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
  const hasVolume = candles.some((c) => (c.volume || 0) > 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <span className={`flex items-center gap-1.5 rounded-panel border px-2.5 py-1 text-2xs font-medium ${
          marketOpen ? "border-gain/20 bg-gain-dim text-gain" : "border-border bg-surface text-zinc-500"
        }`}>
          <Activity size={9} className={marketOpen ? "animate-pulse" : ""} />
          {marketOpen ? "LIVE" : "CLOSED"}
        </span>
        <span className="text-2xs text-zinc-600">{getMarketStatusText(holidays)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-panel border border-border bg-panel p-3">
        <div className="flex items-center gap-2">
          <LineChart size={13} className="text-zinc-600" />
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover"
          >
            {symbols.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Clock size={13} className="text-zinc-600" />
          <div className="flex flex-wrap rounded-panel border border-border-subtle bg-surface overflow-hidden">
            {timeframes.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setResolution(tf.value)}
                className={`px-3 py-2 text-2xs font-medium transition ${
                  resolution === tf.value
                    ? "bg-surface text-gain"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {lastUpdate && (
          <div className="ml-auto flex items-center gap-1.5 text-2xs text-zinc-700">
            <Calendar size={10} />
            Last update: {lastUpdate}
          </div>
        )}
      </div>

      {loading && candles.length === 0 && (
        <div className="mt-5 rounded-panel border border-border bg-panel p-4">
          <Skeleton className="mb-3 h-4 w-40" />
          <Skeleton className="h-[420px] w-full" />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-panel border border-loss/20 bg-loss-dim p-3 text-2xs text-loss">
          {error}
        </div>
      )}

      {candles.length > 0 && (
        <div className="mt-5 rounded-panel border border-border bg-panel p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">
                {symbols.find((s) => s.value === symbol)?.label}
              </h2>
              <span className="rounded-panel border border-border-subtle bg-surface px-2 py-0.5 text-2xs text-zinc-600">
                {timeframes.find((t) => t.value === resolution)?.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-zinc-600">
              <span className="font-mono">O: {candles[candles.length - 1].open.toFixed(2)}</span>
              <span className="font-mono">H: {candles[candles.length - 1].high.toFixed(2)}</span>
              <span className="font-mono">L: {candles[candles.length - 1].low.toFixed(2)}</span>
              <span className={`font-mono ${candles[candles.length - 1].close >= candles[candles.length - 1].open ? "text-gain" : "text-loss"}`}>
                C: <Flash value={candles[candles.length - 1].close}>{candles[candles.length - 1].close.toFixed(2)}</Flash>
              </span>
            </div>
          </div>
          <CandlesChart
            candles={chartCandles}
            height={420}
            showVolume={hasVolume}
            timeVisible={resolution !== "D"}
            fitKey={`${symbol}:${resolution}`}
          />

          <div className="mt-3 flex items-center justify-between text-2xs text-zinc-700">
            <span>{candles.length} candles · scroll to zoom, drag to pan, hover for OHLC</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-sm bg-gain" /> Bullish
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-sm bg-loss" /> Bearish
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
