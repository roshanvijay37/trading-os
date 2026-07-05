/**
 * Reusable candlestick chart on lightweight-charts v4 (same layout/colors as the
 * proven BacktestLab setup). The chart is created ONCE and later data arrives via
 * series.setData(), so user zoom/pan survives the 5s live polls; pass a new `fitKey`
 * (e.g. symbol+resolution) to re-fit the viewport when the instrument changes.
 * v4 API only: chart.addCandlestickSeries()/addHistogramSeries() — the v5
 * chart.addSeries(...) form does not exist in 4.2.
 */

import { ColorType, createChart, LineStyle, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../store/theme";
import { getChartPalette } from "../../lib/chartTheme";

export interface CandlePoint {
  /** Unix epoch SECONDS (lightweight-charts requirement). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface LinePoint {
  time: number;
  value: number;
}

export interface OverlayLine {
  /** Identifies the series across renders (also shown in the on-chart legend/toggle UI). */
  label: string;
  color: string;
  data: LinePoint[];
  /** Dashed instead of solid — e.g. to distinguish a reference level (SL/target) from a
   * continuous indicator line (EMA). */
  dashed?: boolean;
}

export interface CandleMarker {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
}

/** Dedupe by time + ascending sort + NaN guard — setData throws otherwise (FYERS fetches can overlap). */
export function sanitizeCandles(candles: CandlePoint[]): CandlePoint[] {
  const map = new Map<number, CandlePoint>();
  for (const c of candles) {
    if (!c.time || !Number.isFinite(c.time)) continue;
    if ([c.open, c.high, c.low, c.close].some((v) => typeof v !== "number" || Number.isNaN(v))) continue;
    map.set(c.time, c);
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

/** Same dedupe/sort/NaN-guard contract as sanitizeCandles, for overlay line series. */
export function sanitizeLinePoints(points: LinePoint[]): LinePoint[] {
  const map = new Map<number, LinePoint>();
  for (const p of points) {
    if (!p.time || !Number.isFinite(p.time)) continue;
    if (typeof p.value !== "number" || Number.isNaN(p.value)) continue;
    map.set(p.time, p);
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

export function CandlesChart({
  candles,
  height = 420,
  showVolume = true,
  timeVisible = true,
  fitKey = "",
  overlays = [],
  markers = [],
}: {
  candles: CandlePoint[];
  height?: number;
  showVolume?: boolean;
  timeVisible?: boolean;
  /** Change this (e.g. `${symbol}:${resolution}`) to re-fit the visible range to the new data. */
  fitKey?: string;
  /** Indicator overlay lines (e.g. EMA). Series are (re)created whenever the SET of labels
   * changes (cheap — same as a theme/timeVisible change); data updates independently. */
  overlays?: OverlayLine[];
  /** Per-candle markers (e.g. signal alerts) drawn on the candlestick series itself. */
  markers?: CandleMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const lastFitKeyRef = useRef<string | null>(null);
  const [hover, setHover] = useState<CandlePoint | null>(null);
  const theme = useTheme();
  const overlayKey = overlays.map((o) => `${o.label}:${o.color}:${o.dashed ? 1 : 0}`).join("|");

  // Create/destroy the chart. StrictMode-safe: cleanup fully removes the chart. Recreated (not
  // just recolored) on theme change — lightweight-charts has no "update palette" API.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const palette = getChartPalette(theme);

    const chart = createChart(container, {
      layout: { background: { type: ColorType.Solid, color: palette.background }, textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border, timeVisible, secondsVisible: false },
      autoSize: true,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });

    let volumeSeries: ISeriesApi<"Histogram"> | null = null;
    if (showVolume) {
      volumeSeries = chart.addHistogramSeries({
        priceScaleId: "",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    }

    const overlaySeries = new Map<string, ISeriesApi<"Line">>();
    for (const o of overlays) {
      overlaySeries.set(
        o.label,
        chart.addLineSeries({
          color: o.color,
          lineWidth: o.dashed ? 2 : 1,
          lineStyle: o.dashed ? LineStyle.Dashed : LineStyle.Solid,
          lastValueVisible: true,
          priceLineVisible: false,
          crosshairMarkerVisible: !o.dashed,
        }),
      );
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHover(null);
        return;
      }
      const bar = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!bar) {
        setHover(null);
        return;
      }
      const vol = volumeSeries ? (param.seriesData.get(volumeSeries) as { value: number } | undefined) : undefined;
      setHover({ time: param.time as number, ...bar, volume: vol?.value });
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    overlaySeriesRef.current = overlaySeries;
    lastFitKeyRef.current = null; // force a fit after (re)creation

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      overlaySeriesRef.current = new Map();
      setHover(null);
    };
  }, [showVolume, timeVisible, theme, overlayKey]);

  // Feed data without recreating the chart, preserving zoom/pan between polls.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    const data = sanitizeCandles(candles);
    candleSeries.setData(data.map((c) => ({ ...c, time: c.time as Time })));

    const volumeSeries = volumeSeriesRef.current;
    if (volumeSeries) {
      volumeSeries.setData(
        data.map((c) => ({
          time: c.time as Time,
          value: c.volume ?? 0,
          color: c.close >= c.open ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)",
        })),
      );
    }

    for (const o of overlays) {
      const series = overlaySeriesRef.current.get(o.label);
      if (!series) continue;
      const pts = sanitizeLinePoints(o.data);
      series.setData(pts.map((p) => ({ time: p.time as Time, value: p.value })));
    }

    // setMarkers requires ascending time order, same as setData.
    const sortedMarkers = markers
      .filter((m) => m.time && Number.isFinite(m.time))
      .sort((a, b) => a.time - b.time)
      .map((m) => ({ ...m, time: m.time as Time }));
    candleSeries.setMarkers(sortedMarkers);

    if (data.length > 0 && lastFitKeyRef.current !== fitKey) {
      chart.timeScale().fitContent();
      lastFitKeyRef.current = fitKey;
    }
  }, [candles, fitKey, overlays, markers]);

  return (
    <div className="relative">
      {hover && (
        <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex items-center gap-2.5 rounded border border-border-subtle bg-ink/85 px-2 py-1 font-mono text-2xs">
          <span className="text-zinc-500">O <span className="text-zinc-200">{hover.open.toFixed(2)}</span></span>
          <span className="text-zinc-500">H <span className="text-zinc-200">{hover.high.toFixed(2)}</span></span>
          <span className="text-zinc-500">L <span className="text-zinc-200">{hover.low.toFixed(2)}</span></span>
          <span className="text-zinc-500">
            C <span className={hover.close >= hover.open ? "text-gain" : "text-loss"}>{hover.close.toFixed(2)}</span>
          </span>
          {showVolume && hover.volume != null && hover.volume > 0 && (
            <span className="text-zinc-500">V <span className="text-zinc-200">{Math.round(hover.volume).toLocaleString()}</span></span>
          )}
        </div>
      )}
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
