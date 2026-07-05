import { describe, it, expect } from "vitest";
import { subscribeToSymbols, unsubscribeFromSymbols, getWsStatus } from "./tickService.js";

// Reference-counted subscribe/unsubscribe: closing one EMA5T position must not kill live ticks
// for a SIBLING position still open on the same symbol (e.g. two different timeframes trading
// the same underlying's futures contract concurrently — an anticipated, real scenario, not an
// edge case). Each test uses its own unique fake symbol so tests don't interfere with each
// other's counts (module-level state is shared across the whole file).
describe("subscribeToSymbols/unsubscribeFromSymbols — reference counting", () => {
  it("a fresh symbol appears in subscribedSymbols after one subscribe", () => {
    subscribeToSymbols(["FAKE:SYM_A"]);
    expect(getWsStatus().subscribedSymbols).toContain("FAKE:SYM_A");
  });

  it("unsubscribing the only subscriber removes the symbol", () => {
    subscribeToSymbols(["FAKE:SYM_B"]);
    unsubscribeFromSymbols(["FAKE:SYM_B"]);
    expect(getWsStatus().subscribedSymbols).not.toContain("FAKE:SYM_B");
  });

  it("two subscribers on the same symbol — one unsubscribe does NOT tear it down", () => {
    subscribeToSymbols(["FAKE:SYM_C"]); // position 1 opens
    subscribeToSymbols(["FAKE:SYM_C"]); // position 2 opens (same symbol, different timeframe)
    unsubscribeFromSymbols(["FAKE:SYM_C"]); // position 1 closes
    expect(getWsStatus().subscribedSymbols).toContain("FAKE:SYM_C"); // position 2 still needs it
  });

  it("only tears down after the LAST subscriber unsubscribes", () => {
    subscribeToSymbols(["FAKE:SYM_D"]);
    subscribeToSymbols(["FAKE:SYM_D"]);
    unsubscribeFromSymbols(["FAKE:SYM_D"]);
    expect(getWsStatus().subscribedSymbols).toContain("FAKE:SYM_D"); // 1 subscriber left
    unsubscribeFromSymbols(["FAKE:SYM_D"]);
    expect(getWsStatus().subscribedSymbols).not.toContain("FAKE:SYM_D"); // 0 left — torn down
  });

  it("also reclaims the tick buffer once fully unsubscribed", () => {
    subscribeToSymbols(["FAKE:SYM_E"]);
    expect(getWsStatus().tickCounts).toHaveProperty("FAKE:SYM_E");
    unsubscribeFromSymbols(["FAKE:SYM_E"]);
    expect(getWsStatus().tickCounts).not.toHaveProperty("FAKE:SYM_E");
  });

  it("permanent index symbols (NIFTY/BANKNIFTY) are never removed regardless of unsubscribe calls", () => {
    unsubscribeFromSymbols(["NSE:NIFTY50-INDEX", "NSE:NIFTYBANK-INDEX"]);
    expect(getWsStatus().subscribedSymbols).toContain("NSE:NIFTY50-INDEX");
    expect(getWsStatus().subscribedSymbols).toContain("NSE:NIFTYBANK-INDEX");
  });

  it("unsubscribing a symbol with an unbalanced extra call never goes negative / stays torn down", () => {
    subscribeToSymbols(["FAKE:SYM_F"]);
    unsubscribeFromSymbols(["FAKE:SYM_F"]);
    unsubscribeFromSymbols(["FAKE:SYM_F"]); // extra unsubscribe — must not throw or corrupt state
    expect(getWsStatus().subscribedSymbols).not.toContain("FAKE:SYM_F");
    subscribeToSymbols(["FAKE:SYM_F"]); // a fresh subscribe afterwards must work normally
    expect(getWsStatus().subscribedSymbols).toContain("FAKE:SYM_F");
  });
});
