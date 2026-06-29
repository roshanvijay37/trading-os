/**
 * Build a fully-enriched option chain from the raw FYERS `options-chain-v3` payload.
 *
 * BROKER fields per strike (already in the payload): ltp, ltpch, ltpchp, bid, ask, volume,
 * oi, oich, oichp, prev_oi, option_type, strike_price, symbol.
 * COMPUTED here: implied volatility (solved from the mid price), all Greeks, intrinsic /
 * extrinsic value, and OI build-up classification. Aggregates (PCR, Max Pain) reuse the
 * existing, unit-tested `src/lib/optionMetrics` helpers — no duplicated math.
 */

import { computeMaxPain, computePCR, type OptionLeg } from "../../lib/optionMetrics";
import { computeGreeks, impliedVol, DEFAULT_R } from "./bs";
import { yearsToExpiry } from "./bs";
import type {
  EnrichedChain,
  ExpiryInfo,
  Greeks,
  IndiaVix,
  InstrumentConfig,
  OiBuildup,
  OptionQuote,
  OptionType,
  StrikeRow,
} from "../types";

type Raw = Record<string, unknown>;

function num(v: unknown): number {
  const x = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : 0;
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}

const ZERO_GREEKS: Greeks = {
  delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0,
  vanna: 0, vomma: 0, charm: 0, speed: 0, color: 0, lambda: 0,
};

function rowType(r: Raw): string {
  return str(r.option_type ?? r.optionType);
}

/** Mid price preferred (true two-sided market); LTP fallback when a side is missing. */
function midOf(bid: number, ask: number, ltp: number): number {
  if (bid > 0 && ask > 0 && ask >= bid) return (bid + ask) / 2;
  return ltp;
}

function classifyBuildup(ltpch: number, oich: number): OiBuildup {
  const priceUp = ltpch > 0;
  const priceDown = ltpch < 0;
  const oiUp = oich > 0;
  const oiDown = oich < 0;
  if (priceUp && oiUp) return "LONG_BUILDUP";
  if (priceDown && oiUp) return "SHORT_BUILDUP";
  if (priceDown && oiDown) return "LONG_UNWINDING";
  if (priceUp && oiDown) return "SHORT_COVERING";
  return "NEUTRAL";
}

function buildQuote(
  r: Raw,
  type: OptionType,
  spot: number,
  t: number,
  r_: number,
): OptionQuote {
  const strike = num(r.strike_price ?? r.strikePrice ?? r.strike);
  const ltp = num(r.ltp ?? r.lp);
  const bid = num(r.bid ?? r.bid_price ?? r.bidPrice);
  const ask = num(r.ask ?? r.ask_price ?? r.askPrice);
  const volume = num(r.volume ?? r.vol ?? r.v ?? r.tot_traded_qty);
  const oi = num(r.oi ?? r.openInterest);
  const prevOi = num(r.prev_oi ?? r.previousOi);
  const oiChange = num(r.oich ?? r.oiChange ?? r.oi_change) || (prevOi > 0 ? oi - prevOi : 0);
  const oiChangePct = num(r.oichp ?? r.oiChangePct) || (prevOi > 0 ? ((oi - prevOi) / prevOi) * 100 : 0);
  const ltpChange = num(r.ltpch ?? r.ch);
  const ltpChangePct = num(r.ltpchp ?? r.chp);
  const ltt = num(r.last_traded_time ?? r.ltt ?? r.tt);

  const mid = midOf(bid, ask, ltp);
  const intrinsic = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const extrinsic = Math.max(0, ltp - intrinsic);

  const hasData = strike > 0 && (ltp > 0 || oi > 0);
  const iv = mid > 0 && t > 0 ? impliedVol(type, mid, spot, strike, t, r_) : 0;
  const greeks: Greeks =
    iv > 0 ? computeGreeks({ type, spot, strike, t, r: r_, sigma: iv }, ltp) : { ...ZERO_GREEKS };

  return {
    type,
    symbol: str(r.symbol ?? r.tradingSymbol ?? r.ts),
    strike,
    ltp,
    bid,
    ask,
    bidQty: num(r.bid_qty ?? r.bidQty ?? r.bid_size),
    askQty: num(r.ask_qty ?? r.askQty ?? r.ask_size),
    volume,
    oi,
    oiChange,
    oiChangePct,
    prevOi,
    ltpChange,
    ltpChangePct,
    ltt: ltt > 1e12 ? ltt : ltt > 0 ? ltt * 1000 : 0,
    iv,
    greeks,
    intrinsic,
    extrinsic,
    buildup: classifyBuildup(ltpChange, oiChange),
    hasData,
  };
}

function emptyQuote(type: OptionType, strike: number): OptionQuote {
  return {
    type, symbol: "", strike, ltp: 0, bid: 0, ask: 0, bidQty: 0, askQty: 0, volume: 0,
    oi: 0, oiChange: 0, oiChangePct: 0, prevOi: 0, ltpChange: 0, ltpChangePct: 0, ltt: 0,
    iv: 0, greeks: { ...ZERO_GREEKS }, intrinsic: 0, extrinsic: 0, buildup: "NEUTRAL", hasData: false,
  };
}

/** Spot from the chain's non-option row (FYERS includes the underlying with ltp = spot). */
export function extractSpotFromRows(rows: Raw[]): number {
  for (const r of rows) {
    const ty = rowType(r);
    if (ty !== "CE" && ty !== "PE") {
      const ltp = num(r.ltp ?? r.lp);
      if (ltp > 0) return ltp;
    }
  }
  return 0;
}

export function extractVix(raw: unknown): IndiaVix | null {
  if (raw == null) return null;
  if (typeof raw === "number" || typeof raw === "string") {
    const v = num(raw);
    return v > 0 ? { value: v, change: 0, changePercent: 0 } : null;
  }
  if (typeof raw === "object") {
    const r = raw as Raw;
    const value = num(r.ltp ?? r.lp ?? r.value ?? r.vix);
    if (!(value > 0)) return null;
    return {
      value,
      change: num(r.ltpch ?? r.ch ?? r.change),
      changePercent: num(r.ltpchp ?? r.chp ?? r.changePercent),
    };
  }
  return null;
}

/** Parse FYERS `expiryData` ([{ date, expiry }]) into typed, dated expiry descriptors. */
export function parseExpiries(expiryData: unknown, nowMs: number): ExpiryInfo[] {
  const rows = Array.isArray(expiryData) ? (expiryData as Raw[]) : [];
  const out: ExpiryInfo[] = [];
  for (const row of rows) {
    const rawExp = row.expiry ?? row.date ?? row.ts;
    const n = num(rawExp);
    if (n <= 0) continue;
    const ms = n < 1e12 ? n * 1000 : n;
    const dExp = new Date(ms);
    const daysRemaining = Math.max(0, Math.ceil((ms - nowMs) / (24 * 3600 * 1000)));
    out.push({
      ms,
      label: dExp.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      type: "WEEKLY", // refined below
      daysRemaining,
      t: yearsToExpiry(ms, nowMs),
      raw: typeof rawExp === "number" || typeof rawExp === "string" ? rawExp : undefined,
    });
  }
  out.sort((a, b) => a.ms - b.ms);
  // Monthly = the last expiry within each calendar month.
  for (let i = 0; i < out.length; i++) {
    const cur = new Date(out[i].ms);
    const next = out[i + 1] ? new Date(out[i + 1].ms) : null;
    const isLastOfMonth = !next || next.getMonth() !== cur.getMonth() || next.getFullYear() !== cur.getFullYear();
    out[i].type = isLastOfMonth ? "MONTHLY" : "WEEKLY";
  }
  return out;
}

export interface BuildChainArgs {
  instrument: InstrumentConfig;
  rawChain: unknown;
  expiryData: unknown;
  vixRaw: unknown;
  /** Expiry these rows belong to (the one we requested). Falls back to nearest. */
  selectedExpiryMs: number | null;
  nowMs: number;
  riskFreeRate?: number;
}

/** Assemble the EnrichedChain consumed by every panel. */
export function buildEnrichedChain(args: BuildChainArgs): EnrichedChain {
  const { instrument, rawChain, expiryData, vixRaw, selectedExpiryMs, nowMs } = args;
  const r_ = args.riskFreeRate ?? DEFAULT_R;
  const rows = Array.isArray(rawChain) ? (rawChain as Raw[]) : [];

  const spot = extractSpotFromRows(rows);
  const expiries = parseExpiries(expiryData, nowMs);
  const selectedExpiry =
    expiries.find((e) => e.ms === selectedExpiryMs) ?? expiries[0] ?? null;
  const t = selectedExpiry?.t ?? 0;

  // Group CE/PE by strike.
  const byStrike = new Map<number, { ce?: OptionQuote; pe?: OptionQuote }>();
  const legsForAgg: OptionLeg[] = [];
  for (const row of rows) {
    const ty = rowType(row);
    if (ty !== "CE" && ty !== "PE") continue;
    const strike = num(row.strike_price ?? row.strikePrice ?? row.strike);
    if (strike <= 0) continue;
    const q = buildQuote(row, ty as OptionType, spot, t, r_);
    const slot = byStrike.get(strike) ?? {};
    if (ty === "CE") slot.ce = q;
    else slot.pe = q;
    byStrike.set(strike, slot);
    legsForAgg.push({ type: ty as OptionType, strike, oi: q.oi, ltp: q.ltp });
  }

  const strikes = Array.from(byStrike.keys()).sort((a, b) => a - b);
  // ATM = listed strike closest to spot.
  let atmStrike = strikes[0] ?? 0;
  for (const k of strikes) if (Math.abs(k - spot) < Math.abs(atmStrike - spot)) atmStrike = k;

  const interval = instrument.strikeInterval || 50;
  const chainRows: StrikeRow[] = strikes.map((strike) => {
    const slot = byStrike.get(strike)!;
    return {
      strike,
      ce: slot.ce ?? emptyQuote("CE", strike),
      pe: slot.pe ?? emptyQuote("PE", strike),
      isAtm: strike === atmStrike,
      stepsFromAtm: Math.round((strike - atmStrike) / interval),
    };
  });

  let totalCeOi = 0, totalPeOi = 0, totalCeVolume = 0, totalPeVolume = 0;
  for (const row of chainRows) {
    totalCeOi += row.ce.oi;
    totalPeOi += row.pe.oi;
    totalCeVolume += row.ce.volume;
    totalPeVolume += row.pe.volume;
  }

  return {
    instrument,
    spot,
    atmStrike,
    rows: chainRows,
    expiries,
    selectedExpiry,
    vix: extractVix(vixRaw),
    pcr: computePCR(legsForAgg),
    maxPain: computeMaxPain(legsForAgg),
    totalCeOi,
    totalPeOi,
    totalCeVolume,
    totalPeVolume,
    riskFreeRate: r_,
    asOf: nowMs,
  };
}
