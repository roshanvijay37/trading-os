/**
 * Live Charts — inline SVG charts (no external chart library) over the live options feed.
 *
 * Two honest data classes:
 *   1. BROKER HISTORICAL — fetched from optionsApi.getHistory():
 *        - Underlying: candlestick of the index (chain.instrument.underlying).
 *        - Option Premium: line of a chosen strike+type's traded premium (its FYERS symbol).
 *      Resolution / lookback are user-selectable; loading & empty states are explicit.
 *
 *   2. IN-SESSION (COMPUTED) — the FYERS retail API does NOT persist intraday OI/IV/PCR
 *      history server-side, so for OI / IV / PCR / Greeks / Volume we build a time series
 *      LOCALLY: every time the chain snapshot changes (useEffect on chain.asOf) we push one
 *      sample into capped state and plot it. These are labelled clearly as "in-session (since
 *      you opened this view)" — we do NOT pretend to have full-day history.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, CandlestickChart, Activity, Layers, Gauge, Percent, BarChart3, Info } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Select, Segmented, Spinner, Empty, Banner } from "../components/ui";
import { ChartTooltip, SvgHoverLayer, useMeasuredWidth } from "../../components/charts/svgHover";
import { optionsApi } from "../../services/api";
import { dec, compact, fmtTime } from "../lib/format";
import type { EnrichedChain } from "../types";

// ---------------------------------------------------------------------------
// History candle parsing (FYERS history: time in epoch seconds)
// ---------------------------------------------------------------------------

interface Candle {
  t: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawCandle {
  time?: number;
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

function parseCandles(raw: unknown): Candle[] {
  const arr = Array.isArray((raw as { candles?: unknown })?.candles)
    ? (raw as { candles: RawCandle[] }).candles
    : [];
  return arr
    .map((c) => {
      const ts = Number(c.time ?? c.timestamp ?? 0);
      return {
        t: ts > 1e12 ? ts : ts * 1000,
        open: Number(c.open ?? 0),
        high: Number(c.high ?? 0),
        low: Number(c.low ?? 0),
        close: Number(c.close ?? 0),
        volume: Number(c.volume ?? 0),
      };
    })
    .filter((c) => c.close > 0 && c.t > 0)
    .sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Chart-type registry
// ---------------------------------------------------------------------------

type ChartType = "underlying" | "premium" | "oi" | "iv" | "pcr" | "greeks" | "volume";

const HISTORICAL: ChartType[] = ["underlying", "premium"];

const CHART_OPTIONS: { value: ChartType; label: string }[] = [
  { value: "underlying", label: "Underlying" },
  { value: "premium", label: "Option Premium" },
  { value: "oi", label: "OI" },
  { value: "iv", label: "IV" },
  { value: "pcr", label: "PCR" },
  { value: "greeks", label: "Greeks" },
  { value: "volume", label: "Volume" },
];

const RESOLUTIONS = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "D", label: "D" },
];

const SVG_W = 720;
const SVG_H = 320;
const PAD = { top: 16, right: 56, bottom: 26, left: 8 };

export function ChartsPanel() {
  return (
    <Panel
      title="Live Charts"
      icon={LineChart}
      badge={<ProvenanceBadge kind="BROKER" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <ChartsBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function ChartsBody({ chain }: { chain: EnrichedChain }) {
  const [chartType, setChartType] = useState<ChartType>("underlying");
  const isHistorical = HISTORICAL.includes(chartType);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <LineChart size={12} className="text-zinc-600" />
          <Select value={chartType} onChange={(v) => setChartType(v as ChartType)}>
            {CHART_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <ProvenanceBadge
          kind={isHistorical ? "BROKER" : "COMPUTED"}
          label={isHistorical ? "Broker historical" : "In-session"}
        />
      </div>

      {chartType === "underlying" && <UnderlyingChart chain={chain} />}
      {chartType === "premium" && <PremiumChart chain={chain} />}
      {!isHistorical && <InSessionChart chain={chain} metric={chartType as "pcr" | "oi" | "iv" | "greeks" | "volume"} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Underlying candlestick (BROKER historical)
// ---------------------------------------------------------------------------

function UnderlyingChart({ chain }: { chain: EnrichedChain }) {
  const symbol = chain.instrument.underlying;
  const [resolution, setResolution] = useState("5");
  const { candles, loading, error } = useHistory(symbol, resolution);

  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <ChartHeader
        icon={CandlestickChart}
        title={`${chain.instrument.label} — Underlying`}
        right={<ResolutionPicker value={resolution} onChange={setResolution} />}
        badge={<ProvenanceBadge kind="BROKER" />}
      />
      {loading && candles.length === 0 ? (
        <Spinner label="Loading candles…" />
      ) : error ? (
        <Banner tone="warn">Couldn't load {chain.instrument.label} candles ({error}).</Banner>
      ) : candles.length < 2 ? (
        <Empty icon={CandlestickChart} message="Not enough candles returned for this timeframe (market may be closed or the lookback empty)." />
      ) : (
        <>
          <OhlcRow c={candles[candles.length - 1]} />
          <Candlestick candles={candles} resolution={resolution} />
          <FootNote>
            Broker historical candles via getHistory · last {Math.min(150, candles.length)} of {candles.length} shown
          </FootNote>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option premium line (BROKER historical)
// ---------------------------------------------------------------------------

function PremiumChart({ chain }: { chain: EnrichedChain }) {
  const [resolution, setResolution] = useState("5");
  const atm = chain.rows.find((r) => r.isAtm) ?? chain.rows[0];
  const [strike, setStrike] = useState<number>(atm?.strike ?? chain.atmStrike);
  const [type, setType] = useState<"CE" | "PE">("CE");

  // Resolve the chosen contract's FYERS symbol from the live chain.
  const row = chain.rows.find((r) => r.strike === strike) ?? atm;
  const quote = row ? (type === "CE" ? row.ce : row.pe) : undefined;
  const symbol = quote?.symbol ?? "";

  const { candles, loading, error } = useHistory(symbol, resolution);

  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <ChartHeader
        icon={LineChart}
        title="Option Premium"
        right={
          <div className="flex items-center gap-1.5">
            <Select value={String(strike)} onChange={(v) => setStrike(Number(v))}>
              {chain.rows.map((r) => (
                <option key={r.strike} value={r.strike}>
                  {r.strike}
                  {r.isAtm ? " (ATM)" : ""}
                </option>
              ))}
            </Select>
            <Segmented
              size="xs"
              value={type}
              onChange={(v) => setType(v as "CE" | "PE")}
              options={[
                { value: "CE", label: "CE" },
                { value: "PE", label: "PE" },
              ]}
            />
            <ResolutionPicker value={resolution} onChange={setResolution} />
          </div>
        }
        badge={<ProvenanceBadge kind="BROKER" />}
      />
      <p className="mb-2 font-mono text-[9px] text-zinc-600">{symbol || "No symbol for this contract"}</p>
      {!symbol ? (
        <Empty icon={LineChart} message="This strike/type has no tradable symbol in the current chain." />
      ) : loading && candles.length === 0 ? (
        <Spinner label="Loading premium history…" />
      ) : error ? (
        <Banner tone="warn">Couldn't load premium history ({error}).</Banner>
      ) : candles.length < 2 ? (
        <Empty icon={LineChart} message="No premium candles returned for this contract/timeframe yet." />
      ) : (
        <>
          <div className="mb-1 flex items-center gap-3 text-2xs text-zinc-600">
            <span className="font-mono">
              Last <span className="text-zinc-200">{dec(candles[candles.length - 1].close, 2)}</span>
            </span>
            <span className="font-mono">Live LTP {quote && quote.ltp > 0 ? dec(quote.ltp, 2) : "—"}</span>
          </div>
          <LineSeries
            points={candles.map((c) => ({ t: c.t, v: c.close }))}
            color="#3b82f6"
            valueFmt={(v) => dec(v, 1)}
            timeAxis
            name="Premium"
          />
          <FootNote>Broker historical traded premium via getHistory · {candles.length} candles</FootNote>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// In-session computed series (OI / IV / PCR / Greeks / Volume)
// ---------------------------------------------------------------------------

interface Sample {
  t: number;
  pcr: number;
  atmIv: number; // decimal
  totalCeOi: number;
  totalPeOi: number;
  totalCeVol: number;
  totalPeVol: number;
  atmGamma: number;
  atmTheta: number;
  atmDelta: number;
  atmVega: number;
}

const MAX_SAMPLES = 300;

function takeSample(chain: EnrichedChain): Sample {
  const atm = chain.rows.find((r) => r.isAtm) ?? chain.rows[0];
  // Average the CE/PE ATM legs for a representative ATM Greek/IV reading.
  const ce = atm?.ce;
  const pe = atm?.pe;
  const atmIv = atm ? atm.ce.iv || atm.pe.iv || (chain.vix ? chain.vix.value / 100 : 0) : 0;
  const avg = (a: number, b: number) => (a + b) / 2;
  return {
    t: chain.asOf,
    pcr: chain.pcr,
    atmIv,
    totalCeOi: chain.totalCeOi,
    totalPeOi: chain.totalPeOi,
    totalCeVol: chain.totalCeVolume,
    totalPeVol: chain.totalPeVolume,
    atmGamma: ce && pe ? avg(ce.greeks.gamma, pe.greeks.gamma) : 0,
    atmTheta: ce && pe ? avg(ce.greeks.theta, pe.greeks.theta) : 0,
    atmDelta: ce && pe ? ce.greeks.delta + pe.greeks.delta : 0, // ATM straddle delta (~0)
    atmVega: ce && pe ? avg(ce.greeks.vega, pe.greeks.vega) : 0,
  };
}

const METRIC_META: Record<
  Exclude<ChartType, "underlying" | "premium">,
  { title: string; icon: typeof Gauge }
> = {
  oi: { title: "Open Interest (CE vs PE)", icon: Layers },
  iv: { title: "ATM Implied Volatility", icon: Gauge },
  pcr: { title: "Put-Call Ratio", icon: Percent },
  greeks: { title: "ATM Greeks", icon: Activity },
  volume: { title: "Volume (CE vs PE)", icon: BarChart3 },
};

function InSessionChart({
  chain,
  metric,
}: {
  chain: EnrichedChain;
  metric: Exclude<ChartType, "underlying" | "premium">;
}) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const lastAsOf = useRef<number>(0);

  // Sample once per fresh chain snapshot (asOf changes on every poll). Capped at MAX_SAMPLES.
  useEffect(() => {
    if (!chain.asOf || chain.asOf === lastAsOf.current) return;
    lastAsOf.current = chain.asOf;
    setSamples((prev) => {
      const next = [...prev, takeSample(chain)];
      return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
    });
  }, [chain]);

  const meta = METRIC_META[metric];

  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <ChartHeader
        icon={meta.icon}
        title={meta.title}
        badge={<ProvenanceBadge kind="COMPUTED" label="In-session" />}
        right={<span className="font-mono text-2xs text-zinc-600">{samples.length} samples</span>}
      />

      <Banner tone="info">
        In-session series — built live since you opened this view (one sample per chain refresh). The FYERS retail
        feed does not persist intraday {metricNoun(metric)} history, so this is COMPUTED locally, not full-day history.
      </Banner>

      <div className="mt-3">
        {samples.length < 2 ? (
          <Empty
            icon={Info}
            message={`Collecting samples… one is captured on every live chain refresh (${chain.instrument.label}). Keep this view open — the line builds as new snapshots arrive.`}
          />
        ) : (
          <MetricChart metric={metric} samples={samples} />
        )}
      </div>

      <FootNote>
        Latest snapshot {fmtTime(chain.asOf)} · capped at {MAX_SAMPLES} samples
      </FootNote>
    </div>
  );
}

function metricNoun(metric: Exclude<ChartType, "underlying" | "premium">): string {
  switch (metric) {
    case "oi": return "open-interest";
    case "iv": return "implied-vol";
    case "pcr": return "PCR";
    case "greeks": return "Greeks";
    case "volume": return "volume";
  }
}

function MetricChart({
  metric,
  samples,
}: {
  metric: Exclude<ChartType, "underlying" | "premium">;
  samples: Sample[];
}) {
  switch (metric) {
    case "pcr":
      return (
        <LineSeries
          points={samples.map((s) => ({ t: s.t, v: s.pcr }))}
          color="#a78bfa"
          valueFmt={(v) => dec(v, 2)}
          baseline={1}
          timeAxis
          name="PCR"
        />
      );
    case "iv":
      return (
        <LineSeries
          points={samples.map((s) => ({ t: s.t, v: s.atmIv * 100 }))}
          color="#3b82f6"
          valueFmt={(v) => `${dec(v, 1)}%`}
          timeAxis
          name="ATM IV"
        />
      );
    case "oi":
      return (
        <MultiLine
          series={[
            { label: "CE OI", color: "#ef4444", points: samples.map((s) => ({ t: s.t, v: s.totalCeOi })) },
            { label: "PE OI", color: "#10b981", points: samples.map((s) => ({ t: s.t, v: s.totalPeOi })) },
          ]}
          valueFmt={(v) => compact(v)}
        />
      );
    case "volume":
      return (
        <MultiLine
          series={[
            { label: "CE Vol", color: "#ef4444", points: samples.map((s) => ({ t: s.t, v: s.totalCeVol })) },
            { label: "PE Vol", color: "#10b981", points: samples.map((s) => ({ t: s.t, v: s.totalPeVol })) },
          ]}
          valueFmt={(v) => compact(v)}
        />
      );
    case "greeks":
      return (
        <MultiLine
          series={[
            { label: "ATM Γ", color: "#3b82f6", points: samples.map((s) => ({ t: s.t, v: s.atmGamma })) },
            { label: "ATM Θ", color: "#ef4444", points: samples.map((s) => ({ t: s.t, v: s.atmTheta })) },
            { label: "ATM V", color: "#f59e0b", points: samples.map((s) => ({ t: s.t, v: s.atmVega })) },
          ]}
          valueFmt={(v) => dec(v, 4)}
          independentScale
        />
      );
  }
}

// ---------------------------------------------------------------------------
// SVG primitives
// ---------------------------------------------------------------------------

function Candlestick({ candles, resolution }: { candles: Candle[]; resolution: string }) {
  const visible = candles.slice(-150);
  // Measured width: the viewBox matches the rendered CSS width, so nothing distorts
  // and hover coordinates map 1:1.
  const [wrapRef, measuredW] = useMeasuredWidth<HTMLDivElement>();
  const width = measuredW || SVG_W;
  const [hover, setHover] = useState<number | null>(null);
  const geom = useMemo(() => {
    const chartW = width - PAD.left - PAD.right;
    const chartH = SVG_H - PAD.top - PAD.bottom;
    const highs = visible.map((c) => c.high);
    const lows = visible.map((c) => c.low);
    const maxH = Math.max(...highs);
    const minL = Math.min(...lows);
    const range = maxH - minL || 1;
    const xScale = (i: number) => PAD.left + (i / Math.max(1, visible.length - 1)) * chartW;
    const yScale = (p: number) => PAD.top + chartH - ((p - minL) / range) * chartH;
    const cw = Math.max(1.5, (chartW / visible.length) * 0.6);
    return { chartW, chartH, maxH, minL, range, xScale, yScale, cw };
  }, [visible, width]);

  const hc = hover != null ? visible[hover] : null;

  return (
    <div ref={wrapRef} className="relative">
      <svg viewBox={`0 0 ${width} ${SVG_H}`} className="w-full" style={{ maxHeight: 360 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((tk) => {
          const y = PAD.top + tk * geom.chartH;
          const price = geom.maxH - tk * geom.range;
          return (
            <g key={tk}>
              <line x1={PAD.left} y1={y} x2={width - PAD.right} y2={y} stroke="#1a1a20" strokeWidth={1} />
              <text x={width - PAD.right + 4} y={y + 3} fill="#3f3f46" fontSize={8}>
                {dec(price, 1)}
              </text>
            </g>
          );
        })}
        {visible.map((c, i) => {
          const x = geom.xScale(i);
          const green = c.close >= c.open;
          const color = green ? "#10b981" : "#ef4444";
          const bodyTop = geom.yScale(Math.max(c.open, c.close));
          const bodyBottom = geom.yScale(Math.min(c.open, c.close));
          const bodyH = Math.max(1, bodyBottom - bodyTop);
          return (
            <g key={i}>
              <line x1={x} y1={geom.yScale(c.high)} x2={x} y2={geom.yScale(c.low)} stroke={color} strokeWidth={1} />
              <rect x={x - geom.cw / 2} y={bodyTop} width={geom.cw} height={bodyH} fill={color} rx={0.5} />
            </g>
          );
        })}
        {visible.map((c, i) => {
          const step = Math.ceil(visible.length / 6);
          if (i % step !== 0) return null;
          const x = geom.xScale(i);
          return (
            <text key={`t-${i}`} x={x} y={SVG_H - 8} fill="#3f3f46" fontSize={8} textAnchor="middle">
              {axisLabel(c.t, resolution)}
            </text>
          );
        })}
        <SvgHoverLayer
          width={width}
          height={SVG_H}
          padL={PAD.left}
          padR={PAD.right}
          padT={PAD.top}
          padB={PAD.bottom}
          count={visible.length}
          xOf={geom.xScale}
          yOf={(i) => geom.yScale(visible[i].close)}
          hoverIndex={hover}
          onHover={setHover}
        />
      </svg>
      {hc && hover != null && (
        <ChartTooltip
          x={geom.xScale(hover)}
          y={geom.yScale(hc.close)}
          containerWidth={width}
          title={axisLabel(hc.t, resolution)}
          rows={[
            { label: "O", value: dec(hc.open, 1) },
            { label: "H", value: dec(hc.high, 1) },
            { label: "L", value: dec(hc.low, 1) },
            { label: "C", value: dec(hc.close, 1), color: hc.close >= hc.open ? "#10b981" : "#ef4444" },
            ...(hc.volume > 0 ? [{ label: "V", value: compact(hc.volume) }] : []),
          ]}
        />
      )}
    </div>
  );
}

interface Pt {
  t: number;
  v: number;
}

function LineSeries({
  points,
  color,
  valueFmt,
  baseline,
  timeAxis,
  name = "Value",
}: {
  points: Pt[];
  color: string;
  valueFmt: (v: number) => string;
  baseline?: number;
  timeAxis?: boolean;
  name?: string;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth<HTMLDivElement>();
  const width = measuredW || SVG_W;
  const [hover, setHover] = useState<number | null>(null);
  const geom = useMemo(() => buildLineGeom(points, baseline, width), [points, baseline, width]);
  if (!geom) return <Empty message="Not enough points to draw yet." />;

  const hp = hover != null ? points[hover] : null;

  return (
    <div ref={wrapRef} className="relative">
      {/* No maxHeight below SVG_H: viewBox width == CSS width makes the intrinsic height
          exactly SVG_H, and any clamp would rescale + letterbox, misaligning hover/tooltip. */}
      <svg viewBox={`0 0 ${width} ${SVG_H}`} className="w-full">
        {geom.gridYs.map((g, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={g.y} x2={width - PAD.right} y2={g.y} stroke="#1a1a20" strokeWidth={1} />
            <text x={width - PAD.right + 4} y={g.y + 3} fill="#3f3f46" fontSize={8}>
              {valueFmt(g.value)}
            </text>
          </g>
        ))}
        {baseline != null && geom.baselineY != null && (
          <line
            x1={PAD.left}
            y1={geom.baselineY}
            x2={width - PAD.right}
            y2={geom.baselineY}
            stroke="#52525b"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
        <polygon points={geom.areaPts} fill={color} fillOpacity={0.1} />
        <polyline points={geom.linePts} fill="none" stroke={color} strokeWidth={1.5} />
        <circle cx={geom.lastX} cy={geom.lastY} r={2.5} fill={color} />
        {timeAxis &&
          geom.timeTicks.map((tk, i) => (
            <text key={i} x={tk.x} y={SVG_H - 8} fill="#3f3f46" fontSize={8} textAnchor="middle">
              {fmtTime(tk.t)}
            </text>
          ))}
        <SvgHoverLayer
          width={width}
          height={SVG_H}
          padL={PAD.left}
          padR={PAD.right}
          padT={PAD.top}
          padB={PAD.bottom}
          count={points.length}
          xOf={(i) => geom.xs[i]}
          yOf={(i) => geom.ys[i]}
          xs={geom.xs}
          hoverIndex={hover}
          onHover={setHover}
        />
      </svg>
      {hp && hover != null && (
        <ChartTooltip
          x={geom.xs[hover]}
          y={geom.ys[hover]}
          containerWidth={width}
          title={fmtTime(hp.t)}
          rows={[{ label: name, value: valueFmt(hp.v), color }]}
        />
      )}
    </div>
  );
}

interface Series {
  label: string;
  color: string;
  points: Pt[];
}

/**
 * Multiple lines on one chart. By default they share one value axis (good for CE vs PE OI/Vol);
 * `independentScale` normalises each series to its own min/max (good for Greeks of differing
 * magnitudes) — then the left axis is omitted and a legend carries the meaning.
 */
function MultiLine({
  series,
  valueFmt,
  independentScale,
}: {
  series: Series[];
  valueFmt: (v: number) => string;
  independentScale?: boolean;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth<HTMLDivElement>();
  const width = measuredW || SVG_W;
  const [hover, setHover] = useState<number | null>(null);
  const len = series[0]?.points.length ?? 0;
  const geom = useMemo(() => {
    if (len < 2) return null;
    const chartW = width - PAD.left - PAD.right;
    const chartH = SVG_H - PAD.top - PAD.bottom;
    const tMin = series[0].points[0].t;
    const tMax = series[0].points[len - 1].t;
    const tSpan = tMax - tMin || 1;
    const xScale = (t: number) => PAD.left + ((t - tMin) / tSpan) * chartW;

    // Shared scale across all series unless independent.
    let globalMin = Infinity;
    let globalMax = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.v < globalMin) globalMin = p.v;
        if (p.v > globalMax) globalMax = p.v;
      }
    }

    const lines = series.map((s) => {
      let lo = globalMin;
      let hi = globalMax;
      if (independentScale) {
        lo = Math.min(...s.points.map((p) => p.v));
        hi = Math.max(...s.points.map((p) => p.v));
      }
      const span = hi - lo || 1;
      const yScale = (v: number) => PAD.top + chartH - ((v - lo) / span) * chartH;
      const pts = s.points.map((p) => `${xScale(p.t).toFixed(1)},${yScale(p.v).toFixed(1)}`).join(" ");
      const last = s.points[s.points.length - 1];
      return { color: s.color, pts, lastX: xScale(last.t), lastY: yScale(last.v) };
    });

    const gridYs = !independentScale
      ? [0, 0.5, 1].map((tk) => ({
          y: PAD.top + tk * chartH,
          value: globalMax - tk * (globalMax - globalMin),
        }))
      : [];

    const timeTicks = [0, 0.5, 1].map((f) => {
      const idx = Math.round(f * (len - 1));
      const p = series[0].points[idx];
      return { x: xScale(p.t), t: p.t };
    });

    const xs = series[0].points.map((p) => xScale(p.t));

    return { lines, gridYs, timeTicks, xs };
  }, [series, len, independentScale, width]);

  if (!geom) return <Empty message="Not enough points to draw yet." />;

  const ht = hover != null ? series[0].points[hover]?.t : null;

  return (
    <>
      <div ref={wrapRef} className="relative">
        {/* No maxHeight below SVG_H — see LineSeries note (hover/tooltip 1:1 contract). */}
        <svg viewBox={`0 0 ${width} ${SVG_H}`} className="w-full">
          {geom.gridYs.map((g, i) => (
            <g key={i}>
              <line x1={PAD.left} y1={g.y} x2={width - PAD.right} y2={g.y} stroke="#1a1a20" strokeWidth={1} />
              <text x={width - PAD.right + 4} y={g.y + 3} fill="#3f3f46" fontSize={8}>
                {valueFmt(g.value)}
              </text>
            </g>
          ))}
          {geom.lines.map((l, i) => (
            <g key={i}>
              <polyline points={l.pts} fill="none" stroke={l.color} strokeWidth={1.5} />
              <circle cx={l.lastX} cy={l.lastY} r={2.5} fill={l.color} />
            </g>
          ))}
          {geom.timeTicks.map((tk, i) => (
            <text key={`tt-${i}`} x={tk.x} y={SVG_H - 8} fill="#3f3f46" fontSize={8} textAnchor="middle">
              {fmtTime(tk.t)}
            </text>
          ))}
          <SvgHoverLayer
            width={width}
            height={SVG_H}
            padL={PAD.left}
            padR={PAD.right}
            padT={PAD.top}
            padB={PAD.bottom}
            count={len}
            xOf={(i) => geom.xs[i]}
            xs={geom.xs}
            hoverIndex={hover}
            onHover={setHover}
          />
        </svg>
        {hover != null && ht != null && (
          <ChartTooltip
            x={geom.xs[hover]}
            y={30}
            containerWidth={width}
            title={fmtTime(ht)}
            rows={series.map((s) => ({
              label: s.label,
              value: s.points[hover] ? valueFmt(s.points[hover].v) : "—",
              color: s.color,
            }))}
          />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px]">
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          return (
            <span key={s.label} className="inline-flex items-center gap-1 text-zinc-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span>{s.label}</span>
              <span className="font-mono text-zinc-300">{last ? valueFmt(last.v) : "—"}</span>
            </span>
          );
        })}
        {independentScale && <span className="text-zinc-700">(each series auto-scaled)</span>}
      </div>
    </>
  );
}

function buildLineGeom(points: Pt[], baseline: number | undefined, width: number) {
  if (points.length < 2) return null;
  const chartW = width - PAD.left - PAD.right;
  const chartH = SVG_H - PAD.top - PAD.bottom;
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const tSpan = tMax - tMin || 1;
  let lo = Math.min(...points.map((p) => p.v));
  let hi = Math.max(...points.map((p) => p.v));
  if (baseline != null) {
    lo = Math.min(lo, baseline);
    hi = Math.max(hi, baseline);
  }
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const span = hi - lo || 1;
  const xScale = (t: number) => PAD.left + ((t - tMin) / tSpan) * chartW;
  const yScale = (v: number) => PAD.top + chartH - ((v - lo) / span) * chartH;

  const linePts = points.map((p) => `${xScale(p.t).toFixed(1)},${yScale(p.v).toFixed(1)}`).join(" ");
  const baseY = PAD.top + chartH;
  const areaPts = `${PAD.left},${baseY} ${linePts} ${(width - PAD.right).toFixed(1)},${baseY}`;
  const last = points[points.length - 1];

  const gridYs = [0, 0.5, 1].map((tk) => ({
    y: PAD.top + tk * chartH,
    value: hi - tk * (hi - lo),
  }));
  const timeTicks = [0, 0.5, 1].map((f) => {
    const idx = Math.round(f * (points.length - 1));
    const p = points[idx];
    return { x: xScale(p.t), t: p.t };
  });

  return {
    linePts,
    areaPts,
    gridYs,
    timeTicks,
    lastX: xScale(last.t),
    lastY: yScale(last.v),
    baselineY: baseline != null ? yScale(baseline) : null,
    xs: points.map((p) => xScale(p.t)),
    ys: points.map((p) => yScale(p.v)),
  };
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function useHistory(symbol: string, resolution: string) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setCandles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const days = resolution === "D" ? 90 : resolution === "60" ? 15 : 7;
    (async () => {
      try {
        const res = await optionsApi.getHistory(symbol, resolution, days);
        if (cancelled) return;
        setCandles(parseCandles(res));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, resolution]);

  return { candles, loading, error };
}

function ResolutionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Segmented
      size="xs"
      value={value}
      onChange={onChange}
      options={RESOLUTIONS.map((r) => ({ value: r.value, label: r.label }))}
    />
  );
}

function ChartHeader({
  icon: Icon,
  title,
  right,
  badge,
}: {
  icon: typeof Gauge;
  title: string;
  right?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Icon size={12} className="text-zinc-600" strokeWidth={1.5} />
      <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{title}</span>
      {badge}
      {right && <div className="ml-auto flex items-center gap-1.5">{right}</div>}
    </div>
  );
}

function OhlcRow({ c }: { c: Candle }) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-zinc-600">
      <span className="font-mono">O {dec(c.open, 1)}</span>
      <span className="font-mono">H {dec(c.high, 1)}</span>
      <span className="font-mono">L {dec(c.low, 1)}</span>
      <span className={`font-mono ${c.close >= c.open ? "text-gain" : "text-loss"}`}>C {dec(c.close, 1)}</span>
    </div>
  );
}

function FootNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[9px] text-zinc-700">{children}</p>;
}

function axisLabel(tMs: number, resolution: string): string {
  const d = new Date(tMs);
  if (resolution === "D") {
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
