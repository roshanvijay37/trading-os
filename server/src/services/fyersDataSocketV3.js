/**
 * FYERS v3 market-data feed via the OFFICIAL `fyers-api-v3` SDK (fyersDataSocket), which
 * handles the protobuf frame decoding that the legacy raw-WebSocket path got wrong (404 +
 * JSON parse). Gated behind DATA_FEED_MODE=sdk in tickService so production is unaffected
 * until it is enabled and the package is installed.
 *
 * The SDK is required LAZILY (inside start) via createRequire so that importing this module
 * NEVER crashes the server when `fyers-api-v3` isn't installed yet — it just disables the
 * SDK feed and logs.
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let skt = null;
let started = false;

/**
 * Remove the fyers-api-v3 package from the CommonJS require cache so the NEXT require() rebuilds
 * a fresh module — and therefore a fresh socket singleton. The SDK's fyersDataSocket.getInstance()
 * returns a PROCESS-WIDE singleton bound to the access token it was first constructed with; a
 * later getInstance(newToken) hands back the same instance and ignores the new token. Without
 * this purge a refreshed/replaced token never reaches the live feed — the socket keeps
 * reconnecting with the dead token until the whole Node process restarts (the exact failure this
 * change exists to fix).
 */
function purgeSdkFromCache() {
  try {
    for (const key of Object.keys(require.cache)) {
      if (key.includes("fyers-api-v3")) delete require.cache[key];
    }
  } catch (err) {
    console.error("[DATA-SOCKET-V3] Cache purge failed:", err.message);
  }
}

/**
 * Fully tear down the current SDK socket: stop its auto-reconnect loop, close the connection,
 * drop our reference, and purge the singleton from the module cache so the next
 * startSdkDataSocket() builds a brand-new instance with whatever token it is handed.
 */
function teardownSdkSocket() {
  if (skt) {
    try {
      // autoreconnect(0) sets maxreconnectiontries=0 so the SDK's retry loop gives up instead of
      // resurrecting the old (dead-token) socket after we close it.
      if (typeof skt.autoreconnect === "function") skt.autoreconnect(0);
    } catch (err) {
      console.error("[DATA-SOCKET-V3] autoreconnect(0) failed:", err.message);
    }
    try {
      if (typeof skt.close === "function") skt.close();
    } catch (err) {
      console.error("[DATA-SOCKET-V3] close failed:", err.message);
    }
  }
  skt = null;
  started = false;
  purgeSdkFromCache();
}

/**
 * Pure: normalize an SDK tick message into { symbol, ltp, vol }.
 * Defensive about field names across lite/full mode. Exported for unit testing.
 */
export function normalizeSdkTick(msg) {
  if (!msg || typeof msg !== "object") return null;
  // NB: msg.s is the STATUS field ("ok"/"error") on ack/connection frames, NOT a symbol —
  // do not fall back to it, or status frames get stored as junk "ok" ticks.
  const symbol = msg.symbol || msg.symbolName;
  if (!symbol) return null;
  const ltp = Number(msg.ltp ?? msg.lp ?? msg.last_traded_price ?? 0) || 0;
  const vol = Number(msg.vol_traded_today ?? msg.volume ?? msg.vol ?? msg.v ?? 0) || 0;
  return { symbol, ltp, vol };
}

/**
 * Start the official SDK data socket and stream ticks into `onTick(symbol, ltp, vol)`.
 * Returns false (and stays quiet) if the package is not installed.
 */
export function startSdkDataSocket({ accessToken, appId, symbols = [], onTick, onStatus }) {
  // Tear down any prior singleton (and purge it from the module cache) FIRST, so the token
  // passed in this call actually takes effect instead of being shadowed by the cached instance.
  teardownSdkSocket();

  let DataSocket;
  try {
    DataSocket = require("fyers-api-v3").fyersDataSocket;
  } catch (err) {
    console.error(
      "[DATA-SOCKET-V3] fyers-api-v3 not installed — run `npm install fyers-api-v3` in server/. SDK feed disabled:",
      err.message
    );
    return false;
  }

  try {
    // SDK expects the token as "APPID:AccessToken"; ("", false) = no log file, logging off.
    const token = `${appId}:${accessToken}`;
    skt = DataSocket.getInstance(token, "", false);

    skt.on("connect", () => {
      console.log("[DATA-SOCKET-V3] Connected");
      if (typeof onStatus === "function") onStatus(true);
      try {
        skt.subscribe(symbols);
        console.log("[DATA-SOCKET-V3] Subscribed:", symbols);
      } catch (e) {
        console.error("[DATA-SOCKET-V3] Subscribe failed:", e.message);
      }
      if (typeof skt.autoreconnect === "function") skt.autoreconnect(6);
    });

    skt.on("message", (msg) => {
      try {
        const tick = normalizeSdkTick(msg);
        if (tick && typeof onTick === "function") onTick(tick.symbol, tick.ltp, tick.vol);
      } catch (e) {
        console.error("[DATA-SOCKET-V3] Message handler error:", e.message);
      }
    });

    skt.on("error", (e) => {
      console.error("[DATA-SOCKET-V3] Error:", typeof e === "string" ? e : e?.message || JSON.stringify(e));
      if (typeof onStatus === "function") onStatus(false);
    });

    skt.on("close", () => {
      console.log("[DATA-SOCKET-V3] Closed");
      if (typeof onStatus === "function") onStatus(false);
    });

    skt.connect();
    started = true;
    return true;
  } catch (err) {
    console.error("[DATA-SOCKET-V3] Failed to start SDK socket:", err.message);
    return false;
  }
}

export function sdkSubscribe(symbols = []) {
  try {
    if (skt && typeof skt.subscribe === "function") skt.subscribe(symbols);
  } catch (e) {
    console.error("[DATA-SOCKET-V3] sdkSubscribe failed:", e.message);
  }
}

export function sdkUnsubscribe(symbols = []) {
  try {
    if (skt && typeof skt.unsubscribe === "function") skt.unsubscribe(symbols);
  } catch (e) {
    console.error("[DATA-SOCKET-V3] sdkUnsubscribe failed:", e.message);
  }
}

export function sdkDisconnect() {
  // Full teardown (close + drop reference + purge the singleton from the module cache) so a
  // later start can rebuild the socket with a current token.
  teardownSdkSocket();
}

export function isSdkActive() {
  return started;
}
