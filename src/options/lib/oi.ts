/**
 * Open-Interest analytics: dynamic support/resistance, OI ladder + heatmap data,
 * build-up tallies, and PCR context. Derived from the live OI / change-in-OI in the chain.
 */

import type { EnrichedChain, OiBuildup, StrikeRow } from "../types";

export interface OiLadderRow {
  strike: number;
  ceOi: number;
  peOi: number;
  ceOiChange: number;
  peOiChange: number;
  isAtm: boolean;
}

export function oiLadder(chain: EnrichedChain): OiLadderRow[] {
  return chain.rows.map((r) => ({
    strike: r.strike,
    ceOi: r.ce.oi,
    peOi: r.pe.oi,
    ceOiChange: r.ce.oiChange,
    peOiChange: r.pe.oiChange,
    isAtm: r.isAtm,
  }));
}

export interface SupportResistance {
  /** Strike with the highest PE OI — dynamic support (put writers defend it). */
  support: number;
  supportOi: number;
  /** Strike with the highest CE OI — dynamic resistance (call writers cap it). */
  resistance: number;
  resistanceOi: number;
  /** Second-tier levels. */
  support2: number;
  resistance2: number;
}

export function supportResistance(chain: EnrichedChain): SupportResistance {
  const ceSorted = [...chain.rows].sort((a, b) => b.ce.oi - a.ce.oi);
  const peSorted = [...chain.rows].sort((a, b) => b.pe.oi - a.pe.oi);
  return {
    support: peSorted[0]?.strike ?? 0,
    supportOi: peSorted[0]?.pe.oi ?? 0,
    support2: peSorted[1]?.strike ?? 0,
    resistance: ceSorted[0]?.strike ?? 0,
    resistanceOi: ceSorted[0]?.ce.oi ?? 0,
    resistance2: ceSorted[1]?.strike ?? 0,
  };
}

export interface BuildupTally {
  longBuildup: number;
  shortBuildup: number;
  longUnwinding: number;
  shortCovering: number;
  neutral: number;
}

const EMPTY_TALLY: BuildupTally = {
  longBuildup: 0, shortBuildup: 0, longUnwinding: 0, shortCovering: 0, neutral: 0,
};

function tallyKey(b: OiBuildup): keyof BuildupTally {
  switch (b) {
    case "LONG_BUILDUP": return "longBuildup";
    case "SHORT_BUILDUP": return "shortBuildup";
    case "LONG_UNWINDING": return "longUnwinding";
    case "SHORT_COVERING": return "shortCovering";
    default: return "neutral";
  }
}

/** Build-up tally weighted by |change in OI|, split into CE and PE. */
export function buildupTally(chain: EnrichedChain): { ce: BuildupTally; pe: BuildupTally } {
  const ce = { ...EMPTY_TALLY };
  const pe = { ...EMPTY_TALLY };
  for (const r of chain.rows) {
    ce[tallyKey(r.ce.buildup)] += Math.abs(r.ce.oiChange);
    pe[tallyKey(r.pe.buildup)] += Math.abs(r.pe.oiChange);
  }
  return { ce, pe };
}

export interface OiChangeLeader {
  strike: number;
  type: "CE" | "PE";
  oiChange: number;
  oi: number;
  buildup: OiBuildup;
  ltp: number;
}

/** Strikes with the largest absolute change in OI (where today's positioning is happening). */
export function topOiChanges(chain: EnrichedChain, limit = 8): OiChangeLeader[] {
  const all: OiChangeLeader[] = [];
  for (const r of chain.rows) {
    all.push({ strike: r.strike, type: "CE", oiChange: r.ce.oiChange, oi: r.ce.oi, buildup: r.ce.buildup, ltp: r.ce.ltp });
    all.push({ strike: r.strike, type: "PE", oiChange: r.pe.oiChange, oi: r.pe.oi, buildup: r.pe.buildup, ltp: r.pe.ltp });
  }
  return all.sort((a, b) => Math.abs(b.oiChange) - Math.abs(a.oiChange)).slice(0, limit);
}

/** Max OI either side, used to scale heatmap/ladder bars. */
export function maxOi(rows: StrikeRow[]): number {
  let m = 0;
  for (const r of rows) m = Math.max(m, r.ce.oi, r.pe.oi);
  return m;
}
