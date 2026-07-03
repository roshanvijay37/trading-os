/**
 * Order Execution Engine
 *
 * Handles the full lifecycle of a broker order:
 *  - place order
 *  - poll for fill / rejection / cancellation
 *  - cancel pending orders
 *  - place broker-side stop-loss and target orders
 *
 * Designed to be broker-agnostic at the interface level; the current
 * implementation targets the FYERS v3 API.
 */

import { refreshAccessToken } from "../routes/auth.js";

const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";

// Single-order placement uses the SYNCHRONOUS endpoint: it returns the order id in the
// response so the order can be tracked (fill polling + stop-loss attachment). The async
// endpoint was previously used and its id field was unverified — a placed-but-untracked
// order is the single most dangerous failure mode here.
const PLACE_ORDER_ENDPOINT = "/orders/sync";

export const ORDER_TYPE = Object.freeze({
  LIMIT: 1,
  MARKET: 2,
  STOP: 3, // SL-M
  STOPLIMIT: 4,
});

export const ORDER_SIDE = Object.freeze({
  BUY: 1,
  SELL: -1,
});

/**
 * Heuristic: does a FYERS error payload indicate an invalid/expired access token? FYERS may
 * signal this as an HTTP 401, or as an HTTP 200 with s!=="ok" and a token-related code/message
 * (codes -8/-15/-16/-17 observed). Used to decide whether a refresh-and-retry is worth it.
 */
export function isTokenErrorData(data) {
  if (!data) return false;
  const msg = String(data.message || "").toLowerCase();
  const code = Number(data.code);
  return (
    msg.includes("token") ||
    msg.includes("authenticate") ||
    msg.includes("authorization") ||
    code === -8 ||
    code === -15 ||
    code === -16 ||
    code === -17
  );
}

/**
 * Pull the broker order id out of a place-order or orderbook entry, tolerating the several
 * shapes FYERS has used across endpoints/versions. Returns a non-empty string, or null.
 */
export function extractOrderId(response) {
  if (!response) return null;
  const candidates = [
    response.id,
    response.orderId,
    response.data?.id,
    response.data?.orderId,
    Array.isArray(response.orderNumbers)
      ? response.orderNumbers[0]?.id ?? response.orderNumbers[0]
      : response.orderNumbers,
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c).length > 0) return String(c);
  }
  return null;
}

// A short unique tag attached to every live order so it can be located in the orderbook even
// if the place response is malformed. FYERS caps orderTag length, so keep it well under.
function generateOrderTag() {
  return ("tos" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 20);
}

/**
 * Make a FYERS API call, reading the access token from the session each attempt. On an
 * auth failure it refreshes the token once and retries, so an access token that expires
 * mid-session does not strand an open position.
 */
async function fyersApiCall(endpoint, session, body = null, method = "GET", _retried = false) {
  const appId = session.appId ?? process.env.FYERS_APP_ID;
  const response = await fetch(`${FYERS_API_BASE}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `${appId}:${session.accessToken}`,
    },
    body: body ? JSON.stringify(body) : null,
    // Bound every broker call so a hung connection can't stall an order/fill poll forever.
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 && !_retried && (await refreshAccessToken(session))) {
      return fyersApiCall(endpoint, session, body, method, true);
    }
    throw new Error(`FYERS ${method} ${endpoint} HTTP ${response.status}: ${text.substring(0, 240)}`);
  }

  const data = await response.json();
  if (data.s !== "ok") {
    if (!_retried && isTokenErrorData(data) && (await refreshAccessToken(session))) {
      return fyersApiCall(endpoint, session, body, method, true);
    }
    throw new Error(data.message || `FYERS ${endpoint} returned error`);
  }
  return data;
}

/**
 * Locate a just-placed order in the orderbook by the unique orderTag we attached. Used to
 * recover the order id when the place response did not contain one. Best-effort: returns null
 * on any failure rather than throwing (the caller decides how to escalate).
 */
async function findOrderIdByTag(tag, session) {
  try {
    const data = await fyersApiCall("/orders", session);
    const book = data.orderBook || data.data || [];
    const match = book.find((o) => (o.orderTag ?? o.tag) === tag);
    return match ? extractOrderId(match) : null;
  } catch {
    return null;
  }
}

/**
 * FYERS returns order status as a number. Map it to a canonical string.
 * Verified FYERS v3 order status codes:
 *   1 = Cancelled
 *   2 = Traded / Filled
 *   3 = (reserved / for future use)
 *   4 = Transit  (accepted, en route to the exchange — NOT terminal, keep waiting)
 *   5 = Rejected
 *   6 = Pending
 *   7 = Expired
 * The previous map (1=Pending, 3=Rejected, 4=Cancelled) was wrong for everything but 2:
 * in particular it read Transit(4) as CANCELLED, which made the engine abandon an entry that
 * was actually going live — a filled-but-untracked position with no stop-loss.
 */
export function normalizeStatus(status) {
  if (status === null || status === undefined) return "UNKNOWN";
  const num = Number(status);
  if (!Number.isNaN(num)) {
    switch (num) {
      case 1:
        return "CANCELLED";
      case 2:
        return "FILLED";
      case 4:
        return "PENDING"; // Transit — treat as in-flight so we keep polling
      case 5:
        return "REJECTED";
      case 6:
        return "PENDING";
      case 7:
        return "EXPIRED";
      default:
        return "UNKNOWN";
    }
  }
  const s = String(status).toUpperCase();
  if (s === "FILLED" || s === "EXECUTED" || s === "TRADED") return "FILLED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "EXPIRED") return "EXPIRED";
  if (s === "PENDING" || s === "OPEN" || s === "AMO" || s === "TRANSIT") return "PENDING";
  return "UNKNOWN";
}

function extractAvgPrice(order) {
  const price =
    order.tradedPrice ??
    order.averagePrice ??
    order.avgPrice ??
    order.lastTradedPrice ??
    order.tradePrice ??
    0;
  return Number(price) || 0;
}

function extractFilledQty(order) {
  return Number(order.filledQty ?? order.tradedQty ?? order.executedQty ?? 0) || 0;
}

function extractPendingQty(order) {
  return Number(order.pendingQty ?? 0) || 0;
}

/**
 * Place a broker order.
 */
export async function placeOrder({
  symbol,
  qty,
  side,
  type,
  limitPrice = 0,
  stopPrice = 0,
  productType = "INTRADAY",
  validity = "DAY",
  session,
  paperTrading = false,
  paperFillPrice = 0,
  auditLogger = null,
}) {
  // Validate order parameters before anything hits the broker. A malformed qty/price/side
  // must throw here rather than become a wrong live order or a silent 0-price limit order.
  const qtyNum = Number(qty);
  if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
    throw new Error(`Invalid order qty: ${qty}`);
  }
  if (side !== ORDER_SIDE.BUY && side !== ORDER_SIDE.SELL) {
    throw new Error(`Invalid order side: ${side}`);
  }
  if (![ORDER_TYPE.LIMIT, ORDER_TYPE.MARKET, ORDER_TYPE.STOP, ORDER_TYPE.STOPLIMIT].includes(type)) {
    throw new Error(`Invalid order type: ${type}`);
  }
  if ((type === ORDER_TYPE.LIMIT || type === ORDER_TYPE.STOPLIMIT) && !(Number(limitPrice) > 0)) {
    throw new Error(`Limit order requires a positive limitPrice (got ${limitPrice})`);
  }
  if ((type === ORDER_TYPE.STOP || type === ORDER_TYPE.STOPLIMIT) && !(Number(stopPrice) > 0)) {
    throw new Error(`Stop order requires a positive stopPrice (got ${stopPrice})`);
  }

  const orderBody = {
    symbol,
    qty,
    side,
    type,
    productType,
    limitPrice: Number(limitPrice) || 0,
    stopPrice: Number(stopPrice) || 0,
    disclosedQty: 0,
    validity,
    offlineOrder: false,
    stopLoss: 0,
    takeProfit: 0,
  };

  if (paperTrading) {
    const orderId = `PAPER-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (auditLogger) {
      auditLogger({
        type: "PAPER_ORDER",
        orderId,
        symbol,
        qty,
        side,
        type,
        limitPrice: orderBody.limitPrice,
        stopPrice: orderBody.stopPrice,
        paperFillPrice,
      });
    }
    return {
      orderId,
      status: "PLACED",
      symbol,
      qty,
      side,
      type,
      limitPrice: orderBody.limitPrice,
      stopPrice: orderBody.stopPrice,
    };
  }

  // Attach a unique tag so the order can be located in the orderbook even if the place
  // response is malformed. Use the synchronous endpoint, which returns the order id.
  // NOTE(verify FYERS v3 docs): normalizeStatus() maps 1=Pending,2=Filled,3=Rejected,
  // 4=Cancelled — confirm against current docs; a wrong map could misreport a fill.
  const orderTag = generateOrderTag();
  const response = await fyersApiCall(PLACE_ORDER_ENDPOINT, session, { ...orderBody, orderTag }, "POST");

  // Resolve the order id robustly. If the response omitted it, the order may still be live —
  // recover it from the orderbook by orderTag rather than ever returning an untracked order
  // (which would fill with no fill-tracking and no stop-loss attached).
  let orderId = extractOrderId(response);
  if (!orderId) {
    orderId = await findOrderIdByTag(orderTag, session);
  }
  if (!orderId) {
    if (auditLogger) {
      auditLogger({ type: "ORDER_ID_UNRESOLVED", symbol, qty, side, type, orderTag });
    }
    throw new Error(
      `Order placed but order id could not be resolved (orderTag=${orderTag}); manual reconciliation required`
    );
  }

  if (auditLogger) {
    auditLogger({
      type: "ORDER_PLACED",
      orderId,
      orderTag,
      symbol,
      qty,
      side,
      type,
      limitPrice: orderBody.limitPrice,
      stopPrice: orderBody.stopPrice,
    });
  }

  return {
    orderId,
    orderTag,
    status: "PLACED",
    symbol,
    qty,
    side,
    type,
    limitPrice: orderBody.limitPrice,
    stopPrice: orderBody.stopPrice,
  };
}

/**
 * Poll a single order until it is terminal or the timeout elapses.
 * Returns the final state including filled quantity and average fill price.
 *
 * NEVER throws on a failed poll: a single transient network error or FYERS 429 mid-poll
 * must not abort the caller — an aborted openPosition leaves a live entry order untracked
 * with no stop-loss, and an aborted closePosition can double-fire a market exit after the
 * broker SL was already cancelled. Failed polls are tolerated until the deadline; the
 * caller then reconciles the TIMEOUT/last-known state (cancel + re-read) as usual.
 */
export async function waitForFill(orderId, session, options = {}) {
  const {
    timeoutMs = 30000,
    pollMs = 1000,
    paperTrading = false,
    paperFillPrice = 0,
    auditLogger = null,
    // Injectable for unit tests; production always uses the real order lookup.
    fetchDetails = getOrderDetails,
  } = options;

  const start = Date.now();
  let lastState = null;
  let pollErrors = 0;

  while (Date.now() - start < timeoutMs) {
    if (paperTrading) {
      // Simulate a near-instant fill in paper mode.
      await sleep(300);
      lastState = {
        orderId,
        status: "FILLED",
        filledQty: 0, // caller must override with intended qty
        pendingQty: 0,
        avgFillPrice: Number(paperFillPrice) || 0,
        statusMessage: "PAPER_FILL",
      };
      if (auditLogger) {
        auditLogger({ type: "PAPER_FILL", orderId, avgFillPrice: lastState.avgFillPrice });
      }
      return lastState;
    }

    let details = null;
    try {
      details = await fetchDetails(orderId, session);
      pollErrors = 0;
    } catch (err) {
      pollErrors += 1;
      console.error(`[ORDER] Fill poll ${pollErrors} failed for ${orderId} (tolerating until deadline):`, err.message);
      if (pollErrors === 1 && auditLogger) {
        auditLogger({ type: "FILL_POLL_ERROR", orderId, error: err.message });
      }
    }

    if (details) {
      lastState = details;

      if (["FILLED", "REJECTED", "CANCELLED", "EXPIRED"].includes(details.status)) {
        if (auditLogger) {
          auditLogger({
            type: details.status === "FILLED" ? "ORDER_FILLED" : `ORDER_${details.status}`,
            orderId,
            ...details,
          });
        }
        return details;
      }

      // Partial fill while still pending: keep waiting.
      if (details.filledQty > 0 && details.status === "PENDING") {
        if (auditLogger) {
          auditLogger({ type: "PARTIAL_FILL", orderId, ...details });
        }
      }
    }

    await sleep(pollMs);
  }

  // Timeout with a partial fill is reported as PARTIAL so the caller can decide.
  if (lastState && lastState.filledQty > 0) {
    return { ...lastState, status: "PARTIAL", pendingQty: lastState.pendingQty };
  }

  return { ...(lastState || { orderId }), status: "TIMEOUT" };
}

/**
 * Fetch normalized order details from the broker.
 */
export async function getOrderDetails(orderId, session) {
  const data = await fyersApiCall(`/orders/${orderId}`, session);
  const order = data.data || {};
  return {
    orderId,
    status: normalizeStatus(order.status),
    rawStatus: order.status,
    filledQty: extractFilledQty(order),
    pendingQty: extractPendingQty(order),
    avgFillPrice: extractAvgPrice(order),
    symbol: order.symbol || "",
    side: Number(order.side) || 0,
    type: Number(order.type) || 0,
    limitPrice: Number(order.limitPrice) || 0,
    stopPrice: Number(order.stopPrice) || 0,
    statusMessage: order.statusMessage || "",
  };
}

/**
 * Cancel a pending broker order.
 */
export async function cancelOrder(orderId, session, auditLogger = null, _retried = false) {
  if (orderId && String(orderId).startsWith("PAPER-")) {
    if (auditLogger) auditLogger({ type: "PAPER_ORDER_CANCELLED", orderId });
    return { success: true };
  }

  const appId = session.appId ?? process.env.FYERS_APP_ID;
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `${appId}:${session.accessToken}`,
  };
  const url = `${FYERS_API_BASE}/orders/${orderId}`;

  // Try REST-style DELETE first, then fall back to the older POST /orders/cancel.
  let response = await fetch(url, {
    method: "DELETE",
    headers: authHeaders,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok && (response.status === 404 || response.status === 405)) {
    response = await fetch(`${FYERS_API_BASE}/orders/cancel`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ id: orderId }),
      signal: AbortSignal.timeout(10000),
    });
  }

  if (!response.ok) {
    const text = await response.text();
    // Refresh the token once and retry — cancelling a stale SL on close must not be blocked
    // by an expired token.
    if (response.status === 401 && !_retried && (await refreshAccessToken(session))) {
      return cancelOrder(orderId, session, auditLogger, true);
    }
    throw new Error(`Cancel order ${orderId} failed: HTTP ${response.status}: ${text.substring(0, 240)}`);
  }

  const data = await response.json();
  if (data.s !== "ok") {
    if (!_retried && isTokenErrorData(data) && (await refreshAccessToken(session))) {
      return cancelOrder(orderId, session, auditLogger, true);
    }
    throw new Error(data.message || `Cancel order ${orderId} failed`);
  }

  if (auditLogger) auditLogger({ type: "ORDER_CANCELLED", orderId });
  return { success: true, data };
}

/**
 * Convenience helpers for the option-buying strategy used by the bot.
 */
export function placeLimitEntry({ symbol, qty, limitPrice, session, paperTrading = false, auditLogger }) {
  return placeOrder({
    symbol,
    qty,
    side: ORDER_SIDE.BUY,
    type: ORDER_TYPE.LIMIT,
    limitPrice,
    session,
    paperTrading,
    paperFillPrice: limitPrice,
    auditLogger,
  });
}

export function placeMarketExit({ symbol, qty, session, paperTrading = false, paperFillPrice = 0, auditLogger }) {
  return placeOrder({
    symbol,
    qty,
    side: ORDER_SIDE.SELL,
    type: ORDER_TYPE.MARKET,
    session,
    paperTrading,
    paperFillPrice,
    auditLogger,
  });
}

export function placeStopLossOrder({ symbol, qty, stopPrice, session, paperTrading = false, auditLogger }) {
  return placeOrder({
    symbol,
    qty,
    side: ORDER_SIDE.SELL,
    type: ORDER_TYPE.STOP,
    stopPrice,
    session,
    paperTrading,
    paperFillPrice: stopPrice,
    auditLogger,
  });
}

export function placeTargetOrder({ symbol, qty, targetPrice, session, paperTrading = false, auditLogger }) {
  return placeOrder({
    symbol,
    qty,
    side: ORDER_SIDE.SELL,
    type: ORDER_TYPE.LIMIT,
    limitPrice: targetPrice,
    session,
    paperTrading,
    paperFillPrice: targetPrice,
    auditLogger,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

