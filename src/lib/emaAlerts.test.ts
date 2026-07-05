import { describe, it, expect } from "vitest";
import { findEmaAlerts, resolveEmaAlerts, type AlertCandle } from "./emaAlerts";

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

describe("resolveEmaAlerts", () => {
  // Deliberately hand-built candles/alerts (not derived via findEmaAlerts) — resolveEmaAlerts
  // takes both as plain inputs, so its trigger/outcome logic can be tested in isolation from the
  // EMA math above. c() args are (close, high, low).
  const c = (close: number, high: number, low: number) => ({ close, high, low });

  it("resolves TARGET when a later candle reaches it before SL", () => {
    // Bullish alert @0: entry = high (110), sl = low (107), risk 3, target = 116.
    const candles = [
      c(108, 110, 107), // alert candle
      c(112, 111, 109), // triggers entry (high 111 >= 110); doesn't resolve (low 109 > 107, high 111 < 116)
      c(118, 119, 115), // target hit (high 119 >= 116); SL not touched (low 115 > 107)
    ];
    const alerts = [{ index: 0, type: "BULLISH" as const }];
    const [result] = resolveEmaAlerts(candles, alerts);
    expect(result).toMatchObject({ entry: 110, sl: 107, target: 116, triggerIndex: 1, outcome: "TARGET", outcomeIndex: 2 });
  });

  it("resolves SL when a later candle hits it before target", () => {
    const candles = [
      c(108, 110, 107),
      c(112, 111, 109), // triggers, doesn't resolve
      c(105, 106, 104), // SL hit (low 104 <= 107); target not reached (high 106 < 116)
    ];
    const alerts = [{ index: 0, type: "BULLISH" as const }];
    const [result] = resolveEmaAlerts(candles, alerts);
    expect(result).toMatchObject({ outcome: "SL", outcomeIndex: 2 });
  });

  it("resolves SL when a single candle's range spans BOTH levels (SL wins the tie, matching the backtest's SL-checked-first order)", () => {
    const candles = [
      c(108, 110, 107),
      c(112, 111, 109),
      c(110, 120, 100), // both SL (low 100 <= 107) and target (high 120 >= 116) are in range
    ];
    const alerts = [{ index: 0, type: "BULLISH" as const }];
    const [result] = resolveEmaAlerts(candles, alerts);
    expect(result.outcome).toBe("SL");
  });

  it("resolves OPEN when the entry has triggered but neither level has been hit yet", () => {
    const candles = [c(108, 110, 107), c(112, 111, 109)];
    const alerts = [{ index: 0, type: "BULLISH" as const }];
    const [result] = resolveEmaAlerts(candles, alerts);
    expect(result).toMatchObject({ triggerIndex: 1, outcome: "OPEN", outcomeIndex: null });
  });

  it("resolves NOT_TRIGGERED when price never reaches the entry level", () => {
    const candles = [c(108, 110, 107), c(109, 109, 106), c(108, 109, 105)];
    const alerts = [{ index: 0, type: "BULLISH" as const }];
    const [result] = resolveEmaAlerts(candles, alerts);
    expect(result).toMatchObject({ triggerIndex: null, outcome: "NOT_TRIGGERED", outcomeIndex: null });
  });

  it("bounds the trigger search at the NEXT alert's candle — a newer alert cancels the old pending order", () => {
    const candles = [
      c(108, 110, 107), // idx0: alert 1 (bullish, entry 110)
      c(109, 109, 106), // idx1: doesn't trigger idx0 (high 109 < 110)
      c(95, 96, 90), // idx2: alert 2 (bearish) — idx0's search must stop before this
      c(112, 111, 109), // idx3: WOULD trigger idx0's entry, but is out of bounds for it
    ];
    const alerts = [
      { index: 0, type: "BULLISH" as const },
      { index: 2, type: "BEARISH" as const },
    ];
    const [first] = resolveEmaAlerts(candles, alerts);
    expect(first).toMatchObject({ triggerIndex: null, outcome: "NOT_TRIGGERED" });
  });

  it("mirrors the bearish (SHORT) formula: entry = alert low, SL = alert high, target = entry - 2x risk", () => {
    // Bearish alert @0: entry = low (90), sl = high (95), risk 5, target = 80.
    const candles = [
      c(92, 95, 90),
      c(85, 91, 84), // triggers (low 84 <= 90); doesn't resolve (high 91 < 95, low 84 > 80)
      c(75, 83, 78), // target hit (low 78 <= 80); SL not touched (high 83 < 95)
    ];
    const alerts = [{ index: 0, type: "BEARISH" as const }];
    const [result] = resolveEmaAlerts(candles, alerts);
    expect(result).toMatchObject({ entry: 90, sl: 95, target: 80, triggerIndex: 1, outcome: "TARGET", outcomeIndex: 2 });
  });
});
