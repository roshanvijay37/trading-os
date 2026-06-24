import express from "express";
import { requireAuth } from "./auth.js";

const router = express.Router();

const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";

// Helper to make FYERS API calls
async function fyersApiCall(endpoint, accessToken, appId, body = null, method = "GET") {
  const url = `${FYERS_API_BASE}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `${appId}:${accessToken}`,
  };

  const options = {
    method,
    headers,
  };

  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const responseText = await response.text();
  
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    console.error("FYERS non-JSON response:", responseText.slice(0, 500));
    throw new Error(`FYERS returned non-JSON response: ${responseText.slice(0, 200)}`);
  }

  if (data.s !== "ok") {
    throw new Error(data.message || `FYERS error: ${JSON.stringify(data)}`);
  }

  return data;
}

// Place a real order through FYERS
router.post("/place", requireAuth, async (req, res) => {
  const {
    symbol,
    qty,
    side, // 1 = Buy, -1 = Sell
    type, // 1 = Limit, 2 = Market, 3 = Stop, 4 = Stoplimit
    limitPrice = 0,
    stopPrice = 0,
    productType = "INTRADAY", // INTRADAY, CNC, CO, BO, MARGIN
  } = req.body;

  // Validate required fields
  if (!symbol || !qty || !side) {
    return res.status(400).json({
      error: "symbol, qty, and side are required",
    });
  }

  try {
    const orderBody = {
      symbol: symbol.toUpperCase(),
      qty: parseInt(qty),
      side: parseInt(side),
      type: parseInt(type) || 2, // Default to Market
      productType: productType.toUpperCase(),
      limitPrice: parseFloat(limitPrice) || 0,
      stopPrice: parseFloat(stopPrice) || 0,
      disclosedQty: 0,
      validity: "DAY",
      offlineOrder: false,
      stopLoss: 0,
      takeProfit: 0,
    };

    console.log("Placing order to FYERS:", JSON.stringify(orderBody));
    const response = await fyersApiCall(
      "/orders/async",
      req.fyers.accessToken,
      req.fyers.appId,
      orderBody,
      "POST",
    );
    console.log("FYERS order response:", JSON.stringify(response));

    res.json({
      success: true,
      orderId: response.id,
      status: "placed",
      message: response.message,
      details: orderBody,
    });
  } catch (error) {
    console.error("Order placement error:", error);
    res.status(400).json({
      error: "Failed to place order",
      message: error.message,
    });
  }
});

// Cancel an order
router.delete("/cancel/:orderId", requireAuth, async (req, res) => {
  const { orderId } = req.params;

  try {
    const response = await fyersApiCall(
      `/orders?id=${orderId}`,
      req.fyers.accessToken,
      req.fyers.appId,
      null,
      "DELETE",
    );

    res.json({
      success: true,
      orderId,
      status: "cancelled",
      message: response.message,
    });
  } catch (error) {
    console.error("Order cancellation error:", error);
    res.status(400).json({
      error: "Failed to cancel order",
      message: error.message,
    });
  }
});

// Modify an order
router.put("/modify/:orderId", requireAuth, async (req, res) => {
  const { orderId } = req.params;
  const { qty, type, side, limitPrice, stopPrice, productType } = req.body;

  try {
    const modifyBody = {
      id: orderId,
      qty: parseInt(qty),
      type: parseInt(type),
      side: parseInt(side),
      limitPrice: parseFloat(limitPrice) || 0,
      stopPrice: parseFloat(stopPrice) || 0,
      productType: productType.toUpperCase(),
    };

    const response = await fyersApiCall(
      "/orders",
      req.fyers.accessToken,
      req.fyers.appId,
      modifyBody,
      "PATCH",
    );

    res.json({
      success: true,
      orderId,
      status: "modified",
      message: response.message,
    });
  } catch (error) {
    console.error("Order modification error:", error);
    res.status(400).json({
      error: "Failed to modify order",
      message: error.message,
    });
  }
});

// Get order history
router.get("/history", requireAuth, async (req, res) => {
  try {
    const response = await fyersApiCall(
      "/orders",
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({ orders: response.orderBook || [] });
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(400).json({
      error: "Failed to fetch orders",
      message: error.message,
    });
  }
});

// Get individual order details
router.get("/:orderId", requireAuth, async (req, res) => {
  try {
    const response = await fyersApiCall(
      `/orders?id=${req.params.orderId}`,
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({ order: response.orderBook?.[0] || null });
  } catch (error) {
    console.error("Get order error:", error);
    res.status(400).json({
      error: "Failed to fetch order",
      message: error.message,
    });
  }
});

// Get trades for the day
router.get("/trades/today", requireAuth, async (req, res) => {
  try {
    const response = await fyersApiCall(
      "/tradebook",
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({ trades: response.tradeBook || [] });
  } catch (error) {
    console.error("Get trades error:", error);
    res.status(400).json({
      error: "Failed to fetch trades",
      message: error.message,
    });
  }
});

export default router;