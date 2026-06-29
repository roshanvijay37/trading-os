/**
 * Shared type contract for the Options Workspace.
 *
 * This is the single source of truth every panel imports from. The live broker payload
 * (FYERS `options-chain-v3` via /api/account/option-chain) carries strike, LTP, bid, ask,
 * volume, OI and change-in-OI per strike — but NO Greeks and NO per-strike IV. Those are
 * COMPUTED client-side in `lib/bs.ts` + `lib/chain.ts`. Every value therefore carries a
 * `Provenance` tag so the UI can be honest about what is measured vs. modelled.
 */

// ---------------------------------------------------------------------------
// Provenance / status
// ---------------------------------------------------------------------------

/** Where a displayed value comes from. Drives the provenance badge on every panel. */
export type Provenance =
  | "BROKER" // straight from the FYERS live feed
  | "COMPUTED" // derived locally from broker data (Black-Scholes, etc.)
  | "PROXY" // a defensible stand-in when no direct feed exists (labelled as such)
  | "EOD" // end-of-day data (e.g. NSE FII/DII), not intraday
  | "UNAVAILABLE"; // no source exists in the FYERS retail API — shown honestly as blank

/** Lifecycle of the live data feed. */
export type DataStatus =
  | "disconnected" // not logged in to FYERS
  | "loading" // first fetch in flight
  | "live" // fresh data flowing
  | "stale" // last fetch failed; showing previous snapshot
  | "closed" // connected, but market shut / chain empty
  | "error"; // hard error with no usable snapshot

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

export type InstrumentId = "NIFTY" | "BANKNIFTY";

export interface InstrumentConfig {
  id: InstrumentId;
  label: string;
  /** FYERS underlying symbol, e.g. "NSE:NIFTY50-INDEX". */
  underlying: string;
  /** Option contract multiplier (lot size). */
  lotSize: number;
  /** Strike spacing on the chain. */
  strikeInterval: number;
  /** IST weekday of weekly expiry (0=Sun … 6=Sat). NIFTY = Thursday(4). */
  expiryWeekday: number;
  /** Fallback annualized IV (decimal) when a per-strike solve fails (rare). */
  fallbackIv: number;
}

// ---------------------------------------------------------------------------
// Greeks
// ---------------------------------------------------------------------------

/** First- and second-order Greeks for a single option, all COMPUTED via Black-Scholes. */
export interface Greeks {
  delta: number;
  gamma: number;
  /** Theta per calendar day (₹ premium decay/day), not per year. */
  theta: number;
  /** Vega per 1 percentage-point (1 vol point) change in IV. */
  vega: number;
  /** Rho per 1 percentage-point change in the risk-free rate. */
  rho: number;
  // Second-order / higher-order
  vanna: number; // ∂delta/∂vol
  vomma: number; // ∂vega/∂vol
  charm: number; // ∂delta/∂time (per day)
  speed: number; // ∂gamma/∂spot
  color: number; // ∂gamma/∂time (per day)
  lambda: number; // elasticity = delta * spot / price (a.k.a. leverage / omega)
}

// ---------------------------------------------------------------------------
// Option chain
// ---------------------------------------------------------------------------

export type OptionType = "CE" | "PE";

/** OI build-up classification from price + OI deltas. */
export type OiBuildup =
  | "LONG_BUILDUP" // price up, OI up
  | "SHORT_BUILDUP" // price down, OI up
  | "LONG_UNWINDING" // price down, OI down
  | "SHORT_COVERING" // price up, OI down
  | "NEUTRAL";

/** One side (CE or PE) of a strike, broker fields + computed Greeks/IV. */
export interface OptionQuote {
  type: OptionType;
  /** FYERS trading symbol for order placement, e.g. "NSE:NIFTY25JAN24500CE". */
  symbol: string;
  strike: number;
  // --- BROKER fields ---
  ltp: number;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  volume: number;
  oi: number;
  oiChange: number;
  oiChangePct: number;
  prevOi: number;
  ltpChange: number;
  ltpChangePct: number;
  /** Last traded time (epoch ms) if the feed provides it, else 0. */
  ltt: number;
  // --- COMPUTED fields ---
  /** Implied volatility (decimal, e.g. 0.14), solved from the mid price. 0 if unsolvable. */
  iv: number;
  greeks: Greeks;
  intrinsic: number;
  extrinsic: number; // a.k.a. time value
  buildup: OiBuildup;
  /** True when the broker payload lacked enough data to price this leg. */
  hasData: boolean;
}

/** A full strike row: CE + PE side by side. */
export interface StrikeRow {
  strike: number;
  ce: OptionQuote;
  pe: OptionQuote;
  isAtm: boolean;
  /** Signed distance from ATM in strike steps (negative = ITM call side). */
  stepsFromAtm: number;
}

export interface ExpiryInfo {
  /** Epoch ms of expiry settlement (15:30 IST). */
  ms: number;
  label: string; // e.g. "30 Jan 2026"
  type: "WEEKLY" | "MONTHLY";
  daysRemaining: number;
  /** Years to expiry (for Black-Scholes), floored so √T never collapses. */
  t: number;
  /** Raw value FYERS expects when re-querying this expiry, if any. */
  raw?: string | number;
}

export interface IndiaVix {
  value: number;
  change: number;
  changePercent: number;
}

/** The fully-enriched chain shared to every panel via context. */
export interface EnrichedChain {
  instrument: InstrumentConfig;
  spot: number;
  atmStrike: number;
  rows: StrikeRow[];
  /** All expiries the broker lists for this instrument. */
  expiries: ExpiryInfo[];
  /** The expiry these rows belong to. */
  selectedExpiry: ExpiryInfo | null;
  vix: IndiaVix | null;
  // Aggregate analytics (computed)
  pcr: number;
  maxPain: number;
  totalCeOi: number;
  totalPeOi: number;
  totalCeVolume: number;
  totalPeVolume: number;
  /** Risk-free rate used for pricing (decimal). */
  riskFreeRate: number;
  asOf: number; // epoch ms of this snapshot
}

// ---------------------------------------------------------------------------
// Positions (from broker)
// ---------------------------------------------------------------------------

export interface PositionRow {
  symbol: string;
  netQty: number;
  side: "LONG" | "SHORT" | "FLAT";
  avgPrice: number;
  ltp: number;
  pnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  productType: string;
  /** Parsed option metadata when the symbol is an option, else null. */
  option: ParsedOptionSymbol | null;
}

export interface ParsedOptionSymbol {
  underlying: string;
  strike: number;
  optionType: OptionType;
  expiryLabel: string;
}

// ---------------------------------------------------------------------------
// Strategy builder / payoff
// ---------------------------------------------------------------------------

export type LegAction = "BUY" | "SELL";
export type LegInstrument = "CE" | "PE" | "FUT";

export interface StrategyLeg {
  id: string;
  action: LegAction;
  instrument: LegInstrument;
  strike: number; // ignored for FUT
  /** Lots (multiplied by instrument lotSize for absolute qty). */
  lots: number;
  /** Premium per unit at which the leg is taken (debit if BUY, credit if SELL). */
  price: number;
  /** IV (decimal) used to mark this leg for future-date P/L. */
  iv: number;
  expiryMs: number;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  category: "BULLISH" | "BEARISH" | "NEUTRAL" | "VOLATILITY" | "INCOME" | "SYNTHETIC" | "ARBITRAGE";
  description: string;
  /** Directional outlook tag for the UI. */
  outlook: string;
  /** Builds legs given the ATM strike + strike interval + a reference IV/expiry. */
  build: (ctx: StrategyBuildContext) => StrategyLeg[];
}

export interface StrategyBuildContext {
  atmStrike: number;
  strikeInterval: number;
  /** Near (selected) expiry. */
  expiryMs: number;
  /** Next expiry out, for calendars/diagonals. Falls back to expiryMs when only one exists. */
  farExpiryMs: number;
  /** Function to read a live premium for a given strike+type, if available. */
  priceAt: (type: LegInstrument, strike: number) => number;
  /** Function to read live IV for a given strike+type. */
  ivAt: (type: LegInstrument, strike: number) => number;
}

export interface PayoffPoint {
  spot: number;
  /** P/L at expiry for this terminal spot. */
  expiryPnl: number;
  /** P/L today (mark-to-model using current T and IV). */
  todayPnl: number;
}

export interface PayoffResult {
  points: PayoffPoint[];
  maxProfit: number; // Infinity when unbounded
  maxLoss: number; // -Infinity when unbounded
  breakevens: number[];
  /** Net debit (>0 paid) or credit (<0 received). */
  netPremium: number;
  /** Aggregate position Greeks. */
  greeks: Greeks;
  /** Probability of profit (0..1), from the lognormal terminal distribution. */
  probOfProfit: number;
  /** Expected value of the payoff under the risk-neutral-ish lognormal model. */
  expectedValue: number;
  riskReward: number; // |maxProfit / maxLoss|, 0 if either is unbounded
  marginEstimate: number; // local SPAN-style estimate (₹)
}

// ---------------------------------------------------------------------------
// Alerts / watchlist (persisted locally)
// ---------------------------------------------------------------------------

export type AlertMetric = "PRICE" | "IV" | "OI" | "DELTA" | "PCR" | "VOLUME" | "PREMIUM";
export type AlertOp = ">" | "<" | ">=" | "<=";

export interface OptionAlert {
  id: string;
  instrument: InstrumentId;
  symbol?: string; // specific option symbol when applicable
  metric: AlertMetric;
  op: AlertOp;
  threshold: number;
  note?: string;
  createdAt: number;
  triggeredAt?: number;
  active: boolean;
}

export interface WatchItem {
  id: string;
  kind: "STRIKE" | "EXPIRY" | "STRATEGY" | "CONTRACT";
  instrument: InstrumentId;
  label: string;
  symbol?: string;
  strike?: number;
  payload?: unknown; // serialized strategy legs when kind === STRATEGY
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Trade ticket
// ---------------------------------------------------------------------------

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "SL" | "SL-M";
export type ProductType = "INTRADAY" | "MARGIN" | "CNC";

export interface OrderDraft {
  symbol: string;
  side: OrderSide;
  qty: number; // absolute quantity (lots * lotSize)
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  productType: ProductType;
  validity: "DAY" | "IOC";
}
