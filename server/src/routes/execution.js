/**
 * Execution API Routes
 * Order management, position tracking, execution control
 */

import express from "express";
import { requireAuth } from "./auth.js";
import {
  setPaperTrading,
  isPaperTrading,
  submitEntry,
  submitExit,
  cancelAllOpenOrders,
  startReconciliation,
  stopReconciliation,
} from "../services/execution/ExecutionEngine.js";
import {
  getAllOrders,
  getOpenOrders,
  getOrder,
  reconcileAllOrders,
  clearOrders,
} from "../services/execution/OrderManager.js";

const router = express.Router();

// Get all orders
router.get("/orders", requireAuth, (req, res) => {
  try {
    const orders = getAllOrders();
    res.json({ success: true, count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get open orders
router.get("/orders/open", requireAuth, (req, res) => {
  try {
    const orders = getOpenOrders();
    res.json({ success: true, count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get order by ID
router.get("/orders/:id", requireAuth, (req, res) => {
  try {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reconcile orders with broker
router.post("/orders/reconcile", requireAuth, async (req, res) => {
  try {
    const results = await reconcileAllOrders(req.fyers.accessToken, req.fyers.appId);
    res.json({ success: true, count: results.length, orders: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear all orders (dangerous, admin only)
router.post("/orders/clear", requireAuth, (req, res) => {
  clearOrders();
  res.json({ success: true, message: "All orders cleared" });
});

// Cancel all open orders
router.post("/orders/cancel-all", requireAuth, async (req, res) => {
  try {
    const result = await cancelAllOpenOrders();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get execution mode
router.get("/mode", requireAuth, (req, res) => {
  res.json({ success: true, paperTrading: isPaperTrading() });
});

// Set execution mode
router.post("/mode", requireAuth, (req, res) => {
  const { paper } = req.body;
  if (typeof paper !== "boolean") {
    return res.status(400).json({ success: false, error: "paper boolean required" });
  }
  const result = setPaperTrading(paper);
  res.json({ success: true, ...result });
});

export default router;
