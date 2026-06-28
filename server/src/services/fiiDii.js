/**
 * FII / DII cash-market flow from NSE's public end-of-day participant data.
 *
 * This is END-OF-DAY data (NSE publishes it once, after market close ~18:30 IST) — never live.
 * The UI labels it as such. NSE actively blocks non-browser clients, so we bootstrap session
 * cookies from the homepage and send browser-like headers; even then a datacenter IP (e.g. a
 * cloud host) may be refused. Every failure degrades honestly: served stale-from-cache if we
 * have a prior good fetch, otherwise { available: false } so the UI shows "feed unreachable"
 * instead of fabricated numbers.
 *
 * Results are cached in memory and on disk (so a restart keeps the last figures). On an ephemeral
 * host the disk file resets on redeploy — point FII_DII_FILE at a mounted volume to retain it.
 */

import fs from "fs";
import path from "path";

const NSE_ORIGIN = "https://www.nseindia.com";
const NSE_FII_DII_URL = `${NSE_ORIGIN}/api/fiidiiTradeReact`;
const SOURCE = "NSE (EOD cash market)";

const REFRESH_MS = 30 * 60 * 1000;      // EOD data changes once/day — refresh at most every 30 min
const FAIL_COOLDOWN_MS = 5 * 60 * 1000; // after a failed fetch, don't hammer NSE for 5 min
const FETCH_TIMEOUT_MS = 12000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

function filePath() {
  return process.env.FII_DII_FILE || path.join(process.cwd(), "data", "fii-dii.json");
}

/** Parse a number from NSE's stringy values ("12,345.67", "-1,000", number). */
function num(x) {
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const n = parseFloat(String(x).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

/**
 * Normalize NSE's fiidiiTradeReact payload into { date, fii, dii } where each leg is
 * { buy, sell, net } in ₹ crore. NSE returns an array keyed by a `category` label like
 * "FII/FPI **" / "DII **" (exact wording varies, hence the substring match). Pure.
 */
export function parseFiiDii(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  let fii = null, dii = null, date = null;

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const cat = String(r.category ?? "").toUpperCase();
    const buy = round2(num(r.buyValue));
    const sell = round2(num(r.sellValue));
    let net = round2(num(r.netValue));
    if (net == null && buy != null && sell != null) net = round2(buy - sell);
    const leg = { buy, sell, net };

    if (date == null && r.date) date = String(r.date).trim();
    if (cat.includes("FII") || cat.includes("FPI")) fii = leg;
    else if (cat.includes("DII")) dii = leg;
  }

  if (!fii && !dii) return null;
  return { date, fii, dii };
}

/** Hit the NSE homepage to obtain anti-bot session cookies. Returns a Cookie header string. */
async function getNseCookies() {
  const res = await fetch(`${NSE_ORIGIN}/`, {
    headers: { ...BROWSER_HEADERS, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  await res.text().catch(() => {}); // drain so the socket is released
  return setCookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

/** Fetch + parse the latest FII/DII figures directly from NSE. Throws on any failure. */
export async function fetchFiiDiiFromNse() {
  const cookies = await getNseCookies();
  const res = await fetch(NSE_FII_DII_URL, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: "application/json, text/plain, */*",
      Referer: `${NSE_ORIGIN}/reports/fii-dii`,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NSE FII/DII returned ${res.status}`);

  const text = await res.text();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("NSE returned non-JSON (anti-bot block likely)");
  }

  const parsed = parseFiiDii(raw);
  if (!parsed) throw new Error("NSE FII/DII payload contained no FII/DII rows");
  return parsed;
}

// ─── Cache (memory + disk) ────────────────────────────────────────
let mem = null;       // { data, fetchedAt } — last successful fetch
let lastFail = 0;     // ms of last failed attempt (for the cooldown)

function loadDisk() {
  try {
    const f = filePath();
    if (fs.existsSync(f)) {
      const obj = JSON.parse(fs.readFileSync(f, "utf8"));
      if (obj && obj.data && typeof obj.fetchedAt === "number") return obj;
    }
  } catch (err) {
    console.error("[fiiDii] read failed:", err.message);
  }
  return null;
}

function saveDisk(obj) {
  try {
    const f = filePath();
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(obj));
  } catch (err) {
    console.error("[fiiDii] write failed:", err.message);
  }
}

function shape(entry, { stale, error } = {}) {
  return {
    available: true,
    source: SOURCE,
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    stale: !!stale,
    ...(error ? { error } : {}),
    ...entry.data,
  };
}

/**
 * Return the latest FII/DII figures, fetching from NSE when the cache is stale. Never throws —
 * returns { available: false, error } when there is no data to serve.
 */
export async function getFiiDii(nowMs = Date.now()) {
  if (!mem) mem = loadDisk();

  // Fresh enough — serve cache without touching NSE.
  if (mem && nowMs - mem.fetchedAt < REFRESH_MS) return shape(mem, { stale: false });

  // Recently failed — avoid hammering NSE; serve stale cache if we have it.
  if (nowMs - lastFail < FAIL_COOLDOWN_MS && mem) return shape(mem, { stale: true });

  try {
    const data = await fetchFiiDiiFromNse();
    mem = { data, fetchedAt: nowMs };
    saveDisk(mem);
    return shape(mem, { stale: false });
  } catch (err) {
    lastFail = nowMs;
    console.error("[fiiDii] fetch failed:", err.message);
    if (mem) return shape(mem, { stale: true, error: err.message });
    return { available: false, source: SOURCE, error: err.message };
  }
}

/** Test hook: clear the in-memory cache / cooldown between cases. */
export function _resetCacheForTests() {
  mem = null;
  lastFail = 0;
}
