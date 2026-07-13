/**
 * Instrument/session registry — the SINGLE source of truth for per-exchange session clocks,
 * gold contract specs, and futures symbol construction. Pure module (no imports, no side
 * effects — same pattern as signalCore.js) shared by autoTrader.js, routes/backtest.js and
 * tickService.js, so the live bot and the backtest can never drift on WHEN an instrument
 * trades — the same guarantee signalCore gives for WHAT it trades.
 *
 * All times are IST wall-clock (India has no DST; minutes-since-midnight or decimal hours).
 */

// ─── Session profiles ────────────────────────────────────────────────────────────────────
// NSE_INDEX mirrors the long-standing hardcoded equity constants exactly (9:15 open, entries
// 9:15–15:00, operator-tunable 14:00 cutoff, 15:15 square-off, 15:30 hard close).
// MCX_COMMODITY is the VALIDATED gold profile (2026-07-10 research): entries 09:00–22:00,
// live square-off ~23:15 wall-clock; the backtest approximates square-off on the 23:00 bar
// (there is no 23:15 bar at 30/60m granularity — the 23:00 bar's close ≈ the 23:25–30 fill).
// MCX evening close drifts to ~23:55 in US winter — documented, not modeled in v1 (23:30 base).
export const SESSION_PROFILES = {
  NSE_INDEX: {
    exchange: "NSE",
    preOpenStartMin: 9 * 60,        // 09:00 — PRE_OPEN phase begins (matches the old loop's 9:00–9:15 branch)
    sessionOpenMin: 9 * 60 + 15,    // 09:15 — first tradable minute; tick/candle session anchor
    sessionStartDecimal: 9.25,      // entries valid from (isValidTradingTime lower bound)
    sessionEndDecimal: 15.0,        // no NEW entries at/after 15:00
    entryCutoffHour: null,          // null → live reads CONFIG.MAX_TIME_ENTRY_HOUR (operator knob preserved)
    squareOffHour: 15, squareOffMinute: 15,     // live wall-clock square-off
    btSquareOffHour: 15, btSquareOffMinute: 15, // backtest square-off (same as live for NSE)
    closeMin: 15 * 60 + 30,         // 15:30 — hard force-close boundary / market close
  },
  MCX_COMMODITY: {
    exchange: "MCX",
    preOpenStartMin: 8 * 60 + 45,   // 08:45 — MCX pre-open
    sessionOpenMin: 9 * 60,         // 09:00
    sessionStartDecimal: 9.0,
    sessionEndDecimal: 22.0,        // validated: no NEW entries at/after 22:00
    entryCutoffHour: 22,            // fixed (not the CONFIG knob) — part of the validated profile
    squareOffHour: 23, squareOffMinute: 15,     // live: flat by ~23:15
    btSquareOffHour: 23, btSquareOffMinute: 0,  // backtest: exit on the 23:00 bar close (validated variant)
    closeMin: 23 * 60 + 30,         // 23:30 baseline session end
  },
};

// ─── Gold contract specs ─────────────────────────────────────────────────────────────────
// pointValue = rupees of P&L per 1 point of price move per lot (GOLD quotes ₹/10g):
//   GOLD (big, 1kg)   = ₹100/point;  GOLDM (mini, 100g) = ₹10/point.
// marginPerLot: indicative NRML overnight margins — TODO(verify) against the FYERS margin
// calculator before any REAL (non-paper) order; exchange ad-hoc margins can raise these.
// NOTE(live-only): FYERS order-qty semantics for MCX (lots vs units) must be verified before
// leaving paper mode — paper P&L is correct with qty = pointValue (pnl = Δprice × qty).
export const GOLD_CONTRACTS = {
  GOLDM: { root: "GOLDM", pointValue: 10, marginPerLot: 80000 },
  GOLD: { root: "GOLD", pointValue: 100, marginPerLot: 800000 },
};

// ─── IST calendar date ──────────────────────────────────────────────────────────────────────
/**
 * IST calendar date ("YYYY-MM-DD") of an epoch-seconds instant (defaults to now). India has no
 * DST, so a fixed +5:30 offset is exact. Shared by autoTrader + equityTrader's cross-session
 * alert guard: an EMA5T alert candle must belong to TODAY's session to be tradeable — the
 * 2026-07-13 phantom-gold regression armed Friday's bar levels on Monday morning because no
 * consumer compared the alert candle's session day against the clock (every session this repo
 * trades — NSE and MCX — opens and closes within one IST calendar day, so date == session day).
 */
export function istDateKey(epochSec = Math.floor(Date.now() / 1000)) {
  return new Date((epochSec + 19800) * 1000).toISOString().slice(0, 10);
}

// ─── Futures symbol construction (shared by live + backtest — ends the duplicated builders) ─
export const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function buildFuturesSymbol(root, year, monthIdx, exchange = "NSE") {
  return `${exchange}:${root}${String(year % 100).padStart(2, "0")}${MONTH_CODES[monthIdx]}FUT`;
}

// How many consecutive months to quote-probe when resolving the front contract. GOLD lists
// bi-monthly (FEB/APR/JUN/AUG/OCT/DEC) — probing 0..3 months guarantees hitting an even month
// from any starting month; NSE index futures are monthly (0..2 suffices, unchanged behavior).
export function probeMonthsFor(exchange) {
  return exchange === "MCX" ? 4 : 3;
}

// ─── Phase computation ───────────────────────────────────────────────────────────────────
/**
 * Where an instrument's session currently stands. Pure: caller supplies IST minutes-since-
 * midnight and whether today is a trading day for the instrument's exchange.
 * Reproduces the legacy NSE loop's branch table exactly for NSE_INDEX:
 *   <09:00 CLOSED · 09:00–09:14 PRE_OPEN · 09:15–15:29 OPEN · ≥15:30 CLOSED.
 * @returns {"PRE_OPEN"|"OPEN"|"CLOSED"}
 */
export function computeInstrumentPhase(profile, { istMinutes, isTradingDay }) {
  if (!isTradingDay) return "CLOSED";
  if (istMinutes >= profile.closeMin) return "CLOSED";
  if (istMinutes >= profile.sessionOpenMin) return "OPEN";
  if (istMinutes >= profile.preOpenStartMin) return "PRE_OPEN";
  return "CLOSED";
}

// ─── Trading-loop plan ───────────────────────────────────────────────────────────────────
/**
 * Pure decision table for one trading-loop cycle — extracted from the loop so the riskiest
 * behavior (WHO scans, WHOSE positions force-close, at WHAT cadence) is unit-testable without
 * timers/network. For an index-only selection this reproduces the legacy loop's behavior
 * exactly (verified by truth-table tests), with one deliberate improvement: holidays reschedule
 * at the slow cadence like any other closed state (legacy quirk polled holidays at 15s).
 *
 * @param {object} args
 * @param {number} args.istMinutes IST minutes-since-midnight
 * @param {Array<{name:string, active:boolean, profile:object, isTradingDay:boolean}>} args.instruments
 *   EVERY configured instrument (not just selected) — a position on a deselected instrument
 *   must still be monitored and force-closed by its own session clock.
 * @param {string[]} [args.openPositionUnderlyings] underlying names of currently OPEN positions
 * @param {number} [args.defaultPollMs] cadence while anything relevant is open/pre-open
 * @param {number} [args.closedPollMs] cadence while everything relevant is closed
 */
export function computeLoopPlan({ istMinutes, instruments, openPositionUnderlyings = [], defaultPollMs = 15000, closedPollMs = 60000 }) {
  const phaseByInstrument = {};
  for (const inst of instruments) {
    phaseByInstrument[inst.name] = computeInstrumentPhase(inst.profile, { istMinutes, isTradingDay: inst.isTradingDay });
  }
  const openNames = new Set(openPositionUnderlyings);
  // "Relevant" = selected for trading, or currently holding a position (even if deselected).
  const relevant = instruments.filter((i) => i.active || openNames.has(i.name));
  const anyOpen = relevant.some((i) => phaseByInstrument[i.name] === "OPEN");
  const anyPreOpen = relevant.some((i) => phaseByInstrument[i.name] === "PRE_OPEN");
  return {
    phaseByInstrument,
    // Scan (signal-hunt) only ACTIVE instruments whose session is open.
    scanList: instruments.filter((i) => i.active && phaseByInstrument[i.name] === "OPEN").map((i) => i.name),
    // Force-close positions whose OWN instrument session is over — per-position, never blanket
    // (an index position closes at 15:30 while a gold position keeps running to 23:30).
    forceCloseList: [...openNames].filter((n) => (phaseByInstrument[n] ?? "CLOSED") === "CLOSED"),
    anyOpen,
    statusString: anyOpen ? "OPEN" : anyPreOpen ? "PRE_OPEN" : "CLOSED",
    rescheduleMs: anyOpen || anyPreOpen ? defaultPollMs : closedPollMs,
  };
}

// ─── Backtest symbol → session profile mapping ───────────────────────────────────────────
/**
 * The Backtest Lab sends the pseudo-symbol "MCX:GOLD" (the server resolves the real contract).
 * Any MCX symbol gets the commodity profile; NSE symbols return null so the engine's built-in
 * NSE defaults apply — keeping every existing backtest byte-identical.
 */
export function getBacktestProfile(symbol = "") {
  return String(symbol).toUpperCase().startsWith("MCX:") ? SESSION_PROFILES.MCX_COMMODITY : null;
}
