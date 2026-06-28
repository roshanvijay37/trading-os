/**
 * India VIX history — daily samples persisted to disk so IV Rank / IV Percentile can be
 * computed against a real distribution instead of a fabricated constant.
 *
 * One sample per IST trading day (the latest VIX seen that day, upserted). Samples accrue
 * as the option-chain endpoint is hit; there is NO historical backfill, so rank/percentile
 * stay flagged `sufficient: false` until enough days accumulate. On an ephemeral host (e.g.
 * Render without a persistent disk) the file resets on redeploy — point IV_HISTORY_FILE at a
 * mounted volume to retain it.
 */

import fs from "fs";
import path from "path";

const MAX_ENTRIES = 400; // ~16 months of trading days
const DEFAULT_LOOKBACK = 252; // 1 trading year
const DEFAULT_MIN_SAMPLES = 20; // below this, rank/percentile are not meaningful

// Sample count below which a one-time FYERS backfill is worth attempting (see vixBackfill.js).
export const MIN_SAMPLES = DEFAULT_MIN_SAMPLES;

// Resolved lazily (not at import time) so tests can redirect it via env before calling in.
function filePath() {
  return process.env.IV_HISTORY_FILE || path.join(process.cwd(), "data", "iv-history.json");
}

function istDateStr(ms) {
  return new Date(ms + 330 * 60000).toISOString().slice(0, 10); // YYYY-MM-DD in IST
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/** Pull a numeric VIX out of FYERS' indiavixData (number, numeric string, or {ltp/lp/...}). */
export function extractVixValue(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw > 0 ? raw : null;
  if (typeof raw === "string") {
    const v = parseFloat(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  if (typeof raw === "object") {
    const v = Number(raw.ltp ?? raw.lp ?? raw.value ?? raw.vix);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  return null;
}

/**
 * Compute IV Rank / Percentile from a list of {date, vix} samples.
 *  - rank       = (current - min) / (max - min) * 100  over the lookback window
 *  - percentile = % of lookback days with VIX strictly below current
 * Pure; safe on empty / degenerate input.
 */
export function computeIvStats(samples, opts = {}) {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK;
  const minSamples = opts.minSamples ?? DEFAULT_MIN_SAMPLES;

  const series = (Array.isArray(samples) ? samples : [])
    .filter((s) => s && Number.isFinite(s.vix) && s.vix > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const window = series.slice(-lookbackDays);
  const n = window.length;
  const base = { current: null, rank: null, percentile: null, min: null, max: null, samples: n, lookbackDays, minSamples, sufficient: false };
  if (n === 0) return base;

  const vals = window.map((s) => s.vix);
  const current = vals[vals.length - 1];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const rank = max > min ? ((current - min) / (max - min)) * 100 : 50;
  const below = vals.filter((v) => v < current).length;
  const percentile = (below / n) * 100;

  return {
    current: round2(current),
    rank: round2(rank),
    percentile: round2(percentile),
    min: round2(min),
    max: round2(max),
    samples: n,
    lookbackDays,
    minSamples,
    sufficient: n >= minSamples,
  };
}

function load() {
  try {
    const f = filePath();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (err) {
    console.error("[ivHistory] read failed:", err.message);
  }
  return [];
}

function save(arr) {
  try {
    const f = filePath();
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(arr));
  } catch (err) {
    console.error("[ivHistory] write failed:", err.message);
  }
}

/** Upsert today's (IST) VIX sample. Best-effort: returns the stored sample or null. */
export function recordVix(rawIndiaVix, nowMs = Date.now()) {
  const vix = extractVixValue(rawIndiaVix);
  if (vix == null) return null;
  const date = istDateStr(nowMs);
  const arr = load();
  const i = arr.findIndex((s) => s.date === date);
  if (i >= 0) arr[i] = { date, vix };
  else arr.push({ date, vix });
  const trimmed = arr.slice(-MAX_ENTRIES);
  save(trimmed);
  return { date, vix };
}

/**
 * Map FYERS daily history candles ([time, open, high, low, close, volume]) into {date, vix}
 * samples, using the close as the day's VIX. `time` is epoch seconds (date_format=0). Pure.
 */
export function parseVixCandles(candles) {
  const rows = Array.isArray(candles) ? candles : [];
  const out = [];
  for (const c of rows) {
    if (!Array.isArray(c) || c.length < 5) continue;
    const ts = Number(c[0]);
    const close = Number(c[4]);
    if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(close) || close <= 0) continue;
    const ms = ts < 1e12 ? ts * 1000 : ts; // seconds -> ms (guard if already ms)
    out.push({ date: istDateStr(ms), vix: round2(close) });
  }
  return out;
}

/**
 * Merge backfilled samples into the store, ONLY filling dates that are not already present —
 * live recordVix() samples (closer to real-time) always win over a historical daily close.
 * Returns the resulting total sample count.
 */
export function mergeSamples(newSamples) {
  const byDate = new Map();
  for (const s of load()) byDate.set(s.date, s.vix);
  for (const s of Array.isArray(newSamples) ? newSamples : []) {
    if (!s || !s.date || byDate.has(s.date)) continue;
    const v = extractVixValue(s.vix);
    if (v != null) byDate.set(s.date, v);
  }
  const merged = Array.from(byDate, ([date, vix]) => ({ date, vix }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-MAX_ENTRIES);
  save(merged);
  return merged.length;
}

export function getHistory() {
  return load();
}

export function getIvStats(opts) {
  return computeIvStats(load(), opts);
}
