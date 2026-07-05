import { describe, it, expect } from "vitest";
import { parseNseHolidays } from "./marketHolidays.js";

// refreshHolidays() must never let a schema change or an empty NSE response silently overwrite
// a good cached/default holiday list with nothing — parseNseHolidays throws in that case so the
// caller's catch block falls back to the existing cache instead of "succeeding" with [].
describe("parseNseHolidays", () => {
  it("maps NSE's DD-MMM-YYYY trading-date rows to { date: YYYY-MM-DD, name }", () => {
    const raw = [
      { tradingDate: "26-Jan-2026", description: "Republic Day" },
      { tradingDate: "15-Aug-2026", description: "Independence Day" },
    ];
    expect(parseNseHolidays(raw)).toEqual([
      { date: "2026-01-26", name: "Republic Day" },
      { date: "2026-08-15", name: "Independence Day" },
    ]);
  });

  it("skips non-trading rows (no tradingDate) and unparseable dates", () => {
    const raw = [
      { clearingDate: "26-Jan-2026", description: "not a trading holiday" }, // no tradingDate
      { tradingDate: "not-a-date", description: "garbage" },
      { tradingDate: "26-Jan-2026", description: "Republic Day" },
    ];
    expect(parseNseHolidays(raw)).toEqual([{ date: "2026-01-26", name: "Republic Day" }]);
  });

  it("defaults a missing description to 'Market Holiday'", () => {
    expect(parseNseHolidays([{ tradingDate: "26-Jan-2026" }])).toEqual([
      { date: "2026-01-26", name: "Market Holiday" },
    ]);
  });

  it("throws (does not return []) when NSE returns zero valid holidays", () => {
    expect(() => parseNseHolidays([])).toThrow();
    expect(() => parseNseHolidays([{ tradingDate: "garbage-date" }])).toThrow();
  });

  it("throws on a non-array / malformed response instead of silently returning []", () => {
    expect(() => parseNseHolidays(null)).toThrow();
    expect(() => parseNseHolidays(undefined)).toThrow();
    expect(() => parseNseHolidays({ not: "an array" })).toThrow();
  });
});
