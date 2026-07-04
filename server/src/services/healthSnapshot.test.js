import { describe, it, expect } from "vitest";
import { computeHealthSnapshot } from "./healthSnapshot.js";

describe("computeHealthSnapshot", () => {
  it("is fully healthy when running, connected, no emergency, no losses", () => {
    const h = computeHealthSnapshot({ isRunning: true, wsConnected: true, marketOpen: true });
    expect(h.healthScore).toBe(100);
    expect(h.overallStatus).toBe("HEALTHY");
    expect(h.components.find((c) => c.name === "Broker Feed").status).toBe("HEALTHY");
  });

  it("penalizes a missing feed during market hours", () => {
    const h = computeHealthSnapshot({ isRunning: true, wsConnected: false, marketOpen: true });
    expect(h.healthScore).toBe(70);
    expect(h.overallStatus).toBe("WARNING");
    expect(h.components.find((c) => c.name === "Broker Feed").status).toBe("DOWN");
  });

  it("does not penalize a missing feed when the market is closed", () => {
    const h = computeHealthSnapshot({ isRunning: false, wsConnected: false, marketOpen: false });
    expect(h.healthScore).toBe(100);
  });

  it("flags an emergency stop as CRITICAL", () => {
    const h = computeHealthSnapshot({ emergencyStop: true, isRunning: false });
    expect(h.healthScore).toBe(50);
    expect(h.overallStatus).toBe("CRITICAL");
  });

  it("scales down with consecutive losses", () => {
    const h = computeHealthSnapshot({
      isRunning: true,
      wsConnected: true,
      marketOpen: true,
      consecutiveLosses: 3,
      maxConsecutiveLosses: 3,
    });
    expect(h.healthScore).toBe(80); // full loss ratio -> -20
    expect(h.components.find((c) => c.name === "Risk").status).toBe("WARNING");
  });

  it("penalizes a stale-but-connected feed during market hours (lesser than a dropped connection)", () => {
    const h = computeHealthSnapshot({ isRunning: true, wsConnected: true, marketOpen: true, feedStale: true });
    expect(h.healthScore).toBe(85);
    expect(h.overallStatus).toBe("HEALTHY");
    expect(h.components.find((c) => c.name === "Broker Feed").status).toBe("STALE");
  });

  it("does not double-penalize staleness on top of a fully dropped connection", () => {
    const h = computeHealthSnapshot({ isRunning: true, wsConnected: false, marketOpen: true, feedStale: true });
    expect(h.healthScore).toBe(70); // same as the plain DOWN case — no extra -15 stacked on
    expect(h.components.find((c) => c.name === "Broker Feed").status).toBe("DOWN");
  });

  it("does not penalize staleness when the market is closed", () => {
    const h = computeHealthSnapshot({ isRunning: true, wsConnected: true, marketOpen: false, feedStale: true });
    expect(h.healthScore).toBe(100);
  });
});
