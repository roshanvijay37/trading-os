import { describe, it, expect, vi, beforeEach } from "vitest";

// closePosition performs real disk persistence (saveState/logAudit -> fs) and calls the broker
// order-execution layer. Both are mocked here so this test is hermetic — it verifies a pure
// concurrency PROPERTY (the re-entrancy guard), not real I/O.
vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    appendFileSync: vi.fn(),
  },
}));

vi.mock("./orderExecution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // A delayed mock widens the race window two concurrent closePosition calls would otherwise
    // need to hit — the guard itself is timing-independent (it claims the slot synchronously,
    // before any await), but the delay makes the scenario this protects against explicit.
    placeMarketExit: vi.fn(async (args) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { orderId: "PAPER-EXIT-TEST", status: "PLACED", symbol: args.symbol, qty: args.qty, side: args.side, type: 2 };
    }),
  };
});

import { closePosition, setPaperTrading } from "./autoTrader.js";
import { placeMarketExit } from "./orderExecution.js";

// Regression test for the CONCURRENT (not just sequential) duplicate-exit-order race: e.g.
// emergencyStop's un-awaited flattenAllPositions() interleaving with an in-flight
// monitorPositions cycle's own closePosition call on the same position, both reaching
// placeMarketExit before either had set pendingExitOrderId.
describe("closePosition re-entrancy guard", () => {
  beforeEach(() => {
    setPaperTrading(true);
    placeMarketExit.mockClear();
  });

  function makePosition(overrides = {}) {
    return {
      id: "TESTPOS-REENTRANCY-1",
      status: "OPEN",
      side: "SHORT",
      optionSymbol: "NSE:BANKNIFTY26JULFUT",
      quantity: 30,
      entryQty: 30,
      origEntryQty: 30,
      avgFillPrice: 55000,
      currentLTP: 54800,
      target: 54700,
      stopLoss: 55100,
      currentSL: 55100,
      slOrderId: null,
      pendingExitOrderId: null,
      realizedPnl: 0,
      ...overrides,
    };
  }

  it("places exactly one exit order when two concurrent calls race on the same position", async () => {
    const position = makePosition();
    const session = {};

    await Promise.all([
      closePosition(position, session, "STOPLOSS"),
      closePosition(position, session, "STOPLOSS"),
    ]);

    expect(placeMarketExit).toHaveBeenCalledTimes(1);
    expect(position.status).toBe("CLOSED");
  });

  it("a THIRD call after the first has fully finished is a normal no-op (already CLOSED)", async () => {
    const position = makePosition();
    const session = {};

    await closePosition(position, session, "STOPLOSS");
    expect(placeMarketExit).toHaveBeenCalledTimes(1);

    await closePosition(position, session, "STOPLOSS");
    expect(placeMarketExit).toHaveBeenCalledTimes(1); // still 1 — status is now CLOSED, guarded by the pre-existing status check
  });

  it("does not permanently wedge a position if closePositionInner throws before completing", async () => {
    placeMarketExit.mockRejectedValueOnce(new Error("simulated broker failure"));
    const position = makePosition();
    const session = {};

    await expect(closePosition(position, session, "STOPLOSS")).rejects.toThrow("simulated broker failure");
    expect(position.status).toBe("OPEN"); // never got as far as finalizeClose

    // The guard's finally-block must have cleared position.id from closingPositionIds even
    // though the attempt threw — otherwise this retry would be silently swallowed forever.
    await closePosition(position, session, "STOPLOSS");
    expect(placeMarketExit).toHaveBeenCalledTimes(2);
    expect(position.status).toBe("CLOSED");
  });
});
