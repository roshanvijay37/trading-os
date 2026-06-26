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
    fs.writeFileSync(HOLIDAYS_FILE, JSON.stringify(data, null, 2));
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
 * Check if a specific date is a market holiday
 */
export function isMarketHoliday(date = new Date()) {
  const iso = date.toISOString().split("T")[0];
  const { holidays } = getHolidays();
  return holidays.some((h) => h.date === iso);
}

/**
 * Get holiday name for a date (null if not a holiday)
 */
export function getHolidayName(date = new Date()) {
  const iso = date.toISOString().split("T")[0];
  const { holidays } = getHolidays();
  const found = holidays.find((h) => h.date === iso);
  return found ? found.name : null;
}

/**
 * Check if NSE market is open
 */
export function isNseMarketOpen() {
  const now = new Date();
  
  // Weekend
  const day = now.getUTCDay();
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
  if (h === 15 && m > 30) return false;
  
  return true;
}

/**
 * Get market status string
 */
export function getNseMarketStatus() {
  const now = new Date();
  const day = now.getUTCDay();
  
  // Weekend
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