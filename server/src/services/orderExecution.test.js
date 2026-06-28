import { describe, it, expect } from "vitest";
import {
  placeOrder,
  placeLimitEntry,
  placeMarketExit,
  placeStopLossOrder,
  cancelOrder,
  ORDER_TYPE,
  ORDER_SIDE,
} from "./orderExecution.js";

const session = {}; // unused on paper/validation paths (no network is hit)

describe("order constants", () => {
  it("expose the FYERS numeric codes and are frozen", () => {
    expect(ORDER_TYPE).toEqual({ LIMIT: 1, MARKET: 2, STOP: 3, STOPLIMIT: 4 });
    expect(ORDER_SIDE).toEqual({ BUY: 1, SELL: -1 });
    expect(Object.isFrozen(ORDER_TYPE)).toBe(true);
    expect(Object.isFrozen(ORDER_SIDE)).toBe(true);
  });
});

describe("placeOrder validation (fails before any broker call)", () => {
  it("rejects a non-positive or non-integer quantity", async () => {
    await expect(
      placeOrder({ symbol: "NSE:X", qty: 0, side: ORDER_SIDE.BUY, type: ORDER_TYPE.MARKET, session })
    ).rejects.toThrow(/Invalid order qty/);
    await expect(
      placeOrder({ symbol: "NSE:X", qty: 1.5, side: ORDER_SIDE.BUY, type: ORDER_TYPE.MARKET, session })
    ).rejects.toThrow(/Invalid order qty/);
  });

  it("rejects an invalid side", async () => {
    await expect(
      placeOrder({ symbol: "NSE:X", qty: 50, side: 5, type: ORDER_TYPE.MARKET, session })
    ).rejects.toThrow(/Invalid order side/);
  });

  it("rejects an invalid type", async () => {
    await expect(
      placeOrder({ symbol: "NSE:X", qty: 50, side: ORDER_SIDE.BUY, type: 99, session })
    ).rejects.toThrow(/Invalid order type/);
  });

  it("requires a positive limit price for LIMIT orders", async () => {
    await expect(
      placeOrder({ symbol: "NSE:X", qty: 50, side: ORDER_SIDE.BUY, type: ORDER_TYPE.LIMIT, limitPrice: 0, session })
    ).rejects.toThrow(/positive limitPrice/);
  });

  it("requires a positive stop price for STOP orders", async () => {
    await expect(
      placeOrder({ symbol: "NSE:X", qty: 50, side: ORDER_SIDE.SELL, type: ORDER_TYPE.STOP, stopPrice: 0, session })
    ).rejects.toThrow(/positive stopPrice/);
  });
});

describe("paper-trading order helpers (no broker call)", () => {
  it("placeOrder returns a PAPER order id and echoes the price", async () => {
    const order = await placeOrder({
      symbol: "NSE:NIFTY-CE",
      qty: 50,
      side: ORDER_SIDE.BUY,
      type: ORDER_TYPE.LIMIT,
      limitPrice: 10,
      session,
      paperTrading: true,
    });
    expect(order.orderId).toMatch(/^PAPER-/);
    expect(order.status).toBe("PLACED");
    expect(order.limitPrice).toBe(10);
  });

  it("placeLimitEntry buys with a LIMIT order", async () => {
    const order = await placeLimitEntry({ symbol: "NSE:X", qty: 50, limitPrice: 12.5, session, paperTrading: true });
    expect(order.orderId).toMatch(/^PAPER-/);
    expect(order.side).toBe(ORDER_SIDE.BUY);
    expect(order.type).toBe(ORDER_TYPE.LIMIT);
    expect(order.limitPrice).toBe(12.5);
  });

  it("placeMarketExit sells with a MARKET order", async () => {
    const order = await placeMarketExit({ symbol: "NSE:X", qty: 50, session, paperTrading: true });
    expect(order.side).toBe(ORDER_SIDE.SELL);
    expect(order.type).toBe(ORDER_TYPE.MARKET);
  });

  it("placeStopLossOrder sells with an SL-M (STOP) order at the stop price", async () => {
    const order = await placeStopLossOrder({ symbol: "NSE:X", qty: 50, stopPrice: 8, session, paperTrading: true });
    expect(order.side).toBe(ORDER_SIDE.SELL);
    expect(order.type).toBe(ORDER_TYPE.STOP);
    expect(order.stopPrice).toBe(8);
  });

  it("cancelOrder short-circuits for PAPER ids", async () => {
    await expect(cancelOrder("PAPER-123", session)).resolves.toEqual({ success: true });
  });
});
