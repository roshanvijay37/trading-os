import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// manageFuturesPending performs real disk persistence (saveState/logAudit -> fs) and calls the
// broker order-execution layer. Both are mocked here so this test is hermetic, mirroring
// autoTrader.pendingReentrancy.test.js's exact fixture pattern.
vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    appendFileSync: vi.fn(),
  },
}));

vi.mock("./orderExecution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    placeStopEntry: vi.fn(async (args) => ({
      orderId: `PAPER-ENTRY-${Math.random().toString(36).slice(2, 7)}`,
      status: "PLACED",
      symbol: args.symbol,
      qty: args.qty,
      side: args.side,
      type: 3,
      stopPrice: args.stopPrice,
      limitPrice: args.limitPrice || 0,
    })),
  };
});

import { manageFuturesPending, setReconcileOkForTest, setPaperTrading, updateConfig, getAuditLog } from "./autoTrader.js";

// Regression coverage for CONFIG.TARGET_MULTIPLIER: it was declared but never actually read —
// the arm-time nominal target was hardcoded `2 * risk`, and computeGapAdjustedTarget's one call
// site never passed a multiplier through, silently relying on the function's own default of 2.
// This proves a non-default configured value now reaches BOTH the arm-time nominal target and
// the fill-time gap-adjusted target on a real (paper) position — not just the already-tested
// defaults of computeGapAdjustedTarget itself.
describe("CONFIG.TARGET_MULTIPLIER wiring", () => {
  const fakeNowMs = new Date("2026-06-26T04:30:00Z").getTime(); // 10:00 IST — well before the 14:00 cutoff

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fakeNowMs);
    setPaperTrading(true);
    setReconcileOkForTest(true);
    updateConfig({ allowCorrelatedTrades: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    updateConfig({ targetMultiplier: 2 }); // restore the default so it can't leak into other tests
  });

  function candleAt(secBeforeNow, open, high, low, close) {
    const nowSec = Math.floor(fakeNowMs / 1000);
    return [nowSec - secBeforeNow, open, high, low, close, 1000];
  }

  it("a configured targetMultiplier of 3 flows through to both the nominal and gap-adjusted target on a real fill", async () => {
    updateConfig({ targetMultiplier: 3 });
    const underlyingName = "TESTUL-TMULT3";
    const key = `${underlyingName}:EMA5T:15m`;
    const underlying = { name: underlyingName, symbol: `NSE:${underlyingName}-INDEX`, lotSize: 30, marginPerLot: 1000 };
    // Same-day timestamp: the cross-session alert guard (phantom-gold fix) refuses alerts whose
    // candle isn't from today's IST session — a fixed "timestamp: 42" (1970) never arms.
    const alert = { type: "BULLISH_ALERT", high: 100.5, low: 99.5, timestamp: Math.floor(fakeNowMs / 1000) - 2 * 15 * 60 };
    const futSymbol = `NSE:${underlyingName}FUT`;

    // Arm: a candle that does NOT cross the alert level (100.5) yet.
    await manageFuturesPending({
      key,
      underlying,
      tf: 15,
      candles: [candleAt(15 * 60, 100, 100.05, 99.95, 100)],
      futSymbol,
      alert,
      session: {},
    });

    // Fill: a later candle whose HIGH clears the level but whose OPEN does not (no gap-through),
    // so checkEntryOrderFill's paper branch fills at level * (1 + 0.0005) — the fixed stop-fill
    // slippage the 6-year validation charged (see checkEntryOrderFill's own comment).
    await manageFuturesPending({
      key,
      underlying,
      tf: 15,
      candles: [candleAt(0, 100, 100.6, 99.9, 100.3)],
      futSymbol,
      alert,
      session: {},
    });

    const opened = getAuditLog(50).find((e) => e.type === "POSITION_OPENED" && e.optionSymbol === futSymbol);
    expect(opened).toBeTruthy();

    // Nominal (arm-time) target: level + multiplier * (level - stopLoss) = 100.5 + 3*1.0 = 103.5.
    expect(opened.nominalTarget).toBeCloseTo(103.5, 5);

    // Gap-adjusted (fill-time) target, computed off the REAL fill price (level * 1.0005), not the
    // stale nominal level — proves computeGapAdjustedTarget's call site now passes the configured
    // multiplier through instead of silently defaulting to 2.
    const avgFillPrice = 100.5 * 1.0005;
    const expectedAdjustedTarget = avgFillPrice + 3 * (avgFillPrice - 99.5);
    expect(opened.target).toBeCloseTo(expectedAdjustedTarget, 5);

    // Must NOT equal what the old hardcoded default of 2 would have produced — otherwise the
    // config value could be silently ignored and the assertions above would still pass by luck.
    const oldDefaultTarget = avgFillPrice + 2 * (avgFillPrice - 99.5);
    expect(opened.target).not.toBeCloseTo(oldDefaultTarget, 1);
  });
});
