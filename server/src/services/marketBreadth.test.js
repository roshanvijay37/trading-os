import { describe, it, expect } from "vitest";
import { changeFromQuoteValue, computeBreadth, NIFTY50_SYMBOLS } from "./marketBreadth.js";

describe("changeFromQuoteValue", () => {
  it("prefers the explicit ch field", () => {
    expect(changeFromQuoteValue({ ch: 1.5, lp: 100, prev_close_price: 90 })).toBe(1.5);
    expect(changeFromQuoteValue({ ch: -2.25 })).toBe(-2.25);
  });
  it("falls back to lp - prev_close when ch is absent", () => {
    expect(changeFromQuoteValue({ lp: 105, prev_close_price: 100 })).toBe(5);
    expect(changeFromQuoteValue({ ltp: 98, prev_close: 100 })).toBe(-2);
  });
  it("falls back to the change-percent sign as a last resort", () => {
    expect(changeFromQuoteValue({ chp: 0.8 })).toBe(0.8);
  });
  it("returns null when nothing usable is present", () => {
    expect(changeFromQuoteValue(null)).toBeNull();
    expect(changeFromQuoteValue({})).toBeNull();
    expect(changeFromQuoteValue({ lp: 100 })).toBeNull(); // no prior reference
  });
});

describe("computeBreadth", () => {
  it("counts advances, declines and unchanged", () => {
    const b = computeBreadth([
      { n: "A", s: "ok", v: { ch: 1 } },
      { n: "B", s: "ok", v: { ch: 2 } },
      { n: "C", s: "ok", v: { ch: -1 } },
      { n: "D", s: "ok", v: { ch: 0 } },
    ]);
    expect(b.advances).toBe(2);
    expect(b.declines).toBe(1);
    expect(b.unchanged).toBe(1);
    expect(b.counted).toBe(4);
    expect(b.ratio).toBe(2); // 2 advances / 1 decline
    expect(b.advancePercent).toBe(50);
    expect(b.trend).toBe("NEUTRAL");
  });

  it("skips errored and malformed items", () => {
    const b = computeBreadth([
      { n: "A", s: "ok", v: { ch: 1 } },
      { n: "B", s: "error", v: { ch: 5 } }, // unresolved symbol -> ignored
      null,
      { n: "C", v: {} }, // no usable change -> ignored
      { n: "D", s: "ok", v: { lp: 110, prev_close_price: 100 } }, // derived +10
    ]);
    expect(b.counted).toBe(2);
    expect(b.advances).toBe(2);
    expect(b.declines).toBe(0);
  });

  it("flags bullish/bearish trend by advance share", () => {
    const up = computeBreadth(Array.from({ length: 10 }, (_, i) => ({ s: "ok", v: { ch: i < 7 ? 1 : -1 } })));
    expect(up.advancePercent).toBe(70);
    expect(up.trend).toBe("BULLISH");
    const down = computeBreadth(Array.from({ length: 10 }, (_, i) => ({ s: "ok", v: { ch: i < 3 ? 1 : -1 } })));
    expect(down.advancePercent).toBe(30);
    expect(down.trend).toBe("BEARISH");
  });

  it("is safe on empty input", () => {
    const b = computeBreadth([]);
    expect(b).toEqual({ advances: 0, declines: 0, unchanged: 0, counted: 0, ratio: 0, advancePercent: 0, trend: "NEUTRAL" });
    expect(computeBreadth(null).counted).toBe(0);
  });

  it("handles an all-advancing basket without dividing by zero", () => {
    const b = computeBreadth([{ s: "ok", v: { ch: 1 } }, { s: "ok", v: { ch: 2 } }]);
    expect(b.ratio).toBe(2); // declines === 0 -> ratio falls back to advance count
    expect(b.trend).toBe("BULLISH");
  });
});

describe("NIFTY50_SYMBOLS", () => {
  it("has 50 unique NSE equity symbols", () => {
    expect(NIFTY50_SYMBOLS).toHaveLength(50);
    expect(new Set(NIFTY50_SYMBOLS).size).toBe(50);
    expect(NIFTY50_SYMBOLS.every((s) => /^NSE:.+-EQ$/.test(s))).toBe(true);
  });
});
