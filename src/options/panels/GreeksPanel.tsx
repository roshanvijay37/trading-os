/**
 * Greeks Dashboard — full first- and second-order Greeks for the live chain.
 *
 * Two parts:
 *   (a) ATM Greeks: CE and PE first- AND second-order Greeks as labelled tiles/rows
 *       (delta, gamma, theta, vega, rho, vanna, vomma, charm, speed, color, lambda,
 *        elasticity = lambda).
 *   (b) Per-strike Greeks table around ATM: strike | CE Δ/Γ/Θ/V | PE Δ/Γ/Θ/V.
 *
 * FYERS serves NO Greeks and NO per-strike IV — every value here is Black-Scholes-derived
 * from the per-strike IV solved in lib/bs.ts. Hence the COMPUTED provenance badge. Nothing
 * is fabricated: all numbers come straight from `chain.rows[].ce/.pe.greeks`.
 */

import { useMemo, useState } from "react";
import { Sigma, Activity } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Segmented, Banner } from "../components/ui";
import { dec, volPct } from "../lib/format";
import type { EnrichedChain, Greeks, OptionQuote, StrikeRow } from "../types";

export function GreeksPanel() {
  return (
    <Panel
      title="Greeks Dashboard"
      icon={Sigma}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <GreeksBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

/** The Greeks we surface, in display order, with the precision they read best at. */
const GREEK_DEFS: { key: keyof Greeks; label: string; hint: string; dp: number }[] = [
  { key: "delta", label: "Delta Δ", hint: "∂price/∂spot", dp: 4 },
  { key: "gamma", label: "Gamma Γ", hint: "∂delta/∂spot", dp: 6 },
  { key: "theta", label: "Theta Θ", hint: "₹/day decay", dp: 3 },
  { key: "vega", label: "Vega ν", hint: "per 1% IV", dp: 3 },
  { key: "rho", label: "Rho ρ", hint: "per 1% rate", dp: 4 },
  { key: "vanna", label: "Vanna", hint: "∂delta/∂vol", dp: 5 },
  { key: "vomma", label: "Vomma", hint: "∂vega/∂vol", dp: 5 },
  { key: "charm", label: "Charm", hint: "∂delta/∂time (day)", dp: 6 },
  { key: "speed", label: "Speed", hint: "∂gamma/∂spot", dp: 8 },
  { key: "color", label: "Color", hint: "∂gamma/∂time (day)", dp: 8 },
  { key: "lambda", label: "Lambda λ", hint: "elasticity / leverage", dp: 3 },
];

function GreeksBody({ chain }: { chain: EnrichedChain }) {
  const [side, setSide] = useState<"CE" | "PE">("CE");

  const atmRow = useMemo<StrikeRow | undefined>(() => {
    const flagged = chain.rows.find((r) => r.isAtm);
    if (flagged) return flagged;
    // Fallback: nearest strike to atmStrike (then to spot) if nothing is flagged.
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

  if (!atmRow) {
    return <Banner tone="warn">No ATM strike could be located in the current chain.</Banner>;
  }

  const ce = atmRow.ce;
  const pe = atmRow.pe;
  const activeQuote = side === "CE" ? ce : pe;
  const hasGreeks = activeQuote.iv > 0;

  return (
    <div className="space-y-4">
      {/* ---- ATM header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">ATM Greeks</div>
          <div className="mt-0.5 flex items-center gap-2 text-2xs text-zinc-600">
            <span className="font-mono text-zinc-300">Strike {atmRow.strike}</span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono">Spot {dec(chain.spot, 1)}</span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono">
              CE IV {ce.iv > 0 ? volPct(ce.iv) : "—"} / PE IV {pe.iv > 0 ? volPct(pe.iv) : "—"}
            </span>
          </div>
        </div>
        <Segmented
          value={side}
          onChange={setSide}
          options={[
            { value: "CE", label: "Call (CE)" },
            { value: "PE", label: "Put (PE)" },
          ]}
        />
      </div>

      {!hasGreeks && (
        <Banner tone="warn">
          The {side} leg at strike {atmRow.strike} carries no solvable IV (quote ≤ intrinsic or stale), so its
          Black-Scholes Greeks are undefined. Switch side or expiry for a live leg.
        </Banner>
      )}

      {/* ---- ATM Greek tiles (all 12 requested metrics) ---- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {GREEK_DEFS.map((g) => (
          <GreekTile
            key={g.key}
            label={g.label}
            hint={g.hint}
            value={activeQuote.greeks[g.key]}
            dp={g.dp}
            available={hasGreeks}
          />
        ))}
        {/* Elasticity == lambda, surfaced explicitly per the spec. */}
        <GreekTile
          label="Elasticity"
          hint="= lambda (λ)"
          value={activeQuote.greeks.lambda}
          dp={3}
          available={hasGreeks}
        />
      </div>

      {/* ---- Side-by-side CE vs PE numeric comparison ---- */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Activity size={12} className="text-zinc-600" strokeWidth={1.5} />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            ATM CE vs PE — full Greek set
          </span>
        </div>
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-3 border-b border-border-subtle pb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
          <span>Greek</span>
          <span className="text-right">CE</span>
          <span className="text-right">PE</span>
        </div>
        <div className="divide-y divide-border-subtle/60">
          {GREEK_DEFS.map((g) => (
            <CompareRow key={g.key} def={g} ce={ce} pe={pe} />
          ))}
          <div className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-x-3 py-0.5">
            <span className="text-2xs text-zinc-600">
              Elasticity <span className="text-zinc-700">= λ</span>
            </span>
            <span className="text-right font-mono text-2xs text-zinc-200">
              {ce.iv > 0 ? dec(ce.greeks.lambda, 3) : "—"}
            </span>
            <span className="text-right font-mono text-2xs text-zinc-200">
              {pe.iv > 0 ? dec(pe.greeks.lambda, 3) : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ---- Per-strike Greeks table ---- */}
      <PerStrikeTable chain={chain} atmStrike={atmRow.strike} />

      <p className="text-2xs leading-relaxed text-zinc-600">
        Greeks are Black-Scholes-derived from the per-strike implied volatility solved from each live mid price
        (FYERS serves neither Greeks nor IV). Theta, charm and color are per calendar day; vega and rho per one
        percentage-point. A "—" means that leg had no solvable IV.
      </p>
    </div>
  );
}

function GreekTile({
  label,
  hint,
  value,
  dp,
  available,
}: {
  label: string;
  hint: string;
  value: number;
  dp: number;
  available: boolean;
}) {
  const show = available && Number.isFinite(value);
  const tone = !show ? "text-zinc-600" : value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-zinc-200";
  return (
    <div className="rounded-panel border border-border bg-panel p-2.5">
      <div className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</div>
      <p className={`mt-1 font-mono text-base font-semibold ${tone}`}>{show ? dec(value, dp) : "—"}</p>
      <p className="mt-0.5 text-[9px] text-zinc-700">{hint}</p>
    </div>
  );
}

function CompareRow({
  def,
  ce,
  pe,
}: {
  def: { key: keyof Greeks; label: string; dp: number };
  ce: OptionQuote;
  pe: OptionQuote;
}) {
  const ceVal = ce.iv > 0 ? dec(ce.greeks[def.key], def.dp) : "—";
  const peVal = pe.iv > 0 ? dec(pe.greeks[def.key], def.dp) : "—";
  return (
    <div className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-x-3 py-0.5">
      <span className="text-2xs text-zinc-600">{def.label}</span>
      <span className="text-right font-mono text-2xs text-zinc-200">{ceVal}</span>
      <span className="text-right font-mono text-2xs text-zinc-200">{peVal}</span>
    </div>
  );
}

function PerStrikeTable({ chain, atmStrike }: { chain: EnrichedChain; atmStrike: number }) {
  return (
    <div className="rounded-panel border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Per-strike Greeks</span>
        <ProvenanceBadge kind="COMPUTED" />
        <span className="ml-auto text-[9px] text-zinc-700">Black-Scholes from solved per-strike IV</span>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full border-collapse text-2xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
              <Th>CE Δ</Th>
              <Th>CE Γ</Th>
              <Th>CE Θ</Th>
              <Th>CE ν</Th>
              <Th center>Strike</Th>
              <Th>PE Δ</Th>
              <Th>PE Γ</Th>
              <Th>PE Θ</Th>
              <Th>PE ν</Th>
            </tr>
          </thead>
          <tbody>
            {chain.rows.map((row) => {
              const isAtm = row.strike === atmStrike;
              return (
                <tr
                  key={row.strike}
                  className={`border-b border-border-subtle/60 ${isAtm ? "bg-info-dim" : "hover:bg-surface/60"}`}
                >
                  <GreekCell q={row.ce} k="delta" dp={3} signTone />
                  <GreekCell q={row.ce} k="gamma" dp={5} />
                  <GreekCell q={row.ce} k="theta" dp={2} signTone />
                  <GreekCell q={row.ce} k="vega" dp={3} />
                  <td className="px-1.5 py-1 text-center">
                    <span className={`font-mono font-semibold ${isAtm ? "text-info" : "text-zinc-300"}`}>
                      {row.strike}
                    </span>
                  </td>
                  <GreekCell q={row.pe} k="delta" dp={3} signTone />
                  <GreekCell q={row.pe} k="gamma" dp={5} />
                  <GreekCell q={row.pe} k="theta" dp={2} signTone />
                  <GreekCell q={row.pe} k="vega" dp={3} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GreekCell({
  q,
  k,
  dp,
  signTone,
}: {
  q: OptionQuote;
  k: keyof Greeks;
  dp: number;
  signTone?: boolean;
}) {
  const has = q.iv > 0;
  const v = q.greeks[k];
  const tone = !has
    ? "text-zinc-700"
    : signTone
      ? v > 0
        ? "text-gain"
        : v < 0
          ? "text-loss"
          : "text-zinc-400"
      : "text-zinc-400";
  return <td className={`px-1.5 py-1 text-right font-mono ${tone}`}>{has ? dec(v, dp) : "—"}</td>;
}

function Th({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <th className={`px-1.5 py-1.5 font-semibold ${center ? "text-center" : "text-right"}`}>{children}</th>;
}
