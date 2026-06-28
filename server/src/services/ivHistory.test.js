import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  computeIvStats, extractVixValue, recordVix, getHistory,
  parseVixCandles, mergeSamples,
} from "./ivHistory.js";

describe("extractVixValue", () => {
  it("reads number, numeric string, and object forms", () => {
    expect(extractVixValue(13.4)).toBe(13.4);
    expect(extractVixValue("14.2")).toBe(14.2);
    expect(extractVixValue({ ltp: 12.8 })).toBe(12.8);
  });
  it("rejects missing / non-positive values", () => {
    expect(extractVixValue(null)).toBeNull();
    expect(extractVixValue(0)).toBeNull();
    expect(extractVixValue({ ltp: 0 })).toBeNull();
    expect(extractVixValue({})).toBeNull();
  });
});

describe("computeIvStats", () => {
  it("is empty/insufficient with no samples", () => {
    const s = computeIvStats([]);
    expect(s.samples).toBe(0);
    expect(s.sufficient).toBe(false);
    expect(s.rank).toBeNull();
  });

  it("computes rank and percentile against the distribution", () => {
    // current (last) = 20, range 10..20 -> rank 100; 4 of 5 below 20 -> percentile 80
    const samples = [
      { date: "2026-01-01", vix: 10 },
      { date: "2026-01-02", vix: 12 },
      { date: "2026-01-03", vix: 15 },
      { date: "2026-01-04", vix: 18 },
      { date: "2026-01-05", vix: 20 },
    ];
    const s = computeIvStats(samples, { minSamples: 5 });
    expect(s.current).toBe(20);
    expect(s.min).toBe(10);
    expect(s.max).toBe(20);
    expect(s.rank).toBe(100);
    expect(s.percentile).toBe(80);
    expect(s.sufficient).toBe(true);
  });

  it("flags insufficient below minSamples and honours lookback window", () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, "0")}`, vix: 10 + i }));
    expect(computeIvStats(samples, { minSamples: 20 }).sufficient).toBe(false);
    // lookback of 3 keeps only the last 3 (17,18,19): min 17, max 19
    const win = computeIvStats(samples, { lookbackDays: 3, minSamples: 1 });
    expect(win.samples).toBe(3);
    expect(win.min).toBe(17);
    expect(win.max).toBe(19);
  });

  it("returns neutral rank when all samples are equal", () => {
    const s = computeIvStats([{ date: "2026-03-01", vix: 14 }, { date: "2026-03-02", vix: 14 }], { minSamples: 1 });
    expect(s.rank).toBe(50);
  });
});

describe("parseVixCandles", () => {
  it("maps [time, o, h, l, close, v] candles to {date, vix} using the close", () => {
    const ts = Math.floor(Date.parse("2026-04-01T06:00:00Z") / 1000); // epoch seconds
    expect(parseVixCandles([[ts, 14.1, 14.9, 13.8, 14.5, 0]])).toEqual([{ date: "2026-04-01", vix: 14.5 }]);
  });
  it("skips malformed / non-positive rows", () => {
    expect(parseVixCandles([[123, 1, 2, 3], "x", null, [123, 1, 2, 3, 0]])).toEqual([]);
    expect(parseVixCandles(null)).toEqual([]);
  });
});

describe("mergeSamples (backfill, fills gaps only)", () => {
  const tmpFile = path.join(os.tmpdir(), `iv-merge-test-${process.pid}.json`);
  beforeAll(() => { process.env.IV_HISTORY_FILE = tmpFile; });
  afterAll(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    delete process.env.IV_HISTORY_FILE;
  });

  it("seeds an empty store, then only adds missing dates (existing samples win)", () => {
    expect(mergeSamples([{ date: "2026-05-01", vix: 12 }, { date: "2026-05-02", vix: 13 }])).toBe(2);
    // 2026-05-02 already present -> NOT overwritten; 2026-05-03 is new -> added
    expect(mergeSamples([{ date: "2026-05-02", vix: 99 }, { date: "2026-05-03", vix: 14 }])).toBe(3);
    expect(getHistory()).toEqual([
      { date: "2026-05-01", vix: 12 },
      { date: "2026-05-02", vix: 13 },
      { date: "2026-05-03", vix: 14 },
    ]);
  });
});

describe("recordVix (file-backed upsert)", () => {
  const tmpFile = path.join(os.tmpdir(), `iv-history-test-${process.pid}.json`);
  const day1 = Date.parse("2026-04-01T06:00:00Z"); // ~11:30 IST, same IST day
  const day1b = Date.parse("2026-04-01T09:00:00Z");
  const day2 = Date.parse("2026-04-02T06:00:00Z");

  beforeAll(() => { process.env.IV_HISTORY_FILE = tmpFile; });
  afterAll(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    delete process.env.IV_HISTORY_FILE;
  });

  it("upserts one sample per IST day and appends new days", () => {
    expect(recordVix(15.0, day1)).toEqual({ date: "2026-04-01", vix: 15.0 });
    recordVix(15.6, day1b); // same IST day -> updates, no new row
    recordVix(16.2, day2); // new day -> appends
    const hist = getHistory();
    expect(hist).toEqual([
      { date: "2026-04-01", vix: 15.6 },
      { date: "2026-04-02", vix: 16.2 },
    ]);
  });

  it("ignores unparseable VIX without writing a row", () => {
    const before = getHistory().length;
    expect(recordVix(null, day2)).toBeNull();
    expect(getHistory().length).toBe(before);
  });
});
