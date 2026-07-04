/**
 * PRODUCTION-GRADE AUTOMATED TRADING SYSTEM
 *
 * Institutional-quality risk management for real money trading.
 * All decisions are logged. All limits are enforced.
 */

import {
  calculateEMA,
  detectAlertCandle,
  isValidTradingTime,
  isSquareOffTime,
  storeSignal,
  getRecentSignals,
} from "./emaStrategy.js";

import {
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
    // Lot sizes per the NSE Jan-2026 series revision (circular FAOP70616): NIFTY 75→65,
    // BANKNIFTY 35→30. A wrong lot size is silently fatal live — every order is exchange-
    // rejected as an invalid multiple — while paper mode happily fills it, so re-verify
    // these against the NSE circulars at every series revision.
    { name: "NIFTY", symbol: "NSE:NIFTY50-INDEX", lotSize: 65, marginPerLot: 150000 },
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
  // Fail-SAFE default: if auto-trade-state.json is ever missing/unreadable (fresh host, cwd
  // change), the bot must come up in PAPER mode — going live requires an explicit operator
  // toggle. The previous default (false = live) meant a lost state file silently armed real money.
  PAPER_TRADING: true,
  BROKERAGE_PER_ORDER: 20,
  EMERGENCY_STOP: false,
  // EMA5T is the only live strategy: the trend-gated futures system validated over 6 years
  // (2026-07). The legacy EMA5/EMA5_OPTION option-buying flow was removed at the user's
  // request — the Backtest Lab retains options backtesting; git history retains the code.
  SELECTED_STRATEGIES: ["EMA5T"],
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

// EMA5T (futures): resting stop-entry orders, keyed like activeAlerts. Phase A simulates
// them in PAPER mode only (fill at the alert level ± slippage when a completed candle
// crosses it — the exact fill model the 6-year validation used). Persisted so a mid-day
// restart keeps them. The LIVE broker-side stop-entry path is not built yet and is blocked.
let pendingEntries = new Map();
let ema5tLiveWarnedDate = null;


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
          pendingEntries: Array.from(pendingEntries.entries()),
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
      pendingEntries = new Map(s.pendingEntries || []);
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

// ΓöÇΓöÇΓöÇ MARKET FILTERS ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function fetchIndiaVIX(session) {
  try {
    const url = `${FYERS_DATA_BASE}/quotes?symbols=NSE:INDIAVIX-INDEX`;
    const data = await fyersDataFetch(url, session);
    indiaVIX = data.d?.[0]?.v?.lp || 0;
    return indiaVIX;
  } catch (err) {
    console.error("[AUTO-TRADER] VIX fetch failed:", err.message);
    // Fail-OPEN by design (a dead VIX feed shouldn't halt trading) — but leave a trace so a
    // day traded without the VIX filter is visible in the audit trail.
    logAudit({ type: "VIX_FETCH_FAILED", error: err.message });
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

// ─── ORDER EXECUTION ──────────────────────────────────────────────────
// (The options limit-entry flow — computeEntryLimitPrice / computeOptionSLAndTarget /
// reconcileEntryOrder / openPosition — was removed with the legacy EMA5/EMA5_OPTION
// strategies. EMA5T enters via resting stop orders in manageFuturesPending; the shared
// exit/SL/reconcile machinery below is unchanged.)


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
  position.pendingExitOrderId = null; // exit resolved — nothing in flight anymore

  // C4: report NET P&L — deduct brokerage + statutory costs (same model the backtest uses) so the
  // dashboard/audit isn't optimistic. Paper mode has no real costs. The round-trip cost is charged
  // ONCE for the whole position (on the original entry qty), so a multi-leg exit — where earlier
  // legs were realized GROSS via settleLeg — never double-counts brokerage / buy-side charges.
  // Direction-aware: SHORT futures profit when exit < entry (options have no side → long math).
  const dirMult = position.side === "SHORT" ? -1 : 1;
  const gross = (exitPrice - position.avgFillPrice) * exitQty * dirMult;
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
  const dirMult = position.side === "SHORT" ? -1 : 1;
  const gross = (exitPrice - position.avgFillPrice) * q * dirMult;
  position.realizedPnl = (position.realizedPnl || 0) + gross;
  position.pnl = position.realizedPnl;
  dailyRealizedPnL += gross;
  position.quantity = (position.quantity || 0) - q;
  position.entryQty = position.quantity;
  position.unrealizedPnl = position.currentLTP ? (position.currentLTP - position.avgFillPrice) * position.quantity * dirMult : 0;
  logAudit({ type: "PARTIAL_EXIT", optionSymbol: position.optionSymbol, source, exitPrice, qty: q, remainder: position.quantity, gross });
  console.error(`[AUTO-TRADER] PARTIAL EXIT ${position.optionSymbol} [${source}]: ${q} @ ₹${Number(exitPrice).toFixed(2)} — ${position.quantity} still held`);
  return position.quantity;
}

async function closePosition(position, session, reason) {
  if (position.status !== "OPEN") return;

  let heldQty = position.entryQty ?? position.quantity;

  // ─── Settle any exit order a PREVIOUS closePosition attempt left in flight ─────────────
  // (process crash or API outage between placing the market exit and confirming its fill —
  // pendingExitOrderId is persisted with the position). Without this, a retry would place a
  // SECOND market sell while the first may have filled: an oversell into a naked short. If
  // the broker is unreachable, abort and retry next cycle — the id stays on the position.
  if (position.pendingExitOrderId && !CONFIG.PAPER_TRADING) {
    let det = null;
    try {
      det = await getOrderDetails(position.pendingExitOrderId, session);
    } catch (err) {
      console.error(`[AUTO-TRADER] Cannot verify in-flight exit ${position.pendingExitOrderId} for ${position.optionSymbol}; retrying next cycle:`, err.message);
      return;
    }
    if (det.status === "FILLED" || (Number(det.filledQty) || 0) >= heldQty) {
      finalizeClose(position, {
        exitPrice: det.avgFillPrice || position.currentLTP || position.avgFillPrice,
        exitQty: heldQty,
        reason,
        exitOrderId: det.orderId,
      });
      return;
    }
    if (!["REJECTED", "CANCELLED", "EXPIRED"].includes(det.status)) {
      // Still working at the broker — cancel the remainder, then re-read the true final fill
      // so a fill landing between the read and the cancel is never lost (entry C-LIVE-1 pattern).
      try {
        await cancelOrder(position.pendingExitOrderId, session, logAudit);
        det = await getOrderDetails(position.pendingExitOrderId, session);
      } catch (err) {
        console.error(`[AUTO-TRADER] Cannot cancel/re-read in-flight exit ${position.pendingExitOrderId} for ${position.optionSymbol}; retrying next cycle:`, err.message);
        return;
      }
    }
    if ((Number(det.filledQty) || 0) > 0) {
      heldQty = settleLeg(position, det.avgFillPrice || position.currentLTP || position.avgFillPrice, Math.min(det.filledQty, heldQty), "PENDING_EXIT_SETTLED");
    }
    position.pendingExitOrderId = null;
    saveState();
    // Fall through: remaining qty (possibly 0) is handled by the normal flow below.
  }

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
      // The id now points at a CANCELLED order — forget it, or reconcileStopLossOrders would
      // read the cancelled SL as "SL failed" next cycle and fire a DUPLICATE closePosition
      // while this exit is still in flight. On cancel failure keep the id: the SL may still
      // be live at the broker and must stay tracked.
      position.slOrderId = null;
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

  // Track the in-flight exit BEFORE polling (and persist it): if the process dies or the
  // broker becomes unreachable mid-poll, the next closePosition attempt settles THIS order
  // instead of placing a second market sell on quantity that may already be gone.
  position.pendingExitOrderId = exitOrder.orderId;
  saveState();

  const fill = await waitForFill(exitOrder.orderId, session, {
    timeoutMs: CONFIG.ORDER_FILL_TIMEOUT_MS,
    pollMs: CONFIG.ORDER_POLL_INTERVAL_MS,
    paperTrading: CONFIG.PAPER_TRADING,
    paperFillPrice,
    auditLogger: logAudit,
  });

  // Non-terminal outcome (TIMEOUT, or PARTIAL at deadline): the order may STILL be working at
  // the broker. Cancel the remainder and re-read the true final fill (entry C-LIVE-1 pattern).
  // If the broker is unreachable, RETURN with pendingExitOrderId still set — never re-arm an
  // SL next to a possibly-live exit order (the pair could sell the same quantity twice).
  let finalFill = fill;
  if (!CONFIG.PAPER_TRADING && !["FILLED", "REJECTED", "CANCELLED", "EXPIRED"].includes(fill.status)) {
    try {
      await cancelOrder(exitOrder.orderId, session, logAudit);
      const reread = await getOrderDetails(exitOrder.orderId, session);
      finalFill = { ...fill, ...reread, avgFillPrice: reread.avgFillPrice || fill.avgFillPrice };
    } catch (err) {
      console.error(`[AUTO-TRADER] Exit ${exitOrder.orderId} unconfirmed for ${position.optionSymbol} (${err.message}); will settle next cycle`);
      logAudit({ type: "EXIT_UNCONFIRMED", optionSymbol: position.optionSymbol, exitOrderId: exitOrder.orderId, reason });
      recalcDailyPnL();
      saveState();
      return;
    }
  }

  const exitPrice = finalFill.avgFillPrice || paperFillPrice;
  const plan = classifyExit({ paper: CONFIG.PAPER_TRADING, entryQty: heldQty, fillQty: finalFill.filledQty });

  // ─── C2: a partial / unfilled exit must NOT mark the position CLOSED and orphan the remainder ──
  // Realize any filled portion, keep the position OPEN with the leftover qty, re-arm a broker SL on
  // it, and let the next monitor cycle retry the exit.
  if (plan.action === "partial" || plan.action === "unfilled") {
    if (plan.action === "partial") {
      settleLeg(position, exitPrice, plan.exitQty, `MARKET_PARTIAL:${reason}`);
    } else {
      logAudit({ type: "EXIT_UNFILLED", optionSymbol: position.optionSymbol, reason, exitOrderId: exitOrder.orderId, fillStatus: finalFill.status });
      console.error(`[AUTO-TRADER] EXIT UNFILLED for ${position.optionSymbol} (${finalFill.status}); ${plan.remainder} still held — re-arming SL, will retry`);
      position.quantity = plan.remainder;
      position.entryQty = plan.remainder;
    }
    position.pendingExitOrderId = null; // the exit order is confirmed dead (cancelled/rejected)
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
      // rare naked window from a failed SL placement at entry.
      if (!CONFIG.PAPER_TRADING && !position.slOrderId) {
        await ensureStopLoss(position, session);
      }
      const quote = await fetchOptionQuoteWithTickFallback(position.optionSymbol, session);
      const ltp = quote?.lp || 0;
      if (ltp <= 0) continue;

      position.currentLTP = ltp;
      // Direction-aware P&L: options positions are always long (no `side` field → mult 1);
      // EMA5T futures positions can be SHORT, where price down = profit and the SL sits ABOVE.
      const dirMult = position.side === "SHORT" ? -1 : 1;
      position.unrealizedPnl = (ltp - position.avgFillPrice) * position.quantity * dirMult;

      // Local backstop. In paper mode this is the only stop. In live mode the broker SL-M order is
      // primary (reconciled above first); this catches a broker SL stuck PENDING through a fast
      // move/gap. closePosition verifies the broker SL isn't already filled before placing an exit.
      const slHit = dirMult === 1 ? ltp <= position.currentSL : ltp >= position.currentSL;
      const targetHit = dirMult === 1 ? ltp >= position.target : ltp <= position.target;

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

async function processCandles(underlying, session) {
  try {
    // EMA5T trades FUTURES, so signals MUST come from the futures contract's own candles.
    // The futures basis runs tens of points away from the index; index-derived alert levels
    // checked against futures quotes would skew every entry/SL/target by the basis. This
    // also matches the 6-year validation exactly (it was run on futures candles).
    const futSymbol = await resolveFuturesSymbol(underlying, session);
    if (!futSymbol) {
      logAudit({ type: "EMA5T_NO_CONTRACT", underlying: underlying.name });
      return;
    }
    // Scan EACH selected timeframe independently — a 15m and a 30m setup on the same
    // underlying are separate signals that each trade on their own. Global risk limits
    // (max trades/day, daily-loss cap, capital, correlation filter) are SHARED.
    for (const tf of getTimeframes()) {
      const candles = await fetchCandlesWithTickFallback(futSymbol, session, tf);
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
        // EMA5T (the only strategy) trades futures via resting stop entries. The legacy
        // option/breakout entry flow was removed with EMA5/EMA5_OPTION.
        if (strategy === "EMA5T") {
          await manageFuturesPending({ key, underlying, tf, candles, futSymbol, alert: activeAlerts.get(key), session });
        }
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

// ─── EMA5T FUTURES (Phase A: paper only) ─────────────────────────────
const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** FYERS futures symbol, e.g. NSE:BANKNIFTY26JULFUT. Pure/exported for unit tests. */
export function buildFuturesSymbol(underlyingName, year, monthIdx) {
  return `NSE:${underlyingName}${String(year % 100).padStart(2, "0")}${MONTH_CODES[monthIdx]}FUT`;
}

// Resolve the tradable (current-month, else next) futures contract by asking FYERS for a
// live quote rather than hardcoding expiry rules — expiry weekdays have changed repeatedly.
// Cached per day.
const futSymbolCache = { date: null, symbols: {} };
async function resolveFuturesSymbol(underlying, session) {
  const today = new Date().toISOString().slice(0, 10);
  if (futSymbolCache.date !== today) {
    futSymbolCache.date = today;
    futSymbolCache.symbols = {};
  }
  if (futSymbolCache.symbols[underlying.name]) return futSymbolCache.symbols[underlying.name];
  const now = new Date();
  for (let k = 0; k < 3; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    const sym = buildFuturesSymbol(underlying.name, d.getUTCFullYear(), d.getUTCMonth());
    try {
      const data = await fyersDataFetch(`${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent(sym)}`, session);
      if ((data.d?.[0]?.v?.lp || 0) > 0) {
        futSymbolCache.symbols[underlying.name] = sym;
        return sym;
      }
    } catch {
      /* try the next month */
    }
  }
  return null;
}

/**
 * EMA5T resting stop-entry lifecycle (called once per underlying+timeframe per cycle,
 * INSTEAD of the option/breakout flow). PAPER ONLY in Phase A — fills are simulated at
 * the alert level ± slippage when a completed candle crosses it, with the same worst-case
 * same-candle SL rule the 6-year validation used. The live broker-side stop-order path is
 * deliberately NOT wired: running EMA5T in live mode refuses loudly instead of silently
 * degrading to market fills (which the validation showed destroys the edge).
 */
async function manageFuturesPending({ key, underlying, tf, candles, futSymbol, alert, session }) {
  if (!CONFIG.PAPER_TRADING) {
    const today = new Date().toDateString();
    if (ema5tLiveWarnedDate !== today) {
      ema5tLiveWarnedDate = today;
      console.error("[AUTO-TRADER] EMA5T is PAPER-ONLY until the live stop-entry path is built — skipping live signals.");
      logAudit({ type: "EMA5T_LIVE_BLOCKED", key });
    }
    return;
  }

  const latest = candles[candles.length - 1]; // last COMPLETED candle (in-progress dropped upstream)

  // A fresh alert (re)arms the resting stop at its level, replacing any previous pending.
  if (alert) {
    const existing = pendingEntries.get(key);
    if (!existing || existing.alertTimestamp !== alert.timestamp) {
      const dir = alert.type === "BULLISH_ALERT" ? "LONG" : "SHORT";
      const level = dir === "LONG" ? alert.high : alert.low;
      const sl = dir === "LONG" ? alert.low : alert.high;
      const risk = Math.abs(level - sl);
      if (risk > 0) {
        pendingEntries.set(key, {
          key,
          strategy: "EMA5T",
          underlying: underlying.name,
          timeframe: tf,
          dir,
          level,
          stopLoss: sl,
          target: dir === "LONG" ? level + 2 * risk : level - 2 * risk,
          alertTimestamp: alert.timestamp,
          createdAt: new Date().toISOString(),
        });
        saveState();
        logAudit({ type: "EMA5T_PENDING_ARMED", key, dir, level, stopLoss: sl, timeframe: tf });
      }
    }
  }

  const p = pendingEntries.get(key);
  if (!p) return;

  // Entry window: same 14:00 IST cutoff the validation used. Expired pendings are dropped.
  if (!checkTimeFilter()) {
    pendingEntries.delete(key);
    saveState();
    logAudit({ type: "EMA5T_PENDING_EXPIRED", key });
    return;
  }

  // Fill check: has a completed candle crossed the resting level?
  const crossed = p.dir === "LONG" ? latest[2] >= p.level : latest[3] <= p.level;
  if (!crossed) return;

  const signalId = `${key}-${p.alertTimestamp}-${p.dir}`;
  if (processedSignals.has(signalId)) {
    pendingEntries.delete(key);
    saveState();
    return;
  }
  if (!canTakeTrade(underlying.name)) {
    pendingEntries.delete(key);
    saveState();
    return;
  }
  // Catastrophe guard only (validated spec has no VIX band): skip fills when VIX > MAX_VIX.
  if (!checkVIXFilter()) {
    pendingEntries.delete(key);
    saveState();
    return;
  }
  processedSignals.add(signalId);
  pendingEntries.delete(key);

  const slip = 0.0005; // same stop-fill slippage the 6-year validation charged
  const entry = p.dir === "LONG" ? p.level * (1 + slip) : p.level * (1 - slip);
  const qty = underlying.lotSize; // Phase A: fixed 1 lot
  const marginReq = entry * qty * 0.14; // SPAN+exposure approximation with headroom
  if (marginReq > CONFIG.CAPITAL) {
    logAudit({ type: "EMA5T_MARGIN_SKIP", key, marginReq, capital: CONFIG.CAPITAL });
    saveState();
    return;
  }

  const position = {
    id: `PAPER-FUT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    entryOrderId: null,
    slOrderId: null,
    kind: "FUT",
    side: p.dir,
    optionSymbol: futSymbol, // symbol field shared with the monitor/quote/audit plumbing
    quantity: qty,
    entryQty: qty,
    origEntryQty: qty,
    avgFillPrice: entry,
    entryPrice: p.level,
    stopLoss: p.stopLoss,
    target: p.target,
    currentSL: p.stopLoss,
    unrealizedPnl: 0,
    realizedPnl: 0,
    pnl: 0,
    status: "OPEN",
    entryTime: new Date().toISOString(),
    signal: { type: p.dir, strategy: "EMA5T", timeframe: tf, entryPrice: p.level, stopLoss: p.stopLoss, target: p.target, underlying: underlying.name },
    underlying: underlying.name,
  };
  openPositions.push(position);
  todayTrades++;
  try {
    subscribeToSymbols([futSymbol]);
  } catch {
    /* best-effort */
  }
  storeSignal({ ...position.signal, quantity: qty, optionSymbol: futSymbol, timestamp: p.alertTimestamp });
  logAudit({ type: "POSITION_OPENED", kind: "FUT", strategy: "EMA5T", orderId: position.id, optionSymbol: futSymbol, side: p.dir, qty, entry, stopLoss: p.stopLoss, target: p.target, timeframe: tf });
  console.log(`[AUTO-TRADER] EMA5T PAPER ${p.dir} ${futSymbol} @ ${entry.toFixed(2)} (SL ${p.stopLoss}, target ${p.target.toFixed(2)}, ${tf}m)`);

  // Worst-case same-candle stop — backtest parity (SL is checked before target within a bar).
  const sameBarSl = p.dir === "LONG" ? latest[3] <= p.stopLoss : latest[2] >= p.stopLoss;
  if (sameBarSl) {
    finalizeClose(position, { exitPrice: p.stopLoss, exitQty: qty, reason: "STOPLOSS", exitOrderId: position.id });
  }
  recalcDailyPnL();
  saveState();
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
      pendingEntries.clear(); // resting stop entries never carry across days
      ema5tLiveWarnedDate = null;
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

// Bounds for numeric config fields (camelCase, as the UI sends them). Out-of-bounds or
// non-numeric values are DROPPED — current setting preserved — never clamped: silently
// trading a "corrected" value the operator didn't type is worse than rejecting the update.
// A fat-fingered riskPercent of 50 must not 100×-size a live position.
const CONFIG_NUMERIC_BOUNDS = {
  riskPercent: { min: 0.05, max: 5 },
  maxRiskPerDay: { min: 0.5, max: 10 },
  maxTradesPerDay: { min: 1, max: 100, int: true },
  fixedLots: { min: 1, max: 100, int: true },
  paperCapital: { min: 10000, max: 100000000 },
  limitBufferPct: { min: 0, max: 5 },
  maxVIX: { min: 5, max: 100 },
  maxSpreadPct: { min: 0.1, max: 20 },
  minOI: { min: 0, max: 10000000, int: true },
  maxTimeEntryHour: { min: 9, max: 15, int: true },
};
const ALLOWED_STRATEGIES = ["EMA5T"];
const ALLOWED_INSTRUMENT_NAMES = ["NIFTY", "BANKNIFTY"];

/**
 * Pure validation of a /config payload: numeric fields bounds-checked, enums/lists filtered
 * to their allowlists, booleans type-checked. Invalid fields are dropped and reported so the
 * caller can audit them. selectedTimeframes/timeframeMinutes pass through — updateConfig has
 * its own dedicated sanitizer for those. Exported for unit tests.
 * @returns {{clean: object, rejected: {key:string,value:any}[]}}
 */
export function sanitizeConfigUpdates(updates) {
  const clean = {};
  const rejected = [];
  for (const [key, value] of Object.entries(updates || {})) {
    if (CONFIG_NUMERIC_BOUNDS[key]) {
      const b = CONFIG_NUMERIC_BOUNDS[key];
      const n = Number(value);
      if (typeof value === "boolean" || !Number.isFinite(n) || n < b.min || n > b.max || (b.int && !Number.isInteger(n))) {
        rejected.push({ key, value });
        continue;
      }
      clean[key] = n;
    } else if (key === "positionSizingMode") {
      if (value === "RISK" || value === "LOTS") clean[key] = value;
      else rejected.push({ key, value });
    } else if (key === "allowCorrelatedTrades" || key === "paperTrading") {
      if (typeof value === "boolean") clean[key] = value;
      else rejected.push({ key, value });
    } else if (key === "selectedStrategies") {
      const arr = (Array.isArray(value) ? value : [value]).filter((s) => ALLOWED_STRATEGIES.includes(s));
      const deduped = [...new Set(arr)];
      if (deduped.length) clean[key] = deduped;
      else rejected.push({ key, value });
    } else if (key === "selectedInstruments") {
      const arr = (Array.isArray(value) ? value : [value]).filter((s) => ALLOWED_INSTRUMENT_NAMES.includes(s));
      const deduped = [...new Set(arr)];
      if (deduped.length) clean[key] = deduped;
      else rejected.push({ key, value });
    } else {
      clean[key] = value;
    }
  }
  return { clean, rejected };
}

export function updateConfig(updates) {
  // Bounds/allowlist validation FIRST: invalid fields are dropped (never clamped) and audited.
  const { clean, rejected } = sanitizeConfigUpdates(updates);
  if (rejected.length) {
    console.error(`[AUTO-TRADER] Rejected invalid config fields: ${rejected.map((r) => r.key).join(", ")}`);
    logAudit({ type: "CONFIG_REJECTED_FIELDS", fields: rejected });
  }
  updates = clean;
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
