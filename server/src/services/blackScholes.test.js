import { describe, it, expect } from "vitest";
import { yearsToExpiry, yearsToMonthlyExpiry, getOptionDefaults } from "./blackScholes.js";

// Regression coverage for the BankNifty expiry-cycle bug: the backtest previously assumed every
// index option was a WEEKLY-Thursday contract, but NSE discontinued BankNifty's weeklies — its
// currently-listed contract is monthly. Treating it as weekly priced the option far too cheap and
// far too gamma-sensitive (confirmed 2026-07-08 against BankNifty's real historical premiums).

describe("getOptionDefaults expiry cycle", () => {
  it("BANKNIFTY is monthly (Wednesday) — NSE discontinued its weeklies", () => {
    const d = getOptionDefaults("NSE:NIFTYBANK-INDEX");
    expect(d.expiryFrequency).toBe("MONTHLY");
    expect(d.expiryWeekday).toBe(3);
  });

  it("NIFTY stays weekly, but on Tuesday not Thursday — confirmed by probing FYERS for real contracts", () => {
    const d = getOptionDefaults("NSE:NIFTY50-INDEX");
    expect(d.expiryFrequency).toBe("WEEKLY");
    expect(d.expiryWeekday).toBe(2);
  });

  it("FINNIFTY/SENSEX default to monthly too (best-effort, not independently re-verified)", () => {
    expect(getOptionDefaults("NSE:FINNIFTY-INDEX").expiryFrequency).toBe("MONTHLY");
    expect(getOptionDefaults("BSE:SENSEX-INDEX").expiryFrequency).toBe("MONTHLY");
  });
});

describe("yearsToMonthlyExpiry", () => {
  // IST wall-clock instant → epoch ms, mirroring the function's own +330min convention.
  function istMs(year, month, day, hour, minute) {
    return Date.UTC(year, month, day, hour, minute) - 330 * 60000;
  }

  it("finds the LAST Wednesday of the month, not the next weekly Wednesday", () => {
    // July 2026's Wednesdays: 1, 8, 15, 22, 29 — the last one is the 29th.
    const midMonth = istMs(2026, 6, 15, 10, 0); // July 15, 10:00 IST
    const years = yearsToMonthlyExpiry(midMonth, 3);
    const expectedExpiryMs = istMs(2026, 6, 29, 15, 30);
    const expectedYears = (expectedExpiryMs - midMonth) / 60000 / (365 * 24 * 60);
    expect(years).toBeCloseTo(expectedYears, 6);
  });

  it("rolls to next month's last Wednesday once past this month's settlement", () => {
    const afterExpiry = istMs(2026, 6, 30, 10, 0); // July 30 — a day after the 29th's settlement
    const years = yearsToMonthlyExpiry(afterExpiry, 3);
    // August 2026's Wednesdays: 5, 12, 19, 26 — last is the 26th.
    const expectedExpiryMs = istMs(2026, 7, 26, 15, 30);
    const expectedYears = (expectedExpiryMs - afterExpiry) / 60000 / (365 * 24 * 60);
    expect(years).toBeCloseTo(expectedYears, 6);
  });

  it("does not roll over on expiry day itself before the settlement hour", () => {
    const beforeSettlement = istMs(2026, 6, 29, 11, 0); // July 29, 11:00 IST — same day, before 15:30
    const years = yearsToMonthlyExpiry(beforeSettlement, 3);
    const expectedExpiryMs = istMs(2026, 6, 29, 15, 30);
    const expectedYears = (expectedExpiryMs - beforeSettlement) / 60000 / (365 * 24 * 60);
    expect(years).toBeCloseTo(expectedYears, 6);
  });

  it("rolls over on expiry day itself once past the settlement hour", () => {
    const afterSettlement = istMs(2026, 6, 29, 16, 0); // July 29, 16:00 IST — past 15:30
    const years = yearsToMonthlyExpiry(afterSettlement, 3);
    const expectedExpiryMs = istMs(2026, 7, 26, 15, 30); // rolls to August's last Wednesday
    const expectedYears = (expectedExpiryMs - afterSettlement) / 60000 / (365 * 24 * 60);
    expect(years).toBeCloseTo(expectedYears, 6);
  });

  it("gives a materially longer time-to-expiry than the (wrong) weekly assumption mid-month", () => {
    const midMonth = istMs(2026, 6, 15, 10, 0);
    const monthly = yearsToMonthlyExpiry(midMonth, 3);
    const weekly = yearsToExpiry(midMonth, 3);
    // Mid-month, the real (monthly) expiry is ~2 weeks further out than a same-weekday weekly
    // assumption would claim — this gap is exactly what made the BS model price BankNifty options
    // far too cheap and far too gamma-sensitive.
    expect(monthly).toBeGreaterThan(weekly * 3);
  });
});
