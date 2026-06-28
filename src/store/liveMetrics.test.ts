import { describe, it, expect } from "vitest";
import { deriveLiveMetrics, normalizeMarketStatus } from "./liveMetrics";

describe("normalizeMarketStatus", () => {
  it("passes through valid dashboard union values", () => {
    expect(normalizeMarketStatus("OPEN")).toBe("OPEN");
    expect(normalizeMarketStatus("PRE_OPEN")).toBe("PRE_OPEN");
    expect(normalizeMarketStatus("POST_CLOSE")).toBe("POST_CLOSE");
  });

  it("collapses weekend/holiday/unknown to CLOSED", () => {
    expect(normalizeMarketStatus("SATURDAY_CLOSED")).toBe("CLOSED");
    expect(normalizeMarketStatus("HOLIDAY - Diwali")).toBe("CLOSED");
    expect(normalizeMarketStatus(undefined)).toBe("CLOSED");
  });
});

describe("deriveLiveMetrics", () => {
  it("computes exposure, utilization, P&L% and risk from a live status", () => {
    const { dashboard, portfolioRisk } = deriveLiveMetrics({
      capital: 100000,
      dailyPnL: "-1000",
      todayTrades: 3,
      consecutiveLosses: 1,
      isRunning: true,
      emergencyStop: false,
      marketStatus: "OPEN",
      maxRiskPerDayPercent: 2,
      openPositions: [
        { avgFillPrice: 100, quantity: 75 }, // 7,500
        { avgFillPrice: 50, quantity: 75 }, // 3,750
      ],
    });

    expect(portfolioRisk.totalExposure).toBe(11250);
    expect(portfolioRisk.capitalUtilized).toBeCloseTo(11.25, 2);
    expect(dashboard.capitalUsed).toBeCloseTo(11.25, 2);
    expect(dashboard.portfolioPnL).toBeCloseTo(-1, 5); // -1000 / 100000 * 100
    expect(dashboard.todaysTrades).toBe(3);
    expect(dashboard.botStatus).toBe("RUNNING");
    expect(dashboard.marketStatus).toBe("OPEN");
    // daily-loss budget = 2% of 100,000 = 2,000; used = 1,000 / 2,000 = 50%
    expect(portfolioRisk.dailyRiskUsed).toBeCloseTo(50, 5);
    expect(dashboard.riskStatus).toBe("HEALTHY"); // 50 < 80
    expect(portfolioRisk.portfolioDrawdown).toBeCloseTo(1, 5);
  });

  it("escalates risk status as the daily-loss budget is consumed", () => {
    const base = { capital: 100000, maxRiskPerDayPercent: 2, isRunning: true } as const;
    expect(deriveLiveMetrics({ ...base, dailyPnL: -1700 }).dashboard.riskStatus).toBe("WARNING"); // 85%
    expect(deriveLiveMetrics({ ...base, dailyPnL: -2000 }).dashboard.riskStatus).toBe("CRITICAL"); // 100%
  });

  it("maps backend health and execution scores when present", () => {
    const { dashboard } = deriveLiveMetrics({
      capital: 100000,
      health: { healthScore: 80 },
      executionStats: { executionScore: 65 },
    });
    expect(dashboard.healthScore).toBe(80);
    expect(dashboard.executionScore).toBe(65);
  });

  it("omits scores when the backend does not provide them", () => {
    const { dashboard } = deriveLiveMetrics({ capital: 100000 });
    expect(dashboard.healthScore).toBeUndefined();
    expect(dashboard.executionScore).toBeUndefined();
  });

  it("is zero-safe and reports EMERGENCY when disconnected/halted", () => {
    expect(deriveLiveMetrics({ emergencyStop: true }).dashboard.botStatus).toBe("EMERGENCY");
    const empty = deriveLiveMetrics({});
    expect(empty.portfolioRisk.totalExposure).toBe(0);
    expect(empty.portfolioRisk.dailyRiskUsed).toBe(0);
    expect(empty.dashboard.botStatus).toBe("STOPPED");
    expect(empty.dashboard.marketStatus).toBe("CLOSED");
  });
});
