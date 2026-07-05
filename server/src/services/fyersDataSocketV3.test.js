import { describe, it, expect, beforeEach } from "vitest";
import { normalizeSdkTick, sdkSubscribe, sdkUnsubscribe, getLiveSymbols } from "./fyersDataSocketV3.js";

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

// liveSymbols is the mutable "what should be subscribed" set the 'connect' handler resubscribes
// from on any reconnect (including one the SDK triggers internally via autoreconnect, independent
// of anything tickService does) — this is what fixes the bug where a reconnect silently dropped
// any symbol subscribed after startup. `skt` is null outside a real SDK connection, so these
// tests only exercise the liveSymbols bookkeeping (guarded safely by sdkSubscribe/sdkUnsubscribe's
// own `if (skt && ...)` checks), not an actual socket call.
describe("sdkSubscribe/sdkUnsubscribe — liveSymbols bookkeeping", () => {
  beforeEach(() => {
    sdkUnsubscribe(getLiveSymbols()); // reset to empty before each test
  });

  it("adds symbols to the live set", () => {
    sdkSubscribe(["NSE:BANKNIFTY26JULFUT"]);
    expect(getLiveSymbols()).toEqual(["NSE:BANKNIFTY26JULFUT"]);
  });

  it("does not add a duplicate if already present", () => {
    sdkSubscribe(["NSE:BANKNIFTY26JULFUT"]);
    sdkSubscribe(["NSE:BANKNIFTY26JULFUT"]);
    expect(getLiveSymbols()).toEqual(["NSE:BANKNIFTY26JULFUT"]);
  });

  it("removes only the unsubscribed symbol, keeping siblings", () => {
    sdkSubscribe(["NSE:BANKNIFTY26JULFUT", "NSE:NIFTY26JULFUT"]);
    sdkUnsubscribe(["NSE:BANKNIFTY26JULFUT"]);
    expect(getLiveSymbols()).toEqual(["NSE:NIFTY26JULFUT"]);
  });

  it("is a no-op unsubscribing a symbol that was never subscribed", () => {
    sdkSubscribe(["A"]);
    sdkUnsubscribe(["B"]);
    expect(getLiveSymbols()).toEqual(["A"]);
  });
});
