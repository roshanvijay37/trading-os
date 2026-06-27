/**
 * FYERS API v3 Adapter
 * Clean, retry-aware broker interface for order execution
 */

const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

async function fyersApiCall(endpoint, accessToken, appId, body = null, method = "GET") {
  const url = `${FYERS_API_BASE}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `${appId}:${accessToken}`,
  };
  const options = { method, headers };
  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { s: "error", message: text.substring(0, 200) }; }
  if (!response.ok || data.s !== "ok") {
    const err = new Error(data.message || `FYERS API ${response.status}`);
    err.status = response.status;
    err.code = data.code || "UNKNOWN";
    err.fyersData = data;
    throw err;
  }
  return data;
}

export async function placeOrder(accessToken, appId, order) {
  return fyersApiCall("/orders", accessToken, appId, order, "POST");
}

export async function modifyOrder(accessToken, appId, modifyPayload) {
  return fyersApiCall("/orders", accessToken, appId, modifyPayload, "PATCH");
}

export async function cancelOrder(accessToken, appId, orderId) {
  return fyersApiCall(`/orders?id=${orderId}`, accessToken, appId, null, "DELETE");
}

export async function getOrderBook(accessToken, appId) {
  return fyersApiCall("/orders", accessToken, appId);
}

export async function getOrderById(accessToken, appId, orderId) {
  return fyersApiCall(`/orders?id=${orderId}`, accessToken, appId);
}

export async function getTradeBook(accessToken, appId) {
  return fyersApiCall("/tradebook", accessToken, appId);
}

export async function getPositions(accessToken, appId) {
  return fyersApiCall("/positions", accessToken, appId);
}

export async function getFunds(accessToken, appId) {
  return fyersApiCall("/funds", accessToken, appId);
}

export async function getQuotes(accessToken, appId, symbols) {
  return fyersApiCall("/quotes", accessToken, appId, { symbols }, "POST");
}

export async function getMarketDepth(accessToken, appId, symbol) {
  return fyersApiCall("/depth", accessToken, appId, { symbol, ohlcv_flag: 1 }, "POST");
}

export async function getHistoricalData(accessToken, appId, symbol, resolution, fromTs, toTs) {
  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&date_format=0&range_from=${fromTs}&range_to=${toTs}&cont_flag=1`;
  const response = await fetch(url, { headers: { Authorization: `${appId}:${accessToken}` } });
  return response.json();
}

export async function getOptionChain(accessToken, appId, symbol, strikecount = 5) {
  const url = `${FYERS_DATA_BASE}/options-chain-v3?symbol=${encodeURIComponent(symbol)}&strikecount=${strikecount}`;
  const response = await fetch(url, { headers: { Authorization: `${appId}:${accessToken}` } });
  return response.json();
}

export async function getAvailableBalance(accessToken, appId) {
  const data = await getFunds(accessToken, appId);
  const funds = data.fund_limit || [];
  const available = funds.find((f) => f.title === "Available Balance");
  return available ? available.equityAmount : 0;
}

export function normalizeOrderStatus(fyersStatus) {
  const map = { 1: "PENDING", 2: "SENT_TO_EXCHANGE", 3: "CANCELLED", 4: "TRANSIT", 5: "REJECTED", 6: "PARTIAL_FILLED", 7: "FILLED", 8: "EXPIRED" };
  return map[fyersStatus] || `UNKNOWN(${fyersStatus})`;
}

export function buildBracketOrder({ symbol, qty, side, type, limitPrice = 0, stopLoss, takeProfit }) {
  return { symbol, qty, side, type, productType: "BO", limitPrice: type === 1 ? limitPrice : 0, stopPrice: 0, disclosedQty: 0, validity: "DAY", offlineOrder: false, stopLoss, takeProfit };
}

export function buildRegularOrder({ symbol, qty, side, type, limitPrice = 0, stopPrice = 0, productType = "INTRADAY", validity = "DAY" }) {
  return { symbol, qty, side, type, productType, limitPrice, stopPrice, disclosedQty: 0, validity, offlineOrder: false, stopLoss: 0, takeProfit: 0 };
}
