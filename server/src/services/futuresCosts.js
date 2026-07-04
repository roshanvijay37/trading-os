/**
 * Indian NSE index-futures statutory cost model.
 *
 * Sibling to blackScholes.js's computeOptionCosts, which stays options-specific (still used by
 * the backtest engine's BLACK_SCHOLES/EMA5_OPTION mode) — this is the correct cost model for
 * EMA5T's live/paper FUTURES positions in autoTrader.js. Futures costs are structurally
 * different from options: STT and stamp duty apply to full notional TURNOVER (price × qty),
 * not option premium, and the rates themselves are materially different.
 *
 * TODO(verify): the rate constants below are standard NSE F&O futures rates as commonly
 * published, NOT pulled from FYERS's own rate card — confirm against FYERS's current published
 * charges before trusting the resulting P&L numbers for real capital decisions.
 */

export function computeFuturesCosts(entryPrice, exitPrice, qty, opts = {}) {
  const brokeragePerOrder = opts.brokeragePerOrder ?? 20;
  const buyTurnover = entryPrice * qty;
  const sellTurnover = exitPrice * qty;
  const brokerage = brokeragePerOrder * 2;
  const stt = 0.0002 * sellTurnover; // STT ~0.02% on sell-side NOTIONAL turnover (futures have no premium)
  const exchTxn = 0.000019 * (buyTurnover + sellTurnover); // NSE futures txn charge ~0.0019%
  const sebi = 0.000001 * (buyTurnover + sellTurnover); // SEBI ₹10/crore, same rate as options
  const stamp = 0.00002 * buyTurnover; // stamp duty ~0.002% on buy-side (futures rate, lower than options' 0.003%)
  const gst = 0.18 * (brokerage + exchTxn + sebi); // GST 18% on brokerage + exchange txn + SEBI
  return brokerage + stt + exchTxn + sebi + stamp + gst;
}
