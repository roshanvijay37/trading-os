/**
 * Strategy template library. Each template builds a set of legs anchored to the live ATM
 * strike, pulling live premiums/IV from the chain via the build context. Users can then
 * freely edit legs (drag, add, remove) in the Strategy Builder.
 */

import type {
  LegAction,
  LegInstrument,
  StrategyBuildContext,
  StrategyLeg,
  StrategyTemplate,
} from "../types";

let legSeq = 0;
function mkLeg(
  ctx: StrategyBuildContext,
  action: LegAction,
  instrument: LegInstrument,
  strike: number,
  expiryMs: number,
  lots = 1,
): StrategyLeg {
  return {
    id: `leg-${Date.now().toString(36)}-${legSeq++}`,
    action,
    instrument,
    strike,
    lots,
    price: ctx.priceAt(instrument, strike),
    iv: ctx.ivAt(instrument, strike),
    expiryMs,
  };
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  // --- Single leg ---
  {
    id: "long-call", name: "Long Call", category: "BULLISH", outlook: "Bullish",
    description: "Buy a call. Unlimited upside, risk limited to premium.",
    build: (c) => [mkLeg(c, "BUY", "CE", c.atmStrike, c.expiryMs)],
  },
  {
    id: "long-put", name: "Long Put", category: "BEARISH", outlook: "Bearish",
    description: "Buy a put. Profits as the underlying falls, risk limited to premium.",
    build: (c) => [mkLeg(c, "BUY", "PE", c.atmStrike, c.expiryMs)],
  },
  {
    id: "covered-call", name: "Covered Call", category: "INCOME", outlook: "Neutral-Bullish",
    description: "Long underlying (future) + short OTM call. Income against a holding.",
    build: (c) => [
      mkLeg(c, "BUY", "FUT", 0, c.expiryMs),
      mkLeg(c, "SELL", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  {
    id: "protective-put", name: "Protective Put", category: "BULLISH", outlook: "Bullish-Hedged",
    description: "Long underlying + long put as downside insurance.",
    build: (c) => [
      mkLeg(c, "BUY", "FUT", 0, c.expiryMs),
      mkLeg(c, "BUY", "PE", c.atmStrike - 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  // --- Vertical spreads ---
  {
    id: "bull-call-spread", name: "Bull Call Spread", category: "BULLISH", outlook: "Moderately Bullish",
    description: "Buy ATM call, sell higher call. Defined risk & reward.",
    build: (c) => [
      mkLeg(c, "BUY", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "SELL", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  {
    id: "bear-put-spread", name: "Bear Put Spread", category: "BEARISH", outlook: "Moderately Bearish",
    description: "Buy ATM put, sell lower put. Defined risk & reward.",
    build: (c) => [
      mkLeg(c, "BUY", "PE", c.atmStrike, c.expiryMs),
      mkLeg(c, "SELL", "PE", c.atmStrike - 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  {
    id: "bull-put-spread", name: "Bull Put Spread", category: "INCOME", outlook: "Moderately Bullish",
    description: "Sell ATM put, buy lower put. Net credit, defined risk.",
    build: (c) => [
      mkLeg(c, "SELL", "PE", c.atmStrike, c.expiryMs),
      mkLeg(c, "BUY", "PE", c.atmStrike - 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  {
    id: "bear-call-spread", name: "Bear Call Spread", category: "INCOME", outlook: "Moderately Bearish",
    description: "Sell ATM call, buy higher call. Net credit, defined risk.",
    build: (c) => [
      mkLeg(c, "SELL", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "BUY", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  // --- Wings ---
  {
    id: "iron-condor", name: "Iron Condor", category: "NEUTRAL", outlook: "Range-bound",
    description: "Sell OTM call & put spreads. Profits if price stays in the range.",
    build: (c) => [
      mkLeg(c, "BUY", "PE", c.atmStrike - 4 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "SELL", "PE", c.atmStrike - 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "SELL", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "BUY", "CE", c.atmStrike + 4 * c.strikeInterval, c.expiryMs),
    ],
  },
  {
    id: "iron-butterfly", name: "Iron Butterfly", category: "NEUTRAL", outlook: "Pinned at ATM",
    description: "Short ATM straddle + long OTM wings. Max profit if price pins ATM.",
    build: (c) => [
      mkLeg(c, "BUY", "PE", c.atmStrike - 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "SELL", "PE", c.atmStrike, c.expiryMs),
      mkLeg(c, "SELL", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "BUY", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  // --- Time spreads ---
  {
    id: "calendar-spread", name: "Calendar Spread", category: "VOLATILITY", outlook: "Neutral, rising IV",
    description: "Sell near-expiry ATM, buy far-expiry ATM. Long vega, positive theta near.",
    build: (c) => [
      mkLeg(c, "SELL", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "BUY", "CE", c.atmStrike, c.farExpiryMs),
    ],
  },
  {
    id: "diagonal-spread", name: "Diagonal Spread", category: "VOLATILITY", outlook: "Directional + time",
    description: "Sell near-expiry OTM, buy far-expiry different strike.",
    build: (c) => [
      mkLeg(c, "SELL", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "BUY", "CE", c.atmStrike, c.farExpiryMs),
    ],
  },
  // --- Ratio / back ---
  {
    id: "ratio-spread", name: "Call Ratio Spread", category: "INCOME", outlook: "Mildly Bullish",
    description: "Buy 1 ATM call, sell 2 higher calls. Credit with capped upside.",
    build: (c) => [
      mkLeg(c, "BUY", "CE", c.atmStrike, c.expiryMs, 1),
      mkLeg(c, "SELL", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs, 2),
    ],
  },
  {
    id: "back-spread", name: "Call Back Spread", category: "VOLATILITY", outlook: "Strongly Bullish",
    description: "Sell 1 ATM call, buy 2 higher calls. Long convexity on a breakout.",
    build: (c) => [
      mkLeg(c, "SELL", "CE", c.atmStrike, c.expiryMs, 1),
      mkLeg(c, "BUY", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs, 2),
    ],
  },
  // --- Straddles / strangles ---
  {
    id: "long-straddle", name: "Long Straddle", category: "VOLATILITY", outlook: "Big move either way",
    description: "Buy ATM call + put. Profits on a large move; long vega.",
    build: (c) => [
      mkLeg(c, "BUY", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "BUY", "PE", c.atmStrike, c.expiryMs),
    ],
  },
  {
    id: "short-straddle", name: "Short Straddle", category: "INCOME", outlook: "Range-bound",
    description: "Sell ATM call + put. Income if price stays put; undefined risk.",
    build: (c) => [
      mkLeg(c, "SELL", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "SELL", "PE", c.atmStrike, c.expiryMs),
    ],
  },
  {
    id: "long-strangle", name: "Long Strangle", category: "VOLATILITY", outlook: "Big move either way",
    description: "Buy OTM call + OTM put. Cheaper than a straddle, needs a bigger move.",
    build: (c) => [
      mkLeg(c, "BUY", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "BUY", "PE", c.atmStrike - 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  {
    id: "short-strangle", name: "Short Strangle", category: "INCOME", outlook: "Range-bound",
    description: "Sell OTM call + OTM put. Wider profit zone than short straddle.",
    build: (c) => [
      mkLeg(c, "SELL", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "SELL", "PE", c.atmStrike - 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  // --- Hedged / synthetic / arb ---
  {
    id: "collar", name: "Collar", category: "INCOME", outlook: "Protected Long",
    description: "Long underlying + long put + short call. Caps both sides.",
    build: (c) => [
      mkLeg(c, "BUY", "FUT", 0, c.expiryMs),
      mkLeg(c, "BUY", "PE", c.atmStrike - 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "SELL", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
    ],
  },
  {
    id: "synthetic-long", name: "Synthetic Long", category: "SYNTHETIC", outlook: "Bullish",
    description: "Long ATM call + short ATM put. Replicates long underlying.",
    build: (c) => [
      mkLeg(c, "BUY", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "SELL", "PE", c.atmStrike, c.expiryMs),
    ],
  },
  {
    id: "synthetic-short", name: "Synthetic Short", category: "SYNTHETIC", outlook: "Bearish",
    description: "Short ATM call + long ATM put. Replicates short underlying.",
    build: (c) => [
      mkLeg(c, "SELL", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "BUY", "PE", c.atmStrike, c.expiryMs),
    ],
  },
  {
    id: "box-spread", name: "Box Spread", category: "ARBITRAGE", outlook: "Rate arbitrage",
    description: "Bull call spread + bear put spread at the same strikes. Locked payoff.",
    build: (c) => [
      mkLeg(c, "BUY", "CE", c.atmStrike, c.expiryMs),
      mkLeg(c, "SELL", "CE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "BUY", "PE", c.atmStrike + 2 * c.strikeInterval, c.expiryMs),
      mkLeg(c, "SELL", "PE", c.atmStrike, c.expiryMs),
    ],
  },
];

export function getTemplate(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.id === id);
}
