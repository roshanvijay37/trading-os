/**
 * Parse FYERS net positions into typed rows and match them to live chain Greeks.
 * Matching is done by exact broker symbol (robust), with a regex fallback for metadata
 * on positions outside the current chain/expiry.
 */

import type { EnrichedChain, Greeks, ParsedOptionSymbol, PositionRow } from "../types";

type Raw = Record<string, unknown>;

function num(v: unknown): number {
  const x = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Best-effort parse of a FYERS option symbol like "NSE:NIFTY2561226500CE". */
export function parseOptionSymbol(symbol: string): ParsedOptionSymbol | null {
  if (!symbol) return null;
  const m = /(\d+)(CE|PE)$/.exec(symbol);
  if (!m) return null;
  const strike = parseInt(m[1], 10);
  const u = /:([A-Z]+)/.exec(symbol);
  return {
    underlying: u ? u[1] : symbol,
    strike: Number.isFinite(strike) ? strike : 0,
    optionType: m[2] as "CE" | "PE",
    expiryLabel: "",
  };
}

export function parsePositions(raw: unknown): PositionRow[] {
  const list = Array.isArray(raw) ? (raw as Raw[]) : [];
  const out: PositionRow[] = [];
  for (const p of list) {
    const netQty = num(p.netQty ?? p.qty ?? p.netQuantity);
    const symbol = String(p.symbol ?? p.fyToken ?? "");
    const side: PositionRow["side"] = netQty > 0 ? "LONG" : netQty < 0 ? "SHORT" : "FLAT";
    out.push({
      symbol,
      netQty,
      side,
      avgPrice: num(p.netAvg ?? p.avgPrice ?? p.buyAvg ?? p.sellAvg),
      ltp: num(p.ltp ?? p.lp),
      pnl: num(p.pl ?? p.pnl ?? p.profitLoss),
      realizedPnl: num(p.realized_profit ?? p.realizedPnl ?? p.realized),
      unrealizedPnl: num(p.unrealized_profit ?? p.unrealizedPnl ?? p.unrealized),
      productType: String(p.productType ?? p.product ?? ""),
      option: parseOptionSymbol(symbol),
    });
  }
  return out;
}

const ZERO_GREEKS: Greeks = {
  delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0,
  vanna: 0, vomma: 0, charm: 0, speed: 0, color: 0, lambda: 0,
};

export interface PositionGreeks {
  position: PositionRow;
  /** Per-unit Greeks from the matched chain quote (0s if unmatched). */
  unitGreeks: Greeks;
  /** Position-weighted Greeks = unit × netQty (sign carries direction). */
  netGreeks: Greeks;
  iv: number;
  matched: boolean;
}

/** Match each position to a live chain quote by symbol and scale Greeks by net quantity. */
export function positionGreeks(positions: PositionRow[], chain: EnrichedChain | null): PositionGreeks[] {
  const bySymbol = new Map<string, { iv: number; greeks: Greeks }>();
  if (chain) {
    for (const row of chain.rows) {
      if (row.ce.symbol) bySymbol.set(row.ce.symbol, { iv: row.ce.iv, greeks: row.ce.greeks });
      if (row.pe.symbol) bySymbol.set(row.pe.symbol, { iv: row.pe.iv, greeks: row.pe.greeks });
    }
  }
  return positions.map((position) => {
    const match = bySymbol.get(position.symbol);
    const unitGreeks = match?.greeks ?? { ...ZERO_GREEKS };
    const qty = position.netQty;
    const netGreeks: Greeks = {
      delta: unitGreeks.delta * qty,
      gamma: unitGreeks.gamma * qty,
      theta: unitGreeks.theta * qty,
      vega: unitGreeks.vega * qty,
      rho: unitGreeks.rho * qty,
      vanna: unitGreeks.vanna * qty,
      vomma: unitGreeks.vomma * qty,
      charm: unitGreeks.charm * qty,
      speed: unitGreeks.speed * qty,
      color: unitGreeks.color * qty,
      lambda: 0,
    };
    return { position, unitGreeks, netGreeks, iv: match?.iv ?? 0, matched: !!match };
  });
}

/** Sum net Greeks across a position book (portfolio Greeks). */
export function aggregateGreeks(items: PositionGreeks[]): Greeks {
  const total: Greeks = { ...ZERO_GREEKS };
  for (const it of items) {
    total.delta += it.netGreeks.delta;
    total.gamma += it.netGreeks.gamma;
    total.theta += it.netGreeks.theta;
    total.vega += it.netGreeks.vega;
    total.rho += it.netGreeks.rho;
    total.vanna += it.netGreeks.vanna;
    total.vomma += it.netGreeks.vomma;
    total.charm += it.netGreeks.charm;
    total.speed += it.netGreeks.speed;
    total.color += it.netGreeks.color;
  }
  return total;
}
