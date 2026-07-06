import { describe, it, expect } from "vitest";
import { computeHistoryFromTs } from "./autoTrader.js";

// Regression: fetchLatestCandles used to size its lookback in wall-clock hours derived from
// candle count (tf * 60 * HISTORY_CANDLES) — e.g. 15m x 80 candles = 20 hours. NSE only trades
// ~6.25h/day, so right after a weekend that window landed on SUNDAY, entirely missing Friday's
// session. An alert candle at Friday's close breaking out at Monday's open is a normal EMA5T
// setup, but it was silently invisible to live/paper trading (processCandles just saw <6 candles
// and skipped — no error). computeHistoryFromTs now looks back a flat, generous number of
// CALENDAR days instead, so it can never miss the immediately preceding trading session.
describe("computeHistoryFromTs (candle-fetch lookback window)", () => {
  it("reaches back far enough to include Friday's last candle when 'now' is Monday's market open", () => {
    // Friday 2026-07-03 15:15 IST candle start == 2026-07-03T09:45:00Z (matches the real
    // BANKNIFTY26JULFUT data that exposed this bug).
    const fridayLastCandleTs = Date.UTC(2026, 6, 3, 9, 45, 0) / 1000;
    // Monday 2026-07-06 09:15 IST market open == 2026-07-06T03:45:00Z.
    const mondayOpenTs = Date.UTC(2026, 6, 6, 3, 45, 0) / 1000;

    const from = computeHistoryFromTs(mondayOpenTs);
    expect(from).toBeLessThanOrEqual(fridayLastCandleTs);
  });

  it("still reaches back far enough after a public holiday adjacent to a weekend (up to 4 non-trading days)", () => {
    // Simulate a Tuesday reopening after a Friday holiday + weekend (4 non-trading days).
    const lastTradingDayCandleTs = Date.UTC(2026, 6, 2, 9, 45, 0) / 1000; // Thursday close
    const reopenTs = Date.UTC(2026, 6, 7, 3, 45, 0) / 1000; // Tuesday open

    const from = computeHistoryFromTs(reopenTs);
    expect(from).toBeLessThanOrEqual(lastTradingDayCandleTs);
  });

  it("looks back a flat ~21 calendar days regardless of when 'now' is", () => {
    const now = Date.UTC(2026, 6, 6, 3, 45, 0) / 1000;
    const from = computeHistoryFromTs(now);
    const daysBack = (now - from) / (24 * 60 * 60);
    expect(daysBack).toBe(21);
  });

  it("defaults to the current time when no argument is given", () => {
    const before = Math.floor(Date.now() / 1000);
    const from = computeHistoryFromTs();
    const after = Math.floor(Date.now() / 1000);
    expect(from).toBeGreaterThanOrEqual(before - 21 * 24 * 60 * 60);
    expect(from).toBeLessThanOrEqual(after - 21 * 24 * 60 * 60);
  });
});
