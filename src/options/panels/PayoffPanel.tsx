/**
 * Payoff Analyzer — the strategy's P/L profile across the spot grid. Reads the working legs
 * (StrategyProvider) and the live chain, runs computePayoff, and draws a large self-contained
 * inline SVG: the expiry P/L curve, the today (mark-to-model) curve, the zero line, shaded
 * profit (green) / loss (red) regions, break-even markers, the live spot marker, and an
 * optional lognormal terminal-distribution overlay. Below the chart: Max Profit / Max Loss,
 * break-evens, net premium, aggregate position Greeks and a probability-of-profit readout.
 * Everything is COMPUTED from the live feed — no fabricated numbers.
 */

import { useMemo, useState } from "react";
import { LineChart, Activity } from "lucide-react";
import { useStrategy } from "../data/StrategyProvider";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Stat, Row, Empty, Segmented } from "../components/ui";
import { computePayoff, type PayoffOpts } from "../lib/payoff";
import { lognormalWeights } from "../lib/probability";
import { money, dec, signed } from "../lib/format";
import type { EnrichedChain, PayoffResult } from "../types";

export function PayoffPanel() {
  return (
    <Panel
      title="Payoff Analyzer"
      icon={LineChart}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <PayoffBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function buildOpts(chain: EnrichedChain): { opts: PayoffOpts; atmIv: number } {
  const atmRow = chain.rows.find((r) => r.isAtm) ?? chain.rows[0];
  const atmIv =
    (atmRow ? atmRow.ce.iv || atmRow.pe.iv : 0) || (chain.vix ? chain.vix.value / 100 : 0.15);
  return {
    atmIv,
    opts: {
      lotSize: chain.instrument.lotSize,
      spot: chain.spot,
      atmIv,
      nowMs: Date.now(),
      riskFreeRate: chain.riskFreeRate,
    },
  };
}

function PayoffBody({ chain }: { chain: EnrichedChain }) {
  const strat = useStrategy();
  const [showToday, setShowToday] = useState(true);
  const [showDist, setShowDist] = useState(true);

  const { opts, atmIv } = useMemo(() => buildOpts(chain), [chain]);
  const result = useMemo<PayoffResult>(() => computePayoff(strat.legs, opts), [strat.legs, opts]);

  if (strat.legs.length === 0) {
    return (
      <Empty
        icon={LineChart}
        message="No strategy to analyze. Load a template or add legs in the Strategy Builder to see the payoff profile."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Controls ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-semibold text-zinc-300">{strat.name}</span>
        <span className="text-[9px] text-zinc-700">
          {strat.legs.length} leg{strat.legs.length === 1 ? "" : "s"} · spot {dec(chain.spot, 0)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Segmented
            size="xs"
            value={showToday ? "both" : "exp"}
            onChange={(v) => setShowToday(v === "both")}
            options={[
              { value: "both", label: "Expiry + Today" },
              { value: "exp", label: "Expiry only" },
            ]}
          />
          <Segmented
            size="xs"
            value={showDist ? "on" : "off"}
            onChange={(v) => setShowDist(v === "on")}
            options={[
              { value: "on", label: "Distribution" },
              { value: "off", label: "Hide dist" },
            ]}
          />
        </div>
      </div>

      {/* ---- Chart ---- */}
      <PayoffChart result={result} chain={chain} atmIv={atmIv} showToday={showToday} showDist={showDist} />

      {/* ---- Headline tiles ---- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Max Profit"
          value={Number.isFinite(result.maxProfit) ? money(result.maxProfit) : "Unlimited"}
          tone="green"
        />
        <Stat
          label="Max Loss"
          value={Number.isFinite(result.maxLoss) ? money(result.maxLoss) : "Unlimited"}
          tone="rose"
        />
        <Stat
          label={result.netPremium < 0 ? "Net Credit" : "Net Debit"}
          value={money(Math.abs(result.netPremium))}
          tone={result.netPremium < 0 ? "green" : "rose"}
        />
        <Stat
          label="Prob of Profit"
          value={`${dec(result.probOfProfit * 100, 1)}%`}
          tone="blue"
          sub="Lognormal model"
        />
      </div>

      {/* ---- Break-evens + Greeks ---- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Break-evens & range</span>
            <ProvenanceBadge kind="COMPUTED" />
          </div>
          <Row
            label="Break-even(s)"
            value={
              result.breakevens.length > 0 ? result.breakevens.map((b) => dec(b, 1)).join("  ·  ") : "None in range"
            }
          />
          <Row label="Expected value" value={money(result.expectedValue)} valueClass={toneOf(result.expectedValue)} />
          <Row
            label="Risk : Reward"
            value={result.riskReward > 0 ? `1 : ${dec(result.riskReward, 2)}` : "Undefined"}
          />
        </div>

        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Activity size={12} className="text-zinc-600" strokeWidth={1.5} />
            <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Position Greeks</span>
            <ProvenanceBadge kind="COMPUTED" />
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            <Row label="Delta" value={signed(result.greeks.delta, 2)} valueClass={toneOf(result.greeks.delta)} />
            <Row label="Gamma" value={signed(result.greeks.gamma, 4)} valueClass={toneOf(result.greeks.gamma)} />
            <Row label="Theta / day" value={money(result.greeks.theta)} valueClass={toneOf(result.greeks.theta)} />
            <Row label="Vega" value={signed(result.greeks.vega, 1)} valueClass={toneOf(result.greeks.vega)} />
            <Row label="Rho" value={signed(result.greeks.rho, 1)} valueClass={toneOf(result.greeks.rho)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function toneOf(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "text-zinc-300";
  return n > 0 ? "text-gain" : "text-loss";
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

const W = 760;
const H = 300;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 22;

function PayoffChart({
  result,
  chain,
  atmIv,
  showToday,
  showDist,
}: {
  result: PayoffResult;
  chain: EnrichedChain;
  atmIv: number;
  showToday: boolean;
  showDist: boolean;
}) {
  const geom = useMemo(() => {
    const pts = result.points;
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p.spot);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    if (!(maxX > minX)) return null;

    const ys: number[] = [];
    for (const p of pts) {
      if (Number.isFinite(p.expiryPnl)) ys.push(p.expiryPnl);
      if (showToday && Number.isFinite(p.todayPnl)) ys.push(p.todayPnl);
    }
    if (ys.length === 0) return null;
    let minY = Math.min(...ys, 0);
    let maxY = Math.max(...ys, 0);
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    // Headroom so the curve never hugs the frame.
    const padY = (maxY - minY) * 0.08;
    minY -= padY;
    maxY += padY;

    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const sx = (s: number) => PAD_L + ((s - minX) / (maxX - minX)) * plotW;
    const sy = (v: number) => PAD_T + (1 - (v - minY) / (maxY - minY)) * plotH;
    const clampX = (s: number) => Math.min(maxX, Math.max(minX, s));

    const zeroY = sy(0);
    const baseY = PAD_T + plotH;

    // Split expiry curve into profit (above zero) / loss (below zero) fill bands.
    const expLine = pts.map((p) => `${sx(p.spot).toFixed(1)},${sy(p.expiryPnl).toFixed(1)}`).join(" ");
    const profitArea = buildBand(pts, sx, sy, zeroY, true);
    const lossArea = buildBand(pts, sx, sy, zeroY, false);

    const todayLine = showToday
      ? pts
          .filter((p) => Number.isFinite(p.todayPnl))
          .map((p) => `${sx(p.spot).toFixed(1)},${sy(p.todayPnl).toFixed(1)}`)
          .join(" ")
      : "";

    // Lognormal distribution overlay (scaled into the top region, purely visual).
    let distArea = "";
    if (showDist) {
      const t = chain.selectedExpiry?.t ?? 0;
      if (t > 0 && atmIv > 0) {
        const grid = pts.map((p) => p.spot);
        const w = lognormalWeights(grid, chain.spot, atmIv, t, chain.riskFreeRate);
        const wMax = w.reduce((m, x) => Math.max(m, x), 0);
        if (wMax > 0) {
          const distH = plotH * 0.28;
          const dy = (val: number) => PAD_T + (1 - val / wMax) * distH;
          const linePts = w.map((val, i) => `${sx(grid[i]).toFixed(1)},${dy(val).toFixed(1)}`).join(" ");
          distArea = `${sx(minX).toFixed(1)},${(PAD_T + distH).toFixed(1)} ${linePts} ${sx(maxX).toFixed(1)},${(PAD_T + distH).toFixed(1)}`;
        }
      }
    }

    const spotX = sx(clampX(chain.spot));
    const bes = result.breakevens.filter((b) => b >= minX && b <= maxX).map((b) => ({ x: sx(b), v: b }));

    // X-axis ticks (5 evenly spaced spots).
    const ticks: { x: number; label: string }[] = [];
    for (let i = 0; i <= 4; i++) {
      const s = minX + ((maxX - minX) * i) / 4;
      ticks.push({ x: sx(s), label: dec(s, 0) });
    }

    return {
      sx,
      sy,
      zeroY,
      baseY,
      expLine,
      profitArea,
      lossArea,
      todayLine,
      distArea,
      spotX,
      bes,
      ticks,
      minX,
      maxX,
    };
  }, [result.points, result.breakevens, chain, atmIv, showToday, showDist]);

  if (!geom) {
    return (
      <div className="rounded-panel border border-border bg-panel p-4 text-2xs text-zinc-600">
        Not enough resolution to draw the payoff at this configuration.
      </div>
    );
  }

  const zeroInView = geom.zeroY >= PAD_T && geom.zeroY <= H - PAD_B;

  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {/* Profit / loss shaded regions */}
        {geom.profitArea && <path d={geom.profitArea} fill="rgba(34,197,94,0.14)" />}
        {geom.lossArea && <path d={geom.lossArea} fill="rgba(244,63,94,0.14)" />}

        {/* Distribution overlay */}
        {geom.distArea && <polygon points={geom.distArea} fill="rgba(245,158,11,0.10)" stroke="#f59e0b" strokeWidth={0.75} />}

        {/* Zero line */}
        {zeroInView && (
          <line x1={PAD_L} y1={geom.zeroY} x2={W - PAD_R} y2={geom.zeroY} stroke="#52525b" strokeWidth={1} />
        )}

        {/* X ticks */}
        {geom.ticks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={H - PAD_B} x2={t.x} y2={H - PAD_B + 3} stroke="#3f3f46" strokeWidth={1} />
            <text x={t.x} y={H - PAD_B + 13} textAnchor="middle" className="fill-zinc-600 font-mono" fontSize={9}>
              {t.label}
            </text>
          </g>
        ))}

        {/* Today (mark-to-model) curve */}
        {geom.todayLine && (
          <polyline points={geom.todayLine} fill="none" stroke="#a78bfa" strokeWidth={1.25} strokeDasharray="4 3" />
        )}

        {/* Expiry curve */}
        <polyline points={geom.expLine} fill="none" stroke="#3b82f6" strokeWidth={1.75} />

        {/* Break-even markers */}
        {geom.bes.map((b, i) => (
          <g key={i}>
            <line x1={b.x} y1={PAD_T} x2={b.x} y2={H - PAD_B} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" />
            <text x={b.x} y={PAD_T + 8} textAnchor="middle" className="fill-warn font-mono" fontSize={9}>
              {dec(b.v, 0)}
            </text>
          </g>
        ))}

        {/* Spot marker */}
        <line x1={geom.spotX} y1={PAD_T} x2={geom.spotX} y2={H - PAD_B} stroke="#e4e4e7" strokeWidth={1} />
        <text x={geom.spotX} y={H - PAD_B - 3} textAnchor="middle" className="fill-zinc-200 font-mono" fontSize={9}>
          {dec(chain.spot, 0)}
        </text>
      </svg>

      {/* Legend */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px]">
        <Legend color="#3b82f6" label="Expiry P/L" />
        {showToday && <Legend color="#a78bfa" label="Today (mark-to-model)" dashed />}
        <Legend color="#e4e4e7" label={`Spot ${dec(chain.spot, 0)}`} />
        <Legend color="#f59e0b" label="Break-even" dashed />
        {showDist && geom.distArea && <Legend color="#f59e0b" label="Terminal distribution" />}
        <span className="ml-auto text-zinc-700">Green = profit · Red = loss</span>
      </div>
    </div>
  );
}

/** Build a fill band between the expiry curve and the zero line, clipped to one side. */
function buildBand(
  pts: { spot: number; expiryPnl: number }[],
  sx: (s: number) => number,
  sy: (v: number) => number,
  zeroY: number,
  profitSide: boolean,
): string {
  // Use a path that follows the curve where it's on the desired side of zero, clamped to
  // the zero baseline elsewhere — interpolating zero crossings keeps the fill tight.
  let d = "";
  let open = false;
  const segs: string[] = [];
  let cur: string[] = [];

  const onSide = (v: number) => (profitSide ? v >= 0 : v <= 0);

  for (let i = 0; i < pts.length; i++) {
    const v = pts[i].expiryPnl;
    if (!Number.isFinite(v)) continue;
    const x = sx(pts[i].spot);
    const y = sy(v);
    if (onSide(v)) {
      if (!open) {
        // Enter the band: interpolate the crossing from the previous point if any.
        if (i > 0 && Number.isFinite(pts[i - 1].expiryPnl) && !onSide(pts[i - 1].expiryPnl)) {
          const cx = crossX(pts[i - 1], pts[i], sx);
          cur.push(`M ${cx.toFixed(1)} ${zeroY.toFixed(1)}`);
          cur.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
        } else {
          cur.push(`M ${x.toFixed(1)} ${zeroY.toFixed(1)}`);
          cur.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
        }
        open = true;
      } else {
        cur.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
    } else if (open) {
      // Exit the band: interpolate crossing back to baseline and close.
      const cx = crossX(pts[i - 1], pts[i], sx);
      cur.push(`L ${cx.toFixed(1)} ${zeroY.toFixed(1)} Z`);
      segs.push(cur.join(" "));
      cur = [];
      open = false;
    }
  }
  if (open && cur.length > 0) {
    const lastX = sx(pts[pts.length - 1].spot);
    cur.push(`L ${lastX.toFixed(1)} ${zeroY.toFixed(1)} Z`);
    segs.push(cur.join(" "));
  }
  d = segs.join(" ");
  return d;
}

function crossX(
  a: { spot: number; expiryPnl: number },
  b: { spot: number; expiryPnl: number },
  sx: (s: number) => number,
): number {
  const va = a.expiryPnl;
  const vb = b.expiryPnl;
  if (vb === va) return sx(b.spot);
  const frac = (0 - va) / (vb - va);
  return sx(a.spot + frac * (b.spot - a.spot));
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-500">
      <span
        className="inline-block h-0 w-4 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
      />
      <span className="font-mono">{label}</span>
    </span>
  );
}
