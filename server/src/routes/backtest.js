import express from "express";
import { getSession, getAllSessions } from "./auth.js";
import { getHolidays, refreshHolidays } from "../utils/marketHolidays.js";
import {
  bsPrice,
  roundToStrike,
  yearsToExpiry,
  yearsToMonthlyExpiry,
  getOptionDefaults,
  computeOptionCosts,
} from "../services/blackScholes.js";
// Shared 5-EMA + alert rule — same definition the live engine uses (single source of truth).
import { calculateEMA, detectAlert } from "../services/signalCore.js";
import { computeAdvancedStats } from "../services/backtestStats.js";
// Same statutory cost model autoTrader.js applies to real futures fills — INDEX-mode P&L was
// gross (no brokerage/STT/exchange/GST/stamp duty) whenever instrumentSource is "FUTURES", the
// one case where a real, costed instrument is actually being simulated.
import { computeFuturesCosts } from "../services/futuresCosts.js";

const router = express.Router();

const appId = process.env.FYERS_APP_ID;
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

// In-memory cache for historical data
const dataCache = new Map();

// ─── EMA Calculation ──────────────────────────────────────────────
// calculateEMA now lives in ../services/signalCore.js so the backtest and live engine
// share one definition (imported above).

// ─── Fetch Historical Data from FYERS ─────────────────────────────
// FYERS limits: max 100 days per request for intraday resolutions (1,2,3,5,10,15,20,30,45,60,120,180,240);
// max 366 days per request for daily/weekly/monthly resolutions (D/1W/1M) — both are real, enforced
// FYERS caps (violating either returns {code:-50, message:"Invalid input"}), not just the intraday one.
const INTRADAY_RESOLUTIONS = ["1", "2", "3", "5", "10", "15", "20", "30", "45", "60", "120", "180", "240"];
const MAX_DAYS_PER_REQUEST = 100;
const MAX_DAYS_PER_REQUEST_DAILY = 366;
const DAY_IN_SECONDS = 86400;

// A request whose range extends to "now" or later can still gain NEW candles as the day
// progresses (e.g. the live Chart page polls the SAME symbol/resolution/date-range every 5s,
// expecting fresh candles). The cache key is derived from calendar-date strings that don't
// change intraday, so caching such a request would freeze the response at whatever it was on
// the FIRST call of the day — exactly what made the live chart stop updating. Only a range
// that's already fully in the past is safe to cache indefinitely.
function isRangeFinalized(toTs) {
  return toTs <= Math.floor(Date.now() / 1000);
}

// Exported for unit tests (chunking behavior) — not part of the route's public API surface.
export async function fetchHistoricalData(symbol, resolution, fromTs, toTs, accessToken) {
  const cacheable = isRangeFinalized(toTs);
  const cacheKey = `${symbol}_${resolution}_${fromTs}_${toTs}`;
  if (cacheable && dataCache.has(cacheKey)) return dataCache.get(cacheKey);

  const isIntraday = INTRADAY_RESOLUTIONS.includes(resolution);
  const maxDays = isIntraday ? MAX_DAYS_PER_REQUEST : MAX_DAYS_PER_REQUEST_DAILY;
  const totalDays = (toTs - fromTs) / DAY_IN_SECONDS;

  // Chunk any request — intraday or daily/weekly/monthly — that exceeds its resolution's cap.
  if (totalDays > maxDays) {
    console.log(`FYERS limit: ${resolution} max ${maxDays} days. Chunking ${totalDays} days...`);
    let allCandles = [];
    let currentFrom = fromTs;

    while (currentFrom < toTs) {
      let currentTo = currentFrom + (maxDays * DAY_IN_SECONDS);
      if (currentTo > toTs) currentTo = toTs;

      const chunk = await fetchSingleRange(symbol, resolution, currentFrom, currentTo, accessToken);
      allCandles = allCandles.concat(chunk);

      // Rate limit: wait 600ms between requests to avoid FYERS limit
      if (currentTo < toTs) {
        await new Promise(resolve => setTimeout(resolve, 600));
      }

      currentFrom = currentTo + 1;
    }

    // Remove duplicates (FYERS may overlap)
    const seen = new Set();
    const unique = allCandles.filter(c => {
      const key = c[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (cacheable) dataCache.set(cacheKey, unique);
    return unique;
  }

  // Single request — within the resolution's per-request cap
  return fetchSingleRange(symbol, resolution, fromTs, toTs, accessToken);
}

async function fetchSingleRange(symbol, resolution, fromTs, toTs, accessToken) {
  const cacheable = isRangeFinalized(toTs);
  const cacheKey = `${symbol}_${resolution}_${fromTs}_${toTs}`;
  if (cacheable && dataCache.has(cacheKey)) return dataCache.get(cacheKey);

  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&date_format=0&range_from=${fromTs}&range_to=${toTs}&cont_flag=1`;

  console.log("Fetching FYERS data:", url);

  const response = await fetch(url, {
    headers: {
      Authorization: `${appId}:${accessToken}`,
    },
  });

  const data = await response.json();
  console.log("FYERS response:", JSON.stringify(data).slice(0, 500));

  if (data.s !== "ok" && data.s !== "no_data") {
    throw new Error(data.message || `FYERS error: ${JSON.stringify(data)}`);
  }

  const candles = data.candles || [];
  if (cacheable) dataCache.set(cacheKey, candles);
  return candles;
}

// ─── Parse FYERS Candle Format ────────────────────────────────────
function parseCandles(rawCandles) {
  return rawCandles.map((c) => ({
    timestamp: c[0] * 1000,
    datetime: new Date(c[0] * 1000).toISOString(),
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
  }));
}

// Fetch the India VIX series aligned to a backtest range, as [{ timestamp(ms), iv(decimal) }]
// (iv = VIX/100). Returns null — so the engine falls back to a flat IV — when not requested
// or when VIX history is unavailable.
async function fetchIvSeries({ pricingModel, ivSource, resolution, fromTs, toTs, accessToken }) {
  if (pricingModel !== "BLACK_SCHOLES" || ivSource !== "INDIA_VIX") return null;
  try {
    const raw = await fetchHistoricalData("NSE:INDIAVIX-INDEX", resolution, fromTs, toTs, accessToken);
    const vix = parseCandles(raw)
      .filter((c) => c.close > 0)
      .map((c) => ({ timestamp: c.timestamp, iv: c.close / 100 }));
    return vix.length > 0 ? vix : null;
  } catch (err) {
    console.error("[backtest] India VIX history fetch failed; using flat IV:", err.message);
    return null;
  }
}

// ─── Futures symbol resolution (EMA5T) ────────────────────────────
// EMA5T trades the futures contract directly, not the index (see autoTrader.js). FYERS's
// history API rejects EXPIRED contract symbols ("Invalid symbol provided"), so only the
// CURRENT (or next, near rollover) month's contract has any backtestable history at all —
// typically a few weeks since listing. buildFuturesSymbol mirrors autoTrader.js's helper of
// the same name (duplicated, not imported — importing autoTrader.js would pull the entire
// live order-execution/WebSocket module graph into the backtest route for one string template).
const FUT_MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const EMA5T_UNDERLYINGS = {
  "NSE:NIFTYBANK-INDEX": "BANKNIFTY",
  "NSE:NIFTY50-INDEX": "NIFTY",
};

function buildFuturesSymbol(underlyingName, year, monthIdx) {
  return `NSE:${underlyingName}${String(year % 100).padStart(2, "0")}${FUT_MONTH_CODES[monthIdx]}FUT`;
}

// Probe the current + next 2 months for a live quote — same approach autoTrader.js uses to
// find the tradable front-month contract (FYERS has no "list active contracts" endpoint).
async function resolveCurrentFuturesSymbol(underlyingName, accessToken) {
  const now = new Date();
  for (let k = 0; k < 3; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    const sym = buildFuturesSymbol(underlyingName, d.getUTCFullYear(), d.getUTCMonth());
    try {
      const response = await fetch(`${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent(sym)}`, {
        headers: { Authorization: `${appId}:${accessToken}` },
      });
      const data = await response.json();
      if ((data.d?.[0]?.v?.lp || 0) > 0) return sym;
    } catch {
      /* try the next month */
    }
  }
  return null;
}

// IST wall-clock parts from an epoch-ms timestamp (India has no DST, so a fixed +5:30 is exact).
export function istClock(tsMs) {
  const istMin = (((Math.floor(tsMs / 60000) % 1440) + 1440) % 1440 + 330) % 1440;
  return {
    hour: Math.floor(istMin / 60),
    minute: istMin % 60,
    decimal: istMin / 60,
    dayKey: Math.floor((tsMs + 330 * 60000) / 86400000),
  };
}

// Pure live-parity ENTRY gate (C3): mirrors the autoTrader gates that the backtest historically
// ignored (session window, 14:00 entry cutoff, max-trades/day, daily-loss). Returns { allow, reason }.
// OI and correlation are intentionally not here (see runBacktest notes); VIX and consecutive-loss
// gates were removed at the user's request (not needed for either backtest or live).
export function liveEntryGate({ decimal, hour, dayTrades, dayPnL }, limits) {
  if (decimal < limits.sessionStartDecimal || decimal >= limits.sessionEndDecimal) return { allow: false, reason: "OUTSIDE_SESSION" };
  if (hour >= limits.maxTimeEntryHour) return { allow: false, reason: "AFTER_ENTRY_CUTOFF" };
  if (dayTrades >= limits.maxTradesPerDay) return { allow: false, reason: "MAX_TRADES" };
  if (dayPnL <= -limits.dailyLossCap) return { allow: false, reason: "DAILY_LOSS_LIMIT" };
  return { allow: true, reason: "" };
}

// ─── Backtest Engine ──────────────────────────────────────────────
// Exported for unit tests (it takes candles + config directly, no network). The route handlers below
// fetch candles then call it.
export function runBacktest(candles, config) {
  const {
    symbol = "NSE:NIFTYBANK-INDEX",
    strategy = "EMA5",
    emaPeriod = 5,
    // EMA5T/EMA5_OPTION's no-lookahead trend gate — was hardcoded to 20 (calculateEMA(closes, 20))
    // with no way to test whether the strategy is sensitive to this exact period. Exposed the same
    // way emaPeriod already is, default unchanged.
    trendEmaPeriod = 20,
    capital = 1000000,
    riskPercent = 1,
    // TODO(backtest): slBuffer is accepted from the UI but never applied to the stop-loss in
    // this engine (the SL is the alert-candle low/high). Either widen the SL by slBuffer here
    // to honour the control, or remove the knob from the UI. Left unchanged to avoid silently
    // altering existing backtest results — confirm intended SL-buffer behaviour first.
    slBuffer = 0.005,
    targetMultiplier = 2,
    maxHoldBars = 12,
    slippage = 0.0002, // 0.02% slippage (~10 pts on BANKNIFTY, ~5 pts on NIFTY)
    capitalMode = "COMPOUND",
    // ── Pricing model ───────────────────────────────────────────────
    // "INDEX"         → original engine: trade the index itself, P&L in index points.
    // "BLACK_SCHOLES" → trade ATM options on the SAME signals; P&L is option-premium
    //                   based with delta capture, theta decay, spread and statutory costs.
    pricingModel = "INDEX",
    annualizedIV,      // decimal, e.g. 0.18; falls back to per-symbol default
    riskFreeRate,      // decimal, default 0.065
    strikeInterval,    // points between strikes; per-symbol default
    lotSize,           // contract lot size; per-symbol default
    expiryWeekday,     // 0=Sun..6=Sat IST; per-symbol default (see getOptionDefaults)
    expiryFrequency,   // "WEEKLY" | "MONTHLY"; per-symbol default (see getOptionDefaults)
    optionSpreadPct = 1.0, // round-trip bid/ask as % of premium (half applied each side)
    brokeragePerOrder = 20,
    // IV source for the BS model: "FLAT" (use annualizedIV / per-symbol default) or
    // "INDIA_VIX" (use the India VIX level at each bar, supplied as ivSeries). ivMultiplier
    // scales VIX → instrument IV (BankNifty realised IV runs above India VIX).
    ivSource = "FLAT",
    ivMultiplier = 1,
    ivSeries = null, // [{ timestamp(ms), iv(decimal) }], same resolution as candles
    // ── Live-parity gating (C3) ─────────────────────────────────────────────────────────────
    // Apply the same gates the live bot (autoTrader.js) applies, so the backtest stops being
    // systematically over-optimistic. Defaults mirror the live CONFIG. Set applyLiveFilters:false
    // for the old raw "idea filter" behaviour.
    // NOTE — two live filters CANNOT be reproduced faithfully here and are intentionally omitted:
    //  • OI / liquidity (MIN_OI): FYERS history has no per-strike historical open-interest, so the
    //    backtest cannot know which strikes were illiquid. Treated as "assume adequate OI" — this is
    //    the one remaining optimism vs live; surfaced via result.parity.oiModeled.
    //  • Correlation: a backtest run is single-symbol, so the cross-underlying correlation block is
    //    not applicable (it only matters when NIFTY & BANKNIFTY trade together live).
    applyLiveFilters = true,
    maxTimeEntryHour = 14,        // no new entries at/after 14:00 IST (autoTrader MAX_TIME_ENTRY_HOUR)
    sessionStartDecimal = 9.25,   // 9:15 IST (isValidTradingTime lower bound)
    sessionEndDecimal = 15.0,     // 15:00 IST (no new entries after)
    squareOffHour = 15,
    squareOffMinute = 15,         // force-exit at 15:15 IST (isSquareOffTime)
    maxTradesPerDay = 10,
    maxRiskPerDayPercent = 2,     // halt new entries once daily P&L <= -this% of capital
    marginSafetyMultiplier = 2,   // option-buying capital cap = premium * this (autoTrader MARGIN_SAFETY)
    // ── Position sizing ──────────────────────────────────────────────────────────────────
    // "RISK"  → size qty from riskPercent/stop distance (the engine's long-standing default).
    // "LOTS"  → trade a FIXED qty every time (lotSize × fixedLots), ignoring risk%/stop distance.
    //           Mirrors the live bot exactly: autoTrader.js's EMA5T entry is hardcoded to
    //           exactly underlying.lotSize (1 lot) regardless of CONFIG.RISK_PERCENT — "RISK"
    //           mode here does NOT match what the live bot actually trades; use "LOTS" (with
    //           fixedLots matching the live default of 1) for a true live-parity backtest.
    positionSizingMode = "RISK",
    fixedLots = 1,
    // "FUTURES" is the only INDEX-mode case simulating a real, costed instrument (the current-month
    // contract EMA5T actually trades) — gates the statutory cost deduction below. "INDEX" trades the
    // raw index itself, which isn't directly tradable and stays cost-free, same as before.
    instrumentSource = "INDEX",
    // Optional VIX-regime filter (parity with the live bot's MIN_VIX_FILTER). OFF by default. When on,
    // an EMA5T entry is skipped if the prior-day India VIX (priorDayVix: Map dateStr → prior close) is
    // below minVix. The route builds priorDayVix only when the filter is on.
    minVixFilter = false,
    minVix = 15,
    priorDayVix = null,
  } = config;

  const isBS = pricingModel === "BLACK_SCHOLES";
  const symDefaults = getOptionDefaults(symbol);
  const bs = {
    iv: Number(annualizedIV) > 0 ? Number(annualizedIV) : symDefaults.iv,
    strikeInterval: Number(strikeInterval) > 0 ? Number(strikeInterval) : symDefaults.strikeInterval,
    lotSize: Number(lotSize) > 0 ? Number(lotSize) : symDefaults.lotSize,
    riskFreeRate: Number(riskFreeRate) > 0 ? Number(riskFreeRate) : 0.065,
    expiryWeekday: Number.isInteger(expiryWeekday) ? expiryWeekday : symDefaults.expiryWeekday,
    expiryFrequency: expiryFrequency === "WEEKLY" || expiryFrequency === "MONTHLY" ? expiryFrequency : symDefaults.expiryFrequency,
    halfSpread: (Number(optionSpreadPct) >= 0 ? Number(optionSpreadPct) : 1.0) / 100 / 2,
  };
  const timeToExpiry = bs.expiryFrequency === "MONTHLY" ? yearsToMonthlyExpiry : yearsToExpiry;
  const round2 = (n) => Math.round(n * 100) / 100;

  // Resolve the IV to use at every bar. With INDIA_VIX we align the VIX series to the price
  // candles by timestamp and carry the last known VIX forward across any gaps; otherwise the
  // flat IV is used everywhere. candleIv[i] is the volatility fed to Black-Scholes at bar i,
  // so IV evolves through a trade (e.g. an intraday VIX spike) instead of being a single guess.
  const ivMult = Number(ivMultiplier) > 0 ? Number(ivMultiplier) : 1;
  const isVixSource = isBS && ivSource === "INDIA_VIX" && Array.isArray(ivSeries) && ivSeries.length > 0;
  const candleIv = new Array(candles.length).fill(bs.iv);
  if (isVixSource) {
    const ivMap = new Map();
    for (const p of ivSeries) {
      if (p && p.iv > 0) ivMap.set(p.timestamp, p.iv);
    }
    let last = bs.iv; // fallback until the first VIX bar is seen
    for (let k = 0; k < candles.length; k++) {
      const v = ivMap.get(candles[k].timestamp);
      if (v > 0) last = v * ivMult;
      candleIv[k] = last;
    }
  }

  // Pre-calculate indicators
  const closes = candles.map((c) => c.close);
  const emaValues = calculateEMA(closes, emaPeriod);
  const emaOffset = candles.length - emaValues.length;
  // EMA5T's no-lookahead trend gate: a trendEmaPeriod-EMA on the SAME timeframe, read AT the
  // alert bar (never beyond it) — identical to emaStrategy.js's detectAlertCandle (live parity).
  const trendEmaValues = calculateEMA(closes, trendEmaPeriod);
  const trendEmaOffset = candles.length - trendEmaValues.length;

  const trades = [];
  const equityCurve = [{ date: candles[0].datetime, equity: capital }];
  let currentCapital = capital;

  // In FIXED mode, position sizing always uses initialCapital
  // In COMPOUND mode, position sizing uses current capital
  const initialCapital = Number(capital);

  let position = null;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let totalPnL = 0;
  let maxDrawdown = 0;
  let peakEquity = capital;
  let maxConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;

  // Alert Candle tracking for 5 EMA strategy
  let alertCandle = null;

  // ── Live-parity gating state (C3) ────────────────────────────────
  const limits = {
    sessionStartDecimal, sessionEndDecimal, maxTimeEntryHour, maxTradesPerDay,
    dailyLossCap: initialCapital * (Number(maxRiskPerDayPercent) || 0) / 100,
  };
  let curDay = null, dayTrades = 0, dayPnL = 0;
  const blockedByFilter = {}; // reason -> count, surfaced in the result for transparency

  // Build a position from an index breakout, identically triggered in both modes.
  // INDEX mode reproduces the original engine exactly. BLACK_SCHOLES mode trades an ATM
  // option on the same signal: entry/SL/target levels stay in INDEX points (they remain
  // the exit triggers), but qty is sized against option-premium risk and the recorded
  // entryPrice is the BUY premium (mid + half-spread).
  function buildPosition(side, rawEntry, sl, i, candle) {
    const riskAmount = (capitalMode === "FIXED" ? initialCapital : currentCapital) * (riskPercent / 100);
    // Reject a structurally degenerate alert setup (nominal entry level === SL, e.g. a perfectly
    // flat alert candle) BEFORE any gap adjustment — a real setup like this can't exist (SL is
    // always the alert candle's opposite extreme, distinct from the entry level), so this only
    // fires on synthetic edge cases, but it must reject on the RAW levels, not the gap-adjusted
    // fillBase below: a real gap could make fillBase legitimately differ from a degenerate rawEntry,
    // which would otherwise let a setup through that was never a valid signal to begin with.
    if (Math.abs(rawEntry - sl) <= 0) return null;

    // Gap-adjusted fill spot, shared by BOTH pricing modes: if the breakout candle's OPEN already
    // cleared rawEntry, the market gapped straight through it — the real fill (and everything
    // priced FROM it — target, strike selection, the option premium itself in BS mode) happens at
    // (or near) the open, not the stale nominal level. Matches checkEntryOrderFill's identical gap
    // check in autoTrader.js (single source of truth for entry-fill behavior). Previously BS mode
    // priced entry/target off the raw, un-adjusted rawEntry — on a hard gap that meant the modeled
    // option was priced (and its target set) against an index level the market never actually gave
    // you, which is what made BS-mode P&L diverge so far from real option premiums on gappy days.
    const gappedThrough = side === "LONG" ? candle.open >= rawEntry : candle.open <= rawEntry;
    const fillBase = gappedThrough ? candle.open : rawEntry;

    if (isBS) {
      const stopDistance = Math.abs(fillBase - sl);
      if (stopDistance <= 0) return null;
      const targetDistance = stopDistance * targetMultiplier;
      const indexTarget = side === "LONG" ? fillBase + targetDistance : fillBase - targetDistance;

      const optionType = side === "LONG" ? "CE" : "PE";
      const strike = roundToStrike(fillBase, bs.strikeInterval);
      const t = timeToExpiry(candle.timestamp, bs.expiryWeekday);
      const iv = candleIv[i];
      const entryMid = bsPrice({ type: optionType, spot: fillBase, strike, t, r: bs.riskFreeRate, sigma: iv });
      if (!(entryMid > 0)) return null;
      const entryPremium = round2(entryMid * (1 + bs.halfSpread)); // pay the ask
      // Option-premium risk per unit ≈ premium drop if the index reaches the SL level.
      const slMid = bsPrice({ type: optionType, spot: sl, strike, t, r: bs.riskFreeRate, sigma: iv });
      const slPremium = Math.max(0, slMid * (1 - bs.halfSpread));
      const optionRiskPerUnit = Math.max(0.05, entryPremium - slPremium);
      let qty = positionSizingMode === "LOTS"
        ? bs.lotSize * fixedLots
        : Math.floor(riskAmount / optionRiskPerUnit / bs.lotSize) * bs.lotSize;
      // Never deploy more premium than available capital.
      // C3/margin-parity: cap deployed premium by capital × the live margin-safety multiplier.
      const marginMult = applyLiveFilters ? (Number(marginSafetyMultiplier) > 0 ? marginSafetyMultiplier : 1) : 1;
      const maxByCapital = Math.floor(currentCapital / (entryPremium * marginMult) / bs.lotSize) * bs.lotSize;
      qty = Math.min(qty, maxByCapital);
      if (qty <= 0) return null;
      return {
        mode: "BS", side, optionType, strike,
        entryPrice: entryPremium, entryPremium,
        indexEntry: round2(fillBase),
        qty,
        sl: round2(sl),
        target: round2(indexTarget),
        entryBar: i,
        entryTime: candle.datetime,
        riskAtEntry: round2(optionRiskPerUnit * qty), // rupees risked at this qty — feeds R-multiple stats
      };
    }

    // INDEX mode — original arithmetic preserved (slippage on entry, qty by index points). Target/
    // idxStop below are derived FROM entryPrice, so gap-adjusting fillBase above automatically
    // scales the target to the REAL entry — no separate adjustment needed.
    const entryPrice = side === "LONG"
      ? round2(fillBase * (1 + slippage))
      : round2(fillBase * (1 - slippage));
    const idxStop = side === "LONG" ? entryPrice - sl : sl - entryPrice;
    if (idxStop <= 0) return null;
    // LOTS: fixed qty every trade (lotSize × fixedLots) — matches EMA5T's actual live sizing,
    // which never scales with riskPercent. RISK: original risk-based sizing, unchanged.
    const qty = positionSizingMode === "LOTS"
      ? symDefaults.lotSize * fixedLots
      : Math.floor(riskAmount / idxStop);
    if (qty <= 0) return null;
    const idxTargetDist = idxStop * targetMultiplier;
    return {
      mode: "INDEX", side,
      entryPrice,
      qty,
      sl: round2(sl),
      target: side === "LONG" ? round2(entryPrice + idxTargetDist) : round2(entryPrice - idxTargetDist),
      entryBar: i,
      entryTime: candle.datetime,
      riskAtEntry: round2(idxStop * qty), // rupees risked at this qty — feeds R-multiple stats
    };
  }

  // Price the option leg at exit and return { entryRec, exitRec, pnl, costs } for a BS position.
  function settleBSExit(pos, exitSpot, candle, iv) {
    const tExit = timeToExpiry(candle.timestamp, bs.expiryWeekday);
    const exitMid = bsPrice({ type: pos.optionType, spot: exitSpot, strike: pos.strike, t: tExit, r: bs.riskFreeRate, sigma: iv });
    const exitPremium = Math.max(0, round2(exitMid * (1 - bs.halfSpread))); // hit the bid
    const gross = (exitPremium - pos.entryPremium) * pos.qty;
    const costs = computeOptionCosts(pos.entryPremium, exitPremium, pos.qty, { brokeragePerOrder });
    return { entryRec: pos.entryPremium, exitRec: exitPremium, pnl: gross - costs, costs };
  }

  // Gated entry shared by both strategies (C3): when a breakout would fire, apply the live entry
  // filters FIRST. A blocked signal consumes the alert (mirrors the live bot deleting the alert on a
  // canTakeTrade failure) and is tallied in blockedByFilter for transparency.
  function tryEnterFromAlert(candle, i, clk) {
    if (!alertCandle) return;
    const ac = alertCandle.candle;
    const wantLong = alertCandle.type === "BULLISH" && candle.high > ac.high;
    const wantShort = alertCandle.type === "BEARISH" && candle.low < ac.low;
    if (!wantLong && !wantShort) return;
    if (applyLiveFilters) {
      const gate = liveEntryGate(
        { decimal: clk.decimal, hour: clk.hour, dayTrades, dayPnL },
        limits
      );
      if (!gate.allow) {
        blockedByFilter[gate.reason] = (blockedByFilter[gate.reason] || 0) + 1;
        alertCandle = null;
        return;
      }
    }
    // Optional MIN_VIX regime filter (parity with live). Uses the PRIOR-day VIX close (no lookahead);
    // fail-closed if that date's VIX is unknown.
    if (minVixFilter && priorDayVix) {
      const vix = priorDayVix.get(String(candle.datetime).slice(0, 10));
      if (vix == null || vix < minVix) {
        blockedByFilter["MIN_VIX"] = (blockedByFilter["MIN_VIX"] || 0) + 1;
        alertCandle = null;
        return;
      }
    }
    const side = wantLong ? "LONG" : "SHORT";
    const pos = buildPosition(side, wantLong ? ac.high : ac.low, wantLong ? ac.low : ac.high, i, candle);
    if (pos) { position = pos; alertCandle = null; }
  }

  // C3: align warmup with the live bot, which signals as soon as it has enough candles (6 for EMA5;
  // trendEmaPeriod for EMA5_OPTION/EMA5T's trend EMA). The old flat 50-bar warmup made the backtest
  // skip the first ~4h that the live bot trades. Keep 50 only when live filters are off (legacy raw
  // mode).
  const liveWarmup = (strategy === "EMA5_OPTION" || strategy === "EMA5T") ? trendEmaPeriod : Math.max(emaPeriod + 1, 6);
  const warmup = Math.max(emaOffset, applyLiveFilters ? liveWarmup : 50);

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    const ema = i >= emaOffset ? emaValues[i - emaOffset] : null;
    const clk = istClock(candle.timestamp);
    // New IST day: reset the per-day live-gate counters. currentConsecutiveLosses MUST reset here too
    // to match the live bot (autoTrader tradingLoop zeroes consecutiveLosses each new day) — the
    // consecutive-loss breaker is an INTRADAY stop, not a lifetime kill switch. Without this reset a
    // strategy that hit 3 straight losses stayed permanently blocked (blocked ⇒ no wins ⇒ counter never
    // cleared), silently freezing it for the rest of the run and diverging from live.
    if (clk.dayKey !== curDay) {
      curDay = clk.dayKey; dayTrades = 0; dayPnL = 0; currentConsecutiveLosses = 0;
      // EMA5T parity: resting stop entries never carry across days (autoTrader.js clears
      // pendingEntries every new IST day) — a stale alert must not fire on a later session.
      if (strategy === "EMA5T") alertCandle = null;
    }

    if (currentCapital > peakEquity) peakEquity = currentCapital;
    const drawdown = ((peakEquity - currentCapital) / peakEquity) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    // ── Exit Logic (common for all strategies) ────────────────────
    if (position) {
      const barsHeld = i - position.entryBar;
      let exitReason = "";
      let indexExitLevel = null; // clean index level the position exits at

      // C3: intraday square-off at 15:15 IST (mirrors isSquareOffTime), highest priority.
      if (applyLiveFilters && (clk.hour > squareOffHour || (clk.hour === squareOffHour && clk.minute >= squareOffMinute))) {
        exitReason = "SQUARE_OFF";
        indexExitLevel = candle.close;
      } else if (position.side === "LONG" && candle.low <= position.sl) {
        exitReason = "SL";
        indexExitLevel = position.sl;
      } else if (position.side === "SHORT" && candle.high >= position.sl) {
        exitReason = "SL";
        indexExitLevel = position.sl;
      } else if (position.side === "LONG" && candle.high >= position.target) {
        exitReason = "TARGET";
        indexExitLevel = position.target;
      } else if (position.side === "SHORT" && candle.low <= position.target) {
        exitReason = "TARGET";
        indexExitLevel = position.target;
      } else if (strategy !== "EMA5T" && barsHeld >= maxHoldBars) {
        // EMA5T has no hold-time cap live — autoTrader.js only ever exits a position via SL,
        // target, or the 15:15 IST square-off (already handled above). Applying maxHoldBars here
        // artificially truncated real EMA5T trades (esp. on 15m, where 12 bars is only 3 hours),
        // then let the backtest re-enter a fresh, untraded signal once "freed up" — a different
        // trade sequence than live actually experienced, not just a smaller number. Legacy EMA5 /
        // EMA5_OPTION backtests keep the cap unchanged (no live counterpart to match).
        exitReason = "TIME";
        indexExitLevel = candle.close;
      }

      if (exitReason) {
        let entryRec, exitRec, pnl;
        let tradeCosts = 0;

        if (position.mode === "BS") {
          // Same trigger & exit index level; P&L is option-premium based (delta + theta + costs).
          ({ entryRec, exitRec, pnl, costs: tradeCosts } = settleBSExit(position, indexExitLevel, candle, candleIv[i]));
        } else {
          // INDEX mode — original open-aware fill + slippage arithmetic preserved.
          let exitPrice;
          if (exitReason === "TIME" || exitReason === "SQUARE_OFF") {
            // SQUARE_OFF (and TIME) exit at the bar close — NOT the target branch. Without this the
            // 15:15 forced exit was mispriced to min(open,target), distorting INDEX-mode parity P&L.
            exitPrice = candle.close;
          } else if (exitReason === "SL") {
            // Worst-case fill, mirroring the TARGET branch below: assume the stop fills AT the SL
            // level, not at the candle's open, unless the candle actually gapped through to a worse
            // price. A real resting stop order doesn't fill better than its trigger just because
            // price happened to open above it earlier in the bar.
            const rawExit = position.side === "LONG" ? Math.min(candle.open, position.sl) : Math.max(candle.open, position.sl);
            exitPrice = Math.round(rawExit * (position.side === "LONG" ? (1 - slippage) : (1 + slippage)) * 100) / 100;
          } else {
            const rawExit = position.side === "LONG" ? Math.min(candle.open, position.target) : Math.max(candle.open, position.target);
            exitPrice = Math.round(rawExit * (position.side === "LONG" ? (1 - slippage) : (1 + slippage)) * 100) / 100;
          }
          const gross = position.side === "LONG"
            ? (exitPrice - position.entryPrice) * position.qty
            : (position.entryPrice - exitPrice) * position.qty;
          // Costed whenever this is EMA5T, not just when instrumentSource is literally "FUTURES":
          // EMA5T only ever trades the futures contract live/paper, even when the backtest borrowed
          // INDEX candles for deeper history than the current contract has — the real trade this
          // signal represents is always a futures fill, so it always carries a futures fill's costs.
          tradeCosts = strategy === "EMA5T"
            ? computeFuturesCosts(position.entryPrice, exitPrice, position.qty, { brokeragePerOrder, side: position.side })
            : 0;
          pnl = gross - tradeCosts;
          entryRec = position.entryPrice;
          exitRec = exitPrice;
        }

        const pnlPercent = (pnl / (entryRec * position.qty)) * 100;

        currentCapital += pnl;
        totalTrades++;
        totalPnL += pnl;
        dayTrades++;     // C3: per-IST-day counters feed the live-parity entry gate
        dayPnL += pnl;

        if (pnl > 0) {
          wins++;
          currentConsecutiveLosses = 0;
        } else {
          losses++;
          currentConsecutiveLosses++;
          if (currentConsecutiveLosses > maxConsecutiveLosses) {
            maxConsecutiveLosses = currentConsecutiveLosses;
          }
        }

        trades.push({
          id: totalTrades,
          entryTime: position.entryTime,
          exitTime: candle.datetime,
          side: position.side,
          entryPrice: entryRec,
          exitPrice: exitRec,
          qty: position.qty,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          costs: Math.round(tradeCosts * 100) / 100, // statutory + brokerage, already netted out of pnl above
          exitReason,
          barsHeld,
          capitalAfter: Math.round(currentCapital * 100) / 100,
          sl: position.sl,        // index level — same price scale as the candles, for the chart overlay
          target: position.target,
          riskAtEntry: position.riskAtEntry,
          ...(position.mode === "BS" ? { optionType: position.optionType, strike: position.strike, indexEntry: position.indexEntry } : {}),
        });

        equityCurve.push({
          date: candle.datetime,
          equity: Math.round(currentCapital * 100) / 100,
        });

        position = null;
        alertCandle = null;
      }
      continue;
    }

    // ════════════════════════════════════════════════════════════════
    // ENTRY LOGIC — Strategy Selection
    // ════════════════════════════════════════════════════════════════

    // ── 5 EMA Strategy (Subhasish Pani) ──────────────────────────
    else if (strategy === "EMA5" && ema !== null) {
      // Alert candle = a candle ENTIRELY beyond the 5 EMA (shared rule). Persists until a
      // new qualifying candle overwrites it or an entry consumes it.
      const at = detectAlert({ close: prevCandle.close, high: prevCandle.high, low: prevCandle.low, ema });
      if (at) {
        alertCandle = { candle: prevCandle, type: at, index: i - 1 };
      }
      tryEnterFromAlert(candle, i, clk); // C3: gated entry (break of alert high/low + live filters)
    }

    // ── 5 EMA Option Buying (Subhasish Pani) ─────────────────────
    else if (strategy === "EMA5_OPTION" && ema !== null) {
      // Calculate higher timeframe trend (20 EMA)
      const ema20 = calculateEMA(closes.slice(0, i + 1), 20);
      const trendEMA20 = ema20[ema20.length - 1];

      // Same alert rule, gated by the higher-timeframe 20-EMA trend (shared detectAlert).
      const at = detectAlert({ close: prevCandle.close, high: prevCandle.high, low: prevCandle.low, ema, trendEma: trendEMA20 });
      if (at) {
        alertCandle = { candle: prevCandle, type: at, index: i - 1 };
      }
      tryEnterFromAlert(candle, i, clk); // C3: gated entry
    }

    // ── EMA5T: trend-gated futures strategy (the only LIVE/paper strategy) ───────
    else if (strategy === "EMA5T" && ema !== null) {
      // Trend gate read AT the alert bar (i-1), never beyond it — matches emaStrategy.js's
      // detectAlertCandle exactly (no-lookahead: live sees only what this backtest saw).
      const trendBarIndex = i - 1;
      const trendEma = trendBarIndex >= trendEmaOffset ? trendEmaValues[trendBarIndex - trendEmaOffset] : null;
      if (trendEma !== null) {
        const at = detectAlert({ close: prevCandle.close, high: prevCandle.high, low: prevCandle.low, ema, trendEma });
        if (at) {
          alertCandle = { candle: prevCandle, type: at, index: i - 1 };
        }
      }
      tryEnterFromAlert(candle, i, clk); // same resting-breakout entry as live's manageFuturesPending
    }
  }



  if (position) {
    const lastCandle = candles[candles.length - 1];
    let entryRec, exitRec, pnl;
    let tradeCosts = 0;
    if (position.mode === "BS") {
      ({ entryRec, exitRec, pnl, costs: tradeCosts } = settleBSExit(position, lastCandle.close, lastCandle, candleIv[candles.length - 1]));
    } else {
      exitRec = lastCandle.close;
      entryRec = position.entryPrice;
      const gross = position.side === "LONG"
        ? (exitRec - position.entryPrice) * position.qty
        : (position.entryPrice - exitRec) * position.qty;
      tradeCosts = strategy === "EMA5T"
        ? computeFuturesCosts(position.entryPrice, exitRec, position.qty, { brokeragePerOrder, side: position.side })
        : 0;
      pnl = gross - tradeCosts;
    }

    currentCapital += pnl;
    totalTrades++;
    totalPnL += pnl;
    if (pnl > 0) wins++; else losses++;

    trades.push({
      id: totalTrades,
      entryTime: position.entryTime,
      exitTime: lastCandle.datetime,
      side: position.side,
      entryPrice: entryRec,
      exitPrice: exitRec,
      qty: position.qty,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round((pnl / (entryRec * position.qty)) * 100 * 100) / 100,
      costs: Math.round(tradeCosts * 100) / 100,
      exitReason: "END_OF_DATA",
      barsHeld: candles.length - position.entryBar,
      capitalAfter: Math.round(currentCapital * 100) / 100,
      sl: position.sl,
      target: position.target,
      riskAtEntry: position.riskAtEntry,
      ...(position.mode === "BS" ? { optionType: position.optionType, strike: position.strike, indexEntry: position.indexEntry } : {}),
    });
  }

  const totalReturn = ((currentCapital - capital) / capital) * 100;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / losses : 0;
  const expectancy = totalTrades > 0 ? (totalPnL / totalTrades) : 0;
  const winPct = totalTrades > 0 ? wins / totalTrades : 0;
  const lossPct = totalTrades > 0 ? losses / totalTrades : 0;
  const avgLossAbs = Math.abs(avgLoss);
  const expectancyRatio = avgLossAbs > 0 ? ((winPct * avgWin) - (lossPct * avgLossAbs)) / avgLossAbs : 0;

  // Post-processing analytics over the finished trade log — streaks, R-multiples, Sharpe/Sortino,
  // CAGR/Calmar, yearly/hour/day-of-week breakdowns, etc. See backtestStats.js for definitions.
  const advanced = computeAdvancedStats({
    trades,
    candles,
    initialCapital: capital,
    maxDrawdownPercent: maxDrawdown,
  });

  return {
    summary: {
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalPnL: Math.round(totalPnL * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      // profitFactor is now the STANDARD definition (gross profit / gross loss), computed in
      // backtestStats.js — a prior version of this field was actually avgWin/avgLoss (that's
      // payoffRatio, kept alongside it below under its correct name).
      profitFactor: advanced.profitFactor,
      payoffRatio: advanced.payoffRatio,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      expectancyRatio: Math.round(expectancyRatio * 100) / 100,
      finalCapital: Math.round(currentCapital * 100) / 100,
      maxConsecutiveLosses,
      pricingModel: isBS ? "BLACK_SCHOLES" : "INDEX",
    },
    advanced,
    // Echo the effective option assumptions so the UI can show exactly what was simulated.
    optionModel: isBS
      ? {
          iv: bs.iv,
          strikeInterval: bs.strikeInterval,
          lotSize: bs.lotSize,
          riskFreeRate: bs.riskFreeRate,
          expiryWeekday: bs.expiryWeekday,
          expiryFrequency: bs.expiryFrequency,
          spreadPct: bs.halfSpread * 2 * 100,
          brokeragePerOrder,
          ivSource: isVixSource ? "INDIA_VIX" : "FLAT",
          ivMultiplier: ivMult,
          vixPoints: isVixSource ? ivSeries.length : 0,
        }
      : null,
    trades,
    equityCurve,
    // C3: live-parity transparency — which live gates were applied, how many signals each blocked,
    // and the honest caveat that OI/liquidity is NOT data-faithful (no historical per-strike OI).
    parity: {
      applyLiveFilters,
      filtersApplied: applyLiveFilters
        ? ["session", "entryCutoff14", "maxTradesPerDay", "dailyLoss", "squareOff1515", "marginSafety"]
        : [],
      blockedByFilter,
      oiModeled: true,              // MIN_OI gate cannot be reproduced (no historical per-strike OI)
      correlationApplicable: false, // single-symbol backtest; cross-underlying correlation N/A
    },
  };
}

// ─── API Endpoint: Run Backtest ───────────────────────────────────
router.post("/run", async (req, res) => {
  const {
    symbol = "NSE:NIFTYBANK-INDEX",
    resolution = "5",
    fromDate,
    toDate,
    strategy = "EMA5",
    emaPeriod = 5,
    trendEmaPeriod = 20,
    capital = 1000000,
    riskPercent = 1,
    slBuffer = 0.005,
    targetMultiplier = 2,
    maxHoldBars = 12,
    slippage = 0.0002, // 0.02% — was never forwarded to runBacktest below, so the UI's Slippage % had no effect
    // Pricing-model controls (see runBacktest). pricingModel defaults to INDEX so existing
    // callers are unaffected.
    pricingModel = "INDEX",
    annualizedIV,
    riskFreeRate,
    strikeInterval,
    lotSize,
    expiryWeekday,
    expiryFrequency,
    optionSpreadPct,
    brokeragePerOrder,
    ivSource = "FLAT",
    ivMultiplier,
    // EMA5T only: "INDEX" (default, full history) trades the index candles directly under the
    // trend-gated rules; "FUTURES" resolves and trades the actual current-month futures contract
    // (the literal live instrument), which FYERS only has a few weeks of history for.
    instrumentSource = "INDEX",
  } = req.body;

  if (!fromDate || !toDate) {
    return res.status(400).json({ error: "fromDate and toDate are required (YYYY-MM-DD format)" });
  }

  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(401).json({ error: "FYERS session required for backtesting" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired FYERS session" });
  }

  try {
    const fromTs = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(toDate).getTime() / 1000) + 86400;

    let fetchSymbol = symbol;
    // Only genuinely "FUTURES" when candles actually came from the resolved futures contract below —
    // any other strategy/instrumentSource combination still fetches the index, so runBacktest must
    // see "INDEX" for those or it would apply real futures costs to un-costed index candles.
    let effectiveInstrumentSource = "INDEX";
    if (strategy === "EMA5T" && instrumentSource === "FUTURES") {
      const underlyingName = EMA5T_UNDERLYINGS[symbol];
      if (!underlyingName) {
        return res.status(400).json({ error: `EMA5T futures backtesting only supports Bank Nifty / Nifty 50 (got ${symbol}).` });
      }
      const resolved = await resolveCurrentFuturesSymbol(underlyingName, session.accessToken);
      if (!resolved) {
        return res.status(400).json({ error: `Could not resolve a tradable ${underlyingName} futures contract right now (FYERS returned no valid quote for the current or next 2 months). Try Index mode instead.` });
      }
      fetchSymbol = resolved;
      effectiveInstrumentSource = "FUTURES";
    }

    const rawCandles = await fetchHistoricalData(fetchSymbol, resolution, fromTs, toTs, session.accessToken);
    const candles = parseCandles(rawCandles);

    if (candles.length < 20) {
      const hint = instrumentSource === "FUTURES"
        ? " Futures history only exists for the current contract's lifetime (a few weeks since listing) — try a more recent date range, or use Index mode for deep history."
        : "";
      return res.status(400).json({ error: `Insufficient data for backtest (${candles.length} candles). FYERS returned no data for ${fetchSymbol} between ${fromDate} and ${toDate}.${hint}` });
    }

    const ivSeries = await fetchIvSeries({ pricingModel, ivSource, resolution, fromTs, toTs, accessToken: session.accessToken });

    // Optional VIX-regime filter: fetch daily India VIX and map each date -> the PRIOR day's close
    // (no lookahead), only when the filter is requested.
    let priorDayVix = null;
    if (req.body.minVixFilter) {
      try {
        const vixRaw = await fetchHistoricalData("NSE:INDIAVIX-INDEX", "D", fromTs, toTs, session.accessToken);
        const vd = parseCandles(vixRaw).filter((v) => v.close > 0).sort((a, b) => a.timestamp - b.timestamp);
        priorDayVix = new Map();
        for (let k = 1; k < vd.length; k++) priorDayVix.set(vd[k].datetime.slice(0, 10), vd[k - 1].close);
      } catch (e) {
        console.error("[backtest] VIX fetch for MIN_VIX filter failed; filter will block all entries:", e.message);
        priorDayVix = new Map();
      }
    }

    const result = runBacktest(candles, {
      symbol,
      strategy,
      emaPeriod,
      trendEmaPeriod,
      capital,
      riskPercent,
      slBuffer,
      targetMultiplier,
      maxHoldBars,
      slippage,
      capitalMode: req.body.capitalMode || "COMPOUND",
      pricingModel,
      annualizedIV,
      riskFreeRate,
      strikeInterval,
      lotSize,
      expiryWeekday,
      expiryFrequency,
      optionSpreadPct,
      brokeragePerOrder,
      ivSource,
      ivMultiplier,
      ivSeries,
      instrumentSource: effectiveInstrumentSource,
      // C3 live-parity controls. Undefined → runBacktest's defaults (full parity) apply; the UI can
      // pass applyLiveFilters:false for the legacy raw "idea filter" run, or override any threshold.
      applyLiveFilters: req.body.applyLiveFilters,
      maxTimeEntryHour: req.body.maxTimeEntryHour,
      maxTradesPerDay: req.body.maxTradesPerDay,
      maxRiskPerDayPercent: req.body.maxRiskPerDayPercent,
      marginSafetyMultiplier: req.body.marginSafetyMultiplier,
      positionSizingMode: req.body.positionSizingMode,
      fixedLots: req.body.fixedLots,
      minVixFilter: req.body.minVixFilter,
      minVix: req.body.minVix,
      priorDayVix,
    });

    res.json({
      success: true,
      symbol,
      resolution,
      strategy,
      fromDate,
      toDate,
      totalCandles: candles.length,
      candles, // Include raw candles for chart rendering
      instrumentSource,
      tradedSymbol: fetchSymbol, // the exact symbol candles were fetched for (== symbol unless FUTURES)
      ...result,
    });
  } catch (error) {
    console.error("Backtest error:", error);
    res.status(500).json({ error: error.message || "Backtest failed" });
  }
});

// ─── API Endpoint: Resolve the current EMA5T futures contract + its real date range ──
// Lightweight — resolves the symbol and reads its actual earliest/latest candle at DAILY
// resolution (not subject to the 100-day intraday chunk limit, so one request), without
// running the backtest engine. Lets the UI auto-fill From/To to the true available window
// instead of the user guessing (FYERS has no "list active contracts" or date-range endpoint).
router.post("/futures-range", async (req, res) => {
  const { symbol } = req.body;
  const underlyingName = EMA5T_UNDERLYINGS[symbol];
  if (!underlyingName) {
    return res.status(400).json({ error: `Futures backtesting only supports Bank Nifty / Nifty 50 (got ${symbol}).` });
  }

  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(401).json({ error: "FYERS session required" });
  }
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired FYERS session" });
  }

  try {
    const tradedSymbol = await resolveCurrentFuturesSymbol(underlyingName, session.accessToken);
    if (!tradedSymbol) {
      return res.status(400).json({ error: `Could not resolve a tradable ${underlyingName} futures contract right now (FYERS returned no valid quote for the current or next 2 months).` });
    }
    const toTs = Math.floor(Date.now() / 1000);
    const fromTs = toTs - 730 * DAY_IN_SECONDS; // 2 years of headroom; cont_flag=1 can splice in more than this contract's own listing window
    // 730 days exceeds FYERS's 366-day cap for daily resolution — fetchHistoricalData chunks it
    // (fetchSingleRange would send it as one request and FYERS would reject the whole thing).
    const rawCandles = await fetchHistoricalData(tradedSymbol, "D", fromTs, toTs, session.accessToken);
    if (!rawCandles.length) {
      return res.status(400).json({ error: `No historical data available yet for ${tradedSymbol}.` });
    }
    res.json({
      success: true,
      tradedSymbol,
      earliestDate: new Date(rawCandles[0][0] * 1000).toISOString().slice(0, 10),
      latestDate: new Date(rawCandles[rawCandles.length - 1][0] * 1000).toISOString().slice(0, 10),
    });
  } catch (error) {
    console.error("Futures-range error:", error);
    res.status(500).json({ error: error.message || "Failed to resolve futures date range" });
  }
});

// ─── API Endpoint: Get raw historical data ────────────────────────
router.post("/data", async (req, res) => {
  const { symbol, resolution, fromDate, toDate } = req.body;

  if (!symbol || !fromDate || !toDate) {
    return res.status(400).json({ error: "symbol, fromDate, and toDate are required" });
  }

  let sessionId = req.headers["x-session-id"];
  let session = sessionId ? getSession(sessionId) : null;
  
  // If no session ID provided or invalid, try to use any active session
  if (!session) {
    const sessions = getAllSessions();
    if (sessions.length > 0) {
      session = sessions[0];
      console.log("Using available session for /backtest/data:", session.userId);
    }
  }

  if (!session) {
    return res.status(401).json({ error: "No active FYERS session. Please connect FYERS at https://roshanvijay.com" });
  }

  try {
    const fromTs = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(toDate).getTime() / 1000) + 86400;

    const rawCandles = await fetchHistoricalData(symbol, resolution, fromTs, toTs, session.accessToken);
    const candles = parseCandles(rawCandles);

    res.json({
      success: true,
      symbol,
      resolution,
      fromDate,
      toDate,
      totalCandles: candles.length,
      candles,
    });
  } catch (error) {
    console.error("Data fetch error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch data" });
  }
});

// ─── API Endpoint: Run Multiple Strategies ────────────────────────
router.post("/run-multi", async (req, res) => {
  const {
    symbol = "NSE:NIFTYBANK-INDEX",
    resolution = "5",
    fromDate,
    toDate,
    strategies = ["EMA5"],
    emaPeriod = 5,
    trendEmaPeriod = 20,
    capital = 1000000,
    riskPercent = 1,
    slBuffer = 0.005,
    targetMultiplier = 2,
    maxHoldBars = 12,
    pricingModel = "INDEX",
    annualizedIV,
    riskFreeRate,
    strikeInterval,
    lotSize,
    expiryWeekday,
    expiryFrequency,
    optionSpreadPct,
    brokeragePerOrder,
    ivSource = "FLAT",
    ivMultiplier,
  } = req.body;

  if (!fromDate || !toDate) {
    return res.status(400).json({ error: "fromDate and toDate are required" });
  }

  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(401).json({ error: "FYERS session required" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired FYERS session" });
  }

  try {
    const fromTs = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(toDate).getTime() / 1000) + 86400;

    const rawCandles = await fetchHistoricalData(symbol, resolution, fromTs, toTs, session.accessToken);
    const candles = parseCandles(rawCandles);

    if (candles.length < 20) {
      return res.status(400).json({ error: `Insufficient data for backtest (${candles.length} candles). FYERS returned no data for ${symbol} between ${fromDate} and ${toDate}. Try a different date range or symbol.` });
    }

    const ivSeries = await fetchIvSeries({ pricingModel, ivSource, resolution, fromTs, toTs, accessToken: session.accessToken });

    const results = [];
    for (const strat of strategies) {
    const result = runBacktest(candles, {
      symbol,
      strategy: strat,
      emaPeriod,
      trendEmaPeriod,
      capital,
      riskPercent,
      slBuffer,
      targetMultiplier,
      maxHoldBars,
      capitalMode: req.body.capitalMode || "COMPOUND",
      pricingModel,
      annualizedIV,
      riskFreeRate,
      strikeInterval,
      lotSize,
      expiryWeekday,
      expiryFrequency,
      optionSpreadPct,
      brokeragePerOrder,
      ivSource,
      ivMultiplier,
      ivSeries,
      // C3 live-parity controls — forwarded so /run-multi matches /run (defaults to full parity).
      applyLiveFilters: req.body.applyLiveFilters,
      maxTimeEntryHour: req.body.maxTimeEntryHour,
      maxTradesPerDay: req.body.maxTradesPerDay,
      maxRiskPerDayPercent: req.body.maxRiskPerDayPercent,
      marginSafetyMultiplier: req.body.marginSafetyMultiplier,
      positionSizingMode: req.body.positionSizingMode,
      fixedLots: req.body.fixedLots,
    });
      results.push({
        strategy: strat,
        ...result,
      });
    }

    // Combined summary
    const allTrades = results.flatMap(r => r.trades);
    const combinedPnL = allTrades.reduce((s, t) => s + t.pnl, 0);
    const combinedWins = allTrades.filter(t => t.pnl > 0).length;
    const combinedLosses = allTrades.filter(t => t.pnl <= 0).length;
    const combinedTotal = allTrades.length;

    res.json({
      success: true,
      symbol,
      resolution,
      strategies,
      fromDate,
      toDate,
      totalCandles: candles.length,
      results,
      combined: {
        totalTrades: combinedTotal,
        wins: combinedWins,
        losses: combinedLosses,
        winRate: combinedTotal > 0 ? Math.round((combinedWins / combinedTotal) * 10000) / 100 : 0,
        totalPnL: Math.round(combinedPnL * 100) / 100,
        totalReturn: Math.round(((capital + combinedPnL - capital) / capital) * 10000) / 100,
        finalCapital: Math.round((capital + combinedPnL) * 100) / 100,
      },
    });
  } catch (error) {
    console.error("Multi backtest error:", error);
    res.status(500).json({ error: error.message || "Multi backtest failed" });
  }
});

// ─── API Endpoint: List active sessions (debug) ───────────────────
router.get("/sessions", (_req, res) => {
  const sessions = getAllSessions();
  res.json({
    activeSessions: sessions.length,
    sessions: sessions.map(s => ({
      userId: s.userId,
      sessionId: s.sessionId,
      createdAt: s.createdAt,
    })),
  });
});

// ─── API Endpoint: Test FYERS data availability ───────────────────
router.post("/test-range", async (req, res) => {
  const { symbol = "NSE:NIFTYBANK-INDEX", resolution = "5", daysBack = 30 } = req.body;

  let sessionId = req.headers["x-session-id"];
  let session = sessionId ? getSession(sessionId) : null;
  if (!session) {
    const sessions = getAllSessions();
    if (sessions.length > 0) session = sessions[0];
  }

  if (!session) {
    return res.status(401).json({ 
      error: "No active FYERS session",
      hint: "Login at https://roshanvijay.com first, or use GET /api/backtest/sessions to see active sessions"
    });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const fromTs = now - (daysBack * 86400);
    
    // Use fetchHistoricalData which supports chunking for >100 days
    const rawCandles = await fetchHistoricalData(symbol, resolution, fromTs, now, session.accessToken);
    
    res.json({
      success: true,
      symbol,
      resolution,
      daysBack,
      chunksMade: Math.ceil(daysBack / 100),
      candlesReturned: rawCandles.length,
      firstCandleDate: rawCandles.length > 0 ? new Date(rawCandles[0][0] * 1000).toISOString() : null,
      lastCandleDate: rawCandles.length > 0 ? new Date(rawCandles[rawCandles.length - 1][0] * 1000).toISOString() : null,
      sampleFirst: rawCandles.slice(0, 2),
      sampleLast: rawCandles.slice(-2),
    });
  } catch (error) {
    console.error("Test range error:", error);
    res.status(500).json({ 
      error: error.message || "Test failed",
      symbol,
      resolution,
      daysBack,
    });
  }
});

// ─── API Endpoint: Get available symbols ──────────────────────────
router.get("/symbols", (_req, res) => {
  res.json({
    indices: [
      { symbol: "NSE:NIFTYBANK-INDEX", name: "Bank Nifty" },
      { symbol: "NSE:NIFTY50-INDEX", name: "Nifty 50" },
      { symbol: "NSE:FINNIFTY-INDEX", name: "Fin Nifty" },
      { symbol: "BSE:SENSEX", name: "Sensex" },
    ],
    timeframes: [
      { value: "1", label: "1 Minute" },
      { value: "5", label: "5 Minutes" },
      { value: "15", label: "15 Minutes" },
      { value: "30", label: "30 Minutes" },
      { value: "60", label: "1 Hour" },
      { value: "D", label: "Daily" },
    ],
    strategies: [
      { value: "EMA5", label: "5 EMA (Subhasish Pani)" },
      { value: "EMA5_OPTION", label: "5 EMA Option Buying" },
      { value: "EMA5T", label: "5 EMA Trend (EMA5T, live/paper strategy)" },
    ],
  });
});

// ─── API Endpoint: Get NSE Market Holidays ──────────────────────
router.get("/holidays", async (_req, res) => {
  try {
    const holidays = getHolidays();
    res.json({
      success: true,
      ...holidays,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── API Endpoint: Refresh NSE Market Holidays ──────────────────
router.post("/holidays/refresh", async (_req, res) => {
  try {
    const result = await refreshHolidays();
    res.json({
      success: true,
      message: "Holidays refreshed",
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
