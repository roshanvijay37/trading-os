import express from "express";
import { getSession } from "./auth.js";
import {
  connectFyersWebSocket,
  disconnectFyersWebSocket,
  getTicks,
  getLatestTick,
  getAllLatestTicks,
  aggregateOHLC,
  getWsStatus,
  getDayStats,
  clearTickData,
} from "../services/tickService.js";

const router = express.Router();

// ─── Connect WebSocket ────────────────────────────────────────────
router.post("/connect", (req, res) => {
  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(401).json({ error: "Session required" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "Invalid session" });
  }

  try {
    const appId = process.env.FYERS_APP_ID;
    if (!appId) {
      return res.status(500).json({ error: "FYERS_APP_ID not configured" });
    }
    connectFyersWebSocket(session.accessToken, appId);
    res.json({ success: true, message: "WebSocket connection initiated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Disconnect WebSocket ─────────────────────────────────────────
router.post("/disconnect", (req, res) => {
  disconnectFyersWebSocket();
  res.json({ success: true, message: "WebSocket disconnected" });
});

// ─── Get Raw Tick History ─────────────────────────────────────────
router.get("/history", (req, res) => {
  const { symbol = "NIFTY", limit = 5000 } = req.query;
  
  try {
    const ticks = getTicks(symbol, parseInt(limit));
    res.json({
      success: true,
      symbol,
      count: ticks.length,
      ticks,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get OHLC Candles ─────────────────────────────────────────────
router.get("/candles", async (req, res) => {
  const { symbol = "NIFTY", interval = "1m", limit = 500 } = req.query;
  
  try {
    let candles = aggregateOHLC(symbol, interval, parseInt(limit));
    
    // If no local ticks, fetch from FYERS history API
    if (candles.length === 0) {
      candles = await fetchHistoricalCandles(symbol, interval, parseInt(limit));
    }
    
    res.json({
      success: true,
      symbol,
      interval,
      count: candles.length,
      candles,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch historical candles from FYERS API
async function fetchHistoricalCandles(symbol, interval, limit) {
  const { getSession } = await import("./auth.js");
  const { getAllSessions } = await import("./auth.js");
  
  const sessions = getAllSessions();
  if (sessions.length === 0) return [];
  
  const session = sessions[0];
  const fySymbol = symbol === "NIFTY" ? "NSE:NIFTY50-INDEX" : "NSE:NIFTYBANK-INDEX";
  const resolution = interval === "tick" ? "1" : interval.replace("m", "");
  
  const now = Math.floor(Date.now() / 1000);
  const from = now - (limit * parseInt(resolution) * 60);
  
  const url = `https://api-t1.fyers.in/data/history?symbol=${encodeURIComponent(fySymbol)}&resolution=${resolution}&date_format=0&range_from=${from}&range_to=${now}&cont_flag=1`;
  
  const response = await fetch(url, {
    headers: { Authorization: `${process.env.FYERS_APP_ID}:${session.accessToken}` },
  });
  
  const data = await response.json();
  if (!data.candles || data.candles.length === 0) return [];
  
  // Sort by time ascending and remove duplicates
  const seen = new Set();
  const candles = data.candles
    .map((c) => ({
      time: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }))
    .filter((c) => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);
  
  return candles;
}

// ─── Get Latest Tick ──────────────────────────────────────────────
router.get("/latest", (req, res) => {
  const { symbol } = req.query;
  
  try {
    if (symbol) {
      const tick = getLatestTick(symbol);
      res.json({
        success: true,
        symbol,
        tick,
      });
    } else {
      const ticks = getAllLatestTicks();
      res.json({
        success: true,
        ticks,
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get WebSocket Status ─────────────────────────────────────────
router.get("/status", (req, res) => {
  try {
    const status = getWsStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get Day Statistics ───────────────────────────────────────────
router.get("/stats", (req, res) => {
  const { symbol = "NIFTY" } = req.query;
  
  try {
    const stats = getDayStats(symbol);
    res.json({
      success: true,
      symbol,
      stats,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Clear Tick Data ──────────────────────────────────────────────
router.post("/clear", (req, res) => {
  clearTickData();
  res.json({ success: true, message: "Tick data cleared" });
});

export default router;