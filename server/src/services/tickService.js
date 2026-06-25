/**
 * Real-Time Tick Service
 * 
 * Connects to FYERS WebSocket for live tick data,
 * stores ticks in-memory with FIFO cleanup,
 * provides OHLC aggregation for any timeframe.
 */

import WebSocket from "ws";

// ─── Configuration ────────────────────────────────────────────────
const MAX_TICKS_PER_SYMBOL = 100000;
const FYERS_WS_URL = "wss://socket.fyers.in";
const RECONNECT_DELAY_MS = 5000;

// ─── In-Memory Storage ────────────────────────────────────────────
const tickStore = {
  NIFTY: [],
  BANKNIFTY: [],
};

const latestTick = {
  NIFTY: null,
  BANKNIFTY: null,
};

let wsConnection = null;
let isConnected = false;
let reconnectTimer = null;
let heartbeatTimer = null;

// ─── Symbol Mapping ───────────────────────────────────────────────
const SYMBOL_MAP = {
  "NSE:NIFTY50-INDEX": "NIFTY",
  "NSE:NIFTYBANK-INDEX": "BANKNIFTY",
};

const REVERSE_SYMBOL_MAP = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
};

// ─── WebSocket Clients (for broadcasting) ─────────────────────────
const wsClients = new Set();

// ─── Connect to FYERS WebSocket ───────────────────────────────────
export function connectFyersWebSocket(accessToken, appId) {
  if (wsConnection?.readyState === WebSocket.OPEN) {
    console.log("[TICK-SERVICE] Already connected");
    return;
  }

  const url = `${FYERS_WS_URL}?access_token=${appId}:${accessToken}`;
  
  console.log("[TICK-SERVICE] Connecting to FYERS WebSocket...");

  try {
    wsConnection = new WebSocket(url);

    wsConnection.on("open", () => {
      console.log("[TICK-SERVICE] WebSocket connected");
      isConnected = true;
      
      // Subscribe to NIFTY and BANKNIFTY using FYERS v2 format
      const subscribeMsg = {
        method: "sub",
        data: {
          symbols: Object.keys(SYMBOL_MAP),
        },
      };
      wsConnection.send(JSON.stringify(subscribeMsg));
      console.log("[TICK-SERVICE] Subscribed to:", Object.keys(SYMBOL_MAP));
      
      // Start heartbeat
      startHeartbeat();
    });

    wsConnection.on("message", (data) => {
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
  const shortName = SYMBOL_MAP[symbol];
  
  if (!shortName) return;

  const tick = {
    symbol: shortName,
    ltp: msg.ltp || msg.lt || 0,
    volume: msg.vol || msg.v || 0,
    timestamp: Date.now(),
    raw: msg,
  };

  // Store tick
  storeTick(shortName, tick);
  
  // Update latest
  latestTick[shortName] = tick;

  // Broadcast to all connected WebSocket clients
  broadcastToClients(tick);
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
function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    if (wsConnection?.readyState === WebSocket.OPEN) {
      wsConnection.send(JSON.stringify({ method: "ping" }));
    }
  }, 30000); // Every 30 seconds
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
  
  console.log(`[TICK-SERVICE] Reconnecting in ${RECONNECT_DELAY_MS}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectFyersWebSocket(accessToken, appId);
  }, RECONNECT_DELAY_MS);
}

// ─── Disconnect ───────────────────────────────────────────────────
export function disconnectFyersWebSocket() {
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
  isConnected = false;
  console.log("[TICK-SERVICE] Disconnected");
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
    niftyTickCount: tickStore.NIFTY.length,
    bankNiftyTickCount: tickStore.BANKNIFTY.length,
  };
}

// ─── OHLC Aggregation Engine ──────────────────────────────────────
export function aggregateOHLC(symbol, interval, limit = 500) {
  const ticks = tickStore[symbol] || [];
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
function getPeriodStart(timestamp, unit, value) {
  const date = new Date(timestamp);
  
  if (unit === "second") {
    // Round down to nearest N seconds
    const seconds = Math.floor(date.getSeconds() / value) * value;
    date.setSeconds(seconds, 0);
    return date.getTime();
  }
  
  if (unit === "minute") {
    // Round down to nearest N minutes
    const minutes = Math.floor(date.getMinutes() / value) * value;
    date.setMinutes(minutes, 0, 0);
    return date.getTime();
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

  const ltps = ticks.map((t) => t.ltp);
  return {
    symbol,
    currentPrice: latestTick[symbol]?.ltp || 0,
    dayHigh: Math.max(...ltps),
    dayLow: Math.min(...ltps),
    tickCount: ticks.length,
    firstTickTime: ticks[0]?.timestamp,
    lastTickTime: ticks[ticks.length - 1]?.timestamp,
  };
}

// ─── Clear All Data ───────────────────────────────────────────────
export function clearTickData() {
  tickStore.NIFTY = [];
  tickStore.BANKNIFTY = [];
  latestTick.NIFTY = null;
  latestTick.BANKNIFTY = null;
  console.log("[TICK-SERVICE] All tick data cleared");
}