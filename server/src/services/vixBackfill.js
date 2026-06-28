/**
 * One-time India VIX history backfill from FYERS' daily-candles API, so IV Rank / Percentile
 * are meaningful immediately instead of accruing one day at a time.
 *
 * The history endpoint is authenticated, so this can only run with a connected FYERS session
 * (app id + access token). It is best-effort and guarded: it only hits FYERS while the stored
 * history is still sparse, backs off on failure, and stops once enough samples exist. If FYERS
 * does not serve VIX history, nothing breaks — the day-by-day accrual via recordVix() remains.
 */

import { parseVixCandles, mergeSamples, getHistory, MIN_SAMPLES } from "./ivHistory.js";

const VIX_SYMBOL = process.env.VIX_HISTORY_SYMBOL || "NSE:INDIAVIX-INDEX";
const BACKFILL_DAYS = 365; // ~250 trading days -> a full 252-day IV-rank lookback
const RETRY_COOLDOWN_MS = 30 * 60 * 1000; // don't re-hit FYERS more than every 30 min on failure
const FETCH_TIMEOUT_MS = 15000;

let done = false; // set once the store has enough samples (process-lifetime guard)
let lastAttempt = 0;

/**
 * Attempt the backfill if the store is still sparse. Safe to call on every option-chain poll —
 * it short-circuits cheaply once satisfied or within the cooldown window.
 * @returns {Promise<{status: string, added?: number, total?: number}>}
 */
export async function maybeBackfillVix(appId, accessToken, nowMs = Date.now()) {
  if (done) return { status: "done" };
  if (getHistory().length >= MIN_SAMPLES) {
    done = true;
    return { status: "sufficient" };
  }
  if (nowMs - lastAttempt < RETRY_COOLDOWN_MS) return { status: "cooldown" };
  lastAttempt = nowMs;
  if (!appId || !accessToken) return { status: "no-credentials" };

  const to = Math.floor(nowMs / 1000);
  const from = to - BACKFILL_DAYS * 24 * 3600;
  const url =
    `https://api-t1.fyers.in/data/history?symbol=${encodeURIComponent(VIX_SYMBOL)}` +
    `&resolution=D&date_format=0&range_from=${from}&range_to=${to}&cont_flag=1`;

  const response = await fetch(url, {
    headers: { Authorization: `${appId}:${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`FYERS VIX history ${response.status}: ${text.slice(0, 150)}`);
  }

  const data = await response.json();
  const samples = parseVixCandles(data.candles);
  const total = mergeSamples(samples);
  if (total >= MIN_SAMPLES) done = true;
  console.log(`[vixBackfill] symbol=${VIX_SYMBOL} fetched=${samples.length} stored=${total}`);
  return { status: "ok", added: samples.length, total };
}
