import { useEffect, useRef, useState } from "react";
import { LineChart, Activity, Clock, Calendar } from "lucide-react";
import { CandlesChart, type OverlayLine, type CandleMarker } from "../components/charts/CandlesChart";
import { Flash } from "../components/ui/Flash";
import { Skeleton } from "../components/ui/Skeleton";
import { backtestApi } from "../services/api";
import { calculateEMA } from "../lib/strategies/engine";
import { findEmaAlerts, resolveEmaAlerts } from "../lib/emaAlerts";

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
  // EMA 5 / EMA 20 — the same two indicators EMA5T's live/paper bot uses for its alert rule and
  // trend gate (server/src/services/emaStrategy.js), computed here with the identical canonical
  // math (src/lib/strategies/engine.ts's calculateEMA). Shown on the actual futures contract the
  // bot trades (resolved below) — still a general-purpose overlay, not a claim that this IS the
  // bot's live signal state, since the bot scans on its own poll cycle independently of this page.
  const [showEma5, setShowEma5] = useState(true);
  const [showEma20, setShowEma20] = useState(true);
  // Marks candles matching EMA5T's alert rule (5-EMA alert + 20-EMA trend gate — see
  // src/lib/emaAlerts.ts). Same honesty caveat as the EMA lines above: a general application of
  // the rule to whatever's on screen, not a live readout of the bot's own signal state.
  const [showSignals, setShowSignals] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // EMA5T trades the futures contract, not the index — resolve the actual current-month tradable
  // contract for whichever underlying is selected, the same way the Backtest Lab's Futures mode
  // does (server/src/routes/backtest.js's /futures-range), instead of a hardcoded symbol that
  // would go stale at every monthly expiry.
  const [tradedSymbol, setTradedSymbol] = useState<string | null>(null);
  const [resolvingFutures, setResolvingFutures] = useState(false);

  const symbols = [
    { value: "NSE:NIFTYBANK-INDEX", label: "BANKNIFTY FUT" },
    { value: "NSE:NIFTY50-INDEX", label: "NIFTY FUT" },
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

  // Resolve the current tradable futures contract whenever the selected underlying changes.
  useEffect(() => {
    let cancelled = false;
    setTradedSymbol(null);
    setResolvingFutures(true);
    setError("");
    backtestApi
      .resolveFuturesRange(symbol)
      .then((res) => {
        if (cancelled) return;
        if (res.tradedSymbol) {
          setTradedSymbol(res.tradedSymbol);
        } else {
          setError("Could not resolve the current futures contract for this underlying.");
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || "Could not resolve the current futures contract for this underlying.");
      })
      .finally(() => {
        if (!cancelled) setResolvingFutures(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const fetchData = async () => {
    if (!tradedSymbol) return;
    try {
      const to = new Date();
      const from = new Date();
      const daysBack = resolution === "D" ? 90 : 7;
      from.setDate(from.getDate() - daysBack);

      const data = await backtestApi.run({
        symbol: tradedSymbol,
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
        setError(`No candle data returned for ${tradedSymbol} on this timeframe. If today is a weekend or holiday, the last trading session may not be in the requested range.`);
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
  }, [tradedSymbol, resolution]);

  useEffect(() => {
    if (!tradedSymbol) return;
    setLoading(true);
    fetchData().finally(() => setLoading(false));

    const statusInterval = setInterval(() => {
      setMarketOpen(isMarketOpen(holidays));
    }, 60000);

    return () => {
      clearInterval(statusInterval);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tradedSymbol, resolution, holidays]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (marketOpen && tradedSymbol) {
      intervalRef.current = setInterval(() => {
        fetchData();
      }, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [marketOpen, tradedSymbol, resolution]);

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

  // calculateEMA returns a series shorter than the input (no value until `period` closes exist);
  // offset re-aligns it back onto the matching candle's own timestamp.
  const overlays: OverlayLine[] = [];
  const closes = chartCandles.map((c) => c.close);
  if (showEma5 && closes.length >= 5) {
    const values = calculateEMA(closes, 5);
    const offset = closes.length - values.length;
    overlays.push({
      label: "EMA 5",
      color: "#f59e0b",
      data: values.map((value, i) => ({ time: chartCandles[offset + i].time, value })),
    });
  }
  if (showEma20 && closes.length >= 20) {
    const values = calculateEMA(closes, 20);
    const offset = closes.length - values.length;
    overlays.push({
      label: "EMA 20",
      color: "#3b82f6",
      data: values.map((value, i) => ({ time: chartCandles[offset + i].time, value })),
    });
  }

  const alerts = showSignals ? findEmaAlerts(chartCandles) : [];
  // Simulates each alert forward (did price actually reach the entry, then SL or target first) —
  // the same entry/SL/target formula and SL-checked-first tie-break the live bot's backtest uses
  // (see src/lib/emaAlerts.ts's resolveEmaAlerts doc comment for exactly what's mirrored).
  const resolved = resolveEmaAlerts(chartCandles, alerts);

  // Entry arrow only (no text label) — a label like "B"/"S" reads too easily as "Buy"/"Sell",
  // overclaiming that this is a confirmed trade rather than just an EMA5T alert candle.
  const markers: CandleMarker[] = alerts.map((a) => ({
    time: chartCandles[a.index].time,
    position: a.type === "BULLISH" ? "belowBar" : "aboveBar",
    color: a.type === "BULLISH" ? "#10b981" : "#ef4444",
    shape: a.type === "BULLISH" ? "arrowUp" : "arrowDown",
  }));

  // Outcome marker — a small circle at whichever candle actually hit target (green) or SL (red),
  // for every alert that triggered and resolved. Positioned opposite the entry arrow (same
  // convention BacktestLab.tsx uses for its own entry/exit marker pairs).
  for (const r of resolved) {
    if (r.outcome !== "TARGET" && r.outcome !== "SL") continue;
    markers.push({
      time: chartCandles[r.outcomeIndex!].time,
      position: r.type === "BULLISH" ? "aboveBar" : "belowBar",
      color: r.outcome === "TARGET" ? "#10b981" : "#ef4444",
      shape: "circle",
    });
  }

  // SL/Target reference lines ONLY for a still-OPEN latest alert (triggered, not yet resolved) —
  // that's the one case with no outcome dot yet, so a reference is actually useful. A resolved
  // alert (TARGET/SL) already got its dot from the loop above; showing lines on top of that dot
  // would make the most recent trade look different from every older one. NOT_TRIGGERED gets
  // neither (nothing happened yet beyond the entry arrow).
  const latestResolved = resolved[resolved.length - 1];
  if (latestResolved && latestResolved.outcome === "OPEN" && chartCandles.length > 0) {
    const alertTime = chartCandles[latestResolved.alertIndex].time;
    const lastTime = chartCandles[chartCandles.length - 1].time;
    overlays.push(
      { label: "SL", color: "#ef4444", dashed: true, data: [{ time: alertTime, value: latestResolved.sl }, { time: lastTime, value: latestResolved.sl }] },
      { label: "Target", color: "#10b981", dashed: true, data: [{ time: alertTime, value: latestResolved.target }, { time: lastTime, value: latestResolved.target }] },
    );
  }

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

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowEma5((v) => !v)}
            className={`flex items-center gap-1.5 rounded-panel border px-2.5 py-2 text-2xs font-medium transition ${
              showEma5 ? "border-warn/30 bg-warn-dim text-warn" : "border-border-subtle bg-surface text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-warn" />
            EMA 5
          </button>
          <button
            onClick={() => setShowEma20((v) => !v)}
            className={`flex items-center gap-1.5 rounded-panel border px-2.5 py-2 text-2xs font-medium transition ${
              showEma20 ? "border-info/30 bg-info-dim text-info" : "border-border-subtle bg-surface text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-info" />
            EMA 20
          </button>
          <button
            onClick={() => setShowSignals((v) => !v)}
            title="EMA5T alert candles (5-EMA alert + 20-EMA trend gate) — not a claim about the bot's live signal state on this symbol/timeframe"
            className={`flex items-center gap-1.5 rounded-panel border px-2.5 py-2 text-2xs font-medium transition ${
              showSignals ? "border-border-hover bg-surface text-zinc-200" : "border-border-subtle bg-surface text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span className="flex items-center gap-0.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-gain" />
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-loss" />
            </span>
            Signals
          </button>
        </div>

        {lastUpdate && (
          <div className="ml-auto flex items-center gap-1.5 text-2xs text-zinc-700">
            <Calendar size={10} />
            Last update: {lastUpdate}
          </div>
        )}
      </div>

      {(resolvingFutures || loading) && candles.length === 0 && (
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
              {tradedSymbol && (
                <span className="font-mono text-3xs text-zinc-700" title="The actual current-month contract this chart is showing">
                  {tradedSymbol}
                </span>
              )}
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
            fitKey={`${tradedSymbol}:${resolution}`}
            overlays={overlays}
            markers={markers}
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
