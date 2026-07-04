import { describe, it, expect } from "vitest";
import { sanitizeConfigUpdates } from "./autoTrader.js";
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
      maxVIX: 25,
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
    const { clean, rejected } = sanitizeConfigUpdates({ riskPercent: "abc", maxVIX: null, minOI: true });
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

  it("passes selectedTimeframes through untouched (updateConfig sanitizes those itself)", () => {
    const { clean } = sanitizeConfigUpdates({ selectedTimeframes: [5, 30] });
    expect(clean.selectedTimeframes).toEqual([5, 30]);
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
