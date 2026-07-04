import { describe, it, expect } from "vitest";
import { isCandleStale, isTickStale } from "./autoTrader.js";

// A stalled-but-still-"connected" feed is otherwise indistinguishable from a healthy one
// (getWsStatus() only reports connection state, not data recency) — these gate whether a live
// resting entry order should be placed/held, not whether an existing position gets monitored.
describe("isCandleStale", () => {
  const tf = 15; // minutes
  const periodSec = tf * 60;

  it("is not stale immediately after the last candle's period ends", () => {
    const periodStart = 1_000_000;
    const candles = [[periodStart, 1, 2, 0.5, 1.5, 100]];
    const now = periodStart + periodSec; // exactly at period end
    expect(isCandleStale(candles, tf, now)).toBe(false);
  });

  it("is not stale within the tolerance window (normal poll jitter)", () => {
    const periodStart = 1_000_000;
    const candles = [[periodStart, 1, 2, 0.5, 1.5, 100]];
    const now = periodStart + periodSec + periodSec * 2; // 2 periods late, within default 2.5x tolerance
    expect(isCandleStale(candles, tf, now)).toBe(false);
  });

  it("is stale once the last candle is older than the tolerance window", () => {
    const periodStart = 1_000_000;
    const candles = [[periodStart, 1, 2, 0.5, 1.5, 100]];
    const now = periodStart + periodSec + periodSec * 3; // 3 periods late, past default 2.5x
    expect(isCandleStale(candles, tf, now)).toBe(true);
  });

  it("respects a custom tolerance multiple", () => {
    const periodStart = 1_000_000;
    const candles = [[periodStart, 1, 2, 0.5, 1.5, 100]];
    const now = periodStart + periodSec + periodSec * 1.5;
    expect(isCandleStale(candles, tf, now, 1)).toBe(true); // tight tolerance -> stale
    expect(isCandleStale(candles, tf, now, 2)).toBe(false); // looser tolerance -> not stale
  });

  it("is stale (fail-safe) for missing/empty candle data", () => {
    expect(isCandleStale([], tf)).toBe(true);
    expect(isCandleStale(null, tf)).toBe(true);
    expect(isCandleStale(undefined, tf)).toBe(true);
  });

  it("is stale (fail-safe) when the last candle has no valid timestamp", () => {
    expect(isCandleStale([[0, 1, 2, 0.5, 1.5, 100]], tf, 1_000_000)).toBe(true);
  });
});

describe("isTickStale", () => {
  it("is not stale for a recent tick", () => {
    const now = 1_000_000_000;
    const tick = { symbol: "BANKNIFTY", ltp: 55000, timestamp: now - 30_000 }; // 30s old
    expect(isTickStale(tick, now)).toBe(false);
  });

  it("is stale once older than the threshold (default 3 min)", () => {
    const now = 1_000_000_000;
    const tick = { symbol: "BANKNIFTY", ltp: 55000, timestamp: now - 4 * 60 * 1000 };
    expect(isTickStale(tick, now)).toBe(true);
  });

  it("respects a custom threshold", () => {
    const now = 1_000_000_000;
    const tick = { symbol: "BANKNIFTY", ltp: 55000, timestamp: now - 90_000 }; // 90s old
    expect(isTickStale(tick, now, 60_000)).toBe(true); // 60s threshold -> stale
    expect(isTickStale(tick, now, 120_000)).toBe(false); // 120s threshold -> not stale
  });

  it("is stale (fail-safe) for a missing tick or missing timestamp", () => {
    expect(isTickStale(null)).toBe(true);
    expect(isTickStale(undefined)).toBe(true);
    expect(isTickStale({ symbol: "X", ltp: 100 })).toBe(true);
  });
});
