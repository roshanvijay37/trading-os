import { describe, it, expect } from "vitest";
import { buildFuturesSymbol, futuresOrderSide, sanitizeConfigUpdates } from "./autoTrader.js";
import { ORDER_SIDE } from "./orderExecution.js";

describe("buildFuturesSymbol (EMA5T futures contract naming)", () => {
  it("builds FYERS-format monthly futures symbols", () => {
    expect(buildFuturesSymbol("BANKNIFTY", 2026, 6)).toBe("NSE:BANKNIFTY26JULFUT");
    expect(buildFuturesSymbol("NIFTY", 2026, 11)).toBe("NSE:NIFTY26DECFUT");
    expect(buildFuturesSymbol("BANKNIFTY", 2027, 0)).toBe("NSE:BANKNIFTY27JANFUT");
  });

  it("pads single-digit years", () => {
    expect(buildFuturesSymbol("NIFTY", 2109, 3)).toBe("NSE:NIFTY09APRFUT");
  });
});

// The direct regression test for the SHORT-close bug: closePosition/ensureStopLoss used to call
// placeMarketExit/placeStopLossOrder with a hardcoded SELL side, which is backwards for covering
// or protecting a SHORT futures position (EMA5T trades both directions).
describe("futuresOrderSide (EMA5T LONG/SHORT order-side mapping)", () => {
  it("maps the full LONG/SHORT x ENTRY/EXIT matrix correctly", () => {
    expect(futuresOrderSide("LONG", "ENTRY")).toBe(ORDER_SIDE.BUY);
    expect(futuresOrderSide("LONG", "EXIT")).toBe(ORDER_SIDE.SELL);
    expect(futuresOrderSide("SHORT", "ENTRY")).toBe(ORDER_SIDE.SELL);
    expect(futuresOrderSide("SHORT", "EXIT")).toBe(ORDER_SIDE.BUY);
  });

  it("throws on an unknown direction rather than silently picking a side", () => {
    expect(() => futuresOrderSide("SIDEWAYS", "EXIT")).toThrow(/unknown direction/);
    expect(() => futuresOrderSide(undefined, "ENTRY")).toThrow(/unknown direction/);
  });
});

describe("EMA5T is the only allowed strategy", () => {
  it("accepts EMA5T and filters out everything else (legacy ids included)", () => {
    expect(sanitizeConfigUpdates({ selectedStrategies: ["EMA5T"] }).clean.selectedStrategies).toEqual(["EMA5T"]);
    expect(sanitizeConfigUpdates({ selectedStrategies: ["EMA5", "EMA5T"] }).clean.selectedStrategies).toEqual(["EMA5T"]);
    expect(sanitizeConfigUpdates({ selectedStrategies: ["EMA5", "EMA5_OPTION"] }).clean.selectedStrategies).toBeUndefined();
    expect(sanitizeConfigUpdates({ selectedStrategies: ["EMA9"] }).clean.selectedStrategies).toBeUndefined();
  });
});
