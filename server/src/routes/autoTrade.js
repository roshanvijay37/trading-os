import express from "express";
import { requireAuth } from "./auth.js";
import {
  startAutoTrader,
  stopAutoTrader,
  getAutoTraderStatus,
  getPerformanceSummary,
  emergencyStop,
  resetEmergencyStop,
  setPaperTrading,
  getAuditLog,
  updateConfig,
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

/**
 * POST /api/auto-trade/emergency-stop
 * IMMEDIATELY halt all trading
 */
router.post("/emergency-stop", requireAuth, (req, res) => {
  try {
    const result = emergencyStop();
    res.json({
      success: true,
      message: "🚨 EMERGENCY STOP ACTIVATED",
      ...result,
    });
  } catch (error) {
    console.error("Emergency stop error:", error);
    res.status(500).json({
      success: false,
      error: "Emergency stop failed",
      message: error.message,
    });
  }
});

/**
 * POST /api/auto-trade/reset-emergency
 * Clear emergency stop state
 */
router.post("/reset-emergency", requireAuth, (req, res) => {
  try {
    const result = resetEmergencyStop();
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Reset emergency error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to reset emergency stop",
      message: error.message,
    });
  }
});

/**
 * POST /api/auto-trade/paper-trading
 * Toggle paper trading mode
 */
router.post("/paper-trading", requireAuth, (req, res) => {
  try {
    const { enabled } = req.body;
    // L3: a money-mode toggle must never default to LIVE. Require an explicit boolean; otherwise
    // setPaperTrading(undefined) would set PAPER_TRADING=falsy → real-money trading by accident.
    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        message: "`enabled` must be a boolean (true = paper, false = live)",
      });
    }
    const result = setPaperTrading(enabled);
    res.json({
      success: true,
      message: `Paper trading ${enabled ? "ENABLED" : "DISABLED"}`,
      ...result,
    });
  } catch (error) {
    console.error("Paper trading error:", error);
    res.status(400).json({
      success: false,
      error: "Failed to set paper trading",
      message: error.message,
    });
  }
});

/**
 * POST /api/auto-trade/config
 * Update auto-trader configuration
 */
router.post("/config", requireAuth, (req, res) => {
  try {
    const result = updateConfig(req.body);
    res.json({
      success: true,
      message: "Configuration updated",
      ...result,
    });
  } catch (error) {
    console.error("Config update error:", error);
    res.status(400).json({
      success: false,
      error: "Failed to update config",
      message: error.message,
    });
  }
});

/**
 * GET /api/auto-trade/audit
 * Get recent audit log
 */
router.get("/audit", requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = getAuditLog(limit);
    res.json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (error) {
    console.error("Audit log error:", error);
    res.status(400).json({
      success: false,
      error: "Failed to get audit log",
      message: error.message,
    });
  }
});

export default router;