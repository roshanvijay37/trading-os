/**
 * Equity MIS trader routes — mirrors routes/autoTrade.js's surface (start/stop/status/config/
 * paper-trading/emergency-stop/audit) for the isolated cash-equity EMA5T service
 * (services/equityTrader.js). The futures bot's routes and service are untouched.
 */
import express from "express";
import { requireAuth } from "./auth.js";
import {
  startEquityTrader,
  stopEquityTrader,
  getEquityStatus,
  updateEquityConfig,
  setEquityEmergencyStop,
  setEquityPaperTrading,
  getEquityAuditLog,
} from "../services/equityTrader.js";

const router = express.Router();

router.post("/start", requireAuth, async (req, res) => {
  try {
    const sessionId = req.headers["x-session-id"];
    const result = await startEquityTrader(sessionId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/stop", requireAuth, (_req, res) => {
  try {
    res.json({ success: true, ...stopEquityTrader() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/status", requireAuth, (_req, res) => {
  try {
    res.json({ success: true, ...getEquityStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/config", requireAuth, (req, res) => {
  try {
    res.json({ success: true, ...updateEquityConfig(req.body || {}) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/emergency-stop", requireAuth, (req, res) => {
  try {
    res.json({ success: true, ...setEquityEmergencyStop(req.body?.enabled === true) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/paper-trading", requireAuth, (req, res) => {
  try {
    res.json({ success: true, ...setEquityPaperTrading(req.body?.enabled) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/audit", requireAuth, (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    res.json({ success: true, audit: getEquityAuditLog(limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
