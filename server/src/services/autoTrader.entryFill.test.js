import { describe, it, expect } from "vitest";
import { checkEntryOrderFill, cancelPendingEntryOrder, computeGapAdjustedTarget } from "./autoTrader.js";

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
    expect(result.avgFillPrice).toBeCloseTo(55100 * 1.0002, 5);
  });

  it("FILLS a SHORT when the candle's low crosses the resting level, with downward slippage", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "SHORT", level: 54950, latestCandle, qty: 30 });
    expect(result.status).toBe("FILLED");
    expect(result.avgFillPrice).toBeCloseTo(54950 * 0.9998, 5);
  });

  it("is PENDING when a SHORT resting level has not been crossed by the candle's low", async () => {
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "SHORT", level: 54800, latestCandle, qty: 30 });
    expect(result.status).toBe("PENDING");
  });

  it("exact-touch is NOT a fill — engine parity (the backtest enters only on a STRICT break)", async () => {
    // latestCandle high is exactly 55200 / low exactly 54900 — touching, never beyond.
    const long = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 55200, latestCandle, qty: 30 });
    expect(long.status).toBe("PENDING");
    const short = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "SHORT", level: 54900, latestCandle, qty: 30 });
    expect(short.status).toBe("PENDING");
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

  // Regression: a resting stop-entry that GAPS through its level (the candle's own open is
  // already past it) used to always fill at level*(1±slip) regardless of how big the real gap
  // was — silently understating gap risk. The fill should be based on the candle's OPEN once the
  // market has gapped straight through, not the stale nominal level.
  it("FILLS a LONG at the candle's OPEN (with slippage) when the open already gapped past the level", async () => {
    const gapCandle = [1_700_000_000, 55000, 55200, 54950, 55100, 1000]; // open 55000 > level 54800
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 54800, latestCandle: gapCandle, qty: 30 });
    expect(result.status).toBe("FILLED");
    expect(result.avgFillPrice).toBeCloseTo(55000 * 1.0002, 5);
  });

  it("FILLS a SHORT at the candle's OPEN (with slippage) when the open already gapped past the level", async () => {
    const gapCandle = [1_700_000_000, 55000, 55050, 54800, 54900, 1000]; // open 55000 < level 55300
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "SHORT", level: 55300, latestCandle: gapCandle, qty: 30 });
    expect(result.status).toBe("FILLED");
    expect(result.avgFillPrice).toBeCloseTo(55000 * 0.9998, 5);
  });

  it("still fills at the LEVEL (not the open) when the open has NOT gapped past it", async () => {
    // open 55000 is below the LONG level 55100 — no gap, fill must stay anchored to the level.
    const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 55100, latestCandle, qty: 30 });
    expect(result.avgFillPrice).toBeCloseTo(55100 * 1.0002, 5);
  });

  // SL-L semantics: a real stop-limit never fills worse than its limit — it stays resting instead.
  // Without a limitPrice, paper mode is byte-identical to every test above (limitPrice defaults to 0).
  describe("limitPrice (SL-L cap on the paper-mode fill)", () => {
    it("limitPrice: 0 (feature off) is identical to omitting it entirely", async () => {
      const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 55100, limitPrice: 0, latestCandle, qty: 30 });
      expect(result.status).toBe("FILLED");
      expect(result.avgFillPrice).toBeCloseTo(55100 * 1.0002, 5);
    });

    it("LONG still FILLS when the gap-adjusted price is within the limit", async () => {
      const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 55100, limitPrice: 55200, latestCandle, qty: 30 });
      expect(result.status).toBe("FILLED");
      expect(result.avgFillPrice).toBeCloseTo(55100 * 1.0002, 5);
    });

    it("LONG stays PENDING (never fills worse than the limit) when the gap-adjusted price would exceed it", async () => {
      const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 55100, limitPrice: 55110, latestCandle, qty: 30 });
      expect(result.status).toBe("PENDING");
      expect(result.filledQty).toBe(0);
    });

    it("SHORT still FILLS when the gap-adjusted price is within the limit", async () => {
      const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "SHORT", level: 54950, limitPrice: 54900, latestCandle, qty: 30 });
      expect(result.status).toBe("FILLED");
      expect(result.avgFillPrice).toBeCloseTo(54950 * 0.9998, 5);
    });

    it("SHORT stays PENDING (never fills worse than the limit) when the gap-adjusted price would exceed it", async () => {
      // Fill = 54950 × 0.9998 = 54939.01 — a limit ABOVE that (54945) means the modeled fill is
      // worse than the SL-L would tolerate, so the order keeps resting.
      const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "SHORT", level: 54950, limitPrice: 54945, latestCandle, qty: 30 });
      expect(result.status).toBe("PENDING");
      expect(result.filledQty).toBe(0);
    });

    it("a limit set exactly AT the gap-adjusted price still fills (boundary, not strictly exceeded)", async () => {
      const exact = 55100 * 1.0002;
      const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 55100, limitPrice: exact, latestCandle, qty: 30 });
      expect(result.status).toBe("FILLED");
    });

    it("a real gap-through fill that would exceed the limit stays PENDING, not silently capped to the limit price", async () => {
      const gapCandle = [1_700_000_000, 55000, 55200, 54950, 55100, 1000]; // open 55000 > level 54800 — gapped through
      const result = await checkEntryOrderFill({ paperTrading: true, entryOrderId: armedId, dir: "LONG", level: 54800, limitPrice: 54850, latestCandle: gapCandle, qty: 30 });
      expect(result.status).toBe("PENDING");
      expect(result.filledQty).toBe(0);
    });
  });
});

// Regression: stopLoss/target used to be copied straight from the nominal alert level computed
// at ARM time, never recomputed against the ACTUAL fill — so a gap silently shrank the achieved
// risk:reward (real risk grows as the entry moves away from the fixed stop, while an unadjusted
// target sits closer to the new entry). The stop stays at the alert candle's fixed structural
// level; the target scales with the real entry to preserve the intended ratio.
describe("computeGapAdjustedTarget", () => {
  it("reproduces the original nominal target when the fill happened exactly at the alert level (no gap)", () => {
    // LONG: level 55100, stop 55000 (risk 100) -> nominal target 55100 + 100*2 = 55300.
    expect(computeGapAdjustedTarget("LONG", 55100, 55000)).toBe(55300);
  });

  it("scales the target up for a LONG when the fill gapped above the nominal level", () => {
    // Real entry 55300 (gapped up), stop unchanged at 55000 -> real risk 300, target 55300+600=55900.
    expect(computeGapAdjustedTarget("LONG", 55300, 55000)).toBe(55900);
  });

  it("scales the target down for a SHORT when the fill gapped below the nominal level", () => {
    // Real entry 54700 (gapped down), stop unchanged at 55000 -> real risk 300, target 54700-600=54100.
    expect(computeGapAdjustedTarget("SHORT", 54700, 55000)).toBe(54100);
  });

  it("respects a custom target multiplier", () => {
    expect(computeGapAdjustedTarget("LONG", 100, 90, 3)).toBe(130); // risk 10 * 3 = 30
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
