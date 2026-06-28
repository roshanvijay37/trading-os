import { describe, it, expect } from "vitest";
import { calculateEMA, calculateATR, type Candle } from "./engine";

function mkCandle(i: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: i,
    datetime: new Date(2026, 0, 1, 9, 15 + i).toISOString(),
    open: close,
    high,
    low,
    close,
    volume: 1000,
  };
}

describe("engine.calculateEMA (backtest/canonical EMA)", () => {
  it("returns an empty array when there are fewer closes than the period", () => {
    expect(calculateEMA([1, 2, 3], 5)).toEqual([]);
  });

  it("seeds the first EMA with the SMA of the first `period` closes", () => {
    // [10,11,12,13,14] -> SMA(5) = 12. This is the BACKTEST seeding.
    // The LIVE engine (server/src/services/emaStrategy.js) seeds from the first close and
    // yields 12.4 for the same input — see emaStrategy.test.js. That divergence is exactly
    // what roadmap item #2 (unify live + backtest signal path) must resolve. These two
    // tests pin the current behaviour so the unification is a deliberate, visible change.
    expect(calculateEMA([10, 11, 12, 13, 14], 5)).toEqual([12]);
  });

  it("continues smoothing after the seed", () => {
    const ema = calculateEMA([10, 11, 12, 13, 14, 15], 5);
    expect(ema).toHaveLength(2);
    expect(ema[0]).toBe(12);
    expect(ema[1]).toBeCloseTo(13, 5); // (15-12)*(2/6)+12
  });
});

describe("engine.calculateATR", () => {
  it("returns an empty array when there are not enough candles", () => {
    const candles = [mkCandle(0, 10, 8, 9), mkCandle(1, 11, 9, 10)];
    expect(calculateATR(candles, 14)).toEqual([]);
  });

  it("produces (candles.length - period) ATR values, all positive and finite", () => {
    const candles = [
      mkCandle(0, 10, 8, 9),
      mkCandle(1, 11, 9, 10),
      mkCandle(2, 12, 10, 11),
      mkCandle(3, 13, 11, 12),
      mkCandle(4, 14, 12, 13),
      mkCandle(5, 15, 13, 14),
    ];
    const atr = calculateATR(candles, 2);
    expect(atr).toHaveLength(candles.length - 2);
    for (const v of atr) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});
