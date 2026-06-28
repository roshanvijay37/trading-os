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

const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";

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
 * Make a raw FYERS API call.
 */
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
    throw new Error(`FYERS ${method} ${endpoint} HTTP ${response.status}: ${text.substring(0, 240)}`);
  }

  const data = await response.json();
  if (data.s !== "ok") {
    throw new Error(data.message || `FYERS ${endpoint} returned error`);
  }
  return data;
}

/**
 * FYERS returns order status as a number. Map it to a canonical string.
 * Common v3 status codes observed in FYERS:
 *   1 = Pending / Open
 *   2 = Filled / Executed
 *   3 = Rejected
 *   4 = Cancelled
 */
function normalizeStatus(status) {
  if (status === null || status === undefined) return "UNKNOWN";
  const num = Number(status);
  if (!Number.isNaN(num)) {
    switch (num) {
      case 1:
        return "PENDING";
      case 2:
        return "FILLED";
      case 3:
        return "REJECTED";
      case 4:
        return "CANCELLED";
      default:
        return "UNKNOWN";
    }
  }
  const s = String(status).toUpperCase();
  if (s === "FILLED" || s === "EXECUTED" || s === "TRADED") return "FILLED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "PENDING" || s === "OPEN" || s === "AMO") return "PENDING";
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

  const response = await fyersApiCall("/orders/async", session.accessToken, session.appId ?? process.env.FYERS_APP_ID, orderBody, "POST");

  if (auditLogger) {
    auditLogger({
      type: "ORDER_PLACED",
      orderId: response.id,
      symbol,
      qty,
      side,
      type,
      limitPrice: orderBody.limitPrice,
      stopPrice: orderBody.stopPrice,
    });
  }

  return {
    orderId: response.id,
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
 */
export async function waitForFill(orderId, session, options = {}) {
  const { timeoutMs = 30000, pollMs = 1000, paperTrading = false, paperFillPrice = 0, auditLogger = null } = options;

  const start = Date.now();
  let lastState = null;

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

    const details = await getOrderDetails(orderId, session);
    lastState = details;

    if (["FILLED", "REJECTED", "CANCELLED"].includes(details.status)) {
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
  const data = await fyersApiCall(`/orders/${orderId}`, session.accessToken, session.appId ?? process.env.FYERS_APP_ID);
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
export async function cancelOrder(orderId, session, auditLogger = null) {
  if (orderId && orderId.startsWith("PAPER-")) {
    if (auditLogger) auditLogger({ type: "PAPER_ORDER_CANCELLED", orderId });
    return { success: true };
  }

  const appId = session.appId ?? process.env.FYERS_APP_ID;
  const url = `${FYERS_API_BASE}/orders/${orderId}`;

  // Try REST-style DELETE first, then fall back to the older POST /orders/cancel.
  let response = await fetch(url, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${appId}:${session.accessToken}`,
    },
  });

  if (!response.ok && (response.status === 404 || response.status === 405)) {
    response = await fetch(`${FYERS_API_BASE}/orders/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `${appId}:${session.accessToken}`,
      },
      body: JSON.stringify({ id: orderId }),
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cancel order ${orderId} failed: HTTP ${response.status}: ${text.substring(0, 240)}`);
  }

  const data = await response.json();
  if (data.s !== "ok") {
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

