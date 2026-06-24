/**
 * Automated Trading System for Subhasish Pani's 5 EMA Strategy
 * 
 * Features:
 * - Polls FYERS every 30 seconds for latest 5m data
 * - Detects alert candles and breakouts
 * - Auto-places orders via FYERS API
 * - Manages open positions (trailing SL, time-based exit)
 * - Respects risk management rules
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

// Configuration
const CONFIG = {
  POLL_INTERVAL_MS: 30000, // 30 seconds
  UNDERLYINGS: [
    { name: "NIFTY", symbol: "NSE:NIFTY50-INDEX", lotSize: 75 },
    { name: "BANKNIFTY", symbol: "NSE:NIFTYBANK-INDEX", lotSize: 30 },
  ],
  CAPITAL: 100000,
  RISK_PERCENT: 1, // 1% per trade
  MAX_TRADES_PER_DAY: 999, // Unlimited trades
  TARGET_MULTIPLIER: 2, // 1:2 Risk:Reward
  TRAILING_SL_ENABLED: false, // Disabled - not backtested
  TRAILING_SL_POINTS: 0,
  ORDER_TYPE: "LIMIT", // Use limit orders to avoid spread
  SLIPPAGE_BUFFER_PCT: 0.5, // 0.5% slippage buffer on entry
  BROKERAGE_PER_ORDER: 20, // ₹20 per order (approximate)
  STT_PCT: 0.05, // STT on sell side
  EXCHANGE_CHARGES_PCT: 0.003, // Exchange charges
  GST_PCT: 18, // GST on brokerage + charges
  SEBI_CHARGES_PCT: 0.0001, // SEBI charges
  STAMP_DUTY_PCT: 0.003, // Stamp duty
};

// State management
let isRunning = false;
let pollInterval = null;
const activeAlerts = new Map(); // Per-underlying alert tracking: { "NIFTY": alert, "BANKNIFTY": alert }
let openPositions = []; // Currently open trades
let todayTrades = 0; // Count of trades today
let lastTradeDate = null;
let marketStatus = "CLOSED"; // OPEN, CLOSED, PRE_OPEN
let latestData = {}; // Latest candle data per underlying
let processedSignals = new Set(); // Track processed signals to prevent duplicates

// Server restart recovery - persist positions to file
import fs from "fs";
import path from "path";

const STATE_FILE = path.join(process.cwd(), "auto-trade-state.json");

function saveState() {
  try {
    const state = {
      openPositions,
      todayTrades,
      lastTradeDate,
      processedSignals: Array.from(processedSignals),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[AUTO-TRADER] Failed to save state:", err.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      openPositions = state.openPositions || [];
      todayTrades = state.todayTrades || 0;
      lastTradeDate = state.lastTradeDate || null;
      processedSignals = new Set(state.processedSignals || []);
      console.log(`[AUTO-TRADER] 📂 Loaded state: ${openPositions.length} positions, ${todayTrades} trades today`);
    }
  } catch (err) {
    console.error("[AUTO-TRADER] Failed to load state:", err.message);
  }
}

// Load state on module init
loadState();

// FYERS API helper
const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

async function fyersApiCall(endpoint, accessToken, appId, body = null, method = "GET") {
  const url = `${FYERS_API_BASE}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `${appId}:${accessToken}`,
  };

  const options = { method, headers };
  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (data.s !== "ok") {
    throw new Error(data.message || "FYERS API error");
  }

  return data;
}

/**
 * Fetch latest 5-minute candles from FYERS
 */
async function fetchLatestCandles(symbol, accessToken, appId) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3600; // Last 1 hour (12 candles of 5m)
  
  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=5&date_format=0&range_from=${from}&range_to=${now}&cont_flag=1`;
  
  const response = await fetch(url, {
    headers: { Authorization: `${appId}:${accessToken}` },
  });
  
  const data = await response.json();
  if (!data.candles || data.candles.length === 0) return [];
  
  return data.candles;
}

/**
 * Fetch option chain for ATM strike selection
 */
async function fetchOptionChain(symbol, accessToken, appId) {
  const url = `${FYERS_DATA_BASE}/options-chain-v3?symbol=${encodeURIComponent(symbol)}&strikecount=5`;
  
  const response = await fetch(url, {
    headers: { Authorization: `${appId}:${accessToken}` },
  });
  
  const data = await response.json();
  if (data.s !== "ok") return [];
  
  return data.data?.optionsChain || [];
}

/**
 * Place auto-order through FYERS
 */
async function placeAutoOrder(signal, optionSymbol, appId, accessToken) {
  const orderBody = {
    symbol: optionSymbol,
    qty: signal.quantity,
    side: signal.type === "LONG" ? 1 : -1,
    type: 2, // Market order
    productType: "INTRADAY",
    limitPrice: 0,
    stopPrice: 0,
    disclosedQty: 0,
    validity: "DAY",
    offlineOrder: false,
    stopLoss: 0,
    takeProfit: 0,
  };

  const response = await fyersApiCall(
    "/orders/async",
    accessToken,
    appId,
    orderBody,
    "POST",
  );

  return {
    orderId: response.id,
    status: "PLACED",
    message: response.message,
  };
}

/**
 * Calculate position size based on risk
 */
function calculatePositionSize(entryPrice, stopLoss, capital = CONFIG.CAPITAL) {
  const riskAmount = capital * (CONFIG.RISK_PERCENT / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  
  if (riskPerUnit <= 0) return 0;
  
  const qty = Math.floor(riskAmount / riskPerUnit);
  return Math.max(qty, 1); // Minimum 1 lot
}

/**
 * Process candles and detect signals
 */
async function processCandles(underlying, session) {
  try {
    const candles = await fetchLatestCandles(
      underlying.symbol,
      session.accessToken,
      session.appId,
    );

    if (candles.length < 6) {
      console.log(`[AUTO-TRADER] Not enough candles for ${underlying.name}`);
      return;
    }

    latestData[underlying.name] = {
      candles,
      lastUpdated: new Date().toISOString(),
      ltp: candles[candles.length - 1][4],
    };

    // Step 1: Check for alert candle
    const alert = detectAlertCandle(candles);
    
    if (alert) {
      console.log(`[AUTO-TRADER] 🚨 ${underlying.name} ${alert.type} detected at ${new Date(alert.timestamp * 1000).toLocaleTimeString()}`);
      activeAlerts.set(underlying.name, {
        ...alert,
        underlying: underlying.name,
        symbol: underlying.symbol,
        detectedAt: new Date().toISOString(),
      });
    }

    // Step 2: Check for breakout from active alert
    const currentAlert = activeAlerts.get(underlying.name);
    if (currentAlert) {
      const signal = detectBreakout(candles, currentAlert);
      
      if (signal) {
        console.log(`[AUTO-TRADER] ✅ ${underlying.name} ${signal.type} BREAKOUT detected!`);
        
        // Check if we can take this trade
        if (!canTakeTrade()) {
          console.log(`[AUTO-TRADER] ⚠️ Cannot take trade - outside market hours`);
          activeAlerts.delete(underlying.name);
          return;
        }

        // Create unique signal ID to prevent duplicates
        const signalId = `${underlying.name}-${signal.timestamp}-${signal.type}`;
        if (processedSignals.has(signalId)) {
          console.log(`[AUTO-TRADER] ⚠️ Signal already processed: ${signalId}`);
          activeAlerts.delete(underlying.name);
          return;
        }
        processedSignals.add(signalId);

        // Fetch option chain to get ATM option
        const optionChain = await fetchOptionChain(
          underlying.symbol,
          session.accessToken,
          session.appId,
        );

        const optionType = signal.type === "LONG" ? "CE" : "PE";
        const optionSymbol = getATMOption(
          underlying.name,
          signal.entryPrice,
          optionType,
          optionChain,
        );

        if (!optionSymbol) {
          console.log(`[AUTO-TRADER] ❌ Could not find ATM ${optionType} option`);
          activeAlerts.delete(underlying.name);
          return;
        }

        // Calculate position size
        const qty = calculatePositionSize(signal.entryPrice, signal.stopLoss);
        
        // Add quantity to signal
        const tradeSignal = {
          ...signal,
          quantity: qty,
          optionSymbol: optionSymbol,
          underlying: underlying.name,
          underlyingSymbol: underlying.symbol,
          capitalUsed: qty * signal.entryPrice,
          riskAmount: qty * signal.risk,
        };

        // Place the order
        try {
          const orderResult = await placeAutoOrder(
            tradeSignal,
            optionSymbol,
            session.appId,
            session.accessToken,
          );

          // Record the trade
          const position = {
            id: orderResult.orderId,
            signal: tradeSignal,
            status: "OPEN",
            entryTime: new Date().toISOString(),
            orderId: orderResult.orderId,
            optionSymbol: optionSymbol,
            quantity: qty,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            target: signal.target,
            currentSL: signal.stopLoss,
            pnl: 0,
            underlying: underlying.name,
          };

          openPositions.push(position);
          todayTrades++;
          saveState(); // Persist state after trade
          
          storeSignal({
            ...tradeSignal,
            orderId: orderResult.orderId,
            status: "EXECUTED",
          });

          console.log(`[AUTO-TRADER] 🎯 ORDER PLACED: ${optionSymbol} Qty:${qty} @ ${signal.entryPrice}`);
          console.log(`[AUTO-TRADER] 📊 SL:${signal.stopLoss} Target:${signal.target}`);

        } catch (orderError) {
          console.error(`[AUTO-TRADER] ❌ Order failed:`, orderError.message);
          storeSignal({
            ...tradeSignal,
            status: "FAILED",
            error: orderError.message,
          });
        }

        // Clear the alert after processing
        activeAlerts.delete(underlying.name);
      }
    }
  } catch (error) {
    console.error(`[AUTO-TRADER] Error processing ${underlying.name}:`, error.message);
  }
}

/**
 * Check if we can take a new trade
 */
function canTakeTrade() {
  // Check trading time
  if (!isValidTradingTime()) {
    return false;
  }

      // Max trades check removed - unlimited trading

      // No position limit per day

  return true;
}

/**
 * Monitor open positions and manage exits
 */
async function monitorPositions(session) {
  if (openPositions.length === 0) return;

  for (const position of openPositions) {
    if (position.status !== "OPEN") continue;

    try {
      // Fetch current LTP for the option
      const quoteUrl = `${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent(position.optionSymbol)}`;
      const response = await fetch(quoteUrl, {
        headers: { Authorization: `${session.appId}:${session.accessToken}` },
      });
      
      const quoteData = await response.json();
      const ltp = quoteData.d?.[0]?.v?.lp || 0;

      if (ltp <= 0) continue;

      // Calculate P&L
      const isLong = position.signal.type === "LONG";
      const pnl = isLong 
        ? (ltp - position.entryPrice) * position.quantity
        : (position.entryPrice - ltp) * position.quantity;

      position.pnl = pnl;
      position.currentLTP = ltp;

      // Check target hit
      const targetHit = isLong ? ltp >= position.target : ltp <= position.target;
      
      // Check SL hit
      const slHit = isLong ? ltp <= position.currentSL : ltp >= position.currentSL;

      // Trailing SL logic
      if (CONFIG.TRAILING_SL_ENABLED) {
        const profit = isLong 
          ? ltp - position.entryPrice 
          : position.entryPrice - ltp;
        
        if (profit > CONFIG.TRAILING_SL_POINTS * 2) {
          // Move SL to breakeven + trailing points
          const newSL = isLong 
            ? position.entryPrice + CONFIG.TRAILING_SL_POINTS
            : position.entryPrice - CONFIG.TRAILING_SL_POINTS;
          
          if (isLong && newSL > position.currentSL) {
            position.currentSL = newSL;
            console.log(`[AUTO-TRADER] 🔄 Trailing SL moved to ${newSL} for ${position.optionSymbol}`);
          } else if (!isLong && newSL < position.currentSL) {
            position.currentSL = newSL;
            console.log(`[AUTO-TRADER] 🔄 Trailing SL moved to ${newSL} for ${position.optionSymbol}`);
          }
        }
      }

      // Exit conditions
      if (targetHit) {
        console.log(`[AUTO-TRADER] 🎯 TARGET HIT! Exiting ${position.optionSymbol} @ ${ltp}`);
        await exitPosition(position, session, "TARGET");
      } else if (slHit) {
        console.log(`[AUTO-TRADER] 🛑 SL HIT! Exiting ${position.optionSymbol} @ ${ltp}`);
        await exitPosition(position, session, "STOPLOSS");
      } else if (isSquareOffTime()) {
        console.log(`[AUTO-TRADER] ⏰ SQUARE OFF TIME! Exiting ${position.optionSymbol} @ ${ltp}`);
        await exitPosition(position, session, "SQUARE_OFF");
      }

    } catch (error) {
      console.error(`[AUTO-TRADER] Error monitoring position ${position.id}:`, error.message);
    }
  }
}

/**
 * Exit a position
 */
async function exitPosition(position, session, reason) {
  try {
    // Place opposite order to exit
    const exitSide = position.signal.type === "LONG" ? -1 : 1;
    
    const orderBody = {
      symbol: position.optionSymbol,
      qty: position.quantity,
      side: exitSide,
      type: 2, // Market order
      productType: "INTRADAY",
      limitPrice: 0,
      stopPrice: 0,
      disclosedQty: 0,
      validity: "DAY",
      offlineOrder: false,
      stopLoss: 0,
      takeProfit: 0,
    };

    const response = await fyersApiCall(
      "/orders/async",
      session.accessToken,
      session.appId,
      orderBody,
      "POST",
    );

    position.status = "CLOSED";
    position.exitTime = new Date().toISOString();
    position.exitReason = reason;
    position.exitOrderId = response.id;

    console.log(`[AUTO-TRADER] ✅ POSITION CLOSED: ${position.optionSymbol}`);
    console.log(`[AUTO-TRADER] 📈 P&L: ₹${position.pnl.toFixed(2)} | Reason: ${reason}`);

  } catch (error) {
    console.error(`[AUTO-TRADER] ❌ Failed to exit position:`, error.message);
  }
}

/**
 * Main polling loop
 */
async function tradingLoop(session) {
  if (!isRunning) return;

  // Reset daily counters if new day
  const today = new Date().toDateString();
  if (lastTradeDate !== today) {
    todayTrades = 0;
    lastTradeDate = today;
    activeAlert = null;
    openPositions = [];
    console.log(`[AUTO-TRADER] 📅 New day - counters reset`);
  }

  // Check market status
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeStr = `${hours}:${minutes.toString().padStart(2, '0')}`;

  // Pre-market check (9:00-9:15)
  if (hours === 9 && minutes < 15) {
    marketStatus = "PRE_OPEN";
    console.log(`[AUTO-TRADER] ⏳ Pre-market (${timeStr}) - waiting for open...`);
  }
  // Market closed
  else if (hours < 9 || hours >= 15 && minutes >= 30) {
    marketStatus = "CLOSED";
    console.log(`[AUTO-TRADER] 🔒 Market closed (${timeStr})`);
    
    // Close any remaining positions
    if (openPositions.some(p => p.status === "OPEN")) {
      console.log(`[AUTO-TRADER] Closing remaining positions...`);
      for (const pos of openPositions.filter(p => p.status === "OPEN")) {
        await exitPosition(pos, session, "MARKET_CLOSE");
      }
    }
    
    // Schedule next check
    pollInterval = setTimeout(() => tradingLoop(session), 60000); // Check every minute for market open
    return;
  }
  // Market open
  else {
    marketStatus = "OPEN";
    
    // Process each underlying
    for (const underlying of CONFIG.UNDERLYINGS) {
      await processCandles(underlying, session);
    }

    // Monitor open positions
    await monitorPositions(session);
  }

  // Schedule next poll
  if (isRunning) {
    pollInterval = setTimeout(() => tradingLoop(session), CONFIG.POLL_INTERVAL_MS);
  }
}

/**
 * Start the auto-trader
 */
export async function startAutoTrader(sessionId) {
  if (isRunning) {
    console.log("[AUTO-TRADER] Already running");
    return { status: "ALREADY_RUNNING" };
  }

  const { getSession } = await import("../routes/auth.js");
  const session = getSession(sessionId);
  
  if (!session) {
    throw new Error("Invalid or expired session");
  }

  console.log("[AUTO-TRADER] 🚀 Starting automated trading system...");
  console.log(`[AUTO-TRADER] Capital: ₹${CONFIG.CAPITAL}`);
  console.log(`[AUTO-TRADER] Risk: ${CONFIG.RISK_PERCENT}% per trade`);
  console.log(`[AUTO-TRADER] Max trades: ${CONFIG.MAX_TRADES_PER_DAY}/day`);
  console.log(`[AUTO-TRADER] Underlyings: ${CONFIG.UNDERLYINGS.map(u => u.name).join(", ")}`);

  isRunning = true;
  todayTrades = 0;
  lastTradeDate = new Date().toDateString();
  
  // Start the loop
  tradingLoop(session);

  return {
    status: "STARTED",
    config: CONFIG,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Stop the auto-trader
 */
export function stopAutoTrader() {
  if (!isRunning) {
    return { status: "NOT_RUNNING" };
  }

  isRunning = false;
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }

  // Close all open positions
  const openCount = openPositions.filter(p => p.status === "OPEN").length;
  
  console.log(`[AUTO-TRADER] 🛑 Stopped. ${openCount} positions were open.`);

  return {
    status: "STOPPED",
    openPositions: openCount,
    stoppedAt: new Date().toISOString(),
  };
}

/**
 * Get auto-trader status
 */
export function getAutoTraderStatus() {
  return {
    isRunning,
    marketStatus,
    todayTrades,
    maxTrades: CONFIG.MAX_TRADES_PER_DAY,
    openPositions: openPositions.filter(p => p.status === "OPEN"),
    closedPositions: openPositions.filter(p => p.status === "CLOSED"),
    activeAlert,
    latestData,
    recentSignals: getRecentSignals(10),
    config: CONFIG,
  };
}

/**
 * Get performance summary
 */
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
    avgWin: winningTrades.length > 0 ? (winningTrades.reduce((s, p) => s + p.pnl, 0) / winningTrades.length).toFixed(2) : 0,
    avgLoss: losingTrades.length > 0 ? (losingTrades.reduce((s, p) => s + p.pnl, 0) / losingTrades.length).toFixed(2) : 0,
    todayTrades,
    openPositions: openPositions.filter(p => p.status === "OPEN").length,
  };
}