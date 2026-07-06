import { describe, it, expect } from "vitest";
import { checkEntryOrderFill, cancelPendingEntryOrder } from "./autoTrader.js";

// checkEntryOrderFill is the ONLY paper/live branch point in the unified EMA5T resting-entry
// lifecycle (see manageFuturesPending's doc comment) — everything else in that lifecycle runs
// identically for both modes. These tests cover its PAPER branch and its network-free LIVE
// early-return (no entryOrderId yet), both of which are deterministic without a broker session.
describe("checkEntryOrderFill (paper branch — the exact resting-order fill simulation)", () => {
  const latestCandle = [1_700_000_000, 55000, 55200, 54900, 55050, 1000]; // [ts, o, h, l, c, v]
  // A real (paper-fabricated) order id — represents an entry that actually got past every gate
  // at arm time and was placed via placeStopEntry. Every "FILLS"/crossing test below needs this,
  // since checkEntryOrderFill now treats a missing entryOrderId as never-armed regardless of mode.
  const armedId = "PAPER-STOP-1";

  it("is PENDING when a LONG resting level has not been crossed by the candle's high", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 55300, latestCandle, qty: 30 });
    expect(result.status).toBe("PENDING");
    expect(result.filledQty).toBe(0);
  });

  it("FILLS a LONG when the candle's high crosses the resting level, with upward slippage", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 55100, latestCandle, qty: 30 });
    expect(result.status).toBe("FILLED");
    expect(result.filledQty).toBe(30);
    expect(result.avgFillPrice).toBeCloseTo(55100 * 1.0005, 5);
  });

  it("FILLS a SHORT when the candle's low crosses the resting level, with downward slippage", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "SHORT", level: 54950, latestCandle, qty: 30 });
    expect(result.status).toBe("FILLED");
    expect(result.avgFillPrice).toBeCloseTo(54950 * 0.9995, 5);
  });

  it("is PENDING when a SHORT resting level has not been crossed by the candle's low", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "SHORT", level: 54800, latestCandle, qty: 30 });
    expect(result.status).toBe("PENDING");
  });

  it("LIVE mode with no entryOrderId yet (gated out at placement time) is PENDING without any network call", async () => {
    const result = await checkEntryOrderFill({ paperTrading: false, entryOrderId: null, dir: "LONG", level: 55100, latestCandle, qty: 30 });
    expect(result.status).toBe("PENDING");
    expect(result.filledQty).toBe(0);
  });

  // Regression: manageFuturesPendingInner tracks a pending entry with entryOrderId:null whenever
  // the arm-time gate (checkTimeFilter/canTakeTrade/margin) fails — e.g. the correlation filter
  // blocking a second underlying, or the daily-loss/max-trades gate tripping. Before this fix, the
  // PAPER branch ignored entryOrderId and judged fill purely by candle-crossing, so a gate-skipped
  // signal could still silently open a real paper position the whole point of the gate was to
  // prevent — paper mode was less safe than live here, which already short-circuited on this.
  it("PAPER mode with no entryOrderId (gate-skipped at arm time) stays PENDING even though the level was crossed", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: null, dir: "LONG", level: 55100, latestCandle, qty: 30 });
    expect(result.status).toBe("PENDING");
    expect(result.filledQty).toBe(0);
  });

  it("PAPER mode with no entryOrderId stays PENDING for a SHORT crossing too", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: null, dir: "SHORT", level: 54950, latestCandle, qty: 30 });
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
