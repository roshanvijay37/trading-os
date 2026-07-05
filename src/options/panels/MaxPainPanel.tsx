/**
 * Max Pain Dashboard — the strike where option writers pay the least at expiry.
 *
 * chain.maxPain is the live, in-session max pain. We also recompute the full total-pain-by-strike
 * curve here so it can be plotted (pain(K) = Σ CE max(0,K−strike)·OI + Σ PE max(0,strike−K)·OI over
 * the chain rows) with the minimum (max pain) and spot marked. The "expected expiry zone" is max
 * pain ± the ATM expected move. Historical max-pain / trend has NO persisted store in this build,
 * so it is shown honestly as unavailable rather than fabricated — the in-session value updates live.
 */

import { useMemo } from "react";
import { Crosshair, Target } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Stat, Row, Banner } from "../components/ui";
import { expectedMoves } from "../lib/volatility";
import { dec, int, signed, compact } from "../lib/format";
import type { EnrichedChain } from "../types";
import { useTheme } from "../../store/theme";
import { getChartPalette } from "../../lib/chartTheme";

interface PainPoint {
  strike: number;
  pain: number;
  ceLoss: number;
  peLoss: number;
}

/** Total option-writer pain at each candidate expiry strike, computed from live OI. */
function painCurve(chain: EnrichedChain): PainPoint[] {
  const out: PainPoint[] = [];
  for (const k of chain.rows) {
    let ceLoss = 0;
    let peLoss = 0;
    for (const r of chain.rows) {
      if (r.ce.oi > 0) ceLoss += Math.max(0, k.strike - r.strike) * r.ce.oi;
      if (r.pe.oi > 0) peLoss += Math.max(0, r.strike - k.strike) * r.pe.oi;
    }
    out.push({ strike: k.strike, pain: ceLoss + peLoss, ceLoss, peLoss });
  }
  return out;
}

export function MaxPainPanel() {
  return (
    <Panel
      title="Max Pain Dashboard"
      icon={Target}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <MaxPainBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function MaxPainBody({ chain }: { chain: EnrichedChain }) {
  const curve = useMemo(() => painCurve(chain), [chain]);
  const minPain = curve.reduce(
    (best, p) => (p.pain < best.pain ? p : best),
    curve[0] ?? { strike: 0, pain: Infinity, ceLoss: 0, peLoss: 0 },
  );
  // Prefer the engine's max pain; fall back to our locally computed minimum.
  const maxPain = chain.maxPain > 0 ? chain.maxPain : minPain.strike;

  // Expected expiry zone = max pain ± ATM expected move. Prefer the live ATM straddle
  // (model-free) and fall back to the IV-based expiry move.
  const atmRow = chain.rows.find((r) => r.isAtm);
  const straddle = atmRow ? atmRow.ce.ltp + atmRow.pe.ltp : 0;
  const ivDecimal = chain.vix ? chain.vix.value / 100 : atmRow ? atmRow.ce.iv || atmRow.pe.iv : 0;
  const days = chain.selectedExpiry?.daysRemaining ?? 0;
  const ivMove = expectedMoves(chain.spot, ivDecimal, days).expiry;
  const zoneMove = straddle > 0 ? straddle : ivMove;
  const zoneSource = straddle > 0 ? "ATM straddle" : "IV expiry move";

  const distance = chain.spot > 0 && maxPain > 0 ? maxPain - chain.spot : 0;

  return (
    <div className="space-y-3">
      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Max Pain" value={maxPain > 0 ? int(maxPain) : "—"} sub="min total writer pain" tone="amber" icon={Crosshair} />
        <Stat label="Spot" value={chain.spot > 0 ? dec(chain.spot, 1) : "—"} sub={chain.instrument.label} tone="blue" />
        <Stat
          label="Spot → Max Pain"
          value={maxPain > 0 ? `${signed(distance, 0)} pts` : "—"}
          sub={distance > 0 ? "max pain above spot" : distance < 0 ? "max pain below spot" : "at max pain"}
          tone={distance > 0 ? "green" : distance < 0 ? "rose" : "zinc"}
        />
        <Stat label="PCR" value={chain.pcr > 0 ? dec(chain.pcr, 2) : "—"} sub="put/call OI ratio" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-0.5">
        <ProvenanceBadge kind="COMPUTED" label="Pain curve" />
        <ProvenanceBadge kind="BROKER" label="OI / LTP" />
      </div>

      {/* Pain curve chart */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            Total Pain by Strike — {chain.selectedExpiry?.label ?? "current expiry"}
          </span>
          <ProvenanceBadge kind="COMPUTED" />
        </div>
        {curve.length < 2 ? (
          <Banner tone="warn">Not enough strikes with open interest to draw the pain curve.</Banner>
        ) : (
          <PainChart curve={curve} maxPain={maxPain} spot={chain.spot} />
        )}
      </div>

      {/* Expected expiry zone */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Expected Expiry Zone</span>
          <ProvenanceBadge kind="COMPUTED" />
        </div>
        {maxPain > 0 && zoneMove > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-center gap-2 font-mono">
              <span className="text-base text-gain">{int(maxPain - zoneMove)}</span>
              <span className="text-zinc-600">—</span>
              <span className="text-lg font-semibold text-warn">{int(maxPain)}</span>
              <span className="text-zinc-600">—</span>
              <span className="text-base text-loss">{int(maxPain + zoneMove)}</span>
            </div>
            <p className="text-center text-2xs text-zinc-600">
              Max pain ± {dec(zoneMove, 0)} pts ({zoneSource})
            </p>
            <Row label="Lower bound" value={int(maxPain - zoneMove)} />
            <Row label="Max pain (pin)" value={int(maxPain)} />
            <Row label="Upper bound" value={int(maxPain + zoneMove)} />
            <Row label="Zone width (± move)" value={`${dec(zoneMove, 0)} pts`} />
          </div>
        ) : (
          <Banner tone="warn">
            Need a max-pain strike and an ATM straddle (or IV expiry move) to define the expected expiry zone.
          </Banner>
        )}
      </div>

      {/* Historical max pain — honestly unavailable */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            Historical Max Pain / Trend
          </span>
          <ProvenanceBadge kind="UNAVAILABLE" />
        </div>
        <Banner tone="info">
          A max-pain trend requires a persisted snapshot store of past sessions' OI, which this build does not
          keep — so no historical series is fabricated. The Max Pain value above is recomputed live from the
          current chain on every refresh and moves intraday as OI shifts.
        </Banner>
      </div>
    </div>
  );
}

/** Inline SVG pain curve: x = strike, y = total writer pain. Min (max pain) and spot marked. */
function PainChart({ curve, maxPain, spot }: { curve: PainPoint[]; maxPain: number; spot: number }) {
  const W = 600;
  const H = 200;
  const PADX = 8;
  const PADY = 16;
  const BASE = H - PADY;
  const palette = getChartPalette(useTheme());

  const strikes = curve.map((p) => p.strike);
  const minK = Math.min(...strikes);
  const maxK = Math.max(...strikes);
  const maxVal = Math.max(...curve.map((p) => p.pain), 1);

  const x = (k: number) => (maxK === minK ? W / 2 : PADX + ((k - minK) / (maxK - minK)) * (W - 2 * PADX));
  const barW = Math.max(1, (W - 2 * PADX) / curve.length - 1.5);

  const linePath = curve
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.strike).toFixed(1)},${(BASE - (p.pain / maxVal) * (H - 2 * PADY)).toFixed(1)}`)
    .join(" ");

  const spotX = spot >= minK && spot <= maxK ? x(spot) : null;
  const painX = maxPain >= minK && maxPain <= maxK ? x(maxPain) : null;

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Total pain by strike">
        {/* bars */}
        {curve.map((p) => {
          const h = (p.pain / maxVal) * (H - 2 * PADY);
          const isPain = p.strike === maxPain;
          return (
            <rect
              key={p.strike}
              x={x(p.strike) - barW / 2}
              y={BASE - h}
              width={barW}
              height={Math.max(0, h)}
              fill={isPain ? "#f59e0b" : palette.border}
              opacity={isPain ? 0.9 : 0.7}
            />
          );
        })}
        {/* curve line */}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={1.2} opacity={0.8} />
        {/* spot marker */}
        {spotX != null && (
          <g>
            <line x1={spotX} x2={spotX} y1={PADY} y2={BASE} stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 3" />
            <text x={spotX + 3} y={PADY + 8} fill="#3b82f6" fontSize={9} fontFamily="monospace">
              spot
            </text>
          </g>
        )}
        {/* max pain marker */}
        {painX != null && (
          <g>
            <line x1={painX} x2={painX} y1={PADY} y2={BASE} stroke="#f59e0b" strokeWidth={1.2} />
            <text x={painX + 3} y={PADY + 18} fill="#f59e0b" fontSize={9} fontFamily="monospace">
              max pain {maxPain}
            </text>
          </g>
        )}
        {/* axis */}
        <line x1={PADX} x2={W - PADX} y1={BASE} y2={BASE} stroke={palette.grid} strokeWidth={1} />
        <text x={PADX} y={H - 3} fill={palette.baseline} fontSize={9} fontFamily="monospace">
          {minK}
        </text>
        <text x={W - PADX} y={H - 3} fill={palette.baseline} fontSize={9} fontFamily="monospace" textAnchor="end">
          {maxK}
        </text>
      </svg>
      <div className="flex items-center gap-4 text-[9px] text-zinc-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-warn" /> max pain strike
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded-sm bg-info" /> total pain
        </span>
        <span className="ml-auto text-zinc-700">peak pain {compact(maxVal)} (pts·OI)</span>
      </div>
    </div>
  );
}
