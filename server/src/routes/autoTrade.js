import express from "express";
import { requireAuth } from "./auth.js";
import {
  startAutoTrader,
  stopAutoTrader,
  getAutoTraderStatus,
  getPerformanceSummary,
} from "../services/autoTrader.js";

const router = express.Router();

/**
 * POST /api/auto-trade/start
 * Start the automated trading system
 */
router.post("/start", requireAuth, async (req, res) => {
  try {
    const sessionId = req.headers["x-session-id"];
    const result = await startAutoTrader(sessionId);
    
    res.json({
      success: true,
      message: "Auto-trader started",
      ...result,
    });
  } catch (error) {
    console.error("Start auto-trade error:", error);
    res.status(400).json({
      success: false,
      error: "Failed to start auto-trader",
      message: error.message,
    });
  }
});

/**
 * POST /api/auto-trade/stop
 * Stop the automated trading system
 */
router.post("/stop", requireAuth, (req, res) => {
  try {
    const result = stopAutoTrader();
    
    res.json({
      success: true,
      message: "Auto-trader stopped",
      ...result,
    });
  } catch (error) {
    console.error("Stop auto-trade error:", error);
    res.status(400).json({
      success: false,
      error: "Failed to stop auto-trader",
      message: error.message,
    });
  }
});

/**
 * GET /api/auto-trade/status
 * Get current auto-trader status
 */
router.get("/status", requireAuth, (req, res) => {
  try {
    const status = getAutoTraderStatus();
    
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error("Get auto-trade status error:", error);
    res.status(400).json({
      success: false,
      error: "Failed to get status",
      message: error.message,
    });
  }
});

/**
 * GET /api/auto-trade/performance
 * Get performance summary
 */
router.get("/performance", requireAuth, (req, res) => {
  try {
    const summary = getPerformanceSummary();
    
    res.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    console.error("Get performance error:", error);
    res.status(400).json({
      success: false,
      error: "Failed to get performance",
      message: error.message,
    });
  }
});

export default router;