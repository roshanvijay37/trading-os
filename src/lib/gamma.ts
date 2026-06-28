/**
 * Dealer Gamma Exposure (GEX) from the option chain, via Black-Scholes.
 *
 * The FYERS chain serves OI + LTP only (no per-strike Greeks), so gamma is MODELLED:
 *   - a single flat IV (India VIX / 100) is applied across every strike — there is no skew,
 *   - time to expiry comes from the chain's nearest expiry,
 *   - sign convention is the common "dealers long calls, short puts" one (call gamma adds,
 *     put gamma subtracts). The magnitude and the gamma-flip level are the informative parts;
 *     the overall sign flips if you assume the opposite dealer positioning.
 *
 * Treat the output as a model estimate, not a measured value. Pure + unit-tested.
 */

import type { OptionLeg } from "./optionMetrics";

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const MIN_YEARS = 1 / (365 * 24 * 60); // ~1 minute floor so √T never collapses to 0
const DEFAULT_R = 0.065;
const DEFAULT_LOT = 75; // NIFTY contract multiplier

function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Per-contract Black-Scholes gamma using a flat IV. Returns 0 for degenerate inputs. */
export function bsGamma(spot: number, strike: number, sigma: number, t: number, r = DEFAULT_R): number {
  if (!(spot > 0) || !(strike > 0) || !(sigma > 0) || !(t > 0)) return 0;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  return normPDF(d1) / (spot * sigma * sqrtT);
}

export interface GammaExposure {
  /** Net dealer gamma notional at spot, in ₹ crore per 1% move. */
  totalGamma: number;
  /** Spot level where net dealer gamma crosses zero (gamma flip); 0 if no crossing in range. */
  zeroGammaLevel: number;
  /** Alias of zeroGammaLevel, kept for the existing UI/type shape. */
  flipPoint: number;
  /** Net dealer delta change per 1 index point move (in contracts). */
  estimatedHedgeDelta: number;
  /** Per-strike GEX (₹ crore per 1% move), for a heatmap. */
  gammaByStrike: { strike: number; gex: number }[];
}

export interface GexOpts {
  r?: number;
  lotSize?: number;
}

/** Net dealer GEX (₹ per 1% move) evaluated at a hypothetical spot S. Calls add, puts subtract. */
function netGexAtSpot(legs: OptionLeg[], S: number, sigma: number, t: number, lotSize: number, r: number): number {
  let gex = 0;
  for (const l of legs) {
    const g = bsGamma(S, l.strike, sigma, t, r);
    const notional = g * l.oi * lotSize * S * S * 0.01; // ₹ change in delta-notional per 1% spot move
    gex += l.type === "CE" ? notional : -notional;
  }
  return gex;
}

/**
 * Compute dealer GEX, the gamma-flip level, and hedge delta from the chain.
 * Returns null when IV / expiry / spot are missing — callers should render an honest blank,
 * not a zero, in that case.
 */
export function computeGammaExposure(
  legs: OptionLeg[],
  spot: number,
  sigma: number,
  t: number,
  opts: GexOpts = {},
): GammaExposure | null {
  if (legs.length === 0 || !(spot > 0) || !(sigma > 0) || !(t > 0)) return null;
  const lotSize = opts.lotSize ?? DEFAULT_LOT;
  const r = opts.r ?? DEFAULT_R;

  const strikes = Array.from(new Set(legs.map((l) => l.strike))).sort((a, b) => a - b);

  // Per-strike GEX at the current spot (for the heatmap), in ₹ crore / 1% move.
  const gammaByStrike = strikes.map((k) => {
    let gex = 0;
    for (const l of legs) {
      if (l.strike !== k) continue;
      const g = bsGamma(spot, k, sigma, t, r);
      const notional = g * l.oi * lotSize * spot * spot * 0.01;
      gex += l.type === "CE" ? notional : -notional;
    }
    return { strike: k, gex: round(gex / 1e7, 2) };
  });

  const totalNotional = netGexAtSpot(legs, spot, sigma, t, lotSize, r);

  // Net dealer delta change per 1 index POINT move = Σ ±γ·OI·lot (calls +, puts −).
  let hedgeDelta = 0;
  for (const l of legs) {
    const g = bsGamma(spot, l.strike, sigma, t, r);
    hedgeDelta += (l.type === "CE" ? 1 : -1) * g * l.oi * lotSize;
  }

  // Gamma-flip level: scan net GEX across strike levels, interpolate the first sign change.
  let zeroGamma = 0;
  let prevS: number | null = null;
  let prevG = 0;
  for (const k of strikes) {
    const g = netGexAtSpot(legs, k, sigma, t, lotSize, r);
    if (prevS !== null && prevG !== g && ((prevG <= 0 && g >= 0) || (prevG >= 0 && g <= 0))) {
      zeroGamma = Math.round(prevS + ((k - prevS) * (0 - prevG)) / (g - prevG));
      break;
    }
    prevS = k;
    prevG = g;
  }

  return {
    totalGamma: round(totalNotional / 1e7, 2),
    zeroGammaLevel: zeroGamma,
    flipPoint: zeroGamma,
    estimatedHedgeDelta: Math.round(hedgeDelta),
    gammaByStrike,
  };
}

type RawRow = Record<string, unknown>;

/** Parse a FYERS expiry value (epoch seconds/ms as number or string) into epoch ms; 0 if unusable. */
function parseExpiryMs(raw: unknown): number {
  const n = typeof raw === "string" ? parseFloat(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  // 10-digit values are seconds; 13-digit are already ms.
  return n < 1e12 ? n * 1000 : n;
}

/**
 * Years to the nearest FUTURE expiry from the chain's `expiryData`
 * ([{ date, expiry }], expiry = epoch seconds). Floors at ~1 minute; 0 if none parseable.
 */
export function nearestExpiryYears(expiryData: unknown, nowMs: number): number {
  const rows = Array.isArray(expiryData) ? (expiryData as RawRow[]) : [];
  let soonest = Infinity;
  for (const row of rows) {
    const ms = parseExpiryMs(row?.expiry ?? row?.date);
    if (ms > nowMs && ms < soonest) soonest = ms;
  }
  if (!Number.isFinite(soonest)) return 0;
  return Math.max((soonest - nowMs) / (365 * 24 * 3600 * 1000), MIN_YEARS);
}
