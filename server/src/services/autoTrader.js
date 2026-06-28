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
} from "./orderExecution.js";

import fs from "fs";
import path from "path";

// ΓöÇΓöÇΓöÇ CONFIGURATION ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const CONFIG = {
  POLL_INTERVAL_MS: 30000,
  UNDERLYINGS: [
    { name: "NIFTY", symbol: "NSE:NIFTY50-INDEX", lotSize: 75, marginPerLot: 150000 },
    { name: "BANKNIFTY", symbol: "NSE:NIFTYBANK-INDEX", lotSize: 30, marginPerLot: 180000 },
  ],
  CAPITAL: 100000,
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
  MARGIN_SAFETY_MULTIPLIER: 2,
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
};

function getActiveUnderlyings() {
  return CONFIG.UNDERLYINGS.filter((u) => CONFIG.SELECTED_INSTRUMENTS.includes(u.name));
}

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


// ΓöÇΓöÇΓöÇ PERSISTENCE ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const STATE_FILE = path.join(process.cwd(), "auto-trade-state.json");
const AUDIT_FILE = path.join(process.cwd(), "auto-trade-audit.jsonl");

function saveState() {
  try {
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

async function fetchCandlesWithTickFallback(symbol, session) {
  const shortName = getSymbolShortName(symbol);
  const tickCandles = aggregateOHLC(shortName, "5m", 25);
  if (tickCandles.length >= 6) {
    logAudit({ type: "DATA_SOURCE", source: "websocket", symbol, count: tickCandles.length });
    return tickCandles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]);
  }
  logAudit({ type: "DATA_SOURCE", source: "history_api", symbol, reason: "insufficient_tick_data", tickCount: tickCandles.length });
  return fetchLatestCandles(symbol, session.accessToken, FYERS_APP_ID);
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
function logAudit(event) {
  const entry = { timestamp: new Date().toISOString(), ...event };
  auditLog.push(entry);
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

async function fyersApiCall(endpoint, accessToken, appId, body = null, method = "GET") {
  const response = await fetch(`${FYERS_API_BASE}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `${appId}:${accessToken}`,
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
  }
  const data = await response.json();
  if (data.s !== "ok") {
    throw new Error(data.message || "FYERS API error");
  }
  return data;
}

// ─── RISK MANAGEMENT ──────────────────────────────────────────────────
async function fetchAvailableFunds(session) {
  try {
    const data = await fyersApiCall("/funds", session.accessToken, FYERS_APP_ID);
    const funds = data.fund_limit || [];
    const available = funds.find((f) => f.title === "Available Balance");
    return available ? available.equityAmount : 0;
  } catch (err) {
    console.error("[AUTO-TRADER] Funds fetch failed:", err.message);
    return 0;
  }
}

async function checkMargin(optionSymbol, qty, underlying, session) {
  try {
    const required = qty * (underlying.marginPerLot / underlying.lotSize);
    const available = await fetchAvailableFunds(session);
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
  const rounded = Math.floor(qty / underlying.lotSize) * underlying.lotSize;
  return Math.max(rounded, underlying.lotSize);
}

// ΓöÇΓöÇΓöÇ MARKET FILTERS ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function fetchIndiaVIX(session) {
  try {
    const url = `${FYERS_DATA_BASE}/quotes?symbols=NSE:INDIAVIX-INDEX`;
    const response = await fetch(url, {
      headers: { Authorization: `${FYERS_APP_ID}:${session.accessToken}` },
    });
    const data = await response.json();
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

async function checkLiquidity(optionSymbol, session) {
  try {
    const quote = await fetchOptionQuote(optionSymbol, session);
    if (!quote) return { pass: false, reason: "NO_QUOTE" };
    const oi = quote.oi || 0;
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
    const response = await fetch(url, {
      headers: { Authorization: `${FYERS_APP_ID}:${session.accessToken}` },
    });
    const data = await response.json();
    return data.d?.[0]?.v || null;
  } catch (err) {
    console.error(`[AUTO-TRADER] Quote fetch failed for ${optionSymbol}:`, err.message);
    return null;
  }
}

// ─── OPTION PRICE DERIVATION ──────────────────────────────────────────
function computeEntryLimitPrice(quote) {
  const base = quote.ask || quote.lp || 0;
  if (base <= 0) return 0;
  return Math.ceil(base * (1 + CONFIG.LIMIT_BUFFER_PCT / 100) * 100) / 100;
}

function computeOptionSLAndTarget(avgFillPrice, signal) {
  const slPct = Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice;
  const targetPct = Math.abs(signal.target - signal.entryPrice) / signal.entryPrice;
  const delta = CONFIG.OPTION_DELTA_ESTIMATE;
  const optionSL = Math.max(0.05, avgFillPrice * (1 - slPct * delta));
  const optionTarget = avgFillPrice * (1 + targetPct * delta);
  return {
    optionSL: Math.round(optionSL * 100) / 100,
    optionTarget: Math.round(optionTarget * 100) / 100,
  };
}

// ─── ORDER EXECUTION ──────────────────────────────────────────────────
async function openPosition(tradeSignal, optionSymbol, qty, session, entryQuote) {
  const entryLimitPrice = computeEntryLimitPrice(entryQuote);
  if (entryLimitPrice <= 0) {
    throw new Error("Could not compute valid entry limit price");
  }

  const entryOrder = await placeLimitEntry({
    symbol: optionSymbol,
    qty,
    limitPrice: entryLimitPrice,
    session,
    paperTrading: CONFIG.PAPER_TRADING,
    auditLogger: logAudit,
  });

  const fill = await waitForFill(entryOrder.orderId, session, {
    timeoutMs: CONFIG.ORDER_FILL_TIMEOUT_MS,
    pollMs: CONFIG.ORDER_POLL_INTERVAL_MS,
    paperTrading: CONFIG.PAPER_TRADING,
    paperFillPrice: entryLimitPrice,
    auditLogger: logAudit,
  });

  const filledQty = CONFIG.PAPER_TRADING ? qty : fill.filledQty;
  if (fill.status === "REJECTED" || fill.status === "CANCELLED" || filledQty <= 0) {
    logAudit({ type: "ENTRY_FAILED", orderId: entryOrder.orderId, status: fill.status, symbol: optionSymbol });
    return null;
  }

  // If partially filled then timed out, accept the filled quantity and let the
  // remaining pending qty expire on its own.
  if (fill.status === "PARTIAL") {
    try {
      await cancelOrder(entryOrder.orderId, session, logAudit);
    } catch (err) {
      console.error(`[AUTO-TRADER] Could not cancel remaining entry order ${entryOrder.orderId}:`, err.message);
    }
  }

  const avgFillPrice = fill.avgFillPrice || entryLimitPrice;
  const { optionSL, optionTarget } = computeOptionSLAndTarget(avgFillPrice, tradeSignal);

  let slOrderId = null;
  if (!CONFIG.PAPER_TRADING) {
    const slOrder = await placeStopLossOrder({
      symbol: optionSymbol,
      qty: filledQty,
      stopPrice: optionSL,
      session,
      paperTrading: false,
      auditLogger: logAudit,
    });
    slOrderId = slOrder.orderId;
  }

  const position = {
    id: entryOrder.orderId,
    entryOrderId: entryOrder.orderId,
    slOrderId,
    optionSymbol,
    quantity: filledQty,
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
    slOrderId,
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

  return position;
}

// ─── POSITION MANAGEMENT ──────────────────────────────────────────────
async function closePosition(position, session, reason) {
  if (position.status !== "OPEN") return;

  const currentLTP = position.currentLTP || position.avgFillPrice;
  const paperFillPrice = reason === "TARGET" ? position.target : currentLTP;

  if (position.slOrderId) {
    try {
      await cancelOrder(position.slOrderId, session, logAudit);
    } catch (err) {
      console.error(`[AUTO-TRADER] Could not cancel SL order ${position.slOrderId}:`, err.message);
    }
  }

  const exitOrder = await placeMarketExit({
    symbol: position.optionSymbol,
    qty: position.quantity,
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

  const exitQty = CONFIG.PAPER_TRADING ? position.quantity : fill.filledQty;
  const exitPrice = fill.avgFillPrice || paperFillPrice;

  position.status = "CLOSED";
  position.exitTime = new Date().toISOString();
  position.exitReason = reason;
  position.exitOrderId = exitOrder.orderId;
  position.exitPrice = exitPrice;
  position.quantity = exitQty;

  const pnl = (exitPrice - position.avgFillPrice) * exitQty;
  position.realizedPnl = pnl;
  position.pnl = pnl;
  dailyRealizedPnL += pnl;

  if (pnl < 0) {
    consecutiveLosses++;
  } else {
    consecutiveLosses = 0;
  }

  recalcDailyPnL();
  saveState();

  logAudit({
    type: "POSITION_CLOSED",
    orderId: position.id,
    exitOrderId: exitOrder.orderId,
    optionSymbol: position.optionSymbol,
    reason,
    avgFillPrice: position.avgFillPrice,
    exitPrice,
    qty: exitQty,
    pnl,
  });

  console.log(`[AUTO-TRADER] CLOSED: ${position.optionSymbol} | P&L: ₹${pnl.toFixed(2)} | ${reason}`);
}

async function reconcileStopLossOrders(session) {
  for (const position of openPositions) {
    if (position.status !== "OPEN" || !position.slOrderId) continue;
    try {
      const details = await getOrderDetails(position.slOrderId, session);
      if (details.status === "FILLED") {
        const exitPrice = details.avgFillPrice || position.stopLoss;
        position.status = "CLOSED";
        position.exitTime = new Date().toISOString();
        position.exitReason = "STOPLOSS";
        position.exitOrderId = position.slOrderId;
        position.exitPrice = exitPrice;
        const pnl = (exitPrice - position.avgFillPrice) * position.quantity;
        position.realizedPnl = pnl;
        position.pnl = pnl;
        dailyRealizedPnL += pnl;
        consecutiveLosses = pnl < 0 ? consecutiveLosses + 1 : 0;
        recalcDailyPnL();
        saveState();
        logAudit({
          type: "POSITION_CLOSED",
          orderId: position.id,
          exitOrderId: position.slOrderId,
          optionSymbol: position.optionSymbol,
          reason: "STOPLOSS",
          exitPrice,
          qty: position.quantity,
          pnl,
        });
        console.log(`[AUTO-TRADER] CLOSED by broker SL: ${position.optionSymbol} | P&L: ₹${pnl.toFixed(2)}`);
      } else if (details.status === "REJECTED" || details.status === "CANCELLED") {
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

async function monitorPositions(session) {
  if (openPositions.length === 0) return;

  for (const position of openPositions) {
    if (position.status !== "OPEN") continue;
    try {
      const quote = await fetchOptionQuoteWithTickFallback(position.optionSymbol, session);
      const ltp = quote?.lp || 0;
      if (ltp <= 0) continue;

      position.currentLTP = ltp;
      position.unrealizedPnl = (ltp - position.avgFillPrice) * position.quantity;

      // In paper mode we also monitor the stop-loss ourselves.
      const paperSLHit = CONFIG.PAPER_TRADING && ltp <= position.stopLoss;
      const targetHit = ltp >= position.target;

      if (paperSLHit) {
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

  await reconcileStopLossOrders(session);
  recalcDailyPnL();
}

// ─── MAIN TRADING LOGIC ───────────────────────────────────────────────
function canTakeTrade(underlyingName) {
  if (CONFIG.EMERGENCY_STOP) {
    console.log("[AUTO-TRADER] EMERGENCY STOP ACTIVE");
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
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit <= 0) return 0;
  return Math.floor(riskAmount / riskPerUnit);
}

async function processCandles(underlying, session) {
  try {
    const candles = await fetchCandlesWithTickFallback(underlying.symbol, session);
    if (candles.length < 6) return;
    latestData[underlying.name] = {
      candles,
      lastUpdated: new Date().toISOString(),
      ltp: candles[candles.length - 1][4],
    };
    for (const strategy of CONFIG.SELECTED_STRATEGIES) {
      const alert = detectAlertCandle(candles, strategy);
      if (alert) {
        console.log(`[AUTO-TRADER] ${underlying.name} ${alert.type} detected`);
        activeAlerts.set(`${underlying.name}:${strategy}`, {
          ...alert,
          underlying: underlying.name,
          symbol: underlying.symbol,
          detectedAt: new Date().toISOString(),
        });
      }
      const currentAlert = activeAlerts.get(`${underlying.name}:${strategy}`);
      if (!currentAlert) continue;
      const signal = detectBreakout(candles, currentAlert);
      if (!signal) continue;
      if (!canTakeTrade(underlying.name)) {
        activeAlerts.delete(`${underlying.name}:${strategy}`);
        continue;
      }
      const signalId = `${underlying.name}:${strategy}-${signal.timestamp}-${signal.type}`;
      if (processedSignals.has(signalId)) {
        activeAlerts.delete(`${underlying.name}:${strategy}`);
        continue;
      }
      processedSignals.add(signalId);
      if (!checkVIXFilter()) {
        activeAlerts.delete(`${underlying.name}:${strategy}`);
        continue;
      }
      const optionChain = await fetchOptionChain(underlying.symbol, session.accessToken, FYERS_APP_ID);
      const optionType = signal.type === "LONG" ? "CE" : "PE";
      const optionSymbol = getATMOption(underlying.name, signal.entryPrice, optionType, optionChain);
      if (!optionSymbol) {
        activeAlerts.delete(`${underlying.name}:${strategy}`);
        continue;
      }
      const liquidity = await checkLiquidity(optionSymbol, session);
      if (!liquidity.pass) {
        console.log(`[AUTO-TRADER] Liquidity check failed: ${liquidity.reason}`);
        activeAlerts.delete(`${underlying.name}:${strategy}`);
        continue;
      }
      const rawQty = calculatePositionSize(signal.entryPrice, signal.stopLoss, underlying);
      const qty = roundToLotSize(rawQty, underlying);
      if (qty <= 0) {
        activeAlerts.delete(`${underlying.name}:${strategy}`);
        continue;
      }
      const margin = await checkMargin(optionSymbol, qty, underlying, session);
      if (!margin.pass) {
        console.log(`[AUTO-TRADER] Margin insufficient: need Γé╣${margin.required.toFixed(2)}, have Γé╣${margin.available.toFixed(2)}`);
        activeAlerts.delete(`${underlying.name}:${strategy}`);
        continue;
      }
      const tradeSignal = {
        ...signal,
        strategy,
        quantity: qty,
        optionSymbol,
        underlying: underlying.name,
        underlyingSymbol: underlying.symbol,
      };
      try {
        const position = await openPosition(tradeSignal, optionSymbol, qty, session, liquidity.quote);
        if (!position) {
          activeAlerts.delete(`${underlying.name}:${strategy}`);
          continue;
        }
      } catch (orderError) {
        console.error(`[AUTO-TRADER] Order failed:`, orderError.message);
        logAudit({ type: "ORDER_FAILED", error: orderError.message, signal: tradeSignal });
      }
      activeAlerts.delete(`${underlying.name}:${strategy}`);
    }
  } catch (error) {
    console.error(`[AUTO-TRADER] Error:`, error.message);
  }
}

// ─── DATA FETCHING ────────────────────────────────────────────────────
async function fetchLatestCandles(symbol, accessToken, appId) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3600;
  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=5&date_format=0&range_from=${from}&range_to=${now}&cont_flag=1`;
  const response = await fetch(url, { headers: { Authorization: `${appId}:${accessToken}` } });
  const data = await response.json();
  return data.candles || [];
}

async function fetchOptionChain(symbol, accessToken, appId) {
  const url = `${FYERS_DATA_BASE}/options-chain-v3?symbol=${encodeURIComponent(symbol)}&strikecount=5`;
  const response = await fetch(url, { headers: { Authorization: `${appId}:${accessToken}` } });
  const data = await response.json();
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
      await closePosition(pos, session, "MARKET_CLOSE");
    }
    pollInterval = setTimeout(() => tradingLoop(session), 60000);
    return;
  } else {
    marketStatus = "OPEN";
    for (const underlying of getActiveUnderlyings()) {
      await processCandles(underlying, session);
    }
    await monitorPositions(session);
  }
  if (isRunning) {
    pollInterval = setTimeout(() => tradingLoop(session), CONFIG.POLL_INTERVAL_MS);
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────
export async function startAutoTrader(sessionId) {
  if (isRunning) return { status: "ALREADY_RUNNING" };
  const { getSession } = await import("../routes/auth.js");
  const session = getSession(sessionId);
  if (!session) throw new Error("Invalid or expired session");
  currentSession = session;
  const actualCapital = await fetchAvailableFunds(session);
  if (actualCapital > 0) {
    CONFIG.CAPITAL = actualCapital;
    console.log(`[AUTO-TRADER] Capital: ₹${CONFIG.CAPITAL.toFixed(2)}`);
  }
  try {
    const positions = await fyersApiCall("/positions", session.accessToken, FYERS_APP_ID);
    console.log(`[AUTO-TRADER] Existing positions: ${positions.netPositions?.length || 0}`);
  } catch (err) {
    console.log("[AUTO-TRADER] Could not fetch existing positions");
  }
  console.log(
    `[AUTO-TRADER] Starting... Strategies: ${CONFIG.SELECTED_STRATEGIES.join(",")} | Instruments: ${CONFIG.SELECTED_INSTRUMENTS.join(",")} | Risk: ${CONFIG.RISK_PERCENT}% | MaxLoss: ${CONFIG.MAX_RISK_PER_DAY_PERCENT}% | Paper: ${CONFIG.PAPER_TRADING} | Sizing: ${CONFIG.POSITION_SIZING_MODE}`
  );
  isRunning = true;
  todayTrades = 0;
  lastTradeDate = new Date().toDateString();
  dailyPnL = 0;
  dailyRealizedPnL = 0;
  consecutiveLosses = 0;
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
    positionSizingMode: CONFIG.POSITION_SIZING_MODE,
    fixedLots: CONFIG.FIXED_LOTS,
    selectedStrategies: CONFIG.SELECTED_STRATEGIES,
    selectedInstruments: CONFIG.SELECTED_INSTRUMENTS,
    openPositions: openPositions.filter((p) => p.status === "OPEN"),
    closedPositions: openPositions.filter((p) => p.status === "CLOSED"),
    activeAlerts: Object.fromEntries(activeAlerts),
    latestData,
    recentSignals: getRecentSignals(10),
    indiaVIX,
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
  CONFIG.PAPER_TRADING = enabled;
  return { paperTrading: CONFIG.PAPER_TRADING };
}

export function updateConfig(updates) {
  Object.assign(CONFIG, updates);
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
    },
  };
}

export function getAuditLog(limit = 100) {
  return auditLog.slice(-limit);
}
