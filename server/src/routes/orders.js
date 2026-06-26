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

  const options = { method, headers };
  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[FYERS API] ${endpoint} returned ${response.status}: ${errorText.substring(0, 200)}`);
    const error = new Error(`FYERS API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (data.s !== "ok") {
    const error = new Error(data.message || "FYERS API error");
    error.status = 400;
    throw error;
  }

  return data;
}

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
    console.error("Get order history error:", error.message);
    const status = error.status || 400;
    res.status(status).json({
      error: "Failed to fetch order history",
      message: error.message,
    });
  }
});

// Get today's trades
router.get("/trades/today", requireAuth, async (req, res) => {
  try {
    const response = await fyersApiCall(
      "/tradebook",
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({ trades: response.tradeBook || [] });
  } catch (error) {
    console.error("Get trades error:", error.message);
    const status = error.status || 400;
    res.status(status).json({
      error: "Failed to fetch trades",
      message: error.message,
    });
  }
});

export default router;