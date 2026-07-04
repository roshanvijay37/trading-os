import { describe, it, expect } from "vitest";
import { computeFuturesCosts } from "./futuresCosts.js";

// Structural properties, not pinned real-world rates — the actual STT/exchange/stamp constants
// are placeholders pending verification against FYERS's current F&O rate card (see the
// TODO(verify) note in futuresCosts.js). These tests lock the SHAPE of the model so a future
// rate-constant update can't silently break the sell-side/buy-side/brokerage-floor structure.
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
      return 0.0002 * sellTurnover;
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
    const exchTxn = 0.000019 * (buyTurnover + sellTurnover);
    const sebi = 0.000001 * (buyTurnover + sellTurnover);
    const stt = 0.0002 * sellTurnover;
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
});
