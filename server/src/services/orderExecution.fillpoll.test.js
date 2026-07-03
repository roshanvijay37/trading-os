import { describe, it, expect, vi } from "vitest";
import { waitForFill } from "./orderExecution.js";

// waitForFill must NEVER throw on a failed poll: a single transient network error or FYERS
// 429 mid-poll used to abort openPosition (live entry left untracked with no SL) or
// closePosition (double market exit after the SL was already cancelled). It now tolerates
// failed polls until the deadline; callers reconcile the TIMEOUT as usual.
describe("waitForFill (poll error tolerance)", () => {
  const session = {};

  it("survives transient poll errors and returns the eventual terminal state", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) throw new Error("FYERS 429");
      return { orderId: "X1", status: "FILLED", filledQty: 65, pendingQty: 0, avgFillPrice: 101.5 };
    });
    const result = await waitForFill("X1", session, {
      timeoutMs: 2000,
      pollMs: 10,
      fetchDetails: flaky,
    });
    expect(result.status).toBe("FILLED");
    expect(result.filledQty).toBe(65);
    expect(calls).toBe(3);
  });

  it("returns TIMEOUT (not a throw) when every poll fails", async () => {
    const dead = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const result = await waitForFill("X2", session, {
      timeoutMs: 120,
      pollMs: 10,
      fetchDetails: dead,
    });
    expect(result.status).toBe("TIMEOUT");
    expect(result.orderId).toBe("X2");
  });

  it("reports PARTIAL when the last successful poll saw a partial fill and later polls die", async () => {
    let calls = 0;
    const partialThenDead = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { orderId: "X3", status: "PENDING", filledQty: 30, pendingQty: 35, avgFillPrice: 99 };
      throw new Error("down");
    });
    const result = await waitForFill("X3", session, {
      timeoutMs: 120,
      pollMs: 10,
      fetchDetails: partialThenDead,
    });
    expect(result.status).toBe("PARTIAL");
    expect(result.filledQty).toBe(30);
  });

  it("audits the first poll error only (no log spam), then the terminal event", async () => {
    const events = [];
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls <= 3) throw new Error("blip");
      return { orderId: "X4", status: "FILLED", filledQty: 65, pendingQty: 0, avgFillPrice: 100 };
    };
    await waitForFill("X4", {}, { timeoutMs: 2000, pollMs: 10, fetchDetails: flaky, auditLogger: (e) => events.push(e.type) });
    expect(events.filter((t) => t === "FILL_POLL_ERROR")).toHaveLength(1);
    expect(events).toContain("ORDER_FILLED");
  });
});
