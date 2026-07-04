import { describe, it, expect } from "vitest";
import { computeCommittedMargin } from "./autoTrader.js";

// EMA5T scans multiple timeframes per underlying independently and, once ALLOW_CORRELATED_TRADES
// is enabled, both Bank Nifty and Nifty can be open at once — up to 6 concurrent positions
// (2 underlyings x 3 timeframes). Each new signal's margin check must account for what's ALREADY
// committed, not just itself in isolation against the full capital figure.
describe("computeCommittedMargin", () => {
  it("sums marginAtEntry across multiple OPEN positions", () => {
    const positions = [
      { status: "OPEN", marginAtEntry: 180000 },
      { status: "OPEN", marginAtEntry: 150000 },
    ];
    expect(computeCommittedMargin(positions, new Map())).toBe(330000);
  });

  it("excludes CLOSED positions", () => {
    const positions = [
      { status: "OPEN", marginAtEntry: 180000 },
      { status: "CLOSED", marginAtEntry: 150000 },
    ];
    expect(computeCommittedMargin(positions, new Map())).toBe(180000);
  });

  it("includes a resting pending entry's marginEst ONLY once it has a live entryOrderId", () => {
    const pending = new Map([
      ["BANKNIFTY:EMA5T:15m", { entryOrderId: "ORD-1", marginEst: 180000 }],
      ["NIFTY:EMA5T:15m", { entryOrderId: null, marginEst: 150000 }], // not yet placed — not committed
    ]);
    expect(computeCommittedMargin([], pending)).toBe(180000);
  });

  it("sums open positions AND live pending entries together", () => {
    const positions = [{ status: "OPEN", marginAtEntry: 180000 }];
    const pending = new Map([["NIFTY:EMA5T:30m", { entryOrderId: "ORD-2", marginEst: 150000 }]]);
    expect(computeCommittedMargin(positions, pending)).toBe(330000);
  });

  it("treats missing/garbage inputs as zero committed margin", () => {
    expect(computeCommittedMargin([], new Map())).toBe(0);
    expect(computeCommittedMargin(undefined, undefined)).toBe(0);
    expect(computeCommittedMargin(null, null)).toBe(0);
  });

  it("treats a missing marginAtEntry/marginEst as zero rather than NaN", () => {
    const positions = [{ status: "OPEN" }];
    const pending = new Map([["X", { entryOrderId: "ORD-3" }]]);
    expect(computeCommittedMargin(positions, pending)).toBe(0);
  });
});
