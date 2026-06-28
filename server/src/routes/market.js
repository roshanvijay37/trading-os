import express from "express";
import { getNseMarketStatus, isNseMarketOpen } from "../utils/marketHolidays.js";

const router = express.Router();

/**
 * GET /api/market/status — PUBLIC (no auth).
 * Holiday/weekend-aware NSE market status for the UI status bar, so it is accurate
 * even before the user connects to FYERS.
 */
router.get("/status", (_req, res) => {
  res.json({
    marketStatus: getNseMarketStatus(),
    isOpen: isNseMarketOpen(),
    serverTime: new Date().toISOString(),
  });
});

export default router;
