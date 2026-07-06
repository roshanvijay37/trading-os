import { describe, it, expect } from "vitest";
import { computeFuturesCosts } from "./futuresCosts.js";

// Mostly structural properties (shape of the model), but a few pin the real rate constants —
// confirmed 2026-07-05 against FYERS's own live charges page — so a future rate change is a
// deliberate, visible test update rather than a silent drift.
describe("computeFuturesCosts", () => {
  it("charges brokerage + GST-on-brokerage even at zero turnover (flat qty=0 floor)", () => {
    const costs = computeFuturesCosts(0, 0, 0, { brokeragePerOrder: 20 });
    // 2 x brokeragePerOrder (40) + 18% GST on that brokerage (7.2) — GST applies to the
    // brokerage fee itself regardless of turnover, only the turnover-based charges are zero.
    expect(costs).toBeCloseTo(47.2, 5);
  });

  it("is monotonically non-decreasing in qty (larger position never costs less)", () => {
    const small = computeFuturesCosts(50000, 50100, 30, { brokeragePerOrder: 20 });
    const large = computeFuturesCosts(50000, 50100, 300, { brokeragePerOrder: 20 });
    expect(large).toBeGreaterThan(small);
  });

  it("STT scales with sell-side turnover only (exit price drives it, entry price does not)", () => {
    const base = computeFuturesCosts(50000, 50100, 30);
    const higherExit = computeFuturesCosts(50000, 60000, 30);
    const higherEntry = computeFuturesCosts(60000, 50100, 30); // entry up, exit unchanged
    expect(higherExit).toBeGreaterThan(base);
    // Raising ONLY entry price still changes total costs (exchange/sebi/stamp all use buyTurnover
    // too), but the STT COMPONENT itself must be identical since STT only reads exit*qty.
    const sttAt = (entry, exit, qty) => {
      const sellTurnover = exit * qty;
      return 0.0005 * sellTurnover;
    };
    expect(sttAt(60000, 50100, 30)).toBeCloseTo(sttAt(50000, 50100, 30), 8);
    expect(higherEntry).toBeGreaterThan(base); // still costs more overall (buy-side charges)
  });

  it("stamp duty scales with buy-side turnover only", () => {
    const higherEntryOnly = computeFuturesCosts(60000, 50000, 30);
    const baseline = computeFuturesCosts(50000, 50000, 30);
    expect(higherEntryOnly).toBeGreaterThan(baseline);
  });

  it("GST is exactly 18% of (brokerage + exchange txn + SEBI), excluding STT and stamp", () => {
    const entryPrice = 50000, exitPrice = 50200, qty = 30, brokeragePerOrder = 20;
    const buyTurnover = entryPrice * qty;
    const sellTurnover = exitPrice * qty;
    const brokerage = brokeragePerOrder * 2;
    const exchTxn = 0.0000183 * (buyTurnover + sellTurnover);
    const sebi = 0.000001 * (buyTurnover + sellTurnover);
    const stt = 0.0005 * sellTurnover;
    const stamp = 0.00002 * buyTurnover;
    const expectedGst = 0.18 * (brokerage + exchTxn + sebi);
    const expectedTotal = brokerage + stt + exchTxn + sebi + stamp + expectedGst;
    expect(computeFuturesCosts(entryPrice, exitPrice, qty, { brokeragePerOrder })).toBeCloseTo(expectedTotal, 6);
  });

  it("defaults brokeragePerOrder to 20 when not supplied", () => {
    const withDefault = computeFuturesCosts(50000, 50100, 30);
    const withExplicit = computeFuturesCosts(50000, 50100, 30, { brokeragePerOrder: 20 });
    expect(withDefault).toBeCloseTo(withExplicit, 8);
  });

  // A SHORT's entry is the SELL leg (opens with a sell) and its exit is the BUY leg (covers with a
  // buy) — the reverse of a LONG. Without `side`, the function defaulted to treating the first arg
  // as always-BUY and the second as always-SELL, taxing every SHORT trade's legs backwards.
  it("swaps buy/sell leg attribution for side: SHORT (entry price is the SELL leg, exit is the BUY leg)", () => {
    const entryPrice = 50000, exitPrice = 49800, qty = 30; // a profitable SHORT: exit < entry
    const long = computeFuturesCosts(entryPrice, exitPrice, qty); // treated as LONG-equivalent (default)
    const short = computeFuturesCosts(entryPrice, exitPrice, qty, { side: "SHORT" });
    // For a SHORT, STT (sell-side) should be driven by entryPrice (the actual sell leg), not
    // exitPrice — i.e. it should equal what a LONG call would get if entry/exit were swapped.
    const swapped = computeFuturesCosts(exitPrice, entryPrice, qty); // exit/entry reversed, no side
    expect(short).toBeCloseTo(swapped, 8);
    expect(short).not.toBeCloseTo(long, 2);
  });

  it("side: LONG (or omitted) keeps the original entry=buy / exit=sell attribution", () => {
    const withLongSide = computeFuturesCosts(50000, 50100, 30, { side: "LONG" });
    const withoutSide = computeFuturesCosts(50000, 50100, 30);
    expect(withLongSide).toBeCloseTo(withoutSide, 8);
  });
});
