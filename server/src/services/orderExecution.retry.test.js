import { describe, it, expect, vi } from "vitest";
import { withRetry, isRetryableError } from "./orderExecution.js";

describe("isRetryableError", () => {
  it("treats HTTP 5xx and 429 as retryable", () => {
    const e500 = Object.assign(new Error("boom"), { status: 500 });
    const e502 = Object.assign(new Error("boom"), { status: 502 });
    const e429 = Object.assign(new Error("boom"), { status: 429 });
    expect(isRetryableError(e500)).toBe(true);
    expect(isRetryableError(e502)).toBe(true);
    expect(isRetryableError(e429)).toBe(true);
  });

  it("does not treat 4xx validation/business errors as retryable", () => {
    const e400 = Object.assign(new Error("Invalid order side"), { status: 400 });
    const e403 = Object.assign(new Error("forbidden"), { status: 403 });
    expect(isRetryableError(e400)).toBe(false);
    expect(isRetryableError(e403)).toBe(false);
  });

  it("treats a network-level failure (TypeError, AbortError) as retryable", () => {
    const networkErr = new TypeError("fetch failed");
    const timeoutErr = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(isRetryableError(networkErr)).toBe(true);
    expect(isRetryableError(timeoutErr)).toBe(true);
  });

  it("does not retry a plain error with no status/name signal", () => {
    expect(isRetryableError(new Error("Invalid order qty"))).toBe(false);
  });

  it("handles null/undefined safely", () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result immediately on first success (no retry needed)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient (5xx) failure and succeeds within the attempt cap", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("503"), { status: 503 });
      return "recovered";
    });
    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up and throws once the attempt cap is exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("still down"), { status: 500 }));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 })).rejects.toThrow("still down");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a non-retryable (4xx) error — fails on the first attempt", async () => {
    const fn = vi.fn().mockRejectedValue(Object.assign(new Error("Invalid order qty"), { status: 400 }));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow("Invalid order qty");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("emits a BROKER_CALL_RETRY audit event for each retried attempt", async () => {
    const events = [];
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw Object.assign(new Error("502"), { status: 502 });
      return "ok";
    });
    await withRetry(fn, { attempts: 3, baseDelayMs: 1, auditLogger: (e) => events.push(e) });
    expect(events.filter((e) => e.type === "BROKER_CALL_RETRY")).toHaveLength(1);
  });
});
