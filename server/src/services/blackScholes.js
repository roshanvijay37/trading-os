/**
 * Black-Scholes option pricing + Indian-options cost model.
 *
 * Used by the backtest engine's BLACK_SCHOLES pricing mode to simulate what an
 * option BUYER would actually earn when trading the index signals — capturing
 * delta (<1 capture of the index move), theta (premium decay while held), the
 * premium outlay itself, the bid/ask spread, and statutory charges (STT, exchange,
 * GST, stamp). The index signal logic is unchanged; only the P&L accounting differs.
 *
 * Caveats (this is a MODEL, not real option ticks):
 *  - IV is a single flat input per run. Real IV has a smile/term-structure and
 *    crushes around events. Feed a realistic value (≈ India VIX / 100, or higher
 *    for BankNifty) or accept the per-symbol default.
 *  - Index options are European with no dividend on the index, which is exactly
 *    what plain Black-Scholes prices — so the pricing form itself is appropriate.
 *  - Weekly expiry day is approximated by a configurable weekday (historically
 *    Thursday for NIFTY/BANKNIFTY). NSE has since changed expiry days and removed
 *    BankNifty weeklies — verify against the period you are testing.
 */

// Standard normal CDF — Abramowitz & Stegun 7.1.26 (accurate to ~1e-7).
function normCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/**
 * Black-Scholes price for a European index option.
 * @param {Object} p
 * @param {"CE"|"PE"} p.type
 * @param {number} p.spot   - underlying (index) level
 * @param {number} p.strike
 * @param {number} p.t      - time to expiry in YEARS
 * @param {number} [p.r]    - annual risk-free rate (decimal)
 * @param {number} p.sigma  - annualized implied volatility (decimal)
 * @returns {number} option premium (>= intrinsic)
 */
export function bsPrice({ type, spot, strike, t, r = 0.065, sigma }) {
  if (!(spot > 0) || !(strike > 0)) return 0;
  // At/after expiry or with no vol, the option is worth only its intrinsic value.
  if (!(t > 0) || !(sigma > 0)) {
    return type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (type === "CE") {
    return spot * normCDF(d1) - strike * Math.exp(-r * t) * normCDF(d2);
  }
  return strike * Math.exp(-r * t) * normCDF(-d2) - spot * normCDF(-d1);
}

/** Round a spot level to the nearest tradable strike. */
export function roundToStrike(spot, interval) {
  if (!(interval > 0)) return Math.round(spot);
  return Math.round(spot / interval) * interval;
}

/**
 * Time to the nearest weekly expiry, in YEARS, from a candle timestamp (ms, epoch UTC).
 * Theta is captured because this shrinks bar-by-bar as the hold progresses.
 * @param {number} timestampMs
 * @param {number} [expiryWeekday] - 0=Sun..6=Sat in IST wall-clock (default 4 = Thursday)
 * @param {number} [expiryHourIST] - hour-of-day of expiry settlement (default 15.5 = 15:30)
 */
export function yearsToExpiry(timestampMs, expiryWeekday = 4, expiryHourIST = 15.5) {
  const istMs = timestampMs + 330 * 60000; // shift epoch to IST wall-clock
  const d = new Date(istMs);
  const dow = d.getUTCDay();
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const expiryMinutes = expiryHourIST * 60;
  let daysAhead = (expiryWeekday - dow + 7) % 7;
  // Past today's settlement on expiry day → roll to next week's expiry.
  if (daysAhead === 0 && minutes > expiryMinutes) daysAhead = 7;
  const minutesToExpiry = daysAhead * 24 * 60 + (expiryMinutes - minutes);
  const years = minutesToExpiry / (365 * 24 * 60);
  return Math.max(years, 1 / (365 * 24 * 60)); // floor at ~1 min so BS never divides by zero
}

/**
 * Per-symbol option defaults (IV / strike step / lot size). All overridable per run.
 * Lot sizes change periodically — verify against current NSE contract specs.
 */
export function getOptionDefaults(symbol = "") {
  const s = symbol.toUpperCase();
  if (s.includes("NIFTYBANK") || s.includes("BANKNIFTY")) return { iv: 0.18, strikeInterval: 100, lotSize: 30 };
  if (s.includes("FINNIFTY")) return { iv: 0.16, strikeInterval: 50, lotSize: 65 };
  if (s.includes("SENSEX")) return { iv: 0.15, strikeInterval: 100, lotSize: 20 };
  return { iv: 0.13, strikeInterval: 50, lotSize: 65 }; // NIFTY 50 — 75→65 per NSE Jan-2026 series revision (FAOP70616)
}

/**
 * Round-trip statutory + brokerage cost for an Indian options trade (BUY then SELL),
 * in rupees. Rates reflect the post-Oct-2024 schedule; treat as a close approximation.
 */
export function computeOptionCosts(entryPremium, exitPremium, qty, opts = {}) {
  const brokeragePerOrder = opts.brokeragePerOrder ?? 20;
  const buyTurnover = entryPremium * qty;
  const sellTurnover = exitPremium * qty;
  const brokerage = brokeragePerOrder * 2;
  const stt = 0.000625 * sellTurnover;              // STT 0.0625% on sell-side premium
  const exchTxn = 0.0003503 * (buyTurnover + sellTurnover); // NSE txn charge ~0.03503%
  const sebi = 0.000001 * (buyTurnover + sellTurnover);     // SEBI ₹10 / crore
  const stamp = 0.00003 * buyTurnover;             // stamp 0.003% on buy
  const gst = 0.18 * (brokerage + exchTxn + sebi); // GST 18% on brokerage + txn + sebi
  return brokerage + stt + exchTxn + sebi + stamp + gst;
}
