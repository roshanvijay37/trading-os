import { describe, it, expect } from "vitest";
import { normalizeSdkTick } from "./fyersDataSocketV3.js";

describe("normalizeSdkTick", () => {
  it("maps a full FYERS SDK tick to { symbol, ltp, vol }", () => {
    expect(
      normalizeSdkTick({ symbol: "NSE:NIFTY50-INDEX", ltp: 19500.5, vol_traded_today: 1234, type: "sf" })
    ).toEqual({ symbol: "NSE:NIFTY50-INDEX", ltp: 19500.5, vol: 1234 });
  });

  it("supports lite mode (ltp + symbol only)", () => {
    expect(normalizeSdkTick({ symbol: "NSE:NIFTYBANK-INDEX", ltp: 44000 })).toEqual({
      symbol: "NSE:NIFTYBANK-INDEX",
      ltp: 44000,
      vol: 0,
    });
  });

  it("supports alternate field names (symbolName/lp/volume)", () => {
    expect(normalizeSdkTick({ symbolName: "X", lp: 10, volume: 5 })).toEqual({ symbol: "X", ltp: 10, vol: 5 });
  });

  it("ignores status/ack frames (s:'ok' with no symbol)", () => {
    expect(normalizeSdkTick({ s: "ok", code: 200, message: "connected" })).toBeNull();
  });

  it("returns null for malformed input or a missing symbol", () => {
    expect(normalizeSdkTick(null)).toBeNull();
    expect(normalizeSdkTick("nope")).toBeNull();
    expect(normalizeSdkTick({ ltp: 10 })).toBeNull();
  });
});
