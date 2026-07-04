import { describe, it, expect } from "vitest";
import { buildFuturesSymbol, sanitizeConfigUpdates } from "./autoTrader.js";

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

describe("EMA5T in the strategy allowlist", () => {
  it("accepts EMA5T via /config and still rejects unknown ids", () => {
    expect(sanitizeConfigUpdates({ selectedStrategies: ["EMA5", "EMA5T"] }).clean.selectedStrategies).toEqual(["EMA5", "EMA5T"]);
    expect(sanitizeConfigUpdates({ selectedStrategies: ["EMA9"] }).clean.selectedStrategies).toBeUndefined();
  });
});
