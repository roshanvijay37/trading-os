import { describe, it, expect } from "vitest";
import { toLocalDateKey, formatDate } from "./date";

describe("toLocalDateKey", () => {
  it("returns a zero-padded YYYY-MM-DD key from local date parts", () => {
    // Local-time constructor: 2026, month index 5 = June, day 28.
    expect(toLocalDateKey(new Date(2026, 5, 28))).toBe("2026-06-28");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toLocalDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("formatDate", () => {
  it("renders a human date for an ISO date key", () => {
    const out = formatDate("2026-06-28");
    expect(out).toMatch(/Jun/);
    expect(out).toMatch(/28/);
    expect(out).toMatch(/2026/);
  });
});
