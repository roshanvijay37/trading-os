import express from "express";
import { getNseMarketStatus, isNseMarketOpen } from "../utils/marketHolidays.js";
import { getIvStats } from "../services/ivHistory.js";
import { getFiiDii } from "../services/fiiDii.js";

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

/**
 * GET /api/market/iv-history — PUBLIC (no auth).
 * India VIX Rank / Percentile from the persisted daily series. `sufficient` is false until
 * enough days have accrued (samples < minSamples), so the UI can show "building history"
 * rather than a misleading number.
 */
router.get("/iv-history", (_req, res) => {
  try {
    res.json(getIvStats());
  } catch (err) {
    console.error("[market] iv-history error:", err.message);
    res.status(500).json({ error: "Failed to compute IV history", message: err.message });
  }
});

/**
 * GET /api/market/fii-dii — PUBLIC (no auth; NSE end-of-day data, not the broker feed).
 * FII/DII cash-market buy/sell/net in ₹ crore. Cached server-side; `available: false` is
 * returned (HTTP 200) when NSE is unreachable so the UI can show an honest "no data" state.
 */
router.get("/fii-dii", async (_req, res) => {
  try {
    res.json(await getFiiDii());
  } catch (err) {
    console.error("[market] fii-dii error:", err.message);
    res.status(200).json({ available: false, source: "NSE (EOD cash market)", error: err.message });
  }
});

export default router;
