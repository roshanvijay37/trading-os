import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToasts, subscribeToasts, toast } from "./toast";

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.dismissAll();
  });

  afterEach(() => {
    toast.dismissAll();
    vi.useRealTimers();
  });

  it("enqueues with kind and default durations (error 8s, others 4s)", () => {
    toast.success("saved");
    toast.error("boom");
    const items = getToasts();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "success", message: "saved", duration: 4000 });
    expect(items[1]).toMatchObject({ kind: "error", message: "boom", duration: 8000 });
  });

  it("replaces instead of stacking when the same id is pushed twice", () => {
    toast.error("attempt 1", { id: "fyers-login" });
    toast.error("attempt 2", { id: "fyers-login" });
    const items = getToasts();
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe("attempt 2");
  });

  it("re-pushing an id resets the auto-dismiss timer", () => {
    toast.info("first", { id: "x" });
    vi.advanceTimersByTime(3000);
    toast.info("again", { id: "x" });
    vi.advanceTimersByTime(3000); // 6s since first push, 3s since replace
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1100);
    expect(getToasts()).toHaveLength(0);
  });

  it("auto-dismisses after its duration", () => {
    toast.success("bye", { duration: 1000 });
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1100);
    expect(getToasts()).toHaveLength(0);
  });

  it("keeps a duration:0 toast until explicitly dismissed", () => {
    const id = toast.warn("sticky", { duration: 0 });
    vi.advanceTimersByTime(60000);
    expect(getToasts()).toHaveLength(1);
    toast.dismiss(id);
    expect(getToasts()).toHaveLength(0);
  });

  it("caps the stack at 4, dropping the oldest", () => {
    for (let i = 1; i <= 5; i++) toast.info(`t${i}`);
    const items = getToasts();
    expect(items).toHaveLength(4);
    expect(items.map((t) => t.message)).toEqual(["t2", "t3", "t4", "t5"]);
  });

  it("notifies subscribers on push and dismiss", () => {
    const seen: number[] = [];
    const unsub = subscribeToasts(() => seen.push(getToasts().length));
    const id = toast.success("hello");
    toast.dismiss(id);
    unsub();
    toast.success("after unsub");
    expect(seen).toEqual([1, 0]);
  });

  it("dismissAll clears every toast and its timers", () => {
    toast.success("a");
    toast.error("b");
    toast.dismissAll();
    expect(getToasts()).toHaveLength(0);
    // No stray timer should throw or re-add anything.
    vi.advanceTimersByTime(10000);
    expect(getToasts()).toHaveLength(0);
  });
});
