/**
 * Probability Dashboard — lognormal terminal-distribution analytics for the live chain.
 *
 * Everything here is COMPUTED from spot, ATM IV and time-to-expiry via lib/probability.ts —
 * FYERS provides no probability feed. We surface:
 *   - Probability ITM / OTM / Touch for the ATM and a few surrounding strikes (CE & PE).
 *   - Expected Trading Range (1σ & 2σ bands) as a visual range bar around spot.
 *   - Expected Closing Range (1σ) + an inline SVG distribution curve (density vs spot),
 *     marking spot, ATM and ±1σ.
 *   - A user-selectable target strike to read its prob ITM/OTM/Touch on both sides.
 *
 * Inputs: chain.spot, ATM IV (atmRow.ce.iv || atmRow.pe.iv || chain.vix.value/100),
 *         t = chain.selectedExpiry.t, r = chain.riskFreeRate. No fabricated data.
 */

import { useMemo, useState } from "react";
import { Percent, Target, BarChart3 } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Select, Row, Banner } from "../components/ui";
import { useMeasuredWidth } from "../../components/charts/svgHover";
import { dec, pct, volPct } from "../lib/format";
import {
  probItm,
  probOtm,
  probTouch,
  expectedRange,
  distributionCurve,
  type ExpectedRange,
  type DistributionPoint,
} from "../lib/probability";
import type { EnrichedChain, StrikeRow } from "../types";

export function ProbabilityPanel() {
  return (
    <Panel
      title="Probability Dashboard"
      icon={Percent}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <ProbabilityBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function ProbabilityBody({ chain }: { chain: EnrichedChain }) {
  const atmRow = useMemo<StrikeRow | undefined>(() => {
    const flagged = chain.rows.find((r) => r.isAtm);
    if (flagged) return flagged;
    const target = chain.atmStrike || chain.spot;
    let best: StrikeRow | undefined;
    let bestDist = Infinity;
    for (const r of chain.rows) {
      const d = Math.abs(r.strike - target);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best;
  }, [chain.rows, chain.atmStrike, chain.spot]);

  // Pricing inputs. ATM IV preferred, then PE, then VIX as a market-implied fallback.
  const spot = chain.spot;
  const t = chain.selectedExpiry?.t ?? 0;
  const r = chain.riskFreeRate;
  const vixIv = chain.vix && chain.vix.value > 0 ? chain.vix.value / 100 : 0;
  const atmIv = atmRow ? atmRow.ce.iv || atmRow.pe.iv || vixIv : vixIv;
  const ivSource = atmRow && (atmRow.ce.iv > 0 || atmRow.pe.iv > 0) ? "ATM solved IV" : vixIv > 0 ? "India VIX" : "—";

  const usable = spot > 0 && atmIv > 0 && t > 0;

  // Strike set around ATM for the probability table: ATM ± a few steps (clamped to chain).
  const focusRows = useMemo<StrikeRow[]>(() => {
    if (!atmRow) return [];
    const idx = chain.rows.findIndex((r) => r.strike === atmRow.strike);
    if (idx < 0) return [atmRow];
    const lo = Math.max(0, idx - 4);
    const hi = Math.min(chain.rows.length, idx + 5);
    return chain.rows.slice(lo, hi);
  }, [chain.rows, atmRow]);

  const range = useMemo<ExpectedRange>(() => expectedRange(spot, atmIv, t), [spot, atmIv, t]);
  const curve = useMemo<DistributionPoint[]>(() => distributionCurve(spot, atmIv, t, r), [spot, atmIv, t, r]);

  // User-selectable target strike.
  const [targetStrike, setTargetStrike] = useState<number>(atmRow?.strike ?? 0);
  const effectiveTarget = chain.rows.some((row) => row.strike === targetStrike)
    ? targetStrike
    : (atmRow?.strike ?? chain.rows[0]?.strike ?? 0);

  if (!atmRow) {
    return <Banner tone="warn">No ATM strike could be located in the current chain.</Banner>;
  }
  if (!usable) {
    return (
      <div className="space-y-3">
        <Banner tone="warn">
          Probability analytics need a positive spot, a solvable ATM IV and time-to-expiry. One is missing right now
          (spot {dec(spot, 1)}, IV {atmIv > 0 ? volPct(atmIv) : "—"}, T {dec(t * 365, 1)}d). Showing nothing rather
          than fabricated numbers.
        </Banner>
        <p className="text-2xs text-zinc-600">
          IV source attempted: {ivSource}. All probabilities are lognormal-model COMPUTED, never broker-fed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Inputs header ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-zinc-600">
        <span>
          Spot <span className="font-mono text-zinc-300">{dec(spot, 1)}</span>
        </span>
        <span>
          ATM IV <span className="font-mono text-zinc-300">{volPct(atmIv)}</span>{" "}
          <span className="text-zinc-700">({ivSource})</span>
        </span>
        <span>
          T <span className="font-mono text-zinc-300">{dec(t * 365, 1)}d</span>
        </span>
        <span>
          r <span className="font-mono text-zinc-300">{pct(r * 100, 2)}</span>
        </span>
        {chain.selectedExpiry && (
          <span>
            Expiry <span className="font-mono text-zinc-300">{chain.selectedExpiry.label}</span>
          </span>
        )}
      </div>

      {/* ---- Expected range bar ---- */}
      <ExpectedRangeBar spot={spot} range={range} />

      {/* ---- Distribution curve ---- */}
      <DistributionChart spot={spot} atmStrike={atmRow.strike} range={range} curve={curve} />

      {/* ---- Per-strike probabilities ---- */}
      <div className="rounded-panel border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <BarChart3 size={12} className="text-zinc-600" strokeWidth={1.5} />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            Probabilities — ATM ± strikes
          </span>
          <ProvenanceBadge kind="COMPUTED" />
        </div>
        <div className="overflow-auto">
          <table className="w-full border-collapse text-2xs">
            <thead className="bg-panel">
              <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                <Th center>Strike</Th>
                <Th>CE ITM</Th>
                <Th>CE OTM</Th>
                <Th>CE Touch</Th>
                <Th>PE ITM</Th>
                <Th>PE OTM</Th>
                <Th>PE Touch</Th>
              </tr>
            </thead>
            <tbody>
              {focusRows.map((row) => {
                const isAtm = row.strike === atmRow.strike;
                const ceItm = probItm("CE", spot, row.strike, atmIv, t, r);
                const peItm = probItm("PE", spot, row.strike, atmIv, t, r);
                const touch = probTouch(spot, row.strike, atmIv, t);
                return (
                  <tr
                    key={row.strike}
                    className={`border-b border-border-subtle/60 ${isAtm ? "bg-info-dim" : "hover:bg-surface/60"}`}
                  >
                    <td className="px-1.5 py-1 text-center">
                      <span className={`font-mono font-semibold ${isAtm ? "text-info" : "text-zinc-300"}`}>
                        {row.strike}
                      </span>
                    </td>
                    <ProbCell p={ceItm} />
                    <ProbCell p={probOtm("CE", spot, row.strike, atmIv, t, r)} dim />
                    <ProbCell p={touch} tone="warn" />
                    <ProbCell p={peItm} />
                    <ProbCell p={probOtm("PE", spot, row.strike, atmIv, t, r)} dim />
                    <ProbCell p={touch} tone="warn" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Target strike picker ---- */}
      <TargetStrikeCard
        chain={chain}
        spot={spot}
        atmIv={atmIv}
        t={t}
        r={r}
        target={effectiveTarget}
        onChange={(s) => setTargetStrike(s)}
      />

      <p className="text-2xs leading-relaxed text-zinc-600">
        All probabilities use a lognormal terminal-price model with drift r — COMPUTED, not broker-fed. Probability of
        Touch is the standard single-barrier first-passage approximation (≈ 2× finishing past the level). The expected
        range is spot × IV × √T. IV used: {volPct(atmIv)} from {ivSource}.
      </p>
    </div>
  );
}

function ExpectedRangeBar({ spot, range }: { spot: number; range: ExpectedRange }) {
  // Map the 2σ band onto a 0..100% track; spot sits in the middle.
  const lo = range.lower2;
  const hi = range.upper2;
  const span = hi - lo;
  const posOf = (x: number) => (span > 0 ? ((x - lo) / span) * 100 : 50);

  const left1 = posOf(range.lower1);
  const right1 = posOf(range.upper1);
  const spotPos = posOf(spot);

  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Target size={12} className="text-zinc-600" strokeWidth={1.5} />
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Expected Trading Range</span>
        <ProvenanceBadge kind="COMPUTED" />
        <span className="ml-auto font-mono text-2xs text-zinc-400">±{dec(range.oneSigma, 0)} (1σ)</span>
      </div>

      <div className="relative mt-6 mb-5 h-2 rounded-sm bg-surface">
        {/* 2σ band (full track, faint) */}
        <div className="absolute inset-0 rounded-sm bg-info/10" />
        {/* 1σ band */}
        <div
          className="absolute top-0 bottom-0 rounded-sm bg-info/40"
          style={{ left: `${left1}%`, width: `${Math.max(0, right1 - left1)}%` }}
        />
        {/* Spot marker */}
        <div className="absolute -top-1 bottom-[-4px] w-px bg-zinc-200" style={{ left: `${spotPos}%` }}>
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-zinc-200">
            {dec(spot, 0)}
          </span>
        </div>
        {/* 1σ edge labels */}
        <Edge posPct={left1} label={dec(range.lower1, 0)} />
        <Edge posPct={right1} label={dec(range.upper1, 0)} />
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <Row label="1σ Lower" value={<span className="text-loss">{dec(range.lower1, 1)}</span>} />
        <Row label="1σ Upper" value={<span className="text-gain">{dec(range.upper1, 1)}</span>} />
        <Row label="2σ Lower" value={<span className="text-loss">{dec(range.lower2, 1)}</span>} />
        <Row label="2σ Upper" value={<span className="text-gain">{dec(range.upper2, 1)}</span>} />
      </div>
      <p className="mt-1.5 text-[9px] text-zinc-700">
        Expected closing range (1σ): {dec(range.lower1, 0)} – {dec(range.upper1, 0)} (~68% of outcomes under the
        lognormal model).
      </p>
    </div>
  );
}

function Edge({ posPct, label }: { posPct: number; label: string }) {
  return (
    <div className="absolute top-0 bottom-0 w-px bg-info/60" style={{ left: `${posPct}%` }}>
      <span className="absolute top-4 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-info">
        {label}
      </span>
    </div>
  );
}

const CHART_W = 560;
const CHART_H = 150;
const PAD_X = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 16;

function DistributionChart({
  spot,
  atmStrike,
  range,
  curve,
}: {
  spot: number;
  atmStrike: number;
  range: ExpectedRange;
  curve: DistributionPoint[];
}) {
  // Measured width so the viewBox matches the rendered CSS px — kills the
  // preserveAspectRatio="none" stretching at narrow widths.
  const [wrapRef, measuredW] = useMeasuredWidth<HTMLDivElement>();
  const width = measuredW || CHART_W;
  const geom = useMemo(() => {
    if (curve.length < 2) return null;
    const xs = curve.map((p) => p.spot);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const maxD = curve.reduce((m, p) => Math.max(m, p.density), 0);
    if (!(maxX > minX) || !(maxD > 0)) return null;

    const plotW = width - 2 * PAD_X;
    const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
    const sx = (s: number) => PAD_X + ((s - minX) / (maxX - minX)) * plotW;
    const sy = (d: number) => PAD_TOP + (1 - d / maxD) * plotH;

    const linePts = curve.map((p) => `${sx(p.spot).toFixed(2)},${sy(p.density).toFixed(2)}`).join(" ");
    const baseY = PAD_TOP + plotH;
    const areaPts = `${PAD_X},${baseY} ${linePts} ${(PAD_X + plotW).toFixed(2)},${baseY}`;

    const clampX = (s: number) => Math.min(maxX, Math.max(minX, s));
    return {
      sx,
      baseY,
      linePts,
      areaPts,
      spotX: sx(clampX(spot)),
      atmX: sx(clampX(atmStrike)),
      lo1X: sx(clampX(range.lower1)),
      hi1X: sx(clampX(range.upper1)),
      inRangeAtm: atmStrike >= minX && atmStrike <= maxX,
    };
  }, [curve, spot, atmStrike, range, width]);

  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <BarChart3 size={12} className="text-zinc-600" strokeWidth={1.5} />
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Distribution Curve</span>
        <ProvenanceBadge kind="COMPUTED" />
        <span className="ml-auto text-[9px] text-zinc-700">Lognormal terminal density vs spot</span>
      </div>

      {!geom ? (
        <Banner tone="warn">Not enough resolution to draw the distribution at this IV/expiry.</Banner>
      ) : (
        <>
          <div ref={wrapRef}>
          <svg viewBox={`0 0 ${width} ${CHART_H}`} className="w-full">
            {/* 1σ shaded band */}
            <rect
              x={geom.lo1X}
              y={PAD_TOP}
              width={Math.max(0, geom.hi1X - geom.lo1X)}
              height={CHART_H - PAD_TOP - PAD_BOTTOM}
              fill="rgba(59,130,246,0.08)"
            />
            {/* density area + line */}
            <polygon points={geom.areaPts} fill="rgba(59,130,246,0.16)" />
            <polyline points={geom.linePts} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
            {/* baseline */}
            <line x1={PAD_X} y1={geom.baseY} x2={width - PAD_X} y2={geom.baseY} stroke="#23232a" strokeWidth={1} />
            {/* ±1σ markers */}
            <VLine x={geom.lo1X} color="#3b82f6" dash />
            <VLine x={geom.hi1X} color="#3b82f6" dash />
            {/* ATM marker */}
            {geom.inRangeAtm && <VLine x={geom.atmX} color="#f59e0b" dash />}
            {/* spot marker */}
            <VLine x={geom.spotX} color="#e4e4e7" />
          </svg>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[9px]">
            <LegendDot color="#e4e4e7" label={`Spot ${dec(spot, 0)}`} />
            <LegendDot color="#f59e0b" label={`ATM ${atmStrike}`} />
            <LegendDot color="#3b82f6" label={`±1σ ${dec(range.lower1, 0)} – ${dec(range.upper1, 0)}`} />
          </div>
        </>
      )}
    </div>
  );
}

function VLine({ x, color, dash }: { x: number; color: string; dash?: boolean }) {
  return (
    <line
      x1={x}
      y1={PAD_TOP - 2}
      x2={x}
      y2={CHART_H - PAD_BOTTOM}
      stroke={color}
      strokeWidth={1}
      strokeDasharray={dash ? "3 3" : undefined}
    />
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-zinc-500">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-mono">{label}</span>
    </span>
  );
}

function TargetStrikeCard({
  chain,
  spot,
  atmIv,
  t,
  r,
  target,
  onChange,
}: {
  chain: EnrichedChain;
  spot: number;
  atmIv: number;
  t: number;
  r: number;
  target: number;
  onChange: (strike: number) => void;
}) {
  const ceItm = probItm("CE", spot, target, atmIv, t, r);
  const peItm = probItm("PE", spot, target, atmIv, t, r);
  const touch = probTouch(spot, target, atmIv, t);

  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Target size={12} className="text-zinc-600" strokeWidth={1.5} />
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Target strike</span>
        <ProvenanceBadge kind="COMPUTED" />
        <Select
          value={String(target)}
          onChange={(v) => onChange(Number(v))}
          className="ml-auto"
        >
          {chain.rows.map((row) => (
            <option key={row.strike} value={row.strike}>
              {row.strike}
              {row.strike === chain.atmStrike ? " (ATM)" : ""}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ProbTile label="CE ITM" p={ceItm} tone="gain" sub={`P(spot > ${target})`} />
        <ProbTile label="CE OTM" p={1 - ceItm} tone="zinc" sub={`P(spot ≤ ${target})`} />
        <ProbTile label="Touch" p={touch} tone="warn" sub="any time before expiry" />
        <ProbTile label="PE ITM" p={peItm} tone="loss" sub={`P(spot < ${target})`} />
        <ProbTile label="PE OTM" p={1 - peItm} tone="zinc" sub={`P(spot ≥ ${target})`} />
        <ProbTile
          label="Distance"
          p={spot > 0 ? Math.abs(target - spot) / spot : 0}
          tone="zinc"
          sub={`${target >= spot ? "+" : "−"}${dec(Math.abs(target - spot), 0)} pts`}
        />
      </div>
    </div>
  );
}

function ProbTile({
  label,
  p,
  tone,
  sub,
}: {
  label: string;
  p: number;
  tone: "gain" | "loss" | "warn" | "zinc";
  sub: string;
}) {
  const text =
    tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : tone === "warn" ? "text-warn" : "text-zinc-200";
  return (
    <div className="rounded-panel border border-border bg-panel p-2.5">
      <div className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</div>
      <p className={`mt-1 font-mono text-base font-semibold ${text}`}>{pct(p * 100, 1)}</p>
      <p className="mt-0.5 text-[9px] text-zinc-700">{sub}</p>
    </div>
  );
}

function ProbCell({ p, dim, tone }: { p: number; dim?: boolean; tone?: "warn" }) {
  const cls = tone === "warn" ? "text-warn" : dim ? "text-zinc-600" : "text-zinc-300";
  return <td className={`px-1.5 py-1 text-right font-mono ${cls}`}>{pct(p * 100, 1)}</td>;
}

function Th({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <th className={`px-1.5 py-1.5 font-semibold ${center ? "text-center" : "text-right"}`}>{children}</th>;
}
