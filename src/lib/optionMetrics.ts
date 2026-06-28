/**
 * Pure option-chain analytics: PCR, Max Pain, and Expected Move.
 * Computed client-side from the existing /api/account/option-chain response (OI + LTP).
 * No IV/Greeks here — FYERS does not serve those (see Tier-3 cleanup).
 */

export interface OptionLeg {
  type: "CE" | "PE";
  strike: number;
  oi: number;
  ltp: number;
}

function num(v: unknown): number {
  const x = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : 0;
}

type RawRow = Record<string, unknown>;

function rowType(r: RawRow): string {
  return String(r.option_type ?? r.optionType ?? "");
}

/** Map a raw FYERS optionsChain into normalized CE/PE legs (skips the underlying row). */
export function normalizeOptionChain(raw: unknown): OptionLeg[] {
  const rows = Array.isArray(raw) ? (raw as RawRow[]) : [];
  const legs: OptionLeg[] = [];
  for (const r of rows) {
    const type = rowType(r);
    if (type !== "CE" && type !== "PE") continue;
    const strike = num(r.strike_price ?? r.strikePrice ?? r.strike);
    if (strike <= 0) continue;
    legs.push({ type, strike, oi: num(r.oi ?? r.openInterest), ltp: num(r.ltp ?? r.lp) });
  }
  return legs;
}

/** Underlying spot from the chain's non-option row (FYERS includes it with ltp = spot). */
export function extractSpot(raw: unknown): number {
  const rows = Array.isArray(raw) ? (raw as RawRow[]) : [];
  for (const r of rows) {
    const type = rowType(r);
    if (type !== "CE" && type !== "PE") {
      const ltp = num(r.ltp ?? r.lp);
      if (ltp > 0) return ltp;
    }
  }
  return 0;
}

/** Put/Call Ratio = total PE OI / total CE OI. */
export function computePCR(legs: OptionLeg[]): number {
  let ce = 0;
  let pe = 0;
  for (const l of legs) {
    if (l.type === "CE") ce += l.oi;
    else pe += l.oi;
  }
  if (ce <= 0) return 0;
  return Math.round((pe / ce) * 100) / 100;
}

/** Max Pain = the strike that minimizes total in-the-money value paid to option holders. */
export function computeMaxPain(legs: OptionLeg[]): number {
  const strikes = Array.from(new Set(legs.map((l) => l.strike))).sort((a, b) => a - b);
  if (strikes.length === 0) return 0;
  let best = strikes[0];
  let bestPain = Infinity;
  for (const k of strikes) {
    let pain = 0;
    for (const l of legs) {
      pain += l.type === "CE" ? Math.max(0, k - l.strike) * l.oi : Math.max(0, l.strike - k) * l.oi;
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = k;
    }
  }
  return best;
}

export interface ExpectedMove {
  move: number;
  movePercent: number;
  upper: number;
  lower: number;
}

/** Expected move from the ATM straddle price (CE+PE at the strike nearest spot). */
export function computeExpectedMove(legs: OptionLeg[], spot: number): ExpectedMove {
  if (!(spot > 0) || legs.length === 0) return { move: 0, movePercent: 0, upper: 0, lower: 0 };
  const strikes = Array.from(new Set(legs.map((l) => l.strike)));
  let atm = strikes[0];
  for (const k of strikes) {
    if (Math.abs(k - spot) < Math.abs(atm - spot)) atm = k;
  }
  const ce = legs.find((l) => l.type === "CE" && l.strike === atm);
  const pe = legs.find((l) => l.type === "PE" && l.strike === atm);
  const straddle = (ce?.ltp ?? 0) + (pe?.ltp ?? 0);
  return {
    move: Math.round(straddle * 100) / 100,
    movePercent: Math.round((straddle / spot) * 10000) / 100,
    upper: Math.round((spot + straddle) * 100) / 100,
    lower: Math.round((spot - straddle) * 100) / 100,
  };
}
