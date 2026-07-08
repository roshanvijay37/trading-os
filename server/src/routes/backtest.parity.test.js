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

// Regression tests for the SL exit fill-price fix: the model previously assumed the BETTER of
// {candle.open, sl} regardless of which side of a gap the candle fell on, understating every
// backtested stop-loss loss (confirmed against a real live/paper trade — the backtest showed
// -₹2,052.90 for a setup that actually lost -₹4,472.99). It must instead assume the WORSE of the
// two: fill AT the SL level when there's no gap, and at the (worse) open when the candle genuinely
// gapped through the SL — mirroring how the TARGET branch already behaves and how a real resting
// stop order fills.
describe("runBacktest SL exit fill price (worst-case, not best-case)", () => {
  const baseConfig = {
    symbol: "NSE:NIFTYBANK-INDEX",
    strategy: "EMA5",
    capital: 1000000,
    riskPercent: 1,
    targetMultiplier: 2,
    pricingModel: "INDEX",
    applyLiveFilters: true,
  };

  function buildCandles(events) {
    const startMs = Date.UTC(2024, 0, 2, 3, 50, 0); // 2024-01-02 09:20 IST
    const candles = [];
    let t = startMs;
    for (const [open, high, low, close] of events) {
      candles.push({ timestamp: t, datetime: new Date(t).toISOString(), open, high, low, close, volume: 1000 });
      t += 5 * 60 * 1000;
    }
    return candles;
  }

  // 8 flat candles seed the 5-EMA at exactly 30000, then: an alert candle entirely below the EMA
  // (BULLISH), a breakout candle that clears the alert high while gapping through the nominal entry
  // at its own open (opens a LONG at entryPrice 30006 / sl 29800), then a follow-up candle whose LOW
  // touches the SL intrabar while its OPEN (29900) sits safely above it — no gap, the exact case the
  // bug was in.
  const longNoGap = buildCandles([
    ...Array(8).fill([30000, 30000, 30000, 30000]),
    [29900, 29950, 29800, 29900],
    [30000, 30100, 29900, 30050],
    [29900, 29950, 29700, 29750],
  ]);

  it("fills a LONG SL exit AT the SL level when the candle didn't gap through it (not at the more favorable open)", () => {
    const result = runBacktest(longNoGap, baseConfig);
    expect(result.trades.length).toBe(1);
    const tr = result.trades[0];
    expect(tr.entryPrice).toBe(30006);
    expect(tr.sl).toBe(29800);
    expect(tr.exitReason).toBe("SL");
    // Worst-case fill: AT the SL (29800) minus slippage — NOT at the candle's open (29900), which
    // was the pre-fix (optimistic) behavior and would have priced the exit ~100pts better.
    expect(tr.exitPrice).toBe(29794.04);
  });

  // Same alert/entry as above, but the follow-up candle gaps DOWN through the SL at its own open.
  const longGapDown = buildCandles([
    ...Array(8).fill([30000, 30000, 30000, 30000]),
    [29900, 29950, 29800, 29900],
    [30000, 30100, 29900, 30050],
    [29750, 29800, 29600, 29650],
  ]);

  it("fills a LONG SL exit at the (worse) open when the candle gapped through the SL, not snapped back to the SL level", () => {
    const result = runBacktest(longGapDown, baseConfig);
    expect(result.trades.length).toBe(1);
    const tr = result.trades[0];
    expect(tr.exitReason).toBe("SL");
    // Gapped through: fill at the (worse) open (29750) minus slippage — not snapped back up to sl (29800).
    expect(tr.exitPrice).toBe(29744.05);
  });

  // Mirror of the first case for a SHORT: alert candle entirely above the EMA (BEARISH), breakout
  // clears the alert low while gapping through the nominal entry, then a follow-up candle whose HIGH
  // touches the SL intrabar while its OPEN (30050) sits safely below it — no gap.
  const shortNoGap = buildCandles([
    ...Array(8).fill([30000, 30000, 30000, 30000]),
    [30100, 30150, 30050, 30100],
    [30000, 30050, 29900, 29950],
    [30050, 30200, 30000, 30180],
  ]);

  it("fills a SHORT SL exit AT the SL level when the candle didn't gap through it (mirrors the LONG case)", () => {
    const result = runBacktest(shortNoGap, baseConfig);
    expect(result.trades.length).toBe(1);
    const tr = result.trades[0];
    expect(tr.side).toBe("SHORT");
    expect(tr.entryPrice).toBe(29994);
    expect(tr.sl).toBe(30150);
    expect(tr.exitReason).toBe("SL");
    expect(tr.exitPrice).toBe(30156.03);
  });
});

// Regression tests for the BS-mode (option) target/strike/entry-spot fix: buildPosition priced
// the option's strike, entry premium, AND target off the raw, un-adjusted nominal alert level —
// while INDEX mode already correctly gap-adjusted all three off the real fill. On a gapping signal
// (the common case this whole session), that meant the option was priced against — and its target
// set from — an index level the market never actually gave you.
describe("runBacktest BS-mode prices strike/spot/target off the gap-adjusted fill, not the stale nominal level", () => {
  const baseConfig = {
    symbol: "NSE:NIFTYBANK-INDEX",
    strategy: "EMA5",
    capital: 1000000,
    riskPercent: 1,
    targetMultiplier: 2,
    pricingModel: "BLACK_SCHOLES",
    applyLiveFilters: true,
  };

  function buildCandles(events) {
    const startMs = Date.UTC(2024, 0, 2, 3, 50, 0); // 2024-01-02 09:20 IST
    const candles = [];
    let t = startMs;
    for (const [open, high, low, close] of events) {
      candles.push({ timestamp: t, datetime: new Date(t).toISOString(), open, high, low, close, volume: 1000 });
      t += 5 * 60 * 1000;
    }
    return candles;
  }

  // 8 flat candles seed the 5-EMA at exactly 30000, then an alert candle entirely below the EMA
  // (BULLISH, nominal entry = its high = 29950, sl = its low = 29800), then a breakout candle whose
  // OPEN (30000) already clears 29950 — a hard gap through the nominal level. No further candles,
  // so the position closes via END_OF_DATA and its fields can be inspected directly.
  const gappedLong = buildCandles([
    ...Array(8).fill([30000, 30000, 30000, 30000]),
    [29900, 29950, 29800, 29900],
    [30000, 30100, 29900, 30050],
  ]);

  it("records indexEntry as the gap-adjusted fill (30000), not the stale nominal alert high (29950)", () => {
    const result = runBacktest(gappedLong, baseConfig);
    expect(result.trades.length).toBe(1);
    expect(result.trades[0].indexEntry).toBe(30000);
  });

  it("sets the target from the gap-adjusted fill's own risk distance, not the nominal level's", () => {
    const result = runBacktest(gappedLong, baseConfig);
    const tr = result.trades[0];
    // risk = |30000 - sl(29800)| = 200; target = 30000 + 2×200 = 30400.
    // The old (buggy) behavior priced this off the nominal level (29950): risk 150, target 30250.
    expect(tr.sl).toBe(29800);
    expect(tr.target).toBe(30400);
  });

  it("selects the strike off the gap-adjusted fill too", () => {
    const result = runBacktest(gappedLong, baseConfig);
    // roundToStrike(30000, 100) = 30000 — BANKNIFTY's strikeInterval.
    expect(result.trades[0].strike).toBe(30000);
  });
});
