import express from "express";
import { requireAuth } from "./auth.js";

const router = express.Router();

const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";

// Shared FYERS caller (mirrors the pattern in orders.js / account.js).
async function fyersApiCall(endpoint, accessToken, appId, body = null, method = "GET") {
  const url = `${FYERS_API_BASE}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `${appId}:${accessToken}`,
  };
  const options = { method, headers };
  if (body && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.s === "error") {
    const error = new Error(data.message || `FYERS API returned ${response.status}`);
    error.status = response.ok ? 400 : response.status;
    error.fyers = data;
    throw error;
  }
  return data;
}

// FYERS numeric enums.
const SIDE = { BUY: 1, SELL: -1 };
const ORDER_TYPE = { LIMIT: 1, MARKET: 2, "SL-M": 3, SL: 4 }; // 3 = SL-Market, 4 = SL-Limit
const PRODUCT = { INTRADAY: "INTRADAY", MARGIN: "MARGIN", CNC: "CNC" };

function buildOrderPayload(b) {
  const side = SIDE[b.side];
  const type = ORDER_TYPE[b.orderType];
  if (side === undefined) throw Object.assign(new Error("Invalid side"), { status: 400 });
  if (type === undefined) throw Object.assign(new Error("Invalid orderType"), { status: 400 });
  if (!b.symbol) throw Object.assign(new Error("symbol is required"), { status: 400 });
  if (!(Number(b.qty) > 0)) throw Object.assign(new Error("qty must be > 0"), { status: 400 });

  return {
    symbol: b.symbol,
    qty: Number(b.qty),
    type,
    side,
    productType: PRODUCT[b.productType] || "INTRADAY",
    limitPrice: b.orderType === "LIMIT" || b.orderType === "SL" ? Number(b.limitPrice) || 0 : 0,
    stopPrice: b.orderType === "SL" || b.orderType === "SL-M" ? Number(b.stopPrice) || 0 : 0,
    validity: b.validity === "IOC" ? "IOC" : "DAY",
    disclosedQty: 0,
    offlineOrder: false,
    orderTag: "optionsws",
  };
}

// ─── Place a LIVE order (single) ──────────────────────────────────
router.post("/place-order", requireAuth, async (req, res) => {
  try {
    const payload = buildOrderPayload(req.body || {});
    // Synchronous endpoint returns the order id immediately (no async ack race).
    const response = await fyersApiCall("/orders/sync", req.fyers.accessToken, req.fyers.appId, payload, "POST");
    res.json({ success: true, id: response.id || response.orderId || null, raw: response });
  } catch (error) {
    console.error("[options] place-order error:", error.message);
    res.status(error.status || 400).json({ error: "Order placement failed", message: error.message, fyers: error.fyers });
  }
});

// ─── Place a BASKET of orders (sequential, fail-safe) ─────────────
router.post("/basket-order", requireAuth, async (req, res) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (orders.length === 0) return res.status(400).json({ error: "orders array is required" });

  const results = [];
  for (const o of orders) {
    try {
      const payload = buildOrderPayload(o);
      const response = await fyersApiCall("/orders/sync", req.fyers.accessToken, req.fyers.appId, payload, "POST");
      results.push({ symbol: o.symbol, success: true, id: response.id || null });
    } catch (error) {
      results.push({ symbol: o.symbol, success: false, message: error.message });
    }
  }
  res.json({ results, placed: results.filter((r) => r.success).length, total: orders.length });
});

// ─── Modify an order ──────────────────────────────────────────────
router.patch("/modify-order", requireAuth, async (req, res) => {
  const { id, limitPrice, stopPrice, qty, orderType } = req.body || {};
  if (!id) return res.status(400).json({ error: "order id is required" });
  try {
    const body = { id };
    if (qty != null) body.qty = Number(qty);
    if (limitPrice != null) body.limitPrice = Number(limitPrice);
    if (stopPrice != null) body.stopPrice = Number(stopPrice);
    if (orderType != null && ORDER_TYPE[orderType] != null) body.type = ORDER_TYPE[orderType];
    const response = await fyersApiCall("/orders/sync", req.fyers.accessToken, req.fyers.appId, body, "PATCH");
    res.json({ success: true, raw: response });
  } catch (error) {
    console.error("[options] modify-order error:", error.message);
    res.status(error.status || 400).json({ error: "Order modify failed", message: error.message });
  }
});

// ─── Cancel an order ──────────────────────────────────────────────
router.post("/cancel-order", requireAuth, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "order id is required" });
  try {
    const response = await fyersApiCall("/orders/sync", req.fyers.accessToken, req.fyers.appId, { id }, "DELETE");
    res.json({ success: true, raw: response });
  } catch (error) {
    console.error("[options] cancel-order error:", error.message);
    res.status(error.status || 400).json({ error: "Order cancel failed", message: error.message });
  }
});

// ─── Broker margin calculator (SPAN+exposure) for a basket ────────
router.post("/margin", requireAuth, async (req, res) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (orders.length === 0) return res.status(400).json({ error: "orders array is required" });
  try {
    const data = orders.map((o) => ({
      symbol: o.symbol,
      qty: Number(o.qty) || 0,
      side: SIDE[o.side] ?? 1,
      type: ORDER_TYPE[o.orderType] ?? 2,
      productType: PRODUCT[o.productType] || "INTRADAY",
      limitPrice: Number(o.limitPrice) || 0,
      stopLoss: 0,
      stopPrice: Number(o.stopPrice) || 0,
      takeProfit: 0,
    }));
    const response = await fyersApiCall("/multiorder/margin", req.fyers.accessToken, req.fyers.appId, { data }, "POST");
    res.json({ available: true, margin: response.data || response });
  } catch (error) {
    // Don't fail hard — the client falls back to a clearly-labelled local SPAN estimate.
    console.error("[options] margin error:", error.message);
    res.json({ available: false, message: error.message });
  }
});

// ─── Generic historical candles for ANY symbol (option premium / OI charts) ──
router.get("/history", requireAuth, async (req, res) => {
  const { symbol, resolution = "5", days = "5" } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });
  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - Math.min(parseInt(days, 10) || 5, 100) * 24 * 3600;
    const url =
      `https://api-t1.fyers.in/data/history?symbol=${encodeURIComponent(symbol)}` +
      `&resolution=${encodeURIComponent(resolution)}&date_format=0&range_from=${from}&range_to=${now}&cont_flag=1`;
    const response = await fetch(url, {
      headers: { Authorization: `${req.fyers.appId}:${req.fyers.accessToken}` },
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => ({}));
    if (data.s !== "ok" || !Array.isArray(data.candles)) {
      return res.json({ candles: [] });
    }
    const candles = data.candles.map((c) => ({
      time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
    }));
    res.json({ candles });
  } catch (error) {
    console.error("[options] history error:", error.message);
    res.status(error.status || 400).json({ error: "Failed to fetch history", message: error.message });
  }
});

export default router;
