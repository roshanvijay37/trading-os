/**
 * Strategy payoff engine: expiry & today P/L curves, break-evens, max profit/loss
 * (with unbounded detection), aggregate Greeks, probability of profit, expected value
 * and a local margin estimate. Pure; consumed by the Strategy Builder, Payoff Analyzer
 * and Strategy Analyzer panels.
 */

import { bsPrice, computeGreeks, yearsToExpiry, DEFAULT_R } from "./bs";
import { lognormalWeights } from "./probability";
import type { Greeks, PayoffPoint, PayoffResult, StrategyLeg } from "../types";

const ZERO_GREEKS: Greeks = {
  delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0,
  vanna: 0, vomma: 0, charm: 0, speed: 0, color: 0, lambda: 0,
};

function dir(leg: StrategyLeg): number {
  return leg.action === "BUY" ? 1 : -1;
}

function intrinsicAtExpiry(leg: StrategyLeg, s: number): number {
  if (leg.instrument === "FUT") return s;
  if (leg.instrument === "CE") return Math.max(0, s - leg.strike);
  return Math.max(0, leg.strike - s);
}

function valueToday(leg: StrategyLeg, s: number, t: number, r: number): number {
  if (leg.instrument === "FUT") return s;
  if (t <= 0 || leg.iv <= 0) return intrinsicAtExpiry(leg, s);
  return bsPrice({ type: leg.instrument, spot: s, strike: leg.strike, t, r, sigma: leg.iv });
}

export interface PayoffOpts {
  lotSize: number;
  spot: number;
  /** ATM IV (decimal) for the probability model. */
  atmIv: number;
  nowMs: number;
  riskFreeRate?: number;
  gridWidth?: number; // ± fraction of spot
  gridSteps?: number;
}

export function computePayoff(legs: StrategyLeg[], opts: PayoffOpts): PayoffResult {
  const { lotSize, spot, atmIv, nowMs } = opts;
  const r = opts.riskFreeRate ?? DEFAULT_R;
  const width = opts.gridWidth ?? 0.2;
  const steps = opts.gridSteps ?? 160;

  const empty: PayoffResult = {
    points: [], maxProfit: 0, maxLoss: 0, breakevens: [], netPremium: 0,
    greeks: { ...ZERO_GREEKS }, probOfProfit: 0, expectedValue: 0, riskReward: 0, marginEstimate: 0,
  };
  if (legs.length === 0 || !(spot > 0)) return empty;

  // Net premium (debit > 0, credit < 0).
  let netPremium = 0;
  for (const leg of legs) {
    const qty = leg.lots * lotSize;
    netPremium += dir(leg) * leg.price * qty;
  }

  const pnlAtExpiry = (s: number): number => {
    let pnl = 0;
    for (const leg of legs) {
      const qty = leg.lots * lotSize;
      pnl += dir(leg) * (intrinsicAtExpiry(leg, s) - leg.price) * qty;
    }
    return pnl;
  };

  // Today P/L (mark-to-model with each leg's IV and current time to its expiry).
  const pnlToday = (s: number): number => {
    let pnl = 0;
    for (const leg of legs) {
      const qty = leg.lots * lotSize;
      const t = yearsToExpiry(leg.expiryMs, nowMs);
      pnl += dir(leg) * (valueToday(leg, s, t, r) - leg.price) * qty;
    }
    return pnl;
  };

  const lo = spot * (1 - width);
  const hi = spot * (1 + width);
  const dx = (hi - lo) / steps;
  const points: PayoffPoint[] = [];
  const grid: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = lo + i * dx;
    grid.push(s);
    points.push({ spot: s, expiryPnl: pnlAtExpiry(s), todayPnl: pnlToday(s) });
  }

  // Break-evens: sign changes of the expiry curve.
  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].expiryPnl;
    const b = points[i].expiryPnl;
    if (a === 0) breakevens.push(points[i - 1].spot);
    else if (a * b < 0) {
      const s0 = points[i - 1].spot;
      const s1 = points[i].spot;
      breakevens.push(s0 + ((0 - a) / (b - a)) * (s1 - s0));
    }
  }

  // Unbounded detection via slope of the expiry payoff far out-of-range.
  let slopeHigh = 0; // dP/dS as S → ∞
  let slopeLow = 0; // dP/dS as S → 0
  for (const leg of legs) {
    const qty = leg.lots * lotSize * dir(leg);
    if (leg.instrument === "CE") slopeHigh += qty; // call value slope 1 far above
    if (leg.instrument === "FUT") { slopeHigh += qty; slopeLow += qty; }
    if (leg.instrument === "PE") slopeLow += -qty; // put value slope -1 far below
  }

  // Evaluate a very wide bracket to capture finite extremes.
  const wideLo = 0;
  const wideHi = spot * 2;
  const finiteVals = [pnlAtExpiry(wideLo), pnlAtExpiry(wideHi), ...points.map((p) => p.expiryPnl)];
  let maxProfit = Math.max(...finiteVals);
  let maxLoss = Math.min(...finiteVals);
  if (slopeHigh > 1e-9 || slopeLow < -1e-9) maxProfit = Infinity;
  if (slopeHigh < -1e-9 || slopeLow > 1e-9) maxLoss = -Infinity;

  // Aggregate Greeks at the current spot.
  const greeks: Greeks = { ...ZERO_GREEKS };
  for (const leg of legs) {
    const qty = leg.lots * lotSize * dir(leg);
    if (leg.instrument === "FUT") {
      greeks.delta += qty; // futures: pure delta
      continue;
    }
    const t = yearsToExpiry(leg.expiryMs, nowMs);
    const g = computeGreeks({ type: leg.instrument, spot, strike: leg.strike, t, r, sigma: leg.iv || atmIv });
    greeks.delta += g.delta * qty;
    greeks.gamma += g.gamma * qty;
    greeks.theta += g.theta * qty;
    greeks.vega += g.vega * qty;
    greeks.rho += g.rho * qty;
    greeks.vanna += g.vanna * qty;
    greeks.vomma += g.vomma * qty;
    greeks.charm += g.charm * qty;
    greeks.speed += g.speed * qty;
    greeks.color += g.color * qty;
  }

  // Probability of profit & expected value under the lognormal terminal distribution.
  const tAtm = legs.reduce((min, l) => Math.min(min, yearsToExpiry(l.expiryMs, nowMs)), Infinity);
  const weights = lognormalWeights(grid, spot, atmIv, Number.isFinite(tAtm) ? tAtm : 0, r);
  let probOfProfit = 0;
  let expectedValue = 0;
  for (let i = 0; i < grid.length; i++) {
    if (points[i].expiryPnl > 0) probOfProfit += weights[i];
    expectedValue += weights[i] * points[i].expiryPnl;
  }

  const riskReward =
    Number.isFinite(maxProfit) && Number.isFinite(maxLoss) && maxLoss < 0
      ? Math.abs(maxProfit / maxLoss)
      : 0;

  // Local SPAN-style margin estimate (the authoritative figure comes from the broker margin API).
  const hasShort = legs.some((l) => l.action === "SELL" && l.instrument !== "FUT");
  let marginEstimate: number;
  if (Number.isFinite(maxLoss)) {
    marginEstimate = Math.abs(maxLoss); // defined-risk: margin ≈ max loss
  } else {
    // Undefined-risk short: rough exposure-based estimate.
    let exposure = 0;
    for (const leg of legs) {
      if (leg.action === "SELL") exposure += 0.12 * spot * leg.lots * lotSize;
    }
    marginEstimate = exposure;
  }
  if (!hasShort && netPremium > 0) marginEstimate = netPremium; // pure debit position

  return {
    points,
    maxProfit,
    maxLoss,
    breakevens,
    netPremium,
    greeks,
    probOfProfit,
    expectedValue,
    riskReward,
    marginEstimate,
  };
}
