import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notify, shouldSend, formatAlert, _resetThrottle } from "./notifier.js";

describe("formatAlert", () => {
  it("defaults an unknown level to INFO and fills defaults", () => {
    const entry = formatAlert({ type: "X" });
    expect(entry.level).toBe("INFO");
    expect(entry.type).toBe("X");
    expect(entry.message).toBe("");
    expect(entry.data).toBeNull();
    expect(entry.timestamp).toBeTruthy();
  });

  it("preserves a valid level and payload", () => {
    const entry = formatAlert({ level: "CRITICAL", type: "SL_FAILURE", message: "boom", data: { id: 1 } });
    expect(entry.level).toBe("CRITICAL");
    expect(entry.message).toBe("boom");
    expect(entry.data).toEqual({ id: 1 });
  });
});

describe("shouldSend (throttle)", () => {
  beforeEach(() => _resetThrottle());

  it("allows the first send, blocks repeats within the window, allows after it", () => {
    expect(shouldSend("WS_DISCONNECT", 1_000, 60_000)).toBe(true);
    expect(shouldSend("WS_DISCONNECT", 30_000, 60_000)).toBe(false); // within window
    expect(shouldSend("WS_DISCONNECT", 61_001, 60_000)).toBe(true); // window elapsed
  });

  it("throttles per key independently", () => {
    expect(shouldSend("A", 0, 1000)).toBe(true);
    expect(shouldSend("B", 0, 1000)).toBe(true);
    expect(shouldSend("A", 500, 1000)).toBe(false);
  });
});

describe("notify", () => {
  beforeEach(() => {
    process.env.ALERT_FILE_LOGGING = "off";
    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.ALERT_MIN_LEVEL;
    _resetThrottle();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("emits an INFO alert to the console and returns the entry", async () => {
    const entry = await notify({ level: "INFO", type: "STARTUP", message: "ready" });
    expect(entry).not.toBeNull();
    expect(entry.level).toBe("INFO");
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it("never throttles CRITICAL alerts", async () => {
    await notify({ level: "CRITICAL", type: "CRASH", message: "1" });
    await notify({ level: "CRITICAL", type: "CRASH", message: "2" });
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("throttles repeated non-critical alerts of the same type", async () => {
    await notify({ level: "WARN", type: "WS_DISCONNECT", message: "drop 1" });
    await notify({ level: "WARN", type: "WS_DISCONNECT", message: "drop 2" });
    expect(console.warn).toHaveBeenCalledTimes(1); // second is throttled within the window
  });

  it("does not throw on a malformed event", async () => {
    await expect(notify()).resolves.toBeDefined();
  });
});
