import { describe, it, expect } from "vitest";
import { currentSessionStartMs, getPeriodStart } from "./tickService.js";

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

// Candle buckets must be anchored at SESSION OPEN (09:15 IST) so tick-built bars share
// boundaries with NSE/FYERS REST-history bars on EVERY timeframe. The old server-local
// getMinutes() bucketing broke 30m (:00/:30 boundaries) and 60m (:00) — a live-vs-backtest
// EMA divergence on those timeframes.
describe("getPeriodStart (session-anchored candle buckets)", () => {
  const min = (n) => n * 60000;

  it("30m: a 10:07 IST tick lands in the 09:45–10:15 bar (not 10:00–10:30)", () => {
    expect(getPeriodStart(ist(2026, 6, 1, 10, 7), "minute", 30)).toBe(open(2026, 6, 1) + min(30)); // 09:45 IST
  });

  it("60m: a 10:07 IST tick lands in the 09:15–10:15 bar; 10:15 opens the next", () => {
    expect(getPeriodStart(ist(2026, 6, 1, 10, 7), "minute", 60)).toBe(open(2026, 6, 1)); // 09:15 IST
    expect(getPeriodStart(ist(2026, 6, 1, 10, 15), "minute", 60)).toBe(open(2026, 6, 1) + min(60)); // 10:15 IST
  });

  it("5m and 15m boundaries are unchanged by the anchoring (09:15 is on their grid)", () => {
    expect(getPeriodStart(ist(2026, 6, 1, 10, 7), "minute", 5)).toBe(ist(2026, 6, 1, 10, 5));
    expect(getPeriodStart(ist(2026, 6, 1, 10, 7), "minute", 15)).toBe(ist(2026, 6, 1, 10, 0));
    expect(getPeriodStart(ist(2026, 6, 1, 9, 16), "minute", 5)).toBe(ist(2026, 6, 1, 9, 15));
  });

  it("the first tick of the session opens the 09:15 bar on every timeframe", () => {
    for (const tf of [5, 15, 30, 60]) {
      expect(getPeriodStart(open(2026, 6, 1), "minute", tf)).toBe(open(2026, 6, 1));
    }
  });

  it("consecutive 30m bars step by exactly 30 minutes from the open", () => {
    const starts = [9 * 60 + 20, 9 * 60 + 50, 10 * 60 + 20].map((m) =>
      getPeriodStart(ist(2026, 6, 1, Math.floor(m / 60), m % 60), "minute", 30),
    );
    expect(starts[1] - starts[0]).toBe(min(30));
    expect(starts[2] - starts[1]).toBe(min(30));
  });
});

// ─── MCX gold session anchor (09:00 IST) ────────────────────────────────────────────────────
// Gold trades 09:00–23:30; its candles must anchor at 09:00 (MCX/FYERS bar boundaries are
// 09:00–09:30–10:00… for 30m), and its 09:00–09:15 ticks must NOT be dropped by the NSE cutoff.
// The default (no sessionOpenMin) stays the NSE 09:15 anchor — asserted for regression.
describe("per-symbol session anchor (MCX gold = 09:00)", () => {
  const min = (n) => n * 60000;
  const MCX_OPEN = 9 * 60; // 09:00 IST
  const goldOpen = (y, mo, d) => ist(y, mo, d, 9, 0);

  it("currentSessionStartMs with the MCX anchor → today's 09:00 IST", () => {
    expect(currentSessionStartMs(ist(2026, 6, 1, 9, 5), MCX_OPEN)).toBe(goldOpen(2026, 6, 1));
    // NSE default at the same instant would point at the PREVIOUS session (09:05 < 09:15)
    expect(currentSessionStartMs(ist(2026, 6, 1, 9, 5))).toBe(ist(2026, 5, 30, 9, 15));
  });

  it("a 09:05 gold tick is inside the MCX session (would be dropped under the NSE anchor)", () => {
    const mcxCutoff = currentSessionStartMs(ist(2026, 6, 1, 9, 32), MCX_OPEN);
    const nseCutoff = currentSessionStartMs(ist(2026, 6, 1, 9, 32));
    const tick = ist(2026, 6, 1, 9, 5);
    expect(tick).toBeGreaterThanOrEqual(mcxCutoff);
    expect(tick).toBeLessThan(nseCutoff);
  });

  it("30m gold buckets: 09:14 → the 09:00 bar; 09:30 opens the next; evening 22:40 → 22:30 bar", () => {
    expect(getPeriodStart(ist(2026, 6, 1, 9, 14), "minute", 30, MCX_OPEN)).toBe(goldOpen(2026, 6, 1));
    expect(getPeriodStart(ist(2026, 6, 1, 9, 30), "minute", 30, MCX_OPEN)).toBe(goldOpen(2026, 6, 1) + min(30));
    expect(getPeriodStart(ist(2026, 6, 1, 22, 40), "minute", 30, MCX_OPEN)).toBe(ist(2026, 6, 1, 22, 30));
  });

  it("60m gold buckets anchor 09:00–10:00–11:00…", () => {
    expect(getPeriodStart(ist(2026, 6, 1, 9, 59), "minute", 60, MCX_OPEN)).toBe(goldOpen(2026, 6, 1));
    expect(getPeriodStart(ist(2026, 6, 1, 10, 0), "minute", 60, MCX_OPEN)).toBe(goldOpen(2026, 6, 1) + min(60));
  });

  it("REGRESSION: omitting sessionOpenMin keeps the NSE 09:15 anchor everywhere", () => {
    expect(getPeriodStart(ist(2026, 6, 1, 10, 7), "minute", 30)).toBe(open(2026, 6, 1) + min(30)); // 09:45–10:15 bar
    expect(currentSessionStartMs(ist(2026, 6, 1, 12, 0))).toBe(open(2026, 6, 1));
  });
});
