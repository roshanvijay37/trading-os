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
 * Classify whether a thrown broker-call error is worth retrying. Retryable: network-level
 * failures (timeout/connection) and HTTP 429/5xx — transient, likely to succeed on retry.
 * NOT retryable: 4xx validation/business errors (the broker will reject the identical request
 * every time — retrying just delays the caller) and token/auth errors, which already have their
 * own dedicated single-refresh-and-retry path inside fyersApiCall (retrying those again here
 * would stack an uncoordinated second retry policy on top of that one).
 */
export function isRetryableError(err) {
  if (!err) return false;
  // AbortSignal.timeout() fires with name "TimeoutError" per spec (NOT "AbortError" — that name is
  // reserved for a manual AbortController.abort()). Every broker call in this codebase is bounded
  // via AbortSignal.timeout(10000), so missing this name misclassified every single broker-call
  // timeout as non-retryable, defeating retry (and the orderTag duplicate-order recovery check)
  // on the exact class of failure — a hung connection — retry exists for.
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  if (err instanceof TypeError) return true; // network/connection failure — fetch() itself threw
  if (typeof err.status === "number") return err.status === 429 || err.status >= 500;
  return false;
}

/**
 * Retry a broker call with jittered exponential backoff, but only for transient failures
 * (isRetryableError) — a 4xx or an already-exhausted auth retry fails immediately.
 */
export async function withRetry(fn, { attempts = 3, baseDelayMs = 500, maxDelayMs = 4000, label = "broker call", auditLogger = null } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryableError(err)) throw err;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = backoff * (0.5 + Math.random() * 0.5);
      console.error(`[ORDER] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${Math.round(jitter)}ms:`, err.message);
      if (auditLogger) auditLogger({ type: "BROKER_CALL_RETRY", label, attempt, error: err.message });
      await sleep(jitter);
    }
  }
  throw lastErr;
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
    const err = new Error(`FYERS ${method} ${endpoint} HTTP ${response.status}: ${text.substring(0, 240)}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  if (data.s !== "ok") {
    if (!_retried && isTokenErrorData(data) && (await refreshAccessToken(session))) {
      return fyersApiCall(endpoint, session, body, method, true);
    }
    const err = new Error(data.message || `FYERS ${endpoint} returned error`);
    // FYERS signals its rate limit (10/sec, 200/min, 100k/day) as HTTP 200 with a body-level
    // error (code -353), not an HTTP 429 — isRetryableError only checks err.status, and this
    // branch previously never set it, so a rate-limit hit was always treated as non-retryable
    // and failed immediately with zero backoff (worse: FYERS blocks API access for the rest of
    // the day after repeated per-minute breaches, so not backing off here raises that risk too).
    if (Number(data.code) === -353) err.status = 429;
    throw err;
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
 * Place-order retry loop. Deliberately NOT the generic withRetry: a transient failure (timeout,
 * network blip, 5xx) on the place-order call is ambiguous — the request may have already reached
 * the broker and been accepted before the response was lost, so blindly re-POSTing could create a
 * SECOND, duplicate live order. Before each retry attempt, recover by the unique orderTag first;
 * only issue an actual re-POST if no order with this tag exists yet at the broker.
 */
async function placeOrderWithRetry(orderBody, orderTag, session, auditLogger, symbol, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fyersApiCall(PLACE_ORDER_ENDPOINT, session, { ...orderBody, orderTag }, "POST");
    } catch (err) {
      lastErr = err;

      // Recover via orderTag on EVERY failure — including the FINAL attempt and non-retryable
      // ones — before ever giving up. The request may have reached the broker before the response
      // was lost regardless of whether we're about to retry; skipping this check on the last
      // attempt (as before) meant giving up right when the ambiguous failure was most recent and
      // most likely to have actually landed, silently orphaning a live order.
      const existingId = await findOrderIdByTag(orderTag, session);
      if (existingId) {
        if (auditLogger) {
          auditLogger({ type: "PLACE_ORDER_RECOVERED_VIA_TAG", symbol, orderTag, orderId: existingId });
        }
        return { id: existingId }; // the prior "failed" attempt actually landed — do not re-POST
      }

      if (attempt === attempts || !isRetryableError(err)) throw err;

      const backoff = Math.min(4000, 500 * 2 ** (attempt - 1));
      const jitter = backoff * (0.5 + Math.random() * 0.5);
      console.error(`[ORDER] placeOrder ${symbol} failed (attempt ${attempt}/${attempts}), retrying in ${Math.round(jitter)}ms:`, err.message);
      if (auditLogger) auditLogger({ type: "BROKER_CALL_RETRY", label: `placeOrder ${symbol}`, attempt, error: err.message });
      await sleep(jitter);
    }
  }
  throw lastErr;
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
  // Placing an order gets a BESPOKE retry loop, not the generic withRetry: a "failed" attempt
  // (timeout/network error) may have actually reached the broker before the response was lost —
  // blindly re-POSTing on retry could place a DUPLICATE live order, the single most dangerous
  // failure mode here. Before any retry attempt, check by orderTag whether the prior attempt
  // actually landed; only re-POST if it genuinely didn't.
  const response = await placeOrderWithRetry(orderBody, orderTag, session, auditLogger, symbol);

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
  // Small attempt count / short backoff: getOrderDetails is also called on every tick inside
  // waitForFill's own poll loop, which already tolerates failures by just polling again — a
  // heavier retry here would needlessly compound with that and eat into waitForFill's timeout
  // budget. This still meaningfully helps one-off callers (e.g. ensureStopLoss) recover from a
  // single transient blip without misreading it as "no live order."
  // FYERS's orderbook is a single resource (GET /orders) filtered by an "id" QUERY param — there
  // is no /orders/:id path-segment endpoint (confirmed against the fyers-apiv3 SDK's Config class
  // and orderbook()/get_call() implementation). The old `/orders/${orderId}` path 404'd on every
  // call, which withRetry/waitForFill silently absorbed as "still pending" instead of a real error.
  const data = await withRetry(() => fyersApiCall(`/orders?id=${encodeURIComponent(orderId)}`, session), {
    attempts: 2,
    baseDelayMs: 400,
    label: `getOrderDetails ${orderId}`,
  });
  // The orderbook response wraps results in "orderBook" (confirmed via the FYERS Go SDK model
  // OrderBookResponse.OrderBook, and matches this file's own findOrderIdByTag two functions up) —
  // NOT a bare "data" object. `order` used to silently fall back to {} on every real call.
  const book = data.orderBook || data.data || [];
  const list = Array.isArray(book) ? book : [book];
  const order = list.find((o) => String(o?.id) === String(orderId)) || list[0] || {};
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
 * One cancel attempt, with the existing single-refresh-and-retry-on-401 behavior. Cancelling an
 * already-cancelled or already-filled order is safe to retry (unlike placing one), so the outer
 * withRetry in cancelOrder can wrap this whole attempt without any duplicate-action risk.
 * FYERS cancels via DELETE to the SAME endpoint place_order POSTs to (/orders/sync), with the
 * order id in the JSON body — NOT a /orders/:id path segment, and there is no /orders/cancel
 * endpoint (confirmed against the fyers-apiv3 SDK's cancel_order()/Config.orders_endpoint). The
 * old code's two DELETE/POST attempts both targeted endpoints that don't exist, so a cancel could
 * never actually reach the broker; the order stays live at FYERS with the local record dropped.
 */
async function attemptCancelOrder(orderId, session, _retried = false) {
  const appId = session.appId ?? process.env.FYERS_APP_ID;
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `${appId}:${session.accessToken}`,
  };

  const response = await fetch(`${FYERS_API_BASE}${PLACE_ORDER_ENDPOINT}`, {
    method: "DELETE",
    headers: authHeaders,
    body: JSON.stringify({ id: orderId }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text();
    // Refresh the token once and retry — cancelling a stale SL on close must not be blocked
    // by an expired token.
    if (response.status === 401 && !_retried && (await refreshAccessToken(session))) {
      return attemptCancelOrder(orderId, session, true);
    }
    const err = new Error(`Cancel order ${orderId} failed: HTTP ${response.status}: ${text.substring(0, 240)}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  if (data.s !== "ok") {
    if (!_retried && isTokenErrorData(data) && (await refreshAccessToken(session))) {
      return attemptCancelOrder(orderId, session, true);
    }
    const err = new Error(data.message || `Cancel order ${orderId} failed`);
    // Same FYERS rate-limit signal (body-level code -353, HTTP 200) as fyersApiCall — see that
    // function's comment. Without this, cancelOrder's withRetry never backs off on a rate limit.
    if (Number(data.code) === -353) err.status = 429;
    throw err;
  }
  return { success: true, data };
}

/**
 * Cancel a pending broker order.
 */
export async function cancelOrder(orderId, session, auditLogger = null) {
  if (orderId && String(orderId).startsWith("PAPER-")) {
    if (auditLogger) auditLogger({ type: "PAPER_ORDER_CANCELLED", orderId });
    return { success: true };
  }

  const result = await withRetry(() => attemptCancelOrder(orderId, session), {
    label: `cancelOrder ${orderId}`,
    auditLogger,
  });

  if (auditLogger) auditLogger({ type: "ORDER_CANCELLED", orderId });
  return result;
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

// `side` is a required parameter on every wrapper below (no hardcoded default) — these are used
// to both open (BUY for LONG / SELL for SHORT) and close (the opposite) an EMA5T futures
// position, which trades both directions. An omitted side fails loudly via placeOrder's own
// "Invalid order side" check rather than silently defaulting to one direction. Callers derive
// the correct side from the position's direction + purpose (see futuresOrderSide in
// autoTrader.js, which stays the domain-logic home for that mapping).

export function placeMarketExit({ symbol, qty, side, session, paperTrading = false, paperFillPrice = 0, auditLogger }) {
  return placeOrder({
    symbol,
    qty,
    side,
    type: ORDER_TYPE.MARKET,
    session,
    paperTrading,
    paperFillPrice,
    auditLogger,
  });
}

export function placeStopLossOrder({ symbol, qty, stopPrice, side, session, paperTrading = false, auditLogger }) {
  return placeOrder({
    symbol,
    qty,
    side,
    type: ORDER_TYPE.STOP,
    stopPrice,
    session,
    paperTrading,
    paperFillPrice: stopPrice,
    auditLogger,
  });
}

/**
 * Resting stop-ENTRY order — opens a NEW position when price crosses stopPrice, as opposed to
 * placeStopLossOrder which protects an already-open one. Kept as its own named export (rather
 * than reusing placeStopLossOrder) so audit logs and call sites read unambiguously as entry vs.
 * protective-exit. Defaults to SL-M (no limitPrice), same as before; pass limitPrice > 0 for SL-L.
 */
export function placeStopEntry({ symbol, qty, side, stopPrice, limitPrice = 0, session, paperTrading = false, paperFillPrice = 0, auditLogger }) {
  // limitPrice > 0 → SL-L (caps the worst fill the order will accept); omitted/0 → SL-M
  // (today's default, fills at whatever price is available once triggered), unchanged.
  const type = Number(limitPrice) > 0 ? ORDER_TYPE.STOPLIMIT : ORDER_TYPE.STOP;
  return placeOrder({
    symbol,
    qty,
    side,
    type,
    stopPrice,
    limitPrice,
    session,
    paperTrading,
    paperFillPrice: paperFillPrice || stopPrice,
    auditLogger,
  });
}

export function placeTargetOrder({ symbol, qty, targetPrice, side, session, paperTrading = false, auditLogger }) {
  return placeOrder({
    symbol,
    qty,
    side,
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

