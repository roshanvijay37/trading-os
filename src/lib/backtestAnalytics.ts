/**
 * Client-side recompute of backtest performance stats over an arbitrary SUBSET of an
 * already-completed run's trades (e.g. "this year only", "last 3 months") — lets the Backtest
 * Lab re-slice a long multi-year run instantly, with no new backend round-trip and no re-running
 * the simulation (which would also subtly change results via a truncated EMA warmup window).
 *
 * This is a TypeScript port of server/src/services/backtestStats.js's computeAdvancedStats,
 * adapted for a filtered window: instead of receiving the simulation's own tracked maxDrawdown/
 * candle range, it rebuilds an equity curve from `baselineCapital` (the account's value going
 * INTO the window) by replaying just the trades in the window, and derives CAGR's date span from
 * the trades themselves. Keep this in sync with backtestStats.js if either changes — see that
 * file for the authoritative definitions/rationale of each metric.
 */

export interface AnalyticsTrade {
  pnl: number;
  exitReason?: string;
  barsHeld?: number;
  entryTime: string;
  exitTime: string;
  riskAtEntry?: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface BacktestSummaryStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalReturn: number;
  totalPnL: number;
  maxDrawdown: number;
  profitFactor: number;
  payoffRatio: number;
  avgWin: number;
  avgLoss: number;
  finalCapital: number;
}

export interface BacktestAdvancedStats {
  streaks: {
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    currentStreak: number;
    winStreakHistogram: Record<string, number>;
    lossStreakHistogram: Record<string, number>;
  };
  extremes: { largestWin: number; largestLoss: number };
  duration: { avgBarsHeldWin: number; avgBarsHeldLoss: number; avgBarsHeldAll: number };
  exitReasons: Record<string, { count: number; totalPnL: number; avgPnL: number }>;
  rMultiple: { avg: number; min: number; max: number; coveredTrades: number };
  riskAdjusted: { sharpe: number; sortino: number; cagr: number; calmar: number; recoveryFactor: number };
  kellyPercent: number;
  yearly: { year: string; trades: number; winRate: number; totalPnL: number }[];
  byHourIST: { hour: number; trades: number; winRate: number; totalPnL: number }[];
  byDayOfWeek: { day: string; trades: number; winRate: number; totalPnL: number }[];
}

export interface BacktestAnalyticsResult {
  summary: BacktestSummaryStats;
  advanced: BacktestAdvancedStats;
  equityCurve: EquityPoint[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function istHourOf(ms: number): number {
  const istMinutes = (((Math.floor(ms / 60000) % 1440) + 1440) % 1440 + 330) % 1440;
  return Math.floor(istMinutes / 60);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TRADING_DAYS_PER_YEAR = 252;

function avg(arr: AnalyticsTrade[], sel: (t: AnalyticsTrade) => number): number {
  return arr.length ? arr.reduce((s, x) => s + sel(x), 0) / arr.length : 0;
}

function emptyResult(baselineCapital: number): BacktestAnalyticsResult {
  return {
    summary: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalReturn: 0,
      totalPnL: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      payoffRatio: 0,
      avgWin: 0,
      avgLoss: 0,
      finalCapital: round2(baselineCapital),
    },
    advanced: {
      streaks: { maxConsecutiveWins: 0, maxConsecutiveLosses: 0, currentStreak: 0, winStreakHistogram: {}, lossStreakHistogram: {} },
      extremes: { largestWin: 0, largestLoss: 0 },
      duration: { avgBarsHeldWin: 0, avgBarsHeldLoss: 0, avgBarsHeldAll: 0 },
      exitReasons: {},
      rMultiple: { avg: 0, min: 0, max: 0, coveredTrades: 0 },
      riskAdjusted: { sharpe: 0, sortino: 0, cagr: 0, calmar: 0, recoveryFactor: 0 },
      kellyPercent: 0,
      yearly: [],
      byHourIST: [],
      byDayOfWeek: [],
    },
    equityCurve: [],
  };
}

export function computeBacktestAnalytics(tradesIn: AnalyticsTrade[], baselineCapital: number): BacktestAnalyticsResult {
  if (!Array.isArray(tradesIn) || tradesIn.length === 0) return emptyResult(baselineCapital);

  // Defensive: sort chronologically by exit time so a filtered/reordered subset still replays
  // correctly for streaks, the rebuilt equity curve, and drawdown.
  const trades = [...tradesIn].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime());

  // ── Rebuild the equity curve + max drawdown for THIS window, starting from baselineCapital
  // (the account's value entering the window — NOT the original backtest's starting capital,
  // unless the window happens to start at the very beginning of the run). ──
  const equityCurve: EquityPoint[] = [];
  let capital = baselineCapital;
  let peak = baselineCapital;
  let maxDrawdown = 0;
  for (const t of trades) {
    capital += t.pnl;
    if (capital > peak) peak = capital;
    const dd = peak > 0 ? ((peak - capital) / peak) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
    equityCurve.push({ date: t.exitTime, equity: round2(capital) });
  }
  const finalCapital = capital;

  // ── Streaks ──
  let curSign = 0;
  let curLen = 0;
  const winHist: Record<string, number> = {};
  const lossHist: Record<string, number> = {};
  const closeStreak = () => {
    if (curLen <= 0) return;
    if (curSign === 1) winHist[curLen] = (winHist[curLen] || 0) + 1;
    else if (curSign === -1) lossHist[curLen] = (lossHist[curLen] || 0) + 1;
  };
  for (const t of trades) {
    const sign = t.pnl > 0 ? 1 : -1;
    if (sign === curSign) curLen++;
    else {
      closeStreak();
      curSign = sign;
      curLen = 1;
    }
  }
  closeStreak();
  const maxConsecutiveWins = Math.max(0, ...Object.keys(winHist).map(Number));
  const maxConsecutiveLosses = Math.max(0, ...Object.keys(lossHist).map(Number));
  const currentStreak = curSign * curLen;

  // ── Extremes ──
  const pnls = trades.map((t) => t.pnl);
  const largestWin = round2(Math.max(0, ...pnls));
  const largestLoss = round2(Math.min(0, ...pnls));

  const winTrades = trades.filter((t) => t.pnl > 0);
  const lossTrades = trades.filter((t) => t.pnl <= 0);

  // ── Duration ──
  const duration = {
    avgBarsHeldWin: round2(avg(winTrades, (t) => t.barsHeld || 0)),
    avgBarsHeldLoss: round2(avg(lossTrades, (t) => t.barsHeld || 0)),
    avgBarsHeldAll: round2(avg(trades, (t) => t.barsHeld || 0)),
  };

  // ── Exit reason breakdown ──
  const exitReasons: Record<string, { count: number; totalPnL: number; avgPnL: number }> = {};
  for (const t of trades) {
    const r = t.exitReason || "UNKNOWN";
    if (!exitReasons[r]) exitReasons[r] = { count: 0, totalPnL: 0, avgPnL: 0 };
    exitReasons[r].count++;
    exitReasons[r].totalPnL += t.pnl;
  }
  for (const r of Object.keys(exitReasons)) {
    exitReasons[r].avgPnL = round2(exitReasons[r].totalPnL / exitReasons[r].count);
    exitReasons[r].totalPnL = round2(exitReasons[r].totalPnL);
  }

  // ── R-multiple ──
  const rMultiples = trades.filter((t) => Number(t.riskAtEntry) > 0).map((t) => t.pnl / (t.riskAtEntry as number));
  const rMultiple = {
    avg: rMultiples.length ? round2(rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length) : 0,
    min: rMultiples.length ? round2(Math.min(...rMultiples)) : 0,
    max: rMultiples.length ? round2(Math.max(...rMultiples)) : 0,
    coveredTrades: rMultiples.length,
  };

  // ── Profit factor / payoff ratio ──
  const grossProfit = winTrades.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(lossTrades.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? 99 : 0;
  const avgWinAmt = avg(winTrades, (t) => t.pnl);
  const avgLossAmt = Math.abs(avg(lossTrades, (t) => t.pnl));
  const payoffRatio = avgLossAmt > 0 ? round2(avgWinAmt / avgLossAmt) : 0;

  // ── Daily P&L series for Sharpe/Sortino, relative to baselineCapital ──
  const dailyPnLMap = new Map<string, number>();
  for (const t of trades) {
    const day = String(t.exitTime).slice(0, 10);
    dailyPnLMap.set(day, (dailyPnLMap.get(day) || 0) + t.pnl);
  }
  const dailyReturns = baselineCapital > 0 ? Array.from(dailyPnLMap.values()).map((pnl) => pnl / baselineCapital) : [];
  const meanReturn = dailyReturns.length ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length
    ? dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / dailyReturns.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const downsideDeviation = dailyReturns.length
    ? Math.sqrt(dailyReturns.reduce((s, r) => s + Math.min(0, r) ** 2, 0) / dailyReturns.length)
    : 0;
  const sharpe = stdDev > 0 ? round2((meanReturn / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR)) : 0;
  const sortino = downsideDeviation > 0 ? round2((meanReturn / downsideDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR)) : 0;

  // ── CAGR / Calmar / Recovery Factor — date span comes from the WINDOW's own trades ──
  const firstTs = new Date(trades[0].entryTime).getTime();
  const lastTs = new Date(trades[trades.length - 1].exitTime).getTime();
  const yearsSpanned = lastTs > firstTs ? (lastTs - firstTs) / (365.25 * 86400000) : 0;
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
  const cagr =
    yearsSpanned > 0 && baselineCapital > 0
      ? round2((Math.pow(finalCapital / baselineCapital, 1 / yearsSpanned) - 1) * 100)
      : 0;
  const calmar = maxDrawdown > 0 ? round2(cagr / maxDrawdown) : 0;
  const totalReturnPercent = baselineCapital > 0 ? (totalPnL / baselineCapital) * 100 : 0;
  const recoveryFactor = maxDrawdown > 0 ? round2(totalReturnPercent / maxDrawdown) : 0;

  // ── Kelly (advisory) ──
  const winProb = winTrades.length / trades.length;
  const kellyPercent = payoffRatio > 0 ? round2((winProb - (1 - winProb) / payoffRatio) * 100) : 0;

  // ── Yearly breakdown ──
  const yearlyMap = new Map<string, { year: string; trades: number; wins: number; totalPnL: number }>();
  for (const t of trades) {
    const year = String(t.exitTime).slice(0, 4);
    if (!yearlyMap.has(year)) yearlyMap.set(year, { year, trades: 0, wins: 0, totalPnL: 0 });
    const y = yearlyMap.get(year)!;
    y.trades++;
    if (t.pnl > 0) y.wins++;
    y.totalPnL += t.pnl;
  }
  const yearly = Array.from(yearlyMap.values())
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((y) => ({ year: y.year, trades: y.trades, winRate: round2((y.wins / y.trades) * 100), totalPnL: round2(y.totalPnL) }));

  // ── By IST entry hour ──
  const hourMap = new Map<number, { hour: number; trades: number; wins: number; totalPnL: number }>();
  for (const t of trades) {
    const hour = istHourOf(new Date(t.entryTime).getTime());
    if (!hourMap.has(hour)) hourMap.set(hour, { hour, trades: 0, wins: 0, totalPnL: 0 });
    const h = hourMap.get(hour)!;
    h.trades++;
    if (t.pnl > 0) h.wins++;
    h.totalPnL += t.pnl;
  }
  const byHourIST = Array.from(hourMap.values())
    .sort((a, b) => a.hour - b.hour)
    .map((h) => ({ hour: h.hour, trades: h.trades, winRate: round2((h.wins / h.trades) * 100), totalPnL: round2(h.totalPnL) }));

  // ── By day of week ──
  const dowMap = new Map<number, { dow: number; trades: number; wins: number; totalPnL: number }>();
  for (const t of trades) {
    const dow = new Date(t.entryTime).getUTCDay();
    if (!dowMap.has(dow)) dowMap.set(dow, { dow, trades: 0, wins: 0, totalPnL: 0 });
    const d = dowMap.get(dow)!;
    d.trades++;
    if (t.pnl > 0) d.wins++;
    d.totalPnL += t.pnl;
  }
  const byDayOfWeek = Array.from(dowMap.values())
    .sort((a, b) => a.dow - b.dow)
    .map((d) => ({ day: DAY_NAMES[d.dow], trades: d.trades, winRate: round2((d.wins / d.trades) * 100), totalPnL: round2(d.totalPnL) }));

  return {
    summary: {
      totalTrades: trades.length,
      wins: winTrades.length,
      losses: lossTrades.length,
      winRate: round2((winTrades.length / trades.length) * 100),
      totalReturn: round2(totalReturnPercent),
      totalPnL: round2(totalPnL),
      maxDrawdown: round2(maxDrawdown),
      profitFactor,
      payoffRatio,
      avgWin: round2(avgWinAmt),
      avgLoss: round2(-avgLossAmt),
      finalCapital: round2(finalCapital),
    },
    advanced: {
      streaks: { maxConsecutiveWins, maxConsecutiveLosses, currentStreak, winStreakHistogram: winHist, lossStreakHistogram: lossHist },
      extremes: { largestWin, largestLoss },
      duration,
      exitReasons,
      rMultiple,
      riskAdjusted: { sharpe, sortino, cagr, calmar, recoveryFactor },
      kellyPercent,
      yearly,
      byHourIST,
      byDayOfWeek,
    },
    equityCurve,
  };
}

export type DateFilterPreset = "ALL" | "THIS_YEAR" | "LAST_12M" | "LAST_3M" | "CUSTOM";

/** Filters a trade list by exitTime according to a preset or a custom [from, to] range. */
export function filterTradesByDate(
  trades: AnalyticsTrade[],
  preset: DateFilterPreset,
  customFrom?: string,
  customTo?: string
): AnalyticsTrade[] {
  if (preset === "ALL") return trades;
  if (preset === "CUSTOM") {
    const fromMs = customFrom ? new Date(customFrom).getTime() : -Infinity;
    // Include the entire "to" day by pushing the cutoff to its end.
    const toMs = customTo ? new Date(customTo).getTime() + 86400000 : Infinity;
    return trades.filter((t) => {
      const ts = new Date(t.exitTime).getTime();
      return ts >= fromMs && ts < toMs;
    });
  }
  const now = Date.now();
  let cutoffMs: number;
  if (preset === "THIS_YEAR") {
    cutoffMs = new Date(Date.UTC(new Date(now).getUTCFullYear(), 0, 1)).getTime();
  } else if (preset === "LAST_12M") {
    cutoffMs = now - 365 * 86400000;
  } else {
    // LAST_3M
    cutoffMs = now - 90 * 86400000;
  }
  return trades.filter((t) => new Date(t.exitTime).getTime() >= cutoffMs);
}
