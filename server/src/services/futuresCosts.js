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
  // STT/stamp apply per LEG (buy vs sell), not per entry/exit. A LONG's entry is the BUY leg and
  // its exit is the SELL leg — but a SHORT's ENTRY is actually the SELL leg (opens with a sell)
  // and its EXIT is the BUY leg (covers with a buy), the reverse. Callers must say which side was
  // held so the correct leg gets taxed; entry/exit price alone doesn't carry that information.
  const isShort = opts.side === "SHORT";
  const buyPrice = isShort ? exitPrice : entryPrice;
  const sellPrice = isShort ? entryPrice : exitPrice;
  const buyTurnover = buyPrice * qty;
  const sellTurnover = sellPrice * qty;
  const brokerage = brokeragePerOrder * 2;
  const stt = 0.0002 * sellTurnover; // STT ~0.02% on sell-side NOTIONAL turnover (futures have no premium)
  const exchTxn = 0.000019 * (buyTurnover + sellTurnover); // NSE futures txn charge ~0.0019%
  const sebi = 0.000001 * (buyTurnover + sellTurnover); // SEBI ₹10/crore, same rate as options
  const stamp = 0.00002 * buyTurnover; // stamp duty ~0.002% on buy-side (futures rate, lower than options' 0.003%)
  const gst = 0.18 * (brokerage + exchTxn + sebi); // GST 18% on brokerage + exchange txn + SEBI
  return brokerage + stt + exchTxn + sebi + stamp + gst;
}
