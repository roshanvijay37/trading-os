/**
 * NSE cash-equity INTRADAY (MIS) statutory cost model — used by the Equity MIS trader
 * (services/equityTrader.js) so paper P&L is reported NET, same discipline as the futures bot.
 *
 * Intraday equity differs from both futures tables in futuresCosts.js:
 *   - STT is 0.025% on the SELL side only (delivery would be 0.1% both sides — not modeled here;
 *     this service is MIS-only and always squares off same-day).
 *   - NSE equity exchange transaction charge ≈ 0.00297% per side (higher than F&O's).
 *   - Stamp duty 0.003% on the BUY side (intraday rate; delivery is 0.015%).
 *
 * TODO(verify-before-live): confirm all rates against fyers.in/charges-list before any REAL
 * (non-paper) MIS order — same verification discipline as futuresCosts.js's NSE/MCX tables.
 * A SHORT's entry is the SELL leg and its exit the BUY leg (mirrors computeFuturesCosts).
 */

export function computeEquityIntradayCosts(entryPrice, exitPrice, qty, opts = {}) {
  const brokeragePerOrder = opts.brokeragePerOrder ?? 20;
  const isShort = opts.side === "SHORT";
  const buyPrice = isShort ? exitPrice : entryPrice;
  const sellPrice = isShort ? entryPrice : exitPrice;
  const buyTurnover = buyPrice * qty;
  const sellTurnover = sellPrice * qty;
  const brokerage = brokeragePerOrder * 2;
  const stt = 0.00025 * sellTurnover; // STT 0.025% sell-side (intraday equity)
  const exchTxn = 0.0000297 * (buyTurnover + sellTurnover); // NSE equity txn ~0.00297% per side
  const sebi = 0.000001 * (buyTurnover + sellTurnover); // SEBI ₹10/crore
  const stamp = 0.00003 * buyTurnover; // stamp 0.003% buy-side (intraday rate)
  const gst = 0.18 * (brokerage + exchTxn + sebi); // GST 18% on brokerage + txn + SEBI
  return brokerage + stt + exchTxn + sebi + stamp + gst;
}
