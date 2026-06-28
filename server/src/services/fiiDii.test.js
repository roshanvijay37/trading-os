import { describe, it, expect } from "vitest";
import { parseFiiDii } from "./fiiDii.js";

describe("parseFiiDii", () => {
  it("maps NSE FII/FPI and DII rows into {date, fii, dii} legs", () => {
    const raw = [
      { category: "DII **", date: "28-Jun-2026", buyValue: "12,345.67", sellValue: "11,000.00", netValue: "1,345.67" },
      { category: "FII/FPI **", date: "28-Jun-2026", buyValue: "10,000.00", sellValue: "12,000.00", netValue: "-2,000.00" },
    ];
    expect(parseFiiDii(raw)).toEqual({
      date: "28-Jun-2026",
      dii: { buy: 12345.67, sell: 11000, net: 1345.67 },
      fii: { buy: 10000, sell: 12000, net: -2000 },
    });
  });

  it("derives net from buy - sell when netValue is missing", () => {
    const out = parseFiiDii([{ category: "FII", buyValue: "100", sellValue: "40" }]);
    expect(out.fii.net).toBe(60);
    expect(out.dii).toBeNull();
  });

  it("returns null when no FII/DII rows are present", () => {
    expect(parseFiiDii([])).toBeNull();
    expect(parseFiiDii([{ category: "OTHER", netValue: "5" }])).toBeNull();
    expect(parseFiiDii(null)).toBeNull();
    expect(parseFiiDii("not-an-array")).toBeNull();
  });

  it("handles numeric (non-string) values", () => {
    const out = parseFiiDii([{ category: "DII", buyValue: 500, sellValue: 200, netValue: 300 }]);
    expect(out.dii).toEqual({ buy: 500, sell: 200, net: 300 });
  });
});
