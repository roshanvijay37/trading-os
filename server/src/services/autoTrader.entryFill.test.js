import { describe, it, expect } from "vitest";
import { checkEntryOrderFill, cancelPendingEntryOrder } from "./autoTrader.js";

// checkEntryOrderFill is the ONLY paper/live branch point in the unified EMA5T resting-entry
// lifecycle (see manageFuturesPending's doc comment) — everything else in that lifecycle runs
// identically for both modes. These tests cover its PAPER branch and its network-free LIVE
// early-return (no entryOrderId yet), both of which are deterministic without a broker session.
describe("checkEntryOrderFill (paper branch — the exact resting-order fill simulation)", () => {
  const latestCandle = [1_700_000_000, 55000, 55200, 54900, 55050, 1000]; // [ts, o, h, l, c, v]

  it("is PENDING when a LONG resting level has not been crossed by the candle's high", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, dir: "LONG", level: 55300, latestCandle, qty: 30 });
    expect(result.status).toBe("PENDING");
    expect(result.filledQty).toBe(0);
  });

  it("FILLS a LONG when the candle's high crosses the resting level, with upward slippage", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, dir: "LONG", level: 55100, latestCandle, qty: 30 });
    expect(result.status).toBe("FILLED");
    expect(result.filledQty).toBe(30);
    expect(result.avgFillPrice).toBeCloseTo(55100 * 1.0005, 5);
  });

  it("FILLS a SHORT when the candle's low crosses the resting level, with downward slippage", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, dir: "SHORT", level: 54950, latestCandle, qty: 30 });
    expect(result.status).toBe("FILLED");
    expect(result.avgFillPrice).toBeCloseTo(54950 * 0.9995, 5);
  });

  it("is PENDING when a SHORT resting level has not been crossed by the candle's low", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, dir: "SHORT", level: 54800, latestCandle, qty: 30 });
    expect(result.status).toBe("PENDING");
  });

  it("LIVE mode with no entryOrderId yet (gated out at placement time) is PENDING without any network call", async () => {
    const result = await checkEntryOrderFill({ paperTrading: false, entryOrderId: null, dir: "LONG", level: 55100, latestCandle, qty: 30 });
    expect(result.status).toBe("PENDING");
    expect(result.filledQty).toBe(0);
  });
});

describe("cancelPendingEntryOrder (network-free paths)", () => {
  it("no-ops for a record with no entryOrderId (never actually placed)", async () => {
    const result = await cancelPendingEntryOrder({ key: "X", entryOrderId: null }, false, {});
    expect(result.ok).toBe(true);
  });

  it("no-ops for a paper record even with an entryOrderId set (nothing at a real broker to cancel)", async () => {
    const result = await cancelPendingEntryOrder({ key: "X", entryOrderId: "PAPER-STOP-1" }, true, {});
    expect(result.ok).toBe(true);
  });
});
