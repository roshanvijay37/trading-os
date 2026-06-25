import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time, LineData } from "lightweight-charts";
import { Activity, Zap, TrendingUp, TrendingDown, Wifi, WifiOff, Hash, BarChart3 } from "lucide-react";

type Interval = "tick" | "1s" | "5s" | "15s" | "1m" | "3m" | "5m" | "15m" | "30m";

const INTERVALS: { value: Interval; label: string }[] = [
  { value: "tick", label: "Tick" },
  { value: "1s", label: "1s" },
  { value: "5s", label: "5s" },
  { value: "15s", label: "15s" },
  { value: "1m", label: "1m" },
  { value: "3m", label: "3m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
];

const SYMBOLS = [
  { value: "NIFTY", label: "Nifty 50" },
  { value: "BANKNIFTY", label: "Bank Nifty" },
];

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const WS_URL = (() => {
  const base = import.meta.env.VITE_API_URL || "http://localhost:3001";
  // Remove /api suffix for WebSocket - WS runs on same origin at /ws/ticks
  const origin = base.replace(/\/api$/, "");
  return origin.replace(/^http/, "ws") + "/ws/ticks";
})();

function getSessionId(): string | null {
  return localStorage.getItem("fyersSessionId");
}

interface Stats {
  currentPrice: number;
  dayHigh: number;
  dayLow: number;
  tickCount: number;
}

export function TickChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const tickBufferRef = useRef<any[]>([]);
  const rafRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [symbol, setSymbol] = useState("NIFTY");
  const [interval, setInterval] = useState<Interval>("5m");
  const [isConnected, setIsConnected] = useState(false);
  const [wsStatus, setWsStatus] = useState("Disconnected");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  // Initialize chart
  const initChart = useCallback(() => {
    const container = containerRef.current;
    if (!container || chartRef.current) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#0c0c0e" },
        textColor: "#a1a1aa",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1c1c1f" },
        horzLines: { color: "#1c1c1f" },
      },
      rightPriceScale: {
        borderColor: "#27272a",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#27272a",
        timeVisible: true,
        secondsVisible: interval === "tick" || interval.endsWith("s"),
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#52525b", width: 1, style: 2 },
        horzLine: { color: "#52525b", width: 1, style: 2 },
      },
      width: container.clientWidth,
      height: 520,
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({ width: container.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);
  }, [interval]);

  // Flush tick buffer using requestAnimationFrame
  const flushTickBuffer = useCallback(() => {
    const buffer = tickBufferRef.current;
    tickBufferRef.current = [];
    rafRef.current = null;

    if (buffer.length === 0) return;

    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    for (const tick of buffer) {
      if (tick.symbol !== symbol) continue;

      const time = Math.floor(tick.timestamp / 1000) as Time;

      if (interval === "tick") {
        (series as ISeriesApi<"Line">).update({ time, value: tick.ltp });
      } else {
        // For candlestick, simplified update
        (series as ISeriesApi<"Candlestick">).update({
          time,
          open: tick.ltp,
          high: tick.ltp,
          low: tick.ltp,
          close: tick.ltp,
        });
      }

      // Update stats
      setStats((prev: Stats | null) => {
        if (!prev) {
          return {
            currentPrice: tick.ltp,
            dayHigh: tick.ltp,
            dayLow: tick.ltp,
            tickCount: 1,
          };
        }
        return {
          currentPrice: tick.ltp,
          dayHigh: Math.max(prev.dayHigh, tick.ltp),
          dayLow: Math.min(prev.dayLow, tick.ltp),
          tickCount: prev.tickCount + 1,
        };
      });
    }
  }, [symbol, interval]);

  // Queue tick for batch update
  const queueTick = useCallback((tick: any) => {
    tickBufferRef.current.push(tick);
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(flushTickBuffer);
    }
  }, [flushTickBuffer]);

  // Load candle data
  const loadCandles = useCallback(async (sym: string, int: Interval) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/ticks/candles?symbol=${sym}&interval=${int}&limit=500`
      );
      const data = await response.json();
      if (!data.candles?.length) {
        setLoading(false);
        return;
      }

      const chart = chartRef.current;
      if (!chart) {
        setLoading(false);
        return;
      }

      // Remove existing series
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }

      if (int === "tick") {
        // Line chart for tick mode
        const lineSeries = chart.addLineSeries({
          color: "#22c55e",
          lineWidth: 1,
          lastValueVisible: true,
          priceLineVisible: true,
        });
        const lineData: LineData[] = data.candles.map((c: any) => ({
          time: c.time as Time,
          value: c.close,
        }));
        lineSeries.setData(lineData);
        seriesRef.current = lineSeries;
      } else {
        // Candlestick chart
        const candleSeries = chart.addCandlestickSeries({
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderUpColor: "#22c55e",
          borderDownColor: "#ef4444",
          wickUpColor: "#22c55e",
          wickDownColor: "#ef4444",
        });
        const candleData: CandlestickData[] = data.candles.map((c: any) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        candleSeries.setData(candleData);
        seriesRef.current = candleSeries;
      }

      chart.timeScale().fitContent();
    } catch (err) {
      console.error("Failed to load candles:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll for latest tick as fallback
  const pollLatestTick = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/ticks/latest?symbol=${symbol}`);
      const data = await response.json();
      if (data.tick) {
        queueTick(data.tick);
      }
    } catch (err) {
      // Silently fail on poll error
    }
  }, [symbol, queueTick]);

  // Connect to backend WebSocket
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setWsStatus("Connecting...");
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[TickChart] WebSocket connected");
      setIsConnected(true);
      setWsStatus("Connected");
      
      // Subscribe to symbol
      ws.send(JSON.stringify({
        type: "subscribe",
        symbol: symbol,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "tick" && msg.data) {
          queueTick(msg.data);
        } else if (msg.type === "status") {
          console.log("[TickChart] WS Status:", msg.data);
        }
      } catch (err) {
        console.error("[TickChart] WS message error:", err);
      }
    };

    ws.onclose = () => {
      console.log("[TickChart] WebSocket closed");
      setIsConnected(false);
      setWsStatus("Disconnected - using poll fallback");
      wsRef.current = null;
      
      // Start polling fallback
      startPolling();
    };

    ws.onerror = (err) => {
      console.error("[TickChart] WebSocket error:", err);
      setWsStatus("WS Error - using poll fallback");
      ws.close();
    };

    wsRef.current = ws;
  }, [symbol, queueTick]);

  // Start polling fallback
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    console.log("[TickChart] Starting polling fallback");
    const timer = window.setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/ticks/latest?symbol=${symbol}`);
        const data = await r.json();
        if (data.tick) queueTick(data.tick);
      } catch (e) {}
    }, 1000);
    pollIntervalRef.current = timer;
  }, [symbol, queueTick]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Disconnect WebSocket
  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setWsStatus("Disconnected");
  }, []);

  // Connect to FYERS WebSocket (via backend)
  const connectFyers = useCallback(async () => {
    const sessionId = getSessionId();
    if (!sessionId) {
      alert("Please connect FYERS first");
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/ticks/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
        },
      });
      const data = await response.json();
      if (data.success) {
        console.log("[TickChart] FYERS WebSocket connected via backend");
        // Now connect our client WebSocket
        connectWebSocket();
      }
    } catch (err) {
      console.error("Failed to connect FYERS:", err);
    }
  }, [connectWebSocket]);

  // Initialize chart on mount
  useEffect(() => {
    initChart();
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [initChart]);

  // Load candles when symbol/interval changes
  useEffect(() => {
    loadCandles(symbol, interval);
  }, [symbol, interval, loadCandles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3 tracking-tight">
            <Activity size={28} className="text-lime-400" />
            Tick Chart
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            Real-time Nifty & Bank Nifty with live WebSocket streaming
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* WS Status */}
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium border ${
            isConnected 
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" 
              : "border-zinc-700 bg-zinc-900 text-zinc-500"
          }`}>
            {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {wsStatus}
          </div>
          
          {/* Connect Button */}
          <button
            onClick={connectFyers}
            disabled={isConnected}
            className="flex items-center gap-2 rounded-xl bg-lime-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
          >
            <Zap size={15} />
            {isConnected ? "Live" : "Connect"}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-zinc-800/60 bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 backdrop-blur-sm p-5 shadow-xl shadow-black/20">
        <div className="flex flex-wrap items-end gap-4">
          {/* Symbol Selector */}
          <div>
            <label className="mb-2 block text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Instrument
            </label>
            <div className="flex gap-1.5">
              {SYMBOLS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSymbol(s.value)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    symbol === s.value
                      ? "bg-lime-400 text-zinc-950 shadow-[0_0_12px_rgba(163,230,53,0.25)]"
                      : "bg-zinc-950/80 text-zinc-400 border border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Interval Selector */}
          <div>
            <label className="mb-2 block text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              Timeframe
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {INTERVALS.map((int) => (
                <button
                  key={int.value}
                  onClick={() => setInterval(int.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    interval === int.value
                      ? "bg-lime-400 text-zinc-950 shadow-[0_0_8px_rgba(163,230,53,0.2)]"
                      : "bg-zinc-950/80 text-zinc-400 border border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  {int.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          {stats && (
            <div className="ml-auto flex items-center gap-4">
              <div className="text-right">
                <p className="text-[10px] text-zinc-500 uppercase">Price</p>
                <p className="text-lg font-bold text-white">₹{stats.currentPrice.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-zinc-500 uppercase">High</p>
                <p className="text-sm font-semibold text-emerald-400">₹{stats.dayHigh.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-zinc-500 uppercase">Low</p>
                <p className="text-sm font-semibold text-rose-400">₹{stats.dayLow.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-zinc-500 uppercase">Ticks</p>
                <p className="text-sm font-semibold text-zinc-300">{stats.tickCount.toLocaleString()}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-2xl border border-zinc-800/60 bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 backdrop-blur-sm overflow-hidden shadow-xl shadow-black/20">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
            <h2 className="text-sm font-semibold text-white tracking-wide">
              {SYMBOLS.find((s) => s.value === symbol)?.label}
            </h2>
            <span className="text-[11px] text-zinc-500 font-mono">{interval}</span>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-lime-400 rounded-full animate-spin" />
              Loading...
            </div>
          )}
        </div>

        <div ref={containerRef} style={{ width: "100%", height: 520 }} />

        {/* Chart Legend */}
        <div className="px-5 py-3 border-t border-zinc-800/60 bg-zinc-950/40">
          <div className="flex items-center gap-6 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <TrendingUp size={12} className="text-emerald-400" />
              Scroll to zoom
            </span>
            <span className="flex items-center gap-1.5">
              <TrendingDown size={12} className="text-rose-400" />
              Drag to pan
            </span>
            <span className="flex items-center gap-1.5">
              <BarChart3 size={12} className="text-zinc-400" />
              {interval === "tick" ? "Line mode" : "Candlestick mode"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}