import { describe, it, expect } from "vitest";
import {
  SESSION_PROFILES,
  GOLD_CONTRACTS,
  MONTH_CODES,
  buildFuturesSymbol,
  probeMonthsFor,
  computeInstrumentPhase,
  getBacktestProfile,
  istDateKey,
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

// ─── istDateKey — the cross-session alert guard's clock ──────────────────────────────────────
describe("istDateKey", () => {
  it("converts epoch seconds to the IST calendar date", () => {
    // 2026-07-13T03:55:00Z == 09:25 IST Monday (verified against FYERS candle data that day)
    expect(istDateKey(1783914900)).toBe("2026-07-13");
  });

  it("flips the date exactly at IST midnight (18:30 UTC)", () => {
    expect(istDateKey(1783881000)).toBe("2026-07-13"); // 2026-07-12T18:30:00Z == 00:00 IST
    expect(istDateKey(1783880999)).toBe("2026-07-12"); // one second earlier == 23:59:59 IST
  });

  it("regression (2026-07-13 phantom gold): Friday's 22:30 IST bar is a different session day than the Monday 09:30 scan", () => {
    const fridayGoldBar = 1783702800; // 2026-07-10T17:00:00Z == 22:30 IST Friday
    const mondayScan = 1783915204; // 2026-07-13T04:00:04Z == 09:30:04 IST Monday (the phantom arm)
    expect(istDateKey(fridayGoldBar)).toBe("2026-07-10");
    expect(istDateKey(fridayGoldBar)).not.toBe(istDateKey(mondayScan));
  });
});

// ─── computeLoopPlan truth table ─────────────────────────────────────────────────────────────
// The riskiest refactor in the gold work: the trading loop's WHO-scans / WHOSE-positions-close /
// WHAT-cadence table, extracted pure. Index-only selections must reproduce the legacy loop
// behavior exactly; gold must keep running after the NSE close.
import { computeLoopPlan } from "./instruments.js";

describe("computeLoopPlan", () => {
  const NSE = SESSION_PROFILES.NSE_INDEX;
  const MCX = SESSION_PROFILES.MCX_COMMODITY;
  const inst = (name, profile, active = true, isTradingDay = true) => ({ name, active, profile, isTradingDay });
  const INDICES = [inst("NIFTY", NSE), inst("BANKNIFTY", NSE), inst("GOLD", MCX, false)];
  const ALL_ON = [inst("NIFTY", NSE), inst("BANKNIFTY", NSE), inst("GOLD", MCX)];
  const at = (h, m) => h * 60 + m;

  describe("index-only selection reproduces the legacy loop table", () => {
    it("08:00 → CLOSED, slow cadence, nothing scans", () => {
      const p = computeLoopPlan({ istMinutes: at(8, 0), instruments: INDICES });
      expect(p.statusString).toBe("CLOSED");
      expect(p.scanList).toEqual([]);
      expect(p.rescheduleMs).toBe(60000);
    });
    it("09:10 → PRE_OPEN, default cadence, no scan, no force-close", () => {
      const p = computeLoopPlan({ istMinutes: at(9, 10), instruments: INDICES, openPositionUnderlyings: ["NIFTY"] });
      expect(p.statusString).toBe("PRE_OPEN");
      expect(p.scanList).toEqual([]);
      expect(p.forceCloseList).toEqual([]); // legacy PRE_OPEN branch never force-closed
      expect(p.rescheduleMs).toBe(15000);
    });
    it("12:00 → OPEN, both indices scan", () => {
      const p = computeLoopPlan({ istMinutes: at(12, 0), instruments: INDICES });
      expect(p.statusString).toBe("OPEN");
      expect(p.scanList).toEqual(["NIFTY", "BANKNIFTY"]);
    });
    it("15:30 → CLOSED, open index positions force-close, slow cadence", () => {
      const p = computeLoopPlan({ istMinutes: at(15, 30), instruments: INDICES, openPositionUnderlyings: ["BANKNIFTY"] });
      expect(p.statusString).toBe("CLOSED");
      expect(p.forceCloseList).toEqual(["BANKNIFTY"]);
      expect(p.rescheduleMs).toBe(60000);
    });
    it("holiday → CLOSED, positions force-close even mid-day", () => {
      const hol = [inst("NIFTY", NSE, true, false), inst("BANKNIFTY", NSE, true, false), inst("GOLD", MCX, false, false)];
      const p = computeLoopPlan({ istMinutes: at(12, 0), instruments: hol, openPositionUnderlyings: ["NIFTY"] });
      expect(p.statusString).toBe("CLOSED");
      expect(p.forceCloseList).toEqual(["NIFTY"]);
    });
  });

  describe("gold selected: the whole point of the refactor", () => {
    it("16:00 → indices force-close, gold still scans (OPEN), default cadence", () => {
      const p = computeLoopPlan({ istMinutes: at(16, 0), instruments: ALL_ON, openPositionUnderlyings: ["NIFTY", "GOLD"] });
      expect(p.statusString).toBe("OPEN");
      expect(p.phaseByInstrument).toEqual({ NIFTY: "CLOSED", BANKNIFTY: "CLOSED", GOLD: "OPEN" });
      expect(p.scanList).toEqual(["GOLD"]);
      expect(p.forceCloseList).toEqual(["NIFTY"]); // gold position survives its own session
      expect(p.rescheduleMs).toBe(15000);
    });
    it("23:20 → gold still open (square-off is monitorPositions' job, not force-close)", () => {
      const p = computeLoopPlan({ istMinutes: at(23, 20), instruments: ALL_ON, openPositionUnderlyings: ["GOLD"] });
      expect(p.phaseByInstrument.GOLD).toBe("OPEN");
      expect(p.forceCloseList).toEqual([]);
    });
    it("23:30 → everything closed, gold position force-closes, slow cadence", () => {
      const p = computeLoopPlan({ istMinutes: at(23, 30), instruments: ALL_ON, openPositionUnderlyings: ["GOLD"] });
      expect(p.statusString).toBe("CLOSED");
      expect(p.forceCloseList).toEqual(["GOLD"]);
      expect(p.rescheduleMs).toBe(60000);
    });
    it("09:05 → gold scans (open at 09:00); indices still pre-open", () => {
      const p = computeLoopPlan({ istMinutes: at(9, 5), instruments: ALL_ON });
      expect(p.scanList).toEqual(["GOLD"]);
      expect(p.phaseByInstrument.NIFTY).toBe("PRE_OPEN");
      expect(p.statusString).toBe("OPEN");
    });
    it("a DESELECTED instrument's open position is still monitored/force-closed by its own clock", () => {
      const goldOff = [inst("NIFTY", NSE), inst("BANKNIFTY", NSE), inst("GOLD", MCX, false)];
      const evening = computeLoopPlan({ istMinutes: at(20, 0), instruments: goldOff, openPositionUnderlyings: ["GOLD"] });
      expect(evening.statusString).toBe("OPEN");      // gold position keeps the loop awake
      expect(evening.scanList).toEqual([]);            // but deselected → no NEW gold signals
      expect(evening.forceCloseList).toEqual([]);
      const night = computeLoopPlan({ istMinutes: at(23, 45), instruments: goldOff, openPositionUnderlyings: ["GOLD"] });
      expect(night.forceCloseList).toEqual(["GOLD"]);
    });
    it("an unknown position underlying defaults to force-close (fail-safe)", () => {
      const p = computeLoopPlan({ istMinutes: at(12, 0), instruments: INDICES, openPositionUnderlyings: ["LEGACY"] });
      expect(p.forceCloseList).toEqual(["LEGACY"]);
    });
  });
});
