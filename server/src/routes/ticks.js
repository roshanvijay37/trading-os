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
    connectFyersWebSocket(session.accessToken, session.appId);
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
router.get("/candles", (req, res) => {
  const { symbol = "NIFTY", interval = "1m", limit = 500 } = req.query;
  
  try {
    const candles = aggregateOHLC(symbol, interval, parseInt(limit));
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