/**
 * Composite market sentiment from live option-chain signals: PCR, OI build-up,
 * change-in-OI positioning, ATM price action and IV. Returns a directional verdict
 * with transparent, individually-scored reasoning (no black box).
 */

import type { EnrichedChain } from "../types";
import { buildupTally, supportResistance } from "./oi";

export type SentimentLabel = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface SentimentFactor {
  label: string;
  /** -1 (bearish) .. +1 (bullish). */
  score: number;
  detail: string;
}

export interface SentimentResult {
  label: SentimentLabel;
  /** Aggregate score -100 .. +100. */
  score: number;
  confidence: number; // 0..1
  factors: SentimentFactor[];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function computeSentiment(chain: EnrichedChain): SentimentResult {
  const factors: SentimentFactor[] = [];

  // 1) PCR — high PCR (put-heavy) is contrarian-bullish; very low is bearish.
  const pcr = chain.pcr;
  let pcrScore = 0;
  if (pcr > 0) {
    if (pcr >= 1.3) pcrScore = 0.6;
    else if (pcr >= 1.0) pcrScore = 0.3;
    else if (pcr <= 0.6) pcrScore = -0.6;
    else if (pcr <= 0.8) pcrScore = -0.3;
    factors.push({
      label: "Put/Call Ratio",
      score: pcrScore,
      detail: `PCR ${pcr.toFixed(2)} — ${pcr >= 1 ? "put-heavy (support building)" : "call-heavy (resistance building)"}`,
    });
  }

  // 2) OI build-up — call shorts (resistance) vs put shorts (support).
  const tally = buildupTally(chain);
  const callWriting = tally.ce.shortBuildup; // bearish (writers expect price capped)
  const putWriting = tally.pe.shortBuildup; // bullish (writers expect support holds)
  const writingTotal = callWriting + putWriting;
  let writeScore = 0;
  if (writingTotal > 0) {
    writeScore = clamp((putWriting - callWriting) / writingTotal, -1, 1) * 0.7;
    factors.push({
      label: "OI Build-up",
      score: writeScore,
      detail: putWriting >= callWriting ? "Put writing dominates (bullish support)" : "Call writing dominates (bearish resistance)",
    });
  }

  // 3) ATM price action — change in ATM CE vs PE premiums.
  const atm = chain.rows.find((r) => r.isAtm);
  if (atm) {
    const ceCh = atm.ce.ltpChangePct;
    const peCh = atm.pe.ltpChangePct;
    const diff = ceCh - peCh; // CE rising faster than PE = bullish
    const paScore = clamp(diff / 20, -1, 1) * 0.5;
    if (Math.abs(diff) > 0.5) {
      factors.push({
        label: "ATM Price Action",
        score: paScore,
        detail: diff > 0 ? "Calls outpacing puts (bullish)" : "Puts outpacing calls (bearish)",
      });
    }
  }

  // 4) Spot vs Max Pain — price above max pain has an upward pull into expiry, and vice-versa.
  if (chain.maxPain > 0 && chain.spot > 0) {
    const rel = (chain.spot - chain.maxPain) / chain.spot;
    const mpScore = clamp(-rel * 30, -1, 1) * 0.3; // mean-reverting pull toward max pain
    factors.push({
      label: "Max Pain Pull",
      score: mpScore,
      detail: `Spot ${chain.spot.toFixed(0)} vs Max Pain ${chain.maxPain} — ${rel >= 0 ? "above (pull down)" : "below (pull up)"}`,
    });
  }

  // 5) Spot location within the support/resistance band.
  const sr = supportResistance(chain);
  if (sr.support > 0 && sr.resistance > 0 && sr.resistance > sr.support) {
    const mid = (sr.support + sr.resistance) / 2;
    const locScore = clamp((chain.spot - mid) / (sr.resistance - sr.support), -1, 1) * 0.3;
    factors.push({
      label: "S/R Position",
      score: locScore,
      detail: `Support ${sr.support} · Resistance ${sr.resistance}`,
    });
  }

  const total = factors.reduce((a, f) => a + f.score, 0);
  const maxPossible = factors.length || 1;
  const score = Math.round((total / maxPossible) * 100);
  const label: SentimentLabel = score > 15 ? "BULLISH" : score < -15 ? "BEARISH" : "NEUTRAL";
  const confidence = clamp(Math.abs(score) / 60, 0, 1);

  return { label, score, confidence, factors };
}
