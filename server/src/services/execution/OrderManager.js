/**
 * Order Manager
 * Tracks order lifecycle, persists state, reconciles with broker
 */

import fs from "fs";
import path from "path";
import { getOrderById, normalizeOrderStatus } from "../broker/fyersAdapter.js";

const ORDERS_FILE = path.join(process.cwd(), "data", "orders.json");
const WRITE_DEBOUNCE_MS = 500;
let orders = new Map();
let writeTimer = null;

function ensureDataDir() {
  const dir = path.dirname(ORDERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadOrders() {
  try {
    ensureDataDir();
    if (fs.existsSync(ORDERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
      orders = new Map(data.map((o) => [o.orderId, o]));
      console.log(`[ORDER-MANAGER] Loaded ${orders.size} orders`);
    }
  } catch (err) {
    console.error("[ORDER-MANAGER] Load failed:", err.message);
    orders = new Map();
  }
}

function persistOrders() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      ensureDataDir();
      fs.writeFileSync(ORDERS_FILE, JSON.stringify(Array.from(orders.values()), null, 2));
    } catch (err) {
      console.error("[ORDER-MANAGER] Persist failed:", err.message);
    }
  }, WRITE_DEBOUNCE_MS);
}

loadOrders();

export function createOrder(orderData) {
  const order = {
    orderId: orderData.orderId,
    brokerOrderId: orderData.brokerOrderId || null,
    symbol: orderData.symbol,
    qty: orderData.qty,
    side: orderData.side,
    type: orderData.type,
    productType: orderData.productType || "INTRADAY",
    limitPrice: orderData.limitPrice || 0,
    stopPrice: orderData.stopPrice || 0,
    stopLoss: orderData.stopLoss || 0,
    takeProfit: orderData.takeProfit || 0,
    filledQty: 0,
    avgPrice: 0,
    status: "CREATED",
    brokerStatus: null,
    paper: orderData.paper || false,
    strategyId: orderData.strategyId || null,
    signalId: orderData.signalId || null,
    parentOrderId: orderData.parentOrderId || null,
    notes: orderData.notes || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [{ t: new Date().toISOString(), status: "CREATED", msg: "Order created" }],
    rejectedReason: null,
  };
  orders.set(order.orderId, order);
  persistOrders();
  return order;
}

export function updateOrder(orderId, updates) {
  const order = orders.get(orderId);
  if (!order) return null;
  Object.assign(order, updates, { updatedAt: new Date().toISOString() });
  if (updates.status) {
    order.events.push({ t: new Date().toISOString(), status: updates.status, msg: updates.notes || `Status changed to ${updates.status}` });
  }
  orders.set(orderId, order);
  persistOrders();
  return order;
}

export function recordFill(orderId, fillQty, fillPrice) {
  const order = orders.get(orderId);
  if (!order) return null;
  const prevFilled = order.filledQty;
  const newFilled = prevFilled + fillQty;
  const newAvg = newFilled > 0 ? (order.avgPrice * prevFilled + fillPrice * fillQty) / newFilled : 0;
  order.filledQty = newFilled;
  order.avgPrice = Math.round(newAvg * 100) / 100;
  order.status = newFilled >= order.qty ? "FILLED" : "PARTIAL_FILLED";
  order.updatedAt = new Date().toISOString();
  order.events.push({ t: new Date().toISOString(), status: order.status, msg: `Fill ${fillQty} @ ${fillPrice}`, fillQty, fillPrice });
  orders.set(orderId, order);
  persistOrders();
  return order;
}

export function markSubmitted(orderId, brokerOrderId) {
  return updateOrder(orderId, { brokerOrderId, status: "SUBMITTED", notes: `Submitted to broker: ${brokerOrderId}` });
}

export function markRejected(orderId, reason) {
  return updateOrder(orderId, { status: "REJECTED", rejectedReason: reason, notes: `Rejected: ${reason}` });
}

export function markCancelled(orderId, reason = "") {
  return updateOrder(orderId, { status: "CANCELLED", notes: reason ? `Cancelled: ${reason}` : "Cancelled" });
}

export function getOrder(orderId) {
  return orders.get(orderId) || null;
}

export function getAllOrders() {
  return Array.from(orders.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getOpenOrders() {
  return getAllOrders().filter((o) => ["CREATED", "SUBMITTED", "OPEN", "PARTIAL_FILLED"].includes(o.status));
}

export function getOrdersBySymbol(symbol) {
  return getAllOrders().filter((o) => o.symbol === symbol);
}

export function getOrdersByStrategy(strategyId) {
  return getAllOrders().filter((o) => o.strategyId === strategyId);
}

export async function reconcileOrderWithBroker(orderId, accessToken, appId) {
  const order = orders.get(orderId);
  if (!order) return null;
  if (order.paper) return order;
  try {
    const brokerData = await getOrderById(accessToken, appId, order.brokerOrderId || orderId);
    const details = brokerData.data;
    if (!details) return order;
    const status = normalizeOrderStatus(details.status);
    const filledQty = details.filledQty || 0;
    const avgPrice = details.tradedPrice || 0;
    if (status !== order.status || filledQty !== order.filledQty) {
      order.status = status;
      order.brokerStatus = details.status;
      order.filledQty = filledQty;
      order.avgPrice = avgPrice;
      order.updatedAt = new Date().toISOString();
      order.events.push({ t: new Date().toISOString(), status, msg: `Broker reconcile: ${status}, filled ${filledQty}/${order.qty} @ ${avgPrice}` });
      orders.set(orderId, order);
      persistOrders();
    }
    return order;
  } catch (err) {
    console.error(`[ORDER-MANAGER] Reconcile failed for ${orderId}:`, err.message);
    return order;
  }
}

export async function reconcileAllOrders(accessToken, appId) {
  const openOrders = getOpenOrders().filter((o) => !o.paper);
  const results = [];
  for (const order of openOrders) {
    const updated = await reconcileOrderWithBroker(order.orderId, accessToken, appId);
    if (updated) results.push(updated);
  }
  return results;
}

export function clearOrders() {
  orders.clear();
  persistOrders();
}

export function getOrderStats() {
  const all = getAllOrders();
  return {
    total: all.length,
    open: all.filter((o) => ["CREATED", "SUBMITTED", "OPEN", "PARTIAL_FILLED"].includes(o.status)).length,
    filled: all.filter((o) => o.status === "FILLED").length,
    rejected: all.filter((o) => o.status === "REJECTED").length,
    cancelled: all.filter((o) => o.status === "CANCELLED").length,
  };
}
