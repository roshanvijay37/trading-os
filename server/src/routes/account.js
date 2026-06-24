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

  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (data.s !== "ok") {
    throw new Error(data.message || "FYERS API error");
  }

  return data;
}

// Get user profile
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const response = await fyersApiCall(
      "/profile",
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({ profile: response.data });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(400).json({
      error: "Failed to fetch profile",
      message: error.message,
    });
  }
});

// Get available funds
router.get("/funds", requireAuth, async (req, res) => {
  try {
    const response = await fyersApiCall(
      "/funds",
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({ funds: response.fund_limit || [] });
  } catch (error) {
    console.error("Get funds error:", error);
    res.status(400).json({
      error: "Failed to fetch funds",
      message: error.message,
    });
  }
});

// Get holdings
router.get("/holdings", requireAuth, async (req, res) => {
  try {
    const response = await fyersApiCall(
      "/holdings",
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({ holdings: response.holdings || [] });
  } catch (error) {
    console.error("Get holdings error:", error);
    res.status(400).json({
      error: "Failed to fetch holdings",
      message: error.message,
    });
  }
});

// Get positions
router.get("/positions", requireAuth, async (req, res) => {
  try {
    const response = await fyersApiCall(
      "/positions",
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({
      netPositions: response.netPositions || [],
      dayPositions: response.overall || [],
    });
  } catch (error) {
    console.error("Get positions error:", error);
    res.status(400).json({
      error: "Failed to fetch positions",
      message: error.message,
    });
  }
});

// Get market quote for symbols
router.post("/quote", requireAuth, async (req, res) => {
  const { symbols } = req.body; // Array of symbols like ["NSE:RELIANCE-EQ"]

  if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: "symbols array is required" });
  }

  try {
    const response = await fyersApiCall(
      "/quotes",
      req.fyers.accessToken,
      req.fyers.appId,
      { symbols },
      "POST",
    );

    res.json({ quotes: response.d || [] });
  } catch (error) {
    console.error("Get quote error:", error);
    res.status(400).json({
      error: "Failed to fetch quotes",
      message: error.message,
    });
  }
});

// Get market depth for a symbol
router.post("/depth", requireAuth, async (req, res) => {
  const { symbol, ohlcv_flag = 0 } = req.body;

  if (!symbol) {
    return res.status(400).json({ error: "symbol is required" });
  }

  try {
    const response = await fyersApiCall(
      "/depth",
      req.fyers.accessToken,
      req.fyers.appId,
      { symbol, ohlcv_flag },
      "POST",
    );

    res.json({ depth: response.d || {} });
  } catch (error) {
    console.error("Get depth error:", error);
    res.status(400).json({
      error: "Failed to fetch market depth",
      message: error.message,
    });
  }
});

// Search symbols
router.get("/search", requireAuth, async (req, res) => {
  const { q, exchange = "NSE" } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  try {
    const response = await fyersApiCall(
      `/search?query=${encodeURIComponent(q)}&exchange=${exchange}`,
      req.fyers.accessToken,
      req.fyers.appId,
    );

    res.json({ instruments: response.d || [] });
  } catch (error) {
    console.error("Search instruments error:", error);
    res.status(400).json({
      error: "Failed to search instruments",
      message: error.message,
    });
  }
});

// Get option chain for a symbol
router.get("/option-chain", requireAuth, async (req, res) => {
  const { symbol, strikecount = 10 } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: "symbol is required" });
  }

  try {
    // FYERS v3 option chain endpoint
    const url = `https://api-t1.fyers.in/data/options-chain-v3?symbol=${encodeURIComponent(symbol)}&strikecount=${strikecount}`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `${req.fyers.appId}:${req.fyers.accessToken}`,
      },
    });

    const data = await response.json();
    console.log("Option chain response code:", data.code, "status:", data.s);

    if (data.s !== "ok") {
      throw new Error(data.message || "FYERS option chain error");
    }

    // Return optionsChain array and expiry data
    res.json({
      optionChain: data.data?.optionsChain || [],
      expiryData: data.data?.expiryData || [],
      indiavix: data.data?.indiavixData || null,
    });
  } catch (error) {
    console.error("Get option chain error:", error);
    res.status(400).json({
      error: "Failed to fetch option chain",
      message: error.message,
    });
  }
});

export default router;
