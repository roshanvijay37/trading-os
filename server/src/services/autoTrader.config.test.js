import { describe, it, expect } from "vitest";
import { sanitizeConfigUpdates, getPollIntervalMs } from "./autoTrader.js";
import { getOptionDefaults } from "./blackScholes.js";

// sanitizeConfigUpdates is the pure gate in front of updateConfig: a fat-fingered
// riskPercent (50 instead of 0.5) or a garbage payload must be DROPPED — never clamped,
// never applied — so a one-keystroke typo can't 100×-size a live position.
describe("sanitizeConfigUpdates (config bounds validation)", () => {
  it("accepts sane values unchanged", () => {
    const { clean, rejected } = sanitizeConfigUpdates({
      riskPercent: 0.5,
      maxTradesPerDay: 10,
      maxRiskPerDay: 2,
      fixedLots: 1,
      positionSizingMode: "RISK",
      paperTrading: true,
      minOI: 100000,
      maxSpreadPct: 2,
      maxTimeEntryHour: 14,
    });
    expect(rejected).toEqual([]);
    expect(clean.riskPercent).toBe(0.5);
    expect(clean.maxTradesPerDay).toBe(10);
    expect(clean.positionSizingMode).toBe("RISK");
  });

  it("drops out-of-bounds numerics instead of clamping them", () => {
    const { clean, rejected } = sanitizeConfigUpdates({ riskPercent: 50, maxTradesPerDay: 0, fixedLots: 1000 });
    expect(clean).toEqual({});
    expect(rejected.map((r) => r.key).sort()).toEqual(["fixedLots", "maxTradesPerDay", "riskPercent"]);
  });

  it("drops non-numeric garbage (strings coerce only if truly numeric; NaN/booleans rejected)", () => {
    const { clean, rejected } = sanitizeConfigUpdates({ riskPercent: "abc", maxRiskPerDay: null, minOI: true });
    expect(clean).toEqual({});
    expect(rejected).toHaveLength(3);
  });

  it("accepts numeric strings within bounds (UI number inputs may serialize as strings)", () => {
    const { clean, rejected } = sanitizeConfigUpdates({ riskPercent: "0.5", maxTradesPerDay: "10" });
    expect(rejected).toEqual([]);
    expect(clean.riskPercent).toBe(0.5);
    expect(clean.maxTradesPerDay).toBe(10);
  });

  it("rejects non-integer values for integer fields", () => {
    const { rejected } = sanitizeConfigUpdates({ maxTradesPerDay: 2.5, fixedLots: 1.1 });
    expect(rejected.map((r) => r.key).sort()).toEqual(["fixedLots", "maxTradesPerDay"]);
  });

  it("filters selectedStrategies to the allowlist (EMA5T only) and drops empty results", () => {
    expect(sanitizeConfigUpdates({ selectedStrategies: ["EMA5T", "EMA9", "EMA5T"] }).clean.selectedStrategies).toEqual(["EMA5T"]);
    const bad = sanitizeConfigUpdates({ selectedStrategies: ["EMA9"] });
    expect(bad.clean.selectedStrategies).toBeUndefined();
    expect(bad.rejected[0].key).toBe("selectedStrategies");
    // A non-array string must never survive to be iterated character-by-character.
    expect(sanitizeConfigUpdates({ selectedStrategies: "EMA5T" }).clean.selectedStrategies).toEqual(["EMA5T"]);
    expect(sanitizeConfigUpdates({ selectedStrategies: "EMA5" }).clean.selectedStrategies).toBeUndefined();
  });

  it("filters selectedInstruments to NIFTY/BANKNIFTY", () => {
    expect(sanitizeConfigUpdates({ selectedInstruments: ["NIFTY", "SENSEX"] }).clean.selectedInstruments).toEqual(["NIFTY"]);
    expect(sanitizeConfigUpdates({ selectedInstruments: [] }).clean.selectedInstruments).toBeUndefined();
  });

  it("rejects positionSizingMode outside RISK/LOTS and non-boolean paperTrading", () => {
    const { clean, rejected } = sanitizeConfigUpdates({ positionSizingMode: "YOLO", paperTrading: "false" });
    expect(clean).toEqual({});
    expect(rejected).toHaveLength(2);
  });

  it("accepts a boolean useStopLimitEntries and rejects a non-boolean one, same as paperTrading", () => {
    expect(sanitizeConfigUpdates({ useStopLimitEntries: true }).clean.useStopLimitEntries).toBe(true);
    expect(sanitizeConfigUpdates({ useStopLimitEntries: false }).clean.useStopLimitEntries).toBe(false);
    const { clean, rejected } = sanitizeConfigUpdates({ useStopLimitEntries: "true" });
    expect(clean).toEqual({});
    expect(rejected).toHaveLength(1);
  });

  it("passes selectedTimeframes through untouched (updateConfig sanitizes those itself)", () => {
    const { clean } = sanitizeConfigUpdates({ selectedTimeframes: [5, 30] });
    expect(clean.selectedTimeframes).toEqual([5, 30]);
  });

  it("accepts a trendEmaPeriod within bounds and rejects out-of-range/non-integer values", () => {
    expect(sanitizeConfigUpdates({ trendEmaPeriod: 20 }).clean.trendEmaPeriod).toBe(20);
    expect(sanitizeConfigUpdates({ trendEmaPeriod: 15 }).clean.trendEmaPeriod).toBe(15);
    const { clean, rejected } = sanitizeConfigUpdates({ trendEmaPeriod: 4 });
    expect(clean.trendEmaPeriod).toBeUndefined();
    expect(rejected.map((r) => r.key)).toContain("trendEmaPeriod");
    expect(sanitizeConfigUpdates({ trendEmaPeriod: 51 }).clean.trendEmaPeriod).toBeUndefined();
    expect(sanitizeConfigUpdates({ trendEmaPeriod: 20.5 }).clean.trendEmaPeriod).toBeUndefined();
  });

  it("accepts a targetMultiplier within bounds and rejects out-of-range values", () => {
    expect(sanitizeConfigUpdates({ targetMultiplier: 2 }).clean.targetMultiplier).toBe(2);
    expect(sanitizeConfigUpdates({ targetMultiplier: 2.5 }).clean.targetMultiplier).toBe(2.5);
    const { clean, rejected } = sanitizeConfigUpdates({ targetMultiplier: 0.4 });
    expect(clean.targetMultiplier).toBeUndefined();
    expect(rejected.map((r) => r.key)).toContain("targetMultiplier");
    expect(sanitizeConfigUpdates({ targetMultiplier: 5.1 }).clean.targetMultiplier).toBeUndefined();
  });
});

// A wrong lot size is silently fatal live (every order exchange-rejected as an invalid
// multiple) while paper mode happily fills it — so the 2026 contract sizes are pinned here.
// NSE Jan-2026 series revision (circular FAOP70616): NIFTY 75→65, BANKNIFTY 35→30.
describe("2026 NSE lot sizes", () => {
  it("backtest option model uses NIFTY 65 / BANKNIFTY 30", () => {
    expect(getOptionDefaults("NSE:NIFTY50-INDEX").lotSize).toBe(65);
    expect(getOptionDefaults("NSE:NIFTYBANK-INDEX").lotSize).toBe(30);
  });
});

// Bounds sanity, not a brittle exact-value pin: guards against an accidental revert to something
// far too slow (missing signals) or far too fast (risking FYERS's per-minute rate limit) without
// locking the number itself, which is expected to be deliberately tuned.
describe("getPollIntervalMs (trading-loop poll cadence)", () => {
  it("stays within a sane range", () => {
    const ms = getPollIntervalMs();
    expect(ms).toBeGreaterThanOrEqual(5000);
    expect(ms).toBeLessThanOrEqual(30000);
  });
});
