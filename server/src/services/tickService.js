/**
 * Real-Time Tick Service
 * 
 * Connects to FYERS WebSocket for live tick data,
 * stores ticks in-memory with FIFO cleanup,
 * provides OHLC aggregation for any timeframe.
 */

import WebSocket from "ws";
import { startSdkDataSocket, sdkSubscribe, sdkUnsubscribe, sdkDisconnect, isSdkActive } from "./fyersDataSocketV3.js";

// Data-feed mode: "raw" (legacy hand-rolled WS, default) | "sdk" (official fyers-api-v3
// dataSocket, which decodes the v3 protobuf frames). Flag-gated so production stays on the
// current path until DATA_FEED_MODE=sdk is set AND `npm install fyers-api-v3` is run.
const DATA_FEED_MODE = (process.env.DATA_FEED_MODE || "raw").toLowerCase();

// ─── Configuration ────────────────────────────────────────────────
const MAX_TICKS_PER_SYMBOL = 100000;
// TODO(verify during market hours): Confirm this raw-WebSocket JSON approach actually
// receives data on the FYERS API v3 data feed. v3's official data socket may require a
// specific endpoint/path and the fyers-apiv3 SDK's subscribe protocol (and a binary/HSM
// frame format) rather than this plain "wss://socket.fyers.in" + {method:"sub"} JSON. If
// no ticks arrive when the market is open (status.tickStatus.isConnected true but empty
// tickCounts), switch to the official fyers-apiv3 data-socket client. Endpoint, subscribe
// schema, payload field names (ltp/lt, vol/v, symbol) and the keep-alive frame all need
// confirming against current v3 docs.
const FYERS_WS_URL = "wss://socket.fyers.in";
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
const MAX_RECONNECT_ATTEMPTS = 10;
let reconnectAttempts = 0;

// ─── In-Memory Storage ────────────────────────────────────────────
const tickStore = {};

const latestTick = {};

let wsConnection = null;
let isConnected = false;
let reconnectTimer = null;
let heartbeatTimer = null;
// Timestamp of the last message received of ANY kind (tick, ack, etc.) on the raw socket. Many
// real network failures (NAT/firewall session eviction, a silently black-holing path) never
// deliver a FIN/RST, so the socket's own 'close'/'error' events — the only thing that currently
// triggers a reconnect — never fire. This lets the heartbeat notice total silence and force a
// reconnect itself, instead of requiring a human to spot stale prices and restart the bot.
let lastMessageAt = 0;

// ─── Symbol Mapping ───────────────────────────────────────────────
const SYMBOL_MAP = {
  "NSE:NIFTY50-INDEX": "NIFTY",
  "NSE:NIFTYBANK-INDEX": "BANKNIFTY",
};

const REVERSE_SYMBOL_MAP = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
};

// Symbols we always keep subscribed to (indices for signal generation)
const subscribedSymbols = new Set(Object.keys(SYMBOL_MAP));

// Reference count per NON-permanent symbol (anything not in SYMBOL_MAP) so that closing one
// position doesn't kill live ticks for a sibling position still open on the SAME symbol (EMA5T
// can run multiple timeframes concurrently on one underlying's futures contract). A symbol is
// only actually torn down (broker-unsubscribed, tick buffer freed) once its ref count hits 0.
const symbolRefCounts = new Map();

function normalizeSymbol(fyersSymbol) {
  return SYMBOL_MAP[fyersSymbol] || fyersSymbol;
}

function ensureStore(symbol) {
  if (!tickStore[symbol]) tickStore[symbol] = [];
}

// ─── WebSocket Clients (for broadcasting) ─────────────────────────
const wsClients = new Set();

// ─── Connect to FYERS WebSocket ───────────────────────────────────
export function connectFyersWebSocket(accessToken, appId) {
  if (DATA_FEED_MODE === "sdk") {
    startSdkDataSocket({
      accessToken,
      appId,
      symbols: Array.from(subscribedSymbols),
      onTick: ingestTick,
      onStatus: setSdkConnected,
    });
    return;
  }
  if (wsConnection?.readyState === WebSocket.OPEN) {
    console.log("[TICK-SERVICE] Already connected");
    return;
  }

  const url = `${FYERS_WS_URL}?access_token=${appId}:${accessToken}`;
  
  // Log URL without exposing full token
  const tokenStart = url.indexOf('access_token=') + 13;
  const colonIdx = url.indexOf(':', tokenStart);
  const safeUrl = url.substring(0, colonIdx + 3) + '***' + url.substring(url.length - 5);
  console.log("[TICK-SERVICE] Connecting to:", safeUrl);

  // Tear down any previous socket before creating a new one so old listeners/handles don't
  // leak and a stale socket's close event can't trigger a spurious extra reconnect.
  if (wsConnection) {
    try {
      wsConnection.removeAllListeners();
      wsConnection.terminate();
    } catch {
      // ignore
    }
    wsConnection = null;
  }

  try {
    wsConnection = new WebSocket(url);

    wsConnection.on("open", () => {
      console.log("[TICK-SERVICE] WebSocket connected");
      isConnected = true;
      reconnectAttempts = 0; // successful connection resets backoff
      
      // Subscribe to NIFTY and BANKNIFTY using FYERS v2 format
      const subscribeMsg = {
        method: "sub",
        data: {
          symbols: Array.from(subscribedSymbols),
        },
      };
      wsConnection.send(JSON.stringify(subscribeMsg));
      console.log("[TICK-SERVICE] Subscribed to:", Object.keys(SYMBOL_MAP));
      
      // Start heartbeat
      startHeartbeat();
    });

    wsConnection.on("message", (data) => {
      lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(data.toString());
        if (msg.s === "ok") {
          console.log("[TICK-SERVICE] Subscription confirmed:", msg);
        } else if (msg.ltp !== undefined || msg.lt !== undefined) {
          handleFyersMessage(msg);
        }
      } catch (err) {
        console.error("[TICK-SERVICE] Failed to parse message:", err.message);
      }
    });

    wsConnection.on("close", () => {
      console.log("[TICK-SERVICE] WebSocket closed");
      isConnected = false;
      stopHeartbeat();
      scheduleReconnect(accessToken, appId);
    });

    wsConnection.on("error", (err) => {
      console.error("[TICK-SERVICE] WebSocket error:", err.message);
      console.error("[TICK-SERVICE] Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
      isConnected = false;
    });

  } catch (err) {
    console.error("[TICK-SERVICE] Connection failed:", err.message);
    scheduleReconnect(accessToken, appId);
  }
}

// ─── Handle FYERS Messages ────────────────────────────────────────
function handleFyersMessage(msg) {
  // FYERS v3 format: msg has ltp, vol, symbol directly
  const symbol = msg.symbol;
  if (!symbol) return;
  if (!subscribedSymbols.has(symbol)) return;
  ingestTick(symbol, msg.ltp ?? msg.lt ?? 0, msg.vol ?? msg.v ?? 0);
}

/**
 * Store a tick from ANY feed source (raw WS or the SDK data socket): normalize the symbol,
 * append to the buffer, update the latest tick, and broadcast to UI clients.
 */
export function ingestTick(fyersSymbol, ltp, vol) {
  if (!fyersSymbol) return null;
  const shortName = normalizeSymbol(fyersSymbol);
  ensureStore(shortName);
  const tick = {
    symbol: shortName,
    ltp: Number(ltp) || 0,
    volume: Number(vol) || 0,
    timestamp: Date.now(),
  };
  storeTick(shortName, tick);
  latestTick[shortName] = tick;
  broadcastToClients(tick);
  return tick;
}

/** Let the SDK data socket report its connection state into getWsStatus(). */
export function setSdkConnected(connected) {
  isConnected = !!connected;
}

// ─── Store Tick with FIFO Cleanup ─────────────────────────────────
function storeTick(symbol, tick) {
  const store = tickStore[symbol];
  if (!store) return;

  store.push(tick);

  // FIFO cleanup - keep only latest MAX_TICKS_PER_SYMBOL
  if (store.length > MAX_TICKS_PER_SYMBOL) {
    const removeCount = store.length - MAX_TICKS_PER_SYMBOL;
    store.splice(0, removeCount);
  }
}

// ─── Heartbeat ────────────────────────────────────────────────────
const HEARTBEAT_INTERVAL_MS = 30000;
// No message of ANY kind (tick, ack, ping reply) in this long — 3 heartbeat intervals — is
// treated as a silently dead connection during market hours and forces a reconnect.
const STALE_CONNECTION_MS = 90000;

function startHeartbeat() {
  // Clear any prior interval first so a reconnect can't leave an orphaned heartbeat
  // sending pings on a dead socket.
  stopHeartbeat();
  lastMessageAt = Date.now(); // baseline from the moment this (fresh) connection starts heartbeating
  heartbeatTimer = setInterval(() => {
    if (wsConnection?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastMessageAt > STALE_CONNECTION_MS) {
      console.error(
        `[TICK-SERVICE] No message received in ${STALE_CONNECTION_MS}ms — connection appears silently dead, forcing reconnect`
      );
      // terminate() (not close()) skips the close handshake and reliably fires the local
      // 'close' handler immediately, which is what actually schedules the reconnect — needed
      // because the remote end may never respond to a graceful close on a black-holed path.
      wsConnection.terminate();
      return;
    }
    // TODO(verify): confirm FYERS v3 WS keep-alive expects this JSON {method:"ping"}
    // message vs a protocol-level ping frame (wsConnection.ping()). If idle disconnects
    // are observed, switch to wsConnection.ping().
    wsConnection.send(JSON.stringify({ method: "ping" }));
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── Reconnect Logic ──────────────────────────────────────────────
function scheduleReconnect(accessToken, appId) {
  if (reconnectTimer) return;

  // Exponential backoff with a cap, and give up after MAX_RECONNECT_ATTEMPTS so a dead/
  // expired token can't drive an infinite fixed-interval reconnect storm against FYERS.
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(
      `[TICK-SERVICE] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached; giving up. Call connect again with a fresh token.`
    );
    return;
  }
  const delay = Math.min(RECONNECT_DELAY_MS * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
  reconnectAttempts++;

  console.log(`[TICK-SERVICE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectFyersWebSocket(accessToken, appId);
  }, delay);
}

// ─── Disconnect ───────────────────────────────────────────────────
export function disconnectFyersWebSocket() {
  if (DATA_FEED_MODE === "sdk") {
    sdkDisconnect();
    isConnected = false;
    return;
  }
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0; // fresh slate for the next explicit connect
  if (wsConnection) {
    wsConnection.removeAllListeners();
    wsConnection.close();
    wsConnection = null;
  }
  isConnected = false;
  console.log("[TICK-SERVICE] Disconnected");
}

/**
 * Force a clean reconnect of the upstream FYERS feed with a (possibly new) access token. Used
 * after a token refresh so the live socket picks up the new token WITHOUT a full process
 * restart. In SDK mode startSdkDataSocket() tears down the pinned singleton and rebuilds it; in
 * raw mode we drop the existing socket first because connectFyersWebSocket() early-returns when
 * one is already open.
 */
export function reconnectFyersWebSocket(accessToken, appId) {
  if (DATA_FEED_MODE === "sdk") {
    connectFyersWebSocket(accessToken, appId);
    return;
  }
  disconnectFyersWebSocket();
  connectFyersWebSocket(accessToken, appId);
}

/**
 * Called when the access token is refreshed. Re-arms the live feed with the new token, but only
 * if a feed is currently active (i.e. the bot is running) — otherwise a refresh that happens
 * while the bot is stopped would needlessly spin a socket up. The in-memory tick buffer is NOT
 * touched, so accumulated candles survive the re-arm (no warm-up reset on a token refresh).
 */
export function onTokenRefreshed(accessToken, appId) {
  const active = DATA_FEED_MODE === "sdk" ? isSdkActive() : wsConnection != null;
  if (!active) return;
  console.log("[TICK-SERVICE] Access token refreshed — re-arming live feed with the new token");
  reconnectFyersWebSocket(accessToken, appId);
}

// ─── Get Raw Ticks ────────────────────────────────────────────────
export function getTicks(symbol, limit = 5000) {
  const store = tickStore[symbol] || [];
  const start = Math.max(0, store.length - limit);
  return store.slice(start);
}

// ─── Get Latest Tick ──────────────────────────────────────────────
export function getLatestTick(symbol) {
  return latestTick[symbol] || null;
}

// ─── Get All Latest Ticks ─────────────────────────────────────────
export function getAllLatestTicks() {
  return { ...latestTick };
}

// ─── Get Connection Status ────────────────────────────────────────
export function getWsStatus() {
  return {
    isConnected,
    clientCount: wsClients.size,
    subscribedSymbols: Array.from(subscribedSymbols),
    tickCounts: Object.fromEntries(Object.keys(tickStore).map((k) => [k, tickStore[k].length])),
  };
}

// Start of the current NSE trading session (09:15 IST) at or before `nowMs`, as epoch ms. India has
// no DST so a fixed +5:30 offset is exact. Pure/exported for unit tests.
const IST_OFFSET_MS = 330 * 60000;
const SESSION_OPEN_MIN = 9 * 60 + 15; // 09:15 IST
export function currentSessionStartMs(nowMs) {
  const istMs = nowMs + IST_OFFSET_MS;
  const istMidnight = Math.floor(istMs / 86400000) * 86400000;
  let openIst = istMidnight + SESSION_OPEN_MIN * 60000;
  if (istMs < openIst) openIst -= 86400000; // before today's open → the previous session
  return openIst - IST_OFFSET_MS;
}

// ─── OHLC Aggregation Engine ──────────────────────────────────────
export function aggregateOHLC(symbol, interval, limit = 500) {
  const all = tickStore[symbol] || [];
  if (all.length === 0) return [];

  // Drop pre-session ticks before aggregating. FYERS streams the frozen last index value overnight,
  // which otherwise builds flat, stale higher-timeframe candles at the open (the 30m/60m EMA sits at
  // yesterday's value). Keeping only the CURRENT session's ticks means the engine falls back to clean
  // REST history until enough fresh live ticks accumulate. Non-destructive: the raw buffer is untouched.
  const cutoff = currentSessionStartMs(Date.now());
  const ticks = all.filter((t) => t.timestamp >= cutoff);
  if (ticks.length === 0) return [];

  // Parse interval
  const { unit, value } = parseInterval(interval);
  
  if (unit === "tick") {
    // Return tick-by-tick as candles (open=close=high=low=ltp)
    return ticks.slice(-limit).map((t) => ({
      time: Math.floor(t.timestamp / 1000),
      open: t.ltp,
      high: t.ltp,
      low: t.ltp,
      close: t.ltp,
      volume: t.volume,
    }));
  }

  // Aggregate into candles
  const candles = [];
  let currentCandle = null;
  let currentPeriod = null;

  for (const tick of ticks) {
    const tickTime = tick.timestamp;
    const periodStart = getPeriodStart(tickTime, unit, value);

    if (periodStart !== currentPeriod) {
      // Save previous candle
      if (currentCandle) {
        candles.push(currentCandle);
      }
      
      // Start new candle
      currentPeriod = periodStart;
      currentCandle = {
        time: Math.floor(periodStart / 1000),
        open: tick.ltp,
        high: tick.ltp,
        low: tick.ltp,
        close: tick.ltp,
        volume: tick.volume,
      };
    } else {
      // Update current candle
      currentCandle.high = Math.max(currentCandle.high, tick.ltp);
      currentCandle.low = Math.min(currentCandle.low, tick.ltp);
      currentCandle.close = tick.ltp;
      currentCandle.volume += tick.volume;
    }
  }

  // Push final candle
  if (currentCandle) {
    candles.push(currentCandle);
  }

  // Return last N candles
  return candles.slice(-limit);
}

// ─── Parse Interval String ────────────────────────────────────────
function parseInterval(interval) {
  const match = interval.match(/^(\d+)?([sm])$/);
  if (!match) return { unit: "tick", value: 0 };
  
  const value = parseInt(match[1]) || 1;
  const unit = match[2] === "s" ? "second" : "minute";
  return { unit, value };
}

// ─── Get Period Start Timestamp ───────────────────────────────────
// Minute candles are anchored to the NSE SESSION OPEN (09:15 IST), not the server-local
// clock. NSE/FYERS bars run 09:15–09:45–10:15… for 30m and 09:15–10:15… for 60m; the old
// getMinutes()-based bucketing produced :00/:30 server-local boundaries, so tick-built
// 30m/60m candles disagreed with REST-history/backtest bars and shifted the EMA (a live-vs-
// backtest parity break). Anchoring at session open yields identical boundaries for 5m/15m
// (09:15 is on the 5/15-minute grid) and FIXES 30m/60m. Exported for unit tests.
export function getPeriodStart(timestamp, unit, value) {
  if (unit === "second") {
    // Round down to nearest N seconds
    const date = new Date(timestamp);
    const seconds = Math.floor(date.getSeconds() / value) * value;
    date.setSeconds(seconds, 0);
    return date.getTime();
  }

  if (unit === "minute") {
    const sessionStart = currentSessionStartMs(timestamp);
    const periodMs = value * 60000;
    return sessionStart + Math.floor((timestamp - sessionStart) / periodMs) * periodMs;
  }

  return timestamp;
}

// ─── WebSocket Client Management ──────────────────────────────────
export function addWsClient(ws) {
  wsClients.add(ws);
  console.log(`[TICK-SERVICE] Client connected. Total: ${wsClients.size}`);
  
  // Send initial status
  ws.send(JSON.stringify({
    type: "status",
    data: getWsStatus(),
  }));
}

export function removeWsClient(ws) {
  wsClients.delete(ws);
  console.log(`[TICK-SERVICE] Client disconnected. Total: ${wsClients.size}`);
}

export function broadcastToClients(tick) {
  const message = JSON.stringify({
    type: "tick",
    data: tick,
  });
  
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ─── Get Day Stats ────────────────────────────────────────────────
export function getDayStats(symbol) {
  const ticks = tickStore[symbol] || [];
  if (ticks.length === 0) return null;

  // Reduce instead of Math.max(...ltps): spreading up to MAX_TICKS_PER_SYMBOL (100k) args
  // can blow the call-stack / argument limit and throw RangeError.
  let dayHigh = -Infinity;
  let dayLow = Infinity;
  for (const t of ticks) {
    if (t.ltp > dayHigh) dayHigh = t.ltp;
    if (t.ltp < dayLow) dayLow = t.ltp;
  }
  return {
    symbol,
    currentPrice: latestTick[symbol]?.ltp || 0,
    dayHigh,
    dayLow,
    tickCount: ticks.length,
    firstTickTime: ticks[0]?.timestamp,
    lastTickTime: ticks[ticks.length - 1]?.timestamp,
  };
}

// ─── Clear All Data ───────────────────────────────────────────────
export function clearTickData() {
  Object.keys(tickStore).forEach((k) => (tickStore[k] = []));
  Object.keys(latestTick).forEach((k) => (latestTick[k] = null));
  console.log("[TICK-SERVICE] All tick data cleared");
}

// ─── Dynamic Symbol Subscription ──────────────────────────────────
// Permanent index symbols (SYMBOL_MAP) are never ref-counted — they're always subscribed and
// unsubscribeFromSymbols already refuses to remove them regardless of count.
export function subscribeToSymbols(symbols) {
  let added = false;
  for (const symbol of symbols) {
    if (!SYMBOL_MAP[symbol]) {
      symbolRefCounts.set(symbol, (symbolRefCounts.get(symbol) || 0) + 1);
    }
    if (!subscribedSymbols.has(symbol)) {
      subscribedSymbols.add(symbol);
      ensureStore(normalizeSymbol(symbol));
      added = true;
    }
  }
  if (added) {
    if (DATA_FEED_MODE === "sdk") {
      sdkSubscribe(symbols);
      console.log("[TICK-SERVICE] (SDK) Subscribed to:", symbols);
    } else if (wsConnection?.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({ method: "sub", data: { symbols: Array.from(subscribedSymbols) } }));
      console.log("[TICK-SERVICE] Subscribed to:", symbols);
    }
  }
}

export function unsubscribeFromSymbols(symbols) {
  let removed = false;
  const actuallyRemoved = [];
  for (const symbol of symbols) {
    if (SYMBOL_MAP[symbol]) continue; // permanent index symbols are never removed
    const remaining = Math.max(0, (symbolRefCounts.get(symbol) || 0) - 1);
    if (remaining > 0) {
      // Still wanted by another open position on the same symbol (e.g. a second timeframe on
      // the same futures contract) — keep the feed alive for it, don't tear anything down.
      symbolRefCounts.set(symbol, remaining);
      continue;
    }
    symbolRefCounts.delete(symbol);
    if (subscribedSymbols.has(symbol)) {
      subscribedSymbols.delete(symbol);
      // Reclaim the per-symbol tick buffer and latest-tick entry. Without this, every
      // symbol ever subscribed leaks up to MAX_TICKS_PER_SYMBOL tick objects forever.
      const shortName = normalizeSymbol(symbol);
      delete tickStore[shortName];
      delete latestTick[shortName];
      removed = true;
      actuallyRemoved.push(symbol);
    }
  }
  if (removed) {
    if (DATA_FEED_MODE === "sdk") {
      sdkUnsubscribe(actuallyRemoved);
      console.log("[TICK-SERVICE] (SDK) Unsubscribed from:", actuallyRemoved);
    } else if (wsConnection?.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({ method: "unsub", data: { symbols: actuallyRemoved } }));
      console.log("[TICK-SERVICE] Unsubscribed from:", actuallyRemoved);
    }
  }
}