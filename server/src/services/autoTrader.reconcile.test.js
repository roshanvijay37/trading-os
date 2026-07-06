import { describe, it, expect } from "vitest";
import { planReconciliation } from "./autoTrader.js";

// planReconciliation is the pure decision step of startup broker reconciliation: given local
// OPEN positions and the broker's netPositions, decide which are still held vs. went flat while
// the bot was down. The dangerous case is a local OPEN that the broker no longer holds — it must
// land in toClose so monitorPositions can never fire a naked SELL on a phantom.
const local = (sym, qty = 75, extra = {}) => ({ optionSymbol: sym, quantity: qty, status: "OPEN", ...extra });

describe("planReconciliation", () => {
  it("keeps a position the broker still holds, surfacing the broker qty", () => {
    const open = [local("NSE:NIFTY24JUN24000CE", 75)];
    const net = [{ symbol: "NSE:NIFTY24JUN24000CE", netQty: 75, netAvg: 120 }];
    const { toClose, toKeep } = planReconciliation(open, net);
    expect(toClose).toHaveLength(0);
    expect(toKeep).toHaveLength(1);
    expect(toKeep[0].brokerQty).toBe(75);
  });

  it("closes a position the broker is flat on (netQty 0), taking broker realized P&L", () => {
    const open = [local("NSE:NIFTY24JUN24000CE", 75)];
    const net = [{ symbol: "NSE:NIFTY24JUN24000CE", netQty: 0, realized_profit: -450 }];
    const { toClose, toKeep } = planReconciliation(open, net);
    expect(toKeep).toHaveLength(0);
    expect(toClose).toHaveLength(1);
    expect(toClose[0].realized).toBe(-450);
  });

  it("closes a position absent from the broker netPositions entirely", () => {
    const open = [local("NSE:NIFTY24JUN24000CE", 75)];
    const { toClose } = planReconciliation(open, []);
    expect(toClose).toHaveLength(1);
    expect(toClose[0].realized).toBe(0);
  });

  it("flags a qty mismatch by reporting the broker qty for a kept position", () => {
    const open = [local("NSE:NIFTYBANK24JUN52000CE", 75)];
    const net = [{ symbol: "NSE:NIFTYBANK24JUN52000CE", netQty: 30 }];
    const { toKeep } = planReconciliation(open, net);
    expect(toKeep[0].brokerQty).toBe(30);
  });

  it("falls back to pl when realized_profit is absent", () => {
    const open = [local("NSE:NIFTY24JUN24000PE", 75)];
    const net = [{ symbol: "NSE:NIFTY24JUN24000PE", netQty: 0, pl: 300 }];
    const { toClose } = planReconciliation(open, net);
    expect(toClose[0].realized).toBe(300);
  });

  it("handles empty/garbage inputs without throwing", () => {
    expect(planReconciliation([], [])).toEqual({ toClose: [], toKeep: [], unknownBrokerPositions: [] });
    expect(planReconciliation(undefined, undefined)).toEqual({ toClose: [], toKeep: [], unknownBrokerPositions: [] });
  });

  // EMA5T trades futures both LONG and SHORT. A genuinely open SHORT reports a NEGATIVE netQty
  // at the broker — treating that as "flat" (the old options-only-BUYS assumption) would silently
  // lose tracking of a real, still-open position. This is the direct regression test.
  it("keeps a genuinely open SHORT futures position (negative broker netQty), not flat", () => {
    const open = [local("NSE:BANKNIFTY26JULFUT", 30, { side: "SHORT" })];
    const net = [{ symbol: "NSE:BANKNIFTY26JULFUT", netQty: -30 }];
    const { toClose, toKeep } = planReconciliation(open, net);
    expect(toClose).toHaveLength(0);
    expect(toKeep).toHaveLength(1);
    expect(toKeep[0].brokerQty).toBe(30); // reported unsigned, comparable to position.quantity
    expect(toKeep[0].signMismatch).toBe(false);
  });

  it("closes a SHORT position the broker is genuinely flat on (netQty 0)", () => {
    const open = [local("NSE:BANKNIFTY26JULFUT", 30, { side: "SHORT" })];
    const net = [{ symbol: "NSE:BANKNIFTY26JULFUT", netQty: 0, realized_profit: 1200 }];
    const { toClose, toKeep } = planReconciliation(open, net);
    expect(toKeep).toHaveLength(0);
    expect(toClose).toHaveLength(1);
    expect(toClose[0].realized).toBe(1200);
  });

  it("keeps (never closes) a position whose broker qty sign doesn't match its recorded side, flagging the mismatch", () => {
    // Recorded as SHORT locally but the broker reports a positive qty — an anomaly that must
    // never be silently reconciled to CLOSED; it's still a live position needing monitoring.
    const open = [local("NSE:NIFTY26JULFUT", 65, { side: "SHORT" })];
    const net = [{ symbol: "NSE:NIFTY26JULFUT", netQty: 65 }];
    const { toClose, toKeep } = planReconciliation(open, net);
    expect(toClose).toHaveLength(0);
    expect(toKeep).toHaveLength(1);
    expect(toKeep[0].signMismatch).toBe(true);
    expect(toKeep[0].brokerQty).toBe(65);
  });

  it("keeps a LONG futures position normally, with no sign mismatch", () => {
    const open = [local("NSE:NIFTY26JULFUT", 65, { side: "LONG" })];
    const net = [{ symbol: "NSE:NIFTY26JULFUT", netQty: 65 }];
    const { toKeep } = planReconciliation(open, net);
    expect(toKeep[0].signMismatch).toBe(false);
  });

  // Two different timeframes can legitimately hold concurrent OPEN positions on the SAME
  // underlying's futures contract — the broker only reports one NET qty per symbol, with no way to
  // tell which local position owns which share of it. Silently attributing the whole aggregate to
  // BOTH would corrupt whichever one's quantity gets overwritten.
  it("flags (not silently attributes) an ambiguous broker qty when multiple local positions share a symbol", () => {
    const open = [
      local("NSE:BANKNIFTY26JULFUT", 30, { side: "LONG" }),
      local("NSE:BANKNIFTY26JULFUT", 30, { side: "LONG" }),
    ];
    const net = [{ symbol: "NSE:BANKNIFTY26JULFUT", netQty: 60 }];
    const { toClose, toKeep } = planReconciliation(open, net);
    expect(toClose).toHaveLength(0);
    expect(toKeep).toHaveLength(2);
    expect(toKeep[0].ambiguousGroup).toBe(true);
    expect(toKeep[1].ambiguousGroup).toBe(true);
  });

  it("does not flag ambiguousGroup for a single position per symbol", () => {
    const open = [local("NSE:NIFTY26JULFUT", 65, { side: "LONG" })];
    const net = [{ symbol: "NSE:NIFTY26JULFUT", netQty: 65 }];
    const { toKeep } = planReconciliation(open, net);
    expect(toKeep[0].ambiguousGroup).toBe(false);
  });

  it("splits realized P&L evenly across multiple local positions flat at the broker on the same symbol", () => {
    const open = [
      local("NSE:BANKNIFTY26JULFUT", 30, { side: "LONG" }),
      local("NSE:BANKNIFTY26JULFUT", 30, { side: "LONG" }),
    ];
    const net = [{ symbol: "NSE:BANKNIFTY26JULFUT", netQty: 0, realized_profit: 1000 }];
    const { toClose } = planReconciliation(open, net);
    expect(toClose).toHaveLength(2);
    expect(toClose[0].realized).toBe(500);
    expect(toClose[1].realized).toBe(500);
  });

  // Reconciliation previously only ever checked LOCAL positions against the broker — a real broker
  // position with NO local record at all (e.g. a crash between a confirmed fill and the following
  // saveState()) would never surface. This is the direct regression test for that gap.
  describe("unknownBrokerPositions (broker position with no local record)", () => {
    it("flags a broker symbol with a nonzero net qty that has no local position at all", () => {
      const open = [local("NSE:BANKNIFTY26JULFUT", 30, { side: "LONG" })];
      const net = [
        { symbol: "NSE:BANKNIFTY26JULFUT", netQty: 30 },
        { symbol: "NSE:NIFTY26JULFUT", netQty: -65 }, // untracked SHORT, no local record
      ];
      const { unknownBrokerPositions } = planReconciliation(open, net);
      expect(unknownBrokerPositions).toEqual([{ symbol: "NSE:NIFTY26JULFUT", brokerQty: -65 }]);
    });

    it("does not flag a broker symbol that is flat (netQty 0) with no local record", () => {
      const open = [];
      const net = [{ symbol: "NSE:NIFTY26JULFUT", netQty: 0 }];
      const { unknownBrokerPositions, toClose } = planReconciliation(open, net);
      expect(unknownBrokerPositions).toEqual([]);
      expect(toClose).toHaveLength(0);
    });

    it("does not flag a broker symbol that has a local record, even an ambiguous/mismatched one", () => {
      const open = [local("NSE:BANKNIFTY26JULFUT", 30, { side: "SHORT" })]; // will sign-mismatch
      const net = [{ symbol: "NSE:BANKNIFTY26JULFUT", netQty: 30 }];
      const { unknownBrokerPositions } = planReconciliation(open, net);
      expect(unknownBrokerPositions).toEqual([]);
    });
  });
});
