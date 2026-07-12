import { describe, it, expect } from "vitest";
import { computeEquityIntradayCosts } from "./equityCosts.js";

describe("computeEquityIntradayCosts (NSE cash-equity MIS)", () => {
  it("pins the exact intraday rate constants (STT 0.025% sell, txn 0.00297%/side, stamp 0.003% buy)", () => {
    const entry = 2400, exit = 2430, qty = 80, brokeragePerOrder = 20; // ~ADANIENT scale
    const buyT = entry * qty, sellT = exit * qty;
    const brokerage = brokeragePerOrder * 2;
    const stt = 0.00025 * sellT;
    const exchTxn = 0.0000297 * (buyT + sellT);
    const sebi = 0.000001 * (buyT + sellT);
    const stamp = 0.00003 * buyT;
    const gst = 0.18 * (brokerage + exchTxn + sebi);
    expect(computeEquityIntradayCosts(entry, exit, qty, { brokeragePerOrder })).toBeCloseTo(
      brokerage + stt + exchTxn + sebi + stamp + gst,
      6
    );
  });

  it("charges brokerage + GST even at zero turnover", () => {
    expect(computeEquityIntradayCosts(0, 0, 0)).toBeCloseTo(47.2, 5); // 40 + 18% GST
  });

  it("SHORT swaps leg attribution (entry is the SELL leg → STT reads entry price)", () => {
    const short = computeEquityIntradayCosts(1000, 990, 100, { side: "SHORT" });
    const swapped = computeEquityIntradayCosts(990, 1000, 100); // reversed, default LONG
    expect(short).toBeCloseTo(swapped, 8);
  });

  it("is cheaper than the NSE futures table at equal notional (0.025% vs 0.05% sell-side tax)", async () => {
    const { computeFuturesCosts } = await import("./futuresCosts.js");
    const eq = computeEquityIntradayCosts(1000, 1000, 200);
    const fut = computeFuturesCosts(1000, 1000, 200, { exchange: "NSE" });
    expect(eq).toBeLessThan(fut);
  });
});
