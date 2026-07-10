import { describe, it, expect } from "vitest";
import {
  SESSION_PROFILES,
  GOLD_CONTRACTS,
  MONTH_CODES,
  buildFuturesSymbol,
  probeMonthsFor,
  computeInstrumentPhase,
  getBacktestProfile,
} from "./instruments.js";

const min = (h, m = 0) => h * 60 + m;
const phaseAt = (profile, h, m = 0, isTradingDay = true) =>
  computeInstrumentPhase(profile, { istMinutes: min(h, m), isTradingDay });

describe("computeInstrumentPhase — NSE_INDEX reproduces the legacy loop's branch table exactly", () => {
  const p = SESSION_PROFILES.NSE_INDEX;
  it.each([
    [8, 59, "CLOSED"],   // pre-9:00: legacy `hours < 9` → CLOSED
    [9, 0, "PRE_OPEN"],  // legacy `h===9 && m<15` → PRE_OPEN
    [9, 14, "PRE_OPEN"],
    [9, 15, "OPEN"],
    [12, 0, "OPEN"],
    [15, 29, "OPEN"],    // legacy: h>15 false, 15:30 check m>=30 false → OPEN
    [15, 30, "CLOSED"],  // legacy hard close
    [16, 0, "CLOSED"],
    [23, 0, "CLOSED"],
  ])("%i:%i → %s", (h, m, expected) => {
    expect(phaseAt(p, h, m)).toBe(expected);
  });
  it("non-trading day is CLOSED regardless of time", () => {
    expect(phaseAt(p, 12, 0, false)).toBe("CLOSED");
  });
});

describe("computeInstrumentPhase — MCX_COMMODITY (gold session)", () => {
  const p = SESSION_PROFILES.MCX_COMMODITY;
  it.each([
    [8, 30, "CLOSED"],
    [8, 45, "PRE_OPEN"],
    [8, 59, "PRE_OPEN"],
    [9, 0, "OPEN"],      // gold opens 09:00, not 09:15
    [15, 30, "OPEN"],    // NSE closed, MCX still open — the whole point
    [22, 30, "OPEN"],    // past entry cutoff but session still open (exits/square-off run)
    [23, 29, "OPEN"],
    [23, 30, "CLOSED"],
  ])("%i:%i → %s", (h, m, expected) => {
    expect(phaseAt(p, h, m)).toBe(expected);
  });
});

describe("session profile invariants the strategy machinery depends on", () => {
  it("NSE entries window matches the legacy isValidTradingTime constants (9.25–15.0)", () => {
    expect(SESSION_PROFILES.NSE_INDEX.sessionStartDecimal).toBe(9.25);
    expect(SESSION_PROFILES.NSE_INDEX.sessionEndDecimal).toBe(15.0);
    expect(SESSION_PROFILES.NSE_INDEX.squareOffHour).toBe(15);
    expect(SESSION_PROFILES.NSE_INDEX.squareOffMinute).toBe(15);
    expect(SESSION_PROFILES.NSE_INDEX.entryCutoffHour).toBeNull(); // live keeps CONFIG.MAX_TIME_ENTRY_HOUR
  });
  it("gold profile is the validated variant (entries 9–22, live square-off 23:15, backtest 23:00 bar)", () => {
    const g = SESSION_PROFILES.MCX_COMMODITY;
    expect(g.sessionStartDecimal).toBe(9.0);
    expect(g.sessionEndDecimal).toBe(22.0);
    expect(g.entryCutoffHour).toBe(22);
    expect([g.squareOffHour, g.squareOffMinute]).toEqual([23, 15]);
    expect([g.btSquareOffHour, g.btSquareOffMinute]).toEqual([23, 0]);
  });
  it("tick session anchors: NSE 09:15, MCX 09:00", () => {
    expect(SESSION_PROFILES.NSE_INDEX.sessionOpenMin).toBe(555);
    expect(SESSION_PROFILES.MCX_COMMODITY.sessionOpenMin).toBe(540);
  });
});

describe("buildFuturesSymbol / probeMonthsFor", () => {
  it("reproduces the legacy NSE format exactly (autoTrader/backtest parity)", () => {
    expect(buildFuturesSymbol("BANKNIFTY", 2026, 6)).toBe("NSE:BANKNIFTY26JULFUT");
    expect(buildFuturesSymbol("NIFTY", 2026, 11, "NSE")).toBe("NSE:NIFTY26DECFUT");
  });
  it("builds MCX gold contracts", () => {
    expect(buildFuturesSymbol("GOLDM", 2026, 7, "MCX")).toBe("MCX:GOLDM26AUGFUT");
    expect(buildFuturesSymbol("GOLD", 2027, 1, "MCX")).toBe("MCX:GOLD27FEBFUT");
  });
  it("MONTH_CODES covers all 12 months in order", () => {
    expect(MONTH_CODES).toHaveLength(12);
    expect(MONTH_CODES[0]).toBe("JAN");
    expect(MONTH_CODES[11]).toBe("DEC");
  });
  it("MCX probes 4 months (bi-monthly GOLD always reachable from any start month), NSE probes 3", () => {
    expect(probeMonthsFor("MCX")).toBe(4);
    expect(probeMonthsFor("NSE")).toBe(3);
    expect(probeMonthsFor(undefined)).toBe(3);
    // From the worst-case start (odd month, e.g. Jan), months 0..3 = JAN FEB MAR APR — contains
    // two even (bi-monthly) candidates, so an active GOLD contract is always in probe range.
  });
});

describe("getBacktestProfile", () => {
  it("MCX symbols get the commodity profile", () => {
    expect(getBacktestProfile("MCX:GOLD")).toBe(SESSION_PROFILES.MCX_COMMODITY);
    expect(getBacktestProfile("mcx:goldm26augfut")).toBe(SESSION_PROFILES.MCX_COMMODITY);
  });
  it("NSE symbols return null → engine keeps its built-in defaults (byte-identical backtests)", () => {
    expect(getBacktestProfile("NSE:NIFTYBANK-INDEX")).toBeNull();
    expect(getBacktestProfile("NSE:NIFTY50-INDEX")).toBeNull();
    expect(getBacktestProfile("")).toBeNull();
    expect(getBacktestProfile(undefined)).toBeNull();
  });
});

describe("GOLD_CONTRACTS", () => {
  it("point values: GOLD ₹100/pt, GOLDM ₹10/pt", () => {
    expect(GOLD_CONTRACTS.GOLD.pointValue).toBe(100);
    expect(GOLD_CONTRACTS.GOLDM.pointValue).toBe(10);
    expect(GOLD_CONTRACTS.GOLDM.root).toBe("GOLDM");
  });
});
