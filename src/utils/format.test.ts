import { describe, it, expect } from "vitest";
import { formatCurrency } from "./format";

describe("formatCurrency", () => {
  it("formats INR with grouping and no fraction digits", () => {
    const out = formatCurrency(1000);
    expect(out).toContain("₹"); // ₹
    expect(out).toMatch(/1,000/);
  });

  it("rounds to whole rupees", () => {
    expect(formatCurrency(1234.56)).toMatch(/1,235/);
  });

  it("handles zero and negatives", () => {
    expect(formatCurrency(0)).toContain("₹");
    expect(formatCurrency(-500)).toMatch(/500/);
  });
});
