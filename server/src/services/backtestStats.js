/**
 * Post-processing performance analytics over a completed backtest's trade list.
 *
 * Deliberately separate from runBacktest()'s simulation loop: this is a pure function over the
 * already-finished `trades` array (plus the candle range and starting capital), so it can be
 * unit-tested with a handful of synthetic trades instead of needing a full EMA-triggering candle
 * series. Every field name here is standard trading-performance vocabulary — see the inline
 * comments for the exact definition used, since several of these terms get used loosely/
 * inconsistently across different tools.
 */

function round2(n) {
  return Math.round(n * 100) / 100;
}

// IST hour-of-day (0-23) for an epoch-ms instant. Duplicated from backtest.js's istClock rather
// than imported, to keep this module import-cycle-free (backtest.js will import FROM here).
function istHourOf(ms) {
  const istMinutes = (((Math.floor(ms / 60000) % 1440) + 1440) % 1440 + 330) % 1440;
  return Math.floor(istMinutes / 60);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TRADING_DAYS_PER_YEAR = 252; // standard NSE-year convention for annualizing daily stats

function emptyStats() {
  return {
    streaks: { maxConsecutiveWins: 0, maxConsecutiveLosses: 0, currentStreak: 0, winStreakHistogram: {}, lossStreakHistogram: {} },
    extremes: { largestWin: 0, largestLoss: 0 },
    duration: { avgBarsHeldWin: 0, avgBarsHeldLoss: 0, avgBarsHeldAll: 0 },
    exitReasons: {},
    rMultiple: { avg: 0, min: 0, max: 0, coveredTrades: 0 },
    profitFactor: 0,
    payoffRatio: 0,
    riskAdjusted: { sharpe: 0, sortino: 0, cagr: 0, calmar: 0, recoveryFactor: 0 },
    kellyPercent: 0,
    yearly: [],
    byHourIST: [],
    byDayOfWeek: [],
  };
}

/**
 * @param {object[]} trades - the backtest's trade log (pnl, exitReason, barsHeld, entryTime,
 *   exitTime, and optionally riskAtEntry for R-multiples).
 * @param {object[]} candles - the parsed candle series the backtest ran over (for CAGR's date span).
 * @param {number} initialCapital
 * @param {number} maxDrawdownPercent - the simulation's own tracked max drawdown (%), reused here
 *   rather than recomputed, so Calmar/Recovery Factor always agree with the headline number.
 */
export function computeAdvancedStats({ trades, candles, initialCapital, maxDrawdownPercent }) {
  if (!Array.isArray(trades) || trades.length === 0) return emptyStats();

  // ── Streaks: walk the trade sequence, closing out a streak's tally whenever the win/loss sign
  // flips (or at the end). winStreakHistogram/lossStreakHistogram map streak-length -> how many
  // times a streak of exactly that length occurred — more useful than a single "worst ever"
  // number for gauging a realistic bad stretch.
  let curSign = 0;
  let curLen = 0;
  const winHist = {};
  const lossHist = {};
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
  const currentStreak = curSign * curLen; // signed: +3 = currently on a 3-win streak, -2 = on a 2-loss streak

  // ── Extremes ──
  const pnls = trades.map((t) => t.pnl);
  const largestWin = round2(Math.max(0, ...pnls));
  const largestLoss = round2(Math.min(0, ...pnls));

  const winTrades = trades.filter((t) => t.pnl > 0);
  const lossTrades = trades.filter((t) => t.pnl <= 0);
  const avg = (arr, sel) => (arr.length ? arr.reduce((s, x) => s + sel(x), 0) / arr.length : 0);

  // ── Duration ──
  const duration = {
    avgBarsHeldWin: round2(avg(winTrades, (t) => t.barsHeld || 0)),
    avgBarsHeldLoss: round2(avg(lossTrades, (t) => t.barsHeld || 0)),
    avgBarsHeldAll: round2(avg(trades, (t) => t.barsHeld || 0)),
  };

  // ── Exit reason breakdown (count + total/avg P&L per SL/TARGET/SQUARE_OFF/TIME) ──
  const exitReasons = {};
  for (const t of trades) {
    const r = t.exitReason || "UNKNOWN";
    if (!exitReasons[r]) exitReasons[r] = { count: 0, totalPnL: 0 };
    exitReasons[r].count++;
    exitReasons[r].totalPnL += t.pnl;
  }
  for (const r of Object.keys(exitReasons)) {
    exitReasons[r].avgPnL = round2(exitReasons[r].totalPnL / exitReasons[r].count);
    exitReasons[r].totalPnL = round2(exitReasons[r].totalPnL);
  }

  // ── R-multiple: P&L expressed as a multiple of the risk actually taken on that trade
  // (riskAtEntry, set at position-build time). Normalizes the edge independent of position
  // sizing choices. Trades missing riskAtEntry (older cached results, if any) are excluded rather
  // than skewing the average with a bogus value.
  const rMultiples = trades
    .filter((t) => Number(t.riskAtEntry) > 0)
    .map((t) => t.pnl / t.riskAtEntry);
  const rMultiple = {
    avg: rMultiples.length ? round2(rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length) : 0,
    min: rMultiples.length ? round2(Math.min(...rMultiples)) : 0,
    max: rMultiples.length ? round2(Math.max(...rMultiples)) : 0,
    coveredTrades: rMultiples.length,
  };

  // ── Profit Factor: the STANDARD definition is gross profit / gross loss (total rupees, not
  // averages) — a prior version of this codebase mislabeled avgWin/avgLoss as "profit factor",
  // which is really the Payoff Ratio (below). Both are now computed correctly and separately.
  const grossProfit = winTrades.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(lossTrades.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? round2(grossProfit / grossLoss) : (grossProfit > 0 ? 99 : 0);
  const avgWinAmt = avg(winTrades, (t) => t.pnl);
  const avgLossAmt = Math.abs(avg(lossTrades, (t) => t.pnl));
  const payoffRatio = avgLossAmt > 0 ? round2(avgWinAmt / avgLossAmt) : 0;

  // ── Daily P&L series for Sharpe/Sortino. Grouped by the exitTime's ISO date (UTC) — an IST
  // 9:15-15:30 trading session never crosses UTC midnight (IST is UTC+5:30), so this is a safe,
  // simple day key without needing a full IST-date conversion. Returns are relative to the
  // ORIGINAL starting capital (a common simplification — a fully compounding-aware version would
  // need capital-at-start-of-day tracked through the simulation, which this does not do).
  const dailyPnLMap = new Map();
  for (const t of trades) {
    const day = String(t.exitTime).slice(0, 10);
    dailyPnLMap.set(day, (dailyPnLMap.get(day) || 0) + t.pnl);
  }
  const dailyReturns = initialCapital > 0
    ? Array.from(dailyPnLMap.values()).map((pnl) => pnl / initialCapital)
    : [];
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

  // ── CAGR / Calmar / Recovery Factor ──
  const firstTs = candles && candles.length ? candles[0].timestamp : null;
  const lastTs = candles && candles.length ? candles[candles.length - 1].timestamp : null;
  const yearsSpanned = firstTs && lastTs && lastTs > firstTs
    ? (lastTs - firstTs) / (365.25 * 86400000)
    : 0;
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
  const finalCapital = initialCapital + totalPnL;
  const cagr = yearsSpanned > 0 && initialCapital > 0
    ? round2((Math.pow(finalCapital / initialCapital, 1 / yearsSpanned) - 1) * 100)
    : 0;
  const calmar = maxDrawdownPercent > 0 ? round2(cagr / maxDrawdownPercent) : 0;
  const totalReturnPercent = initialCapital > 0 ? (totalPnL / initialCapital) * 100 : 0;
  const recoveryFactor = maxDrawdownPercent > 0 ? round2(totalReturnPercent / maxDrawdownPercent) : 0;

  // ── Kelly Criterion — ADVISORY ONLY. This is the raw full-Kelly figure; practitioners
  // typically use half-Kelly or less for real sizing, since full Kelly assumes the win-rate/
  // payoff-ratio estimates are exact (they never are) and is otherwise prone to large drawdowns.
  const winProb = winTrades.length / trades.length;
  const kellyPercent = payoffRatio > 0 ? round2((winProb - (1 - winProb) / payoffRatio) * 100) : 0;

  // ── Yearly breakdown — is the edge consistent every year, or carried by one good year? ──
  const yearlyMap = new Map();
  for (const t of trades) {
    const year = String(t.exitTime).slice(0, 4);
    if (!yearlyMap.has(year)) yearlyMap.set(year, { year, trades: 0, wins: 0, totalPnL: 0 });
    const y = yearlyMap.get(year);
    y.trades++;
    if (t.pnl > 0) y.wins++;
    y.totalPnL += t.pnl;
  }
  const yearly = Array.from(yearlyMap.values())
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((y) => ({ year: y.year, trades: y.trades, winRate: round2((y.wins / y.trades) * 100), totalPnL: round2(y.totalPnL) }));

  // ── By IST entry hour ──
  const hourMap = new Map();
  for (const t of trades) {
    const hour = istHourOf(new Date(t.entryTime).getTime());
    if (!hourMap.has(hour)) hourMap.set(hour, { hour, trades: 0, wins: 0, totalPnL: 0 });
    const h = hourMap.get(hour);
    h.trades++;
    if (t.pnl > 0) h.wins++;
    h.totalPnL += t.pnl;
  }
  const byHourIST = Array.from(hourMap.values())
    .sort((a, b) => a.hour - b.hour)
    .map((h) => ({ hour: h.hour, trades: h.trades, winRate: round2((h.wins / h.trades) * 100), totalPnL: round2(h.totalPnL) }));

  // ── By day of week (entry date — same UTC/IST same-day reasoning as the daily P&L grouping) ──
  const dowMap = new Map();
  for (const t of trades) {
    const dow = new Date(t.entryTime).getUTCDay();
    if (!dowMap.has(dow)) dowMap.set(dow, { dow, trades: 0, wins: 0, totalPnL: 0 });
    const d = dowMap.get(dow);
    d.trades++;
    if (t.pnl > 0) d.wins++;
    d.totalPnL += t.pnl;
  }
  const byDayOfWeek = Array.from(dowMap.values())
    .sort((a, b) => a.dow - b.dow)
    .map((d) => ({ day: DAY_NAMES[d.dow], trades: d.trades, winRate: round2((d.wins / d.trades) * 100), totalPnL: round2(d.totalPnL) }));

  return {
    streaks: { maxConsecutiveWins, maxConsecutiveLosses, currentStreak, winStreakHistogram: winHist, lossStreakHistogram: lossHist },
    extremes: { largestWin, largestLoss },
    duration,
    exitReasons,
    rMultiple,
    profitFactor,
    payoffRatio,
    riskAdjusted: { sharpe, sortino, cagr, calmar, recoveryFactor },
    kellyPercent,
    yearly,
    byHourIST,
    byDayOfWeek,
  };
}
