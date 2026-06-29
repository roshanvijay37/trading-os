/**
 * Option screener: flatten the live chain into scannable contract rows and apply
 * preset scans (highest IV, OI, volume, Greeks, moneyness, momentum). All from live data.
 */

import type { EnrichedChain, OptionQuote, StrikeRow } from "../types";

export interface ScreenerRow {
  symbol: string;
  strike: number;
  type: "CE" | "PE";
  moneyness: "ITM" | "ATM" | "OTM";
  ltp: number;
  iv: number;
  oi: number;
  oiChange: number;
  volume: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  ltpChangePct: number;
  quote: OptionQuote;
}

export type ScanId =
  | "highest-iv"
  | "lowest-iv"
  | "highest-oi"
  | "highest-volume"
  | "highest-delta"
  | "highest-gamma"
  | "highest-theta"
  | "highest-vega"
  | "atm"
  | "itm"
  | "otm"
  | "momentum";

export interface ScanDef {
  id: ScanId;
  label: string;
  description: string;
}

export const SCANS: ScanDef[] = [
  { id: "highest-iv", label: "Highest IV", description: "Richest implied volatility" },
  { id: "lowest-iv", label: "Lowest IV", description: "Cheapest implied volatility" },
  { id: "highest-oi", label: "Highest OI", description: "Most open interest" },
  { id: "highest-volume", label: "Highest Volume", description: "Most active today" },
  { id: "highest-delta", label: "Highest Delta", description: "Most directional" },
  { id: "highest-gamma", label: "Highest Gamma", description: "Most convex (near ATM)" },
  { id: "highest-theta", label: "Highest Theta", description: "Fastest decay (writers)" },
  { id: "highest-vega", label: "Highest Vega", description: "Most vol-sensitive" },
  { id: "atm", label: "ATM", description: "At-the-money contracts" },
  { id: "itm", label: "ITM", description: "In-the-money contracts" },
  { id: "otm", label: "OTM", description: "Out-of-the-money contracts" },
  { id: "momentum", label: "Momentum", description: "Biggest premium movers with OI build-up" },
];

function moneyness(row: StrikeRow, type: "CE" | "PE", spot: number, interval: number): "ITM" | "ATM" | "OTM" {
  if (Math.abs(row.strike - spot) <= interval / 2) return "ATM";
  if (type === "CE") return row.strike < spot ? "ITM" : "OTM";
  return row.strike > spot ? "ITM" : "OTM";
}

export function flattenChain(chain: EnrichedChain): ScreenerRow[] {
  const out: ScreenerRow[] = [];
  const interval = chain.instrument.strikeInterval;
  for (const row of chain.rows) {
    for (const type of ["CE", "PE"] as const) {
      const q = type === "CE" ? row.ce : row.pe;
      if (!q.hasData) continue;
      out.push({
        symbol: q.symbol,
        strike: row.strike,
        type,
        moneyness: moneyness(row, type, chain.spot, interval),
        ltp: q.ltp,
        iv: q.iv,
        oi: q.oi,
        oiChange: q.oiChange,
        volume: q.volume,
        delta: q.greeks.delta,
        gamma: q.greeks.gamma,
        theta: q.greeks.theta,
        vega: q.greeks.vega,
        ltpChangePct: q.ltpChangePct,
        quote: q,
      });
    }
  }
  return out;
}

export function runScan(chain: EnrichedChain, scan: ScanId, limit = 25): ScreenerRow[] {
  let rows = flattenChain(chain);
  switch (scan) {
    case "highest-iv": rows = rows.filter((r) => r.iv > 0).sort((a, b) => b.iv - a.iv); break;
    case "lowest-iv": rows = rows.filter((r) => r.iv > 0).sort((a, b) => a.iv - b.iv); break;
    case "highest-oi": rows = rows.sort((a, b) => b.oi - a.oi); break;
    case "highest-volume": rows = rows.sort((a, b) => b.volume - a.volume); break;
    case "highest-delta": rows = rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)); break;
    case "highest-gamma": rows = rows.sort((a, b) => b.gamma - a.gamma); break;
    case "highest-theta": rows = rows.sort((a, b) => Math.abs(b.theta) - Math.abs(a.theta)); break;
    case "highest-vega": rows = rows.sort((a, b) => b.vega - a.vega); break;
    case "atm": rows = rows.filter((r) => r.moneyness === "ATM").sort((a, b) => b.oi - a.oi); break;
    case "itm": rows = rows.filter((r) => r.moneyness === "ITM").sort((a, b) => b.oi - a.oi); break;
    case "otm": rows = rows.filter((r) => r.moneyness === "OTM").sort((a, b) => b.oi - a.oi); break;
    case "momentum":
      rows = rows
        .filter((r) => r.oiChange > 0 && Math.abs(r.ltpChangePct) > 1)
        .sort((a, b) => Math.abs(b.ltpChangePct) - Math.abs(a.ltpChangePct));
      break;
  }
  return rows.slice(0, limit);
}
