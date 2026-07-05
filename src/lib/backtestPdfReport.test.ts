import { describe, it, expect } from "vitest";
import { friendlyInstrument, inr, pct } from "./backtestPdfReport";

describe("friendlyInstrument (PDF report symbol mapping)", () => {
  it("maps known FYERS index symbols to a generic display name", () => {
    expect(friendlyInstrument("NSE:NIFTYBANK-INDEX")).toBe("Bank Nifty");
    expect(friendlyInstrument("NSE:NIFTY50-INDEX")).toBe("Nifty 50");
  });

  it("never leaks a raw/unmapped or futures-contract symbol into the report", () => {
    // e.g. a resolved futures contract code like NSE:BANKNIFTY26JULFUT must not appear verbatim —
    // falls back to a generic label instead.
    expect(friendlyInstrument("NSE:BANKNIFTY26JULFUT")).toBe("Index");
    expect(friendlyInstrument("something-unexpected")).toBe("Index");
  });
});

describe("inr (currency formatting)", () => {
  it("formats a positive number with the rupee sign and Indian digit grouping", () => {
    expect(inr(1234567)).toBe("₹12,34,567");
  });

  it("rounds to the nearest whole rupee", () => {
    expect(inr(999.6)).toBe("₹1,000");
  });

  it("formats zero and negative values without throwing", () => {
    expect(inr(0)).toBe("₹0");
    expect(inr(-500)).toBe("₹-500");
  });
});

describe("pct (percentage formatting)", () => {
  it("prefixes a positive value with a + sign", () => {
    expect(pct(12.345)).toBe("+12.35%");
  });

  it("does not double up a minus sign for negative values", () => {
    expect(pct(-8.2)).toBe("-8.20%");
  });

  it("treats exactly zero as non-negative (prefixed with +)", () => {
    expect(pct(0)).toBe("+0.00%");
  });
});
