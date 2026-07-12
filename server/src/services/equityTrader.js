/**
 * Equity MIS Trader — EMA5T on volatile cash-equity scrips, intraday (MIS) only.
 *
 * A fully ISOLATED sibling of autoTrader.js (which stays untouched — that bot trades
 * NIFTY/BANKNIFTY/GOLD futures and must never be perturbed by this service): own config, own
 * state file (equity-trade-state.json), own audit log (equity-trade-audit.jsonl), own loop.
 * Shares only stateless modules: orderExecution.js (productType defaults to "INTRADAY" = MIS),
 * emaStrategy.js (the identical EMA5T signal engine + session-gate helpers), instruments.js
 * (NSE session phase), marketHolidays.js, notifier.js. A handful of small pure helpers are
 * COPIED from autoTrader.js rather than imported, because importing that module would drag in
 * its state file load and the rest of the futures bot's module graph.
 *
 * Strategy (validated 2026-07 across ADANIENT/RBLBANK/TMPV/ETERNAL/PAYTM + INDUSINDBK — see
 * memory/research): EMA5T, 60m bars, trend-EMA 12, target 3R, entries 09:15–14:00 IST,
 * square-off 15:10 (deliberately BEFORE the broker's own MIS RMS square-off so we exit, not
 * their algo). Sizing is RISK-based (cash equity has no lots): qty = risk ÷ stop-distance,
 * capped by per-scrip margin × MIS leverage.
 *
 * PAPER-first: CONFIG.PAPER_TRADING defaults true; the live order path is fully wired through
 * orderExecution (INTRADAY product) but flagged verify-before-live (equity intraday statutory
 * rates, broker MIS short availability, RMS square-off timing).
 */

import fs from "fs";
import path from "path";
import {
  placeStopEntry,
  placeStopLossOrder,
  placeMarketExit,
  cancelOrder,
  getOrderDetails,
  ORDER_SIDE,
  isTokenErrorData,
} from "./orderExecution.js";
import { detectAlertCandle, isValidTradingTime, isSquareOffTime } from "./emaStrategy.js";
import { SESSION_PROFILES, computeInstrumentPhase } from "./instruments.js";
import { isInstrumentTradingDay } from "../utils/marketHolidays.js";
import { computeEquityIntradayCosts } from "./equityCosts.js";
import { alertInfo, alertWarn, alertCritical } from "./notifier.js";
import { refreshAccessToken } from "../routes/auth.js";

const FYERS_APP_ID = process.env.FYERS_APP_ID;
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

// ─── CONFIG ───────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // The validated volatile-stock basket. TMPV = the post-demerger ticker carrying the old
  // TATAMOTORS series (TATAMOTORS-EQ no longer exists on FYERS).
  SCRIPS: [
    { name: "ADANIENT", symbol: "NSE:ADANIENT-EQ", enabled: true },
    { name: "RBLBANK", symbol: "NSE:RBLBANK-EQ", enabled: true },
    { name: "TMPV", symbol: "NSE:TMPV-EQ", enabled: true },
    { name: "ETERNAL", symbol: "NSE:ETERNAL-EQ", enabled: true },
    { name: "PAYTM", symbol: "NSE:PAYTM-EQ", enabled: true },
  ],
  PER_SCRIP_CAPITAL: 50000, // ₹ margin ring-fenced per scrip
  RISK_PER_TRADE: 2000, // ₹ risked to the structural stop per trade
  LEVERAGE: 4, // MIS intraday leverage cap (broker-dependent; conservative default)
  TREND_EMA_PERIOD: 12,
  TARGET_MULTIPLIER: 3,
  TIMEFRAME_MINUTES: 60, // the validated timeframe (60m dominated 30m on every name)
  MAX_TRADES_PER_SCRIP_PER_DAY: 3,
  DAILY_LOSS_CAP: 6000, // ₹ global (≈3R): halts new entries AND flattens when breached
  PAPER_TRADING: true, // fail-safe default; flip blocked while running (see updateEquityConfig)
  EMERGENCY_STOP: false,
  POLL_INTERVAL_MS: 30000,
  BROKERAGE_PER_ORDER: 20,
};

// MIS session profile: entries 09:15–14:00 IST, square-off 15:10 — passed to the SAME
// isValidTradingTime/isSquareOffTime helpers the futures bot uses (emaStrategy.js).
export const MIS_PROFILE = {
  sessionStartDecimal: 9.25,
  sessionEndDecimal: 14.0,
  squareOffHour: 15,
  squareOffMinute: 10,
};

const CONFIG_FIELD_MAP = {
  perScripCapital: "PER_SCRIP_CAPITAL",
  riskPerTrade: "RISK_PER_TRADE",
  leverage: "LEVERAGE",
  trendEmaPeriod: "TREND_EMA_PERIOD",
  targetMultiplier: "TARGET_MULTIPLIER",
  maxTradesPerScripPerDay: "MAX_TRADES_PER_SCRIP_PER_DAY",
  dailyLossCap: "DAILY_LOSS_CAP",
  paperTrading: "PAPER_TRADING",
};
const PERSISTED_CONFIG_KEYS = [...Object.values(CONFIG_FIELD_MAP), "SCRIPS"];

const NUMERIC_BOUNDS = {
  perScripCapital: { min: 10000, max: 500000 },
  riskPerTrade: { min: 100, max: 20000 },
  leverage: { min: 1, max: 5 },
  trendEmaPeriod: { min: 5, max: 50, int: true },
  targetMultiplier: { min: 0.5, max: 5 },
  maxTradesPerScripPerDay: { min: 1, max: 10, int: true },
  dailyLossCap: { min: 500, max: 100000 },
};

// ─── STATE ───────────────────────────────────────────────────────────────────────────────
let isRunning = false;
let pollTimer = null;
let currentSession = null;
let marketStatus = "CLOSED";
let openPositions = []; // shape mirrors autoTrader's BotPosition for UI compatibility
let pendingEntries = new Map(); // scripName -> pending entry record
let processedSignals = new Set();
let perScripTrades = {}; // scripName -> count today
let dailyRealizedPnL = 0;
let lastTradeDate = null;
let lastBarTime = {}; // scripName -> epoch sec of last COMPLETED bar acted on
const auditLog = [];

const STATE_FILE = path.join(process.cwd(), "equity-trade-state.json");
const AUDIT_FILE = path.join(process.cwd(), "equity-trade-audit.jsonl");

function logAudit(event) {
  const entry = { ts: new Date().toISOString(), ...event };
  auditLog.push(entry);
  if (auditLog.length > 5000) auditLog.splice(0, auditLog.length - 5000);
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch {
    /* audit must never crash the loop */
  }
}

function saveState() {
  try {
    const config = {};
    for (const key of PERSISTED_CONFIG_KEYS) config[key] = CONFIG[key];
    const state = {
      openPositions,
      pendingEntries: [...pendingEntries.values()],
      processedSignals: [...processedSignals],
      perScripTrades,
      dailyRealizedPnL,
      lastTradeDate,
      config,
    };
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error("[EQUITY-TRADER] saveState failed:", err.message);
  }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    openPositions = Array.isArray(s.openPositions) ? s.openPositions : [];
    pendingEntries = new Map((s.pendingEntries || []).map((p) => [p.scrip, p]));
    processedSignals = new Set(s.processedSignals || []);
    perScripTrades = s.perScripTrades || {};
    dailyRealizedPnL = Number(s.dailyRealizedPnL) || 0;
    lastTradeDate = s.lastTradeDate || null;
    if (s.config) {
      for (const key of PERSISTED_CONFIG_KEYS) {
        if (s.config[key] !== undefined) CONFIG[key] = s.config[key];
      }
    }
  } catch (err) {
    console.error("[EQUITY-TRADER] loadState failed (fresh state):", err.message);
  }
}
loadState();

// ─── SMALL PURE HELPERS (copied from autoTrader.js — see module header for why) ───────────
const getISTTime = () => {
  const now = new Date();
  const istMinutes = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  return { hours: Math.floor(istMinutes / 60), minutes: istMinutes % 60, istMinutes };
};
const getISTDateKey = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

/** LONG/SHORT × ENTRY/EXIT → broker order side (same mapping as autoTrader's futuresOrderSide). */
export function orderSideFor(dir, purpose) {
  if (dir === "LONG") return purpose === "ENTRY" ? ORDER_SIDE.BUY : ORDER_SIDE.SELL;
  if (dir === "SHORT") return purpose === "ENTRY" ? ORDER_SIDE.SELL : ORDER_SIDE.BUY;
  throw new Error(`orderSideFor: unknown direction "${dir}"`);
}

export function computeGapAdjustedTarget(dir, entryFillPrice, stopLoss, targetMultiplier) {
  const risk = Math.abs(entryFillPrice - stopLoss);
  return dir === "LONG" ? entryFillPrice + risk * targetMultiplier : entryFillPrice - risk * targetMultiplier;
}

/** Drop the trailing in-progress candle (rows [timeSec,o,h,l,c,v]) — signals judge CLOSED bars only. */
export function dropInProgressCandle(candles, timeframeMinutes, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(candles) || candles.length === 0) return candles || [];
  const startSec = Number(candles[candles.length - 1]?.[0]) || 0;
  const periodSec = (Number(timeframeMinutes) || 60) * 60;
  if (startSec > 0 && nowSec < startSec + periodSec) return candles.slice(0, -1);
  return candles;
}

/**
 * Paper resting-stop fill check — byte-equivalent semantics to autoTrader's checkEntryOrderFill
 * paper branch (candle-crossing, gap-through at open, 0.05% stop-fill slippage, SL-L limit cap).
 * Pure/exported for unit tests. latestCandle row = [timeSec, open, high, low, close, volume].
 */
export function paperStopFillCheck({ dir, level, limitPrice = 0, latestCandle, qty }) {
  const crossed = dir === "LONG" ? latestCandle[2] >= level : latestCandle[3] <= level;
  if (!crossed) return { status: "PENDING", filledQty: 0 };
  const slip = 0.0005;
  const open = latestCandle[1];
  const gappedThrough = dir === "LONG" ? open >= level : open <= level;
  const fillBase = gappedThrough ? open : level;
  const avgFillPrice = dir === "LONG" ? fillBase * (1 + slip) : fillBase * (1 - slip);
  if (Number(limitPrice) > 0) {
    const exceedsLimit = dir === "LONG" ? avgFillPrice > limitPrice : avgFillPrice < limitPrice;
    if (exceedsLimit) return { status: "PENDING", filledQty: 0 };
  }
  return { status: "FILLED", avgFillPrice, filledQty: qty };
}

/**
 * RISK-based MIS sizing (the whole point of trading cash equity — no lot constraint):
 *   qty = floor(min(riskPerTrade / stopDistance, perScripCapital × leverage / entryPrice))
 * Returns { qty, marginReq, riskAtEntry } — qty 0 means "skip, unsizeable".
 * Pure/exported for unit tests.
 */
export function computeEquityQty({ entryLevel, stopLoss, riskPerTrade, perScripCapital, leverage }) {
  const stopDistance = Math.abs(entryLevel - stopLoss);
  if (!(stopDistance > 0) || !(entryLevel > 0)) return { qty: 0, marginReq: 0, riskAtEntry: 0 };
  const byRisk = Math.floor(riskPerTrade / stopDistance);
  const byMargin = Math.floor((perScripCapital * leverage) / entryLevel);
  const qty = Math.max(0, Math.min(byRisk, byMargin));
  return {
    qty,
    marginReq: (qty * entryLevel) / leverage,
    riskAtEntry: qty * stopDistance,
  };
}

/** Config payload validation (mirrors autoTrader's sanitize pattern). Pure/exported for tests. */
export function sanitizeEquityConfigUpdates(updates) {
  const clean = {};
  const rejected = [];
  for (const [key, value] of Object.entries(updates || {})) {
    if (NUMERIC_BOUNDS[key]) {
      const b = NUMERIC_BOUNDS[key];
      const n = Number(value);
      if (typeof value === "boolean" || !Number.isFinite(n) || n < b.min || n > b.max || (b.int && !Number.isInteger(n))) {
        rejected.push({ key, value });
        continue;
      }
      clean[key] = n;
    } else if (key === "paperTrading") {
      if (typeof value === "boolean") clean[key] = value;
      else rejected.push({ key, value });
    } else if (key === "scripEnabled") {
      // { ADANIENT: true, PAYTM: false, ... } — unknown names dropped.
      if (value && typeof value === "object") {
        const known = {};
        for (const s of CONFIG.SCRIPS) {
          if (typeof value[s.name] === "boolean") known[s.name] = value[s.name];
        }
        if (Object.keys(known).length) clean.scripEnabled = known;
        else rejected.push({ key, value });
      } else rejected.push({ key, value });
    } else {
      clean[key] = value;
    }
  }
  return { clean, rejected };
}

// ─── FYERS DATA (own copy — token-refresh-on-401, template autoTrader.js fyersDataFetch) ──
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
  return data;
}

async function fetchCandles(symbol, session) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 21 * 86400; // 21 calendar days ≈ plenty of 60m bars for EMA(12)+5 warmup
  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=${CONFIG.TIMEFRAME_MINUTES}&date_format=0&range_from=${from}&range_to=${now}&cont_flag=1`;
  const data = await fyersDataFetch(url, session);
  if (data.s !== "ok") throw new Error(data.message || "history fetch failed");
  return dropInProgressCandle(data.candles || [], CONFIG.TIMEFRAME_MINUTES);
}

async function fetchQuote(symbol, session) {
  const data = await fyersDataFetch(`${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent(symbol)}`, session);
  return Number(data.d?.[0]?.v?.lp) || 0;
}

// ─── GATES ─────────────────────────────────────────────────────────────────────────────
function committedMarginFor(scripName) {
  let total = 0;
  for (const p of openPositions) {
    if (p.status === "OPEN" && p.underlying === scripName) total += p.marginAtEntry || 0;
  }
  const pend = pendingEntries.get(scripName);
  if (pend && pend.entryOrderId) total += pend.marginEst || 0;
  return total;
}

function canEnter(scripName) {
  if (CONFIG.EMERGENCY_STOP) return { ok: false, reason: "EMERGENCY_STOP" };
  if (!isValidTradingTime(MIS_PROFILE)) return { ok: false, reason: "OUTSIDE_ENTRY_WINDOW" };
  if ((perScripTrades[scripName] || 0) >= CONFIG.MAX_TRADES_PER_SCRIP_PER_DAY) return { ok: false, reason: "MAX_TRADES_SCRIP" };
  if (dailyRealizedPnL <= -CONFIG.DAILY_LOSS_CAP) return { ok: false, reason: "DAILY_LOSS_CAP" };
  if (openPositions.some((p) => p.status === "OPEN" && p.underlying === scripName)) return { ok: false, reason: "POSITION_OPEN" };
  return { ok: true };
}

// ─── POSITION LIFECYCLE ───────────────────────────────────────────────────────────────────
async function closePosition(position, session, reason) {
  if (position.status !== "OPEN") return;
  const paper = CONFIG.PAPER_TRADING;
  let exitPrice = position.currentLTP || position.avgFillPrice;
  try {
    if (!paper) {
      // Live: cancel the resting SL first (never leave a naked SL working after a market exit),
      // then market-exit MIS. TODO(verify-before-live): equity MIS short-cover behavior + fills.
      if (position.slOrderId) {
        try {
          await cancelOrder(position.slOrderId, session, logAudit);
        } catch (err) {
          logAudit({ type: "EQ_SL_CANCEL_FAILED", id: position.id, error: err.message });
        }
      }
      const order = await placeMarketExit({
        symbol: position.optionSymbol,
        qty: position.quantity,
        side: orderSideFor(position.side, "EXIT"),
        session,
        paperTrading: false,
        auditLogger: logAudit,
      });
      logAudit({ type: "EQ_EXIT_ORDER_PLACED", id: position.id, orderId: order.orderId, reason });
    }
  } catch (err) {
    console.error(`[EQUITY-TRADER] Exit order failed for ${position.optionSymbol}:`, err.message);
    logAudit({ type: "EQ_EXIT_ORDER_FAILED", id: position.id, error: err.message, reason });
    alertCritical("EQ_EXIT_FAILED", `Equity exit failed for ${position.optionSymbol}: ${err.message}`, { reason });
    return; // keep the position OPEN so the next cycle retries
  }

  const dirMult = position.side === "SHORT" ? -1 : 1;
  const gross = (exitPrice - position.avgFillPrice) * position.quantity * dirMult;
  const costs = computeEquityIntradayCosts(position.avgFillPrice, exitPrice, position.quantity, {
    brokeragePerOrder: CONFIG.BROKERAGE_PER_ORDER,
    side: position.side,
  });
  const pnl = gross - costs;
  position.status = "CLOSED";
  position.exitPrice = exitPrice;
  position.exitTime = new Date().toISOString();
  position.exitReason = reason;
  position.realizedPnl = pnl;
  position.pnl = pnl;
  dailyRealizedPnL += pnl;
  saveState();
  logAudit({ type: "EQ_POSITION_CLOSED", id: position.id, scrip: position.underlying, reason, exitPrice, gross, costs, pnl });
  alertInfo("EQ_POSITION_CLOSED", `${position.underlying} ${position.side} closed (${reason}) P&L ₹${pnl.toFixed(0)}`, { paper });
}

function openPositionFromFill(scrip, pend, fill) {
  const qty = Math.min(fill.filledQty || pend.qty, pend.qty);
  const entryFillPrice = fill.avgFillPrice || pend.level;
  const target = computeGapAdjustedTarget(pend.dir, entryFillPrice, pend.stopLoss, CONFIG.TARGET_MULTIPLIER);
  const position = {
    id: `${CONFIG.PAPER_TRADING ? "PAPER-" : ""}EQ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    entryOrderId: pend.entryOrderId,
    slOrderId: null,
    marginAtEntry: pend.marginEst,
    kind: "EQ_MIS",
    side: pend.dir,
    optionSymbol: scrip.symbol, // field name kept for UI-table compatibility with BotPosition
    quantity: qty,
    entryQty: qty,
    origEntryQty: qty,
    avgFillPrice: entryFillPrice,
    entryPrice: pend.level,
    stopLoss: pend.stopLoss,
    currentSL: pend.stopLoss,
    target,
    currentLTP: entryFillPrice,
    unrealizedPnl: 0,
    realizedPnl: 0,
    status: "OPEN",
    entryTime: new Date().toISOString(),
    underlying: scrip.name,
    signal: {
      type: pend.dir === "LONG" ? "BULLISH" : "BEARISH",
      strategy: "EMA5T",
      timeframe: CONFIG.TIMEFRAME_MINUTES,
      entryPrice: pend.level,
      stopLoss: pend.stopLoss,
      target,
      underlying: scrip.name,
    },
  };
  openPositions.push(position);
  perScripTrades[scrip.name] = (perScripTrades[scrip.name] || 0) + 1;
  logAudit({ type: "EQ_POSITION_OPENED", id: position.id, scrip: scrip.name, dir: pend.dir, qty, entryFillPrice, stopLoss: pend.stopLoss, target });
  alertInfo("EQ_POSITION_OPENED", `${scrip.name} ${pend.dir} x${qty} @ ${entryFillPrice.toFixed(2)} (SL ${pend.stopLoss}, T ${target.toFixed(2)})`, { paper: CONFIG.PAPER_TRADING });
  return position;
}

async function ensureLiveStopLoss(position, session) {
  if (CONFIG.PAPER_TRADING || position.slOrderId || position.status !== "OPEN") return;
  try {
    const order = await placeStopLossOrder({
      symbol: position.optionSymbol,
      qty: position.quantity,
      stopPrice: position.currentSL,
      side: orderSideFor(position.side, "EXIT"),
      session,
      paperTrading: false,
      auditLogger: logAudit,
    });
    position.slOrderId = order.orderId;
    saveState();
    logAudit({ type: "EQ_SL_PLACED", id: position.id, slOrderId: order.orderId, stopPrice: position.currentSL });
  } catch (err) {
    logAudit({ type: "EQ_SL_PLACE_FAILED", id: position.id, error: err.message });
    alertCritical("EQ_SL_MISSING", `Equity SL placement failed for ${position.optionSymbol} — position is naked, will retry`, {});
  }
}

// ─── PER-SCRIP SCAN (runs only when a NEW completed 60m bar exists) ────────────────────────
async function processScrip(scrip, session) {
  const candles = await fetchCandles(scrip.symbol, session);
  if (candles.length < CONFIG.TREND_EMA_PERIOD + 2) return;
  const latest = candles[candles.length - 1];
  if (lastBarTime[scrip.name] === latest[0]) return; // no new completed bar — nothing to do
  lastBarTime[scrip.name] = latest[0];

  // Step 1: resolve any existing pending entry BEFORE considering a new alert (fill must never
  // be lost to a same-cycle overwrite — same ordering rule as the futures bot).
  const pend = pendingEntries.get(scrip.name);
  if (pend) {
    let fill;
    if (CONFIG.PAPER_TRADING) {
      fill = pend.entryOrderId
        ? paperStopFillCheck({ dir: pend.dir, level: pend.level, limitPrice: 0, latestCandle: latest, qty: pend.qty })
        : { status: "PENDING", filledQty: 0 };
    } else {
      fill = pend.entryOrderId ? await getOrderDetails(pend.entryOrderId, session) : { status: "PENDING", filledQty: 0 };
    }
    const filledQty = Number(fill.filledQty) || 0;
    if (fill.status === "FILLED" || (fill.status === "PENDING" && filledQty > 0)) {
      const signalId = `${scrip.name}-${pend.alertTimestamp}-${pend.dir}`;
      if (!processedSignals.has(signalId)) {
        processedSignals.add(signalId);
        pendingEntries.delete(scrip.name);
        const position = openPositionFromFill(scrip, pend, fill);
        await ensureLiveStopLoss(position, session);
        saveState();
      } else {
        pendingEntries.delete(scrip.name);
        saveState();
      }
    } else if (["REJECTED", "CANCELLED", "EXPIRED"].includes(fill.status)) {
      logAudit({ type: "EQ_ENTRY_ORDER_FAILED", scrip: scrip.name, status: fill.status });
      pendingEntries.delete(scrip.name);
      saveState();
    } else {
      // Still resting — re-validate the gates; cancel if no longer valid (time window, caps).
      const gate = canEnter(scrip.name);
      if (!gate.ok) {
        if (!CONFIG.PAPER_TRADING && pend.entryOrderId) {
          try {
            await cancelOrder(pend.entryOrderId, session, logAudit);
          } catch {
            return; // couldn't confirm the cancel — keep tracking, retry next bar
          }
        }
        pendingEntries.delete(scrip.name);
        saveState();
        logAudit({ type: "EQ_PENDING_CANCELLED", scrip: scrip.name, reason: gate.reason });
      }
    }
  }

  // Step 2: detect a fresh alert on the completed bars and arm/refresh the resting entry.
  const alert = detectAlertCandle(candles, "EMA5T", CONFIG.TREND_EMA_PERIOD);
  if (!alert) return;
  const dir = alert.type === "BULLISH_ALERT" ? "LONG" : "SHORT";
  const level = dir === "LONG" ? alert.high : alert.low;
  const stopLoss = dir === "LONG" ? alert.low : alert.high;
  const signalId = `${scrip.name}-${alert.timestamp}-${dir}`;
  if (processedSignals.has(signalId)) return;

  const existing = pendingEntries.get(scrip.name);
  if (existing && existing.alertTimestamp === alert.timestamp && existing.dir === dir) return; // unchanged

  const gate = canEnter(scrip.name);
  const { qty, marginReq, riskAtEntry } = computeEquityQty({
    entryLevel: level,
    stopLoss,
    riskPerTrade: CONFIG.RISK_PER_TRADE,
    perScripCapital: CONFIG.PER_SCRIP_CAPITAL,
    leverage: CONFIG.LEVERAGE,
  });
  const marginOk = committedMarginFor(scrip.name) + marginReq <= CONFIG.PER_SCRIP_CAPITAL;

  // Replace a stale pending (older alert) — cancel its live order first.
  if (existing) {
    if (!CONFIG.PAPER_TRADING && existing.entryOrderId) {
      try {
        await cancelOrder(existing.entryOrderId, session, logAudit);
      } catch {
        return; // can't confirm old order gone — don't double-arm
      }
    }
    pendingEntries.delete(scrip.name);
  }

  let entryOrderId = null;
  if (gate.ok && qty >= 1 && marginOk) {
    if (CONFIG.PAPER_TRADING) {
      entryOrderId = `PAPER-EQSTOP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    } else {
      try {
        const order = await placeStopEntry({
          symbol: scrip.symbol,
          qty,
          side: orderSideFor(dir, "ENTRY"),
          stopPrice: level,
          limitPrice: 0, // SL-M; equity tick ₹0.05 — no SL-L in v1
          session,
          paperTrading: false,
          auditLogger: logAudit,
        });
        entryOrderId = order.orderId;
      } catch (err) {
        logAudit({ type: "EQ_ENTRY_ORDER_PLACE_FAILED", scrip: scrip.name, error: err.message });
      }
    }
  }
  pendingEntries.set(scrip.name, {
    scrip: scrip.name,
    symbol: scrip.symbol,
    dir,
    level,
    stopLoss,
    qty,
    marginEst: marginReq,
    riskAtEntry,
    alertTimestamp: alert.timestamp,
    createdAt: new Date().toISOString(),
    entryOrderId,
    skippedReason: entryOrderId ? null : (gate.ok ? (qty < 1 ? "QTY_ZERO" : marginOk ? "ORDER_FAILED" : "MARGIN") : gate.reason),
  });
  saveState();
  logAudit({ type: "EQ_ENTRY_ARMED", scrip: scrip.name, dir, level, stopLoss, qty, entryOrderId, skipped: entryOrderId ? null : true });
}

// ─── MONITOR (every cycle, quote-driven — SL / target / square-off) ───────────────────────
async function monitorPositions(session) {
  for (const position of openPositions) {
    if (position.status !== "OPEN") continue;
    try {
      const ltp = await fetchQuote(position.optionSymbol, session);
      if (!(ltp > 0)) continue;
      position.currentLTP = ltp;
      const dirMult = position.side === "SHORT" ? -1 : 1;
      position.unrealizedPnl = (ltp - position.avgFillPrice) * position.quantity * dirMult;
      const slHit = dirMult === 1 ? ltp <= position.currentSL : ltp >= position.currentSL;
      const targetHit = dirMult === 1 ? ltp >= position.target : ltp <= position.target;
      if (slHit) await closePosition(position, session, "STOPLOSS");
      else if (targetHit) await closePosition(position, session, "TARGET");
      else if (isSquareOffTime(MIS_PROFILE)) await closePosition(position, session, "SQUARE_OFF");
      else await ensureLiveStopLoss(position, session); // self-heal a missing live SL
    } catch (err) {
      console.error(`[EQUITY-TRADER] monitor error (${position.optionSymbol}):`, err.message);
    }
  }
  // Daily-loss breaker must also FLATTEN, not just block entries (same C7 rule as the bot).
  const stillOpen = openPositions.filter((p) => p.status === "OPEN");
  if (stillOpen.length > 0 && dailyRealizedPnL <= -CONFIG.DAILY_LOSS_CAP) {
    alertWarn("EQ_DAILY_LOSS_CAP", `Equity daily loss cap breached (₹${dailyRealizedPnL.toFixed(0)}) — flattening`, {});
    for (const pos of stillOpen) {
      try {
        await closePosition(pos, session, "DAILY_LOSS_LIMIT");
      } catch (err) {
        console.error("[EQUITY-TRADER] daily-loss flatten failed:", err.message);
      }
    }
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────────────────
function resetDailyCounters(today) {
  lastTradeDate = today;
  perScripTrades = {};
  dailyRealizedPnL = 0;
  processedSignals = new Set();
  pendingEntries = new Map(); // resting MIS entries never carry across days
  lastBarTime = {};
  openPositions = openPositions.filter((p) => p.status === "OPEN"); // drop yesterday's closed records
}

async function loop(session) {
  if (!isRunning) return;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  let rescheduleMs = CONFIG.POLL_INTERVAL_MS;
  try {
    const today = getISTDateKey();
    if (lastTradeDate !== today) {
      resetDailyCounters(today);
      saveState();
      console.log("[EQUITY-TRADER] New day — counters reset");
    }
    const { istMinutes } = getISTTime();
    const phase = computeInstrumentPhase(SESSION_PROFILES.NSE_INDEX, {
      istMinutes,
      isTradingDay: isInstrumentTradingDay("NSE"),
    });
    marketStatus = phase;
    if (phase !== "OPEN") {
      // Session over: force-close any straggler (MIS positions must never survive the day).
      for (const pos of openPositions.filter((p) => p.status === "OPEN")) {
        try {
          await closePosition(pos, session, "MARKET_CLOSE");
        } catch (err) {
          console.error("[EQUITY-TRADER] market-close exit failed:", err.message);
        }
      }
      rescheduleMs = 60000;
    } else {
      for (const scrip of CONFIG.SCRIPS.filter((s) => s.enabled)) {
        try {
          await processScrip(scrip, session);
        } catch (err) {
          console.error(`[EQUITY-TRADER] scan error (${scrip.name}):`, err.message);
        }
      }
      await monitorPositions(session);
    }
  } catch (err) {
    console.error("[EQUITY-TRADER] loop cycle error:", err.message);
    logAudit({ type: "EQ_LOOP_ERROR", error: err.message });
  } finally {
    if (isRunning) {
      pollTimer = setTimeout(() => loop(session), rescheduleMs);
    }
  }
}

// ─── PUBLIC API (mirrors autoTrader's shape for the routes/UI) ─────────────────────────────
export async function startEquityTrader(sessionId) {
  if (isRunning) return { status: "ALREADY_RUNNING" };
  isRunning = true;
  try {
    const { getSession } = await import("../routes/auth.js");
    const session = getSession(sessionId);
    if (!session) throw new Error("Invalid or expired session");
    currentSession = session;
    console.log(
      `[EQUITY-TRADER] Starting… scrips: ${CONFIG.SCRIPS.filter((s) => s.enabled).map((s) => s.name).join(",")} | ` +
        `₹${CONFIG.PER_SCRIP_CAPITAL}/scrip @${CONFIG.LEVERAGE}x | risk ₹${CONFIG.RISK_PER_TRADE}/trade | ` +
        `${CONFIG.TIMEFRAME_MINUTES}m | paper: ${CONFIG.PAPER_TRADING}`
    );
    logAudit({ type: "EQ_STARTED", paper: CONFIG.PAPER_TRADING });
    loop(session);
    return { status: "STARTED", paperTrading: CONFIG.PAPER_TRADING };
  } catch (err) {
    isRunning = false;
    throw err;
  }
}

export function stopEquityTrader() {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logAudit({ type: "EQ_STOPPED" });
  return { status: "STOPPED" };
}

export function getEquityStatus() {
  return {
    isRunning,
    marketStatus,
    paperTrading: CONFIG.PAPER_TRADING,
    emergencyStop: CONFIG.EMERGENCY_STOP,
    scrips: CONFIG.SCRIPS.map((s) => ({ ...s, tradesToday: perScripTrades[s.name] || 0, committedMargin: committedMarginFor(s.name) })),
    perScripCapital: CONFIG.PER_SCRIP_CAPITAL,
    riskPerTrade: CONFIG.RISK_PER_TRADE,
    leverage: CONFIG.LEVERAGE,
    trendEmaPeriod: CONFIG.TREND_EMA_PERIOD,
    targetMultiplier: CONFIG.TARGET_MULTIPLIER,
    timeframeMinutes: CONFIG.TIMEFRAME_MINUTES,
    maxTradesPerScripPerDay: CONFIG.MAX_TRADES_PER_SCRIP_PER_DAY,
    dailyLossCap: CONFIG.DAILY_LOSS_CAP,
    dailyRealizedPnL: dailyRealizedPnL.toFixed(2),
    openPositions: openPositions.filter((p) => p.status === "OPEN"),
    closedPositions: openPositions.filter((p) => p.status === "CLOSED"),
    pendingEntries: [...pendingEntries.values()],
    misWindow: { entries: "09:15–14:00 IST", squareOff: "15:10 IST" },
  };
}

export function updateEquityConfig(updates) {
  const { clean, rejected } = sanitizeEquityConfigUpdates(updates);
  if (rejected.length) logAudit({ type: "EQ_CONFIG_REJECTED", fields: rejected });
  // Never flip paper/live while running (same guard as the futures bot).
  if (clean.paperTrading !== undefined && isRunning && clean.paperTrading !== CONFIG.PAPER_TRADING) {
    logAudit({ type: "EQ_MODE_CHANGE_BLOCKED", requested: clean.paperTrading });
    delete clean.paperTrading;
  }
  if (clean.scripEnabled) {
    for (const s of CONFIG.SCRIPS) {
      if (clean.scripEnabled[s.name] !== undefined) s.enabled = clean.scripEnabled[s.name];
    }
    delete clean.scripEnabled;
  }
  for (const [incoming, target] of Object.entries(CONFIG_FIELD_MAP)) {
    if (clean[incoming] !== undefined) CONFIG[target] = clean[incoming];
  }
  saveState();
  return { config: getEquityStatus() };
}

export function setEquityEmergencyStop(value) {
  CONFIG.EMERGENCY_STOP = value === true;
  logAudit({ type: "EQ_EMERGENCY_STOP", value: CONFIG.EMERGENCY_STOP });
  return { emergencyStop: CONFIG.EMERGENCY_STOP };
}

export function setEquityPaperTrading(value) {
  if (typeof value !== "boolean") return { paperTrading: CONFIG.PAPER_TRADING, blocked: true };
  if (isRunning && value !== CONFIG.PAPER_TRADING) {
    logAudit({ type: "EQ_MODE_CHANGE_BLOCKED", requested: value });
    return { paperTrading: CONFIG.PAPER_TRADING, blocked: true };
  }
  CONFIG.PAPER_TRADING = value;
  saveState();
  return { paperTrading: CONFIG.PAPER_TRADING };
}

export function getEquityAuditLog(limit = 100) {
  return auditLog.slice(-limit);
}
