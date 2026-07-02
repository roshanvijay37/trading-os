import { describe, expect, it } from "vitest";
import { sanitizeCandles } from "./CandlesChart";
import { nearestByX, nearestIndex } from "./svgHover";

describe("sanitizeCandles", () => {
  const c = (time: number, close = 100) => ({ time, open: 99, high: 101, low: 98, close });

  it("sorts ascending by time", () => {
    const out = sanitizeCandles([c(30), c(10), c(20)]);
    expect(out.map((x) => x.time)).toEqual([10, 20, 30]);
  });

  it("dedupes by time, keeping the last occurrence (overlapping FYERS fetches)", () => {
    const out = sanitizeCandles([c(10, 100), c(20), c(10, 111)]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ time: 10, close: 111 });
  });

  it("drops candles with missing/NaN times or prices", () => {
    const out = sanitizeCandles([
      c(10),
      { time: 0, open: 1, high: 1, low: 1, close: 1 },
      { time: 20, open: NaN, high: 1, low: 1, close: 1 },
      { time: NaN, open: 1, high: 1, low: 1, close: 1 },
    ]);
    expect(out.map((x) => x.time)).toEqual([10]);
  });
});

describe("nearestIndex", () => {
  const opts = { width: 100, padL: 10, padR: 10, count: 9 }; // 9 points across 80px → every 10px

  it("maps x positions to the nearest point", () => {
    expect(nearestIndex(10, opts)).toBe(0);
    expect(nearestIndex(50, opts)).toBe(4);
    expect(nearestIndex(54, opts)).toBe(4);
    expect(nearestIndex(56, opts)).toBe(5);
    expect(nearestIndex(90, opts)).toBe(8);
  });

  it("clamps positions outside the padded plot area", () => {
    expect(nearestIndex(0, opts)).toBe(0);
    expect(nearestIndex(100, opts)).toBe(8);
  });

  it("handles degenerate inputs", () => {
    expect(nearestIndex(50, { ...opts, count: 0 })).toBeNull();
    expect(nearestIndex(50, { ...opts, count: 1 })).toBe(0);
    expect(nearestIndex(50, { width: 15, padL: 10, padR: 10, count: 5 })).toBeNull();
  });
});

describe("nearestByX", () => {
  it("finds the nearest point in an unevenly spaced ascending array", () => {
    const xs = [10, 12, 50, 90];
    expect(nearestByX(0, xs)).toBe(0);
    expect(nearestByX(11.4, xs)).toBe(1);
    expect(nearestByX(30, xs)).toBe(1);
    expect(nearestByX(32, xs)).toBe(2);
    expect(nearestByX(75, xs)).toBe(3);
    expect(nearestByX(200, xs)).toBe(3);
  });

  it("handles empty and single-point arrays", () => {
    expect(nearestByX(5, [])).toBeNull();
    expect(nearestByX(5, [42])).toBe(0);
  });
});
