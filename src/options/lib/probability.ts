/**
 * Lognormal terminal-distribution analytics: probability ITM/OTM/touch, expected ranges,
 * and a distribution curve. All COMPUTED from spot, ATM IV and time-to-expiry — there is no
 * broker feed for these. Uses a lognormal price model with drift r (risk-free).
 */

import { normCdf } from "./bs";
import type { OptionType } from "../types";

/** P(S_T > level) under lognormal terminal price with vol sigma and drift r. */
export function probAbove(spot: number, level: number, sigma: number, t: number, r = 0.065): number {
  if (!(spot > 0) || !(level > 0) || !(sigma > 0) || !(t > 0)) return level <= spot ? 1 : 0;
  const d2 = (Math.log(spot / level) + (r - 0.5 * sigma * sigma) * t) / (sigma * Math.sqrt(t));
  return normCdf(d2);
}

export function probBelow(spot: number, level: number, sigma: number, t: number, r = 0.065): number {
  return 1 - probAbove(spot, level, sigma, t, r);
}

/** Probability the option finishes in the money. */
export function probItm(
  type: OptionType,
  spot: number,
  strike: number,
  sigma: number,
  t: number,
  r = 0.065,
): number {
  return type === "CE" ? probAbove(spot, strike, sigma, t, r) : probBelow(spot, strike, sigma, t, r);
}

export function probOtm(type: OptionType, spot: number, strike: number, sigma: number, t: number, r = 0.065): number {
  return 1 - probItm(type, spot, strike, sigma, t, r);
}

/**
 * Probability of touching `level` at any point before expiry (GBM first-passage, driftless
 * approximation — standard desk convention is ≈ 2 × probability of finishing past the level).
 */
export function probTouch(spot: number, level: number, sigma: number, t: number): number {
  if (!(spot > 0) || !(level > 0) || !(sigma > 0) || !(t > 0)) return 0;
  const vol = sigma * Math.sqrt(t);
  const d = Math.log(level / spot) / vol;
  // P(touch) = 2 * N(-|d|) for a single barrier under zero drift.
  const p = 2 * normCdf(-Math.abs(d));
  return Math.min(1, Math.max(0, p));
}

export interface ExpectedRange {
  /** 1-σ move in points. */
  oneSigma: number;
  lower1: number;
  upper1: number;
  lower2: number;
  upper2: number;
}

/** Expected trading range from IV: spot × σ × √T (1- and 2-σ bands). */
export function expectedRange(spot: number, sigma: number, t: number): ExpectedRange {
  const oneSigma = spot > 0 && sigma > 0 && t > 0 ? spot * sigma * Math.sqrt(t) : 0;
  return {
    oneSigma,
    lower1: spot - oneSigma,
    upper1: spot + oneSigma,
    lower2: spot - 2 * oneSigma,
    upper2: spot + 2 * oneSigma,
  };
}

export interface DistributionPoint {
  spot: number;
  density: number;
}

/** Lognormal terminal density curve over [spot×(1-width), spot×(1+width)]. */
export function distributionCurve(
  spot: number,
  sigma: number,
  t: number,
  r = 0.065,
  steps = 120,
  width = 0.25,
): DistributionPoint[] {
  const out: DistributionPoint[] = [];
  if (!(spot > 0) || !(sigma > 0) || !(t > 0)) return out;
  const vol = sigma * Math.sqrt(t);
  const mu = Math.log(spot) + (r - 0.5 * sigma * sigma) * t;
  const lo = spot * (1 - width);
  const hi = spot * (1 + width);
  const dx = (hi - lo) / steps;
  for (let i = 0; i <= steps; i++) {
    const s = lo + i * dx;
    if (s <= 0) continue;
    const z = (Math.log(s) - mu) / vol;
    const density = Math.exp(-0.5 * z * z) / (s * vol * Math.sqrt(2 * Math.PI));
    out.push({ spot: s, density });
  }
  return out;
}

/** Discrete lognormal weights over a spot grid (normalized to sum 1) — used for POP/EV. */
export function lognormalWeights(grid: number[], spot: number, sigma: number, t: number, r = 0.065): number[] {
  if (!(spot > 0) || !(sigma > 0) || !(t > 0)) return grid.map(() => 0);
  const vol = sigma * Math.sqrt(t);
  const mu = Math.log(spot) + (r - 0.5 * sigma * sigma) * t;
  const raw = grid.map((s) => {
    if (s <= 0) return 0;
    const z = (Math.log(s) - mu) / vol;
    return Math.exp(-0.5 * z * z) / (s * vol);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return sum > 0 ? raw.map((w) => w / sum) : raw.map(() => 0);
}
