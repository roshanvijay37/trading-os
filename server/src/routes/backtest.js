import express from "express";
import { getSession, getAllSessions } from "./auth.js";
import { getHolidays, refreshHolidays } from "../utils/marketHolidays.js";
import {
  bsPrice,
  roundToStrike,
  yearsToExpiry,
  getOptionDefaults,
  computeOptionCosts,
} from "../services/blackScholes.js";
// Shared 5-EMA + alert rule — same definition the live engine uses (single source of truth).
import { calculateEMA, detectAlert } from "../services/signalCore.js";

const router = express.Router();

const appId = process.env.FYERS_APP_ID;
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

// In-memory cache for historical data
const dataCache = new Map();

// ─── EMA Calculation ──────────────────────────────────────────────
// calculateEMA now lives in ../services/signalCore.js so the backtest and live engine
// share one definition (imported above).

// ─── Fetch Historical Data from FYERS ─────────────────────────────
// FYERS limits: max 100 days for intraday resolutions (1,2,3,5,10,15,20,30,45,60,120,180,240)
const INTRADAY_RESOLUTIONS = ["1", "2", "3", "5", "10", "15", "20", "30", "45", "60", "120", "180", "240"];
const MAX_DAYS_PER_REQUEST = 100;
const DAY_IN_SECONDS = 86400;

async function fetchHistoricalData(symbol, resolution, fromTs, toTs, accessToken) {
  const cacheKey = `${symbol}_${resolution}_${fromTs}_${toTs}`;
  if (dataCache.has(cacheKey)) return dataCache.get(cacheKey);

  const isIntraday = INTRADAY_RESOLUTIONS.includes(resolution);
  const totalDays = (toTs - fromTs) / DAY_IN_SECONDS;

  // If intraday and more than 100 days, chunk the requests
  if (isIntraday && totalDays > MAX_DAYS_PER_REQUEST) {
    console.log(`FYERS limit: ${resolution}m max ${MAX_DAYS_PER_REQUEST} days. Chunking ${totalDays} days...`);
    let allCandles = [];
    let currentFrom = fromTs;

    while (currentFrom < toTs) {
      let currentTo = currentFrom + (MAX_DAYS_PER_REQUEST * DAY_IN_SECONDS);
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

    dataCache.set(cacheKey, unique);
    return unique;
  }

  // Single request for daily or < 100 days
  return fetchSingleRange(symbol, resolution, fromTs, toTs, accessToken);
}

async function fetchSingleRange(symbol, resolution, fromTs, toTs, accessToken) {
  const cacheKey = `${symbol}_${resolution}_${fromTs}_${toTs}`;
  if (dataCache.has(cacheKey)) return dataCache.get(cacheKey);

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
  dataCache.set(cacheKey, candles);
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
    expiryWeekday,     // 0=Sun..6=Sat IST; default 4 (Thu)
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
  } = config;

  const isBS = pricingModel === "BLACK_SCHOLES";
  const symDefaults = getOptionDefaults(symbol);
  const bs = {
    iv: Number(annualizedIV) > 0 ? Number(annualizedIV) : symDefaults.iv,
    strikeInterval: Number(strikeInterval) > 0 ? Number(strikeInterval) : symDefaults.strikeInterval,
    lotSize: Number(lotSize) > 0 ? Number(lotSize) : symDefaults.lotSize,
    riskFreeRate: Number(riskFreeRate) > 0 ? Number(riskFreeRate) : 0.065,
    expiryWeekday: Number.isInteger(expiryWeekday) ? expiryWeekday : 4,
    halfSpread: (Number(optionSpreadPct) >= 0 ? Number(optionSpreadPct) : 1.0) / 100 / 2,
  };
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
  // EMA5T's no-lookahead trend gate: a 20-EMA on the SAME timeframe, read AT the alert bar
  // (never beyond it) — identical to emaStrategy.js's detectAlertCandle (live parity).
  const trendEmaValues = calculateEMA(closes, 20);
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
    const stopDistance = Math.abs(rawEntry - sl);
    if (stopDistance <= 0) return null;
    const targetDistance = stopDistance * targetMultiplier;
    const indexTarget = side === "LONG" ? rawEntry + targetDistance : rawEntry - targetDistance;

    if (isBS) {
      const optionType = side === "LONG" ? "CE" : "PE";
      const strike = roundToStrike(rawEntry, bs.strikeInterval);
      const t = yearsToExpiry(candle.timestamp, bs.expiryWeekday);
      const iv = candleIv[i];
      const entryMid = bsPrice({ type: optionType, spot: rawEntry, strike, t, r: bs.riskFreeRate, sigma: iv });
      if (!(entryMid > 0)) return null;
      const entryPremium = round2(entryMid * (1 + bs.halfSpread)); // pay the ask
      // Option-premium risk per unit ≈ premium drop if the index reaches the SL level.
      const slMid = bsPrice({ type: optionType, spot: sl, strike, t, r: bs.riskFreeRate, sigma: iv });
      const slPremium = Math.max(0, slMid * (1 - bs.halfSpread));
      const optionRiskPerUnit = Math.max(0.05, entryPremium - slPremium);
      let qty = Math.floor(riskAmount / optionRiskPerUnit / bs.lotSize) * bs.lotSize;
      // Never deploy more premium than available capital.
      // C3/margin-parity: cap deployed premium by capital × the live margin-safety multiplier.
      const marginMult = applyLiveFilters ? (Number(marginSafetyMultiplier) > 0 ? marginSafetyMultiplier : 1) : 1;
      const maxByCapital = Math.floor(currentCapital / (entryPremium * marginMult) / bs.lotSize) * bs.lotSize;
      qty = Math.min(qty, maxByCapital);
      if (qty <= 0) return null;
      return {
        mode: "BS", side, optionType, strike,
        entryPrice: entryPremium, entryPremium,
        indexEntry: round2(rawEntry),
        qty,
        sl: round2(sl),
        target: round2(indexTarget),
        entryBar: i,
        entryTime: candle.datetime,
      };
    }

    // INDEX mode — original arithmetic preserved (slippage on entry, qty by index points).
    const entryPrice = side === "LONG"
      ? round2(rawEntry * (1 + slippage))
      : round2(rawEntry * (1 - slippage));
    const idxStop = side === "LONG" ? entryPrice - sl : sl - entryPrice;
    if (idxStop <= 0) return null;
    const qty = Math.floor(riskAmount / idxStop);
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
    };
  }

  // Price the option leg at exit and return { entryRec, exitRec, pnl } for a BS position.
  function settleBSExit(pos, exitSpot, candle, iv) {
    const tExit = yearsToExpiry(candle.timestamp, bs.expiryWeekday);
    const exitMid = bsPrice({ type: pos.optionType, spot: exitSpot, strike: pos.strike, t: tExit, r: bs.riskFreeRate, sigma: iv });
    const exitPremium = Math.max(0, round2(exitMid * (1 - bs.halfSpread))); // hit the bid
    const gross = (exitPremium - pos.entryPremium) * pos.qty;
    const costs = computeOptionCosts(pos.entryPremium, exitPremium, pos.qty, { brokeragePerOrder });
    return { entryRec: pos.entryPremium, exitRec: exitPremium, pnl: gross - costs };
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
    const side = wantLong ? "LONG" : "SHORT";
    const pos = buildPosition(side, wantLong ? ac.high : ac.low, wantLong ? ac.low : ac.high, i, candle);
    if (pos) { position = pos; alertCandle = null; }
  }

  // C3: align warmup with the live bot, which signals as soon as it has enough candles (6 for EMA5;
  // 20 for EMA5_OPTION's trend EMA). The old flat 50-bar warmup made the backtest skip the first ~4h
  // that the live bot trades. Keep 50 only when live filters are off (legacy raw mode).
  const liveWarmup = (strategy === "EMA5_OPTION" || strategy === "EMA5T") ? 20 : Math.max(emaPeriod + 1, 6);
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
      } else if (barsHeld >= maxHoldBars) {
        exitReason = "TIME";
        indexExitLevel = candle.close;
      }

      if (exitReason) {
        let entryRec, exitRec, pnl;

        if (position.mode === "BS") {
          // Same trigger & exit index level; P&L is option-premium based (delta + theta + costs).
          ({ entryRec, exitRec, pnl } = settleBSExit(position, indexExitLevel, candle, candleIv[i]));
        } else {
          // INDEX mode — original open-aware fill + slippage arithmetic preserved.
          let exitPrice;
          if (exitReason === "TIME" || exitReason === "SQUARE_OFF") {
            // SQUARE_OFF (and TIME) exit at the bar close — NOT the target branch. Without this the
            // 15:15 forced exit was mispriced to min(open,target), distorting INDEX-mode parity P&L.
            exitPrice = candle.close;
          } else if (exitReason === "SL") {
            const rawExit = position.side === "LONG" ? Math.max(candle.open, position.sl) : Math.min(candle.open, position.sl);
            exitPrice = Math.round(rawExit * (position.side === "LONG" ? (1 - slippage) : (1 + slippage)) * 100) / 100;
          } else {
            const rawExit = position.side === "LONG" ? Math.min(candle.open, position.target) : Math.max(candle.open, position.target);
            exitPrice = Math.round(rawExit * (position.side === "LONG" ? (1 - slippage) : (1 + slippage)) * 100) / 100;
          }
          pnl = position.side === "LONG"
            ? (exitPrice - position.entryPrice) * position.qty
            : (position.entryPrice - exitPrice) * position.qty;
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
          exitReason,
          barsHeld,
          capitalAfter: Math.round(currentCapital * 100) / 100,
          sl: position.sl,        // index level — same price scale as the candles, for the chart overlay
          target: position.target,
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
    if (position.mode === "BS") {
      ({ entryRec, exitRec, pnl } = settleBSExit(position, lastCandle.close, lastCandle, candleIv[candles.length - 1]));
    } else {
      exitRec = lastCandle.close;
      entryRec = position.entryPrice;
      pnl = position.side === "LONG"
        ? (exitRec - position.entryPrice) * position.qty
        : (position.entryPrice - exitRec) * position.qty;
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
      exitReason: "END_OF_DATA",
      barsHeld: candles.length - position.entryBar,
      capitalAfter: Math.round(currentCapital * 100) / 100,
      sl: position.sl,
      target: position.target,
      ...(position.mode === "BS" ? { optionType: position.optionType, strike: position.strike, indexEntry: position.indexEntry } : {}),
    });
  }

  const totalReturn = ((currentCapital - capital) / capital) * 100;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / losses : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const expectancy = totalTrades > 0 ? (totalPnL / totalTrades) : 0;
  const winPct = totalTrades > 0 ? wins / totalTrades : 0;
  const lossPct = totalTrades > 0 ? losses / totalTrades : 0;
  const avgLossAbs = Math.abs(avgLoss);
  const expectancyRatio = avgLossAbs > 0 ? ((winPct * avgWin) - (lossPct * avgLossAbs)) / avgLossAbs : 0;

  return {
    summary: {
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalPnL: Math.round(totalPnL * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      expectancyRatio: Math.round(expectancyRatio * 100) / 100,
      finalCapital: Math.round(currentCapital * 100) / 100,
      maxConsecutiveLosses,
      pricingModel: isBS ? "BLACK_SCHOLES" : "INDEX",
    },
    // Echo the effective option assumptions so the UI can show exactly what was simulated.
    optionModel: isBS
      ? {
          iv: bs.iv,
          strikeInterval: bs.strikeInterval,
          lotSize: bs.lotSize,
          riskFreeRate: bs.riskFreeRate,
          expiryWeekday: bs.expiryWeekday,
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
    capital = 1000000,
    riskPercent = 1,
    slBuffer = 0.005,
    targetMultiplier = 2,
    maxHoldBars = 12,
    // Pricing-model controls (see runBacktest). pricingModel defaults to INDEX so existing
    // callers are unaffected.
    pricingModel = "INDEX",
    annualizedIV,
    riskFreeRate,
    strikeInterval,
    lotSize,
    expiryWeekday,
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

    const result = runBacktest(candles, {
      symbol,
      strategy,
      emaPeriod,
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
      optionSpreadPct,
      brokeragePerOrder,
      ivSource,
      ivMultiplier,
      ivSeries,
      // C3 live-parity controls. Undefined → runBacktest's defaults (full parity) apply; the UI can
      // pass applyLiveFilters:false for the legacy raw "idea filter" run, or override any threshold.
      applyLiveFilters: req.body.applyLiveFilters,
      maxTimeEntryHour: req.body.maxTimeEntryHour,
      maxTradesPerDay: req.body.maxTradesPerDay,
      maxRiskPerDayPercent: req.body.maxRiskPerDayPercent,
      marginSafetyMultiplier: req.body.marginSafetyMultiplier,
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
    const rawCandles = await fetchSingleRange(tradedSymbol, "D", fromTs, toTs, session.accessToken);
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
