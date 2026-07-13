import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// manageFuturesPending performs real disk persistence (saveState/logAudit -> fs) and calls the
// broker order-execution layer. Both are mocked here so this test is hermetic — it verifies a
// pure concurrency PROPERTY (the re-entrancy guard), not real I/O.
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
    // A delayed mock widens the race window two concurrent manageFuturesPending calls would
    // otherwise need to hit — the guard itself is timing-independent (it claims the slot
    // synchronously, before any await), but the delay makes the scenario this protects against
    // explicit, mirroring closePosition's reentrancy test.
    placeStopEntry: vi.fn(async (args) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { orderId: `PAPER-ENTRY-${Math.random().toString(36).slice(2, 7)}`, status: "PLACED", symbol: args.symbol, qty: args.qty, side: args.side, type: 3, stopPrice: args.stopPrice, limitPrice: args.limitPrice || 0 };
    }),
  };
});

import { manageFuturesPending, setReconcileOkForTest, setPaperTrading, updateConfig } from "./autoTrader.js";
import { placeStopEntry } from "./orderExecution.js";

// Regression test for the concurrency gap found while scoping a future event-driven arming path:
// manageFuturesPendingInner's dedup (processedSignals, pendingEntries) is only safe under
// SEQUENTIAL invocation — nothing previously claimed a key up front the way closePosition's
// closingPositionIds does, so two genuinely concurrent invocations for the same key could both
// pass the same checks and both call placeStopEntry, doubling exposure on one alert.
describe("manageFuturesPending re-entrancy guard", () => {
  const fakeNowMs = new Date("2026-06-26T04:30:00Z").getTime(); // 10:00 IST — well before the 14:00 cutoff

  beforeEach(() => {
    // Fake ONLY Date (checkTimeFilter/isValidTradingTime read the wall clock) — NOT setTimeout,
    // which the mocked placeStopEntry's own delay above needs to actually fire via real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(fakeNowMs);
    setPaperTrading(true);
    setReconcileOkForTest(true); // real reconciliation calls the broker; this test is hermetic
    // openPositions is shared module state that accumulates across `it()` blocks in this file
    // (each test opens a real, if paper, position) — without this, the correlation filter sees a
    // PRIOR test's still-open position on a different underlying name and blocks a later test's
    // entry, which has nothing to do with what THIS test actually verifies (per-key concurrency).
    updateConfig({ allowCorrelatedTrades: true });
    placeStopEntry.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  // A fresh, deliberately narrow-range 15m candle: safely inside isCandleStale's tolerance for
  // the fake "now" above, and its high/low never cross any of this file's alert levels (100.5,
  // 101.5) — a leftover pending entry from an earlier test in this file (module state persists
  // across `it()` blocks) must stay PENDING here, not get treated as an unrelated fill.
  function freshCandles(tf = 15) {
    const nowSec = Math.floor(fakeNowMs / 1000);
    const candleTs = nowSec - tf * 60;
    return [[candleTs, 100, 100.05, 99.95, 100, 1000]];
  }

  // Alert timestamps must be from TODAY'S (fake) session — the cross-session alert guard
  // (EMA5T_ALERT_PREV_SESSION, the 2026-07-13 phantom-gold fix) refuses any alert candle whose
  // IST date isn't the current one, so a fixed "timestamp: 1" (1970) never arms anything.
  const sameDayAlertTs = (barsAgo = 2, tf = 15) => Math.floor(fakeNowMs / 1000) - barsAgo * tf * 60;

  // marginPerLot deliberately small so the arm gate's committedMargin+marginReq<=CONFIG.CAPITAL
  // check passes regardless of CONFIG.CAPITAL's real value — this test is about the concurrency
  // guard, not re-proving the margin gate (covered elsewhere).
  function makeArgs(overrides = {}) {
    const underlyingName = overrides.underlyingName || "TESTUL-REENTRY";
    return {
      key: `${underlyingName}:EMA5T:15m`,
      underlying: { name: underlyingName, symbol: `NSE:${underlyingName}-INDEX`, lotSize: 30, marginPerLot: 1000 },
      tf: 15,
      candles: freshCandles(),
      futSymbol: `NSE:${underlyingName}FUT`,
      alert: { type: "BULLISH_ALERT", high: 100.5, low: 99.5, timestamp: sameDayAlertTs(), ...overrides.alert },
      session: {},
    };
  }

  // Each test uses its own underlyingName (hence its own key) — pendingEntries/openPositions are
  // module state that persists across `it()` blocks in this file, so reusing a key across tests
  // would mean a later test's "fresh" alert collides with an earlier test's leftover pending
  // entry, rather than actually testing what that test claims to.
  it("places exactly one entry order when two concurrent calls race on the same key", async () => {
    const args = makeArgs({ underlyingName: "TESTUL-RACE" });
    await Promise.all([manageFuturesPending(args), manageFuturesPending(args)]);
    expect(placeStopEntry).toHaveBeenCalledTimes(1);
  });

  it("a later call for the same key, once the first has fully resolved, runs independently rather than being wedged", async () => {
    const args = makeArgs({ underlyingName: "TESTUL-RELEASE" });
    await manageFuturesPending(args);
    expect(placeStopEntry).toHaveBeenCalledTimes(1);

    // A genuinely NEW alert (different level, different same-day bar) on the same key
    // legitimately re-arms — proves the guard released after the first call rather than
    // permanently blocking this key.
    const secondArgs = makeArgs({ underlyingName: "TESTUL-RELEASE", alert: { high: 101.5, low: 100.5, timestamp: sameDayAlertTs(1) } });
    await manageFuturesPending(secondArgs);
    expect(placeStopEntry).toHaveBeenCalledTimes(2);
  });

  it("ARMS an alert carried over from a previous session when today's data is fresh (engine parity)", async () => {
    // Friday-bar-on-Monday shape: the alert candle is from the previous session, the LATEST
    // candle is fresh (today). The validated engine carries alerts across the day boundary and
    // fills them at today's prices (2026-07-13: the gold shorts filled at Monday's real 143,334
    // open) — a first-cut guard that gated by ALERT age blocked these and was a live≠backtest
    // regression. Only acting on stale DATA is refused (next test).
    const args = makeArgs({ underlyingName: "TESTUL-CARRYOVER", alert: { timestamp: sameDayAlertTs() - 24 * 3600 } });
    await manageFuturesPending(args);
    expect(placeStopEntry).toHaveBeenCalledTimes(1);
  });

  it("refuses to act when the LATEST candle itself is from a previous session (stale feed)", async () => {
    // The genuine failure mode: history hasn't caught up to today, so every price in hand is
    // another session's. Both isCandleStale and the istDateKey(latest) gate refuse this cycle.
    const staleBarTs = Math.floor(fakeNowMs / 1000) - 24 * 3600;
    const args = makeArgs({ underlyingName: "TESTUL-STALEFEED" });
    args.candles = [[staleBarTs, 100, 100.05, 99.95, 100, 1000]];
    await manageFuturesPending(args);
    expect(placeStopEntry).toHaveBeenCalledTimes(0);
  });

  it("two concurrent calls for DIFFERENT keys are not blocked by each other (the guard is per-key)", async () => {
    const argsA = makeArgs({ underlyingName: "TESTUL-A" });
    const argsB = makeArgs({ underlyingName: "TESTUL-B" });

    await Promise.all([manageFuturesPending(argsA), manageFuturesPending(argsB)]);
    expect(placeStopEntry).toHaveBeenCalledTimes(2);
  });
});
