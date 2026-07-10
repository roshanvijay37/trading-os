/**
 * Indian exchange-traded futures statutory cost model (NSE index futures + MCX commodity futures).
 *
 * Sibling to blackScholes.js's computeOptionCosts, which stays options-specific (still used by
 * the backtest engine's BLACK_SCHOLES/EMA5_OPTION mode) — this is the correct cost model for
 * EMA5T's live/paper FUTURES positions in autoTrader.js. Futures costs are structurally
 * different from options: STT/CTT and stamp duty apply to full notional TURNOVER (price × qty),
 * not option premium, and the rates themselves are materially different.
 *
 * NSE rates confirmed 2026-07-05 against FYERS's own live charges page (fyers.in/charges-list),
 * cross-checked against Zerodha's published charges page. STT reflects the rate effective
 * 2026-04-01 (post Union Budget 2026-27) — re-verify if a future Budget changes it again.
 *
 * MCX rates (opts.exchange === "MCX", non-agri commodity futures e.g. GOLD/GOLDM): commodities
 * pay CTT (Commodity Transaction Tax) 0.01% on the SELL leg — NOT the 0.05% STT equities pay —
 * plus MCX's own exchange transaction charge (~0.0021%, materially higher than NSE's 0.00183%).
 * TODO(verify-before-live): re-confirm CTT/MCX-txn/stamp against fyers.in/charges-list before
 * any REAL (non-paper) MCX order — same discipline as the NSE verification above.
 */

const EXCHANGE_RATES = {
  NSE: {
    sellTax: 0.0005,    // STT 0.05% on sell-side NOTIONAL turnover, effective 2026-04-01
    exchTxn: 0.0000183, // NSE futures txn charge 0.00183% (both legs)
    stamp: 0.00002,     // stamp duty ~0.002% on buy-side (futures rate, lower than options' 0.003%)
  },
  MCX: {
    sellTax: 0.0001,    // CTT 0.01% on sell-side notional (non-agri commodity futures)
    exchTxn: 0.000021,  // MCX exchange txn ~0.0021% (both legs)
    stamp: 0.00002,     // stamp duty ~0.002% on buy-side (commodity futures)
  },
};

export function computeFuturesCosts(entryPrice, exitPrice, qty, opts = {}) {
  const brokeragePerOrder = opts.brokeragePerOrder ?? 20;
  // Default "NSE" keeps every existing caller byte-identical (autoTrader + backtest pass no exchange).
  const rates = EXCHANGE_RATES[opts.exchange] ?? EXCHANGE_RATES.NSE;
  // STT/CTT/stamp apply per LEG (buy vs sell), not per entry/exit. A LONG's entry is the BUY leg and
  // its exit is the SELL leg — but a SHORT's ENTRY is actually the SELL leg (opens with a sell)
  // and its EXIT is the BUY leg (covers with a buy), the reverse. Callers must say which side was
  // held so the correct leg gets taxed; entry/exit price alone doesn't carry that information.
  const isShort = opts.side === "SHORT";
  const buyPrice = isShort ? exitPrice : entryPrice;
  const sellPrice = isShort ? entryPrice : exitPrice;
  const buyTurnover = buyPrice * qty;
  const sellTurnover = sellPrice * qty;
  const brokerage = brokeragePerOrder * 2;
  const sellTax = rates.sellTax * sellTurnover; // STT (NSE) / CTT (MCX) on sell-side notional
  const exchTxn = rates.exchTxn * (buyTurnover + sellTurnover);
  const sebi = 0.000001 * (buyTurnover + sellTurnover); // SEBI ₹10/crore, same on both exchanges
  const stamp = rates.stamp * buyTurnover;
  const gst = 0.18 * (brokerage + exchTxn + sebi); // GST 18% on brokerage + exchange txn + SEBI
  return brokerage + sellTax + exchTxn + sebi + stamp + gst;
}
