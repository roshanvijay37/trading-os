import express from "express";
import { requireAuth } from "./auth.js";
import { recordVix } from "../services/ivHistory.js";
import { maybeBackfillVix } from "../services/vixBackfill.js";
import { NIFTY50_SYMBOLS, computeBreadth } from "../services/marketBreadth.js";

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
  
  // Check HTTP status first
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
    console.error("Get profile error:", error.message);
    const status = error.status || 400;
    res.status(status).json({
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
    console.error("Get funds error:", error.message);
    const status = error.status || 400;
    res.status(status).json({
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
    console.error("Get holdings error:", error.message);
    const status = error.status || 400;
    res.status(status).json({
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
    console.error("Get positions error:", error.message);
    const status = error.status || 400;
    res.status(status).json({
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

// Market breadth (advance / decline) over the NIFTY 50 constituent basket.
// Derived live from FYERS quotes — FYERS has no breadth endpoint, but it quotes the constituents.
// NB: quotes live on the DATA host (GET /data/quotes?symbols=a,b,c), not /api/v3 — same call the
// live engine (autoTrader.js) uses. Each symbol is URL-encoded so '&' in NSE:M&M-EQ is preserved.
router.get("/breadth", requireAuth, async (req, res) => {
  try {
    // /data/quotes caps at 50 symbols/request; chunk so the basket can grow past 50 later.
    const quotes = [];
    for (let i = 0; i < NIFTY50_SYMBOLS.length; i += 50) {
      const chunk = NIFTY50_SYMBOLS.slice(i, i + 50);
      const url = `https://api-t1.fyers.in/data/quotes?symbols=${chunk.map(encodeURIComponent).join(",")}`;
      const response = await fetch(url, {
        headers: { Authorization: `${req.fyers.appId}:${req.fyers.accessToken}` },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const err = new Error(`FYERS quotes ${response.status}: ${text.slice(0, 120)}`);
        err.status = response.status;
        throw err;
      }
      const data = await response.json();
      if (data.s !== "ok") throw new Error(data.message || "FYERS quotes error");
      if (Array.isArray(data.d)) quotes.push(...data.d);
    }

    const breadth = computeBreadth(quotes);
    res.json({
      ...breadth,
      universe: "NIFTY 50",
      universeSize: NIFTY50_SYMBOLS.length,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Get breadth error:", error.message);
    const status = error.status || 400;
    res.status(status).json({
      error: "Failed to fetch market breadth",
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
  const { symbol, strikecount = 10, expiry } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: "symbol is required" });
  }

  try {
    // FYERS v3 option chain endpoint. `expiry` (a value from the returned expiryData[].expiry)
    // selects a non-nearest expiry; omitting it returns the nearest expiry's chain. Forwarding
    // it is additive — existing callers that don't pass it are unaffected.
    let url = `https://api-t1.fyers.in/data/options-chain-v3?symbol=${encodeURIComponent(symbol)}&strikecount=${strikecount}`;
    if (expiry) url += `&timestamp=${encodeURIComponent(expiry)}`;

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

    // Persist today's India VIX so IV Rank/Percentile can be computed against a real series.
    // Best-effort: never let a storage hiccup break the option-chain response.
    try {
      recordVix(data.data?.indiavixData);
    } catch (err) {
      console.error("[option-chain] VIX record failed:", err.message);
    }

    // One-time backfill of a year of daily India VIX from FYERS history so IV Rank is meaningful
    // immediately. Fire-and-forget (don't delay this response) and self-guarded against re-runs.
    maybeBackfillVix(req.fyers.appId, req.fyers.accessToken).catch((err) =>
      console.error("[option-chain] VIX backfill failed:", err.message),
    );

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
