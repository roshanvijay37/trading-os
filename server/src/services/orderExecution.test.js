import { describe, it, expect } from "vitest";
import {
  placeOrder,
  placeLimitEntry,
  placeMarketExit,
  placeStopLossOrder,
  placeStopEntry,
  cancelOrder,
  extractOrderId,
  isTokenErrorData,
  normalizeStatus,
  ORDER_TYPE,
  ORDER_SIDE,
} from "./orderExecution.js";

const session = {}; // unused on paper/validation paths (no network is hit)

describe("normalizeStatus (FYERS v3 numeric order status)", () => {
  it("maps the verified v3 codes correctly", () => {
    expect(normalizeStatus(1)).toBe("CANCELLED");
    expect(normalizeStatus(2)).toBe("FILLED");
    expect(normalizeStatus(4)).toBe("PENDING"); // Transit — must NOT be terminal
    expect(normalizeStatus(5)).toBe("REJECTED");
    expect(normalizeStatus(6)).toBe("PENDING");
    expect(normalizeStatus(7)).toBe("EXPIRED");
  });
  it("does not misread Transit(4) as a terminal CANCELLED (the dangerous old bug)", () => {
    expect(normalizeStatus(4)).not.toBe("CANCELLED");
  });
  it("handles string statuses and unknowns", () => {
    expect(normalizeStatus("TRADED")).toBe("FILLED");
    expect(normalizeStatus("transit")).toBe("PENDING");
    expect(normalizeStatus(3)).toBe("UNKNOWN");
    expect(normalizeStatus(null)).toBe("UNKNOWN");
  });
});

describe("extractOrderId (tolerates FYERS response shapes)", () => {
  it("reads a top-level id", () => {
    expect(extractOrderId({ s: "ok", id: "808058117761" })).toBe("808058117761");
  });
  it("reads a numeric id as a string", () => {
    expect(extractOrderId({ id: 12345 })).toBe("12345");
  });
  it("falls back to data.id and orderId", () => {
    expect(extractOrderId({ data: { id: "A1" } })).toBe("A1");
    expect(extractOrderId({ orderId: "B2" })).toBe("B2");
  });
  it("reads an orderNumbers array entry", () => {
    expect(extractOrderId({ orderNumbers: [{ id: "C3" }] })).toBe("C3");
  });
  it("returns null when no id is present", () => {
    expect(extractOrderId({ s: "ok", message: "done" })).toBeNull();
    expect(extractOrderId({})).toBeNull();
    expect(extractOrderId(null)).toBeNull();
  });
});

describe("isTokenErrorData (detects expired/invalid token)", () => {
  it("matches token/auth messages", () => {
    expect(isTokenErrorData({ message: "Invalid token" })).toBe(true);
    expect(isTokenErrorData({ message: "Could not authenticate" })).toBe(true);
  });
  it("matches known token error codes", () => {
    expect(isTokenErrorData({ code: -16 })).toBe(true);
    expect(isTokenErrorData({ code: -17 })).toBe(true);
  });
  it("does not match unrelated errors", () => {
    expect(isTokenErrorData({ message: "Insufficient funds", code: -99 })).toBe(false);
    expect(isTokenErrorData(null)).toBe(false);
  });
});

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

  it("placeMarketExit takes an explicit side — SELL closes a LONG, BUY covers a SHORT", async () => {
    const closeLong = await placeMarketExit({ symbol: "NSE:X", qty: 50, side: ORDER_SIDE.SELL, session, paperTrading: true });
    expect(closeLong.side).toBe(ORDER_SIDE.SELL);
    expect(closeLong.type).toBe(ORDER_TYPE.MARKET);

    const closeShort = await placeMarketExit({ symbol: "NSE:X", qty: 50, side: ORDER_SIDE.BUY, session, paperTrading: true });
    expect(closeShort.side).toBe(ORDER_SIDE.BUY);
  });

  it("placeMarketExit rejects a missing side rather than silently defaulting", async () => {
    await expect(
      placeMarketExit({ symbol: "NSE:X", qty: 50, session, paperTrading: true })
    ).rejects.toThrow(/Invalid order side/);
  });

  it("placeStopLossOrder takes an explicit side — SELL protects a LONG, BUY protects a SHORT", async () => {
    const protectLong = await placeStopLossOrder({ symbol: "NSE:X", qty: 50, stopPrice: 8, side: ORDER_SIDE.SELL, session, paperTrading: true });
    expect(protectLong.side).toBe(ORDER_SIDE.SELL);
    expect(protectLong.type).toBe(ORDER_TYPE.STOP);
    expect(protectLong.stopPrice).toBe(8);

    const protectShort = await placeStopLossOrder({ symbol: "NSE:X", qty: 50, stopPrice: 12, side: ORDER_SIDE.BUY, session, paperTrading: true });
    expect(protectShort.side).toBe(ORDER_SIDE.BUY);
  });

  it("placeStopEntry rests a SL-M order sized/sided for the intended breakout direction", async () => {
    const longEntry = await placeStopEntry({ symbol: "NSE:X", qty: 30, side: ORDER_SIDE.BUY, stopPrice: 55100, session, paperTrading: true });
    expect(longEntry.side).toBe(ORDER_SIDE.BUY);
    expect(longEntry.type).toBe(ORDER_TYPE.STOP);
    expect(longEntry.stopPrice).toBe(55100);

    const shortEntry = await placeStopEntry({ symbol: "NSE:X", qty: 30, side: ORDER_SIDE.SELL, stopPrice: 54900, session, paperTrading: true });
    expect(shortEntry.side).toBe(ORDER_SIDE.SELL);
  });

  it("cancelOrder short-circuits for PAPER ids", async () => {
    await expect(cancelOrder("PAPER-123", session)).resolves.toEqual({ success: true });
  });
});
