import { describe, it, expect } from "vitest";
import { computeExecutionStats } from "./executionStats.js";

describe("computeExecutionStats", () => {
  it("returns a perfect, zeroed baseline for an empty log", () => {
    const s = computeExecutionStats([]);
    expect(s.totalOrders).toBe(0);
    expect(s.filledOrders).toBe(0);
    expect(s.fillRate).toBe(0);
    expect(s.rejectionRate).toBe(0);
    expect(s.executionScore).toBe(100);
  });

  it("computes fill/rejection rates, latency, slippage, and a penalized score", () => {
    const log = [
      { type: "ORDER_PLACED", orderId: "A", timestamp: "2026-06-26T04:00:00.000Z" },
      { type: "ORDER_FILLED", orderId: "A", timestamp: "2026-06-26T04:00:01.000Z" }, // 1000ms
      { type: "POSITION_OPENED", avgFillPrice: 102, entryLimitPrice: 100 }, // +2% slippage
      { type: "ORDER_PLACED", orderId: "B", timestamp: "2026-06-26T04:01:00.000Z" },
      { type: "ORDER_REJECTED", orderId: "B", timestamp: "2026-06-26T04:01:01.000Z" },
    ];
    const s = computeExecutionStats(log);
    expect(s.totalOrders).toBe(2);
    expect(s.filledOrders).toBe(1);
    expect(s.rejectedOrders).toBe(1);
    expect(s.fillRate).toBe(50);
    expect(s.rejectionRate).toBe(50);
    expect(s.avgExecutionLatencyMs).toBe(1000);
    expect(s.avgSlippagePct).toBe(2);
    // 100 - 50*0.5 - 2*5 = 65
    expect(s.executionScore).toBe(65);
  });

  it("does not penalize favorable fills (below the limit)", () => {
    const log = [
      { type: "ORDER_PLACED", orderId: "A", timestamp: "2026-06-26T04:00:00.000Z" },
      { type: "ORDER_FILLED", orderId: "A", timestamp: "2026-06-26T04:00:00.500Z" },
      { type: "POSITION_OPENED", avgFillPrice: 98, entryLimitPrice: 100 }, // -2% (favorable)
    ];
    const s = computeExecutionStats(log);
    expect(s.avgSlippagePct).toBe(-2);
    expect(s.fillRate).toBe(100);
    expect(s.executionScore).toBe(100);
  });

  it("handles paper-trading order/fill events", () => {
    const log = [
      { type: "PAPER_ORDER", orderId: "P1", timestamp: "2026-06-26T04:00:00.000Z" },
      { type: "PAPER_FILL", orderId: "P1", timestamp: "2026-06-26T04:00:00.300Z" },
    ];
    const s = computeExecutionStats(log);
    expect(s.totalOrders).toBe(1);
    expect(s.filledOrders).toBe(1);
    expect(s.fillRate).toBe(100);
    expect(s.avgExecutionLatencyMs).toBe(300);
  });
});
