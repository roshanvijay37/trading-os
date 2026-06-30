import { describe, it, expect } from "vitest";
import { classifyExit, dropInProgressCandle, planSlSettlement } from "./autoTrader.js";

// classifyExit is the pure decision behind C2: a partial or unfilled market exit must NOT mark the
// position CLOSED and orphan the unsold remainder (which would sit at the broker with no stop-loss).
// It tells closePosition whether to fully close, or keep the position OPEN with `remainder` and retry.
describe("classifyExit (C2 partial-exit safety)", () => {
  it("paper mode always fully closes the entry qty", () => {
    expect(classifyExit({ paper: true, entryQty: 75, fillQty: 0 })).toEqual({ action: "full", exitQty: 75, remainder: 0 });
  });

  it("a full fill closes completely", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: 75 })).toEqual({ action: "full", exitQty: 75, remainder: 0 });
  });

  it("an over-fill never reports more than the entry qty", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: 90 })).toEqual({ action: "full", exitQty: 75, remainder: 0 });
  });

  it("a partial fill keeps the position open with the remainder", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: 45 })).toEqual({ action: "partial", exitQty: 45, remainder: 30 });
  });

  it("a zero fill is 'unfilled' and keeps the whole position open", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: 0 })).toEqual({ action: "unfilled", exitQty: 0, remainder: 75 });
  });

  it("a missing/garbage fill qty is treated as unfilled (never a false full close)", () => {
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: undefined })).toEqual({ action: "unfilled", exitQty: 0, remainder: 75 });
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: NaN })).toEqual({ action: "unfilled", exitQty: 0, remainder: 75 });
    expect(classifyExit({ paper: false, entryQty: 75, fillQty: -10 })).toEqual({ action: "unfilled", exitQty: 0, remainder: 75 });
  });
});

// dropInProgressCandle (C6): signals must run on COMPLETED candles only, or the trailing forming
// bar's OHLC/EMA shift intra-period and the alert/breakout flip within a bar (and diverge from the
// backtest). Row = [periodStartSec, o, h, l, c, v]; nowSec is injected for deterministic tests.
describe("dropInProgressCandle (C6 completed-candle signals)", () => {
  const bar = (startSec) => [startSec, 100, 101, 99, 100, 0];

  it("drops a trailing 5m candle whose period has not elapsed", () => {
    const candles = [bar(0), bar(300), bar(600)];
    const out = dropInProgressCandle(candles, 5, 700); // 600-bar only 100s into its 300s period
    expect(out).toHaveLength(2);
    expect(out[out.length - 1][0]).toBe(300);
  });

  it("keeps the trailing candle once its period has fully elapsed", () => {
    const candles = [bar(0), bar(300), bar(600)];
    expect(dropInProgressCandle(candles, 5, 900)).toHaveLength(3); // 600+300 = complete
  });

  it("respects the timeframe (15m = 900s period)", () => {
    const candles = [bar(0), bar(900)];
    expect(dropInProgressCandle(candles, 15, 900 + 100)).toHaveLength(1); // still forming
    expect(dropInProgressCandle(candles, 15, 900 + 900)).toHaveLength(2); // complete
  });

  it("handles empty / non-array inputs safely", () => {
    expect(dropInProgressCandle([], 5, 100)).toEqual([]);
    expect(dropInProgressCandle(undefined, 5, 100)).toEqual([]);
  });
});

// planSlSettlement (C1 oversell-prevention): account for what the broker stop-loss has ALREADY sold
// before placing a market exit, so closePosition never sells more than is actually held (a partial
// broker-SL fill reports status PENDING with filledQty>0 — FYERS has no PARTIAL status).
describe("planSlSettlement (C1 no-oversell)", () => {
  it("a fully-FILLED broker SL closes the whole position with no market exit", () => {
    expect(planSlSettlement({ status: "FILLED", slFilled: 150, heldQty: 150 }))
      .toEqual({ fullSlClose: true, slLegQty: 150, marketExitQty: 0 });
  });

  it("a PARTIAL broker-SL fill (PENDING, filledQty>0) only market-exits the unsold remainder", () => {
    expect(planSlSettlement({ status: "PENDING", slFilled: 75, heldQty: 150 }))
      .toEqual({ fullSlClose: false, slLegQty: 75, marketExitQty: 75 });
  });

  it("no SL fill yet → market-exit the full held qty", () => {
    expect(planSlSettlement({ status: "PENDING", slFilled: 0, heldQty: 150 }))
      .toEqual({ fullSlClose: false, slLegQty: 0, marketExitQty: 150 });
  });

  it("filledQty covering the whole held qty is a full close even if status lags", () => {
    expect(planSlSettlement({ status: "PENDING", slFilled: 150, heldQty: 150 }).fullSlClose).toBe(true);
    // and an over-reported fill never produces a negative market exit
    expect(planSlSettlement({ status: "PENDING", slFilled: 200, heldQty: 150 }))
      .toEqual({ fullSlClose: true, slLegQty: 150, marketExitQty: 0 });
  });

  it("unknown status with no fill → market-exit everything (safe default under an API read failure)", () => {
    expect(planSlSettlement({ status: undefined, slFilled: undefined, heldQty: 150 }))
      .toEqual({ fullSlClose: false, slLegQty: 0, marketExitQty: 150 });
  });
});
