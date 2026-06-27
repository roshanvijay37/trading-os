/**
 * Paper Trading Engine
 * Realistic simulation of order fills with slippage and latency
 */

import { getLatestTick } from "../tickService.js";
import { recordFill, markRejected, updateOrder } from "./OrderManager.js";

const SLIPPAGE_PCT = 0.02;
const BROKERAGE_PER_ORDER = 20;

function getCurrentPrice(symbol) {
  const tick = getLatestTick(symbol.replace("NSE:", "").replace("-INDEX", ""));
  if (tick && tick.ltp) return tick.ltp;
  return null;
}

function randomSlippage(price) {
  const variance = price * (SLIPPAGE_PCT / 100) * (Math.random() * 2 - 1);
  return Math.round((price + variance) * 100) / 100;
}

export async function simulateOrderPlacement(order) {
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));

  const price = getCurrentPrice(order.symbol);
  if (!price) {
    markRejected(order.orderId, "No market data for simulation");
    return { success: false, error: "No market data" };
  }

  let fillPrice;
  if (order.type === 2) {
    fillPrice = randomSlippage(price);
  } else if (order.type === 1) {
    if (order.side === 1 && price <= order.limitPrice) {
      fillPrice = randomSlippage(Math.min(price, order.limitPrice));
    } else if (order.side === -1 && price >= order.limitPrice) {
      fillPrice = randomSlippage(Math.max(price, order.limitPrice));
    } else {
      updateOrder(order.orderId, { status: "OPEN", notes: `Limit pending @ ${order.limitPrice}, market ${price}` });
      return { success: true, pending: true, orderId: order.orderId };
    }
  } else {
    fillPrice = randomSlippage(price);
  }

  recordFill(order.orderId, order.qty, fillPrice);
  return { success: true, filledQty: order.qty, avgPrice: fillPrice, orderId: order.orderId };
}

export async function simulateMarketExit(position) {
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 200));
  const price = getCurrentPrice(position.optionSymbol);
  if (!price) return null;
  const fillPrice = randomSlippage(price);
  const pnl = position.signal.type === "LONG"
    ? (fillPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - fillPrice) * position.quantity;
  return { exitPrice: fillPrice, pnl: Math.round(pnl * 100) / 100, brokerage: BROKERAGE_PER_ORDER };
}
