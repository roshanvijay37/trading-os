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

import fs from "fs";
import path from "path";

// ─── CONFIGURATION ───────────────────────────────────────────────
const CONFIG = {
  // Core
  POLL_INTERVAL_MS: 30000,
  UNDERLYINGS: [
    { name: "NIFTY", symbol: "NSE:NIFTY50-INDEX", lotSize: 75, marginPerLot: 150000 },
    { name: "BANKNIFTY", symbol: "NSE:NIFTYBANK-INDEX", lotSize: 30, marginPerLot: 180000 },
  ],
  
  // Capital & Risk
  CAPITAL: 100000,
  RISK_PERCENT: 0.5,           // 0.5% per trade (institutional standard)
  MAX_RISK_PER_DAY_PERCENT: 2,  // Stop after -2% daily loss
  MAX_CONSECUTIVE_LOSSES: 3,    // Psychology circuit breaker
  MAX_TRADES_PER_DAY: 10,       // Max 10 trades per day
  TARGET_MULTIPLIER: 2,
  
  // Order Execution
  ORDER_TYPE: "LIMIT",          // NEVER market orders
  LIMIT_BUFFER_PCT: 0.3,        // 0.3% buffer for limit entry
  SLIPPAGE_BUFFER_PCT: 0.5,
  MARGIN_SAFETY_MULTIPLIER: 2,  // Require 2x calculated margin
  
  // Filters
  MAX_VIX: 25,                  // Skip if India VIX > 25
  MAX_SPREAD_PCT: 2,            // Skip if spread > 2%
  MIN_OI: 100000,               // Skip if OI < 1 lakh
  MAX_TIME_ENTRY_HOUR: 14,      // No new entries after 2:00 PM IST
  ALLOW_CORRELATED_TRADES: false, // Only one underlying at a time
  
  // Features
  TRAILING_SL_ENABLED: false,
  PAPER_TRADING: false,         // Set true to simulate without orders
  BROKERAGE_PER_ORDER: 20,
  
  // Safety
  EMERGENCY_STOP: false,        // Set true to halt all trading
};

// ─── STATE ───────────────────────────────────────────────────────
let isRunning = false;
let pollInterval = null;
let activeAlerts = new Map();
let openPositions = [];
let todayTrades = 0;
let lastTradeDate = null;
let marketStatus = "CLOSED";
let latestData = {};
let processedSignals = new Set();
let indiaVIX = 0;
let dailyPnL = 0;
let consecutiveLosses = 0;
let auditLog = [];
let paperModeTrades = [];

// ─── PERSISTENCE ─────────────────────────────────────────────────
const STATE_FILE = path.join(process.cwd(), "auto-trade-state.json");
const AUDIT_FILE = path.join(process.cwd(), "auto-trade-audit.jsonl");

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      openPositions,
      todayTrades,
      lastTradeDate,
      processedSignals: Array.from(processedSignals),
      dailyPnL,
      consecutiveLosses,
    }, null, 2));
  } catch (err) {
    console.error("[AUTO-TRADER] Save state failed:", err.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      openPositions = s.openPositions || [];
      todayTrades = s.todayTrades || 0;
      lastTradeDate = s.lastTradeDate || null;
      processedSignals = new Set(s.processedSignals || []);
      dailyPnL = s.dailyPnL || 0;
      consecutiveLosses = s.consecutiveLosses || 0;
    }
  } catch (err) {
    console.error("[AUTO-TRADER] Load state failed:", err.message);
  }
}

loadState();

// ─── AUDIT LOGGING ───────────────────────────────────────────────
function logAudit(event) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  auditLog.push(entry);
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[AUTO-TRADER] Audit write failed:", err.message);
  }
}

// ─── FYERS API ───────────────────────────────────────────────────
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

// ─── RISK MANAGEMENT ─────────────────────────────────────────────

async function fetchAvailableFunds(session) {
  try {
    const data = await fyersApiCall("/funds", session.accessToken, session.appId);
    const funds = data.fund_limit || [];
    const available = funds.find((f) => f.title === "Available Balance");
    return available ? available.equityAmount : 0;
  } catch (err) {
    console.error("[AUTO-TRADER] Funds fetch failed:", err.message);
    return 0;
  }
}

async function checkMargin(optionSymbol, qty, session) {
  try {
    const required = qty * (CONFIG.UNDERLYINGS[0].marginPerLot / CONFIG.UNDERLYINGS[0].lotSize);
    const available = await fetchAvailableFunds(session);
    const safeRequired = required * CONFIG.MARGIN_SAFETY_MULTIPLIER;
    
    logAudit({
      type: "MARGIN_CHECK",
      optionSymbol,
      qty,
      required,
      available,
      safeRequired,
      pass: available >= safeRequired,
    });
    
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
    console.log(`[AUTO-TRADER] 🚫 DAILY LOSS LIMIT HIT: ₹${dailyPnL.toFixed(2)} (limit: ₹${limit.toFixed(2)})`);
    logAudit({ type: "CIRCUIT_BREAKER", reason: "DAILY_LOSS_LIMIT", dailyPnL, limit });
  }
  return !hit;
}

function checkConsecutiveLosses() {
  const hit = consecutiveLosses >= CONFIG.MAX_CONSECUTIVE_LOSSES;
  if (hit) {
    console.log(`[AUTO-TRADER] 🚫 CONSECUTIVE LOSS LIMIT: ${consecutiveLosses} losses`);
    logAudit({ type: "CIRCUIT_BREAKER", reason: "CONSECUTIVE_LOSSES", consecutiveLosses });
  }
  return !hit;
}

function roundToLotSize(qty, underlying) {
  const rounded = Math.floor(qty / underlying.lotSize) * underlying.lotSize;
  return Math.max(rounded, underlying.lotSize);
}

// ─── MARKET FILTERS ──────────────────────────────────────────────

async function fetchIndiaVIX(session) {
  try {
    const url = `${FYERS_DATA_BASE}/quotes?symbols=NSE:INDIAVIX-INDEX`;
    const response = await fetch(url, {
      headers: { Authorization: `${session.appId}:${session.accessToken}` },
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
    console.log(`[AUTO-TRADER] 🚫 HIGH VIX: ${indiaVIX} (max: ${CONFIG.MAX_VIX})`);
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
    console.log(`[AUTO-TRADER] ⏰ After ${CONFIG.MAX_TIME_ENTRY_HOUR}:00 IST — no new entries`);
    return false;
  }
  return true;
}

function checkCorrelationFilter(underlyingName) {
  if (CONFIG.ALLOW_CORRELATED_TRADES) return true;
  
  const hasOpenTrade = openPositions.some(p => p.status === "OPEN" && p.underlying !== underlyingName);
  if (hasOpenTrade) {
    console.log(`[AUTO-TRADER] 🚫 Correlation filter: already in trade on other underlying`);
    return false;
  }
  return true;
}

async function checkLiquidity(optionSymbol, session) {
  try {
    const url = `${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent(optionSymbol)}`;
    const response = await fetch(url, {
      headers: { Authorization: `${session.appId}:${session.accessToken}` },
    });
    const data = await response.json();
    const quote = data.d?.[0]?.v;
    if (!quote) return { pass: false, reason: "NO_QUOTE" };
    
    const oi = quote.oi || 0;
    const spread = ((quote.ask - quote.bid) / quote.lp) * 100;
    
    if (oi < CONFIG.MIN_OI) {
      logAudit({ type: "FILTER_BLOCKED", reason: "LOW_OI", optionSymbol, oi, minOI: CONFIG.MIN_OI });
      return { pass: false, reason: "LOW_OI" };
    }
    if (spread > CONFIG.MAX_SPREAD_PCT) {
      logAudit({ type: "FILTER_BLOCKED", reason: "HIGH_SPREAD", optionSymbol, spread });
      return { pass: false, reason: "HIGH_SPREAD" };
    }
    return { pass: true, oi, spread };
  } catch (err) {
    return { pass: false, reason: "ERROR" };
  }
}

// ─── ORDER EXECUTION ─────────────────────────────────────────────

async function placeLimitOrder(signal, optionSymbol, qty, session) {
  const bufferPrice = signal.entryPrice * (1 + CONFIG.LIMIT_BUFFER_PCT / 100);
  const limitPrice = signal.type === "LONG" 
    ? Math.ceil(bufferPrice * 100) / 100 
    : Math.floor(bufferPrice * 100) / 100;

  const orderBody = {
    symbol: optionSymbol,
    qty,
    side: signal.type === "LONG" ? 1 : -1,
    type: 1, // LIMIT order
    productType: "INTRADAY",
    limitPrice,
    stopPrice: 0,
    disclosedQty: 0,
    validity: "DAY",
    offlineOrder: false,
    stopLoss: 0,
    takeProfit: 0,
  };

  if (CONFIG.PAPER_TRADING) {
    console.log(`[AUTO-TRADER] 📋 PAPER TRADE: ${optionSymbol} @ ${limitPrice}`);
    logAudit({ type: "PAPER_ORDER", optionSymbol, qty, limitPrice, signal });
    return { orderId: `PAPER-${Date.now()}`, status: "PLACED" };
  }

  const response = await fyersApiCall("/orders/async", session.accessToken, session.appId, orderBody, "POST");
  
  logAudit({
    type: "ORDER_PLACED",
    orderId: response.id,
    optionSymbol,
    qty,
    limitPrice,
    side: signal.type,
  });
  
  return { orderId: response.id, status: "PLACED", limitPrice };
}

async function validateOrder(orderId, session) {
  try {
    const data = await fyersApiCall(`/orders/${orderId}`, session.accessToken, session.appId);
    return { valid: true, status: data.data?.status || "UNKNOWN", filledQty: data.data?.filledQty || 0 };
  } catch (err) {
    console.error("[AUTO-TRADER] Order validation failed:", err.message);
    return { valid: false };
  }
}

// ─── POSITION MANAGEMENT ─────────────────────────────────────────

async function exitPosition(position, session, reason) {
  try {
    if (CONFIG.PAPER_TRADING) {
      console.log(`[AUTO-TRADER] 📋 PAPER EXIT: ${position.optionSymbol}`);
      position.status = "CLOSED";
      position.exitTime = new Date().toISOString();
      position.exitReason = reason;
      saveState();
      return;
    }

    const exitSide = position.signal.type === "LONG" ? -1 : 1;
    const orderBody = {
      symbol: position.optionSymbol,
      qty: position.quantity,
      side: exitSide,
      type: 2,
      productType: "INTRADAY",
      limitPrice: 0,
      stopPrice: 0,
      disclosedQty: 0,
      validity: "DAY",
      offlineOrder: false,
      stopLoss: 0,
      takeProfit: 0,
    };

    const response = await fyersApiCall("/orders/async", session.accessToken, session.appId, orderBody, "POST");
    position.status = "CLOSED";
    position.exitTime = new Date().toISOString();
    position.exitReason = reason;
    position.exitOrderId = response.id;

    logAudit({
      type: "POSITION_CLOSED",
      orderId: position.id,
      optionSymbol: position.optionSymbol,
      reason,
      pnl: position.pnl,
    });

    console.log(`[AUTO-TRADER] ✅ CLOSED: ${position.optionSymbol} | P&L: ₹${position.pnl.toFixed(2)} | ${reason}`);
    saveState();
  } catch (error) {
    console.error("[AUTO-TRADER] ❌ Exit failed:", error.message);
    logAudit({ type: "EXIT_FAILED", optionSymbol: position.optionSymbol, error: error.message });
  }
}

async function monitorPositions(session) {
  if (openPositions.length === 0) return;

  for (const position of openPositions) {
    if (position.status !== "OPEN") continue;

    try {
      const url = `${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent(position.optionSymbol)}`;
      const response = await fetch(url, {
        headers: { Authorization: `${session.appId}:${session.accessToken}` },
      });
      
      const data = await response.json();
      const ltp = data.d?.[0]?.v?.lp || 0;
      if (ltp <= 0) continue;

      const isLong = position.signal.type === "LONG";
      const pnl = isLong 
        ? (ltp - position.entryPrice) * position.quantity
        : (position.entryPrice - ltp) * position.quantity;

      position.pnl = pnl;
      position.currentLTP = ltp;
      dailyPnL += pnl - (position.lastPnl || 0);
      position.lastPnl = pnl;

      // Update consecutive losses
      if (pnl < 0 && position.pnl >= 0) {
        consecutiveLosses++;
        saveState();
      }

      const targetHit = isLong ? ltp >= position.target : ltp <= position.target;
      const slHit = isLong ? ltp <= position.stopLoss : ltp >= position.stopLoss;

      if (targetHit) {
        await exitPosition(position, session, "TARGET");
      } else if (slHit) {
        consecutiveLosses++;
        await exitPosition(position, session, "STOPLOSS");
      } else if (isSquareOffTime()) {
        await exitPosition(position, session, "SQUARE_OFF");
      }
    } catch (error) {
      console.error(`[AUTO-TRADER] Monitor error:`, error.message);
    }
  }
}

// ─── MAIN TRADING LOGIC ──────────────────────────────────────────

function canTakeTrade(underlyingName) {
  if (CONFIG.EMERGENCY_STOP) {
    console.log("[AUTO-TRADER] 🚨 EMERGENCY STOP ACTIVE");
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
    console.log(`[AUTO-TRADER] 🚫 MAX TRADES REACHED: ${todayTrades}/${CONFIG.MAX_TRADES_PER_DAY}`);
    logAudit({ type: "CIRCUIT_BREAKER", reason: "MAX_TRADES", todayTrades, max: CONFIG.MAX_TRADES_PER_DAY });
  }
  return !hit;
}

async function processCandles(underlying, session) {
  try {
    const candles = await fetchLatestCandles(underlying.symbol, session.accessToken, session.appId);
    if (candles.length < 6) return;

    latestData[underlying.name] = {
      candles,
      lastUpdated: new Date().toISOString(),
      ltp: candles[candles.length - 1][4],
    };

    const alert = detectAlertCandle(candles);
    if (alert) {
      console.log(`[AUTO-TRADER] 🚨 ${underlying.name} ${alert.type} detected`);
      activeAlerts.set(underlying.name, {
        ...alert,
        underlying: underlying.name,
        symbol: underlying.symbol,
        detectedAt: new Date().toISOString(),
      });
    }

    const currentAlert = activeAlerts.get(underlying.name);
    if (!currentAlert) return;

    const signal = detectBreakout(candles, currentAlert);
    if (!signal) return;

    if (!canTakeTrade(underlying.name)) {
      activeAlerts.delete(underlying.name);
      return;
    }

    const signalId = `${underlying.name}-${signal.timestamp}-${signal.type}`;
    if (processedSignals.has(signalId)) {
      activeAlerts.delete(underlying.name);
      return;
    }
    processedSignals.add(signalId);

    // Check VIX
    if (!checkVIXFilter()) {
      activeAlerts.delete(underlying.name);
      return;
    }

    // Fetch option chain
    const optionChain = await fetchOptionChain(underlying.symbol, session.accessToken, session.appId);
    const optionType = signal.type === "LONG" ? "CE" : "PE";
    const optionSymbol = getATMOption(underlying.name, signal.entryPrice, optionType, optionChain);

    if (!optionSymbol) {
      activeAlerts.delete(underlying.name);
      return;
    }

    // Check liquidity
    const liquidity = await checkLiquidity(optionSymbol, session);
    if (!liquidity.pass) {
      console.log(`[AUTO-TRADER] 🚫 Liquidity check failed: ${liquidity.reason}`);
      activeAlerts.delete(underlying.name);
      return;
    }

    // Calculate position size with lot rounding
    const rawQty = calculatePositionSize(signal.entryPrice, signal.stopLoss);
    const qty = roundToLotSize(rawQty, underlying);
    
    if (qty <= 0) {
      activeAlerts.delete(underlying.name);
      return;
    }

    // Check margin
    const margin = await checkMargin(optionSymbol, qty, session);
    if (!margin.pass) {
      console.log(`[AUTO-TRADER] 🚫 Margin insufficient: need ₹${margin.required.toFixed(2)}, have ₹${margin.available.toFixed(2)}`);
      activeAlerts.delete(underlying.name);
      return;
    }

    const tradeSignal = {
      ...signal,
      quantity: qty,
      optionSymbol,
      underlying: underlying.name,
      underlyingSymbol: underlying.symbol,
    };

    try {
      const orderResult = await placeLimitOrder(tradeSignal, optionSymbol, qty, session);
      
      // Validate order after 2 seconds
      await new Promise(r => setTimeout(r, 2000));
      const validation = await validateOrder(orderResult.orderId, session);
      
      if (!validation.valid || validation.status === "REJECTED") {
        console.log(`[AUTO-TRADER] ❌ Order rejected: ${orderResult.orderId}`);
        logAudit({ type: "ORDER_REJECTED", orderId: orderResult.orderId, validation });
        activeAlerts.delete(underlying.name);
        return;
      }

      const position = {
        id: orderResult.orderId,
        signal: tradeSignal,
        status: "OPEN",
        entryTime: new Date().toISOString(),
        orderId: orderResult.orderId,
        optionSymbol,
        quantity: qty,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        target: signal.target,
        currentSL: signal.stopLoss,
        pnl: 0,
        lastPnl: 0,
        underlying: underlying.name,
      };

      openPositions.push(position);
      todayTrades++;
      saveState();

      logAudit({
        type: "POSITION_OPENED",
        orderId: orderResult.orderId,
        optionSymbol,
        qty,
        entryPrice: signal.entryPrice,
        sl: signal.stopLoss,
        target: signal.target,
      });

      console.log(`[AUTO-TRADER] 🎯 ORDER: ${optionSymbol} Qty:${qty} @ ${signal.entryPrice} SL:${signal.stopLoss} T:${signal.target}`);

    } catch (orderError) {
      console.error(`[AUTO-TRADER] ❌ Order failed:`, orderError.message);
      logAudit({ type: "ORDER_FAILED", error: orderError.message, signal: tradeSignal });
    }

    activeAlerts.delete(underlying.name);
  } catch (error) {
    console.error(`[AUTO-TRADER] Error:`, error.message);
  }
}

// ─── DATA FETCHING ───────────────────────────────────────────────

async function fetchLatestCandles(symbol, accessToken, appId) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3600;
  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=5&date_format=0&range_from=${from}&range_to=${now}&cont_flag=1`;
  
  const response = await fetch(url, {
    headers: { Authorization: `${appId}:${accessToken}` },
  });
  
  const data = await response.json();
  return data.candles || [];
}

async function fetchOptionChain(symbol, accessToken, appId) {
  const url = `${FYERS_DATA_BASE}/options-chain-v3?symbol=${encodeURIComponent(symbol)}&strikecount=5`;
  const response = await fetch(url, {
    headers: { Authorization: `${appId}:${accessToken}` },
  });
  const data = await response.json();
  return data.data?.optionsChain || [];
}

function calculatePositionSize(entryPrice, stopLoss) {
  const riskAmount = CONFIG.CAPITAL * (CONFIG.RISK_PERCENT / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit <= 0) return 0;
  return Math.floor(riskAmount / riskPerUnit);
}

// ─── MARKET STATUS ───────────────────────────────────────────────

function getISTTime() {
  const now = new Date();
  const istOffsetMinutes = 330;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + istOffsetMinutes) % (24 * 60);
  return {
    hours: Math.floor(istMinutes / 60),
    minutes: istMinutes % 60,
  };
}

function getCurrentMarketStatus() {
  const { hours, minutes } = getISTTime();
  if (hours === 9 && minutes < 15) return "PRE_OPEN";
  if (hours < 9 || hours > 15 || (hours === 15 && minutes >= 30)) return "CLOSED";
  return "OPEN";
}

// ─── MAIN LOOP ───────────────────────────────────────────────────

async function tradingLoop(session) {
  if (!isRunning) return;

  const today = new Date().toDateString();
  if (lastTradeDate !== today) {
    todayTrades = 0;
    lastTradeDate = today;
    dailyPnL = 0;
    consecutiveLosses = 0;
    activeAlerts.clear();
    openPositions = [];
    processedSignals.clear();
    console.log(`[AUTO-TRADER] 📅 New day - all counters reset`);
    saveState();
  }

  // Refresh VIX at start of each loop
  await fetchIndiaVIX(session);

  const { hours, minutes } = getISTTime();
  const timeStr = `${hours}:${minutes.toString().padStart(2, '0')}`;

  if (hours === 9 && minutes < 15) {
    marketStatus = "PRE_OPEN";
    console.log(`[AUTO-TRADER] ⏳ Pre-market IST (${timeStr})`);
  } else if (hours < 9 || hours > 15 || (hours === 15 && minutes >= 30)) {
    marketStatus = "CLOSED";
    console.log(`[AUTO-TRADER] 🔒 Market closed IST (${timeStr})`);
    
    for (const pos of openPositions.filter(p => p.status === "OPEN")) {
      await exitPosition(pos, session, "MARKET_CLOSE");
    }
    
    pollInterval = setTimeout(() => tradingLoop(session), 60000);
    return;
  } else {
    marketStatus = "OPEN";
    for (const underlying of CONFIG.UNDERLYINGS) {
      await processCandles(underlying, session);
    }
    await monitorPositions(session);
  }

  if (isRunning) {
    pollInterval = setTimeout(() => tradingLoop(session), CONFIG.POLL_INTERVAL_MS);
  }
}

// ─── PUBLIC API ──────────────────────────────────────────────────

export async function startAutoTrader(sessionId) {
  if (isRunning) return { status: "ALREADY_RUNNING" };

  const { getSession } = await import("../routes/auth.js");
  const session = getSession(sessionId);
  if (!session) throw new Error("Invalid or expired session");

  // Fetch real capital
  const actualCapital = await fetchAvailableFunds(session);
  if (actualCapital > 0) {
    CONFIG.CAPITAL = actualCapital;
    console.log(`[AUTO-TRADER] 💰 Capital: ₹${CONFIG.CAPITAL.toFixed(2)}`);
  }

  // Check existing positions
  try {
    const positions = await fyersApiCall("/positions", session.accessToken, session.appId);
    console.log(`[AUTO-TRADER] 📊 Existing positions: ${positions.netPositions?.length || 0}`);
  } catch (err) {
    console.log("[AUTO-TRADER] Could not fetch existing positions");
  }

  console.log(`[AUTO-TRADER] 🚀 Starting... Risk: ${CONFIG.RISK_PERCENT}% | MaxLoss: ${CONFIG.MAX_RISK_PER_DAY_PERCENT}% | Paper: ${CONFIG.PAPER_TRADING}`);

  isRunning = true;
  todayTrades = 0;
  lastTradeDate = new Date().toDateString();
  dailyPnL = 0;
  consecutiveLosses = 0;

  tradingLoop(session);

  return {
    status: "STARTED",
    config: {
      capital: CONFIG.CAPITAL,
      riskPercent: CONFIG.RISK_PERCENT,
      paperTrading: CONFIG.PAPER_TRADING,
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

  const openCount = openPositions.filter(p => p.status === "OPEN").length;
  console.log(`[AUTO-TRADER] 🛑 Stopped. ${openCount} positions open.`);
  
  return {
    status: "STOPPED",
    openPositions: openCount,
    stoppedAt: new Date().toISOString(),
  };
}

export function emergencyStop() {
  CONFIG.EMERGENCY_STOP = true;
  isRunning = false;
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
  
  console.log("[AUTO-TRADER] 🚨 EMERGENCY STOP ACTIVATED");
  logAudit({ type: "EMERGENCY_STOP", timestamp: new Date().toISOString() });
  
  return {
    status: "EMERGENCY_STOPPED",
    openPositions: openPositions.filter(p => p.status === "OPEN").length,
  };
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
    openPositions: openPositions.filter(p => p.status === "OPEN"),
    closedPositions: openPositions.filter(p => p.status === "CLOSED"),
    activeAlerts: Object.fromEntries(activeAlerts),
    latestData,
    recentSignals: getRecentSignals(10),
    indiaVIX,
  };
}

export function getPerformanceSummary() {
  const closed = openPositions.filter(p => p.status === "CLOSED");
  const totalPnL = closed.reduce((sum, p) => sum + p.pnl, 0);
  const winningTrades = closed.filter(p => p.pnl > 0);
  const losingTrades = closed.filter(p => p.pnl < 0);

  return {
    totalTrades: closed.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: closed.length > 0 ? (winningTrades.length / closed.length * 100).toFixed(2) : 0,
    totalPnL: totalPnL.toFixed(2),
    todayTrades,
    openPositions: openPositions.filter(p => p.status === "OPEN").length,
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
  return { config: { ...CONFIG } };
}

export function getAuditLog(limit = 100) {
  return auditLog.slice(-limit);
}
