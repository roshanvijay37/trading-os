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
  try {
    if (skt && typeof skt.close === "function") skt.close();
  } catch (e) {
    console.error("[DATA-SOCKET-V3] sdkDisconnect failed:", e.message);
  }
  skt = null;
  started = false;
}

export function isSdkActive() {
  return started;
}
