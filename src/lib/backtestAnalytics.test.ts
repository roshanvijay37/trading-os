import { describe, it, expect } from "vitest";
import { computeBacktestAnalytics, filterTradesByDate, type AnalyticsTrade } from "./backtestAnalytics";

function mkTrade(pnl: number, opts: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  return {
    pnl,
    exitReason: opts.exitReason || "TARGET",
    barsHeld: opts.barsHeld ?? 5,
    entryTime: opts.entryTime || "2024-03-04T04:00:00.000Z",
    exitTime: opts.exitTime || "2024-03-04T05:00:00.000Z",
    riskAtEntry: opts.riskAtEntry,
  };
}

describe("computeBacktestAnalytics — empty input", () => {
  it("returns a zeroed result with finalCapital equal to the baseline", () => {
    const result = computeBacktestAnalytics([], 100000);
    expect(result.summary.totalTrades).toBe(0);
    expect(result.summary.finalCapital).toBe(100000);
    expect(result.equityCurve).toEqual([]);
  });
});

describe("computeBacktestAnalytics — windowed baseline capital", () => {
  it("computes total return and final capital relative to the given baseline, not a fixed default", () => {
    const trades = [
      mkTrade(1000, { exitTime: "2024-01-05T05:00:00.000Z" }),
      mkTrade(-500, { exitTime: "2024-01-10T05:00:00.000Z" }),
      mkTrade(2000, { exitTime: "2024-01-15T05:00:00.000Z" }),
    ];
    const result = computeBacktestAnalytics(trades, 50000);
    expect(result.summary.totalPnL).toBe(2500);
    expect(result.summary.finalCapital).toBe(52500);
    expect(result.summary.totalReturn).toBeCloseTo(5, 5); // 2500/50000 * 100
  });

  it("rebuilds the equity curve starting from the baseline and tracks drawdown within just this window", () => {
    // 100000 -> 110000 (peak) -> 90000 (a 18.18% drawdown from the 110000 peak) -> 95000
    const trades = [
      mkTrade(10000, { exitTime: "2024-01-01T05:00:00.000Z" }),
      mkTrade(-20000, { exitTime: "2024-01-02T05:00:00.000Z" }),
      mkTrade(5000, { exitTime: "2024-01-03T05:00:00.000Z" }),
    ];
    const result = computeBacktestAnalytics(trades, 100000);
    expect(result.equityCurve.map((p) => p.equity)).toEqual([110000, 90000, 95000]);
    expect(result.summary.maxDrawdown).toBeCloseTo(18.18, 1);
  });
});

describe("computeBacktestAnalytics — streaks, extremes, profit factor (parity with the backend)", () => {
  it("matches the same streak/profit-factor logic as the server-side implementation", () => {
    const trades = [10, 10, 10, -5, -5, 10, -5, -5, -5, -5].map((p, i) =>
      mkTrade(p, { exitTime: `2024-01-${String(i + 1).padStart(2, "0")}T05:00:00.000Z` })
    );
    const result = computeBacktestAnalytics(trades, 100000);
    expect(result.advanced.streaks.maxConsecutiveWins).toBe(3);
    expect(result.advanced.streaks.maxConsecutiveLosses).toBe(4);
    expect(result.advanced.streaks.currentStreak).toBe(-4);
  });

  it("computes profit factor as gross profit / gross loss, distinct from payoff ratio", () => {
    const trades = [mkTrade(100), mkTrade(100), mkTrade(100), mkTrade(-150)].map((t, i) => ({
      ...t,
      exitTime: `2024-01-0${i + 1}T05:00:00.000Z`,
    }));
    const result = computeBacktestAnalytics(trades, 100000);
    expect(result.summary.profitFactor).toBe(2); // 300/150
    expect(result.summary.payoffRatio).toBeCloseTo(0.67, 2); // 100/150
  });
});

describe("filterTradesByDate", () => {
  const trades = [
    mkTrade(100, { exitTime: "2022-06-15T05:00:00.000Z" }),
    mkTrade(200, { exitTime: "2024-06-15T05:00:00.000Z" }),
    mkTrade(-50, { exitTime: "2026-01-10T05:00:00.000Z" }),
  ];

  it("ALL returns every trade unchanged", () => {
    expect(filterTradesByDate(trades, "ALL")).toHaveLength(3);
  });

  it("THIS_YEAR keeps only trades from the current calendar year", () => {
    // Test relies on the sandbox clock; assert structurally rather than pinning a literal year.
    const thisYear = new Date().getUTCFullYear();
    const withThisYear = [...trades, mkTrade(300, { exitTime: `${thisYear}-02-01T05:00:00.000Z` })];
    const out = filterTradesByDate(withThisYear, "THIS_YEAR");
    expect(out.every((t) => new Date(t.exitTime).getUTCFullYear() === thisYear)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it("CUSTOM keeps trades within an inclusive [from, to] range", () => {
    const out = filterTradesByDate(trades, "CUSTOM", "2024-01-01", "2024-12-31");
    expect(out).toHaveLength(1);
    expect(out[0].exitTime).toBe("2024-06-15T05:00:00.000Z");
  });

  it("CUSTOM with no bounds behaves like ALL", () => {
    expect(filterTradesByDate(trades, "CUSTOM")).toHaveLength(3);
  });
});
