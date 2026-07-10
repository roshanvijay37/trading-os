/**
 * NSE Market Holidays — Dynamic with fallback
 * 
 * Fetches from NSE website when possible, falls back to cached list.
 * Holidays are cached in memory and can be refreshed via API.
 */

import fs from "fs";
import path from "path";

const HOLIDAYS_FILE = path.join(process.cwd(), "data", "holidays.json");

// Default fallback holidays (2026) — used if fetch fails
const DEFAULT_HOLIDAYS = {
  year: 2026,
  updatedAt: "2026-01-01T00:00:00Z",
  source: "fallback",
  holidays: [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-26", name: "Republic Day" },
    { date: "2026-03-17", name: "Holi" },
    { date: "2026-04-02", name: "Good Friday" },
    { date: "2026-04-14", name: "Ambedkar Jayanti" },
    { date: "2026-05-01", name: "Labour Day" },
    { date: "2026-06-26", name: "Moharram" },
    { date: "2026-08-15", name: "Independence Day" },
    { date: "2026-08-28", name: "Ganesh Chaturthi" },
    { date: "2026-10-02", name: "Gandhi Jayanti" },
    { date: "2026-10-20", name: "Diwali Laxmi Pujan" },
    { date: "2026-10-21", name: "Diwali Balipratipada" },
    { date: "2026-11-09", name: "Gurunanak Jayanti" },
    { date: "2026-12-25", name: "Christmas" },
  ],
};

let cachedHolidays = null;

/**
 * Load holidays from disk or use default
 */
function loadHolidays() {
  try {
    if (fs.existsSync(HOLIDAYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(HOLIDAYS_FILE, "utf8"));
      cachedHolidays = data;
      return data;
    }
  } catch (err) {
    console.error("[HOLIDAYS] Failed to load cached holidays:", err.message);
  }
  cachedHolidays = DEFAULT_HOLIDAYS;
  return DEFAULT_HOLIDAYS;
}

/**
 * Save holidays to disk
 */
function saveHolidays(data) {
  try {
    const dir = path.dirname(HOLIDAYS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Write-then-rename (same pattern as sessions.json/oauth-state.json): a process kill mid-write
    // can never leave holidays.json truncated — a corrupt file would otherwise throw in
    // loadHolidays() and silently fall back to DEFAULT_HOLIDAYS, masking a real day-of-week bug.
    const tmpFile = `${HOLIDAYS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, HOLIDAYS_FILE);
    cachedHolidays = data;
  } catch (err) {
    console.error("[HOLIDAYS] Failed to save holidays:", err.message);
  }
}

/**
 * Get current holidays (from cache or disk)
 */
export function getHolidays() {
  if (cachedHolidays) return cachedHolidays;
  return loadHolidays();
}

/**
 * Refresh holidays from external source (NSE website)
 * This is a best-effort fetch — falls back to defaults if it fails
 */
export async function refreshHolidays() {
  try {
    // NSE holiday page — we fetch the JSON embedded in the page
    // NSE uses a dynamic API, so we try the known endpoint
    const response = await fetch("https://www.nseindia.com/api/holiday-master?type=trading", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
        "Accept": "application/json",
      },
      // Short timeout — don't block server startup
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const holidays = parseNseHolidays(data);

    const year = new Date().getFullYear();
    const result = {
      year,
      updatedAt: new Date().toISOString(),
      source: "nse-api",
      holidays,
    };
    
    saveHolidays(result);
    console.log(`[HOLIDAYS] Refreshed ${holidays.length} holidays from NSE`);
    return result;
    
  } catch (err) {
    console.log("[HOLIDAYS] Fetch failed, using fallback:", err.message);
    // Return existing cache or defaults
    const existing = getHolidays();
    return existing;
  }
}

/**
 * Pure: turn NSE's raw holiday-master response into our { date, name }[] shape, filtering to
 * trading holidays with a parseable date. Throws (rather than returning []) if NSE changes its
 * response schema or returns zero valid entries — refreshHolidays() must treat that as a failed
 * fetch, never as "there are no holidays," so it never overwrites a good cached/default list
 * with nothing. Exported for unit tests.
 */
export function parseNseHolidays(data) {
  if (!data || !Array.isArray(data)) throw new Error("Invalid response format");

  const holidays = data
    .filter((h) => h.tradingDate) // Only trading holidays
    .map((h) => ({
      date: h.tradingDate, // format: DD-MMM-YYYY
      name: h.description || "Market Holiday",
    }))
    .map((h) => ({
      // Convert DD-MMM-YYYY to YYYY-MM-DD
      date: convertNseDate(h.date),
      name: h.name,
    }))
    .filter((h) => h.date !== null);

  if (holidays.length === 0) {
    throw new Error("NSE returned zero valid holidays — refusing to overwrite the existing list");
  }
  return holidays;
}

/**
 * Convert NSE date format (DD-MMM-YYYY) to ISO (YYYY-MM-DD)
 */
function convertNseDate(nseDate) {
  try {
    const months = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const [dd, mmm, yyyy] = nseDate.split("-");
    const mm = months[mmm];
    if (!mm) return null;
    return `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
  } catch {
    return null;
  }
}

/**
 * Get the IST calendar date (YYYY-MM-DD) and day-of-week (0=Sun) for an instant.
 * NSE operates in IST; deriving the date/day from UTC can be off by one near midnight IST
 * and misclassify weekends/holidays.
 */
function getIstDateParts(date = new Date()) {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  return { iso: ist.toISOString().split("T")[0], day: ist.getUTCDay() };
}

/**
 * Check if a specific date is a market holiday
 */
export function isMarketHoliday(date = new Date()) {
  const { iso } = getIstDateParts(date);
  const { holidays } = getHolidays();
  return holidays.some((h) => h.date === iso);
}

/**
 * Get holiday name for a date (null if not a holiday)
 */
export function getHolidayName(date = new Date()) {
  const { iso } = getIstDateParts(date);
  const { holidays } = getHolidays();
  const found = holidays.find((h) => h.date === iso);
  return found ? found.name : null;
}

/**
 * Is `now` a TRADING DAY for the given exchange (weekend + holiday check only — the intraday
 * session window is the caller's session-profile concern, not this calendar's).
 *
 * v1 deliberately reuses the NSE weekend+holiday calendar for BOTH exchanges: MCX's holiday
 * list differs (e.g. MCX often runs an evening session on NSE holidays, and Muhurat timings
 * differ), so this is CONSERVATIVE for MCX — it skips a few valid gold sessions but never
 * trades a closed one; live quote-probes fail gracefully if MCX is closed on an NSE-open day.
 * A real MCX calendar is a documented follow-up.
 */
export function isInstrumentTradingDay(_exchange = "NSE", now = new Date()) {
  const { day } = getIstDateParts(now);
  if (day === 0 || day === 6) return false;
  if (isMarketHoliday(now)) return false;
  return true;
}

/**
 * Check if NSE market is open
 */
export function isNseMarketOpen() {
  const now = new Date();

  // Weekend (IST)
  const { day } = getIstDateParts(now);
  if (day === 0 || day === 6) return false;
  
  // Holiday
  if (isMarketHoliday(now)) return false;
  
  // Trading hours (IST)
  const utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  const ist = (utc + 330) % (24 * 60);
  const h = Math.floor(ist / 60);
  const m = ist % 60;
  
  if (h < 9 || h > 15) return false;
  if (h === 9 && m < 15) return false;
  if (h === 15 && m >= 30) return false; // matches getNseMarketStatus's close boundary exactly

  return true;
}

/**
 * Get market status string
 */
export function getNseMarketStatus() {
  const now = new Date();
  const { day } = getIstDateParts(now);

  // Weekend (IST)
  if (day === 0) return "SUNDAY_CLOSED";
  if (day === 6) return "SATURDAY_CLOSED";
  
  // Holiday
  const holidayName = getHolidayName(now);
  if (holidayName) {
    return `HOLIDAY - ${holidayName}`;
  }
  
  // Trading hours
  const utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  const ist = (utc + 330) % (24 * 60);
  const h = Math.floor(ist / 60);
  const m = ist % 60;
  
  if (h === 9 && m < 15) return "PRE_OPEN";
  if (h < 9 || h > 15 || (h === 15 && m >= 30)) return "CLOSED";
  
  return "OPEN";
}

// Auto-refresh on module load (best effort)
refreshHolidays().catch(() => {});

// Also retry periodically — a transient failure at startup (or NSE blocking this host's scrapes
// entirely, as already documented for fiiDii.js) must not leave the holiday list silently stale
// forever until a manual restart. This also covers the calendar year rolling past whatever the
// last successful fetch (or DEFAULT_HOLIDAYS) covers, without needing a redeploy.
const HOLIDAY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
setInterval(() => {
  refreshHolidays().catch(() => {});
}, HOLIDAY_REFRESH_INTERVAL_MS);