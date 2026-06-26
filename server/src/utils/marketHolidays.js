/**
 * NSE Market Holidays (India)
 * Update this annually with holidays from https://www.nseindia.com/resources/exchange-communication-holidays
 */

// 2026 NSE Trading Holidays
const NSE_HOLIDAYS_2026 = [
  "2026-01-01", // New Year's Day (Thursday)
  "2026-01-26", // Republic Day (Monday)
  "2026-03-17", // Holi (Tuesday)
  "2026-04-02", // Good Friday
  "2026-04-14", // Ambedkar Jayanti / Dr. Baba Saheb Ambedkar Jayanti (Tuesday)
  "2026-05-01", // Maharashtra Day / Labour Day (Friday)
  "2026-08-15", // Independence Day (Saturday)
  "2026-08-28", // Ganesh Chaturthi (Friday)
  "2026-10-02", // Gandhi Jayanti (Friday)
  "2026-10-20", // Diwali - Laxmi Pujan (Tuesday)
  "2026-10-21", // Diwali - Balipratipada (Wednesday)
  "2026-11-09", // Gurunanak Jayanti (Monday)
  "2026-12-25", // Christmas (Friday)
];

const HOLIDAY_SET = new Set(NSE_HOLIDAYS_2026);

/**
 * Check if today is an NSE market holiday
 */
export function isMarketHoliday(date = new Date()) {
  const iso = date.toISOString().split("T")[0];
  return HOLIDAY_SET.has(iso);
}

/**
 * Check if market is open considering:
 * - Weekends (Sat/Sun)
 * - Holidays
 * - Trading hours (9:15 - 15:30 IST)
 */
export function isNseMarketOpen() {
  const now = new Date();
  
  // Check weekend
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  
  // Check holiday
  if (isMarketHoliday(now)) return false;
  
  // Check trading hours (IST)
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
  if (isMarketHoliday(now)) {
    const holidayName = getHolidayName(now);
    return `HOLIDAY${holidayName ? ` - ${holidayName}` : ""}`;
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

function getHolidayName(date) {
  const iso = date.toISOString().split("T")[0];
  const names = {
    "2026-01-01": "New Year's Day",
    "2026-01-26": "Republic Day",
    "2026-03-17": "Holi",
    "2026-04-02": "Good Friday",
    "2026-04-14": "Ambedkar Jayanti",
    "2026-05-01": "Labour Day",
    "2026-08-15": "Independence Day",
    "2026-08-28": "Ganesh Chaturthi",
    "2026-10-02": "Gandhi Jayanti",
    "2026-10-20": "Diwali Laxmi Pujan",
    "2026-10-21": "Diwali Balipratipada",
    "2026-11-09": "Gurunanak Jayanti",
    "2026-12-25": "Christmas",
  };
  return names[iso] || null;
}