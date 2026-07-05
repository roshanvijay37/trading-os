import { describe, it, expect } from "vitest";
import { findEmaAlerts, type AlertCandle } from "./emaAlerts";

// Flat candles seed both EMAs at exactly the flat close (SMA of identical values = that value,
// and the EMA recurrence never moves away from a constant series) — this makes the arithmetic
// hand-verifiable for the candles that follow.
function flat(close: number, n: number): AlertCandle[] {
  return Array.from({ length: n }, () => ({ close, high: close, low: close }));
}

describe("findEmaAlerts — trendGate: false (plain 5-EMA rule)", () => {
  it("flags a bullish alert candle entirely below the 5-EMA", () => {
    // 25 flat candles at 100 (ema5 settles at exactly 100), then a dip candle (idx 25: close 90,
    // high 93 — entirely below 100), then one more candle so ema5-at-(i+1) is computable.
    // Hand-derived: ema5-at-25 (used to judge idx24) = 96.667, ema5-at-26 (used to judge idx25) =
    // 94.444. idx25 (close 90, high 93) sits below 94.444 → bullish, as expected. But idx24 is
    // ALSO flagged (bearish!): it's flat at 100, and 100 is now above the 96.667 the incoming dip
    // already pulled the EMA down to — a real, if surprising, property of "candle i judged by the
    // EMA at i+1": a quiet candle immediately before a sharp move can get flagged in the
    // OPPOSITE direction, purely because the fast EMA reacts one bar ahead of the candle's own
    // one-time evaluation. This isn't a bug — it's exactly what emaStrategy.js would also flag.
    const candles = [...flat(100, 25), { close: 90, high: 93, low: 85 }, { close: 90, high: 91, low: 89 }];
    const alerts = findEmaAlerts(candles, { trendGate: false });
    expect(alerts).toEqual([
      { index: 24, type: "BEARISH" },
      { index: 25, type: "BULLISH" },
    ]);
  });

  it("flags a bearish alert candle entirely above the 5-EMA", () => {
    // Mirror image: a spike candle (idx 25: close 110, low 107 — entirely above 100). Same
    // "judged one bar ahead" effect flags the preceding flat candle (idx 24) bullish first.
    const candles = [...flat(100, 25), { close: 110, high: 115, low: 107 }, { close: 110, high: 111, low: 109 }];
    const alerts = findEmaAlerts(candles, { trendGate: false });
    expect(alerts).toEqual([
      { index: 24, type: "BULLISH" },
      { index: 25, type: "BEARISH" },
    ]);
  });

  it("never flags the last candle (no i+1 to compute its judging EMA from)", () => {
    const candles = [...flat(100, 25), { close: 90, high: 93, low: 85 }];
    const alerts = findEmaAlerts(candles, { trendGate: false });
    expect(alerts.every((a) => a.index < candles.length - 1)).toBe(true);
  });

  it("returns no alerts with fewer than 6 candles (can't seed the 5-EMA)", () => {
    expect(findEmaAlerts(flat(100, 5), { trendGate: false })).toEqual([]);
  });
});

describe("findEmaAlerts — trendGate: true (EMA5T, the default and what the live bot trades)", () => {
  it("flags a bullish alert only when the pullback stays above the slower 20-EMA trend line", () => {
    // 20 flat candles at 100 (seeds the 20-EMA), then a 9-candle rise to 118 (pulls the fast
    // 5-EMA up close to price while the slow 20-EMA lags further behind), then a pullback candle
    // (idx 29: close/high 110, entirely below the 5-EMA but still above the lagging 20-EMA), then
    // one more candle so the 5-EMA judging value is computable.
    // Hand-derived: ema5-at-30 = 111.824, ema20-at-29 = 107.031. Candle 29 (close=high=110):
    // 110 > 107.031 (above trend) AND 110 < 111.824 (below fast EMA) → bullish.
    const rise = [102, 104, 106, 108, 110, 112, 114, 116, 118].map((close) => ({ close, high: close, low: close }));
    const candles: AlertCandle[] = [
      ...flat(100, 20),
      ...rise,
      { close: 110, high: 110, low: 107 },
      { close: 110, high: 111, low: 109 },
    ];
    const alerts = findEmaAlerts(candles); // default trendGate: true
    expect(alerts).toEqual([{ index: 29, type: "BULLISH" }]);
  });

  it("does not flag a dip that also falls below the 20-EMA trend line (fails the trend gate)", () => {
    // A flat series with a single dip pulls both EMAs down together — close ends up BELOW the
    // (lagging) 20-EMA too, not above it, so the trend-gated bullish condition never holds.
    const candles = [...flat(100, 25), { close: 90, high: 93, low: 85 }, { close: 90, high: 91, low: 89 }];
    expect(findEmaAlerts(candles)).toEqual([]);
  });

  it("returns no alerts with fewer than 20 candles (can't seed the 20-EMA)", () => {
    expect(findEmaAlerts(flat(100, 19))).toEqual([]);
  });
});
