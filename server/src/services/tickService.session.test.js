import { describe, it, expect } from "vitest";
import { currentSessionStartMs } from "./tickService.js";

// Helper: IST wall-clock (y, monthIndex, day, hour, minute) → epoch ms. India is UTC+5:30, no DST.
const IST = 330 * 60000;
const ist = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi) - IST;
const open = (y, mo, d) => ist(y, mo, d, 9, 15); // 09:15 IST session open

describe("currentSessionStartMs (session boundary — drops overnight ticks)", () => {
  it("during market hours → today's 09:15 IST", () => {
    expect(currentSessionStartMs(ist(2026, 6, 1, 9, 32))).toBe(open(2026, 6, 1));
  });

  it("exactly at 09:15 IST → that session", () => {
    expect(currentSessionStartMs(ist(2026, 6, 1, 9, 15))).toBe(open(2026, 6, 1));
  });

  it("post-close → still today's 09:15 IST", () => {
    expect(currentSessionStartMs(ist(2026, 6, 1, 16, 0))).toBe(open(2026, 6, 1));
  });

  it("pre-open (08:00) → the PREVIOUS session's 09:15 IST", () => {
    expect(currentSessionStartMs(ist(2026, 6, 1, 8, 0))).toBe(open(2026, 5, 30));
  });

  it("an overnight tick is BEFORE the cutoff; a live session tick is at/after it", () => {
    const cutoff = currentSessionStartMs(ist(2026, 6, 1, 9, 32));
    expect(ist(2026, 5, 30, 22, 40)).toBeLessThan(cutoff); // 22:40 IST prior evening — dropped
    expect(ist(2026, 6, 1, 9, 20)).toBeGreaterThanOrEqual(cutoff); // 09:20 IST today — kept
  });
});
