import { describe, it, expect } from "vitest";
import {
  computeEquityQty,
  paperStopFillCheck,
  orderSideFor,
  sanitizeEquityConfigUpdates,
  computeGapAdjustedTarget,
  dropInProgressCandle,
  mergeSavedScrips,
  MIS_PROFILE,
} from "./equityTrader.js";

describe("computeEquityQty — ₹risk-per-trade sizing with MIS leverage cap", () => {
  it("risk-binding case: qty = floor(risk / stopDistance)", () => {
    // ADANIENT-ish: entry 2400, stop 2376 (24 pts) → 2000/24 = 83.3 → 83; margin 83*2400/4 ≈ 49.8k ≤ 50k
    const r = computeEquityQty({ entryLevel: 2400, stopLoss: 2376, riskPerTrade: 2000, perScripCapital: 50000, leverage: 4 });
    expect(r.qty).toBe(83);
    expect(r.riskAtEntry).toBeCloseTo(83 * 24, 6);
    expect(r.marginReq).toBeCloseTo((83 * 2400) / 4, 6);
  });

  it("margin-binding case: tight stop wants more qty than ₹50k×4 notional allows", () => {
    // entry 2400, stop 2398 (2 pts) → byRisk 1000, byMargin floor(200000/2400)=83 → 83
    const r = computeEquityQty({ entryLevel: 2400, stopLoss: 2398, riskPerTrade: 2000, perScripCapital: 50000, leverage: 4 });
    expect(r.qty).toBe(83);
  });

  it("qty 0 when the stop distance alone exceeds the risk budget (skip, never round up)", () => {
    // entry 900, stop 850 (50 pts) with ₹40 risk → 0
    const r = computeEquityQty({ entryLevel: 900, stopLoss: 850, riskPerTrade: 40, perScripCapital: 50000, leverage: 4 });
    expect(r.qty).toBe(0);
  });

  it("degenerate inputs (zero stop distance / bad entry) → qty 0", () => {
    expect(computeEquityQty({ entryLevel: 100, stopLoss: 100, riskPerTrade: 2000, perScripCapital: 50000, leverage: 4 }).qty).toBe(0);
    expect(computeEquityQty({ entryLevel: 0, stopLoss: -5, riskPerTrade: 2000, perScripCapital: 50000, leverage: 4 }).qty).toBe(0);
  });
});

describe("paperStopFillCheck — engine-parity resting stop semantics (strict cross, engine slippage)", () => {
  const bar = (o, h, l, c) => [1720000000, o, h, l, c, 1000];

  it("LONG fills when the bar's high crosses the level, at level + 0.02% slip (engine default)", () => {
    const f = paperStopFillCheck({ dir: "LONG", level: 1000, latestCandle: bar(990, 1005, 985, 1002), qty: 80 });
    expect(f.status).toBe("FILLED");
    expect(f.avgFillPrice).toBeCloseTo(1000 * 1.0002, 6);
    expect(f.filledQty).toBe(80);
  });

  it("no cross → stays PENDING", () => {
    const f = paperStopFillCheck({ dir: "LONG", level: 1000, latestCandle: bar(990, 998, 985, 996), qty: 80 });
    expect(f.status).toBe("PENDING");
  });

  it("exact-touch is NOT a fill — the validated engine enters only on a STRICT break (high > level)", () => {
    const f = paperStopFillCheck({ dir: "LONG", level: 1000, latestCandle: bar(990, 1000, 985, 996), qty: 80 });
    expect(f.status).toBe("PENDING");
    const s = paperStopFillCheck({ dir: "SHORT", level: 950, latestCandle: bar(960, 962, 950, 955), qty: 100 });
    expect(s.status).toBe("PENDING");
  });

  it("gap-through: bar OPENS beyond the level → fills at the open (gap risk honored)", () => {
    const f = paperStopFillCheck({ dir: "LONG", level: 1000, latestCandle: bar(1010, 1015, 1005, 1012), qty: 80 });
    expect(f.avgFillPrice).toBeCloseTo(1010 * 1.0002, 6);
  });

  it("SHORT mirrors: low crosses the level, fill at level − slip", () => {
    const f = paperStopFillCheck({ dir: "SHORT", level: 950, latestCandle: bar(960, 962, 945, 948), qty: 100 });
    expect(f.status).toBe("FILLED");
    expect(f.avgFillPrice).toBeCloseTo(950 * 0.9998, 6);
  });
});

describe("orderSideFor / computeGapAdjustedTarget / dropInProgressCandle (copied pure helpers)", () => {
  it("side mapping matches the futures bot's", () => {
    expect(orderSideFor("LONG", "ENTRY")).toBe(1);
    expect(orderSideFor("LONG", "EXIT")).toBe(-1);
    expect(orderSideFor("SHORT", "ENTRY")).toBe(-1);
    expect(orderSideFor("SHORT", "EXIT")).toBe(1);
    expect(() => orderSideFor("SIDEWAYS", "ENTRY")).toThrow();
  });

  it("gap-adjusted 3R target scales with the real fill", () => {
    expect(computeGapAdjustedTarget("LONG", 1010, 990, 3)).toBeCloseTo(1010 + 60, 6);
    expect(computeGapAdjustedTarget("SHORT", 940, 960, 3)).toBeCloseTo(940 - 60, 6);
  });

  it("drops a 60m bar whose period hasn't elapsed", () => {
    const now = 1720000000;
    const done = [now - 7200, 1, 2, 0.5, 1.5, 10];
    const inProg = [now - 1800, 1, 2, 0.5, 1.5, 10]; // started 30 min ago, 60m bar → in progress
    expect(dropInProgressCandle([done, inProg], 60, now)).toEqual([done]);
    expect(dropInProgressCandle([done], 60, now)).toEqual([done]);
  });
});

describe("sanitizeEquityConfigUpdates", () => {
  it("bounds-checks numerics and drops invalid", () => {
    const { clean, rejected } = sanitizeEquityConfigUpdates({ riskPerTrade: 2500, leverage: 9, trendEmaPeriod: 12.5 });
    expect(clean.riskPerTrade).toBe(2500);
    expect(rejected.map((r) => r.key).sort()).toEqual(["leverage", "trendEmaPeriod"]);
  });

  it("paperTrading must be a real boolean", () => {
    expect(sanitizeEquityConfigUpdates({ paperTrading: false }).clean.paperTrading).toBe(false);
    expect(sanitizeEquityConfigUpdates({ paperTrading: 0 }).rejected).toHaveLength(1);
  });

  it("scripEnabled keeps only known scrip names with boolean values", () => {
    const { clean } = sanitizeEquityConfigUpdates({ scripEnabled: { ADANIENT: false, FAKESCRIP: true, PAYTM: "yes" } });
    expect(clean.scripEnabled).toEqual({ ADANIENT: false });
  });
});

describe("mergeSavedScrips — deploys can extend the basket without old state hiding new scrips", () => {
  it("keeps the operator's enable/disable flags but never drops code-defined scrips", () => {
    const code = [
      { name: "ADANIENT", symbol: "NSE:ADANIENT-EQ", enabled: true },
      { name: "BSE", symbol: "NSE:BSE-EQ", enabled: true },
    ];
    mergeSavedScrips(code, [
      { name: "ADANIENT", enabled: false }, // operator had disabled it → preserved
      { name: "DELISTED", enabled: true }, // no longer in code → dropped
    ]);
    expect(code.map((s) => [s.name, s.enabled])).toEqual([
      ["ADANIENT", false],
      ["BSE", true],
    ]);
  });

  it("tolerates corrupt saved state (non-array, junk entries, non-boolean flags)", () => {
    const code = [{ name: "BSE", symbol: "NSE:BSE-EQ", enabled: true }];
    mergeSavedScrips(code, "corrupt");
    mergeSavedScrips(code, [null, { enabled: false }, { name: "BSE", enabled: "yes" }]);
    expect(code[0].enabled).toBe(true);
  });
});

describe("MIS_PROFILE — strict backtest parity (the engine defaults the validated runs used)", () => {
  it("entries 9:15–14:00, square-off 15:15 — exactly what the backtests simulated", () => {
    expect(MIS_PROFILE.sessionStartDecimal).toBe(9.25);
    expect(MIS_PROFILE.sessionEndDecimal).toBe(14.0);
    expect([MIS_PROFILE.squareOffHour, MIS_PROFILE.squareOffMinute]).toEqual([15, 15]);
  });
});
