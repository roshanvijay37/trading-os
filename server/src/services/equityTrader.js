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
 * Strategy (validated 2026-07 across two waves — ADANIENT/RBLBANK/TMPV/ETERNAL/PAYTM, then
 * BSE/ANGELONE/MAZDOCK/POLICYBZR/KAYNES; plus INDUSINDBK standalone = 11/11 names profitable):
 * EMA5T, 60m bars, trend-EMA 12, target 3R, entries 09:15–14:00 IST, square-off 15:15 (the
 * exact engine defaults the backtests simulated — see MIS_PROFILE). Sizing is RISK-based
 * (cash equity has no lots): qty = risk ÷ stop-distance, capped by per-scrip margin × MIS
 * leverage.
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
import { SESSION_PROFILES, computeInstrumentPhase, istDateKey } from "./instruments.js";
import { isInstrumentTradingDay } from "../utils/marketHolidays.js";
import { computeEquityIntradayCosts } from "./equityCosts.js";
import { alertInfo, alertCritical } from "./notifier.js";
import { refreshAccessToken } from "../routes/auth.js";

const FYERS_APP_ID = process.env.FYERS_APP_ID;
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

// ─── CONFIG ───────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // The validated volatile-stock basket. TMPV = the post-demerger ticker carrying the old
  // TATAMOTORS series (TATAMOTORS-EQ no longer exists on FYERS).
  SCRIPS: [
    // Wave 1 (validated 2026-07-10): PF 4–5.4 @60m, every year green.
    { name: "ADANIENT", symbol: "NSE:ADANIENT-EQ", enabled: true },
    { name: "RBLBANK", symbol: "NSE:RBLBANK-EQ", enabled: true },
    { name: "TMPV", symbol: "NSE:TMPV-EQ", enabled: true },
    { name: "ETERNAL", symbol: "NSE:ETERNAL-EQ", enabled: true },
    { name: "PAYTM", symbol: "NSE:PAYTM-EQ", enabled: true },
    // Wave 2 (validated 2026-07-13): PF 6.5–8.9 @60m, every year green. All NSE F&O members
    // and surveillance-clean at add time — but KAYNES/ANGELONE/MAZDOCK have prior ASM history;
    // an ASM re-entry cuts MIS leverage in LIVE (paper unaffected). Vet before real capital.
    { name: "BSE", symbol: "NSE:BSE-EQ", enabled: true },
    { name: "ANGELONE", symbol: "NSE:ANGELONE-EQ", enabled: true },
    { name: "MAZDOCK", symbol: "NSE:MAZDOCK-EQ", enabled: true },
    { name: "POLICYBZR", symbol: "NSE:POLICYBZR-EQ", enabled: true },
    { name: "KAYNES", symbol: "NSE:KAYNES-EQ", enabled: true },
  ],
  PER_SCRIP_CAPITAL: 50000, // ₹ margin ring-fenced per scrip
  RISK_PER_TRADE: 2000, // ₹ risked to the structural stop per trade
  LEVERAGE: 4, // MIS intraday leverage cap (broker-dependent; conservative default)
  TREND_EMA_PERIOD: 12,
  TARGET_MULTIPLIER: 3,
  TIMEFRAME_MINUTES: 60, // the validated timeframe (60m dominated 30m on every name)
  // PARITY RULE (user directive): this service has NOTHING the validated backtests didn't have —
  // no per-day trade-count cap, no automatic daily-loss breaker. Any gate here that the backtest
  // engine's runs never hit would change the live trade sequence vs what was validated. The only
  // kill switches are MANUAL: Emergency Stop (blocks new entries, keeps managing exits) and Stop.
  // perScripTrades / dailyRealizedPnL are display+audit counters only — they gate nothing.
  PAPER_TRADING: true, // fail-safe default; flip blocked while running (see updateEquityConfig)
  EMERGENCY_STOP: false,
  POLL_INTERVAL_MS: 30000,
  BROKERAGE_PER_ORDER: 20,
};

// MIS session profile: entries 09:15–14:00 IST, square-off 15:15 — the EXACT values the
// validated backtests used (engine defaults), passed to the SAME isValidTradingTime/
// isSquareOffTime helpers the futures bot uses (emaStrategy.js).
// TODO(verify-before-live): confirm FYERS's MIS RMS auto-square-off time doesn't race our 15:15
// exit — if the broker flattens at/before 15:15, pull this earlier for LIVE only (paper keeps
// backtest parity either way).
export const MIS_PROFILE = {
  sessionStartDecimal: 9.25,
  sessionEndDecimal: 14.0,
  squareOffHour: 15,
  squareOffMinute: 15,
};

const CONFIG_FIELD_MAP = {
  perScripCapital: "PER_SCRIP_CAPITAL",
  riskPerTrade: "RISK_PER_TRADE",
  leverage: "LEVERAGE",
  trendEmaPeriod: "TREND_EMA_PERIOD",
  targetMultiplier: "TARGET_MULTIPLIER",
  paperTrading: "PAPER_TRADING",
};
const PERSISTED_CONFIG_KEYS = [...Object.values(CONFIG_FIELD_MAP), "SCRIPS"];

const NUMERIC_BOUNDS = {
  perScripCapital: { min: 10000, max: 500000 },
  riskPerTrade: { min: 100, max: 20000 },
  leverage: { min: 1, max: 5 },
  trendEmaPeriod: { min: 5, max: 50, int: true },
  targetMultiplier: { min: 0.5, max: 5 },
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
let lastExitAt = {}; // scripName -> epoch sec of the last position exit (engine dead-alert guard)
let loopGeneration = 0; // stop/start reentrancy guard: only the newest loop chain may reschedule
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
      lastExitAt,
      // Crash forensics: true while the operator has the service started. NOT auto-resumed on
      // boot (surprise trading after a deploy restart would be worse) — index.js raises a
      // critical alert instead so the operator knows the books stopped.
      desiredRunning: isRunning,
      config,
    };
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error("[EQUITY-TRADER] saveState failed:", err.message);
  }
}

// Code defines WHICH scrips exist; saved state only remembers the operator's enable/disable
// choices. Merging (not replacing) lets a deploy extend the basket without an old state file
// silently hiding the new scrips. Exported for tests.
export function mergeSavedScrips(codeScrips, savedScrips) {
  if (!Array.isArray(savedScrips)) return;
  const saved = new Map(
    savedScrips.filter((x) => x && typeof x.name === "string").map((x) => [x.name, x.enabled])
  );
  for (const scrip of codeScrips) {
    if (typeof saved.get(scrip.name) === "boolean") scrip.enabled = saved.get(scrip.name);
  }
}

// True when the state file says the service was running when the process died/restarted —
// surfaced (never auto-resumed) via getWasRunningBeforeBoot for index.js's boot alert.
let wasRunningBeforeBoot = false;
export function getWasRunningBeforeBoot() {
  return wasRunningBeforeBoot;
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
    lastExitAt = s.lastExitAt || {};
    wasRunningBeforeBoot = s.desiredRunning === true;
    if (s.config) {
      for (const key of PERSISTED_CONFIG_KEYS) {
        if (s.config[key] === undefined) continue;
        if (key === "SCRIPS") mergeSavedScrips(CONFIG.SCRIPS, s.config.SCRIPS);
        else CONFIG[key] = s.config[key];
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
 * Paper resting-stop fill check — engine-parity semantics (2026-07-14 audit alignment):
 * STRICT crossing (the validated engine's tryEnterFromAlert enters only on high > level /
 * low < level — backtest.js:494; an exact-touch bar is NOT a fill), gap-through at open uses
 * the engine's INCLUSIVE open >= level (backtest.js:406), and slippage is the engine's default
 * 0.0002 (backtest.js:247 — the constant every validated run used; the old 0.0005 here silently
 * worsened paper fills vs the numbers being validated against). SL-L limit cap unchanged.
 * Pure/exported for unit tests. latestCandle row = [timeSec, open, high, low, close, volume].
 */
export function paperStopFillCheck({ dir, level, limitPrice = 0, latestCandle, qty }) {
  const crossed = dir === "LONG" ? latestCandle[2] > level : latestCandle[3] < level;
  if (!crossed) return { status: "PENDING", filledQty: 0 };
  const slip = 0.0002;
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

/**
 * Entry-window check judged by the TRIGGER BAR's start time — engine parity (2026-07-14 audit):
 * the validated engine gates entries on the trigger candle's clock (liveEntryGate receives the
 * BAR's hour, so a bar STARTING before the 14:00 cutoff may trigger even though it closes
 * after — 2026-07-13 BSE was a validated engine trade that live refused by wall clock).
 */
function barWithinEntryWindow(barStartSec) {
  const dec = ((barStartSec + 19800) % 86400) / 3600;
  return dec >= MIS_PROFILE.sessionStartDecimal && Math.floor(dec) < Math.floor(MIS_PROFILE.sessionEndDecimal);
}

function canEnter(scripName, barStartSec) {
  if (CONFIG.EMERGENCY_STOP) return { ok: false, reason: "EMERGENCY_STOP" };
  // Bar-clock gate when a trigger bar is in hand (arm/fill decisions); wall-clock fallback keeps
  // any barless caller safe.
  const windowOk = barStartSec ? barWithinEntryWindow(barStartSec) : isValidTradingTime(MIS_PROFILE);
  if (!windowOk) return { ok: false, reason: "OUTSIDE_ENTRY_WINDOW" };
  // No trade-count or daily-loss gates — strict parity with the validated backtests (CONFIG note).
  if (openPositions.some((p) => p.status === "OPEN" && p.underlying === scripName)) return { ok: false, reason: "POSITION_OPEN" };
  return { ok: true };
}

// ─── POSITION LIFECYCLE ───────────────────────────────────────────────────────────────────
async function closePosition(position, session, reason, exitPriceOverride = null) {
  if (position.status !== "OPEN") return;
  const paper = CONFIG.PAPER_TRADING;
  let exitPrice = position.currentLTP || position.avgFillPrice;
  // Paper exit fills mirror the validated engine (2026-07-14 parity round): TARGET/STOPLOSS
  // fill AT the level with the engine's exit slippage in the adverse direction — never at the
  // raw polled LTP (finer-grained than anything the engine models; a systematic paper≠backtest
  // gap on every exit). SQUARE_OFF/MARKET_CLOSE keep LTP (engine exits those at the bar close).
  // The bar backstop passes an explicit engine-exact fill (gap-at-open-aware) that takes priority.
  if (paper && exitPriceOverride > 0) {
    exitPrice = exitPriceOverride;
  } else if (paper && (reason === "TARGET" || reason === "STOPLOSS")) {
    const EXIT_SLIP = 0.0002; // engine default (backtest.js:247)
    const level = reason === "TARGET" ? position.target : (position.currentSL || position.stopLoss);
    exitPrice = level * (position.side === "LONG" ? 1 - EXIT_SLIP : 1 + EXIT_SLIP);
  }
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
  // Engine parity: alerts on bars that completed while this position was open are dead (see the
  // EQ_ALERT_DURING_POSITION guard). Stamp the EXIT BAR's start — the backstop sets
  // _exitBarTime; other exits (square-off/market-close/live) fall back to "the bar before now",
  // conservative by at most one bar.
  lastExitAt[position.underlying] =
    Number(position._exitBarTime) || Math.floor(Date.now() / 1000) - CONFIG.TIMEFRAME_MINUTES * 60;
  saveState();
  logAudit({ type: "EQ_POSITION_CLOSED", id: position.id, scrip: position.underlying, reason, exitPrice, gross, costs, pnl });
  alertInfo("EQ_POSITION_CLOSED", `${position.underlying} ${position.side} closed (${reason}) P&L ₹${pnl.toFixed(0)}`, { paper });
}

function openPositionFromFill(scrip, pend, fill, entryBarTime = null) {
  const qty = Math.min(fill.filledQty || pend.qty, pend.qty);
  const entryFillPrice = fill.avgFillPrice || pend.level;
  const target = computeGapAdjustedTarget(pend.dir, entryFillPrice, pend.stopLoss, CONFIG.TARGET_MULTIPLIER);
  const position = {
    id: `${CONFIG.PAPER_TRADING ? "PAPER-" : ""}EQ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    entryOrderId: pend.entryOrderId,
    entryBarTime, // start of the bar the paper fill was simulated against (exit-scan floor)
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

// One-shot-per-scrip-per-day stale-data audit marker (cleared by resetDailyCounters).
let staleDataLogged = new Set();

/**
 * Resolve an armed pending against a completed bar: open the position on a fill, drop a dead
 * order, or cancel when the entry gates no longer hold. Shared by the new-bar scan (Step 1)
 * AND the same-cycle post-arm check (Step 2) — the engine's trigger scan INCLUDES the judging
 * bar, so a just-armed order must be tested against that same bar immediately or live runs one
 * full bar behind the validated backtest (2026-07-13: MAZDOCK hit target in the engine replay
 * and lost money live purely from this lag).
 */
async function resolvePending(scrip, session, latest) {
  const pend = pendingEntries.get(scrip.name);
  if (!pend) return;
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
    // Engine parity (2026-07-14 fleet finding): the engine gates the CROSSING bar BEFORE
    // entering (tryEnterFromAlert runs liveEntryGate first) and a blocked trigger CONSUMES the
    // alert. A paper fill must pass the same gate or it fabricates a trade the engine
    // structurally refuses — post-cutoff triggers, emergency stop. LIVE fills are reality
    // (the broker executed) and are always booked; the resting order is instead cancelled by
    // the gate re-validation below before a post-cutoff bar can trade it.
    if (CONFIG.PAPER_TRADING) {
      const gate = canEnter(scrip.name, latest[0]);
      if (!gate.ok) {
        processedSignals.add(signalId);
        pendingEntries.delete(scrip.name);
        saveState();
        logAudit({ type: "EQ_TRIGGER_BLOCKED", scrip: scrip.name, dir: pend.dir, level: pend.level, reason: gate.reason, judgeBarTs: latest[0] });
        return;
      }
    }
    if (!processedSignals.has(signalId)) {
      processedSignals.add(signalId);
      pendingEntries.delete(scrip.name);
      const position = openPositionFromFill(scrip, pend, fill, latest[0]);
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
    // Still resting — re-validate the gates against the CURRENT trigger bar; cancel if no longer
    // valid (a bar starting at/after the cutoff can never trigger in the engine either).
    const gate = canEnter(scrip.name, latest[0]);
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

// Epoch sec of today's NSE session start (09:15 IST) for a given nowSec. India has no DST.
function todaySessionStartSec(nowSec) {
  const istDayStartUtc = nowSec - ((nowSec + 19800) % 86400); // 00:00 IST as epoch sec
  return istDayStartUtc + Math.round(MIS_PROFILE.sessionStartDecimal * 3600);
}

// ─── PER-SCRIP SCAN (runs only when a NEW completed 60m bar exists) ────────────────────────
async function processScrip(scrip, session) {
  // Fetch hygiene (2026-07-13: FYERS "request limit reached" blinded the last 3 scrips in the
  // loop). lastBarTime holds the last consumed bar's START — that bar completed at +1 period,
  // and the NEXT bar can only complete at +2 periods. The first cut used +1 period, which
  // expires the instant the known bar becomes consumable — i.e. it never actually skipped
  // (2026-07-14 audit finding). Near the boundary the 30s cycle retries until FYERS publishes.
  const nowSec = Math.floor(Date.now() / 1000);
  const tfSec = CONFIG.TIMEFRAME_MINUTES * 60;
  const knownBar = lastBarTime[scrip.name];
  if (knownBar && nowSec < knownBar + 2 * tfSec + 2) return;

  const candles = await fetchCandles(scrip.symbol, session);
  if (candles.length < CONFIG.TREND_EMA_PERIOD + 2) return;
  const latest = candles[candles.length - 1];
  if (lastBarTime[scrip.name] === latest[0]) return; // no new completed bar — nothing to do

  // Data-freshness gate: fills and arms need TODAY's bars — a stale feed still serving the
  // previous session's data must never drive orders. Checks the LATEST bar, not the alert bar:
  // the engine carries an alert across the day boundary and fills it at today's prices
  // (validated behavior) — gating by alert age was a live≠backtest regression (2026-07-13).
  if (istDateKey(latest[0]) !== istDateKey()) {
    const k = `${scrip.name}:${istDateKey()}`;
    if (!staleDataLogged.has(k)) {
      staleDataLogged.add(k);
      logAudit({ type: "EQ_STALE_DATA", scrip: scrip.name, latestBarDay: istDateKey(latest[0]) });
    }
    // Expected every morning 09:15→10:15 (today's first bar doesn't exist yet). Park a sentinel
    // "bar" one period BEFORE today's first bar so the skip-gate above holds until the first
    // real bar can complete — without this, all 10 scrips refetched every 30s for the whole
    // first hour (the exact burst that blinded Monday). A mid-day stale feed re-parks the same
    // sentinel (already in the past) and so still retries on the normal 30s cycle.
    lastBarTime[scrip.name] = todaySessionStartSec(nowSec) - tfSec;
    return;
  }
  // Optimistic stamp; unstamped in the catch below so a transient failure mid-bar (rate limit,
  // order-API hiccup) retries THIS bar next cycle instead of silently consuming it (audit
  // finding: a throw after the stamp lost the bar's alert forever).
  lastBarTime[scrip.name] = latest[0];
  try {
    await processBar(scrip, session, candles, latest);
  } catch (err) {
    delete lastBarTime[scrip.name];
    throw err;
  }
}

async function processBar(scrip, session, candles, latest) {
  // Step 0 — engine-parity bar backstop for open positions (PAPER only; live positions carry a
  // real broker SL). The validated engine exits on the completed bar's extremes at the LEVEL
  // (SL checked before target, gap-through at open honored, engine slippage) regardless of what
  // the 30s quote polls happened to see — a spike through the stop that mean-reverts between
  // polls must still stop out, or paper diverges from every validated number.
  if (CONFIG.PAPER_TRADING) {
    // Only bars strictly AFTER the entry bar are exit-checked (the engine's exit scan starts on
    // the iteration after entry — the entry bar's own post-fill range is never exit-checked).
    const pos = openPositions.find(
      (p) => p.status === "OPEN" && p.underlying === scrip.name && (!p.entryBarTime || latest[0] > p.entryBarTime)
    );
    if (pos) {
      const slip = 0.0002; // engine default (backtest.js:247)
      const [, bOpen, bHigh, bLow] = latest;
      const isLong = pos.side === "LONG";
      const slHit = isLong ? bLow <= pos.currentSL : bHigh >= pos.currentSL;
      const targetHit = isLong ? bHigh >= pos.target : bLow <= pos.target;
      if (slHit) {
        const raw = isLong ? Math.min(bOpen, pos.currentSL) : Math.max(bOpen, pos.currentSL);
        pos._exitBarTime = latest[0]; // dead-alert guard stamps the exit BAR, not the wall clock
        await closePosition(pos, session, "STOPLOSS", raw * (isLong ? 1 - slip : 1 + slip));
      } else if (targetHit) {
        const raw = isLong ? Math.min(bOpen, pos.target) : Math.max(bOpen, pos.target);
        pos._exitBarTime = latest[0];
        await closePosition(pos, session, "TARGET", raw * (isLong ? 1 - slip : 1 + slip));
      }
    }
  }

  // Step 1: resolve any existing pending entry BEFORE considering a new alert (fill must never
  // be lost to a same-cycle overwrite — same ordering rule as the futures bot).
  await resolvePending(scrip, session, latest);

  // Step 2: detect a fresh alert on the completed bars and arm/refresh the resting entry.
  const alert = detectAlertCandle(candles, "EMA5T", CONFIG.TREND_EMA_PERIOD);
  if (!alert) return;
  const dir = alert.type === "BULLISH_ALERT" ? "LONG" : "SHORT";
  const level = dir === "LONG" ? alert.high : alert.low;
  const stopLoss = dir === "LONG" ? alert.low : alert.high;
  const signalId = `${scrip.name}-${alert.timestamp}-${dir}`;
  if (processedSignals.has(signalId)) return;

  // Engine parity (2026-07-14 audit, stamp re-cut same day): alerts on bars that completed
  // while a position was open are DEAD — the engine records alerts only when flat and nulls the
  // alert on exit; only the EXIT BAR itself re-qualifies (as prevCandle next iteration). The
  // stored stamp is the exit BAR's start (bar-driven exits complete after their bar ends, so a
  // wall-clock stamp wrongly killed the exit bar's own alert — the engine-legal stop-and-reverse
  // re-entry). Kill strictly-older alerts only.
  const exitAt = lastExitAt[scrip.name];
  if (exitAt && alert.timestamp < exitAt) {
    processedSignals.add(signalId);
    logAudit({ type: "EQ_ALERT_DURING_POSITION", scrip: scrip.name, dir, alertTimestamp: alert.timestamp, lastExitAt: exitAt });
    saveState();
    return;
  }

  const existing = pendingEntries.get(scrip.name);
  // "Unchanged" only counts when the pending actually HAS a working order — a null-id pending
  // (placement failed / gates were closed) must fall through and retry now that this cycle's
  // gates may pass (audit finding: one transient failure permanently latched the alert un-armed).
  if (existing && existing.alertTimestamp === alert.timestamp && existing.dir === dir && existing.entryOrderId) return;

  // Replace a stale pending (older alert) BEFORE the margin math — its marginEst would otherwise
  // be double-counted against the new arm (it's about to be dropped either way), spuriously
  // skipping every alert-refresh with reason MARGIN (audit finding; mirrors autoTrader's order).
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

  const gate = canEnter(scrip.name, latest[0]);
  const { qty, marginReq, riskAtEntry } = computeEquityQty({
    entryLevel: level,
    stopLoss,
    riskPerTrade: CONFIG.RISK_PER_TRADE,
    perScripCapital: CONFIG.PER_SCRIP_CAPITAL,
    leverage: CONFIG.LEVERAGE,
  });
  const marginOk = committedMarginFor(scrip.name) + marginReq <= CONFIG.PER_SCRIP_CAPITAL;

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
  // alertBar/judgeBar OHLC recorded for parity forensics (FYERS restates intraday bars after
  // hours — logging what the service actually SAW attributes future diffs to data vs rules).
  logAudit({
    type: "EQ_ENTRY_ARMED", scrip: scrip.name, dir, level, stopLoss, qty, entryOrderId, skipped: entryOrderId ? null : true,
    alertBarTs: alert.timestamp, alertBar: { o: alert.candle?.[1], h: alert.high, l: alert.low, c: alert.close },
    judgeBarTs: latest[0], judgeBar: { o: latest[1], h: latest[2], l: latest[3], c: latest[4] },
  });

  // Same-cycle retro-fill: the engine's trigger scan INCLUDES the judging bar (`latest`) — test
  // the just-armed order against it now instead of waiting a full bar (see resolvePending doc).
  if (entryOrderId) await resolvePending(scrip, session, latest);
}

// ─── MONITOR (every cycle, quote-driven — SL / target / square-off) ───────────────────────
async function monitorPositions(session) {
  for (const position of openPositions) {
    if (position.status !== "OPEN") continue;
    try {
      // Square-off is TIME-driven — checked BEFORE the quote fetch so a rate-limited or dead
      // feed at 15:15 can never defer the MIS exit to the 15:30 force-close at a stale price
      // (audit finding). closePosition tolerates a missing fresh quote.
      if (isSquareOffTime(MIS_PROFILE)) {
        await closePosition(position, session, "SQUARE_OFF");
        continue;
      }
      const ltp = await fetchQuote(position.optionSymbol, session);
      if (!(ltp > 0)) continue;
      position.currentLTP = ltp;
      const dirMult = position.side === "SHORT" ? -1 : 1;
      position.unrealizedPnl = (ltp - position.avgFillPrice) * position.quantity * dirMult;
      // PAPER exits are BAR-driven only (processBar's engine backstop) — 2026-07-14 parity round.
      // A quote-driven exit fires on whichever level trades first chronologically, but the
      // validated engine resolves a both-levels-in-one-bar tie as SL-FIRST (its conservative
      // OHLC convention). Exiting here would win trades the engine loses. LIVE keeps intra-bar
      // exits (a real broker SL is working anyway; live-money can't wait for bar closes).
      // Exception: a DISABLED scrip's position never reaches processScrip (its backstop is
      // dead) — quote exits must keep protecting it.
      const barBackstopCovers = CONFIG.SCRIPS.some((s) => s.enabled && s.name === position.underlying);
      if (!CONFIG.PAPER_TRADING || !barBackstopCovers) {
        const slHit = dirMult === 1 ? ltp <= position.currentSL : ltp >= position.currentSL;
        const targetHit = dirMult === 1 ? ltp >= position.target : ltp <= position.target;
        if (slHit) await closePosition(position, session, "STOPLOSS");
        else if (targetHit) await closePosition(position, session, "TARGET");
        else await ensureLiveStopLoss(position, session); // self-heal a missing live SL
      }
    } catch (err) {
      console.error(`[EQUITY-TRADER] monitor error (${position.optionSymbol}):`, err.message);
    }
  }
  // Deliberately NO automatic daily-loss flatten — backtest parity (see CONFIG note). Manual
  // Emergency Stop remains the operator's brake for a runaway day.
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────────────────
function resetDailyCounters(today) {
  lastTradeDate = today;
  perScripTrades = {};
  dailyRealizedPnL = 0;
  processedSignals = new Set();
  pendingEntries = new Map(); // resting MIS entries never carry across days
  lastBarTime = {};
  lastExitAt = {}; // yesterday's exits never kill today's alerts
  staleDataLogged = new Set();
  openPositions = openPositions.filter((p) => p.status === "OPEN"); // drop yesterday's closed records
}

async function loop(gen) {
  // Generation guard: a stop→start while a prior cycle is mid-await must not leave TWO chains
  // rescheduling forever (double polling, double closePosition races) — only the newest
  // generation may continue (audit finding). Session comes from the module var so a morning
  // re-login adopted via startEquityTrader immediately applies to the running loop.
  if (!isRunning || gen !== loopGeneration) return;
  const session = currentSession;
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
    if (isRunning && gen === loopGeneration) {
      pollTimer = setTimeout(() => loop(gen), rescheduleMs);
    }
  }
}

// ─── PUBLIC API (mirrors autoTrader's shape for the routes/UI) ─────────────────────────────
export async function startEquityTrader(sessionId) {
  if (isRunning) {
    // Adopt the fresh session (morning re-login pressing Start again): the running loop reads
    // currentSession each cycle, so this immediately un-pins it from a dying overnight token
    // (audit finding: bots pinned to the Start-time session traded a whole day on a dead token).
    const { getSession } = await import("../routes/auth.js");
    const fresh = getSession(sessionId);
    if (fresh && fresh !== currentSession) {
      currentSession = fresh;
      logAudit({ type: "EQ_SESSION_ADOPTED" });
      return { status: "SESSION_ADOPTED" };
    }
    return { status: "ALREADY_RUNNING" };
  }
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
    saveState(); // persist desiredRunning=true for crash forensics
    loop(++loopGeneration);
    return { status: "STARTED", paperTrading: CONFIG.PAPER_TRADING };
  } catch (err) {
    isRunning = false;
    throw err;
  }
}

export function stopEquityTrader() {
  isRunning = false;
  loopGeneration++; // invalidate any in-flight cycle's reschedule
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logAudit({ type: "EQ_STOPPED" });
  saveState(); // persist desiredRunning=false
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
    dailyRealizedPnL: dailyRealizedPnL.toFixed(2),
    openPositions: openPositions.filter((p) => p.status === "OPEN"),
    closedPositions: openPositions.filter((p) => p.status === "CLOSED"),
    pendingEntries: [...pendingEntries.values()],
    misWindow: { entries: "09:15–14:00 IST", squareOff: "15:15 IST" },
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
      // Disabling a scrip must not orphan its armed pending — the scan loop filters to enabled
      // scrips, so nothing would ever resolve or cancel it (in LIVE the resting stop order would
      // stay working at the broker and could fill untracked — audit finding).
      if (clean.scripEnabled[s.name] === false && pendingEntries.has(s.name)) {
        const pend = pendingEntries.get(s.name);
        pendingEntries.delete(s.name);
        logAudit({ type: "EQ_PENDING_CANCELLED", scrip: s.name, reason: "SCRIP_DISABLED" });
        if (!CONFIG.PAPER_TRADING && pend.entryOrderId) {
          cancelOrder(pend.entryOrderId, currentSession, logAudit).catch((err) => {
            logAudit({ type: "EQ_PENDING_CANCEL_FAILED", scrip: s.name, orderId: pend.entryOrderId, error: err.message });
            alertCritical("EQ_ORPHAN_ORDER", `Cancel failed for disabled ${s.name} — order ${pend.entryOrderId} may still be working at the broker. MANUAL REVIEW.`, {});
          });
        }
      }
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
