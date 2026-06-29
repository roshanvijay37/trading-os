/**
 * Canonical Black-Scholes engine for the Options Workspace.
 *
 * One implementation, reused by the live chain, Greeks dashboard, payoff analyzer,
 * calculators and probability panels — so the math is defined exactly once.
 *
 * Conventions (European options on an index, continuous dividend yield q):
 *   - sigma, r, q are decimals (0.14 = 14%).
 *   - T is in years.
 *   - vega and rho are returned per 1 percentage-point (the trader convention),
 *     i.e. already divided by 100.
 *   - theta, charm and color are returned per CALENDAR DAY (divided by 365).
 *
 * Pure and dependency-free so it is trivially unit-testable.
 */

import type { Greeks, OptionType } from "../types";

export const DEFAULT_R = 0.065; // RBI repo-ish risk-free rate
export const DEFAULT_Q = 0; // index options: dividend yield folded out
const SQRT_2PI = Math.sqrt(2 * Math.PI);
const MIN_T = 1 / (365 * 24 * 60); // ~1 minute floor so √T never collapses
const DAYS = 365;

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard normal CDF via the Zelen & Severo rational approximation
 * (Abramowitz & Stegun 26.2.17), max abs error ~7.5e-8 — accurate enough for IV solving.
 */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = normPdf(x);
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export interface BsInputs {
  type: OptionType;
  spot: number;
  strike: number;
  t: number; // years
  r?: number;
  q?: number;
  sigma: number;
}

function d1d2(spot: number, strike: number, t: number, r: number, q: number, sigma: number) {
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (r - q + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2, sqrtT };
}

/** Black-Scholes fair value. Falls back to intrinsic at/after expiry or with no vol. */
export function bsPrice({ type, spot, strike, t, r = DEFAULT_R, q = DEFAULT_Q, sigma }: BsInputs): number {
  if (!(spot > 0) || !(strike > 0)) return 0;
  if (!(t > 0) || !(sigma > 0)) {
    return type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }
  const { d1, d2 } = d1d2(spot, strike, t, r, q, sigma);
  const dfR = Math.exp(-r * t);
  const dfQ = Math.exp(-q * t);
  if (type === "CE") return spot * dfQ * normCdf(d1) - strike * dfR * normCdf(d2);
  return strike * dfR * normCdf(-d2) - spot * dfQ * normCdf(-d1);
}

const ZERO_GREEKS: Greeks = {
  delta: 0,
  gamma: 0,
  theta: 0,
  vega: 0,
  rho: 0,
  vanna: 0,
  vomma: 0,
  charm: 0,
  speed: 0,
  color: 0,
  lambda: 0,
};

/**
 * Full first- and second-order Greeks. `price` (optional) is only used for lambda/elasticity;
 * when omitted it is taken as the model price.
 */
export function computeGreeks(
  { type, spot, strike, t, r = DEFAULT_R, q = DEFAULT_Q, sigma }: BsInputs,
  price?: number,
): Greeks {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(sigma > 0)) return { ...ZERO_GREEKS };

  const { d1, d2, sqrtT } = d1d2(spot, strike, t, r, q, sigma);
  const pdf = normPdf(d1);
  const dfR = Math.exp(-r * t);
  const dfQ = Math.exp(-q * t);

  const gamma = (dfQ * pdf) / (spot * sigma * sqrtT);
  const vegaRaw = spot * dfQ * pdf * sqrtT; // per 1.00 change in sigma

  const delta = type === "CE" ? dfQ * normCdf(d1) : dfQ * (normCdf(d1) - 1);

  // Theta per year, then per day.
  const term1 = -(spot * dfQ * pdf * sigma) / (2 * sqrtT);
  const thetaYr =
    type === "CE"
      ? term1 - r * strike * dfR * normCdf(d2) + q * spot * dfQ * normCdf(d1)
      : term1 + r * strike * dfR * normCdf(-d2) - q * spot * dfQ * normCdf(-d1);

  const rhoRaw =
    type === "CE" ? strike * t * dfR * normCdf(d2) : -strike * t * dfR * normCdf(-d2); // per 1.00 change in r

  // Second-order Greeks (q = 0 simplifications kept general).
  const vanna = (-dfQ * pdf * d2) / sigma; // ∂delta/∂sigma per 1.00 sigma
  const vomma = vegaRaw * ((d1 * d2) / sigma); // ∂vega/∂sigma
  const charmYr =
    -dfQ * pdf * ((2 * (r - q) * t - d2 * sigma * sqrtT) / (2 * t * sigma * sqrtT)) +
    (type === "CE" ? q * dfQ * normCdf(d1) : -q * dfQ * normCdf(-d1));
  const speed = (-gamma / spot) * (d1 / (sigma * sqrtT) + 1); // ∂gamma/∂spot
  const colorYr =
    (-dfQ * pdf) /
    (2 * spot * t * sigma * sqrtT) *
    (2 * q * t + 1 + ((2 * (r - q) * t - d2 * sigma * sqrtT) / (sigma * sqrtT)) * d1);

  const px = price && price > 0 ? price : bsPrice({ type, spot, strike, t, r, q, sigma });
  const lambda = px > 0 ? (delta * spot) / px : 0;

  return {
    delta,
    gamma,
    theta: thetaYr / DAYS,
    vega: vegaRaw / 100,
    rho: rhoRaw / 100,
    vanna: vanna / 100,
    vomma: vomma / 10000,
    charm: charmYr / DAYS,
    speed,
    color: colorYr / DAYS,
    lambda,
  };
}

/**
 * Implied volatility solved from a market price via Newton-Raphson with a bisection fallback.
 * Returns 0 when the price carries no time value (≤ intrinsic) or no root exists in [0.1%, 500%].
 */
export function impliedVol(
  type: OptionType,
  marketPrice: number,
  spot: number,
  strike: number,
  t: number,
  r = DEFAULT_R,
  q = DEFAULT_Q,
): number {
  if (!(marketPrice > 0) || !(spot > 0) || !(strike > 0) || !(t > 0)) return 0;

  const intrinsic = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  // No time value (or a stale/crossed quote) → IV is not defined.
  if (marketPrice <= intrinsic + 1e-6) return 0;

  const price = (sigma: number) => bsPrice({ type, spot, strike, t, r, q, sigma });
  const vega = (sigma: number) => spot * Math.exp(-q * t) * normPdf(d1d2(spot, strike, t, r, q, sigma).d1) * Math.sqrt(t);

  // Newton-Raphson seeded at a Brenner-Subrahmanyam style guess.
  let sigma = Math.max(0.05, Math.sqrt((2 * Math.PI) / t) * (marketPrice / spot));
  for (let i = 0; i < 60; i++) {
    const diff = price(sigma) - marketPrice;
    if (Math.abs(diff) < 1e-5) return clampVol(sigma);
    const v = vega(sigma);
    if (v < 1e-8) break; // vega too flat — switch to bisection
    sigma -= diff / v;
    if (sigma <= 0 || sigma > 5) break;
  }

  // Bisection fallback over a wide, safe bracket.
  let lo = 0.001;
  let hi = 5;
  let flo = price(lo) - marketPrice;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    const fmid = price(mid) - marketPrice;
    if (Math.abs(fmid) < 1e-5) return clampVol(mid);
    if (flo * fmid <= 0) hi = mid;
    else {
      lo = mid;
      flo = fmid;
    }
  }
  return 0;
}

function clampVol(sigma: number): number {
  if (!Number.isFinite(sigma) || sigma <= 0) return 0;
  return Math.min(sigma, 5);
}

/** Years to a given expiry (epoch ms), floored at ~1 minute. */
export function yearsToExpiry(expiryMs: number, nowMs: number): number {
  return Math.max((expiryMs - nowMs) / (DAYS * 24 * 3600 * 1000), MIN_T);
}
