import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateEMA,
  detectAlertCandle,
  detectBreakout,
  isValidTradingTime,
  isSquareOffTime,
  getATMOption,
  storeSignal,
  getRecentSignals,
  clearSignals,
} from "./emaStrategy.js";

// Candle shape used throughout: [timestamp, open, high, low, close, volume]

describe("calculateEMA (shared with backtest, SMA-seeded)", () => {
  it("returns null with fewer than 5 closes", () => {
    expect(calculateEMA([1, 2, 3, 4])).toBeNull();
  });

  it("seeds from the SMA of the first 5 closes (now unified with the backtest)", () => {
    // [10,11,12,13,14] -> SMA(5) = 12, matching src/lib/strategies/engine.ts. The live engine
    // previously first-close-seeded and returned 12.4; unifying the signal path is the fix
    // (roadmap item #2). The two engines now agree.
    expect(calculateEMA([10, 11, 12, 13, 14])).toBe(12);
  });

  it("continues smoothing after the seed", () => {
    // (15 - 12) * (2/6) + 12 = 13
    expect(calculateEMA([10, 11, 12, 13, 14, 15])).toBe(13);
  });
});

describe("detectAlertCandle (EMA5 — 'entirely beyond EMA' rule, unified with backtest)", () => {
  it("returns null without enough candles to seed the EMA", () => {
    expect(detectAlertCandle([[1, 100, 101, 99, 100, 1000]], "EMA5")).toBeNull();
  });

  it("flags a BULLISH alert when the prior candle is ENTIRELY below the 5 EMA", () => {
    const candles = [
      [1, 100, 101, 99, 100, 1000],
      [2, 100, 101, 99, 100, 1000],
      [3, 100, 101, 99, 100, 1000],
      [4, 100, 101, 99, 100, 1000],
      [5, 100, 97, 93, 95, 1000], // ALERT candle: high 97 & close 95 both < EMA (~98.67)
      [6, 96, 99, 95, 98, 1000], // latest = breakout reference
    ];
    const alert = detectAlertCandle(candles, "EMA5");
    expect(alert).not.toBeNull();
    expect(alert.type).toBe("BULLISH_ALERT");
    expect(alert.ema5).toBeCloseTo(98.67, 1);
    expect(alert.high).toBe(97);
    expect(alert.low).toBe(93);
    expect(alert.timestamp).toBe(5); // alert candle is candles[length-2], not the latest
  });

  it("flags a BEARISH alert when the prior candle is ENTIRELY above the 5 EMA", () => {
    const candles = [
      [1, 100, 101, 99, 100, 1000],
      [2, 100, 101, 99, 100, 1000],
      [3, 100, 101, 99, 100, 1000],
      [4, 100, 101, 99, 100, 1000],
      [5, 100, 107, 103, 105, 1000], // ALERT candle: low 103 & close 105 both > EMA (~101.33)
      [6, 104, 106, 100, 102, 1000], // latest
    ];
    const alert = detectAlertCandle(candles, "EMA5");
    expect(alert).not.toBeNull();
    expect(alert.type).toBe("BEARISH_ALERT");
    expect(alert.high).toBe(107);
    expect(alert.low).toBe(103);
  });

  it("does NOT flag when the prior candle straddles the 5 EMA (cross-over is no longer an alert)", () => {
    const candles = Array.from({ length: 6 }, (_, i) => [i + 1, 100, 101, 99, 100, 1000]);
    // Every candle straddles a flat 100 EMA (high 101 > ema, low 99 < ema) — not entirely beyond.
    expect(detectAlertCandle(candles, "EMA5")).toBeNull();
  });

  it("returns null for EMA5_OPTION without the 20-candle warmup", () => {
    const candles = Array.from({ length: 8 }, (_, i) => [i, 100, 101, 99, 100, 1000]);
    expect(detectAlertCandle(candles, "EMA5_OPTION")).toBeNull();
  });
});

describe("detectBreakout", () => {
  const flat = [0, 0, 0, 0, 0, 0];

  it("returns a LONG signal on a break above a bullish alert high", () => {
    const alert = { type: "BULLISH_ALERT", high: 100, low: 95 };
    const signal = detectBreakout([flat, [1, 100, 101, 99, 100, 1000]], alert);
    expect(signal).not.toBeNull();
    expect(signal.type).toBe("LONG");
    expect(signal.entryPrice).toBe(100);
    expect(signal.stopLoss).toBe(95);
    expect(signal.target).toBe(110); // entry + risk*2
    expect(signal.risk).toBe(5);
  });

  it("returns a SHORT signal on a break below a bearish alert low", () => {
    const alert = { type: "BEARISH_ALERT", high: 100, low: 95 };
    const signal = detectBreakout([flat, [1, 96, 97, 94, 95, 1000]], alert);
    expect(signal).not.toBeNull();
    expect(signal.type).toBe("SHORT");
    expect(signal.entryPrice).toBe(95);
    expect(signal.stopLoss).toBe(100);
    expect(signal.target).toBe(85);
  });

  it("returns null when there is no breakout", () => {
    const alert = { type: "BULLISH_ALERT", high: 100, low: 95 };
    expect(detectBreakout([flat, [1, 98, 99, 97, 98, 1000]], alert)).toBeNull();
  });

  it("returns null without an alert candle", () => {
    expect(detectBreakout([flat, [1, 100, 101, 99, 100, 1000]], null)).toBeNull();
  });
});

describe("trading-time guards (IST, derived from UTC)", () => {
  afterEach(() => vi.useRealTimers());

  function at(utcIso) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(utcIso));
  }

  it("allows entries from 09:15 up to (not including) 15:00 IST", () => {
    at("2026-06-26T03:45:00Z"); // 09:15 IST
    expect(isValidTradingTime()).toBe(true);
    at("2026-06-26T08:00:00Z"); // 13:30 IST
    expect(isValidTradingTime()).toBe(true);
  });

  it("blocks entries before open and from 15:00 IST onward", () => {
    at("2026-06-26T03:30:00Z"); // 09:00 IST
    expect(isValidTradingTime()).toBe(false);
    at("2026-06-26T09:31:00Z"); // 15:01 IST
    expect(isValidTradingTime()).toBe(false);
  });

  it("triggers square-off from 15:15 IST", () => {
    at("2026-06-26T09:45:00Z"); // 15:15 IST
    expect(isSquareOffTime()).toBe(true);
    at("2026-06-26T09:44:00Z"); // 15:14 IST
    expect(isSquareOffTime()).toBe(false);
  });
});

describe("getATMOption", () => {
  const chain = [
    { option_type: "CE", strike_price: 100, symbol: "OPT100CE" },
    { option_type: "CE", strike_price: 110, symbol: "OPT110CE" },
    { option_type: "PE", strike_price: 100, symbol: "OPT100PE" },
  ];

  it("returns null for an empty chain", () => {
    expect(getATMOption("NIFTY", 103, "CE", [])).toBeNull();
  });

  it("picks the strike closest to spot for the requested type", () => {
    expect(getATMOption("NIFTY", 103, "CE", chain)).toBe("OPT100CE");
    expect(getATMOption("NIFTY", 108, "CE", chain)).toBe("OPT110CE");
    expect(getATMOption("NIFTY", 103, "PE", chain)).toBe("OPT100PE");
  });

  it("supports alternate field names (optionType/strike/tradingSymbol)", () => {
    const alt = [{ optionType: "CE", strike: 200, tradingSymbol: "ALT200CE" }];
    expect(getATMOption("NIFTY", 199, "CE", alt)).toBe("ALT200CE");
  });
});

describe("signal store", () => {
  beforeEach(() => clearSignals());

  it("stores and returns recent signals with an id and timestamp", () => {
    expect(getRecentSignals(10)).toEqual([]);
    storeSignal({ type: "LONG", underlying: "NIFTY" });
    const recent = getRecentSignals(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBeTruthy();
    expect(recent[0].createdAt).toBeTruthy();
    expect(recent[0].underlying).toBe("NIFTY");
  });
});
