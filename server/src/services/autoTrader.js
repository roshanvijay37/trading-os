/**
 * PRODUCTION-GRADE AUTOMATED TRADING SYSTEM
 *
 * Institutional-quality risk management for real money trading.
 * All decisions are logged. All limits are enforced.
 */

import {
  calculateEMA,
  detectAlertCandle,
  detectBreakout,
  isValidTradingTime,
  isSquareOffTime,
  getATMOption,
  storeSignal,
  getRecentSignals,
} from "./emaStrategy.js";

import {
  placeLimitEntry,
  placeMarketExit,
  placeStopLossOrder,
  waitForFill,
  cancelOrder,
  getOrderDetails,
  isTokenErrorData,
} from "./orderExecution.js";

import { refreshAccessToken } from "../routes/auth.js";

// Real-time tick data (WebSocket) — used as the primary candle/quote source with a
// REST history fallback. These MUST be imported or every data fetch throws ReferenceError
// (silently swallowed by the surrounding try/catch), leaving the engine permanently idle.
import {
  aggregateOHLC,
  getLatestTick,
  connectFyersWebSocket,
  disconnectFyersWebSocket,
  subscribeToSymbols,
  unsubscribeFromSymbols,
  getWsStatus,
} from "./tickService.js";

import { isNseMarketOpen } from "../utils/marketHolidays.js";

import fs from "fs";
import path from "path";

import { computeExecutionStats } from "./executionStats.js";
import { computeHealthSnapshot } from "./healthSnapshot.js";
// Statutory + brokerage cost model, shared with the backtest so live P&L is reported NET (not gross).
import { computeOptionCosts } from "./blackScholes.js";

// ΓöÇΓöÇΓöÇ CONFIGURATION ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const CONFIG = {
  POLL_INTERVAL_MS: 30000,
  UNDERLYINGS: [
    { name: "NIFTY", symbol: "NSE:NIFTY50-INDEX", lotSize: 75, marginPerLot: 150000 },
    { name: "BANKNIFTY", symbol: "NSE:NIFTYBANK-INDEX", lotSize: 30, marginPerLot: 180000 },
  ],
  CAPITAL: 100000,
  // Simulated capital used in PAPER mode instead of the (possibly tiny) real broker balance, so paper
  // trades can size/afford real option lots for validation. Matches the backtest's default capital so
  // paper and backtest are comparable. LIVE mode still uses the real balance.
  PAPER_CAPITAL: 1000000,
  RISK_PERCENT: 0.5,
  MAX_RISK_PER_DAY_PERCENT: 2,
  MAX_CONSECUTIVE_LOSSES: 3,
  MAX_TRADES_PER_DAY: 10,
  TARGET_MULTIPLIER: 2,
  POSITION_SIZING_MODE: "RISK",
  FIXED_LOTS: 1,
  ORDER_TYPE: "LIMIT",
  LIMIT_BUFFER_PCT: 0.3,
  SLIPPAGE_BUFFER_PCT: 0.5,
  // L2 (audited): option BUYING is a debit — it only needs ~1× the premium. 2× was double-charging
  // and, with a small account, blocked every trade at the margin gate. 1.1 keeps a 10% buffer for the
  // limit-buffer overpay + rounding.
  MARGIN_SAFETY_MULTIPLIER: 1.1,
  MAX_VIX: 25,
  MAX_SPREAD_PCT: 2,
  MIN_OI: 100000,
  MAX_TIME_ENTRY_HOUR: 14,
  ORDER_FILL_TIMEOUT_MS: 30000,
  ORDER_POLL_INTERVAL_MS: 1000,
  OPTION_DELTA_ESTIMATE: 0.5,
  ALLOW_CORRELATED_TRADES: false,
  TRAILING_SL_ENABLED: false,
  PAPER_TRADING: false,
  BROKERAGE_PER_ORDER: 20,
  EMERGENCY_STOP: false,
  SELECTED_STRATEGIES: ["EMA5"],
  SELECTED_INSTRUMENTS: ["NIFTY", "BANKNIFTY"],
  // Candle timeframes (in minutes) the strategy scans — each is evaluated INDEPENDENTLY (a 5m
  // and a 15m signal each trade on their own). Subset of ALLOWED_TIMEFRAMES; never empty.
  SELECTED_TIMEFRAMES: [5],
};

// Selectable candle timeframes (minutes); 60 = 1 hour. Drives BOTH the live-tick aggregation
// interval and the REST history resolution, and bounds what updateConfig will accept.
const ALLOWED_TIMEFRAMES = [5, 15, 30, 60];

// How many candles of history to pull (REST fallback) and to keep from the tick buffer. Kept
// generous so the EMA/alert/breakout math is stable on every timeframe — extra candles are
// harmless, the engine only reads the most recent ones.
const HISTORY_CANDLES = 80;

// Defensive read of the configured timeframes: filter to the allowed set, dedupe, and fall back
// to [5] if a corrupt/persisted/empty value ever slips through, so candle fetching can never
// break on a bad interval/resolution.
function getTimeframes() {
  const list = (Array.isArray(CONFIG.SELECTED_TIMEFRAMES) ? CONFIG.SELECTED_TIMEFRAMES : [])
    .map(Number)
    .filter((t) => ALLOWED_TIMEFRAMES.includes(t));
  const deduped = [...new Set(list)];
  return deduped.length ? deduped : [5];
}

function getActiveUnderlyings() {
  return CONFIG.UNDERLYINGS.filter((u) => CONFIG.SELECTED_INSTRUMENTS.includes(u.name));
}

// The UI sends config in camelCase; the engine stores it in SCREAMING_SNAKE_CASE. This maps
// each incoming field to its CONFIG key. Without the translation a blind Object.assign() just
// attached dead camelCase keys to CONFIG that nothing reads, so every saved setting silently
// reverted to the default the /status endpoint reports. The values of this map double as the
// set of user-tunable keys we persist across restarts (CAPITAL/EMERGENCY_STOP are deliberately
// excluded — capital is re-fetched from the broker on start, and a halt shouldn't be config).
const CONFIG_FIELD_MAP = {
  riskPercent: "RISK_PERCENT",
  maxTradesPerDay: "MAX_TRADES_PER_DAY",
  maxRiskPerDay: "MAX_RISK_PER_DAY_PERCENT",
  positionSizingMode: "POSITION_SIZING_MODE",
  fixedLots: "FIXED_LOTS",
  paperTrading: "PAPER_TRADING",
  paperCapital: "PAPER_CAPITAL",
  limitBufferPct: "LIMIT_BUFFER_PCT",
  maxVIX: "MAX_VIX",
  maxSpreadPct: "MAX_SPREAD_PCT",
  minOI: "MIN_OI",
  maxTimeEntryHour: "MAX_TIME_ENTRY_HOUR",
  allowCorrelatedTrades: "ALLOW_CORRELATED_TRADES",
  selectedStrategies: "SELECTED_STRATEGIES",
  selectedInstruments: "SELECTED_INSTRUMENTS",
  selectedTimeframes: "SELECTED_TIMEFRAMES",
};
const PERSISTED_CONFIG_KEYS = Object.values(CONFIG_FIELD_MAP);

// ─── SESSION REFERENCE ────────────────────────────────────────────────
let currentSession = null;

// ─── STATE ────────────────────────────────────────────────────────────
let isRunning = false;
let pollInterval = null;
let activeAlerts = new Map();
let openPositions = [];
let todayTrades = 0;
let lastTradeDate = null;

let latestData = {};
let processedSignals = new Set();
let indiaVIX = 0;
let marketStatus = "CLOSED";
let dailyPnL = 0;
let dailyRealizedPnL = 0;
let consecutiveLosses = 0;
let auditLog = [];

// Gates new entries until local open positions have been verified against the broker on
// startup. Stays false if that reconciliation could not run, so a phantom position can never
// trigger a naked exit and we never trade on an unverified picture of what we hold.
let reconcileOk = false;


// ΓöÇΓöÇΓöÇ PERSISTENCE ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const STATE_FILE = path.join(process.cwd(), "auto-trade-state.json");
const AUDIT_FILE = path.join(process.cwd(), "auto-trade-audit.jsonl");

function saveState() {
  try {
    const config = {};
    for (const key of PERSISTED_CONFIG_KEYS) config[key] = CONFIG[key];
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          openPositions,
          todayTrades,
          lastTradeDate,
          processedSignals: Array.from(processedSignals),
          dailyPnL,
          dailyRealizedPnL,
          consecutiveLosses,
          config,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error("[AUTO-TRADER] Save state failed:", err.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      openPositions = (s.openPositions || []).map((p) => ({
        ...p,
        avgFillPrice: p.avgFillPrice ?? p.entryPrice ?? 0,
        unrealizedPnl: p.unrealizedPnl ?? 0,
        realizedPnl: p.realizedPnl ?? 0,
        exitPrice: p.exitPrice ?? 0,
      }));
      todayTrades = s.todayTrades || 0;
      lastTradeDate = s.lastTradeDate || null;
      processedSignals = new Set(s.processedSignals || []);
      dailyPnL = s.dailyPnL || 0;
      dailyRealizedPnL = s.dailyRealizedPnL || 0;
      consecutiveLosses = s.consecutiveLosses || 0;
      // Restore only the known user-tunable keys so a stale/garbage field in the file can't
      // leak into CONFIG.
      if (s.config) {
        for (const key of PERSISTED_CONFIG_KEYS) {
          if (s.config[key] !== undefined) CONFIG[key] = s.config[key];
        }
        // Migrate the pre-multi-timeframe single field if an older state file is loaded.
        if (s.config.SELECTED_TIMEFRAMES === undefined && s.config.TIMEFRAME_MINUTES !== undefined) {
          CONFIG.SELECTED_TIMEFRAMES = [s.config.TIMEFRAME_MINUTES];
        }
      }
    }
  } catch (err) {
    console.error("[AUTO-TRADER] Load state failed:", err.message);
  }
}

loadState();

// ─── TICK DATA HELPERS ────────────────────────────────────────────────
function getSymbolShortName(symbol) {
  if (symbol.includes("NIFTY50")) return "NIFTY";
  if (symbol.includes("NIFTYBANK")) return "BANKNIFTY";
  return symbol;
}

/**
 * C6: signals must be judged on COMPLETED candles only. Both the tick aggregation and the FYERS
 * history endpoint can return a trailing IN-PROGRESS candle (the current period). If kept, the last
 * bar's OHLC and the EMA shift intra-period, so the alert/breakout can flip within a bar and live
 * diverges from the backtest (which uses closed bars). Drop the trailing candle when its period has
 * not fully elapsed. Row = [timeSec, o, h, l, c, v]; timeSec is the period START (epoch seconds).
 * Pure (nowSec injectable) for unit testing.
 */
export function dropInProgressCandle(candles, timeframeMinutes, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(candles) || candles.length === 0) return candles || [];
  const startSec = Number(candles[candles.length - 1]?.[0]) || 0;
  const periodSec = (Number(timeframeMinutes) || 5) * 60;
  if (startSec > 0 && nowSec < startSec + periodSec) return candles.slice(0, -1);
  return candles;
}

async function fetchCandlesWithTickFallback(symbol, session, timeframeMinutes) {
  const shortName = getSymbolShortName(symbol);
  const tf = `${timeframeMinutes}m`;
  // NOTE: higher timeframes need a long stretch of ticks to form 6 complete candles (e.g. 6x
  // 1h = 6 hours), so the live-tick path will usually be short until the buffer fills and the
  // engine legitimately runs off the REST history below — which returns proper candles for the
  // selected resolution.
  // C6: drop the trailing in-progress bar BEFORE the >=6 gate. Otherwise a buffer of exactly 6 raw
  // candles passed the gate, then lost its in-progress bar to 5 and processCandles skipped the scan
  // (and the websocket branch had already returned, so the REST fallback never ran).
  const tickRows = dropInProgressCandle(
    aggregateOHLC(shortName, tf, HISTORY_CANDLES).map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]),
    timeframeMinutes
  );
  if (tickRows.length >= 6) {
    logAudit({ type: "DATA_SOURCE", source: "websocket", symbol, timeframe: tf, count: tickRows.length });
    return tickRows;
  }
  logAudit({ type: "DATA_SOURCE", source: "history_api", symbol, timeframe: tf, reason: "insufficient_tick_data", tickCount: tickRows.length });
  return dropInProgressCandle(await fetchLatestCandles(symbol, session, timeframeMinutes), timeframeMinutes); // C6
}

async function fetchOptionQuoteWithTickFallback(optionSymbol, session) {
  const tick = getLatestTick(optionSymbol);
  if (tick && tick.ltp > 0) {
    logAudit({ type: "DATA_SOURCE", source: "websocket", symbol: optionSymbol, ltp: tick.ltp });
    return { lp: tick.ltp, bid: tick.ltp, ask: tick.ltp, oi: 0 };
  }
  logAudit({ type: "DATA_SOURCE", source: "quotes_api", symbol: optionSymbol, reason: "no_tick" });
  return fetchOptionQuote(optionSymbol, session);
}

// ─── AUDIT LOGGING ────────────────────────────────────────────────────
const MAX_IN_MEMORY_AUDIT = 5000;
function logAudit(event) {
  const entry = { timestamp: new Date().toISOString(), ...event };
  auditLog.push(entry);
  // Cap the in-memory audit buffer so a long-running session can't grow it without bound
  // (the full history is still appended to the audit file on disk).
  if (auditLog.length > MAX_IN_MEMORY_AUDIT) {
    auditLog.splice(0, auditLog.length - MAX_IN_MEMORY_AUDIT);
  }
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[AUTO-TRADER] Audit write failed:", err.message);
  }
}

// ─── FYERS API ────────────────────────────────────────────────────────
const FYERS_APP_ID = process.env.FYERS_APP_ID;
const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

// Surface a dead/expired token mid-session instead of silently looping errors. Refresh is SEBI-
// disabled, so once the token dies every call fails until a manual reconnect — during which open
// positions are protected ONLY by their resting exchange stop (no target/square-off can fire). Track
// consecutive auth failures and raise a distinct audit event + health flag the operator can watch.
let consecutiveAuthFailures = 0;
function noteAuthFailure() {
  consecutiveAuthFailures++;
  if (consecutiveAuthFailures === 3 || consecutiveAuthFailures % 20 === 0) {
    logAudit({ type: "AUTH_FAILURE_STREAK", count: consecutiveAuthFailures });
    console.error(
      `[AUTO-TRADER] ⚠️ FYERS AUTH FAILING (${consecutiveAuthFailures}×) — token likely expired. New orders/exits will fail; open positions are protected only by the resting exchange stop. Reconnect FYERS.`
    );
  }
}
function noteAuthSuccess() {
  if (consecutiveAuthFailures > 0) {
    logAudit({ type: "AUTH_RECOVERED", after: consecutiveAuthFailures });
    consecutiveAuthFailures = 0;
  }
}

// Account/order API call (api/v3). Reads the token from the session each attempt and refreshes
// once on an auth failure, so a token that dies mid-session doesn't blind the engine.
async function fyersApiCall(endpoint, session, body = null, method = "GET", _retried = false) {
  const appId = session.appId ?? FYERS_APP_ID;
  const response = await fetch(`${FYERS_API_BASE}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `${appId}:${session.accessToken}`,
    },
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 && !_retried && (await refreshAccessToken(session))) {
      return fyersApiCall(endpoint, session, body, method, true);
    }
    if (response.status === 401) noteAuthFailure();
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
  }
  const data = await response.json();
  if (data.s !== "ok") {
    if (!_retried && isTokenErrorData(data) && (await refreshAccessToken(session))) {
      return fyersApiCall(endpoint, session, body, method, true);
    }
    if (isTokenErrorData(data)) noteAuthFailure();
    throw new Error(data.message || "FYERS API error");
  }
  noteAuthSuccess();
  return data;
}

// Data API call (the /data host: quotes, history, option-chain, VIX). Mirrors the auth-refresh
// retry so the data feed survives a mid-session token expiry too.
async function fyersDataFetch(url, session, _retried = false) {
  const appId = session.appId ?? FYERS_APP_ID;
  const response = await fetch(url, {
    headers: { Authorization: `${appId}:${session.accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401 && !_retried && (await refreshAccessToken(session))) {
    return fyersDataFetch(url, session, true);
  }
  const data = await response.json();
  if (data.s !== "ok" && !_retried && isTokenErrorData(data) && (await refreshAccessToken(session))) {
    return fyersDataFetch(url, session, true);
  }
  if (response.status === 401 || isTokenErrorData(data)) noteAuthFailure();
  else if (data.s === "ok") noteAuthSuccess();
  return data;
}

// ─── RISK MANAGEMENT ──────────────────────────────────────────────────
async function fetchAvailableFunds(session) {
  try {
    const data = await fyersApiCall("/funds", session);
    const funds = data.fund_limit || [];
    const available = funds.find((f) => f.title === "Available Balance");
    return available ? available.equityAmount : 0;
  } catch (err) {
    console.error("[AUTO-TRADER] Funds fetch failed:", err.message);
    return 0;
  }
}

async function checkMargin(optionSymbol, qty, underlying, session, entryPremium = 0) {
  try {
    // Buying options costs the premium (premium x qty), not index SPAN margin. Fall back to
    // the conservative index margin only if the premium is unknown.
    const required =
      entryPremium > 0
        ? entryPremium * qty
        : qty * (underlying.marginPerLot / underlying.lotSize);
    // PAPER mode checks affordability against the SIMULATED capital (nothing is actually charged);
    // the real broker balance can be below one lot and would block every paper trade. LIVE mode uses
    // the real available funds.
    const available = CONFIG.PAPER_TRADING ? CONFIG.CAPITAL : await fetchAvailableFunds(session);
    const safeRequired = required * CONFIG.MARGIN_SAFETY_MULTIPLIER;
    logAudit({ type: "MARGIN_CHECK", optionSymbol, qty, required, available, safeRequired, pass: available >= safeRequired });
    return { pass: available >= safeRequired, available, required: safeRequired };
  } catch (err) {
    console.error("[AUTO-TRADER] Margin check error:", err.message);
    return { pass: false, available: 0, required: 0 };
  }
}

function checkDailyLossLimit() {
  const limit = -CONFIG.CAPITAL * (CONFIG.MAX_RISK_PER_DAY_PERCENT / 100);
  const hit = dailyPnL <= limit;
  if (hit) {
    console.log(`[AUTO-TRADER] DAILY LOSS LIMIT HIT: Γé╣${dailyPnL.toFixed(2)} (limit: Γé╣${limit.toFixed(2)})`);
    logAudit({ type: "CIRCUIT_BREAKER", reason: "DAILY_LOSS_LIMIT", dailyPnL, limit });
  }
  return !hit;
}

function checkConsecutiveLosses() {
  const hit = consecutiveLosses >= CONFIG.MAX_CONSECUTIVE_LOSSES;
  if (hit) {
    console.log(`[AUTO-TRADER] CONSECUTIVE LOSS LIMIT: ${consecutiveLosses} losses`);
    logAudit({ type: "CIRCUIT_BREAKER", reason: "CONSECUTIVE_LOSSES", consecutiveLosses });
  }
  return !hit;
}

function roundToLotSize(qty, underlying) {
  // Floor to a whole number of lots. Do NOT force a minimum of one lot — when the
  // risk-based size rounds below a lot the caller's `qty <= 0` guard must be allowed
  // to skip the trade, otherwise the risk model is silently overridden.
  return Math.floor(qty / underlying.lotSize) * underlying.lotSize;
}

// ΓöÇΓöÇΓöÇ MARKET FILTERS ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function fetchIndiaVIX(session) {
  try {
    const url = `${FYERS_DATA_BASE}/quotes?symbols=NSE:INDIAVIX-INDEX`;
    const data = await fyersDataFetch(url, session);
    indiaVIX = data.d?.[0]?.v?.lp || 0;
    return indiaVIX;
  } catch (err) {
    console.error("[AUTO-TRADER] VIX fetch failed:", err.message);
    return 0;
  }
}

function checkVIXFilter() {
  if (indiaVIX > CONFIG.MAX_VIX) {
    console.log(`[AUTO-TRADER] HIGH VIX: ${indiaVIX} (max: ${CONFIG.MAX_VIX})`);
    logAudit({ type: "FILTER_BLOCKED", reason: "HIGH_VIX", vix: indiaVIX });
    return false;
  }
  return true;
}

function checkTimeFilter() {
  const now = new Date();
  const istOffset = 330;
  const istMinutes = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + istOffset) % (24 * 60);
  const hours = Math.floor(istMinutes / 60);
  if (hours >= CONFIG.MAX_TIME_ENTRY_HOUR) {
    console.log(`[AUTO-TRADER] After ${CONFIG.MAX_TIME_ENTRY_HOUR}:00 IST ΓÇö no new entries`);
    return false;
  }
  return true;
}

function checkCorrelationFilter(underlyingName) {
  if (CONFIG.ALLOW_CORRELATED_TRADES) return true;
  const hasOpenTrade = openPositions.some((p) => p.status === "OPEN" && p.underlying !== underlyingName);
  if (hasOpenTrade) {
    console.log(`[AUTO-TRADER] Correlation filter: already in trade on other underlying`);
    return false;
  }
  return true;
}

async function checkLiquidity(optionSymbol, session, oi = 0) {
  try {
    const quote = await fetchOptionQuote(optionSymbol, session);
    if (!quote) return { pass: false, reason: "NO_QUOTE" };
    // OI is passed in from the option CHAIN. The /data/quotes endpoint this function reads for
    // bid/ask/spread does NOT return an `oi` field, so sourcing OI from the quote was always 0
    // and the LOW_OI check below blocked 100% of trades. Fall back to quote.oi only if present.
    if (!oi) oi = quote.oi || 0;
    if (!quote.bid || !quote.ask || quote.lp <= 0) {
      return { pass: false, reason: "INVALID_QUOTE", quote };
    }
    const spread = ((quote.ask - quote.bid) / quote.lp) * 100;
    if (oi < CONFIG.MIN_OI) {
      logAudit({ type: "FILTER_BLOCKED", reason: "LOW_OI", optionSymbol, oi, minOI: CONFIG.MIN_OI });
      return { pass: false, reason: "LOW_OI", quote };
    }
    if (spread > CONFIG.MAX_SPREAD_PCT) {
      logAudit({ type: "FILTER_BLOCKED", reason: "HIGH_SPREAD", optionSymbol, spread });
      return { pass: false, reason: "HIGH_SPREAD", quote };
    }
    return { pass: true, oi, spread, quote };
  } catch (err) {
    return { pass: false, reason: "ERROR", error: err.message };
  }
}

async function fetchOptionQuote(optionSymbol, session) {
  try {
    const url = `${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent(optionSymbol)}`;
    const data = await fyersDataFetch(url, session);
    return data.d?.[0]?.v || null;
  } catch (err) {
    console.error(`[AUTO-TRADER] Quote fetch failed for ${optionSymbol}:`, err.message);
    return null;
  }
}

// ─── OPTION PRICE DERIVATION ──────────────────────────────────────────
// NSE option premiums move in ₹0.05 ticks; FYERS rejects an order whose price is not a multiple of
// the tick — and a rejected stop-loss leaves a naked position. Snap every computed order price onto
// the tick grid. dir: "up" for a marketable BUY limit (stays >= ask), "down" for a protective stop we
// never want looser, "near" for everything else. The 1e-9 epsilon stops FP dust from bumping an
// already-on-grid price to the next tick.
export const OPTION_TICK = 0.05;
export function roundToTick(price, dir = "near") {
  const p = Number(price) || 0;
  if (p <= 0) return 0;
  const steps = p / OPTION_TICK;
  const n = dir === "up" ? Math.ceil(steps - 1e-9) : dir === "down" ? Math.floor(steps + 1e-9) : Math.round(steps);
  return Math.round(n * OPTION_TICK * 100) / 100;
}

function computeEntryLimitPrice(quote) {
  const base = quote.ask || quote.lp || 0;
  if (base <= 0) return 0;
  // Round the buffered price UP to the tick grid so the limit stays marketable AND is a valid tick.
  return roundToTick(base * (1 + CONFIG.LIMIT_BUFFER_PCT / 100), "up");
}

function computeOptionSLAndTarget(avgFillPrice, signal) {
  // C5 (residual, audited): this uses a fixed delta (OPTION_DELTA_ESTIMATE=0.5) to convert the
  // underlying-point stop/target into OPTION-PREMIUM levels, and the live SL/target then trigger on
  // the option PREMIUM. The backtest instead triggers on the INDEX level and prices the option via
  // Black-Scholes. Backtest filters/warmup/costs/square-off are now aligned (C3), but this premium-vs-
  // index trigger model is a deeper divergence; aligning it changes live position sizing/stops, so it
  // is deferred to a separately paper-validated change rather than rushed here. Tracked in the audit.
  // An option premium moves ~delta rupees per 1 rupee move in the underlying. Convert the
  // strategy's underlying-point risk/target into option-premium points and apply them as
  // absolute rupee distances from the fill price. (The previous version multiplied a
  // fraction-of-index by delta and applied it as a fraction-of-premium, which put the stop
  // a fraction of a percent from entry — stopped out instantly on normal noise.)
  const delta = CONFIG.OPTION_DELTA_ESTIMATE;
  const underlyingRiskPts = Math.abs(signal.entryPrice - signal.stopLoss);
  const underlyingTargetPts = Math.abs(signal.target - signal.entryPrice);
  const optionRiskPts = underlyingRiskPts * delta;
  const optionTargetPts = underlyingTargetPts * delta;
  const optionSL = Math.max(0.05, avgFillPrice - optionRiskPts);
  const optionTarget = avgFillPrice + optionTargetPts;
  return {
    // Snap to the ₹0.05 tick grid or FYERS rejects the SL/target order. SL rounds DOWN (valid and
    // never tighter than intended, floored at the ₹0.05 minimum), target rounds to nearest.
    optionSL: Math.max(0.05, roundToTick(optionSL, "down")),
    optionTarget: roundToTick(optionTarget, "near"),
  };
}

// ─── ORDER EXECUTION ──────────────────────────────────────────────────
/**
 * C-LIVE-1: after the entry fill poll, make sure NO working entry order is left resting at the
 * broker, and return the TRUE final fill. On a TIMEOUT/PARTIAL the DAY limit may still be live —
 * cancel it, then re-read the order so a fill that landed between the last poll and the cancel is
 * never abandoned (which would leave an untracked, unprotected position). Terminal states pass
 * through unchanged.
 */
async function reconcileEntryOrder(orderId, fill, session) {
  if (fill.status === "FILLED" || ["REJECTED", "CANCELLED", "EXPIRED"].includes(fill.status)) {
    return fill;
  }
  try {
    await cancelOrder(orderId, session, logAudit);
  } catch (err) {
    console.error(`[AUTO-TRADER] Entry cancel failed for ${orderId} (will re-read status):`, err.message);
  }
  try {
    const finalState = await getOrderDetails(orderId, session);
    return {
      ...fill,
      status: finalState.status,
      filledQty: finalState.filledQty,
      pendingQty: finalState.pendingQty,
      avgFillPrice: finalState.avgFillPrice || fill.avgFillPrice,
    };
  } catch (err) {
    console.error(`[AUTO-TRADER] Entry re-read failed for ${orderId}:`, err.message);
    return fill;
  }
}

async function openPosition(tradeSignal, optionSymbol, qty, session, entryQuote) {
  const entryLimitPrice = computeEntryLimitPrice(entryQuote);
  if (entryLimitPrice <= 0) {
    throw new Error("Could not compute valid entry limit price");
  }

  // Subscribe to live ticks for this option so monitorPositions() can read getLatestTick()
  // for the traded instrument instead of always falling back to REST quotes. (Safe to call
  // before the socket is open — the tick service queues it into subscribedSymbols and
  // (re)subscribes on connect.)
  try {
    subscribeToSymbols([optionSymbol]);
  } catch (err) {
    console.error(`[AUTO-TRADER] Could not subscribe ticks for ${optionSymbol}:`, err.message);
  }

  const entryOrder = await placeLimitEntry({
    symbol: optionSymbol,
    qty,
    limitPrice: entryLimitPrice,
    session,
    paperTrading: CONFIG.PAPER_TRADING,
    auditLogger: logAudit,
  });

  let fill = await waitForFill(entryOrder.orderId, session, {
    timeoutMs: CONFIG.ORDER_FILL_TIMEOUT_MS,
    pollMs: CONFIG.ORDER_POLL_INTERVAL_MS,
    paperTrading: CONFIG.PAPER_TRADING,
    paperFillPrice: entryLimitPrice,
    auditLogger: logAudit,
  });

  // C-LIVE-1: never abandon a working entry order. On any non-FILLED result cancel the resting
  // remainder and re-read the true fill, so a TIMEOUT (0 filled, order still live) or a partial can't
  // fill later as an untracked, unprotected position. After this, filledQty is the real held qty and
  // any remainder has been cancelled — so we gate purely on filledQty, not the raw status.
  if (!CONFIG.PAPER_TRADING) {
    fill = await reconcileEntryOrder(entryOrder.orderId, fill, session);
  }

  const filledQty = CONFIG.PAPER_TRADING ? qty : Number(fill.filledQty) || 0;
  if (filledQty <= 0) {
    logAudit({ type: "ENTRY_FAILED", orderId: entryOrder.orderId, status: fill.status, symbol: optionSymbol });
    return null;
  }

  const avgFillPrice = fill.avgFillPrice || entryLimitPrice;
  const { optionSL, optionTarget } = computeOptionSLAndTarget(avgFillPrice, tradeSignal);

  // C-LIVE-2: record the position BEFORE placing the stop-loss so a filled entry is ALWAYS tracked,
  // even if SL placement throws. An untracked filled position is invisible to reconciliation and
  // would sit naked; a tracked one is caught by the monitor backstop and the SL re-arm below.
  const position = {
    id: entryOrder.orderId,
    entryOrderId: entryOrder.orderId,
    slOrderId: null,
    optionSymbol,
    quantity: filledQty, // currently-held qty (reduced as legs exit)
    entryQty: filledQty, // qty going into the current close (synced to quantity across legs)
    origEntryQty: filledQty, // IMMUTABLE original — used to charge round-trip costs exactly once
    avgFillPrice,
    entryPrice: tradeSignal.entryPrice,
    stopLoss: optionSL,
    target: optionTarget,
    currentSL: optionSL,
    unrealizedPnl: 0,
    realizedPnl: 0,
    pnl: 0,
    status: "OPEN",
    entryTime: new Date().toISOString(),
    signal: tradeSignal,
    underlying: tradeSignal.underlying,
  };

  openPositions.push(position);
  todayTrades++;
  recalcDailyPnL();
  saveState();

  logAudit({
    type: "POSITION_OPENED",
    strategy: tradeSignal.strategy,
    orderId: entryOrder.orderId,
    optionSymbol,
    qty: filledQty,
    avgFillPrice,
    entryLimitPrice,
    optionSL,
    optionTarget,
    underlying: tradeSignal.underlying,
  });

  console.log(
    `[AUTO-TRADER] POSITION [${tradeSignal.strategy}]: ${optionSymbol} Qty:${filledQty} AvgFill:₹${avgFillPrice.toFixed(2)} SL:₹${optionSL.toFixed(2)} T:₹${optionTarget.toFixed(2)}`
  );

  // Attach the protective broker stop-loss. If it can't be placed, flatten immediately rather than
  // hold a naked long; if the flatten also fails, the position stays TRACKED and monitorPositions
  // re-arms the SL / retries the exit every cycle.
  if (!CONFIG.PAPER_TRADING) {
    try {
      const slOrder = await placeStopLossOrder({
        symbol: optionSymbol,
        qty: filledQty,
        stopPrice: optionSL,
        session,
        paperTrading: false,
        auditLogger: logAudit,
      });
      position.slOrderId = slOrder.orderId;
      logAudit({ type: "SL_PLACED", optionSymbol, slOrderId: position.slOrderId, stopPrice: optionSL });
      saveState();
    } catch (err) {
      console.error(`[AUTO-TRADER] SL placement FAILED for ${optionSymbol} — flattening to avoid a naked position:`, err.message);
      logAudit({ type: "SL_PLACEMENT_FAILED", optionSymbol, error: err.message });
      try {
        await closePosition(position, session, "SL_PLACEMENT_FAILED");
      } catch (flatErr) {
        console.error(`[AUTO-TRADER] Flatten after SL failure ALSO failed for ${optionSymbol} — monitor will re-arm/retry:`, flatErr.message);
        logAudit({ type: "FLATTEN_FAILED", optionSymbol, error: flatErr.message });
      }
      return null;
    }
  }

  return position;
}

// ─── POSITION MANAGEMENT ──────────────────────────────────────────────
/**
 * Pure decision (C2): classify an exit fill so a partial/unfilled market exit never marks the
 * position CLOSED and orphans the unsold remainder at the broker. Side-effect-free for unit tests.
 *   paper            → always "full" (paper fills the whole qty)
 *   fillQty >= entry → "full"     (exit completely)
 *   0 < fillQty < e  → "partial"  (keep open with `remainder`, re-arm SL, retry)
 *   fillQty <= 0     → "unfilled" (keep open with full `remainder`, re-arm SL, retry)
 * @returns {{action:"full"|"partial"|"unfilled", exitQty:number, remainder:number}}
 */
export function classifyExit({ paper, entryQty, fillQty }) {
  const e = Number(entryQty) || 0;
  if (paper) return { action: "full", exitQty: e, remainder: 0 };
  const filled = Math.max(0, Number(fillQty) || 0);
  if (filled <= 0) return { action: "unfilled", exitQty: 0, remainder: e };
  if (filled < e) return { action: "partial", exitQty: filled, remainder: e - filled };
  return { action: "full", exitQty: e, remainder: 0 };
}

/**
 * Pure decision (C1): given the broker SL order's status + already-filled qty and what we currently
 * hold, decide how to settle so we NEVER market-exit more than is actually held (oversell → naked
 * short). Side-effect-free for unit tests.
 *   fullSlClose=true → the SL already closed the whole position; settle on it, place NO market order.
 *   slLegQty         → qty the SL already sold that must be realized as a leg before our exit.
 *   marketExitQty    → qty to send as the market exit (held minus what the SL took).
 * A partial broker fill reports status PENDING (FYERS has no PARTIAL code) with filledQty>0, so this
 * keys off filledQty, not just status. Unknown status + no fill → market-exit the whole held qty.
 */
export function planSlSettlement({ status, slFilled, heldQty }) {
  const held = Math.max(0, Number(heldQty) || 0);
  const filled = Math.min(Math.max(0, Number(slFilled) || 0), held);
  if (status === "FILLED" || (held > 0 && filled >= held)) return { fullSlClose: true, slLegQty: held, marketExitQty: 0 };
  return { fullSlClose: false, slLegQty: filled, marketExitQty: held - filled };
}

/**
 * Single place that records a FULLY-closed position: realized PnL (accumulating any prior partial
 * fill), daily totals, the consecutive-loss counter (on the whole-trade outcome), audit, log, and
 * tick unsubscribe. Used by closePosition, the broker-SL-already-filled path, and
 * reconcileStopLossOrders so the CLOSED bookkeeping can never diverge between them.
 */
function finalizeClose(position, { exitPrice, exitQty, reason, exitOrderId }) {
  position.status = "CLOSED";
  position.exitTime = new Date().toISOString();
  position.exitReason = reason;
  position.exitOrderId = exitOrderId;
  position.exitPrice = exitPrice;
  position.quantity = exitQty;

  // C4: report NET P&L — deduct brokerage + statutory costs (same model the backtest uses) so the
  // dashboard/audit isn't optimistic. Paper mode has no real costs. The round-trip cost is charged
  // ONCE for the whole position (on the original entry qty), so a multi-leg exit — where earlier
  // legs were realized GROSS via settleLeg — never double-counts brokerage / buy-side charges.
  const gross = (exitPrice - position.avgFillPrice) * exitQty;
  const costQty = position.origEntryQty || exitQty;
  const costs = CONFIG.PAPER_TRADING ? 0 : computeOptionCosts(position.avgFillPrice, exitPrice, costQty, { brokeragePerOrder: CONFIG.BROKERAGE_PER_ORDER });
  const pnl = gross - costs;
  position.realizedPnl = (position.realizedPnl || 0) + pnl; // accumulate across any partial exits
  position.pnl = position.realizedPnl;
  dailyRealizedPnL += pnl;
  consecutiveLosses = position.realizedPnl < 0 ? consecutiveLosses + 1 : 0;

  recalcDailyPnL();
  saveState();

  logAudit({
    type: "POSITION_CLOSED",
    orderId: position.id,
    exitOrderId,
    optionSymbol: position.optionSymbol,
    reason,
    avgFillPrice: position.avgFillPrice,
    exitPrice,
    qty: exitQty,
    gross,
    costs,
    pnl: position.realizedPnl,
  });
  console.log(`[AUTO-TRADER] CLOSED: ${position.optionSymbol} | NET P&L: ₹${position.realizedPnl.toFixed(2)} (gross ₹${gross.toFixed(2)} − costs ₹${costs.toFixed(2)}) | ${reason}`);

  // Stop streaming this option's ticks and reclaim its tick buffer (index symbols are protected
  // from removal inside unsubscribeFromSymbols).
  try {
    unsubscribeFromSymbols([position.optionSymbol]);
  } catch (err) {
    console.error(`[AUTO-TRADER] Could not unsubscribe ticks for ${position.optionSymbol}:`, err.message);
  }
  return position.realizedPnl;
}

/**
 * Realize a partially-exited LEG at GROSS P&L and reduce the held quantity. Costs are charged once
 * for the whole position in finalizeClose (on origEntryQty), so multi-leg exits never double-count
 * brokerage / buy-side charges. Recomputes unrealizedPnl on the reduced quantity so the daily-loss
 * breaker is never evaluated on a stale full-quantity figure. Returns the remaining held qty.
 */
function settleLeg(position, exitPrice, qty, source) {
  const q = Math.min(Math.max(0, Number(qty) || 0), position.quantity || 0);
  if (q <= 0) return position.quantity || 0;
  const gross = (exitPrice - position.avgFillPrice) * q;
  position.realizedPnl = (position.realizedPnl || 0) + gross;
  position.pnl = position.realizedPnl;
  dailyRealizedPnL += gross;
  position.quantity = (position.quantity || 0) - q;
  position.entryQty = position.quantity;
  position.unrealizedPnl = position.currentLTP ? (position.currentLTP - position.avgFillPrice) * position.quantity : 0;
  logAudit({ type: "PARTIAL_EXIT", optionSymbol: position.optionSymbol, source, exitPrice, qty: q, remainder: position.quantity, gross });
  console.error(`[AUTO-TRADER] PARTIAL EXIT ${position.optionSymbol} [${source}]: ${q} @ ₹${Number(exitPrice).toFixed(2)} — ${position.quantity} still held`);
  return position.quantity;
}

async function closePosition(position, session, reason) {
  if (position.status !== "OPEN") return;

  let heldQty = position.entryQty ?? position.quantity;

  // ─── C1: never double-exit into a naked short. Account for what the broker SL has ALREADY sold ──
  if (position.slOrderId && !CONFIG.PAPER_TRADING) {
    let slDetails = null;
    try {
      slDetails = await getOrderDetails(position.slOrderId, session);
    } catch (err) {
      console.error(`[AUTO-TRADER] Pre-exit SL status check failed for ${position.optionSymbol}:`, err.message);
    }
    const slPrice = slDetails?.avgFillPrice || position.currentSL || position.stopLoss;
    const sl = planSlSettlement({ status: slDetails?.status, slFilled: slDetails?.filledQty, heldQty });
    if (slDetails && sl.fullSlClose) {
      // Broker SL already closed the WHOLE position — settle on it, place NO market order.
      console.log(`[AUTO-TRADER] Broker SL already closed ${position.optionSymbol}; settling without a second exit`);
      finalizeClose(position, { exitPrice: slPrice, exitQty: heldQty, reason: "STOPLOSS", exitOrderId: position.slOrderId });
      return;
    }
    if (slDetails && sl.slLegQty > 0) {
      // PARTIAL broker-SL fill: that qty is already sold. Realize it and SHRINK what we still hold so
      // the market exit below can never oversell the position into a naked short / rejected order.
      console.error(`[AUTO-TRADER] Broker SL partial-filled ${sl.slLegQty}/${heldQty} on ${position.optionSymbol}; exiting only the remainder`);
      heldQty = settleLeg(position, slPrice, sl.slLegQty, "BROKER_SL_PARTIAL");
    }
  }

  // Cancel any still-live broker SL before placing our own exit (a filled/gone order just no-ops).
  if (position.slOrderId) {
    try {
      await cancelOrder(position.slOrderId, session, logAudit);
    } catch (err) {
      console.error(`[AUTO-TRADER] Could not cancel SL order ${position.slOrderId}:`, err.message);
    }
  }

  if (heldQty <= 0) {
    // Nothing left to exit (the broker SL filled it all) — finalize without a second order.
    finalizeClose(position, { exitPrice: position.currentLTP || position.avgFillPrice, exitQty: 0, reason, exitOrderId: position.id });
    return;
  }

  const currentLTP = position.currentLTP || position.avgFillPrice;
  const paperFillPrice = reason === "TARGET" ? position.target : currentLTP;

  const exitOrder = await placeMarketExit({
    symbol: position.optionSymbol,
    qty: heldQty,
    session,
    paperTrading: CONFIG.PAPER_TRADING,
    paperFillPrice,
    auditLogger: logAudit,
  });

  const fill = await waitForFill(exitOrder.orderId, session, {
    timeoutMs: CONFIG.ORDER_FILL_TIMEOUT_MS,
    pollMs: CONFIG.ORDER_POLL_INTERVAL_MS,
    paperTrading: CONFIG.PAPER_TRADING,
    paperFillPrice,
    auditLogger: logAudit,
  });

  const exitPrice = fill.avgFillPrice || paperFillPrice;
  const plan = classifyExit({ paper: CONFIG.PAPER_TRADING, entryQty: heldQty, fillQty: fill.filledQty });

  // ─── C2: a partial / unfilled exit must NOT mark the position CLOSED and orphan the remainder ──
  // Realize any filled portion, keep the position OPEN with the leftover qty, re-arm a broker SL on
  // it, and let the next monitor cycle retry the exit.
  if (plan.action === "partial" || plan.action === "unfilled") {
    if (plan.action === "partial") {
      settleLeg(position, exitPrice, plan.exitQty, `MARKET_PARTIAL:${reason}`);
    } else {
      logAudit({ type: "EXIT_UNFILLED", optionSymbol: position.optionSymbol, reason, exitOrderId: exitOrder.orderId, fillStatus: fill.status });
      console.error(`[AUTO-TRADER] EXIT UNFILLED for ${position.optionSymbol} (${fill.status}); ${plan.remainder} still held — re-arming SL, will retry`);
      position.quantity = plan.remainder;
      position.entryQty = plan.remainder;
    }
    position.slOrderId = null; // cancelled/used above; ensureStopLoss places a fresh one on the remainder
    recalcDailyPnL();
    await ensureStopLoss(position, session);
    saveState();
    return;
  }

  finalizeClose(position, { exitPrice, exitQty: plan.exitQty, reason, exitOrderId: exitOrder.orderId });
}

async function reconcileStopLossOrders(session) {
  for (const position of openPositions) {
    if (position.status !== "OPEN" || !position.slOrderId) continue;
    try {
      const details = await getOrderDetails(position.slOrderId, session);
      if (details.status === "FILLED") {
        const exitPrice = details.avgFillPrice || position.stopLoss;
        const exitQty = details.filledQty || position.quantity;
        finalizeClose(position, { exitPrice, exitQty, reason: "STOPLOSS", exitOrderId: position.slOrderId });
        console.log(`[AUTO-TRADER] CLOSED by broker SL: ${position.optionSymbol}`);
      } else if (["REJECTED", "CANCELLED", "EXPIRED"].includes(details.status)) {
        // SL order is gone — protect the position immediately with a market exit.
        console.error(`[AUTO-TRADER] SL order ${position.slOrderId} ${details.status}; flattening ${position.optionSymbol}`);
        await closePosition(position, session, "SL_ORDER_FAILED");
      }
    } catch (err) {
      console.error(`[AUTO-TRADER] SL reconcile error for ${position.optionSymbol}:`, err.message);
    }
  }
}

function recalcDailyPnL() {
  const unrealized = openPositions
    .filter((p) => p.status === "OPEN")
    .reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
  dailyPnL = dailyRealizedPnL + unrealized;
}

// ─── BROKER RECONCILIATION (STARTUP) ──────────────────────────────────
/**
 * Pure decision step for startup reconciliation: given the locally-tracked OPEN positions and
 * the broker's netPositions, decide which we still hold and which went flat while we were
 * down. Kept side-effect-free so it can be unit-tested without hitting the broker.
 *
 * @returns {{ toClose: Array<{position, realized:number}>, toKeep: Array<{position, brokerQty:number}> }}
 */
export function planReconciliation(openLocal, netPositions) {
  const netQtyBySymbol = new Map();
  const npBySymbol = new Map();
  for (const np of netPositions || []) {
    const q = Number(np.netQty ?? np.qty ?? 0) || 0;
    netQtyBySymbol.set(np.symbol, (netQtyBySymbol.get(np.symbol) || 0) + q);
    npBySymbol.set(np.symbol, np);
  }
  const toClose = [];
  const toKeep = [];
  for (const pos of openLocal || []) {
    const brokerQty = netQtyBySymbol.get(pos.optionSymbol);
    // The bot only ever BUYS options, so a live position has a positive net qty. Absent or
    // <= 0 means the broker is flat in this symbol — it was closed (SL/manual/expiry) while
    // we were offline, so reconcile it to CLOSED rather than ever acting on it again.
    if (!brokerQty || brokerQty <= 0) {
      const np = npBySymbol.get(pos.optionSymbol);
      const realized = np ? Number(np.realized_profit ?? np.pl ?? np.realizedPnl ?? 0) || 0 : 0;
      toClose.push({ position: pos, realized });
    } else {
      toKeep.push({ position: pos, brokerQty });
    }
  }
  return { toClose, toKeep };
}

/**
 * Ensure an OPEN position has a live broker stop-loss. Re-arms one if the recorded SL order is
 * missing or no longer pending (cancelled/rejected/expired) — a held position with no broker
 * SL is exactly the unattended risk this whole tier targets.
 */
async function ensureStopLoss(position, session) {
  if (CONFIG.PAPER_TRADING) return;
  let alive = false;
  if (position.slOrderId) {
    try {
      const details = await getOrderDetails(position.slOrderId, session);
      alive = details.status === "PENDING";
    } catch (err) {
      console.error(`[AUTO-TRADER] Reconcile: SL status check failed for ${position.optionSymbol}:`, err.message);
      alive = false;
    }
  }
  if (alive) return;
  const stopPrice = position.currentSL || position.stopLoss;
  try {
    const slOrder = await placeStopLossOrder({
      symbol: position.optionSymbol,
      qty: position.quantity,
      stopPrice,
      session,
      paperTrading: false,
      auditLogger: logAudit,
    });
    position.slOrderId = slOrder.orderId;
    logAudit({ type: "SL_REARMED", optionSymbol: position.optionSymbol, slOrderId: position.slOrderId, stopPrice });
    console.log(`[AUTO-TRADER] Re-armed missing broker SL for ${position.optionSymbol} @ ₹${Number(stopPrice).toFixed(2)}`);
  } catch (err) {
    console.error(`[AUTO-TRADER] Failed to re-arm SL for ${position.optionSymbol}:`, err.message);
    logAudit({ type: "SL_REARM_FAILED", optionSymbol: position.optionSymbol, error: err.message });
  }
}

/**
 * On startup, verify every locally-tracked OPEN position against the broker before the trading
 * loop runs. Positions the broker no longer holds are marked CLOSED (so monitorPositions can
 * never fire a naked SELL on a phantom); positions still held get their tick subscription and
 * broker SL restored. Sets reconcileOk so canTakeTrade can block new entries until this has
 * succeeded — if we can't verify what we hold, we don't trade.
 */
async function reconcilePositionsWithBroker(session) {
  const openLocal = openPositions.filter((p) => p.status === "OPEN");
  // Paper positions don't exist at the broker, so there is nothing to reconcile against —
  // doing so would wrongly close every simulated position. Just restore tick subscriptions.
  if (CONFIG.PAPER_TRADING) {
    for (const p of openLocal) {
      try {
        subscribeToSymbols([p.optionSymbol]);
      } catch {
        /* best-effort */
      }
    }
    reconcileOk = true;
    return;
  }
  if (openLocal.length === 0) {
    reconcileOk = true;
    return;
  }
  let netPositions;
  try {
    const data = await fyersApiCall("/positions", session);
    netPositions = data.netPositions || [];
  } catch (err) {
    // Could not verify — fail safe: leave reconcileOk false so no NEW trades open, and leave
    // existing positions untouched (their broker SL, if any, still protects them).
    reconcileOk = false;
    console.error("[AUTO-TRADER] Reconcile: positions fetch failed — new trades blocked until verified:", err.message);
    logAudit({ type: "RECONCILE_FAILED", error: err.message });
    return;
  }

  const { toClose, toKeep } = planReconciliation(openLocal, netPositions);

  for (const { position, realized } of toClose) {
    position.status = "CLOSED";
    position.exitReason = "RECONCILED";
    position.exitTime = new Date().toISOString();
    position.realizedPnl = realized || position.realizedPnl || 0;
    position.pnl = position.realizedPnl;
    dailyRealizedPnL += position.realizedPnl;
    if (position.realizedPnl < 0) consecutiveLosses++;
    else if (position.realizedPnl > 0) consecutiveLosses = 0;
    if (position.slOrderId) {
      try {
        await cancelOrder(position.slOrderId, session, logAudit);
      } catch (err) {
        console.error(`[AUTO-TRADER] Reconcile: could not cancel orphan SL ${position.slOrderId}:`, err.message);
      }
    }
    try {
      unsubscribeFromSymbols([position.optionSymbol]);
    } catch (err) {
      console.error(`[AUTO-TRADER] Reconcile: unsubscribe failed for ${position.optionSymbol}:`, err.message);
    }
    logAudit({ type: "POSITION_RECONCILED_CLOSED", optionSymbol: position.optionSymbol, realized: position.realizedPnl });
    console.log(`[AUTO-TRADER] Reconciled FLAT at broker → CLOSED: ${position.optionSymbol} (realized ₹${position.realizedPnl.toFixed(2)})`);
  }

  for (const { position, brokerQty } of toKeep) {
    if (brokerQty !== position.quantity) {
      logAudit({ type: "RECONCILE_QTY_MISMATCH", optionSymbol: position.optionSymbol, localQty: position.quantity, brokerQty });
      position.quantity = brokerQty;
    }
    // Re-stream this option's ticks (subscriptions don't survive a restart) and make sure a
    // broker SL is in place.
    try {
      subscribeToSymbols([position.optionSymbol]);
    } catch (err) {
      console.error(`[AUTO-TRADER] Reconcile: resubscribe failed for ${position.optionSymbol}:`, err.message);
    }
    await ensureStopLoss(position, session);
  }

  reconcileOk = true;
  recalcDailyPnL();
  saveState();
  logAudit({ type: "RECONCILE_DONE", closed: toClose.length, kept: toKeep.length });
}

async function monitorPositions(session) {
  if (openPositions.length === 0) return;

  // C1: settle any broker SL that has already FILLED (and re-flatten on a failed SL) BEFORE the
  // local backstop runs. Otherwise the local slHit check below could fire a SECOND market exit on
  // a position the exchange already closed via its resting SL — a naked short. After this, the
  // per-position loop skips anything now CLOSED, and closePosition re-checks the SL as a final guard.
  await reconcileStopLossOrders(session);

  for (const position of openPositions) {
    if (position.status !== "OPEN") continue;
    try {
      // A live position must always have a resting broker stop. If it lost its SL (initial placement
      // failed, or the SL order was cancelled/expired), re-arm before anything else — self-heals the
      // rare naked window from a failed SL placement in openPosition.
      if (!CONFIG.PAPER_TRADING && !position.slOrderId) {
        await ensureStopLoss(position, session);
      }
      const quote = await fetchOptionQuoteWithTickFallback(position.optionSymbol, session);
      const ltp = quote?.lp || 0;
      if (ltp <= 0) continue;

      position.currentLTP = ltp;
      position.unrealizedPnl = (ltp - position.avgFillPrice) * position.quantity;

      // Local backstop. In paper mode this is the only stop. In live mode the broker SL-M order is
      // primary (reconciled above first); this catches a broker SL stuck PENDING through a fast
      // move/gap. closePosition verifies the broker SL isn't already filled before placing an exit.
      const slHit = ltp <= position.currentSL;
      const targetHit = ltp >= position.target;

      if (slHit) {
        await closePosition(position, session, "STOPLOSS");
      } else if (targetHit) {
        await closePosition(position, session, "TARGET");
      } else if (isSquareOffTime()) {
        await closePosition(position, session, "SQUARE_OFF");
      }
    } catch (error) {
      console.error(`[AUTO-TRADER] Monitor error:`, error.message);
    }
  }

  recalcDailyPnL();

  // C7: the daily-loss breaker must also FLATTEN, not just block new entries — an open position can
  // otherwise blow well past the 2% cap. If breached while positions are still open, square them off.
  const stillOpen = openPositions.filter((p) => p.status === "OPEN");
  if (stillOpen.length > 0 && !checkDailyLossLimit()) {
    console.error(`[AUTO-TRADER] DAILY LOSS LIMIT breached — flattening ${stillOpen.length} open position(s)`);
    for (const pos of stillOpen) {
      try {
        await closePosition(pos, session, "DAILY_LOSS_LIMIT");
      } catch (err) {
        console.error(`[AUTO-TRADER] Daily-loss flatten failed for ${pos.optionSymbol}:`, err.message);
      }
    }
  }
}

// ─── MAIN TRADING LOGIC ───────────────────────────────────────────────
function canTakeTrade(underlyingName) {
  if (CONFIG.EMERGENCY_STOP) {
    console.log("[AUTO-TRADER] EMERGENCY STOP ACTIVE");
    return false;
  }
  if (!reconcileOk) {
    console.log("[AUTO-TRADER] Broker reconciliation incomplete — no new entries");
    return false;
  }
  if (!isValidTradingTime()) return false;
  if (!checkDailyLossLimit()) return false;
  if (!checkConsecutiveLosses()) return false;
  if (!checkMaxTrades()) return false;
  if (!checkTimeFilter()) return false;
  if (!checkCorrelationFilter(underlyingName)) return false;
  return true;
}

function checkMaxTrades() {
  const hit = todayTrades >= CONFIG.MAX_TRADES_PER_DAY;
  if (hit) {
    console.log(`[AUTO-TRADER] MAX TRADES REACHED: ${todayTrades}/${CONFIG.MAX_TRADES_PER_DAY}`);
    logAudit({ type: "CIRCUIT_BREAKER", reason: "MAX_TRADES", todayTrades, max: CONFIG.MAX_TRADES_PER_DAY });
  }
  return !hit;
}

function calculatePositionSize(entryPrice, stopLoss, underlying) {
  if (CONFIG.POSITION_SIZING_MODE === "LOTS") {
    return CONFIG.FIXED_LOTS * underlying.lotSize;
  }
  const riskAmount = CONFIG.CAPITAL * (CONFIG.RISK_PERCENT / 100);
  // We trade the OPTION, so size against the option-premium risk per unit, not the raw
  // index points. Option risk per unit ~= underlying point risk x delta (matches the
  // option stop distance in computeOptionSLAndTarget). Using raw index points here made
  // qty ~1/delta too small, so the real rupee risk never matched the configured risk %.
  const optionRiskPerUnit = Math.abs(entryPrice - stopLoss) * CONFIG.OPTION_DELTA_ESTIMATE;
  if (optionRiskPerUnit <= 0) return 0;
  return Math.floor(riskAmount / optionRiskPerUnit);
}

async function processCandles(underlying, session) {
  try {
    // Scan EACH selected timeframe independently — a 5m and a 15m setup on the same underlying
    // are separate signals that each trade on their own. Global risk limits (max trades/day,
    // daily-loss cap, capital, correlation filter) are SHARED across all timeframes.
    for (const tf of getTimeframes()) {
      const candles = await fetchCandlesWithTickFallback(underlying.symbol, session, tf);
      if (candles.length < 6) continue;
      latestData[underlying.name] = {
        candles,
        lastUpdated: new Date().toISOString(),
        ltp: candles[candles.length - 1][4],
        timeframe: tf,
      };
      for (const strategy of CONFIG.SELECTED_STRATEGIES) {
        // Alerts/signals are keyed per (underlying, strategy, timeframe) so each timeframe runs
        // independently and never clobbers another timeframe's pending setup.
        const key = `${underlying.name}:${strategy}:${tf}m`;
        const alert = detectAlertCandle(candles, strategy);
        if (alert) {
          console.log(`[AUTO-TRADER] ${underlying.name} ${alert.type} detected (${tf}m)`);
          activeAlerts.set(key, {
            ...alert,
            underlying: underlying.name,
            symbol: underlying.symbol,
            timeframe: tf,
            detectedAt: new Date().toISOString(),
          });
        }
        const currentAlert = activeAlerts.get(key);
        if (!currentAlert) continue;
        const signal = detectBreakout(candles, currentAlert);
        if (!signal) continue;
        if (!canTakeTrade(underlying.name)) {
          activeAlerts.delete(key);
          continue;
        }
        const signalId = `${key}-${signal.timestamp}-${signal.type}`;
        if (processedSignals.has(signalId)) {
          activeAlerts.delete(key);
          continue;
        }
        processedSignals.add(signalId);
        if (!checkVIXFilter()) {
          activeAlerts.delete(key);
          continue;
        }
        const optionChain = await fetchOptionChain(underlying.symbol, session);
        const optionType = signal.type === "LONG" ? "CE" : "PE";
        const optionSymbol = getATMOption(underlying.name, signal.entryPrice, optionType, optionChain);
        if (!optionSymbol) {
          activeAlerts.delete(key);
          continue;
        }
        // OI must come from the option CHAIN — the /data/quotes endpoint checkLiquidity uses for
        // bid/ask does NOT return an `oi` field, so reading it from the quote was always 0 and
        // LOW_OI blocked every trade. Match the selected symbol back to its chain row.
        const chainRow = optionChain.find((r) => (r.symbol || r.tradingSymbol || r.ts) === optionSymbol);
        const optionOi = Number(chainRow?.oi ?? chainRow?.openInterest ?? 0) || 0;
        const liquidity = await checkLiquidity(optionSymbol, session, optionOi);
        if (!liquidity.pass) {
          console.log(`[AUTO-TRADER] Liquidity check failed: ${liquidity.reason}`);
          activeAlerts.delete(key);
          continue;
        }
        const rawQty = calculatePositionSize(signal.entryPrice, signal.stopLoss, underlying);
        const qty = roundToLotSize(rawQty, underlying);
        if (qty <= 0) {
          activeAlerts.delete(key);
          continue;
        }
        const entryPremium = liquidity.quote?.ask || liquidity.quote?.lp || 0;
        const margin = await checkMargin(optionSymbol, qty, underlying, session, entryPremium);
        if (!margin.pass) {
          console.log(`[AUTO-TRADER] Margin insufficient: need ₹${margin.required.toFixed(2)}, have ₹${margin.available.toFixed(2)}`);
          activeAlerts.delete(key);
          continue;
        }
        const tradeSignal = {
          ...signal,
          strategy,
          timeframe: tf,
          quantity: qty,
          optionSymbol,
          underlying: underlying.name,
          underlyingSymbol: underlying.symbol,
        };
        storeSignal(tradeSignal);
        try {
          const position = await openPosition(tradeSignal, optionSymbol, qty, session, liquidity.quote);
          if (!position) {
            activeAlerts.delete(key);
            continue;
          }
        } catch (orderError) {
          console.error(`[AUTO-TRADER] Order failed:`, orderError.message);
          logAudit({ type: "ORDER_FAILED", error: orderError.message, signal: tradeSignal });
        }
        activeAlerts.delete(key);
      }
    }
  } catch (error) {
    console.error(`[AUTO-TRADER] Error:`, error.message);
  }
}

// ─── DATA FETCHING ────────────────────────────────────────────────────
async function fetchLatestCandles(symbol, session, timeframeMinutes) {
  const tf = timeframeMinutes;
  const now = Math.floor(Date.now() / 1000);
  // Scale the lookback window with the timeframe so every resolution yields enough candles for
  // the EMA/alert/breakout logic. A flat 1h window only gives ~4 fifteen-minute candles (and 1
  // hourly), far short of the >=6 the engine needs; HISTORY_CANDLES worth of continuous time is
  // generous and FYERS returns only the actual market candles within the range.
  const from = now - tf * 60 * HISTORY_CANDLES;
  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=${tf}&date_format=0&range_from=${from}&range_to=${now}&cont_flag=1`;
  const data = await fyersDataFetch(url, session);
  return data.candles || [];
}

async function fetchOptionChain(symbol, session) {
  const url = `${FYERS_DATA_BASE}/options-chain-v3?symbol=${encodeURIComponent(symbol)}&strikecount=5`;
  const data = await fyersDataFetch(url, session);
  return data.data?.optionsChain || [];
}

// ΓöÇΓöÇΓöÇ MARKET STATUS ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
import { getNseMarketStatus } from "../utils/marketHolidays.js";

function getISTTime() {
  const now = new Date();
  const istOffsetMinutes = 330;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + istOffsetMinutes) % (24 * 60);
  return { hours: Math.floor(istMinutes / 60), minutes: istMinutes % 60 };
}

function getCurrentMarketStatus() {
  return getNseMarketStatus();
}

// ΓöÇΓöÇΓöÇ MAIN LOOP ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function tradingLoop(session) {
  if (!isRunning) return;
  // Clear any previously scheduled tick so the loop can never double-arm into two
  // concurrent timer chains (which would double order flow).
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
  // Default cadence; the market-closed branch slows it to 60s. The reschedule lives in `finally` so a
  // throw ANYWHERE below can never stop the loop from re-arming — otherwise one bad quote/order error
  // would silently freeze the bot while it still reports isRunning=true and pm2 sees a live process.
  let rescheduleMs = CONFIG.POLL_INTERVAL_MS;
  try {
    const today = new Date().toDateString();
    if (lastTradeDate !== today) {
      todayTrades = 0;
      lastTradeDate = today;
      dailyPnL = 0;
      dailyRealizedPnL = 0;
      consecutiveLosses = 0;
      activeAlerts.clear();
      openPositions = openPositions.filter((p) => p.status !== "CLOSED");
      processedSignals.clear();
      console.log(`[AUTO-TRADER] New day - all counters reset`);
      saveState();
    }
    await fetchIndiaVIX(session);
    const { hours, minutes } = getISTTime();
    const timeStr = `${hours}:${minutes.toString().padStart(2, "0")}`;
    if (hours === 9 && minutes < 15) {
      marketStatus = "PRE_OPEN";
      console.log(`[AUTO-TRADER] Pre-market IST (${timeStr})`);
    } else if (hours < 9 || hours > 15 || (hours === 15 && minutes >= 30)) {
      marketStatus = "CLOSED";
      console.log(`[AUTO-TRADER] Market closed IST (${timeStr})`);
      for (const pos of openPositions.filter((p) => p.status === "OPEN")) {
        try {
          await closePosition(pos, session, "MARKET_CLOSE");
        } catch (err) {
          console.error(`[AUTO-TRADER] Market-close exit failed for ${pos.optionSymbol}:`, err.message);
        }
      }
      rescheduleMs = 60000;
    } else if (!isNseMarketOpen()) {
      // Within market hours by the clock, but the exchange is closed (weekend or holiday).
      // The time-of-day branches above only know the clock, not the NSE calendar.
      marketStatus = "CLOSED";
      console.log(`[AUTO-TRADER] Exchange holiday/weekend - no trading IST (${timeStr})`);
      for (const pos of openPositions.filter((p) => p.status === "OPEN")) {
        try {
          await closePosition(pos, session, "MARKET_CLOSE");
        } catch (err) {
          console.error(`[AUTO-TRADER] Holiday-close exit failed for ${pos.optionSymbol}:`, err.message);
        }
      }
    } else {
      marketStatus = "OPEN";
      // If startup reconciliation couldn't complete (e.g. a transient positions-fetch failure),
      // retry it here so the engine self-heals and can resume taking trades without a restart.
      if (!reconcileOk) {
        await reconcilePositionsWithBroker(session);
      }
      for (const underlying of getActiveUnderlyings()) {
        await processCandles(underlying, session);
      }
      await monitorPositions(session);
    }
  } catch (err) {
    console.error(`[AUTO-TRADER] Trading loop cycle error:`, err.message);
    logAudit({ type: "LOOP_ERROR", error: err.message });
  } finally {
    if (isRunning) {
      pollInterval = setTimeout(() => tradingLoop(session), rescheduleMs);
    }
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────
export async function startAutoTrader(sessionId) {
  if (isRunning) return { status: "ALREADY_RUNNING" };
  const { getSession } = await import("../routes/auth.js");
  const session = getSession(sessionId);
  if (!session) throw new Error("Invalid or expired session");
  currentSession = session;
  // PAPER mode sizes against a realistic simulated capital — the real balance can be below one option
  // lot, which blocks every trade at the margin gate. LIVE mode uses the actual broker balance.
  if (CONFIG.PAPER_TRADING) {
    CONFIG.CAPITAL = CONFIG.PAPER_CAPITAL > 0 ? CONFIG.PAPER_CAPITAL : CONFIG.CAPITAL;
    console.log(`[AUTO-TRADER] Paper capital: ₹${CONFIG.CAPITAL.toFixed(2)}`);
  } else {
    // LIVE: size and risk-limit against the REAL balance. If it can't be fetched (429 / expired token
    // / genuinely 0), REFUSE to start rather than run with a stale CONFIG.CAPITAL — which could be the
    // ₹10L paper value from a prior paper session. Both position sizing and the daily-loss breaker key
    // off CONFIG.CAPITAL, so a wrong value silently mis-scales real-money risk.
    const actualCapital = await fetchAvailableFunds(session);
    if (!(actualCapital > 0)) {
      throw new Error(
        "Cannot start LIVE trading: broker funds unavailable (0 or fetch failed — often a rate-limit). Reconnect FYERS and retry."
      );
    }
    CONFIG.CAPITAL = actualCapital;
    console.log(`[AUTO-TRADER] Capital: ₹${CONFIG.CAPITAL.toFixed(2)}`);
  }
  try {
    const positions = await fyersApiCall("/positions", session);
    console.log(`[AUTO-TRADER] Existing positions: ${positions.netPositions?.length || 0}`);
  } catch (err) {
    console.log("[AUTO-TRADER] Could not fetch existing positions");
  }

  // Start the live FYERS tick feed. The engine uses aggregateOHLC()/getLatestTick() as its
  // PRIMARY data source, but nothing else ever initiates the upstream WebSocket (the only
  // caller was the manual POST /api/ticks/connect route, which neither the frontend nor
  // startup invokes). Without this the feed stays disconnected and every cycle silently
  // falls back to the REST history/quotes API. Index symbols (NIFTY/BANKNIFTY) are always
  // subscribed by the tick service; option symbols are subscribed per-position in
  // openPosition()/closePosition().
  // NOTE: the tick store needs ~30 min of ticks to build 6 complete 5m candles, so the
  // first part of each session legitimately uses the REST fallback until ticks accumulate.
  try {
    connectFyersWebSocket(session.accessToken, FYERS_APP_ID);
    console.log("[AUTO-TRADER] Live tick feed connection initiated");
  } catch (err) {
    console.error("[AUTO-TRADER] Tick feed connect failed (will use REST fallback):", err.message);
  }
  console.log(
    `[AUTO-TRADER] Starting... Strategies: ${CONFIG.SELECTED_STRATEGIES.join(",")} | Instruments: ${CONFIG.SELECTED_INSTRUMENTS.join(",")} | TF: ${getTimeframes().join("/")}m | Risk: ${CONFIG.RISK_PERCENT}% | MaxLoss: ${CONFIG.MAX_RISK_PER_DAY_PERCENT}% | Paper: ${CONFIG.PAPER_TRADING} | Sizing: ${CONFIG.POSITION_SIZING_MODE}`
  );
  isRunning = true;
  // Preserve same-day risk counters across a restart so circuit breakers (daily-loss,
  // consecutive-losses, max-trades) are not silently reset mid-session. loadState() has
  // already restored them; only roll over when the persisted state is from a prior day.
  const today = new Date().toDateString();
  if (lastTradeDate !== today) {
    todayTrades = 0;
    dailyPnL = 0;
    dailyRealizedPnL = 0;
    consecutiveLosses = 0;
    lastTradeDate = today;
  }

  // Verify locally-tracked positions against the broker BEFORE the loop can act. This prevents
  // a phantom position (closed at the broker while we were down) from triggering a naked exit,
  // and re-arms the broker SL + tick subscription for anything still genuinely held. Blocks new
  // entries (reconcileOk stays false) if it can't complete.
  await reconcilePositionsWithBroker(session);

  tradingLoop(session);
  return {
    status: "STARTED",
    config: {
      capital: CONFIG.CAPITAL,
      riskPercent: CONFIG.RISK_PERCENT,
      paperTrading: CONFIG.PAPER_TRADING,
      positionSizingMode: CONFIG.POSITION_SIZING_MODE,
      fixedLots: CONFIG.FIXED_LOTS,
      selectedStrategies: CONFIG.SELECTED_STRATEGIES,
      selectedInstruments: CONFIG.SELECTED_INSTRUMENTS,
      selectedTimeframes: CONFIG.SELECTED_TIMEFRAMES,
    },
    startedAt: new Date().toISOString(),
  };
}

export function stopAutoTrader() {
  if (!isRunning) return { status: "NOT_RUNNING" };
  isRunning = false;
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
  // Tear down the live data feed so a later Start rebuilds it with the CURRENT token. The SDK
  // market-data socket is a process-wide singleton pinned to the token it was first built with;
  // without this teardown a Stop/Start (or a fresh login) cannot replace a dead/expired token
  // and the feed stays stranded until the whole process restarts.
  try {
    disconnectFyersWebSocket();
  } catch (err) {
    console.error("[AUTO-TRADER] Feed disconnect on stop failed:", err.message);
  }
  const openCount = openPositions.filter((p) => p.status === "OPEN").length;
  console.log(`[AUTO-TRADER] Stopped. ${openCount} positions open.`);
  return { status: "STOPPED", openPositions: openCount, stoppedAt: new Date().toISOString() };
}

async function flattenAllPositions(reason = "EMERGENCY") {
  if (!currentSession) {
    console.log("[AUTO-TRADER] No active session to flatten positions");
    return;
  }
  const open = openPositions.filter((p) => p.status === "OPEN");
  if (open.length === 0) return;
  console.log(`[AUTO-TRADER] Flattening ${open.length} position(s) due to ${reason}`);
  for (const position of open) {
    try {
      await closePosition(position, currentSession, reason);
    } catch (err) {
      console.error(`[AUTO-TRADER] Flatten failed for ${position.optionSymbol}:`, err.message);
    }
  }
}

export function emergencyStop() {
  CONFIG.EMERGENCY_STOP = true;
  isRunning = false;
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
  flattenAllPositions("EMERGENCY_STOP").catch((err) =>
    console.error("[AUTO-TRADER] Emergency flatten failed:", err.message)
  );
  console.log("[AUTO-TRADER] EMERGENCY STOP ACTIVATED");
  logAudit({ type: "EMERGENCY_STOP", timestamp: new Date().toISOString() });
  return { status: "EMERGENCY_STOPPED", openPositions: openPositions.filter((p) => p.status === "OPEN").length };
}

export function resetEmergencyStop() {
  if (!CONFIG.EMERGENCY_STOP) {
    return { status: "NOT_IN_EMERGENCY", message: "System was not in emergency state" };
  }
  CONFIG.EMERGENCY_STOP = false;
  console.log("[AUTO-TRADER] Emergency stop CLEARED. System ready.");
  logAudit({ type: "EMERGENCY_CLEARED", timestamp: new Date().toISOString() });
  return { status: "READY", message: "Emergency stop cleared. Use Start Bot to resume." };
}

function getExecutionStats() {
  return computeExecutionStats(auditLog);
}

function getHealthSnapshot() {
  const ws = getWsStatus();
  return computeHealthSnapshot({
    isRunning,
    wsConnected: !!(ws && ws.isConnected),
    emergencyStop: CONFIG.EMERGENCY_STOP,
    consecutiveLosses,
    maxConsecutiveLosses: CONFIG.MAX_CONSECUTIVE_LOSSES,
    marketOpen: isNseMarketOpen(),
  });
}

export function getAutoTraderStatus() {
  return {
    isRunning,
    marketStatus: getCurrentMarketStatus(),
    todayTrades,
    dailyPnL: dailyPnL.toFixed(2),
    consecutiveLosses,
    capital: CONFIG.CAPITAL,
    riskPercent: CONFIG.RISK_PERCENT,
    paperTrading: CONFIG.PAPER_TRADING,
    emergencyStop: CONFIG.EMERGENCY_STOP,
    // Token health so the UI can warn when the broker session has died mid-run (see noteAuthFailure).
    authHealthy: consecutiveAuthFailures < 3,
    consecutiveAuthFailures,
    positionSizingMode: CONFIG.POSITION_SIZING_MODE,
    fixedLots: CONFIG.FIXED_LOTS,
    selectedStrategies: CONFIG.SELECTED_STRATEGIES,
    selectedInstruments: CONFIG.SELECTED_INSTRUMENTS,
    selectedTimeframes: CONFIG.SELECTED_TIMEFRAMES,
    openPositions: openPositions.filter((p) => p.status === "OPEN"),
    closedPositions: openPositions.filter((p) => p.status === "CLOSED"),
    activeAlerts: Object.fromEntries(activeAlerts),
    latestData,
    recentSignals: getRecentSignals(10),
    indiaVIX,
    // Live tick-feed state so the UI "Tick Feed" badge (status.tickStatus) reflects reality
    // instead of always showing REST.
    tickStatus: getWsStatus(),
    executionStats: getExecutionStats(),
    health: getHealthSnapshot(),
  };
}

export function getPerformanceSummary() {
  const closed = openPositions.filter((p) => p.status === "CLOSED");
  const totalPnL = closed.reduce((sum, p) => sum + p.pnl, 0);
  const winningTrades = closed.filter((p) => p.pnl > 0);
  const losingTrades = closed.filter((p) => p.pnl < 0);
  return {
    totalTrades: closed.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: closed.length > 0 ? ((winningTrades.length / closed.length) * 100).toFixed(2) : 0,
    totalPnL: totalPnL.toFixed(2),
    todayTrades,
    openPositions: openPositions.filter((p) => p.status === "OPEN").length,
    dailyPnL: dailyPnL.toFixed(2),
    consecutiveLosses,
  };
}

export function setPaperTrading(enabled) {
  // A money-mode switch must happen only while STOPPED. Start re-fetches capital, reconciles broker
  // positions, and (via reconcile) clears phantom paper positions. Flipping mid-run would leave the
  // other mode's CONFIG.CAPITAL and any open paper positions in place — stale risk limits, or a REAL
  // market exit fired on a position that was never actually opened.
  if (isRunning && enabled !== CONFIG.PAPER_TRADING) {
    throw new Error("Stop the bot before switching between paper and live mode.");
  }
  CONFIG.PAPER_TRADING = enabled;
  saveState();
  return { paperTrading: CONFIG.PAPER_TRADING };
}

export function updateConfig(updates) {
  // L3 (audited): the /config route writes PAPER_TRADING via CONFIG_FIELD_MAP just like /paper-trading,
  // so it must apply the SAME guard — never let a non-boolean (0/""/null) silently flip the bot to
  // LIVE money. Drop a malformed paperTrading so the current mode is preserved.
  if (updates.paperTrading !== undefined) {
    if (typeof updates.paperTrading !== "boolean") {
      delete updates.paperTrading;
    } else if (isRunning && updates.paperTrading !== CONFIG.PAPER_TRADING) {
      // Same guard as setPaperTrading: never flip paper/live while the bot is running.
      console.error("[AUTO-TRADER] Ignoring paper/live mode change via /config while running — stop the bot first.");
      logAudit({ type: "MODE_CHANGE_BLOCKED", requested: updates.paperTrading });
      delete updates.paperTrading;
    }
  }
  // Sanitize the timeframes up front — accept an array (or single value) of supported candle
  // intervals only: coerce to numbers, keep allowed ones, dedupe. Also accept a legacy single
  // `timeframeMinutes` field from an older client. Drop the update if nothing valid remains so
  // an empty/garbage selection can't be stored and break candle fetching.
  if (updates.selectedTimeframes !== undefined || updates.timeframeMinutes !== undefined) {
    const raw = updates.selectedTimeframes !== undefined ? updates.selectedTimeframes : updates.timeframeMinutes;
    const arr = (Array.isArray(raw) ? raw : [raw]).map(Number).filter((t) => ALLOWED_TIMEFRAMES.includes(t));
    const deduped = [...new Set(arr)];
    if (deduped.length) updates.selectedTimeframes = deduped;
    else delete updates.selectedTimeframes;
    delete updates.timeframeMinutes; // legacy alias consumed
  }
  // Translate camelCase UI fields to CONFIG keys, applying only the ones actually sent so a
  // partial update doesn't clobber unrelated settings. Then persist so the change survives a
  // server restart, not just the in-memory session.
  for (const [incoming, target] of Object.entries(CONFIG_FIELD_MAP)) {
    if (updates[incoming] !== undefined) {
      CONFIG[target] = updates[incoming];
    }
  }
  saveState();
  return {
    config: {
      riskPercent: CONFIG.RISK_PERCENT,
      maxTradesPerDay: CONFIG.MAX_TRADES_PER_DAY,
      maxRiskPerDay: CONFIG.MAX_RISK_PER_DAY_PERCENT,
      positionSizingMode: CONFIG.POSITION_SIZING_MODE,
      fixedLots: CONFIG.FIXED_LOTS,
      paperTrading: CONFIG.PAPER_TRADING,
      limitBufferPct: CONFIG.LIMIT_BUFFER_PCT,
      maxVIX: CONFIG.MAX_VIX,
      maxSpreadPct: CONFIG.MAX_SPREAD_PCT,
      minOI: CONFIG.MIN_OI,
      maxTimeEntryHour: CONFIG.MAX_TIME_ENTRY_HOUR,
      allowCorrelatedTrades: CONFIG.ALLOW_CORRELATED_TRADES,
      selectedStrategies: CONFIG.SELECTED_STRATEGIES,
      selectedInstruments: CONFIG.SELECTED_INSTRUMENTS,
      selectedTimeframes: CONFIG.SELECTED_TIMEFRAMES,
    },
  };
}

export function getAuditLog(limit = 100) {
  return auditLog.slice(-limit);
}
