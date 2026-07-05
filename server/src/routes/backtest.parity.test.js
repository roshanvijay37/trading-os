import { describe, it, expect } from "vitest";
import { istClock, liveEntryGate, runBacktest } from "./backtest.js";

// C3: the backtest now applies the same entry gates as the live bot, so it stops over-stating
// achievable P&L. These pure helpers back that gating.
describe("istClock (IST wall-clock from epoch ms)", () => {
  it("maps 03:45 UTC to 09:15 IST", () => {
    const ms = (3 * 60 + 45) * 60 * 1000; // 03:45:00 UTC
    expect(istClock(ms)).toMatchObject({ hour: 9, minute: 15, decimal: 9.25 });
  });
  it("maps 08:30 UTC to 14:00 IST (the entry cutoff)", () => {
    const ms = (8 * 60 + 30) * 60 * 1000;
    expect(istClock(ms)).toMatchObject({ hour: 14, minute: 0 });
  });
  it("maps 09:45 UTC to 15:15 IST (square-off)", () => {
    const ms = (9 * 60 + 45) * 60 * 1000;
    expect(istClock(ms)).toMatchObject({ hour: 15, minute: 15 });
  });
});

// VIX and consecutive-loss gates were removed at the user's request (not needed for either
// backtest or live) — liveEntryGate now only covers session window, entry cutoff, max
// trades/day, and daily loss.
describe("liveEntryGate (backtest ↔ live entry parity)", () => {
  const limits = {
    sessionStartDecimal: 9.25, sessionEndDecimal: 15.0, maxTimeEntryHour: 14,
    maxTradesPerDay: 10, dailyLossCap: 2000,
  };
  const base = { decimal: 10, hour: 10, dayTrades: 0, dayPnL: 0 };

  it("allows a clean mid-morning signal", () => {
    expect(liveEntryGate(base, limits)).toEqual({ allow: true, reason: "" });
  });
  it("blocks before the session opens", () => {
    expect(liveEntryGate({ ...base, decimal: 9.0 }, limits).reason).toBe("OUTSIDE_SESSION");
  });
  it("blocks at/after the 14:00 entry cutoff", () => {
    expect(liveEntryGate({ ...base, hour: 14, decimal: 14 }, limits).reason).toBe("AFTER_ENTRY_CUTOFF");
  });
  it("blocks once max trades/day is hit", () => {
    expect(liveEntryGate({ ...base, dayTrades: 10 }, limits).reason).toBe("MAX_TRADES");
  });
  it("blocks once the daily loss cap is breached", () => {
    expect(liveEntryGate({ ...base, dayPnL: -2000 }, limits).reason).toBe("DAILY_LOSS_LIMIT");
  });
});

// Position sizing (RISK vs LOTS): a synthetic decline-then-rally series, generous enough in
// magnitude to reliably form a 5-EMA alert (candle entirely below a lagging EMA during the
// decline) and trigger a breakout entry once the rally clears the alert candle's high. All
// timestamps sit inside a single IST trading session (9:20-13:00), well before the 14:00 entry
// cutoff, so applyLiveFilters's session/time gates never block it.
function buildDeclineRallyCandles() {
  const startMs = Date.UTC(2024, 0, 2, 3, 50, 0); // 2024-01-02 09:20 IST
  const candles = [];
  let t = startMs;
  const push = (close, range = 20) => {
    candles.push({
      timestamp: t,
      datetime: new Date(t).toISOString(),
      open: close,
      high: close + range,
      low: close - range,
      close,
      volume: 1000,
    });
    t += 5 * 60 * 1000; // 5-minute bars
  };
  for (let k = 0; k < 10; k++) push(30000, 5); // flat warmup, seeds the EMA at 30000
  let price = 30000;
  for (let k = 0; k < 10; k++) { price -= 500; push(price, 30); } // fast decline (EMA lags behind)
  for (let k = 0; k < 10; k++) { price += 1500; push(price, 30); } // sharp rally clears the alert high
  return candles;
}

describe("runBacktest position sizing (RISK vs LOTS)", () => {
  const candles = buildDeclineRallyCandles();
  const baseConfig = {
    symbol: "NSE:NIFTYBANK-INDEX", // lotSize 30 per getOptionDefaults
    strategy: "EMA5",
    capital: 1000000,
    riskPercent: 1,
    targetMultiplier: 2,
    pricingModel: "INDEX",
    applyLiveFilters: true,
  };

  it("RISK mode (default) sizes qty from risk%/stop distance, same as before this feature existed", () => {
    const result = runBacktest(candles, baseConfig);
    expect(result.trades.length).toBeGreaterThan(0);
    // Risk-based qty is NOT a fixed lot multiple in general — this is the pre-existing behaviour.
    for (const tr of result.trades) {
      expect(tr.qty).toBeGreaterThan(0);
    }
  });

  it("LOTS mode trades a fixed qty (lotSize × fixedLots) on every trade, regardless of stop distance", () => {
    const result = runBacktest(candles, { ...baseConfig, positionSizingMode: "LOTS", fixedLots: 2 });
    expect(result.trades.length).toBeGreaterThan(0);
    for (const tr of result.trades) {
      expect(tr.qty).toBe(60); // BANKNIFTY lotSize 30 × fixedLots 2
    }
  });

  it("LOTS mode with fixedLots 1 matches EMA5T's live sizing exactly (lotSize × 1)", () => {
    const result = runBacktest(candles, { ...baseConfig, positionSizingMode: "LOTS", fixedLots: 1 });
    expect(result.trades.length).toBeGreaterThan(0);
    for (const tr of result.trades) {
      expect(tr.qty).toBe(30);
    }
  });

  it("RISK and LOTS modes produce a different qty for the same signal (the mode genuinely changes sizing)", () => {
    const riskResult = runBacktest(candles, baseConfig);
    const lotsResult = runBacktest(candles, { ...baseConfig, positionSizingMode: "LOTS", fixedLots: 1 });
    expect(riskResult.trades[0].qty).not.toBe(lotsResult.trades[0].qty);
  });
});

// Regression for a bug reported against the live app: routes/backtest.js's POST /run handler
// destructured req.body but never included `slippage` in it, nor forwarded it into the
// runBacktest(candles, config) call — so the UI's "Slippage %" field silently had zero effect
// no matter what the user set (confirmed: 1% and 5% produced byte-identical results). runBacktest
// itself always applied slippage correctly; the field was just dropped one layer up, in the
// route handler. These tests pin the underlying behaviour the route depends on: config.slippage
// must measurably change entry/exit prices and P&L.
describe("runBacktest slippage", () => {
  const candles = buildDeclineRallyCandles();
  const baseConfig = {
    symbol: "NSE:NIFTYBANK-INDEX",
    strategy: "EMA5",
    capital: 1000000,
    riskPercent: 1,
    targetMultiplier: 2,
    pricingModel: "INDEX",
    applyLiveFilters: true,
  };

  it("a larger slippage widens the entry price away from the raw breakout level", () => {
    const low = runBacktest(candles, { ...baseConfig, slippage: 0.0001 });
    const high = runBacktest(candles, { ...baseConfig, slippage: 0.05 });
    expect(low.trades.length).toBeGreaterThan(0);
    expect(high.trades.length).toBeGreaterThan(0);
    expect(low.trades[0].entryPrice).not.toBe(high.trades[0].entryPrice);
  });

  it("higher slippage produces a different (worse or equal) total P&L than near-zero slippage", () => {
    const zero = runBacktest(candles, { ...baseConfig, slippage: 0 });
    const five = runBacktest(candles, { ...baseConfig, slippage: 0.05 }); // 5% — matches the user's report
    expect(zero.summary.totalPnL).not.toBe(five.summary.totalPnL);
  });

  it("defaults to 0.02% when slippage is omitted from config (matches the route handler's default)", () => {
    const omitted = runBacktest(candles, baseConfig);
    const explicit = runBacktest(candles, { ...baseConfig, slippage: 0.0002 });
    expect(omitted.trades[0].entryPrice).toBe(explicit.trades[0].entryPrice);
  });
});
