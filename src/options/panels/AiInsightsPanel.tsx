/**
 * AI Insights — continuously-updating, rule-based institutional observations over the live
 * chain. Each insight is a deterministic rule fired against live OI / ΔOI, IV (summary + skew),
 * PCR, volume, dealer gamma (GEX) and price action — ranked by a severity weight, with a
 * one-line rationale so the logic is fully transparent (no black box).
 *
 * Refreshes each tick via the shared data provider. Every number quoted is read from `chain`,
 * the libs, or the GEX model — nothing is fabricated. Insights with no source simply do not fire.
 */

import { useMemo } from "react";
import { Brain, Info } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Pill, Empty, Banner, type Tone } from "../components/ui";
import { computeSentiment } from "../lib/sentiment";
import { supportResistance, topOiChanges, buildupTally } from "../lib/oi";
import { ivSummary, ivSkew } from "../lib/volatility";
import { compact, dec, signed, volPct } from "../lib/format";
import { computeGammaExposure, type GammaExposure } from "../../lib/gamma";
import type { OptionLeg } from "../../lib/optionMetrics";
import type { EnrichedChain } from "../types";

type Severity = "HIGH" | "MEDIUM" | "LOW";

interface Insight {
  /** Higher = more important; drives sort order. */
  rank: number;
  severity: Severity;
  category: string;
  title: string;
  rationale: string;
}

const SEV_TONE: Record<Severity, Tone> = { HIGH: "rose", MEDIUM: "amber", LOW: "blue" };

export function AiInsightsPanel() {
  return (
    <Panel
      title="AI Insights"
      icon={Brain}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <InsightsBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function InsightsBody({ chain }: { chain: EnrichedChain }) {
  const insights = useMemo(() => buildInsights(chain), [chain]);

  return (
    <div className="space-y-2">
      <Banner tone="info">
        <span className="inline-flex items-start gap-1.5">
          <Info size={11} className="mt-0.5 shrink-0" />
          <span>
            Rule-based heuristics over the live feed, re-evaluated each tick. Every figure is read from the chain or the
            Black-Scholes / GEX models — observations are reasoning, not predictions.
          </span>
        </span>
      </Banner>

      {insights.length === 0 ? (
        <Empty
          icon={Brain}
          message="No rule cleared its threshold this snapshot. The chain reads quiet — shown honestly rather than inventing signal."
        />
      ) : (
        <div className="space-y-2">
          {insights.map((ins, i) => (
            <InsightCard key={`${ins.category}-${i}`} insight={ins} />
          ))}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className="rounded-panel border border-border bg-panel p-2.5">
      <div className="mb-1 flex items-center gap-2">
        <Pill tone={SEV_TONE[insight.severity]}>{insight.severity}</Pill>
        <span className="text-[9px] uppercase tracking-wider text-zinc-600">{insight.category}</span>
      </div>
      <p className="text-2xs font-semibold leading-snug text-zinc-100">{insight.title}</p>
      <p className="mt-1 text-2xs leading-relaxed text-zinc-500">{insight.rationale}</p>
    </div>
  );
}

/**
 * Deterministic rule engine. Each block inspects one live signal and, if it clears a
 * threshold, pushes an insight with a rank used for ordering. No fabricated data.
 */
function buildInsights(chain: EnrichedChain): Insight[] {
  const out: Insight[] = [];

  const sentiment = computeSentiment(chain);
  const sr = supportResistance(chain);
  const iv = ivSummary(chain);
  const skew = ivSkew(chain);
  const tally = buildupTally(chain);
  const leaders = topOiChanges(chain, 4);

  const gex = computeGammaExposure(
    chain.rows.flatMap((r): OptionLeg[] => [
      { type: "CE", strike: r.strike, oi: r.ce.oi, ltp: r.ce.ltp },
      { type: "PE", strike: r.strike, oi: r.pe.oi, ltp: r.pe.ltp },
    ]),
    chain.spot,
    chain.vix ? chain.vix.value / 100 : 0,
    chain.selectedExpiry?.t ?? 0,
    { lotSize: chain.instrument.lotSize },
  );

  // --- 1) Composite bias ---
  out.push({
    rank: 50 + Math.abs(sentiment.score),
    severity: Math.abs(sentiment.score) >= 30 ? "HIGH" : Math.abs(sentiment.score) >= 15 ? "MEDIUM" : "LOW",
    category: "Bias",
    title: `Composite bias ${sentiment.label} at ${signed(sentiment.score, 0)}/100`,
    rationale: `Weighted blend of ${sentiment.factors.length} live factors (PCR, OI build-up, ATM action, max-pain pull) at ${Math.round(sentiment.confidence * 100)}% confidence.`,
  });

  // --- 2) Dealer gamma ---
  if (gex) {
    addGammaInsight(out, gex, chain);
  }

  // --- 3) PCR extremes ---
  if (chain.pcr > 0) {
    if (chain.pcr >= 1.3) {
      out.push({
        rank: 70,
        severity: "MEDIUM",
        category: "PCR",
        title: `PCR ${dec(chain.pcr, 2)} — heavy put writing`,
        rationale: `${compact(chain.totalPeOi)} PE vs ${compact(chain.totalCeOi)} CE OI. Put writers are defending downside; supportive unless support strikes start unwinding.`,
      });
    } else if (chain.pcr <= 0.6) {
      out.push({
        rank: 70,
        severity: "MEDIUM",
        category: "PCR",
        title: `PCR ${dec(chain.pcr, 2)} — call-heavy, capped upside`,
        rationale: `${compact(chain.totalCeOi)} CE vs ${compact(chain.totalPeOi)} PE OI. Dense call writing builds overhead resistance; rallies likely sold into.`,
      });
    }
  }

  // --- 4) Support / resistance walls ---
  if (sr.resistance > 0 && sr.resistanceOi > 0) {
    const dist = chain.spot > 0 ? ((sr.resistance - chain.spot) / chain.spot) * 100 : NaN;
    out.push({
      rank: 60 + (Number.isFinite(dist) && Math.abs(dist) < 1 ? 20 : 0),
      severity: Number.isFinite(dist) && Math.abs(dist) < 0.5 ? "HIGH" : "MEDIUM",
      category: "OI Wall",
      title: `Heavy call writing at ${sr.resistance} caps upside`,
      rationale: `${compact(sr.resistanceOi)} CE OI marks resistance${Number.isFinite(dist) ? `, ${signed(dist, 1)}% from spot` : ""}. A sustained break above flips it to support.`,
    });
  }
  if (sr.support > 0 && sr.supportOi > 0) {
    const dist = chain.spot > 0 ? ((sr.support - chain.spot) / chain.spot) * 100 : NaN;
    out.push({
      rank: 60 + (Number.isFinite(dist) && Math.abs(dist) < 1 ? 20 : 0),
      severity: Number.isFinite(dist) && Math.abs(dist) < 0.5 ? "HIGH" : "MEDIUM",
      category: "OI Wall",
      title: `Put writers defending ${sr.support}`,
      rationale: `${compact(sr.supportOi)} PE OI marks support${Number.isFinite(dist) ? `, ${signed(dist, 1)}% from spot` : ""}. Breaking below it removes the floor and can accelerate selling.`,
    });
  }

  // --- 5) IV skew ---
  if (skew.skew !== 0 && skew.putWingIv > 0 && skew.callWingIv > 0) {
    const bearish = skew.skew > 0;
    out.push({
      rank: 55 + Math.min(20, Math.abs(skew.skew) * 4),
      severity: Math.abs(skew.skew) >= 3 ? "HIGH" : "MEDIUM",
      category: "Vol Skew",
      title: `IV skew ${signed(skew.skew, 1)} vol pts → ${bearish ? "downside hedging demand" : "upside chase / call bid"}`,
      rationale: `Wing IVs: put ${volPct(skew.putWingIv)} vs call ${volPct(skew.callWingIv)}. ${bearish ? "Puts richer than calls — desks paying up for protection." : "Calls richer than puts — unusual; upside speculation or covered-call unwinds."}`,
    });
  }

  // --- 6) IV level / regime ---
  if (iv.avg > 0 && chain.vix) {
    const hot = chain.vix.changePercent;
    out.push({
      rank: 45 + Math.min(15, Math.abs(hot)),
      severity: Math.abs(hot) >= 5 ? "HIGH" : "LOW",
      category: "Volatility",
      title: `India VIX ${dec(chain.vix.value, 2)} (${signed(hot, 1)}%), chain IV avg ${volPct(iv.avg)}`,
      rationale: `Per-strike IV spans ${volPct(iv.low)}–${volPct(iv.high)}. ${hot >= 0 ? "Vol firming — premium expanding, favour defined-risk longs over naked shorts." : "Vol easing — premium decay aids sellers; theta structures favoured."}`,
    });
  }

  // --- 7) OI build-up tilt ---
  {
    const callWrite = tally.ce.shortBuildup;
    const putWrite = tally.pe.shortBuildup;
    const total = callWrite + putWrite;
    if (total > 0) {
      const putDom = putWrite >= callWrite;
      const share = Math.round((Math.max(putWrite, callWrite) / total) * 100);
      out.push({
        rank: 48,
        severity: share >= 70 ? "MEDIUM" : "LOW",
        category: "Build-up",
        title: `${putDom ? "Put" : "Call"} writing dominates today's OI adds (${share}%)`,
        rationale: putDom
          ? `Fresh put shorts outweigh call shorts (Δ-OI weighted) — writers expect support to hold (bullish-to-neutral).`
          : `Fresh call shorts outweigh put shorts (Δ-OI weighted) — writers expect upside capped (bearish-to-neutral).`,
      });
    }
  }

  // --- 8) Where positioning is happening (top ΔOI) ---
  if (leaders.length > 0 && leaders[0].oiChange !== 0) {
    const L = leaders[0];
    out.push({
      rank: 40,
      severity: "LOW",
      category: "Flow",
      title: `Largest ΔOI: ${L.strike} ${L.type} (${signed(L.oiChange, 0)})`,
      rationale: `${prettyBuildup(L.buildup)} at LTP ${dec(L.ltp, 1)} — today's most active positioning strike. Watch it for the session's intent.`,
    });
  }

  // --- 9) Max pain pull ---
  if (chain.maxPain > 0 && chain.spot > 0) {
    const rel = chain.spot - chain.maxPain;
    const relPct = (rel / chain.spot) * 100;
    if (Math.abs(relPct) >= 0.25) {
      out.push({
        rank: 42,
        severity: Math.abs(relPct) >= 1 ? "MEDIUM" : "LOW",
        category: "Max Pain",
        title: `Spot ${rel > 0 ? "above" : "below"} max pain ${chain.maxPain} by ${dec(Math.abs(rel), 0)} pts`,
        rationale: `Into expiry, dealer hedging tends to pull price toward max pain — a ${rel > 0 ? "mild downward" : "mild upward"} bias all else equal (${signed(relPct, 1)}%).`,
      });
    }
  }

  // --- 10) Volume vs OI conviction ---
  {
    const volTotal = chain.totalCeVolume + chain.totalPeVolume;
    const oiTotal = chain.totalCeOi + chain.totalPeOi;
    if (volTotal > 0 && oiTotal > 0) {
      const turnover = volTotal / oiTotal;
      if (turnover >= 0.5) {
        out.push({
          rank: 38,
          severity: turnover >= 1 ? "MEDIUM" : "LOW",
          category: "Activity",
          title: `Elevated turnover — volume ${compact(volTotal)} vs OI ${compact(oiTotal)}`,
          rationale: `Volume/OI ≈ ${dec(turnover, 2)} signals active intraday churn rather than settled positioning; expect faster, headline-driven moves.`,
        });
      }
    }
  }

  return out.sort((a, b) => b.rank - a.rank);
}

function addGammaInsight(out: Insight[], gex: GammaExposure, chain: EnrichedChain): void {
  const positive = gex.totalGamma >= 0;
  out.push({
    rank: 80 + Math.min(15, Math.abs(gex.totalGamma)),
    severity: Math.abs(gex.totalGamma) >= 5 ? "HIGH" : "MEDIUM",
    category: "Dealer Gamma",
    title: `Dealer gamma ${positive ? "positive" : "negative"} (${signed(gex.totalGamma, 2)} Cr/1%) → ${positive ? "pinning" : "amplifying"} moves`,
    rationale: positive
      ? `Dealers buy dips and sell rips, compressing realized vol${gex.flipPoint > 0 ? `; regime flips negative below the ${gex.flipPoint} gamma-flip` : ""}. Range-bound, fade-the-extremes tape favoured.`
      : `Dealers sell weakness and chase strength, feeding momentum${gex.flipPoint > 0 ? `; regime turns positive above the ${gex.flipPoint} gamma-flip` : ""}. Breakout and gap risk elevated.`,
  });
}

function prettyBuildup(b: string): string {
  switch (b) {
    case "LONG_BUILDUP":
      return "Long build-up (price up, OI up)";
    case "SHORT_BUILDUP":
      return "Short build-up (price down, OI up)";
    case "LONG_UNWINDING":
      return "Long unwinding (price down, OI down)";
    case "SHORT_COVERING":
      return "Short covering (price up, OI down)";
    default:
      return "Neutral flow";
  }
}
