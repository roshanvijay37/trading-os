/**
 * Indian NSE index-futures statutory cost model.
 *
 * Sibling to blackScholes.js's computeOptionCosts, which stays options-specific (still used by
 * the backtest engine's BLACK_SCHOLES/EMA5_OPTION mode) — this is the correct cost model for
 * EMA5T's live/paper FUTURES positions in autoTrader.js. Futures costs are structurally
 * different from options: STT and stamp duty apply to full notional TURNOVER (price × qty),
 * not option premium, and the rates themselves are materially different.
 *
 * Rates confirmed 2026-07-05 against FYERS's own live charges page (fyers.in/charges-list),
 * cross-checked against Zerodha's published charges page. STT reflects the rate effective
 * 2026-04-01 (post Union Budget 2026-27) — re-verify if a future Budget changes it again.
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
  const stt = 0.0005 * sellTurnover; // STT 0.05% on sell-side NOTIONAL turnover (futures have no premium), effective 2026-04-01
  const exchTxn = 0.0000183 * (buyTurnover + sellTurnover); // NSE futures txn charge 0.00183%
  const sebi = 0.000001 * (buyTurnover + sellTurnover); // SEBI ₹10/crore, same rate as options
  const stamp = 0.00002 * buyTurnover; // stamp duty ~0.002% on buy-side (futures rate, lower than options' 0.003%)
  const gst = 0.18 * (brokerage + exchTxn + sebi); // GST 18% on brokerage + exchange txn + SEBI
  return brokerage + stt + exchTxn + sebi + stamp + gst;
}
