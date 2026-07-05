import { describe, it, expect } from "vitest";
import { computeAdvancedStats } from "./backtestStats.js";

// Minimal trade builder — only the fields computeAdvancedStats actually reads.
function mkTrade(pnl, opts = {}) {
  return {
    pnl,
    exitReason: opts.exitReason || "TARGET",
    barsHeld: opts.barsHeld ?? 5,
    entryTime: opts.entryTime || "2024-03-04T04:00:00.000Z", // Monday 09:30 IST
    exitTime: opts.exitTime || "2024-03-04T05:00:00.000Z",
    riskAtEntry: opts.riskAtEntry,
  };
}

describe("computeAdvancedStats — empty/edge cases", () => {
  it("returns a zeroed shape for no trades", () => {
    const stats = computeAdvancedStats({ trades: [], candles: [], initialCapital: 100000 });
    expect(stats.streaks.maxConsecutiveWins).toBe(0);
    expect(stats.streaks.currentStreak).toBe(0);
    expect(stats.profitFactor).toBe(0);
    expect(stats.yearly).toEqual([]);
  });
});

describe("computeAdvancedStats — streaks", () => {
  it("computes max win/loss streaks and the signed current streak from a mixed sequence", () => {
    // W W W L L W L L L L  -> win streaks of 3,1 ; loss streaks of 2,4 ; ends on a 4-loss streak
    const pnls = [10, 10, 10, -5, -5, 10, -5, -5, -5, -5];
    const trades = pnls.map((p) => mkTrade(p));
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.streaks.maxConsecutiveWins).toBe(3);
    expect(stats.streaks.maxConsecutiveLosses).toBe(4);
    expect(stats.streaks.currentStreak).toBe(-4);
    expect(stats.streaks.winStreakHistogram).toEqual({ 3: 1, 1: 1 });
    expect(stats.streaks.lossStreakHistogram).toEqual({ 2: 1, 4: 1 });
  });

  it("reports a positive currentStreak when the sequence ends on a win streak", () => {
    const trades = [-5, -5, 10, 10, 10].map((p) => mkTrade(p));
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.streaks.currentStreak).toBe(3);
  });

  it("treats a zero-P&L trade as a loss (pnl > 0 is the only win condition)", () => {
    const trades = [10, 0, 10].map((p) => mkTrade(p));
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.streaks.maxConsecutiveWins).toBe(1);
    expect(stats.streaks.maxConsecutiveLosses).toBe(1);
  });
});

describe("computeAdvancedStats — extremes, duration, exit reasons", () => {
  const trades = [
    mkTrade(500, { exitReason: "TARGET", barsHeld: 8 }),
    mkTrade(-200, { exitReason: "SL", barsHeld: 3 }),
    mkTrade(1200, { exitReason: "TARGET", barsHeld: 10 }),
    mkTrade(-800, { exitReason: "SQUARE_OFF", barsHeld: 20 }),
  ];
  const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });

  it("finds the largest win and largest loss", () => {
    expect(stats.extremes.largestWin).toBe(1200);
    expect(stats.extremes.largestLoss).toBe(-800);
  });

  it("averages bar-held duration separately for wins and losses", () => {
    expect(stats.duration.avgBarsHeldWin).toBe(9); // (8+10)/2
    expect(stats.duration.avgBarsHeldLoss).toBe(11.5); // (3+20)/2
  });

  it("breaks down count/total/avg P&L per exit reason", () => {
    expect(stats.exitReasons.TARGET).toEqual({ count: 2, totalPnL: 1700, avgPnL: 850 });
    expect(stats.exitReasons.SL).toEqual({ count: 1, totalPnL: -200, avgPnL: -200 });
    expect(stats.exitReasons.SQUARE_OFF).toEqual({ count: 1, totalPnL: -800, avgPnL: -800 });
  });
});

describe("computeAdvancedStats — R-multiple", () => {
  it("expresses P&L as a multiple of the risk taken, excluding trades with no riskAtEntry", () => {
    const trades = [
      mkTrade(200, { riskAtEntry: 100 }), // +2R
      mkTrade(-100, { riskAtEntry: 100 }), // -1R
      mkTrade(50, {}), // no riskAtEntry — excluded
    ];
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.rMultiple.coveredTrades).toBe(2);
    expect(stats.rMultiple.avg).toBe(0.5); // (2 + -1) / 2
    expect(stats.rMultiple.max).toBe(2);
    expect(stats.rMultiple.min).toBe(-1);
  });
});

describe("computeAdvancedStats — profit factor vs payoff ratio", () => {
  it("computes profitFactor as GROSS profit / GROSS loss (not avgWin/avgLoss)", () => {
    // 3 wins of 100 (gross 300), 1 loss of -150 (gross 150) -> profitFactor = 300/150 = 2
    const trades = [mkTrade(100), mkTrade(100), mkTrade(100), mkTrade(-150)];
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.profitFactor).toBe(2);
    // payoffRatio = avgWin(100) / avgLoss(150) = 0.6667 — deliberately DIFFERENT from profitFactor,
    // proving the two are no longer conflated.
    expect(stats.payoffRatio).toBeCloseTo(0.67, 2);
  });

  it("caps profitFactor at 99 when there are wins but zero losses (avoid dividing by zero)", () => {
    const trades = [mkTrade(100), mkTrade(50)];
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.profitFactor).toBe(99);
  });
});

describe("computeAdvancedStats — CAGR / Calmar / Recovery Factor", () => {
  it("annualizes return over the candle date span and derives Calmar/Recovery from maxDrawdownPercent", () => {
    const candles = [
      { timestamp: Date.UTC(2020, 0, 1) },
      { timestamp: Date.UTC(2024, 0, 1) }, // 4-year span
    ];
    // +50% total return over 4 years
    const trades = [mkTrade(50000)];
    const stats = computeAdvancedStats({ trades, candles, initialCapital: 100000, maxDrawdownPercent: 10 });
    // CAGR = (1.5)^(1/4) - 1 ≈ 10.67%
    expect(stats.riskAdjusted.cagr).toBeCloseTo(10.67, 1);
    expect(stats.riskAdjusted.calmar).toBeCloseTo(1.07, 1); // cagr / maxDD
    expect(stats.riskAdjusted.recoveryFactor).toBe(5); // 50% totalReturn / 10% maxDD
  });

  it("returns zero CAGR/Calmar when there's no candle date span", () => {
    const stats = computeAdvancedStats({ trades: [mkTrade(100)], candles: [], initialCapital: 100000, maxDrawdownPercent: 5 });
    expect(stats.riskAdjusted.cagr).toBe(0);
    expect(stats.riskAdjusted.calmar).toBe(0);
  });
});

describe("computeAdvancedStats — Kelly Criterion (advisory)", () => {
  it("computes the raw full-Kelly percentage from win rate and payoff ratio", () => {
    // 3 wins of 200 (avgWin 200), 1 loss of -100 -> winRate 0.75, payoffRatio 2
    // Kelly = winRate - (1-winRate)/payoffRatio = 0.75 - 0.25/2 = 0.625 -> 62.5%
    const trades = [mkTrade(200), mkTrade(200), mkTrade(200), mkTrade(-100)];
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.kellyPercent).toBeCloseTo(62.5, 1);
  });
});

describe("computeAdvancedStats — yearly / hour-of-day / day-of-week breakdowns", () => {
  it("groups trades by exit year", () => {
    const trades = [
      mkTrade(100, { exitTime: "2022-05-01T05:00:00.000Z" }),
      mkTrade(-50, { exitTime: "2022-06-01T05:00:00.000Z" }),
      mkTrade(200, { exitTime: "2023-01-01T05:00:00.000Z" }),
    ];
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.yearly).toEqual([
      { year: "2022", trades: 2, winRate: 50, totalPnL: 50 },
      { year: "2023", trades: 1, winRate: 100, totalPnL: 200 },
    ]);
  });

  it("groups trades by IST entry hour", () => {
    // 04:00 UTC = 09:30 IST -> hour 9; 08:00 UTC = 13:30 IST -> hour 13
    const trades = [
      mkTrade(100, { entryTime: "2024-03-04T04:00:00.000Z" }),
      mkTrade(-50, { entryTime: "2024-03-04T08:00:00.000Z" }),
    ];
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    const hours = stats.byHourIST.map((h) => h.hour);
    expect(hours).toEqual([9, 13]);
  });

  it("groups trades by day of week", () => {
    // 2024-03-04 is a Monday, 2024-03-05 is a Tuesday
    const trades = [
      mkTrade(100, { entryTime: "2024-03-04T04:00:00.000Z" }),
      mkTrade(-50, { entryTime: "2024-03-05T04:00:00.000Z" }),
    ];
    const stats = computeAdvancedStats({ trades, candles: [], initialCapital: 100000 });
    expect(stats.byDayOfWeek.map((d) => d.day)).toEqual(["Mon", "Tue"]);
  });
});
