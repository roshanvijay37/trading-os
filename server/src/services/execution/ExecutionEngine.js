import crypto from "crypto";
import { placeOrder, cancelOrder, buildBracketOrder, buildRegularOrder, getOrderById, normalizeOrderStatus, getAvailableBalance } from "../broker/fyersAdapter.js";
import { createOrder, markSubmitted, markRejected, recordFill, markCancelled, getOpenOrders, reconcileOrderWithBroker } from "./OrderManager.js";
import { simulateOrderPlacement, simulateMarketExit } from "./PaperEngine.js";

let paperTrading = true;
let activeSession = null;
let reconcileInterval = null;
let orderPollers = new Map();
const RECONCILE_INTERVAL_MS = 10000;
const ORDER_POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;

export function setSession(session) { activeSession = session; }
export function getSession() { return activeSession; }
export function isPaperTrading() { return paperTrading; }
export function setPaperTrading(enabled) { paperTrading = enabled; console.log(`[EXECUTION] Mode: ${enabled ? "PAPER" : "LIVE"}`); return { paperTrading }; }

export async function preTradeCheck(symbol, qty, side, estimatedValue) {
  if (!activeSession) return { pass: false, reason: "No broker session" };
  try {
    const balance = await getAvailableBalance(activeSession.accessToken, activeSession.appId);
    if (balance < estimatedValue * 1.5) return { pass: false, reason: `Insufficient funds. Need ~₹${(estimatedValue * 1.5).toFixed(0)}, have ₹${balance.toFixed(0)}` };
    return { pass: true, balance };
  } catch (err) { return { pass: false, reason: `Risk check error: ${err.message}` }; }
}

export async function submitEntry(signal, optionSymbol, qty, strategyId = "EMA5") {
  if (!activeSession) throw new Error("No active broker session");
  const orderId = `ord-${crypto.randomUUID()}`;
  const isPaper = paperTrading;
  const side = signal.type === "LONG" ? 1 : -1;
  const riskPoints = Math.abs(signal.entryPrice - signal.stopLoss);
  const stopLoss = Math.round(riskPoints * 100) / 100;
  const takeProfit = Math.round(riskPoints * 2 * 100) / 100;

  let orderPayload;
  let orderType;

  if (isPaper) {
    orderPayload = buildRegularOrder({ symbol: optionSymbol, qty, side, type: 2 });
    orderType = "MARKET";
  } else {
    orderPayload = buildBracketOrder({ symbol: optionSymbol, qty, side, type: 1, limitPrice: signal.entryPrice, stopLoss, takeProfit });
    orderType = "BRACKET";
  }

  const orderRecord = createOrder({
    orderId, symbol: optionSymbol, qty, side,
    type: isPaper ? 2 : 1, productType: isPaper ? "INTRADAY" : "BO",
    limitPrice: signal.entryPrice, stopLoss, takeProfit,
    paper: isPaper, strategyId,
    signalId: `${signal.underlying}-${signal.timestamp}-${signal.type}`,
    notes: `${orderType} ${signal.type} entry`,
  });

  const estValue = signal.entryPrice * qty;
  const riskCheck = await preTradeCheck(optionSymbol, qty, side, estValue);
  if (!riskCheck.pass) { markRejected(orderId, riskCheck.reason); throw new Error(riskCheck.reason); }

  try {
    if (isPaper) {
      const result = await simulateOrderPlacement(orderRecord);
      if (!result.success) throw new Error(result.error);
      return { orderId, brokerOrderId: orderId, status: "FILLED", avgPrice: result.avgPrice, paper: true };
    }
    const response = await placeOrder(activeSession.accessToken, activeSession.appId, orderPayload);
    const brokerOrderId = response.id;
    markSubmitted(orderId, brokerOrderId);
    startOrderPoller(orderId, brokerOrderId);
    return { orderId, brokerOrderId, status: "SUBMITTED", paper: false };
  } catch (err) {
    markRejected(orderId, err.message);
    throw err;
  }
}

export async function submitExit(position, reason = "SIGNAL") {
  if (!activeSession) throw new Error("No active broker session");
  const isPaper = paperTrading;
  const orderId = `ord-exit-${crypto.randomUUID()}`;
  const side = position.signal.type === "LONG" ? -1 : 1;

  createOrder({
    orderId, symbol: position.optionSymbol, qty: position.quantity, side,
    type: 2, productType: "INTRADAY", paper: isPaper,
    parentOrderId: position.orderId, notes: `Exit: ${reason}`,
  });

  try {
    if (isPaper) {
      const result = await simulateMarketExit(position);
      if (!result) throw new Error("No market data for paper exit");
      recordFill(orderId, position.quantity, result.exitPrice);
      return { orderId, status: "FILLED", exitPrice: result.exitPrice, pnl: result.pnl, brokerage: result.brokerage, paper: true };
    }
    const orderPayload = buildRegularOrder({ symbol: position.optionSymbol, qty: position.quantity, side, type: 2 });
    const response = await placeOrder(activeSession.accessToken, activeSession.appId, orderPayload);
    markSubmitted(orderId, response.id);
    return { orderId, brokerOrderId: response.id, status: "SUBMITTED", paper: false };
  } catch (err) {
    markRejected(orderId, err.message);
    throw err;
  }
}

export async function submitEntry(signal, optionSymbol, qty, strategyId = 'EMA5') {
  if (!activeSession) throw new Error('No active broker session');
  const orderId = 'ord-' + crypto.randomUUID();
  const isPaper = paperTrading;
  const side = signal.type === 'LONG' ? 1 : -1;
  const riskPoints = Math.abs(signal.entryPrice - signal.stopLoss);
  const stopLoss = Math.round(riskPoints * 100) / 100;
  const takeProfit = Math.round(riskPoints * 2 * 100) / 100;
  let orderPayload, orderType;
  if (isPaper) { orderPayload = buildRegularOrder({ symbol: optionSymbol, qty, side, type: 2 }); orderType = 'MARKET'; }
  else { orderPayload = buildBracketOrder({ symbol: optionSymbol, qty, side, type: 1, limitPrice: signal.entryPrice, stopLoss, takeProfit }); orderType = 'BRACKET'; }
  createOrder({ orderId, symbol: optionSymbol, qty, side, type: isPaper ? 2 : 1, productType: isPaper ? 'INTRADAY' : 'BO', limitPrice: signal.entryPrice, stopLoss, takeProfit, paper: isPaper, strategyId, signalId: signal.underlying + '-' + signal.timestamp + '-' + signal.type, notes: orderType + ' ' + signal.type + ' entry' });
  const estValue = signal.entryPrice * qty;
  const riskCheck = await preTradeCheck(optionSymbol, qty, side, estValue);
  if (!riskCheck.pass) { markRejected(orderId, riskCheck.reason); throw new Error(riskCheck.reason); }
  try {
    if (isPaper) { const result = await simulateOrderPlacement(getOrder(orderId)); if (!result.success) throw new Error(result.error); return { orderId, brokerOrderId: orderId, status: 'FILLED', avgPrice: result.avgPrice, paper: true }; }
    const response = await placeOrder(activeSession.accessToken, activeSession.appId, orderPayload);
    markSubmitted(orderId, response.id);
    startOrderPoller(orderId, response.id);
    return { orderId, brokerOrderId: response.id, status: 'SUBMITTED', paper: false };
  } catch (err) { markRejected(orderId, err.message); throw err; }
}


export async function submitExit(position, reason = 'SIGNAL') {
  if (!activeSession) throw new Error('No active broker session');
  const isPaper = paperTrading;
  const orderId = 'ord-exit-' + crypto.randomUUID();
  const side = position.signal.type === 'LONG' ? -1 : 1;
  createOrder({ orderId, symbol: position.optionSymbol, qty: position.quantity, side, type: 2, productType: 'INTRADAY', paper: isPaper, parentOrderId: position.orderId, notes: 'Exit: ' + reason });
  try {
    if (isPaper) { const result = await simulateMarketExit(position); if (!result) throw new Error('No market data'); recordFill(orderId, position.quantity, result.exitPrice); return { orderId, status: 'FILLED', exitPrice: result.exitPrice, pnl: result.pnl, paper: true }; }
    const response = await placeOrder(activeSession.accessToken, activeSession.appId, buildRegularOrder({ symbol: position.optionSymbol, qty: position.quantity, side, type: 2 }));
    markSubmitted(orderId, response.id); return { orderId, brokerOrderId: response.id, status: 'SUBMITTED', paper: false };
  } catch (err) { markRejected(orderId, err.message); throw err; }
}

export async function cancelAllOpenOrders() {
  if (!activeSession) return { cancelled: 0 };
  const open = getOpenOrders().filter(o => !o.paper);
  let cancelled = 0;
  for (const order of open) {
    try { if (order.brokerOrderId) { await cancelOrder(activeSession.accessToken, activeSession.appId, order.brokerOrderId); markCancelled(order.orderId, 'Emergency stop'); cancelled++; } }
    catch (err) { console.error('[EXECUTION] Cancel failed:', err.message); }
  }
  return { cancelled };
}


function startOrderPoller(orderId, brokerOrderId) {
  if (orderPollers.has(orderId)) return;
  let attempts = 0;
  const poll = async () => {
    if (!activeSession) return; attempts++;
    try {
      const data = await getOrderById(activeSession.accessToken, activeSession.appId, brokerOrderId);
      const d = data.data; if (!d) return;
      const status = normalizeOrderStatus(d.status);
      const filledQty = d.filledQty || 0;
      const avgPrice = d.tradedPrice || 0;
      if (status === 'FILLED') { recordFill(orderId, filledQty, avgPrice); clearInterval(orderPollers.get(orderId)); orderPollers.delete(orderId); console.log('[EXECUTION] Order ' + orderId + ' FILLED @ ' + avgPrice); return; }
      if (status === 'REJECTED') { markRejected(orderId, d.message || 'Broker rejected'); clearInterval(orderPollers.get(orderId)); orderPollers.delete(orderId); return; }
      if (status === 'CANCELLED') { markCancelled(orderId, 'Broker cancelled'); clearInterval(orderPollers.get(orderId)); orderPollers.delete(orderId); return; }
      if (attempts >= 60) { markCancelled(orderId, 'Poll timeout'); clearInterval(orderPollers.get(orderId)); orderPollers.delete(orderId); return; }
    } catch (err) { console.error('[EXECUTION] Poll error:', err.message); }
  };
  const timer = setInterval(poll, 3000);
  orderPollers.set(orderId, timer);
}

export function startReconciliation() {
  if (reconcileInterval) return;
  reconcileInterval = setInterval(async () => {
    if (!activeSession) return;
    try { const open = getOpenOrders().filter(o => !o.paper); for (const order of open) { await reconcileOrderWithBroker(order.orderId, activeSession.accessToken, activeSession.appId); } }
    catch (err) { console.error('[EXECUTION] Reconcile error:', err.message); }
  }, 10000);
}

export function stopReconciliation() { if (reconcileInterval) { clearInterval(reconcileInterval); reconcileInterval = null; } }

export function stopAllPollers() { for (const [id, timer] of orderPollers.entries()) { clearInterval(timer); } orderPollers.clear(); }

