import { describe, it, expect } from "vitest";
import { istClock, liveEntryGate } from "./backtest.js";

// C3: the backtest now applies the same entry gates as the live bot, so it stops over-stating
// achievable P&L. These pure helpers back that gating.
describe("istClock (IST wall-clock from epoch ms)", () => {
  it("maps 03:45 UTC to 09:15 IST", () => {
    const ms = (3 * 60 + 45) * 60 * 1000; // 03:45:00 UTC
    expect(istClock(ms)).toMatchObject({ hour: 9, minute: 15, decimal: 9.25 });
  });
  it("maps 08:30 UTC to 14:00 IST (the entry cutoff)", () => {
    const ms = (8 * 60 + 30) * 60 * 1000;
    expect(istClock(ms)).toMatchObject({ hour: 14, minute: 0 });
  });
  it("maps 09:45 UTC to 15:15 IST (square-off)", () => {
    const ms = (9 * 60 + 45) * 60 * 1000;
    expect(istClock(ms)).toMatchObject({ hour: 15, minute: 15 });
  });
});

describe("liveEntryGate (backtest ↔ live entry parity)", () => {
  const limits = {
    sessionStartDecimal: 9.25, sessionEndDecimal: 15.0, maxTimeEntryHour: 14,
    maxTradesPerDay: 10, dailyLossCap: 2000, maxConsecutiveLosses: 3, maxVix: 25,
  };
  const base = { decimal: 10, hour: 10, dayTrades: 0, dayPnL: 0, consecutiveLosses: 0, vix: 15 };

  it("allows a clean mid-morning signal", () => {
    expect(liveEntryGate(base, limits)).toEqual({ allow: true, reason: "" });
  });
  it("blocks before the session opens", () => {
    expect(liveEntryGate({ ...base, decimal: 9.0 }, limits).reason).toBe("OUTSIDE_SESSION");
  });
  it("blocks at/after the 14:00 entry cutoff", () => {
    expect(liveEntryGate({ ...base, hour: 14, decimal: 14 }, limits).reason).toBe("AFTER_ENTRY_CUTOFF");
  });
  it("blocks once max trades/day is hit", () => {
    expect(liveEntryGate({ ...base, dayTrades: 10 }, limits).reason).toBe("MAX_TRADES");
  });
  it("blocks once the daily loss cap is breached", () => {
    expect(liveEntryGate({ ...base, dayPnL: -2000 }, limits).reason).toBe("DAILY_LOSS_LIMIT");
  });
  it("blocks after the consecutive-loss limit", () => {
    expect(liveEntryGate({ ...base, consecutiveLosses: 3 }, limits).reason).toBe("CONSECUTIVE_LOSSES");
  });
  it("blocks on high VIX (when VIX is known)", () => {
    expect(liveEntryGate({ ...base, vix: 26 }, limits).reason).toBe("HIGH_VIX");
  });
  it("ignores VIX when not available (maxVix null)", () => {
    expect(liveEntryGate({ ...base, vix: 99 }, { ...limits, maxVix: null }).allow).toBe(true);
  });
});
