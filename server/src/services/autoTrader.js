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
  placeStopEntry,
  waitForFill,
  cancelOrder,
  getOrderDetails,
  isTokenErrorData,
  ORDER_SIDE,
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

import { isNseMarketOpen, isInstrumentTradingDay } from "../utils/marketHolidays.js";
// Shared instrument/session registry (pure module, also used by routes/backtest.js and
// tickService.js): per-exchange session profiles, gold contract specs, futures symbol builder.
import {
  SESSION_PROFILES,
  GOLD_CONTRACTS,
  buildFuturesSymbol as buildFuturesSymbolShared,
  probeMonthsFor,
  computeInstrumentPhase,
  computeLoopPlan,
  istDateKey,
} from "./instruments.js";

import fs from "fs";
import path from "path";

import { computeExecutionStats } from "./executionStats.js";
import { computeHealthSnapshot } from "./healthSnapshot.js";
// Statutory + brokerage cost model, shared with the backtest so live P&L is reported NET (not gross).
import { computeFuturesCosts } from "./futuresCosts.js";
// Operator alerts for events that MUST reach a human (2026-07-14 audit: this bot trades
// unattended MCX evenings yet every "MANUAL REVIEW NEEDED" went to pm2 logs nobody reads).
import { alertCritical } from "./notifier.js";

// ΓöÇΓöÇΓöÇ CONFIGURATION ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const CONFIG = {
  // Sized against FYERS's documented rate limit (10/sec, 200/min, 100k/day — see the comment in
  // orderExecution.js; breaching it repeatedly blocks API access for the rest of the day) at the
  // STRUCTURAL worst case, not just today's selected instruments/timeframes: both
  // underlyings, all 4 timeframes, correlated trades allowed (8 concurrent pairs, ~32 REST
  // calls/cycle in live mode). At 15s that's ~128 calls/min (64% of the 200/min budget,
  // comfortable headroom); 10s would be ~192/min (96%, too tight to survive scaling up later
  // without revisiting this number). Previously 30000 — halving it roughly halves the worst-case
  // lag between a signal confirming and its resting order actually being armed at the broker.
  POLL_INTERVAL_MS: 15000,
  UNDERLYINGS: [
    // Lot sizes per the NSE Jan-2026 series revision (circular FAOP70616): NIFTY 75→65,
    // BANKNIFTY 35→30. A wrong lot size is silently fatal live — every order is exchange-
    // rejected as an invalid multiple — while paper mode happily fills it, so re-verify
    // these against the NSE circulars at every series revision.
    { name: "NIFTY", symbol: "NSE:NIFTY50-INDEX", lotSize: 65, marginPerLot: 150000, exchange: "NSE", sessionProfile: "NSE_INDEX", correlationGroup: "INDEX" },
    { name: "BANKNIFTY", symbol: "NSE:NIFTYBANK-INDEX", lotSize: 30, marginPerLot: 180000, exchange: "NSE", sessionProfile: "NSE_INDEX", correlationGroup: "INDEX" },
    // GOLD (MCX): symbol is a display pseudo-symbol (signals come from the resolved futures
    // contract, same as the indices — there is no gold index). No static lotSize/marginPerLot —
    // they depend on the runtime-configurable CONFIG.GOLD_CONTRACT (see getContractSpec), so a
    // stale copy here could silently disagree. correlationGroup "GOLD": gold is uncorrelated
    // with the indices, so the ALLOW_CORRELATED_TRADES gate never blocks across groups.
    { name: "GOLD", symbol: "MCX:GOLD", exchange: "MCX", sessionProfile: "MCX_COMMODITY", correlationGroup: "GOLD" },
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
  // Reward:risk multiple on the alert-candle's structural stop distance (target = risk * this).
  // The 6-year validation used 2 (1:2 RR); a parameter-sensitivity sweep this session found 2.5
  // outperforms on the tested range, but treat any non-default value as unvalidated live/paper.
  TARGET_MULTIPLIER: 2,
  // EMA5T's no-lookahead trend gate (emaStrategy.js's detectAlertCandle) — the validated period is
  // 20; exposed here (matching Backtest Lab's "Trend EMA Period" field) so a parameter-sensitivity
  // change can be tried live/paper without a code edit. Changing this live-trades a DIFFERENT rule
  // than the 6-year validation actually tested — treat any non-default value as unvalidated.
  TREND_EMA_PERIOD: 20,
  POSITION_SIZING_MODE: "RISK",
  FIXED_LOTS: 1,
  ORDER_TYPE: "LIMIT",
  // Off by default: EMA5T's resting entry order is SL-M (fills at whatever price is available
  // once triggered) unless this is explicitly turned on, in which case it becomes SL-L, capped
  // at the alert level ± LIMIT_BUFFER_PCT%. LIMIT_BUFFER_PCT itself predates this — it was
  // previously read by the now-deleted options-buying flow's computeEntryLimitPrice, sized for
  // option premiums (a few rupees). 0.3% of a ~₹55,000 futures level is ~165 points, the wrong
  // scale for this use — re-derive it deliberately (start generous, tighten from observed paper
  // fills) before ever enabling this, don't trust the persisted default.
  USE_STOPLIMIT_ENTRIES: false,
  LIMIT_BUFFER_PCT: 0.3,
  SLIPPAGE_BUFFER_PCT: 0.5,
  // L2 (audited): option BUYING is a debit — it only needs ~1× the premium. 2× was double-charging
  // and, with a small account, blocked every trade at the margin gate. 1.1 keeps a 10% buffer for the
  // limit-buffer overpay + rounding.
  MARGIN_SAFETY_MULTIPLIER: 1.1,
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
  // Optional VIX-regime filter (OFF by default). When on, skip EMA5T entries while India VIX is
  // below MIN_VIX. Momentum works in elevated-vol regimes and chops in quiet ones — validated
  // out-of-sample (high-VIX EMA5T strongly +ve, low-VIX -ve). Default off ⇒ NO behaviour change and
  // no extra VIX fetch. LIVE gates on the current VIX quote; the backtest gates on the prior-day VIX
  // close (the persistent regime is what matters, so the small reference difference is immaterial).
  MIN_VIX_FILTER: false,
  MIN_VIX: 15,
  // Which MCX gold contract the bot trades when GOLD is selected: "GOLDM" (mini, ₹10/point,
  // ~₹60-80k margin — the safe default) or "GOLD" (big, ₹100/point, ~₹6-8L margin). Signals are
  // identical (same underlying price); only the money at stake per lot differs. Change is
  // blocked while the bot is running (see updateConfig) — flipping contracts mid-run would
  // orphan resting/SL orders on the other contract.
  GOLD_CONTRACT: "GOLDM",
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

function getUnderlyingByName(name) {
  return CONFIG.UNDERLYINGS.find((u) => u.name === name) || null;
}

// Session profile for an underlying (object or name). Unknown/legacy → NSE_INDEX, which is
// byte-identical to the pre-gold behavior for every existing instrument.
function getSessionProfileFor(underlyingOrName) {
  const u = typeof underlyingOrName === "string" ? getUnderlyingByName(underlyingOrName) : underlyingOrName;
  return SESSION_PROFILES[u?.sessionProfile] || SESSION_PROFILES.NSE_INDEX;
}

// Tradable-contract spec for an underlying. Indices: static lotSize/margin from UNDERLYINGS.
// GOLD: derived from CONFIG.GOLD_CONTRACT at call time (no stale copy). `qty` is the order
// quantity AND the P&L point-multiplier — paper P&L (Δprice × qty) is exact with qty=pointValue.
// TODO(verify-before-live): FYERS MCX order-qty semantics (lots vs units) must be confirmed
// before any REAL gold order; paper-first makes this safe (instruments.js has the same note).
function getContractSpec(underlying) {
  if (underlying.name !== "GOLD") {
    return { root: underlying.name, qty: underlying.lotSize, marginPerLot: underlying.marginPerLot };
  }
  const c = GOLD_CONTRACTS[CONFIG.GOLD_CONTRACT] || GOLD_CONTRACTS.GOLDM;
  return { root: c.root, qty: c.pointValue, marginPerLot: c.marginPerLot };
}

// Current session phase ("PRE_OPEN"|"OPEN"|"CLOSED") for an underlying (object or name), on the
// live IST clock + the exchange's trading-day calendar. Unknown names resolve to the NSE profile.
function getInstrumentPhaseNow(underlyingOrName) {
  const u = typeof underlyingOrName === "string" ? getUnderlyingByName(underlyingOrName) : underlyingOrName;
  const now = new Date();
  const istMinutes = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % (24 * 60);
  return computeInstrumentPhase(getSessionProfileFor(u || underlyingOrName), {
    istMinutes,
    isTradingDay: isInstrumentTradingDay(u?.exchange || "NSE"),
  });
}

// Exported purely so a test can assert the interval stays within sane bounds without needing to
// export the whole CONFIG object — guards against an accidental future revert.
export function getPollIntervalMs() {
  return CONFIG.POLL_INTERVAL_MS;
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
  useStopLimitEntries: "USE_STOPLIMIT_ENTRIES",
  limitBufferPct: "LIMIT_BUFFER_PCT",
  trendEmaPeriod: "TREND_EMA_PERIOD",
  targetMultiplier: "TARGET_MULTIPLIER",
  maxSpreadPct: "MAX_SPREAD_PCT",
  minOI: "MIN_OI",
  maxTimeEntryHour: "MAX_TIME_ENTRY_HOUR",
  allowCorrelatedTrades: "ALLOW_CORRELATED_TRADES",
  selectedStrategies: "SELECTED_STRATEGIES",
  selectedInstruments: "SELECTED_INSTRUMENTS",
  selectedTimeframes: "SELECTED_TIMEFRAMES",
  minVixFilter: "MIN_VIX_FILTER",
  minVix: "MIN_VIX",
  goldContract: "GOLD_CONTRACT",
};
const PERSISTED_CONFIG_KEYS = Object.values(CONFIG_FIELD_MAP);

// ─── SESSION REFERENCE ────────────────────────────────────────────────
let currentSession = null;
let loopGeneration = 0; // stop/start reentrancy guard: only the newest loop chain may reschedule
let lastLoopErrorAlertAt = 0; // throttle for BOT_LOOP_ERROR operator alerts
// key ("UNDERLYING:EMA5T:<tf>m") -> epoch sec of the last position exit on that stream (engine
// dead-alert guard: alerts on bars that completed while a position was open never arm).
// Declared here — NOT next to its consumer — because loadState() (line ~405) assigns it at
// module init, long before later declarations would have executed (TDZ).
let lastExitAtByKey = new Map();

// ─── STATE ────────────────────────────────────────────────────────────
let isRunning = false;
let pollInterval = null;
let activeAlerts = new Map();
let openPositions = [];
let todayTrades = 0;
let lastTradeDate = null;

let latestData = {};
let processedSignals = new Set();
let marketStatus = "CLOSED";
let dailyPnL = 0;
let dailyRealizedPnL = 0;
let consecutiveLosses = 0;
let auditLog = [];

// Re-entrancy guard for closePosition: a module-level Set (NOT a flag on the position object,
// and NOT persisted) keyed by position.id. A persisted flag would wedge a position permanently
// after a crash mid-close (loadState would restore it as stuck "true" forever); a fresh process
// always correctly starts with zero in-flight closes, so an empty Set needs no special-casing on
// restart. This closes the CONCURRENT (not just sequential) duplicate-exit-order race: e.g.
// emergencyStop's un-awaited flattenAllPositions() interleaving with an in-flight monitorPositions
// cycle's own close call on the same position. JS only yields at await boundaries, so whichever
// caller runs first fully claims the guard before a second caller's check can run.
const closingPositionIds = new Set();

// Same pattern as closingPositionIds, for manageFuturesPending: today's tradingLoop/processCandles
// for...await loops are strictly sequential, so two invocations for the same key never actually
// overlap — this guard is a no-op today. It exists so a future event-driven trigger (e.g. arming
// off the tick feed instead of only on the poll cycle) can safely coexist with the poll loop
// without a real race: without it, two near-simultaneous calls for the same key could both read
// pendingEntries as empty and both place a resting entry order, doubling exposure.
const pendingKeysInFlight = new Set();

// Gates new entries until local open positions have been verified against the broker on
// startup. Stays false if that reconciliation could not run, so a phantom position can never
// trigger a naked exit and we never trade on an unverified picture of what we hold.
let reconcileOk = false;

// Exported only for tests — reconcilePositionsWithBroker (the real setter, not exported itself)
// calls out to the broker, so a hermetic test of entry-path logic needs a way to satisfy this
// gate without running that flow. Production code must never call this; only the real
// reconciliation on startup may set reconcileOk.
export function setReconcileOkForTest(ok) {
  reconcileOk = !!ok;
}

// EMA5T (futures): resting stop-entry orders, keyed like activeAlerts. One unified lifecycle for
// both paper and live (see manageFuturesPending) — paperTrading is threaded through to
// placeStopEntry either way, so paper mode exercises the same order-placement/cancel-discipline
// code live runs, differing only in how a fill is detected. Persisted so a mid-day restart keeps
// them; cleared daily (tradingLoop's new-day reset) since resting entries never carry across days.
let pendingEntries = new Map();


// ΓöÇΓöÇΓöÇ PERSISTENCE ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const STATE_FILE = path.join(process.cwd(), "auto-trade-state.json");
const AUDIT_FILE = path.join(process.cwd(), "auto-trade-audit.jsonl");

function saveState() {
  try {
    const config = {};
    for (const key of PERSISTED_CONFIG_KEYS) config[key] = CONFIG[key];
    const json = JSON.stringify(
      {
        openPositions,
        todayTrades,
        lastTradeDate,
        processedSignals: Array.from(processedSignals),
        pendingEntries: Array.from(pendingEntries.entries()),
        lastExitAtByKey: Array.from(lastExitAtByKey.entries()),
        dailyPnL,
        dailyRealizedPnL,
        consecutiveLosses,
        // Crash forensics: true while the operator has the bot started. NOT auto-resumed on boot
        // (surprise trading after a deploy restart would be worse) — index.js raises a critical
        // alert instead so the operator knows the book stopped.
        desiredRunning: isRunning,
        config,
      },
      null,
      2
    );
    // Write to a temp file and rename over the real one — rename is atomic on the same
    // filesystem, so a crash/OOM/kill mid-write can never leave auto-trade-state.json truncated
    // or corrupt (which loadState's catch would otherwise silently paper over with empty
    // defaults, forgetting every open position and pending order).
    const tmpFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, json);
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    console.error("[AUTO-TRADER] Save state failed:", err.message);
  }
}

// True when the state file says the bot was running when the process died/restarted — surfaced
// (never auto-resumed) via getWasRunningBeforeBoot for index.js's boot alert.
let wasRunningBeforeBoot = false;
export function getWasRunningBeforeBoot() {
  return wasRunningBeforeBoot;
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
      lastExitAtByKey = new Map(s.lastExitAtByKey || []);
      wasRunningBeforeBoot = s.desiredRunning === true;
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

/**
 * Is the most recent (already-completed, post dropInProgressCandle) candle too old to trust for
 * a live entry decision? Stale if its period ENDED more than `toleranceMultiples` periods ago —
 * generous enough to tolerate normal poll jitter / REST-fallback latency, tight enough to catch a
 * genuinely stuck feed within a few missed bars. Missing/empty candles are stale by default
 * (fail-safe: no data is never treated as "fine"). Pure (nowSec injectable) for unit testing.
 */
export function isCandleStale(candles, timeframeMinutes, nowSec = Math.floor(Date.now() / 1000), toleranceMultiples = 2.5) {
  if (!Array.isArray(candles) || candles.length === 0) return true;
  const startSec = Number(candles[candles.length - 1]?.[0]) || 0;
  if (!startSec) return true;
  const periodSec = (Number(timeframeMinutes) || 5) * 60;
  return nowSec - (startSec + periodSec) > periodSec * toleranceMultiples;
}

/**
 * Is a single tick (getLatestTick's shape: { symbol, ltp, volume, timestamp(ms) }) too old to
 * trust? Ticks should be near-continuous intra-session, so this is a much tighter, ABSOLUTE
 * threshold than isCandleStale's timeframe-scaled one — it targets a stalled-but-still-
 * "connected" WebSocket specifically, since getWsStatus() reports connection state but not tick
 * recency. Pure (nowMs injectable) for unit testing.
 */
export function isTickStale(tick, nowMs = Date.now(), thresholdMs = 3 * 60 * 1000) {
  if (!tick) return true;
  const tickMs = Number(tick.timestamp) || 0;
  if (!tickMs) return true;
  return nowMs - tickMs > thresholdMs;
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
  // EMA5T (the only live strategy) needs closes.slice(0,-1).length >= 20 for its trend gate, i.e.
  // candles.length >= 21 — the old ">=6" threshold was sized for the legacy EMA5 rule and handed
  // off to tick-only candles (aggregateOHLC resets to empty every session — see its own
  // session-boundary comment) long before there was enough depth for EMA5T to ever fire. That
  // silently blinded the trend gate for large, predictable stretches of every day: permanently on
  // 30m from ~12:15 IST on (a session can never accumulate 21 x 30m candles), and for ~3h45m
  // (~10:45-14:30 IST) on 15m. Require the SAME depth EMA5T actually needs before trusting
  // tick-only data over the (now 21-calendar-day-deep) REST fallback.
  if (tickRows.length >= 21) {
    logDataSourceOnChange(`${symbol}:${tf}`, { type: "DATA_SOURCE", source: "websocket", symbol, timeframe: tf, count: tickRows.length });
    return tickRows;
  }
  logDataSourceOnChange(`${symbol}:${tf}`, { type: "DATA_SOURCE", source: "history_api", symbol, timeframe: tf, reason: "insufficient_tick_data", tickCount: tickRows.length });
  return dropInProgressCandle(await fetchLatestCandles(symbol, session, timeframeMinutes), timeframeMinutes); // C6
}

// DATA_SOURCE audit hygiene (2026-07-14 audit): logging every poll produced ~10.5k lines/day,
// evicting the day's REAL trade events from the 5,000-entry in-memory buffer by afternoon and
// growing the file unboundedly. Log only when a stream's source CHANGES — the information is
// the transition (websocket↔history/quotes), not the steady state.
const lastDataSourceByKey = new Map();
function logDataSourceOnChange(streamKey, entry) {
  if (lastDataSourceByKey.get(streamKey) === entry.source) return;
  lastDataSourceByKey.set(streamKey, entry.source);
  logAudit(entry);
}

async function fetchOptionQuoteWithTickFallback(optionSymbol, session) {
  const tick = getLatestTick(optionSymbol);
  if (tick && tick.ltp > 0) {
    logDataSourceOnChange(`q:${optionSymbol}`, { type: "DATA_SOURCE", source: "websocket", symbol: optionSymbol, ltp: tick.ltp });
    return { lp: tick.ltp, bid: tick.ltp, ask: tick.ltp, oi: 0 };
  }
  logDataSourceOnChange(`q:${optionSymbol}`, { type: "DATA_SOURCE", source: "quotes_api", symbol: optionSymbol, reason: "no_tick" });
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
    alertCritical("BOT_AUTH_FAILING", `FYERS auth failing (${consecutiveAuthFailures}×) — token likely dead. Bot cannot trade or exit; reconnect FYERS now.`, {});
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

// ΓöÇΓöÇΓöÇ MARKET FILTERS ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function checkTimeFilter(underlying) {
  const now = new Date();
  const istOffset = 330;
  const istMinutes = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + istOffset) % (24 * 60);
  const hours = Math.floor(istMinutes / 60);
  // Per-instrument entry cutoff: NSE profiles carry entryCutoffHour null → the long-standing
  // operator knob (MAX_TIME_ENTRY_HOUR, default 14) keeps governing them, byte-identical. Gold's
  // profile fixes 22 (part of the validated variant — entries 09:00–22:00, evening session kept).
  const cutoff = getSessionProfileFor(underlying)?.entryCutoffHour ?? CONFIG.MAX_TIME_ENTRY_HOUR;
  if (hours >= cutoff) {
    console.log(`[AUTO-TRADER] After ${cutoff}:00 IST — no new entries (${typeof underlying === "string" ? underlying : underlying?.name || "?"})`);
    return false;
  }
  return true;
}

function checkCorrelationFilter(underlying) {
  if (CONFIG.ALLOW_CORRELATED_TRADES) return true;
  // Correlation only applies WITHIN a correlation group: NIFTY↔BANKNIFTY ("INDEX") behave
  // exactly as before; GOLD is its own group, so gold never blocks / is never blocked by index
  // exposure — concurrent gold+index positions are the diversification point (margin cap still
  // applies globally via computeCommittedMargin).
  const myName = typeof underlying === "string" ? underlying : underlying.name;
  const myGroup = (typeof underlying === "string" ? getUnderlyingByName(underlying) : underlying)?.correlationGroup || "INDEX";
  const sameGroupOther = (name) =>
    name !== myName && ((getUnderlyingByName(name)?.correlationGroup || "INDEX") === myGroup);
  const hasOpenTrade = openPositions.some((p) => p.status === "OPEN" && sameGroupOther(p.underlying));
  // A resting (not-yet-filled) entry on another underlying is exposure just as real as an OPEN
  // position for this gate's purpose — without this, two correlated resting orders can both arm
  // (neither is "open" yet when the other is checked) and both later fill, defeating
  // ALLOW_CORRELATED_TRADES:false the moment both underlyings are selected. Only count entries
  // that actually got placed (entryOrderId truthy) — matches computeCommittedMargin's identical
  // filter. A gate-skipped "ghost" entry (entryOrderId:null, e.g. from a transient stale-data or
  // margin check that failed for one cycle) has zero real exposure and can otherwise sit in
  // pendingEntries for the rest of the day, permanently blocking every future alert on every
  // OTHER underlying for no real reason.
  const hasPendingOnOther = Array.from(pendingEntries.values()).some((p) => sameGroupOther(p.underlying) && p.entryOrderId);
  if (hasOpenTrade || hasPendingOnOther) {
    console.log(`[AUTO-TRADER] Correlation filter: already in trade on other underlying`);
    return false;
  }
  return true;
}

/**
 * Total margin currently committed across every OPEN position plus every resting pending entry
 * that already has a live entryOrderId (a resting live order provisionally reserves margin at
 * the broker the moment it's placed — a conservative default, verify against FYERS's actual
 * margin-blocking behavior for a working SL-M order). Computed on-demand from the current
 * positions/pending map rather than a maintained running counter: a separate counter would need
 * to stay in lockstep with every position-mutation site (open, partial exit, reconcile, close) —
 * exactly the class of drift bug the rest of this effort is eliminating. openPositions is already
 * the single source of truth; summing a handful of entries a few times per 30s cycle is
 * negligible cost. Pure (positions/pending injectable) for unit testing.
 */
export function computeCommittedMargin(positions, pending) {
  const openMargin = (positions || [])
    .filter((p) => p.status === "OPEN")
    .reduce((sum, p) => sum + (Number(p.marginAtEntry) || 0), 0);
  const pendingMargin = Array.from((pending && typeof pending.values === "function" ? pending.values() : []))
    .filter((p) => p && p.entryOrderId)
    .reduce((sum, p) => sum + (Number(p.marginEst) || 0), 0);
  return openMargin + pendingMargin;
}

/**
 * True if an OPEN position already exists for this exact underlying+timeframe key. Used to stop
 * a fresh EMA5T alert from arming a second concurrent position on a slot that's already filled —
 * see the call site in manageFuturesPendingInner. Pure (positions injectable) for unit testing.
 */
export function hasOpenPositionForKey(positions, underlyingName, timeframe) {
  return (positions || []).some(
    (p) => p.status === "OPEN" && p.underlying === underlyingName && p.signal?.timeframe === timeframe
  );
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
function finalizeClose(position, { exitPrice, exitQty, reason, exitOrderId, paperTrading = CONFIG.PAPER_TRADING }) {
  position.status = "CLOSED";
  position.exitTime = new Date().toISOString();
  position.exitReason = reason;
  position.exitOrderId = exitOrderId;
  position.exitPrice = exitPrice;
  position.quantity = exitQty;
  position.pendingExitOrderId = null; // exit resolved — nothing in flight anymore

  // C4: report NET P&L — deduct brokerage + statutory futures costs (STT/exchange/stamp/GST on
  // notional turnover, NOT the options premium model) so the dashboard/audit isn't optimistic.
  // PAPER TOO (2026-07-13 parity finding): paper used to report GROSS ("no real costs"), but the
  // validated backtests report NET via this exact function — the whole point of the paper run is
  // to reproduce backtest accounting, and gross-vs-net was a silent ~₹300-500/trade flattery.
  // The equity service already charges model costs in paper; futures now matches.
  // The round-trip cost is charged ONCE for the whole position (on
  // the original entry qty), so a multi-leg exit — where earlier legs were realized GROSS via
  // settleLeg — never double-counts brokerage / buy-side charges.
  // `paperTrading` defaults to a fresh CONFIG read for callers with no closePositionInner-style
  // snapshot of their own (reconcileStopLossOrders) — closePositionInner passes its OWN snapshot
  // explicitly so this can't disagree with decisions already made earlier in the same close.
  // Direction-aware: SHORT futures profit when exit < entry.
  const dirMult = position.side === "SHORT" ? -1 : 1;
  const gross = (exitPrice - position.avgFillPrice) * exitQty * dirMult;
  const costQty = position.origEntryQty || exitQty;
  const costs = computeFuturesCosts(position.avgFillPrice, exitPrice, costQty, { brokeragePerOrder: CONFIG.BROKERAGE_PER_ORDER, side: position.side, exchange: getUnderlyingByName(position.underlying)?.exchange || "NSE" });
  const pnl = gross - costs;
  position.realizedPnl = (position.realizedPnl || 0) + pnl; // accumulate across any partial exits
  position.pnl = position.realizedPnl;
  dailyRealizedPnL += pnl;
  consecutiveLosses = position.realizedPnl < 0 ? consecutiveLosses + 1 : 0;
  // Engine dead-alert guard bookkeeping (see EMA5T_ALERT_DURING_POSITION in the arm path).
  if (position.signal?.strategy === "EMA5T" && position.signal?.timeframe) {
    lastExitAtByKey.set(`${position.underlying}:EMA5T:${position.signal.timeframe}m`, Math.floor(Date.now() / 1000));
  }

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

/**
 * Guarded entry point: claims position.id in closingPositionIds synchronously (before any await)
 * so two concurrent invocations for the same position can never both reach the exit-order-placing
 * logic in closePositionInner. See the closingPositionIds declaration for why this is a module-
 * level Set rather than a persisted flag. Exported only for the reentrancy test — not part of the
 * public API surface used by routes.
 */
export async function closePosition(position, session, reason) {
  if (closingPositionIds.has(position.id)) return;
  closingPositionIds.add(position.id);
  try {
    await closePositionInner(position, session, reason);
  } finally {
    closingPositionIds.delete(position.id);
  }
}

async function closePositionInner(position, session, reason) {
  if (position.status !== "OPEN") return;

  // Snapshot once: CONFIG.PAPER_TRADING can flip mid-close (operator stops the bot, changes mode,
  // restarts) across this function's many awaits. Reading it fresh at each point below could let a
  // paper position's exit re-check LIVE (placing a REAL market order that would actually OPEN a new
  // position, since the paper position was never at the broker) or vice versa. Every decision in
  // this close — including the finalizeClose calls below — uses this one snapshot.
  const paperTrading = CONFIG.PAPER_TRADING;

  let heldQty = position.entryQty ?? position.quantity;

  // ─── Settle any exit order a PREVIOUS closePosition attempt left in flight ─────────────
  // (process crash or API outage between placing the market exit and confirming its fill —
  // pendingExitOrderId is persisted with the position). Without this, a retry would place a
  // SECOND market sell while the first may have filled: an oversell into a naked short. If
  // the broker is unreachable, abort and retry next cycle — the id stays on the position.
  if (position.pendingExitOrderId && !paperTrading) {
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
        paperTrading,
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
  if (position.slOrderId && !paperTrading) {
    let slDetails = null;
    try {
      slDetails = await getOrderDetails(position.slOrderId, session);
    } catch (err) {
      // Abort and retry next cycle, matching the pendingExitOrderId block just above — falling
      // through with slDetails=null would treat an UNKNOWN broker SL state as "nothing filled" and
      // place a full-quantity market exit that could double-sell against a broker SL that actually
      // filled (or partially filled) while this check failed.
      console.error(`[AUTO-TRADER] Pre-exit SL status check failed for ${position.optionSymbol}; retrying next cycle:`, err.message);
      return;
    }
    const slPrice = slDetails?.avgFillPrice || position.currentSL || position.stopLoss;
    const sl = planSlSettlement({ status: slDetails?.status, slFilled: slDetails?.filledQty, heldQty });
    if (slDetails && sl.fullSlClose) {
      // Broker SL already closed the WHOLE position — settle on it, place NO market order.
      console.log(`[AUTO-TRADER] Broker SL already closed ${position.optionSymbol}; settling without a second exit`);
      finalizeClose(position, { exitPrice: slPrice, exitQty: heldQty, reason: "STOPLOSS", exitOrderId: position.slOrderId, paperTrading });
      return;
    }
    if (slDetails && sl.slLegQty > 0) {
      // PARTIAL broker-SL fill: that qty is already sold. Realize it and SHRINK what we still hold so
      // the market exit below can never oversell the position into a naked short / rejected order.
      console.error(`[AUTO-TRADER] Broker SL partial-filled ${sl.slLegQty}/${heldQty} on ${position.optionSymbol}; exiting only the remainder`);
      heldQty = settleLeg(position, slPrice, sl.slLegQty, "BROKER_SL_PARTIAL");
    }
    // Already confirmed DEAD at the broker (never filled, or the un-filled remainder after a
    // partial) — there is nothing left to cancel. Clear it now instead of letting the block below
    // attempt a doomed re-cancel of an order that's already terminal: that cancel would fail,
    // and its catch aborts this WHOLE close without ever clearing slOrderId — stranding the
    // position with no protective stop and repeating the identical failure every future cycle.
    if (slDetails && ["REJECTED", "CANCELLED", "EXPIRED"].includes(slDetails.status)) {
      position.slOrderId = null;
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
      // Abort and retry next cycle, matching the pendingExitOrderId/slDetails guards above —
      // falling through here would place a market exit while the broker SL might STILL be live
      // (the cancel failed, not because it already filled). If the market exit fills first, this
      // position gets marked CLOSED and reconcileStopLossOrders stops watching it — so if the
      // stale SL fires later, it opens an untracked, unintended position against a flat book.
      console.error(`[AUTO-TRADER] Could not cancel SL order ${position.slOrderId}; retrying next cycle:`, err.message);
      return;
    }
  }

  if (heldQty <= 0) {
    // Nothing left to exit (the broker SL filled it all) — finalize without a second order.
    finalizeClose(position, { exitPrice: position.currentLTP || position.avgFillPrice, exitQty: 0, reason, exitOrderId: position.id, paperTrading });
    return;
  }

  const currentLTP = position.currentLTP || position.avgFillPrice;
  const paperFillPrice = reason === "TARGET" ? position.target : currentLTP;

  const exitOrder = await placeMarketExit({
    symbol: position.optionSymbol,
    qty: heldQty,
    // SELL closes a LONG; BUY covers a SHORT. EMA5T trades both directions, unlike the
    // (removed) option-buying flow this wrapper was originally built for.
    side: futuresOrderSide(position.side, "EXIT"),
    session,
    paperTrading,
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
    paperTrading,
    paperFillPrice,
    auditLogger: logAudit,
  });

  // Non-terminal outcome (TIMEOUT, or PARTIAL at deadline): the order may STILL be working at
  // the broker. Cancel the remainder and re-read the true final fill (entry C-LIVE-1 pattern).
  // If the broker is unreachable, RETURN with pendingExitOrderId still set — never re-arm an
  // SL next to a possibly-live exit order (the pair could sell the same quantity twice).
  let finalFill = fill;
  if (!paperTrading && !["FILLED", "REJECTED", "CANCELLED", "EXPIRED"].includes(fill.status)) {
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
  const plan = classifyExit({ paper: paperTrading, entryQty: heldQty, fillQty: finalFill.filledQty });

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

  finalizeClose(position, { exitPrice, exitQty: plan.exitQty, reason, exitOrderId: exitOrder.orderId, paperTrading });
}

async function reconcileStopLossOrders(session) {
  for (const position of openPositions) {
    if (position.status !== "OPEN" || !position.slOrderId) continue;
    // Synthetic paper SL orders don't exist at the broker at all — never query them (matches
    // cancelOrder's own "PAPER-" short-circuit, and ensureStopLoss's paper branch, which treats
    // any existing paper slOrderId as always "alive"). Without this, every open paper position
    // triggered a REAL FYERS getOrderDetails call every monitor cycle using a synthetic id never
    // submitted to the broker — wasted API quota at best, and at worst a risk that FYERS's
    // orderbook-filter fallback (see getOrderDetails' list[0] fallback) attributes an unrelated
    // real order's fill status onto this paper position, corrupting or falsely closing it.
    if (String(position.slOrderId).startsWith("PAPER-")) continue;
    try {
      const details = await getOrderDetails(position.slOrderId, session);
      // A concurrent closePosition (e.g. emergencyStop's un-awaited flattenAllPositions) may have
      // already finalized this position while the await above was in flight — re-check before
      // acting on a now-stale read.
      if (position.status !== "OPEN") continue;
      if (details.status === "FILLED") {
        // Claim the SAME guard closePosition uses: if a concurrent close is already in progress
        // for this position, skip rather than double-finalize (double-counted P&L, duplicate
        // audit entry, and a corrupted dailyRealizedPnL feeding the daily-loss breaker).
        if (closingPositionIds.has(position.id)) continue;
        closingPositionIds.add(position.id);
        try {
          if (position.status !== "OPEN") continue;
          const exitPrice = details.avgFillPrice || position.stopLoss;
          const exitQty = details.filledQty || position.quantity;
          finalizeClose(position, { exitPrice, exitQty, reason: "STOPLOSS", exitOrderId: position.slOrderId });
          console.log(`[AUTO-TRADER] CLOSED by broker SL: ${position.optionSymbol}`);
        } finally {
          closingPositionIds.delete(position.id);
        }
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
  // The broker's net-position figure is PER SYMBOL, but local OPEN positions on the same symbol
  // can legitimately be >1 (e.g. two different timeframes both trading the same underlying's
  // futures contract concurrently — autoTrader.margin.test.js's own fixtures anticipate up to 6
  // concurrent positions). The broker has no way to tell us which local position owns which share
  // of a combined net quantity, so group by symbol and treat >1 as ambiguous rather than silently
  // attributing the WHOLE aggregate qty to every position that happens to share the symbol.
  const localsBySymbol = new Map();
  for (const pos of openLocal || []) {
    if (!localsBySymbol.has(pos.optionSymbol)) localsBySymbol.set(pos.optionSymbol, []);
    localsBySymbol.get(pos.optionSymbol).push(pos);
  }

  const toClose = [];
  const toKeep = [];
  const unknownBrokerPositions = [];
  for (const [symbol, positions] of localsBySymbol) {
    const brokerQty = netQtyBySymbol.get(symbol);
    // EMA5T trades futures both LONG and SHORT — a genuinely open SHORT reports a NEGATIVE
    // netQty at the broker, so only exactly 0 (or absent) means flat. Treating <= 0 as flat
    // (the old options-only-BUYS assumption) would silently reconcile a live open short to
    // CLOSED, losing all tracking/monitoring/SL of a real position.
    if (!brokerQty) {
      const np = npBySymbol.get(symbol);
      const realized = np ? Number(np.realized_profit ?? np.pl ?? np.realizedPnl ?? 0) || 0 : 0;
      // Flat at the broker: every local position on this symbol is genuinely closed, however many
      // there are. The broker only reports one realized figure for the whole (now-closed) net
      // exposure, so split it evenly rather than crediting/debiting it to just one of them.
      const share = positions.length > 0 ? realized / positions.length : 0;
      for (const position of positions) toClose.push({ position, realized: share });
    } else {
      const ambiguousGroup = positions.length > 1;
      for (const position of positions) {
        // Sanity-check the sign matches the position's recorded side. A mismatch is never treated
        // as flat/closed — an anomalous sign is still a live position that needs monitoring — it's
        // only flagged so the operator can see it, never silently swallowed.
        const expectedSign = position.side === "SHORT" ? -1 : 1;
        const signMismatch = Math.sign(brokerQty) !== expectedSign;
        toKeep.push({ position, brokerQty: Math.abs(brokerQty), signMismatch, ambiguousGroup });
      }
    }
  }

  // Reconciliation so far only ever checks LOCAL positions against the broker. A broker symbol
  // with a genuinely open net quantity that we have NO local record of at all (most likely a
  // crash between a confirmed fill and the following saveState()) would otherwise never surface —
  // it's real capital at risk that the bot doesn't know exists. We can't safely auto-adopt it (no
  // known strategy/timeframe/target/SL context to reconstruct), so just report it; the caller
  // decides how to react (block new entries until a human resolves it).
  for (const [symbol, brokerQty] of netQtyBySymbol) {
    if (brokerQty !== 0 && !localsBySymbol.has(symbol)) {
      unknownBrokerPositions.push({ symbol, brokerQty });
    }
  }

  return { toClose, toKeep, unknownBrokerPositions };
}

/**
 * Ensure an OPEN position has a live broker stop-loss. Re-arms one if the recorded SL order is
 * missing or no longer pending (cancelled/rejected/expired) — a held position with no broker
 * SL is exactly the unattended risk this whole tier targets.
 */
async function ensureStopLoss(position, session) {
  let alive = false;
  if (position.slOrderId) {
    if (CONFIG.PAPER_TRADING) {
      // Synthetic paper SL orders don't independently expire/fill at a broker — once armed,
      // treat as alive (paper's actual SL enforcement is the candle-level check in
      // monitorPositions; this order is for parity/observability with what live will do).
      alive = true;
    } else {
      try {
        const details = await getOrderDetails(position.slOrderId, session);
        alive = details.status === "PENDING";
      } catch (err) {
        console.error(`[AUTO-TRADER] Reconcile: SL status check failed for ${position.optionSymbol}:`, err.message);
        alive = false;
      }
    }
  }
  if (alive) return;
  const stopPrice = position.currentSL || position.stopLoss;
  try {
    const slOrder = await placeStopLossOrder({
      symbol: position.optionSymbol,
      qty: position.quantity,
      stopPrice,
      // BUY protects a SHORT (stop above entry); SELL protects a LONG (stop below entry).
      side: futuresOrderSide(position.side, "EXIT"),
      session,
      paperTrading: CONFIG.PAPER_TRADING,
      auditLogger: logAudit,
    });
    // A concurrent closePosition (e.g. emergencyStop's flattenAllPositions) may have already
    // finalized this position while placeStopLossOrder's broker round-trip was in flight. Writing
    // slOrderId now would orphan a genuinely-live broker order on a position nothing will ever
    // look at again (finalizeClose never clears slOrderId, and every later check gates on
    // status === "OPEN"). Cancel it immediately instead of tracking it.
    if (position.status !== "OPEN") {
      logAudit({ type: "SL_REARM_ORPHANED", optionSymbol: position.optionSymbol, slOrderId: slOrder.orderId, stopPrice });
      console.error(`[AUTO-TRADER] SL armed for ${position.optionSymbol} after it was already closed — cancelling orphaned order ${slOrder.orderId}`);
      if (!CONFIG.PAPER_TRADING) {
        try {
          await cancelOrder(slOrder.orderId, session, logAudit);
        } catch (err) {
          console.error(`[AUTO-TRADER] Could not cancel orphaned SL ${slOrder.orderId} for ${position.optionSymbol} — MANUAL REVIEW NEEDED:`, err.message);
          logAudit({ type: "SL_ORPHAN_CANCEL_FAILED", optionSymbol: position.optionSymbol, slOrderId: slOrder.orderId, error: err.message });
        }
      }
      return;
    }
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

  const { toClose, toKeep, unknownBrokerPositions } = planReconciliation(openLocal, netPositions);

  // A broker position we have NO local record of at all — most likely a crash between a confirmed
  // fill and the following saveState(). This is real, untracked capital: no known SL/target/strategy
  // context to safely auto-adopt it, so flag loudly and block new entries until a human resolves it,
  // matching this function's own stated principle — "if we can't verify what we hold, we don't trade."
  for (const u of unknownBrokerPositions) {
    logAudit({ type: "RECONCILE_UNKNOWN_BROKER_POSITION", symbol: u.symbol, brokerQty: u.brokerQty });
    console.error(
      `[AUTO-TRADER] Reconcile: broker shows an OPEN position on ${u.symbol} (net qty ${u.brokerQty}) with NO local record — ` +
        `likely a crash before this was saved. NOT auto-managed (no known SL/target) — new trades blocked until manually resolved.`
    );
  }

  for (const { position, realized } of toClose) {
    // Claim the SAME guard closePosition/reconcileStopLossOrders use: this loop awaits per-position
    // (cancelOrder below), and reconcilePositionsWithBroker can itself run while a concurrent
    // emergencyStop's un-awaited flattenAllPositions (or another in-flight close) is touching the
    // same position — without this, both could mutate status/realizedPnl/dailyRealizedPnL/
    // consecutiveLosses at once, double-counting P&L into the daily-loss breaker.
    if (closingPositionIds.has(position.id)) continue;
    closingPositionIds.add(position.id);
    try {
      if (position.status !== "OPEN") continue; // already finalized by the concurrent close
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
    } finally {
      closingPositionIds.delete(position.id);
    }
  }

  for (const { position, brokerQty, signMismatch, ambiguousGroup } of toKeep) {
    if (signMismatch) {
      logAudit({ type: "RECONCILE_SIDE_MISMATCH", optionSymbol: position.optionSymbol, localSide: position.side, brokerQty });
      console.error(`[AUTO-TRADER] Reconcile: broker qty sign doesn't match recorded side for ${position.optionSymbol} (side=${position.side}, brokerQty=${brokerQty}) — kept open, needs manual review.`);
    }
    if (ambiguousGroup) {
      logAudit({ type: "RECONCILE_AMBIGUOUS_GROUP", optionSymbol: position.optionSymbol, localQty: position.quantity, aggregateBrokerQty: brokerQty });
      console.error(`[AUTO-TRADER] Reconcile: multiple local positions share ${position.optionSymbol} — cannot attribute the aggregate broker qty (${brokerQty}) to any one of them; quantity NOT auto-corrected, needs manual review.`);
    } else if (!signMismatch && brokerQty !== position.quantity) {
      logAudit({ type: "RECONCILE_QTY_MISMATCH", optionSymbol: position.optionSymbol, localQty: position.quantity, brokerQty });
      position.quantity = brokerQty;
    }
    // Re-stream this option's ticks (subscriptions don't survive a restart) regardless.
    try {
      subscribeToSymbols([position.optionSymbol]);
    } catch (err) {
      console.error(`[AUTO-TRADER] Reconcile: resubscribe failed for ${position.optionSymbol}:`, err.message);
    }
    // Never auto-place a real broker order (a fresh SL) against data we already know is
    // unreliable — a wrong-side or wrong-qty stop is worse than a flagged gap waiting on manual
    // review. Positions in either state still keep whatever SL they already had.
    if (!signMismatch && !ambiguousGroup) {
      await ensureStopLoss(position, session);
      // Persist a newly self-healed SL order id immediately, not just at the end of this loop —
      // a crash before the trailing saveState() below would otherwise lose track of a real,
      // now-live broker SL order, and the next boot's reconcile would re-arm a DUPLICATE one.
      saveState();
    }
  }

  // An unknown broker position means we could NOT fully verify what we hold — block new entries
  // (existing tracked positions are untouched; their own SLs, if any, still protect them) until a
  // human resolves it, matching this function's fail-safe behavior on an outright fetch failure.
  reconcileOk = unknownBrokerPositions.length === 0;
  recalcDailyPnL();
  saveState();
  logAudit({ type: "RECONCILE_DONE", closed: toClose.length, kept: toKeep.length, unknown: unknownBrokerPositions.length });
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
    // Per-instrument session gate: only act on positions whose OWN market is currently open —
    // an NSE position isn't monitored during gold's evening session (its quotes are frozen and
    // any exit is the loop's force-close's job at its session boundary, exactly as before), and
    // a gold position keeps being monitored after 15:30 while its market runs to 23:30.
    if (getInstrumentPhaseNow(position.underlying) !== "OPEN") continue;
    try {
      // A live position must always have a resting broker stop. If it lost its SL (initial placement
      // failed, or the SL order was cancelled/expired), re-arm before anything else — self-heals the
      // rare naked window from a failed SL placement at entry.
      if (!CONFIG.PAPER_TRADING && !position.slOrderId) {
        await ensureStopLoss(position, session);
        // Persist immediately: a crash right after a self-healed SL is placed but before this
        // saves would leave a real, live broker SL order untracked on disk — the next boot's
        // reconcile would see slOrderId=null and re-arm a DUPLICATE live stop for the same position.
        saveState();
      }
      // Square-off is TIME-driven — checked BEFORE the quote fetch so a rate-limited or dead
      // feed at 15:15 (NSE) / 23:15 (gold) can never defer the exit to the session-boundary
      // force-close at a stale price (2026-07-14 audit). closePosition tolerates a stale LTP.
      if (isSquareOffTime(getSessionProfileFor(position.underlying))) {
        await closePosition(position, session, "SQUARE_OFF");
        continue;
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

// ─── OPTIONAL VIX-REGIME FILTER (MIN_VIX) ──────────────────────────────
// Re-added as an OPT-IN gate (CONFIG.MIN_VIX_FILTER, default false). The VIX quote is fetched only
// when the filter is enabled, so the default path makes zero extra API calls and behaves exactly as
// before. currentVix is refreshed once per trading-loop cycle in tradingLoop().
let currentVix = null;
async function fetchIndiaVix(session) {
  try {
    const data = await fyersDataFetch(`${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent("NSE:INDIAVIX-INDEX")}`, session);
    return Number(data.d?.[0]?.v?.lp) || null;
  } catch (err) {
    console.error("[AUTO-TRADER] India VIX fetch failed:", err.message);
    return null;
  }
}
function checkMinVixFilter() {
  if (!CONFIG.MIN_VIX_FILTER) return true;
  // Fail-CLOSED: if the filter is on but VIX is unavailable, don't trade (we can't confirm the regime).
  if (currentVix == null || currentVix < CONFIG.MIN_VIX) {
    console.log(`[AUTO-TRADER] MIN_VIX filter: VIX ${currentVix} < ${CONFIG.MIN_VIX} — no new entries`);
    logAudit({ type: "FILTER_BLOCKED", reason: "MIN_VIX", vix: currentVix, minVix: CONFIG.MIN_VIX });
    return false;
  }
  return true;
}

// ─── MAIN TRADING LOGIC ───────────────────────────────────────────────
function canTakeTrade(underlying) {
  if (CONFIG.EMERGENCY_STOP) {
    console.log("[AUTO-TRADER] EMERGENCY STOP ACTIVE");
    return false;
  }
  if (!reconcileOk) {
    console.log("[AUTO-TRADER] Broker reconciliation incomplete — no new entries");
    return false;
  }
  // Per-instrument session window (instruments.js): NSE profiles reproduce the old hardcoded
  // 9:15–15:00 exactly; gold's is 9:00–22:00. Global risk gates below are shared, as before.
  if (!isValidTradingTime(getSessionProfileFor(underlying))) return false;
  if (!checkDailyLossLimit()) return false;
  if (!checkMaxTrades()) return false;
  if (!checkTimeFilter(underlying)) return false;
  if (!checkCorrelationFilter(underlying)) return false;
  if (!checkMinVixFilter()) return false;
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
      // Keyed by (underlying, timeframe) — with multiple timeframes selected (the UI allows
      // checking several at once), keying by underlying alone let each timeframe's pass overwrite
      // the previous one, so getHealthSnapshot's feedStale check only ever saw whichever
      // timeframe was processed LAST, silently blind to a stale earlier one.
      latestData[`${underlying.name}:${tf}`] = {
        candles,
        lastUpdated: new Date().toISOString(),
        ltp: candles[candles.length - 1][4],
        timeframe: tf,
      };
      for (const strategy of CONFIG.SELECTED_STRATEGIES) {
        // Alerts/signals are keyed per (underlying, strategy, timeframe) so each timeframe runs
        // independently and never clobbers another timeframe's pending setup.
        const key = `${underlying.name}:${strategy}:${tf}m`;
        const alert = detectAlertCandle(candles, strategy, CONFIG.TREND_EMA_PERIOD);
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
// A wall-clock-hours window derived from candle count (tf * HISTORY_CANDLES) assumes the market
// trades continuously. NSE only trades ~6.25h/day, so that formula can fail to reach the PREVIOUS
// session at all right after a weekend/holiday — e.g. 15m x 80 candles = 20 hours back from
// Monday's open lands on SUNDAY, entirely missing Friday's session. An alert candle at one
// session's close breaking out at the next session's open is a completely normal EMA5T setup —
// that gap silently made it invisible to live/paper trading (processCandles just sees <6 candles
// and skips, no error). Look back a generous number of CALENDAR days instead: 21 days comfortably
// spans any weekend or holiday cluster and yields well over HISTORY_CANDLES(80) real trading
// candles for every selected timeframe (15/30/60m) — FYERS returns only the actual market candles
// within the range, so the wider window costs nothing but a slightly larger response.
const LOOKBACK_CALENDAR_DAYS = 21;

/** Pure: the epoch-seconds start of fetchLatestCandles' lookback window. Exported for unit tests. */
export function computeHistoryFromTs(nowSec = Math.floor(Date.now() / 1000)) {
  return nowSec - LOOKBACK_CALENDAR_DAYS * 24 * 60 * 60;
}

async function fetchLatestCandles(symbol, session, timeframeMinutes) {
  const tf = timeframeMinutes;
  const now = Math.floor(Date.now() / 1000);
  const from = computeHistoryFromTs(now);
  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=${tf}&date_format=0&range_from=${from}&range_to=${now}&cont_flag=1`;
  const data = await fyersDataFetch(url, session);
  return data.candles || [];
}

// ─── EMA5T FUTURES ─────────────────────────────────────────────────
/** FYERS futures symbol, e.g. NSE:BANKNIFTY26JULFUT or MCX:GOLDM26AUGFUT. Delegates to the
 * shared builder in instruments.js (single source of truth with routes/backtest.js); kept
 * exported here for back-compat with existing unit tests/callers. */
export function buildFuturesSymbol(underlyingName, year, monthIdx, exchange = "NSE") {
  return buildFuturesSymbolShared(underlyingName, year, monthIdx, exchange);
}

/**
 * Map an EMA5T position direction + order purpose to the correct broker order side. EMA5T trades
 * both LONG and SHORT futures, so "closing" or "protecting" a position is BUY for a SHORT and
 * SELL for a LONG — the opposite of the option-buying flow's always-SELL-to-exit assumption that
 * placeMarketExit/placeStopLossOrder used to hardcode. Pure/exported for unit tests.
 */
export function futuresOrderSide(dir, purpose) {
  if (dir === "LONG") return purpose === "ENTRY" ? ORDER_SIDE.BUY : ORDER_SIDE.SELL;
  if (dir === "SHORT") return purpose === "ENTRY" ? ORDER_SIDE.SELL : ORDER_SIDE.BUY;
  throw new Error(`futuresOrderSide: unknown direction "${dir}"`);
}

/**
 * Limit price for an SL-L resting entry: caps how much worse than the alert level the order will
 * accept before it just stays resting instead of filling badly (LONG: limit >= stop, SELL-side
 * entries mirror it below the stop). Pure/exported for unit tests.
 * TODO(verify FYERS docs): confirm FYERS v3's actual stop-limit price-relationship requirement
 * matches this standard convention before ever trusting it outside paper mode.
 * TODO(verify): OPTION_TICK (₹0.05) is confirmed for option premiums — confirm NSE index futures
 * (NIFTY/BANKNIFTY) use the same tick size before relying on roundToTick here.
 */
export function computeStopLimitPrice(dir, stopPrice, bufferPct, tick = null) {
  const stop = Number(stopPrice) || 0;
  if (stop <= 0) return 0;
  const pct = Number(bufferPct) || 0;
  // Optional explicit tick (review finding): MCX gold quotes in ₹1 ticks, not the ₹0.05 grid
  // roundToTick assumes — a 0.05-snapped SL-L price would be exchange-rejected on MCX while
  // paper mode happily "fills" it. Callers pass the instrument's tick (getEntryTick below);
  // omitted → the long-standing roundToTick behavior, byte-identical for every existing caller.
  const snap = (v, mode) => (tick ? (mode === "up" ? Math.ceil(v / tick) * tick : Math.floor(v / tick) * tick) : roundToTick(v, mode));
  if (dir === "LONG") return snap(stop * (1 + pct / 100), "up");
  if (dir === "SHORT") return snap(stop * (1 - pct / 100), "down");
  throw new Error(`computeStopLimitPrice: unknown direction "${dir}"`);
}

// Entry-order price tick per instrument. MCX GOLD/GOLDM tick = ₹1; NSE index futures ₹0.05.
// TODO(verify-before-live): confirm both against the FYERS contract spec before any real SL-L order.
function getEntryTick(underlying) {
  return (underlying?.exchange || "NSE") === "MCX" ? 1 : null; // null → legacy 0.05 roundToTick path
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
  // Cache key includes the contract root so a GOLD↔GOLDM config flip can never serve the other
  // contract's cached symbol (indices: root === name, key unchanged in effect).
  const spec = getContractSpec(underlying);
  const exchange = underlying.exchange || "NSE";
  const cacheKey = `${underlying.name}:${spec.root}`;
  if (futSymbolCache.symbols[cacheKey]) return futSymbolCache.symbols[cacheKey];
  const now = new Date();
  // NSE monthlies probe 3 consecutive months (unchanged); MCX probes 4 — GOLD lists bi-monthly
  // (FEB/APR/JUN/AUG/OCT/DEC), and 4 consecutive months always contain an active even month
  // (unlisted odd months just fail the quote probe and are skipped).
  for (let k = 0; k < probeMonthsFor(exchange); k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    const sym = buildFuturesSymbol(spec.root, d.getUTCFullYear(), d.getUTCMonth(), exchange);
    try {
      const data = await fyersDataFetch(`${FYERS_DATA_BASE}/quotes?symbols=${encodeURIComponent(sym)}`, session);
      if ((data.d?.[0]?.v?.lp || 0) > 0) {
        futSymbolCache.symbols[cacheKey] = sym;
        return sym;
      }
    } catch {
      /* try the next month */
    }
  }
  return null;
}

/**
 * Check whether a resting EMA5T entry order has filled. LIVE: a real broker order-status lookup.
 * PAPER: the exact candle-crossing check the original paper-only simulation used (a resting
 * stop-entry must NOT instant-fill the way waitForFill's generic paper branch does — it only
 * fills when a LATER candle actually crosses the level). Returns a normalized
 * { status: "FILLED"|"PENDING"|"REJECTED"|"CANCELLED"|"EXPIRED"|"UNKNOWN", avgFillPrice?, filledQty? }.
 */
export async function checkEntryOrderFill({ paperTrading, entryOrderId, dir, level, limitPrice = 0, latestCandle, qty, session }) {
  // Applies to BOTH modes: a pending entry with no entryOrderId was gate-skipped at arm time
  // (checkTimeFilter/canTakeTrade/margin failed — see manageFuturesPendingInner's EMA5T_ENTRY_
  // ORDER_SKIPPED branch), so it was never actually placed anywhere. Without this check up front,
  // the paper branch below would judge it purely by candle-crossing and could silently "fill" a
  // trade the correlation filter, margin cap, or daily-loss gate explicitly blocked — paper mode
  // would then be LESS safe than live (which already short-circuits to PENDING here).
  if (!entryOrderId) return { status: "PENDING", filledQty: 0 };
  if (paperTrading) {
    // STRICT crossing — the validated engine enters only on high > level / low < level
    // (backtest.js:494); an exact-touch bar is NOT a fill. Was >=/<= (2026-07-14 audit).
    const crossed = dir === "LONG" ? latestCandle[2] > level : latestCandle[3] < level;
    if (!crossed) return { status: "PENDING", filledQty: 0 };
    // Engine's slippage default (backtest.js:247) — the constant every validated run used.
    // The old 0.0005 here claimed validation parity but the engine default is 0.0002.
    const slip = 0.0002;
    // If the candle's OPEN already cleared the level, the market gapped straight through it —
    // a real resting stop order fills at (or near) the open, not at the stale nominal level.
    // Without this, paper mode always pretends the fill happened right at the alert level
    // regardless of how big the actual gap was, understating gap risk entirely.
    const open = latestCandle[1];
    const gappedThrough = dir === "LONG" ? open >= level : open <= level;
    const fillBase = gappedThrough ? open : level;
    const avgFillPrice = dir === "LONG" ? fillBase * (1 + slip) : fillBase * (1 - slip);
    // SL-L semantics: a real stop-limit never fills worse than its limit — it just keeps resting.
    // Without this, paper mode would report a fill an SL-L order could never actually have gotten,
    // exactly on the big-gap days a limit price exists to protect against.
    if (Number(limitPrice) > 0) {
      const exceedsLimit = dir === "LONG" ? avgFillPrice > limitPrice : avgFillPrice < limitPrice;
      if (exceedsLimit) return { status: "PENDING", filledQty: 0 };
    }
    return { status: "FILLED", avgFillPrice, filledQty: qty };
  }
  return getOrderDetails(entryOrderId, session);
}

/**
 * Recompute the profit target from the ACTUAL fill price at entry — the stop-loss stays at the
 * alert candle's fixed structural level (its low/high, matching the real resting SL order placed
 * there), but the target must scale with the real entry: on a gap, the entry moves away from the
 * fixed stop (real risk grows) while a target still anchored to the stale nominal alert level
 * would sit closer to the new entry, quietly shrinking the achieved reward below the intended
 * ratio. If the fill happened right at the nominal level (no gap), this reproduces the original
 * target exactly. Exported for unit tests.
 */
export function computeGapAdjustedTarget(dir, entryFillPrice, stopLoss, targetMultiplier = 2) {
  const risk = Math.abs(entryFillPrice - stopLoss);
  return dir === "LONG" ? entryFillPrice + risk * targetMultiplier : entryFillPrice - risk * targetMultiplier;
}

/**
 * Cancel a resting EMA5T entry order (or no-op for one never actually placed / a paper record).
 * Returns { ok:true } once safely gone, { ok:false } if the cancel could not be confirmed — the
 * caller must NOT delete/overwrite the local record in that case (the order may still be live;
 * losing track of it is worse than a one-cycle delay in expiring it).
 */
export async function cancelPendingEntryOrder(p, paperTrading, session) {
  if (!p.entryOrderId || paperTrading) return { ok: true };
  try {
    await cancelOrder(p.entryOrderId, session, logAudit);
    return { ok: true };
  } catch (err) {
    console.error(`[AUTO-TRADER] Could not cancel EMA5T entry order ${p.entryOrderId} for ${p.key}:`, err.message);
    return { ok: false };
  }
}

/**
 * EMA5T resting stop-entry lifecycle (called once per underlying+timeframe per cycle, INSTEAD of
 * the option/breakout flow). ONE unified path for both paper and live: placeStopEntry is called
 * either way (paperTrading threaded through — placeOrder's own paper branch fabricates a
 * synthetic order id + audit entry with no real API call), and the ONLY paper/live branch point is
 * checkEntryOrderFill above. This means paper mode now exercises the exact same order-placement,
 * cancel-discipline, and margin-aggregation code live will run — not a separate simulated path.
 * Errors are caught here (not left to propagate) so one flaky broker call for one timeframe can
 * never abort the sibling timeframes' processing in the same processCandles cycle.
 *
 * Guarded entry point (mirrors closePosition/closingPositionIds): claims args.key in
 * pendingKeysInFlight synchronously before any await, so two invocations for the same key can
 * never both reach manageFuturesPendingInner concurrently. Exported only for the reentrancy
 * test — not part of the public API surface used by routes.
 */
/**
 * Entry-window check judged by the TRIGGER BAR's start time — engine parity (2026-07-14 audit):
 * the validated engine gates entries on the trigger candle's clock (liveEntryGate receives the
 * BAR's hour), so a bar STARTING before the cutoff may trigger even though it closes after.
 * checkTimeFilter's wall clock at arm time (bar close + poll) structurally missed every
 * validated trade whose trigger bar straddles the cutoff (14:00 NSE / 22:00 gold).
 */
function barWithinEntryWindowFut(underlying, barStartSec) {
  const p = getSessionProfileFor(underlying) || {};
  const dec = ((Number(barStartSec) + 19800) % 86400) / 3600;
  const cutoffHour = p.entryCutoffHour ?? 14;
  return dec >= (p.sessionStartDecimal ?? 9.25) && Math.floor(dec) < cutoffHour;
}

export async function manageFuturesPending(args) {
  if (pendingKeysInFlight.has(args.key)) return;
  pendingKeysInFlight.add(args.key);
  try {
    await manageFuturesPendingInner(args);
  } catch (err) {
    console.error(`[AUTO-TRADER] EMA5T pending-entry cycle failed for ${args.key}:`, err.message);
    logAudit({ type: "EMA5T_PENDING_CYCLE_ERROR", key: args.key, error: err.message });
  } finally {
    pendingKeysInFlight.delete(args.key);
  }
}

async function manageFuturesPendingInner({ key, underlying, tf, candles, futSymbol, alert, session }) {
  const paperTrading = CONFIG.PAPER_TRADING;
  const latest = candles[candles.length - 1]; // last COMPLETED candle (in-progress dropped upstream)

  // Never make a fill or arm decision from stale candle data — a frozen tick feed (a known,
  // documented failure mode: the FYERS data-socket SDK singleton can pin to a dead token and stop
  // updating) could otherwise silently feed an old `latest` candle into checkEntryOrderFill's
  // paper-mode fill/gap-price decision, with no freshness check ever consulted before this. Skip
  // this cycle entirely and retry once fresh data arrives — matches how staleness is already
  // treated elsewhere in this function (a reason to hold off, not to act).
  if (isCandleStale(candles, tf)) return;
  // Absolute variant of the same rule: the latest completed candle must be from TODAY's IST
  // session — belt-and-braces over isCandleStale's tolerance math across weekends/holidays.
  // Deliberately checks the LATEST bar, not the alert bar: the engine carries an alert across
  // the day boundary and fills it at today's prices (2026-07-13's gold shorts at Monday's real
  // 143,334 open — validated behavior); a first-cut gate on alert age blocked those and was a
  // live≠backtest regression, reverted same week.
  if (istDateKey(latest[0]) !== istDateKey()) return;

  // ── Step 1: resolve any EXISTING pending entry's fate BEFORE considering a new alert — a fill
  // must never be lost to a same-cycle overwrite by a fresh alert (see manageFuturesPending doc).
  const p = pendingEntries.get(key);
  if (p) {
    const fillCheck = await checkEntryOrderFill({
      paperTrading, entryOrderId: p.entryOrderId, dir: p.dir, level: p.level, limitPrice: p.limitPrice || 0, latestCandle: latest, qty: getContractSpec(underlying).qty, session,
    });

    const filledQty = Number(fillCheck.filledQty) || 0;
    if (fillCheck.status === "FILLED" || (fillCheck.status === "PENDING" && filledQty > 0)) {
      // FYERS reports a partial fill as PENDING with filledQty>0 (no dedicated PARTIAL code) — a
      // partial is handled identically to a full fill, just sized at whatever actually filled.
      const signalId = `${key}-${p.alertTimestamp}-${p.dir}`;
      if (processedSignals.has(signalId)) {
        // Already turned into a position on a prior cycle (persisted-state race after a crash) —
        // never open a second one for the same fill.
        pendingEntries.delete(key);
        saveState();
        return;
      }

      const fullQty = getContractSpec(underlying).qty;
      const qty = Math.min(filledQty || fullQty, fullQty);
      const isPartial = qty < fullQty;
      const entryFillPrice = fillCheck.avgFillPrice || p.level;
      // Gap-adjust the target to the REAL fill (see computeGapAdjustedTarget) — never leave it
      // anchored to the stale nominal alert level.
      const adjustedTarget = computeGapAdjustedTarget(p.dir, entryFillPrice, p.stopLoss, CONFIG.TARGET_MULTIPLIER);

      // All local state mutations happen BEFORE the one saveState() below, so a crash right
      // after can never persist "signal processed" without the position it created (which would
      // orphan a real live position with zero local tracking — worse than a duplicate).
      processedSignals.add(signalId);
      pendingEntries.delete(key);

      const position = {
        id: paperTrading ? `PAPER-FUT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` : `FUT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        entryOrderId: p.entryOrderId,
        slOrderId: null,
        marginAtEntry: p.marginEst,
        kind: "FUT",
        side: p.dir,
        optionSymbol: futSymbol, // symbol field shared with the monitor/quote/audit plumbing
        quantity: qty,
        entryQty: qty,
        origEntryQty: qty,
        avgFillPrice: entryFillPrice,
        entryPrice: p.level,
        stopLoss: p.stopLoss,
        target: adjustedTarget,
        currentSL: p.stopLoss,
        unrealizedPnl: 0,
        realizedPnl: 0,
        pnl: 0,
        status: "OPEN",
        entryTime: new Date().toISOString(),
        signal: { type: p.dir, strategy: "EMA5T", timeframe: tf, entryPrice: p.level, stopLoss: p.stopLoss, target: adjustedTarget, underlying: underlying.name },
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
      logAudit({ type: "POSITION_OPENED", kind: "FUT", strategy: "EMA5T", orderId: position.id, optionSymbol: futSymbol, side: p.dir, qty, entry: entryFillPrice, stopLoss: p.stopLoss, target: adjustedTarget, nominalTarget: p.target, timeframe: tf });
      console.log(`[AUTO-TRADER] EMA5T ${paperTrading ? "PAPER" : "LIVE"} ${p.dir} ${futSymbol} @ ${entryFillPrice.toFixed(2)} (SL ${p.stopLoss}, target ${adjustedTarget.toFixed(2)}, ${tf}m)`);
      recalcDailyPnL();
      saveState();

      if (isPartial) {
        // Cancel the unfilled remainder so it doesn't keep resting and fill later as an
        // unexpected second leg on a position we're already tracking as fully formed. Unlike
        // every other cancel site in this file, there's no local record left to preserve on
        // failure — pendingEntries[key] and processedSignals already dropped/claimed this alert
        // the moment the fill was detected, above — so a failed cancel here can't be retried by
        // anything else in the system; it's an orphaned live order with zero local reference.
        // Loudly audit it (matching flattenAllPositions's "MANUAL REVIEW NEEDED" pattern) so it's
        // at least visible to the operator rather than silently swallowed.
        const cancelled = await cancelPendingEntryOrder(p, paperTrading, session);
        if (!cancelled.ok) {
          console.error(`[AUTO-TRADER] Could not confirm cancellation of the unfilled remainder for ${key} (entryOrderId ${p.entryOrderId}) — MANUAL REVIEW NEEDED: it may still be resting live at the broker with no local tracking.`);
          logAudit({ type: "ORPHANED_ENTRY_REMAINDER", key, entryOrderId: p.entryOrderId, dir: p.dir, level: p.level });
          alertCritical("BOT_ORPHANED_ORDER", `Partial fill on ${key}: remainder order ${p.entryOrderId} could not be cancelled and may still be working at the broker. MANUAL REVIEW.`, {});
        }
      }
      // Never leave a live (or paper-parity) position without a resting protective stop for even
      // one avoidable cycle — don't wait for the next monitorPositions pass to catch it up.
      await ensureStopLoss(position, session);
      saveState();
      return;
    }

    if (["REJECTED", "CANCELLED", "EXPIRED"].includes(fillCheck.status)) {
      logAudit({ type: "EMA5T_ENTRY_ORDER_FAILED", key, status: fillCheck.status });
      pendingEntries.delete(key);
      saveState();
      return;
    }

    // Still resting (PENDING, nothing filled yet) — re-validate it's still worth holding. Any gate
    // tripping cancels the resting order (real cancelOrder live; a no-op for paper/never-placed).
    // Data freshness is already guaranteed by the function's own top-of-function stale check.
    const timeOk = barWithinEntryWindowFut(underlying, latest[0]);
    const riskOk = canTakeTrade(underlying);
    if (!timeOk || !riskOk) {
      const cancelled = await cancelPendingEntryOrder(p, paperTrading, session);
      if (!cancelled.ok) return; // couldn't confirm — leave tracked, retry the cancel next cycle
      const reason = !timeOk ? "TIME" : "RISK_GATE";
      pendingEntries.delete(key);
      saveState();
      logAudit({ type: "EMA5T_PENDING_CANCELLED", key, reason });
      return;
    }
    // Still valid, still resting — fall through in case a NEW alert should supersede it below.
  }

  // ── Step 2: arm/re-arm on a new or changed alert ──
  if (!alert) return;

  // Never arm a second concurrent position on the SAME underlying+timeframe. The validated
  // backtest (routes/backtest.js) can't take a second entry while one is open — its main loop
  // structurally skips entry logic whenever `position` is truthy — but nothing here enforced the
  // same rule: checkCorrelationFilter only compares DIFFERENT underlyings, and once a pending
  // entry FILLS it's deleted from pendingEntries (Step 1), so a fresh alert on this exact key
  // could otherwise arm and fill a second, untested-by-backtest position while the first is still
  // open — doubling real exposure/margin on one underlying+timeframe.
  if (hasOpenPositionForKey(openPositions, underlying.name, tf)) return;

  const existing = pendingEntries.get(key);
  // "Unchanged" only counts when the pending actually HAS a working order — a null-id pending
  // (placement failed / gates were closed at arm time) must fall through and retry now that this
  // cycle's gates may pass (2026-07-14 audit: one transient failure latched the alert un-armed).
  if (existing && existing.alertTimestamp === alert.timestamp && existing.entryOrderId) return; // no change

  const dir = alert.type === "BULLISH_ALERT" ? "LONG" : "SHORT";
  const level = dir === "LONG" ? alert.high : alert.low;
  const sl = dir === "LONG" ? alert.low : alert.high;
  const risk = Math.abs(level - sl);
  if (risk <= 0) return;

  // This exact alert (same bar, same direction) already became a position on a prior cycle.
  // detectAlertCandle keeps reporting the SAME bar (same timestamp) for as long as it remains
  // candles[length-2] — i.e. every ~30s poll until the NEXT candle closes — and Step 1 above
  // already deleted pendingEntries for this key the moment it filled, so `existing` is now
  // undefined and the "no change" guard above can't catch this. Without this check, the very
  // next poll after a fill would arm an identical duplicate resting order at the same level.
  const signalId = `${key}-${alert.timestamp}-${dir}`;
  if (processedSignals.has(signalId)) return;

  // Engine parity (2026-07-14 audit): the engine records alerts only while FLAT and nulls the
  // alert on exit — an alert bar that completed while a position was open (other than the exit
  // bar itself) can never arm. Without this, an intra-bar exit revives a mid-position alert and
  // the next cycle retro-fills it from an already-elapsed bar — a trade no backtest contains.
  const lastExit = lastExitAtByKey.get(key);
  if (lastExit && alert.timestamp + Number(tf) * 60 <= lastExit) {
    processedSignals.add(signalId);
    logAudit({ type: "EMA5T_ALERT_DURING_POSITION", key, dir, alertTimestamp: alert.timestamp, lastExitAt: lastExit });
    saveState();
    return;
  }

  // A previous resting order for the OLD level must be cancelled before arming the new one.
  if (existing) {
    const cancelled = await cancelPendingEntryOrder(existing, paperTrading, session);
    if (!cancelled.ok) return; // couldn't confirm the old order is gone — don't overwrite it yet
    // Drop the now-cancelled record BEFORE the margin check below — otherwise its marginEst is
    // still counted (it's keyed by `key`, about to be overwritten anyway) on top of the new
    // entry's own marginReq, double-counting this same slot's margin and needlessly blocking arms.
    pendingEntries.delete(key);
  }

  const target = dir === "LONG" ? level + CONFIG.TARGET_MULTIPLIER * risk : level - CONFIG.TARGET_MULTIPLIER * risk;
  const marginReq = getContractSpec(underlying).marginPerLot;
  const committedMargin = computeCommittedMargin(openPositions, pendingEntries);
  const dataFresh = !isCandleStale(candles, tf);

  const entryLimitPrice = CONFIG.USE_STOPLIMIT_ENTRIES && CONFIG.LIMIT_BUFFER_PCT > 0
    ? computeStopLimitPrice(dir, level, CONFIG.LIMIT_BUFFER_PCT, getEntryTick(underlying))
    : 0;

  let entryOrderId = null;
  if (barWithinEntryWindowFut(underlying, latest[0]) && canTakeTrade(underlying) && dataFresh && committedMargin + marginReq <= CONFIG.CAPITAL) {
    try {
      const order = await placeStopEntry({
        symbol: futSymbol,
        qty: getContractSpec(underlying).qty,
        side: futuresOrderSide(dir, "ENTRY"),
        stopPrice: level,
        limitPrice: entryLimitPrice,
        session,
        paperTrading,
        auditLogger: logAudit,
      });
      entryOrderId = order.orderId;
      logAudit({ type: "EMA5T_ENTRY_ORDER_PLACED", key, dir, level, limitPrice: entryLimitPrice, stopLoss: sl, timeframe: tf, orderId: entryOrderId });
    } catch (err) {
      console.error(`[AUTO-TRADER] Failed to place EMA5T entry order for ${key}:`, err.message);
      logAudit({ type: "EMA5T_ENTRY_ORDER_PLACE_FAILED", key, error: err.message });
    }
  } else {
    logAudit({ type: "EMA5T_ENTRY_ORDER_SKIPPED", key, dir, level, timeframe: tf });
  }

  pendingEntries.set(key, {
    key,
    strategy: "EMA5T",
    underlying: underlying.name,
    timeframe: tf,
    dir,
    level,
    limitPrice: entryLimitPrice,
    stopLoss: sl,
    target,
    alertTimestamp: alert.timestamp,
    createdAt: new Date().toISOString(),
    entryOrderId,
    marginEst: marginReq,
  });
  saveState();
  logAudit({ type: "EMA5T_PENDING_ARMED", key, dir, level, stopLoss: sl, timeframe: tf, live: !!entryOrderId });
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

// The "trading day" boundary must be IST, not the server host's local timezone — checkTimeFilter/
// isSquareOffTime already compute IST explicitly for the same reason (a UTC or other-TZ host would
// otherwise roll the day over at the wrong wall-clock moment). d.getTime() is an absolute,
// TZ-independent instant; shifting it by the fixed IST offset and reading off its UTC calendar date
// yields the IST calendar date regardless of the server's own timezone.
function getISTDateKey(d = new Date()) {
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

// Single place that resets every per-day counter/collection. Used by BOTH tradingLoop's own
// day-boundary check and startAutoTrader's pre-loop check — they used to reset a different subset
// (startAutoTrader never cleared pendingEntries/activeAlerts/processedSignals/closed positions),
// which meant a restart spanning a day boundary set lastTradeDate to "today" without clearing them,
// silently disabling tradingLoop's own (more complete) reset for the rest of that day.
function resetDailyCounters(today) {
  todayTrades = 0;
  lastTradeDate = today;
  dailyPnL = 0;
  dailyRealizedPnL = 0;
  consecutiveLosses = 0;
  activeAlerts.clear();
  openPositions = openPositions.filter((p) => p.status !== "CLOSED");
  processedSignals.clear();
  pendingEntries.clear(); // resting stop entries never carry across days
  lastExitAtByKey.clear(); // yesterday's exits never kill today's alerts
}

// ΓöÇΓöÇΓöÇ MAIN LOOP ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function tradingLoop(gen) {
  // Generation guard: a stop→start while a prior cycle is mid-await must not leave TWO chains
  // rescheduling forever. Session comes from the module var so a morning re-login adopted via
  // startAutoTrader immediately applies to the running loop (2026-07-14 audit: the loop was
  // pinned to its Start-time session and traded a whole day on a dead token).
  if (!isRunning || gen !== loopGeneration) return;
  const session = currentSession;
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
    const today = getISTDateKey();
    if (lastTradeDate !== today) {
      resetDailyCounters(today);
      console.log(`[AUTO-TRADER] New day - all counters reset`);
      saveState();
    }
    const { hours, minutes } = getISTTime();
    const timeStr = `${hours}:${minutes.toString().padStart(2, "0")}`;
    // Per-instrument session plan (instruments.js computeLoopPlan — pure, truth-table-tested):
    // WHO scans, WHOSE positions force-close, at WHAT cadence. Index-only selections reproduce
    // the old hardcoded 9:15/15:30 branch table exactly; with GOLD selected, gold keeps scanning
    // and monitoring until 23:30 while index positions still force-close at 15:30. Instruments
    // are planned over ALL underlyings (not just selected) so a position on a deselected
    // instrument is still monitored and force-closed by its own session clock.
    const activeNames = new Set(getActiveUnderlyings().map((u) => u.name));
    const tradingDayByExchange = {
      NSE: isInstrumentTradingDay("NSE"),
      MCX: isInstrumentTradingDay("MCX"),
    };
    const plan = computeLoopPlan({
      istMinutes: hours * 60 + minutes,
      instruments: CONFIG.UNDERLYINGS.map((u) => ({
        name: u.name,
        active: activeNames.has(u.name),
        profile: getSessionProfileFor(u),
        isTradingDay: tradingDayByExchange[u.exchange || "NSE"] ?? tradingDayByExchange.NSE,
      })),
      openPositionUnderlyings: openPositions.filter((p) => p.status === "OPEN").map((p) => p.underlying),
      defaultPollMs: CONFIG.POLL_INTERVAL_MS,
    });
    marketStatus = plan.statusString;
    rescheduleMs = plan.rescheduleMs;

    // Force-close positions whose OWN instrument's session is over (per-position, not blanket).
    if (plan.forceCloseList.length) {
      const forceClose = new Set(plan.forceCloseList);
      console.log(`[AUTO-TRADER] Session over for ${plan.forceCloseList.join(",")} IST (${timeStr}) - closing their positions`);
      for (const pos of openPositions.filter((p) => p.status === "OPEN" && forceClose.has(p.underlying))) {
        try {
          await closePosition(pos, session, "MARKET_CLOSE");
        } catch (err) {
          console.error(`[AUTO-TRADER] Market-close exit failed for ${pos.optionSymbol}:`, err.message);
        }
      }
    }

    if (plan.anyOpen) {
      // If startup reconciliation couldn't complete (e.g. a transient positions-fetch failure),
      // retry it here so the engine self-heals and can resume taking trades without a restart.
      if (!reconcileOk) {
        await reconcilePositionsWithBroker(session);
      }
      // Refresh India VIX only when the optional MIN_VIX regime filter is enabled (else no fetch).
      currentVix = CONFIG.MIN_VIX_FILTER ? await fetchIndiaVix(session) : null;
      const scanSet = new Set(plan.scanList);
      for (const underlying of getActiveUnderlyings()) {
        if (scanSet.has(underlying.name)) {
          await processCandles(underlying, session);
        }
      }
      await monitorPositions(session);
    } else {
      console.log(`[AUTO-TRADER] ${plan.statusString} IST (${timeStr})`);
    }
  } catch (err) {
    console.error(`[AUTO-TRADER] Trading loop cycle error:`, err.message);
    logAudit({ type: "LOOP_ERROR", error: err.message });
    // Page the operator on repeated cycle failures (throttled to once per 10 min).
    if (Date.now() - lastLoopErrorAlertAt > 10 * 60 * 1000) {
      lastLoopErrorAlertAt = Date.now();
      alertCritical("BOT_LOOP_ERROR", `Futures bot loop error: ${err.message}`, {});
    }
  } finally {
    if (isRunning && gen === loopGeneration) {
      pollInterval = setTimeout(() => tradingLoop(gen), rescheduleMs);
    }
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────
export async function startAutoTrader(sessionId) {
  if (isRunning) {
    // Adopt the fresh session (morning re-login pressing Start again): the running loop reads
    // currentSession each cycle, so this un-pins it from a dying overnight token immediately.
    const { getSession } = await import("../routes/auth.js");
    const fresh = getSession(sessionId);
    if (fresh && fresh !== currentSession) {
      currentSession = fresh;
      logAudit({ type: "SESSION_ADOPTED" });
      return { status: "SESSION_ADOPTED" };
    }
    return { status: "ALREADY_RUNNING" };
  }
  // Claim isRunning IMMEDIATELY — before the first await — not after the whole startup sequence
  // completes. The dynamic import below already yields to the event loop, so a later claim leaves
  // a window where TWO concurrent Start calls can both pass the guard above (double-scheduling two
  // independent tradingLoop timer chains), and where setPaperTrading()/updateConfig()'s "only while
  // stopped" mode-switch guard (which checks isRunning) doesn't cover the capital-sizing decision
  // a few lines below — letting a concurrent mode flip desync CONFIG.CAPITAL (sized for the OLD
  // mode) from CONFIG.PAPER_TRADING (the NEW mode). Reset on any early failure so a rejected start
  // never leaves the bot stuck reporting isRunning=true.
  isRunning = true;
  try {
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
    // Preserve same-day risk counters across a restart so circuit breakers (daily-loss,
    // consecutive-losses, max-trades) are not silently reset mid-session. loadState() has
    // already restored them; only roll over when the persisted state is from a prior day — and
    // when it does, reset the SAME full set tradingLoop's own day-boundary check does (see
    // resetDailyCounters), so a restart spanning a day boundary can't leave pendingEntries/
    // activeAlerts/processedSignals stale for the rest of that day.
    const today = getISTDateKey();
    if (lastTradeDate !== today) {
      resetDailyCounters(today);
    }

    // Verify locally-tracked positions against the broker BEFORE the loop can act. This prevents
    // a phantom position (closed at the broker while we were down) from triggering a naked exit,
    // and re-arms the broker SL + tick subscription for anything still genuinely held. Blocks new
    // entries (reconcileOk stays false) if it can't complete.
    await reconcilePositionsWithBroker(session);

    saveState(); // persist desiredRunning=true for crash forensics
    tradingLoop(++loopGeneration);
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
        trendEmaPeriod: CONFIG.TREND_EMA_PERIOD,
        targetMultiplier: CONFIG.TARGET_MULTIPLIER,
      },
      startedAt: new Date().toISOString(),
    };
  } catch (err) {
    isRunning = false;
    throw err;
  }
}

export function stopAutoTrader() {
  if (!isRunning) return { status: "NOT_RUNNING" };
  isRunning = false;
  loopGeneration++; // invalidate any in-flight cycle's reschedule
  saveState(); // persist desiredRunning=false
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
  // Cancel every resting EMA5T stop-entry order FIRST. An emergency stop must guarantee no NEW
  // position can appear after it returns — closing what's already OPEN is not enough. Without
  // this, a resting order left armed at the broker can still fill later with the trading loop no
  // longer running to notice: a completely untracked, unmonitored live position.
  for (const [key, p] of pendingEntries) {
    try {
      const cancelled = await cancelPendingEntryOrder(p, CONFIG.PAPER_TRADING, currentSession);
      if (cancelled.ok) {
        pendingEntries.delete(key);
        logAudit({ type: "EMA5T_PENDING_CANCELLED", key, reason });
      } else {
        console.error(`[AUTO-TRADER] ${reason}: could not confirm cancellation of resting entry ${key} — MANUAL REVIEW NEEDED`);
        logAudit({ type: "EMA5T_PENDING_CANCEL_FAILED", key, reason });
      }
    } catch (err) {
      console.error(`[AUTO-TRADER] ${reason}: error cancelling resting entry ${key}:`, err.message);
      logAudit({ type: "EMA5T_PENDING_CANCEL_FAILED", key, reason, error: err.message });
    }
  }
  saveState();

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
  // A "connected" socket that stopped delivering fresh candles is otherwise invisible to the
  // health score — surface it if ANY actively-scanned underlying's last candle is stale.
  const feedStale = Object.values(latestData).some((d) => isCandleStale(d.candles, d.timeframe));
  return computeHealthSnapshot({
    isRunning,
    wsConnected: !!(ws && ws.isConnected),
    emergencyStop: CONFIG.EMERGENCY_STOP,
    consecutiveLosses,
    maxConsecutiveLosses: CONFIG.MAX_CONSECUTIVE_LOSSES,
    marketOpen: isNseMarketOpen(),
    feedStale,
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
    // The config form (AutoTrade.tsx) hydrates from these on load. Without them, Max Trades/Day
    // and Max Risk/Day silently reverted to their hardcoded UI defaults (10 / 2) on every reload,
    // and the next save clobbered the persisted values back. Keys MUST match what the form reads:
    // status.maxTrades and status.maxRiskPerDay.
    maxTrades: CONFIG.MAX_TRADES_PER_DAY,
    maxRiskPerDay: CONFIG.MAX_RISK_PER_DAY_PERCENT,
    paperTrading: CONFIG.PAPER_TRADING,
    emergencyStop: CONFIG.EMERGENCY_STOP,
    // Token health so the UI can warn when the broker session has died mid-run (see noteAuthFailure).
    authHealthy: consecutiveAuthFailures < 3,
    consecutiveAuthFailures,
    positionSizingMode: CONFIG.POSITION_SIZING_MODE,
    fixedLots: CONFIG.FIXED_LOTS,
    allowCorrelatedTrades: CONFIG.ALLOW_CORRELATED_TRADES, // same round-trip bug: form reads status.allowCorrelatedTrades
    selectedStrategies: CONFIG.SELECTED_STRATEGIES,
    selectedInstruments: CONFIG.SELECTED_INSTRUMENTS,
    selectedTimeframes: CONFIG.SELECTED_TIMEFRAMES,
    trendEmaPeriod: CONFIG.TREND_EMA_PERIOD,
    targetMultiplier: CONFIG.TARGET_MULTIPLIER,
    minVixFilter: CONFIG.MIN_VIX_FILTER,
    minVix: CONFIG.MIN_VIX,
    currentVix,
    goldContract: CONFIG.GOLD_CONTRACT,
    // Per-instrument session phase ("PRE_OPEN"|"OPEN"|"CLOSED") — a single global string can't
    // express "NSE closed, MCX open" once gold trades until 23:30. Legacy marketStatus retained.
    marketStatusByInstrument: Object.fromEntries(CONFIG.UNDERLYINGS.map((u) => [u.name, getInstrumentPhaseNow(u)])),
    openPositions: openPositions.filter((p) => p.status === "OPEN"),
    closedPositions: openPositions.filter((p) => p.status === "CLOSED"),
    activeAlerts: Object.fromEntries(activeAlerts),
    latestData,
    recentSignals: getRecentSignals(10),
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
  maxSpreadPct: { min: 0.1, max: 20 },
  minOI: { min: 0, max: 10000000, int: true },
  maxTimeEntryHour: { min: 9, max: 15, int: true },
  trendEmaPeriod: { min: 5, max: 50, int: true },
  targetMultiplier: { min: 0.5, max: 5 },
  minVix: { min: 0, max: 100 },
};
const ALLOWED_STRATEGIES = ["EMA5T"];
const ALLOWED_INSTRUMENT_NAMES = ["NIFTY", "BANKNIFTY", "GOLD"];
const ALLOWED_GOLD_CONTRACTS = ["GOLDM", "GOLD"];

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
    } else if (key === "goldContract") {
      if (ALLOWED_GOLD_CONTRACTS.includes(value)) clean[key] = value;
      else rejected.push({ key, value });
    } else if (key === "allowCorrelatedTrades" || key === "paperTrading" || key === "useStopLimitEntries" || key === "minVixFilter") {
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
  // Never flip the gold contract while the bot is running: resting entry/SL orders would be
  // sitting on the OTHER contract's symbol with nothing tracking them (same class of guard as
  // the paper/live flip above).
  if (updates.goldContract !== undefined && isRunning && updates.goldContract !== CONFIG.GOLD_CONTRACT) {
    console.error("[AUTO-TRADER] Ignoring gold contract change via /config while running — stop the bot first.");
    logAudit({ type: "GOLD_CONTRACT_CHANGE_BLOCKED", requested: updates.goldContract });
    delete updates.goldContract;
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
      useStopLimitEntries: CONFIG.USE_STOPLIMIT_ENTRIES,
      limitBufferPct: CONFIG.LIMIT_BUFFER_PCT,
      maxSpreadPct: CONFIG.MAX_SPREAD_PCT,
      minOI: CONFIG.MIN_OI,
      maxTimeEntryHour: CONFIG.MAX_TIME_ENTRY_HOUR,
      allowCorrelatedTrades: CONFIG.ALLOW_CORRELATED_TRADES,
      selectedStrategies: CONFIG.SELECTED_STRATEGIES,
      selectedInstruments: CONFIG.SELECTED_INSTRUMENTS,
      selectedTimeframes: CONFIG.SELECTED_TIMEFRAMES,
      trendEmaPeriod: CONFIG.TREND_EMA_PERIOD,
      targetMultiplier: CONFIG.TARGET_MULTIPLIER,
      minVixFilter: CONFIG.MIN_VIX_FILTER,
      minVix: CONFIG.MIN_VIX,
      goldContract: CONFIG.GOLD_CONTRACT,
    },
  };
}

export function getAuditLog(limit = 100) {
  return auditLog.slice(-limit);
}
