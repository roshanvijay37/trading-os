import { describe, it, expect } from "vitest";
import { runBacktest } from "./backtest.js";

// Regression for the consecutive-loss breaker PARITY bug.
//
// The backtest gate blocks new entries once consecutiveLosses >= maxConsecutiveLossesLimit, and the
// counter only clears on a WIN. The live bot (autoTrader) resets that counter to 0 at the start of
// every IST day, so it's an INTRADAY stop. The backtest used to NOT reset it at the day boundary, so
// a strategy that hit the limit once was permanently frozen for the rest of the run (blocked ⇒ no
// new trades ⇒ no wins ⇒ counter never cleared). That silently under-counted trades (e.g. EMA5 showing
// only ~3 trades over months) and broke backtest↔live parity.
//
// Construction: a choppy, down-drifting series triggers LONG breakout entries that mostly lose. With
// maxConsecutiveLossesLimit=1 the breaker trips after the FIRST loss each day. Under the bug every
// trade lands on day 1 (permanent block after that day's first loss); with the daily reset, later days
// trade again — so trades must span more than one calendar/IST day. Deterministic (seeded PRNG).
describe("backtest consecutive-loss breaker resets each IST day (live parity)", () => {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function choppyDownCandles({ days, barsPerDay, seed, noise, drift }) {
    const rnd = mulberry32(seed);
    const candles = [];
    let price = 50000;
    for (let d = 0; d < days; d++) {
      // Consecutive calendar days; 09:15 IST = 03:45 UTC. barsPerDay*5min stays before 14:00 IST so
      // entries are allowed, and IST 09:15–14:00 sits inside one UTC date → the UTC date prefix of
      // entryTime identifies the trading day.
      const dayStartUtc = Date.parse(`2025-01-${String(6 + d).padStart(2, "0")}T03:45:00Z`);
      for (let k = 0; k < barsPerDay; k++) {
        const utcMs = dayStartUtc + k * 5 * 60 * 1000;
        const shock = (rnd() - 0.5) * noise; // choppy: frequent up-ticks trigger long breakouts
        const open = price;
        const close = open + drift + shock; // net down-drift → those longs mostly lose
        const high = Math.max(open, close) + rnd() * noise * 0.4;
        const low = Math.min(open, close) - rnd() * noise * 0.4;
        candles.push({ timestamp: utcMs, datetime: new Date(utcMs).toISOString(), open, high, low, close });
        price = close;
      }
    }
    return candles;
  }

  it("keeps trading on later days instead of freezing after the first loss", () => {
    const candles = choppyDownCandles({ days: 6, barsPerDay: 55, seed: 7, noise: 120, drift: -3 });
    const result = runBacktest(candles, {
      strategy: "EMA5",
      pricingModel: "INDEX",
      applyLiveFilters: true,
      maxConsecutiveLossesLimit: 1, // trips after a single loss → isolates the daily-reset behaviour
      maxTradesPerDay: 50, // high, so max-trades/day never masks the consecutive-loss behaviour
    });
    const trades = result.trades || [];

    // Sanity: the series must actually produce losing trades, or the test proves nothing.
    expect(trades.length).toBeGreaterThanOrEqual(2);
    expect(trades.some((t) => t.pnl < 0)).toBe(true);

    // The fix: with the counter reset each new IST day, trades span MORE THAN ONE day. Under the bug
    // (no daily reset, limit=1) every trade would fall on day 1 — a permanent block after the first loss.
    const tradeDays = new Set(trades.map((t) => String(t.entryTime).slice(0, 10)));
    expect(tradeDays.size).toBeGreaterThanOrEqual(2);
  });
});
