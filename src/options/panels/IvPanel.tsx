/**
 * Implied Volatility Dashboard — the live current-expiry IV surface.
 *
 * Live current IV (India VIX BROKER + ATM IV COMPUTED), the per-strike IV smile and skew
 * (COMPUTED from the chain's solved per-strike IVs), and IV Rank / IV Percentile from the
 * persisted India-VIX history store (marketApi.getIvHistory). Nothing is fabricated: when the
 * history store has too few samples we say so, and we are explicit that this is a single-expiry
 * smile, not a full multi-expiry term-structure surface (which we deliberately do not fetch to
 * respect broker rate limits).
 */

import { useEffect, useMemo, useState } from "react";
import { Activity, Gauge, TrendingDown, Waves } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Stat, Row, Banner, Spinner, Empty } from "../components/ui";
import { ivSmile, ivSkew, ivSummary, type SmilePoint } from "../lib/volatility";
import { volPct, dec, signed } from "../lib/format";
import { marketApi } from "../../services/api";
import type { EnrichedChain } from "../types";

interface IvHistory {
  current: number | null;
  rank: number | null;
  percentile: number | null;
  min: number | null;
  max: number | null;
  samples: number;
  sufficient: boolean;
  lookbackDays: number;
}

function num(v: unknown): number | null {
  const x = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
}

export function IvPanel() {
  return (
    <Panel
      title="Implied Volatility Dashboard"
      icon={Activity}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <IvBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function IvBody({ chain }: { chain: EnrichedChain }) {
  const [hist, setHist] = useState<IvHistory | null>(null);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistLoading(true);
    setHistError(null);
    (async () => {
      try {
        const res = await marketApi.getIvHistory();
        if (cancelled) return;
        setHist({
          current: num(res?.current),
          rank: num(res?.rank),
          percentile: num(res?.percentile),
          min: num(res?.min),
          max: num(res?.max),
          samples: num(res?.samples) ?? 0,
          sufficient: res?.sufficient === true,
          lookbackDays: num(res?.lookbackDays) ?? 0,
        });
      } catch (err) {
        if (cancelled) return;
        setHistError(err instanceof Error ? err.message : "Failed to load IV history");
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const smile = useMemo(() => ivSmile(chain), [chain]);
  const skew = useMemo(() => ivSkew(chain), [chain]);
  const summary = useMemo(() => ivSummary(chain), [chain]);

  const atmRow = chain.rows.find((r) => r.isAtm);
  const atmIv = atmRow ? atmRow.ce.iv || atmRow.pe.iv : 0;
  const vix = chain.vix;

  return (
    <div className="space-y-3">
      {/* Current IV / India VIX */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          label="India VIX"
          value={vix ? volPct(vix.value / 100) : "—"}
          sub={
            vix ? (
              <span className={vix.change >= 0 ? "text-gain" : "text-loss"}>
                {signed(vix.change, 2)} ({signed(vix.changePercent, 2)}%)
              </span>
            ) : (
              <ProvenanceBadge kind="UNAVAILABLE" />
            )
          }
          tone="blue"
          icon={Gauge}
        />
        <Stat
          label="ATM IV"
          value={atmIv > 0 ? volPct(atmIv) : "—"}
          sub={atmRow ? `Strike ${atmRow.strike}` : "no ATM"}
          tone="zinc"
        />
        <Stat label="Avg Chain IV" value={summary.avg > 0 ? volPct(summary.avg) : "—"} sub="solved per-strike" />
        <Stat
          label="IV Range"
          value={summary.high > 0 ? `${volPct(summary.low)} – ${volPct(summary.high)}` : "—"}
          sub="lowest / highest strike IV"
        />
      </div>

      <div className="flex items-center gap-1.5 px-0.5">
        <ProvenanceBadge kind="BROKER" label="India VIX" />
        <ProvenanceBadge kind="COMPUTED" label="ATM / Avg / Range IV" />
      </div>

      {/* IV Rank / Percentile from persisted history */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            IV Rank &amp; Percentile
          </span>
          <ProvenanceBadge kind="BROKER" label="India VIX history" />
        </div>
        {histLoading ? (
          <Spinner label="Loading India VIX history…" />
        ) : histError ? (
          <Banner tone="loss">India VIX history unavailable — {histError}</Banner>
        ) : !hist ? (
          <Empty message="No India VIX history returned." />
        ) : !hist.sufficient ? (
          <div className="space-y-2">
            <Banner tone="warn">
              Building history — only {hist.samples} India VIX sample{hist.samples === 1 ? "" : "s"} stored
              {hist.lookbackDays > 0 ? ` over a ${hist.lookbackDays}-day window` : ""}. IV Rank and IV
              Percentile need a fuller lookback before they are meaningful, so they are withheld rather than shown
              as misleading numbers.
            </Banner>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Row label="Current VIX" value={hist.current != null ? dec(hist.current, 2) : "—"} />
              <Row label="Min seen" value={hist.min != null ? dec(hist.min, 2) : "—"} />
              <Row label="Max seen" value={hist.max != null ? dec(hist.max, 2) : "—"} />
              <Row label="Samples" value={hist.samples} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat
              label="IV Rank"
              value={hist.rank != null ? `${dec(hist.rank, 0)}` : "—"}
              sub="0 = yr low · 100 = yr high"
              tone={hist.rank != null && hist.rank >= 50 ? "amber" : "green"}
            />
            <Stat
              label="IV Percentile"
              value={hist.percentile != null ? `${dec(hist.percentile, 0)}%` : "—"}
              sub="% of days IV was lower"
              tone={hist.percentile != null && hist.percentile >= 50 ? "amber" : "green"}
            />
            <Stat label="Current VIX" value={hist.current != null ? dec(hist.current, 2) : "—"} />
            <Stat
              label={`${hist.lookbackDays || ""}d Range`.trim()}
              value={hist.min != null && hist.max != null ? `${dec(hist.min, 1)} – ${dec(hist.max, 1)}` : "—"}
              sub={`${hist.samples} samples`}
            />
          </div>
        )}
      </div>

      {/* IV Smile */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <Waves size={12} className="text-zinc-600" />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            IV Smile — {chain.selectedExpiry?.label ?? "current expiry"}
          </span>
          <ProvenanceBadge kind="COMPUTED" />
        </div>
        {smile.length < 2 ? (
          <Empty message="Not enough strikes have a solvable IV to draw a smile yet." />
        ) : (
          <SmileChart smile={smile} spot={chain.spot} atmStrike={chain.atmStrike} />
        )}
        <p className="mt-2 text-[9px] leading-relaxed text-zinc-600">
          Single-expiry smile only. A full volatility term-structure surface across every expiry would
          require fetching each expiry's chain separately — not done here to respect broker rate limits.
        </p>
      </div>

      {/* IV Skew */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <TrendingDown size={12} className="text-zinc-600" />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Volatility Skew</span>
          <ProvenanceBadge kind="COMPUTED" />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="ATM IV" value={skew.atmIv > 0 ? volPct(skew.atmIv) : "—"} />
          <Stat label="Put Wing IV" value={skew.putWingIv > 0 ? volPct(skew.putWingIv) : "—"} sub="OTM put" tone="green" />
          <Stat label="Call Wing IV" value={skew.callWingIv > 0 ? volPct(skew.callWingIv) : "—"} sub="OTM call" tone="rose" />
          <Stat
            label="Skew (put − call)"
            value={skew.putWingIv > 0 && skew.callWingIv > 0 ? `${signed(skew.skew, 1)} vol pts` : "—"}
            sub={skew.skew > 0 ? "put skew (downside fear)" : skew.skew < 0 ? "call skew" : "flat"}
            tone={skew.skew > 0 ? "amber" : skew.skew < 0 ? "blue" : "zinc"}
          />
        </div>
      </div>
    </div>
  );
}

/** Self-contained inline SVG IV smile: x = strike, y = IV%, CE and PE solved IVs plotted. */
function SmileChart({ smile, spot, atmStrike }: { smile: SmilePoint[]; spot: number; atmStrike: number }) {
  const W = 600;
  const H = 200;
  const PADX = 36;
  const PADY = 18;

  const strikes = smile.map((p) => p.strike);
  const minK = Math.min(...strikes);
  const maxK = Math.max(...strikes);
  const ivs: number[] = [];
  for (const p of smile) {
    if (p.ceIv > 0) ivs.push(p.ceIv);
    if (p.peIv > 0) ivs.push(p.peIv);
  }
  const minIv = Math.min(...ivs);
  const maxIv = Math.max(...ivs);
  const ivPad = (maxIv - minIv) * 0.15 || 0.01;
  const loIv = Math.max(0, minIv - ivPad);
  const hiIv = maxIv + ivPad;

  const x = (k: number) => (maxK === minK ? PADX : PADX + ((k - minK) / (maxK - minK)) * (W - 2 * PADX));
  const y = (iv: number) => (hiIv === loIv ? H / 2 : H - PADY - ((iv - loIv) / (hiIv - loIv)) * (H - 2 * PADY));

  const line = (sel: (p: SmilePoint) => number) =>
    smile
      .filter((p) => sel(p) > 0)
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.strike).toFixed(1)},${y(sel(p)).toFixed(1)}`)
      .join(" ");

  const cePath = line((p) => p.ceIv);
  const pePath = line((p) => p.peIv);
  const spotX = spot >= minK && spot <= maxK ? x(spot) : null;
  const atmX = atmStrike >= minK && atmStrike <= maxK ? x(atmStrike) : null;

  const yTicks = [loIv, (loIv + hiIv) / 2, hiIv];

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="IV smile">
        {/* grid + y axis */}
        {yTicks.map((tv, i) => (
          <g key={i}>
            <line x1={PADX} x2={W - PADX} y1={y(tv)} y2={y(tv)} stroke="#1a1a20" strokeWidth={1} />
            <text x={2} y={y(tv) + 3} fill="#52525b" fontSize={9} fontFamily="monospace">
              {(tv * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        {/* spot / atm markers */}
        {spotX != null && (
          <g>
            <line x1={spotX} x2={spotX} y1={PADY} y2={H - PADY} stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 3" />
            <text x={spotX + 3} y={PADY + 8} fill="#3b82f6" fontSize={9} fontFamily="monospace">
              spot
            </text>
          </g>
        )}
        {atmX != null && Math.abs((atmX ?? 0) - (spotX ?? -999)) > 8 && (
          <line x1={atmX} x2={atmX} y1={PADY} y2={H - PADY} stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 4" />
        )}
        {/* CE / PE smiles */}
        {pePath && <path d={pePath} fill="none" stroke="#10b981" strokeWidth={1.5} />}
        {cePath && <path d={cePath} fill="none" stroke="#ef4444" strokeWidth={1.5} />}
        {smile.map((p) => (
          <g key={p.strike}>
            {p.peIv > 0 && <circle cx={x(p.strike)} cy={y(p.peIv)} r={1.6} fill="#10b981" />}
            {p.ceIv > 0 && <circle cx={x(p.strike)} cy={y(p.ceIv)} r={1.6} fill="#ef4444" />}
          </g>
        ))}
        {/* x axis labels */}
        <text x={PADX} y={H - 4} fill="#52525b" fontSize={9} fontFamily="monospace">
          {minK}
        </text>
        <text x={W - PADX} y={H - 4} fill="#52525b" fontSize={9} fontFamily="monospace" textAnchor="end">
          {maxK}
        </text>
      </svg>
      <div className="flex items-center gap-4 text-[9px] text-zinc-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded-sm bg-gain" /> PE IV
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 rounded-sm bg-loss" /> CE IV
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-0.5 bg-info" /> spot
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-0.5 bg-warn" /> ATM
        </span>
      </div>
    </div>
  );
}
