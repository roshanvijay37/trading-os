/**
 * Expiry Dashboard — every listed expiry, and the time-decay profile of the selected one.
 *
 * Lists the weekly/monthly expiries (chain.expiries) with days remaining and lets the user click
 * one to re-query the chain via data.setSelectedExpiryMs(ms). For the selected expiry it shows
 * Theta decay (ATM CE+PE per-day theta from the computed Greeks, plus total chain theta exposure),
 * the IV-based expected move, ATM gamma as the gamma-risk proxy, and an IV-Crush probability — a
 * transparent, clearly-labelled heuristic from days-remaining and IV rank, with the formula shown.
 * All COMPUTED; nothing fabricated.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Hourglass, Zap } from "lucide-react";
import { useOptionsData } from "../state/OptionsDataProvider";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Stat, Row, Pill, Banner } from "../components/ui";
import { expectedMoves } from "../lib/volatility";
import { marketApi } from "../../services/api";
import { dec, signed } from "../lib/format";
import type { EnrichedChain, ExpiryInfo } from "../types";

export function ExpiryPanel() {
  return (
    <Panel
      title="Expiry Dashboard"
      icon={CalendarClock}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <ExpiryBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function num(v: unknown): number | null {
  const x = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
}

function ExpiryBody({ chain }: { chain: EnrichedChain }) {
  const { setSelectedExpiryMs, selectedExpiryMs } = useOptionsData();

  // IV Rank for the crush heuristic — same persisted India VIX store the IV panel uses.
  const [ivRank, setIvRank] = useState<number | null>(null);
  const [ivRankSufficient, setIvRankSufficient] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await marketApi.getIvHistory();
        if (cancelled) return;
        setIvRank(num(res?.rank));
        setIvRankSufficient(res?.sufficient === true);
      } catch {
        if (!cancelled) {
          setIvRank(null);
          setIvRankSufficient(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = chain.selectedExpiry;
  const activeMs = selectedExpiryMs ?? selected?.ms ?? null;

  const atmRow = chain.rows.find((r) => r.isAtm);
  const atmCeTheta = atmRow ? atmRow.ce.greeks.theta : 0;
  const atmPeTheta = atmRow ? atmRow.pe.greeks.theta : 0;
  const atmTheta = atmCeTheta + atmPeTheta; // ₹/day per unit, both ATM legs
  const atmGamma = atmRow ? Math.max(atmRow.ce.greeks.gamma, atmRow.pe.greeks.gamma) : 0;

  // Total chain theta exposure (per-day premium decay summed across every priced leg, per unit).
  const totalTheta = useMemo(() => {
    let s = 0;
    for (const r of chain.rows) {
      if (r.ce.iv > 0) s += r.ce.greeks.theta;
      if (r.pe.iv > 0) s += r.pe.greeks.theta;
    }
    return s;
  }, [chain.rows]);

  const ivDecimal = chain.vix ? chain.vix.value / 100 : atmRow ? atmRow.ce.iv || atmRow.pe.iv : 0;
  const days = selected?.daysRemaining ?? 0;
  const moves = useMemo(() => expectedMoves(chain.spot, ivDecimal, days), [chain.spot, ivDecimal, days]);

  const crush = ivCrushProbability(days, ivRank, ivRankSufficient);

  return (
    <div className="space-y-3">
      {/* Expiry list */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Expiries</span>
          <ProvenanceBadge kind="BROKER" />
          <span className="ml-auto text-[9px] text-zinc-600">click to load that expiry's chain</span>
        </div>
        {chain.expiries.length === 0 ? (
          <Banner tone="warn">The broker returned no expiry list for {chain.instrument.label}.</Banner>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {chain.expiries.map((e) => (
              <ExpiryCard
                key={e.ms}
                expiry={e}
                active={activeMs === e.ms}
                onSelect={() => setSelectedExpiryMs(e.ms)}
              />
            ))}
          </div>
        )}
      </div>

      {!selected ? (
        <Banner tone="warn">No expiry selected.</Banner>
      ) : (
        <>
          {/* Selected expiry headline */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat
              label="Selected Expiry"
              value={selected.label}
              sub={
                <span className="inline-flex items-center gap-1">
                  <Pill tone={selected.type === "MONTHLY" ? "blue" : "zinc"}>{selected.type}</Pill>
                  {selected.daysRemaining}d left
                </span>
              }
              tone="blue"
            />
            <Stat
              label="ATM Theta Decay"
              value={atmTheta !== 0 ? `${dec(atmTheta, 1)}/day` : "—"}
              sub="ATM CE + PE θ (₹/unit/day)"
              tone="rose"
              icon={Hourglass}
            />
            <Stat
              label="Expiry Expected Move"
              value={moves.expiry > 0 ? `±${dec(moves.expiry, 0)}` : "—"}
              sub={moves.expiry > 0 ? `±${dec(moves.expiryPct, 2)}% of spot` : "no IV source"}
            />
            <Stat
              label="ATM Gamma Risk"
              value={atmGamma > 0 ? dec(atmGamma, 4) : "—"}
              sub="rises sharply into expiry"
              tone="amber"
              icon={Zap}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 px-0.5">
            <ProvenanceBadge kind="COMPUTED" label="Theta / Gamma / Move / Crush" />
            <ProvenanceBadge kind="BROKER" label="India VIX" />
          </div>

          {/* Theta detail */}
          <div className="rounded-panel border border-border bg-panel p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Time Decay (Theta)</span>
              <ProvenanceBadge kind="COMPUTED" />
            </div>
            {atmRow ? (
              <div className="space-y-0.5">
                <Row label={`ATM CE θ (${atmRow.strike})`} value={`${dec(atmCeTheta, 2)} /day`} valueClass="text-loss font-mono" />
                <Row label={`ATM PE θ (${atmRow.strike})`} value={`${dec(atmPeTheta, 2)} /day`} valueClass="text-loss font-mono" />
                <Row label="ATM straddle θ" value={`${dec(atmTheta, 2)} /day`} valueClass="text-loss font-mono" />
                <Row label="Total chain θ exposure" value={`${signed(totalTheta, 1)} /day`} valueClass="text-loss font-mono" />
                <p className="mt-1.5 text-[9px] leading-relaxed text-zinc-600">
                  Theta is per-unit premium decay per calendar day from the Black-Scholes Greeks. Total chain
                  theta sums every priced leg (a net-short book collects this; a net-long book pays it).
                </p>
              </div>
            ) : (
              <Banner tone="warn">No ATM strike resolved for this expiry.</Banner>
            )}
          </div>

          {/* IV Crush heuristic */}
          <div className="rounded-panel border border-border bg-panel p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                IV Crush Probability
              </span>
              <ProvenanceBadge kind="COMPUTED" label="Heuristic" />
            </div>
            {crush == null ? (
              <Banner tone="info">
                IV-crush estimate needs a usable IV Rank from the persisted India VIX history, which is still
                building — withheld rather than guessed. The driver is intuitive: crush risk rises as expiry
                nears and when IV is already elevated.
              </Banner>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-end justify-between">
                  <span
                    className={`font-mono text-2xl font-semibold ${
                      crush.prob >= 0.6 ? "text-loss" : crush.prob >= 0.35 ? "text-warn" : "text-gain"
                    }`}
                  >
                    {dec(crush.prob * 100, 0)}%
                  </span>
                  <Pill tone={crush.prob >= 0.6 ? "rose" : crush.prob >= 0.35 ? "amber" : "green"}>
                    {crush.prob >= 0.6 ? "ELEVATED" : crush.prob >= 0.35 ? "MODERATE" : "LOW"}
                  </Pill>
                </div>
                <Row label="Days-remaining factor" value={dec(crush.timeFactor, 2)} />
                <Row label="IV-rank factor" value={dec(crush.ivFactor, 2)} />
                <p
                  className="mt-1 cursor-help text-[9px] leading-relaxed text-zinc-600"
                  title={crush.formula}
                >
                  Heuristic estimate, not a market-implied probability. Formula (hover):{" "}
                  <span className="font-mono text-zinc-500">{crush.formula}</span>
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ExpiryCard({ expiry, active, onSelect }: { expiry: ExpiryInfo; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`rounded-panel border px-2.5 py-2 text-left transition ${
        active
          ? "border-info bg-info-dim"
          : "border-border bg-surface hover:border-border-hover hover:bg-panel-hover"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`font-mono text-2xs font-semibold ${active ? "text-info" : "text-zinc-200"}`}>
          {expiry.label}
        </span>
        <Pill tone={expiry.type === "MONTHLY" ? "blue" : "zinc"}>{expiry.type === "MONTHLY" ? "M" : "W"}</Pill>
      </div>
      <p className="mt-0.5 text-[9px] text-zinc-600">{expiry.daysRemaining}d remaining</p>
    </button>
  );
}

interface CrushEstimate {
  prob: number;
  timeFactor: number;
  ivFactor: number;
  formula: string;
}

/**
 * Transparent IV-crush heuristic (NOT a market-implied probability).
 *   timeFactor = clamp(1 − daysRemaining/30, 0, 1)   → nearer expiry ⇒ higher
 *   ivFactor   = clamp(ivRank/100, 0, 1)              → richer IV ⇒ more to crush
 *   prob       = clamp(0.65·timeFactor + 0.35·ivFactor, 0, 1)
 */
function ivCrushProbability(daysRemaining: number, ivRank: number | null, sufficient: boolean): CrushEstimate | null {
  if (ivRank == null || !sufficient) return null;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const timeFactor = clamp(1 - daysRemaining / 30);
  const ivFactor = clamp(ivRank / 100);
  const prob = clamp(0.65 * timeFactor + 0.35 * ivFactor);
  return {
    prob,
    timeFactor,
    ivFactor,
    formula: "clamp(0.65·(1 − days/30) + 0.35·(ivRank/100), 0, 1)",
  };
}
