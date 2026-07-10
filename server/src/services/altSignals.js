/**
 * Alternate ENTRY triggers for the Backtest Lab research engine.
 *
 * These plug into backtest.js's EXACT EMA5T machinery: each strategy nominates a "setup" candle,
 * and the shared engine does the rest — a resting stop-entry on the break of that candle's high/low,
 * the tight stop at its opposite extreme, the targetMultiplier×R target, and the 15:15 square-off.
 * ONLY the trigger differs. This lets us test whether a different signal adds any value over the
 * 5-EMA alert while holding EMA5T's proven exit geometry fixed.
 *
 * Purely additive & research-only: the live bot (autoTrader.js) never imports this, and the
 * EMA5T/EMA5/EMA5_OPTION code paths in backtest.js are untouched.
 */

export const ALT_STRATEGIES = ["RSI2", "VWAP", "MACD", "BOLL", "STREND"];

// ─── Indicators (index-aligned to candles; null during warmup; no lookahead) ──────────────
function ema(vals, p) {
  const o = new Array(vals.length).fill(null);
  if (vals.length < p) return o;
  let sum = 0;
  for (let i = 0; i < p; i++) sum += vals[i];
  let prev = sum / p; o[p - 1] = prev;
  const k = 2 / (p + 1);
  for (let i = p; i < vals.length; i++) { prev = (vals[i] - prev) * k + prev; o[i] = prev; }
  return o;
}
function sma(vals, p) {
  const o = new Array(vals.length).fill(null);
  let s = 0;
  for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= p) s -= vals[i - p]; if (i >= p - 1) o[i] = s / p; }
  return o;
}
function atr(c, p) {
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    if (i === 0) { tr[i] = c[i].high - c[i].low; continue; }
    tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
  }
  const o = new Array(c.length).fill(null);
  if (c.length < p + 1) return o;
  let s = 0; for (let i = 1; i <= p; i++) s += tr[i];
  let prev = s / p; o[p] = prev;
  for (let i = p + 1; i < c.length; i++) { prev = (prev * (p - 1) + tr[i]) / p; o[i] = prev; }
  return o;
}
function rsi(cl, p) {
  const o = new Array(cl.length).fill(null);
  if (cl.length < p + 1) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = cl[i] - cl[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  o[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return o;
}
function sessionVWAP(c) {
  const o = new Array(c.length).fill(null);
  let day = null, pv = 0, v = 0;
  for (let i = 0; i < c.length; i++) {
    const d = Math.floor((c[i].timestamp + 5.5 * 3600000) / 86400000); // IST calendar day
    if (d !== day) { day = d; pv = 0; v = 0; }
    const tp = (c[i].high + c[i].low + c[i].close) / 3, vol = c[i].volume || 0;
    pv += tp * vol; v += vol;
    o[i] = v > 0 ? pv / v : c[i].close;
  }
  return o;
}
function macd(cl, f, s, sg) {
  const ef = ema(cl, f), es = ema(cl, s);
  const line = cl.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const def = line.filter((x) => x != null);
  const sog = ema(def, sg);
  const signal = new Array(cl.length).fill(null);
  let j = 0;
  for (let i = 0; i < cl.length; i++) if (line[i] != null) { signal[i] = sog[j] ?? null; j++; }
  const hist = cl.map((_, i) => (line[i] != null && signal[i] != null ? line[i] - signal[i] : null));
  return { macd: line, signal, hist };
}
function bollinger(cl, p, k) {
  const mid = sma(cl, p);
  const upper = new Array(cl.length).fill(null), lower = new Array(cl.length).fill(null);
  for (let i = p - 1; i < cl.length; i++) {
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += (cl[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / p);
    upper[i] = mid[i] + k * sd; lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}
function supertrend(c, p, m) {
  const a = atr(c, p), n = c.length;
  const dir = new Array(n).fill(null), line = new Array(n).fill(null);
  let pu = null, pl = null, tr = 1;
  for (let i = 0; i < n; i++) {
    if (a[i] == null) continue;
    const hl2 = (c[i].high + c[i].low) / 2, bu = hl2 + m * a[i], bl = hl2 - m * a[i];
    const pc = i > 0 ? c[i - 1].close : c[i].close;
    const fu = pu == null ? bu : (bu < pu || pc > pu ? bu : pu);
    const fl = pl == null ? bl : (bl > pl || pc < pl ? bl : pl);
    if (pu != null) { if (tr === 1 && c[i].close < fl) tr = -1; else if (tr === -1 && c[i].close > fu) tr = 1; }
    dir[i] = tr; line[i] = tr === 1 ? fl : fu; pu = fu; pl = fl;
  }
  return { dir, line };
}

// Precompute the indicator arrays a strategy needs (plus its warmup bar count). One call per run.
export function precomputeAlt(candles, strategy) {
  const cl = candles.map((c) => c.close);
  switch (strategy) {
    case "RSI2": return { warmup: 110, r: rsi(cl, 2), t: ema(cl, 100) };
    case "VWAP": return { warmup: 55, v: sessionVWAP(candles), t: ema(cl, 50) };
    case "MACD": return { warmup: 45, m: macd(cl, 12, 26, 9) };
    case "BOLL": return { warmup: 110, b: bollinger(cl, 20, 2), t: ema(cl, 100) };
    case "STREND": return { warmup: 25, s: supertrend(candles, 10, 3) };
    default: return { warmup: 0 };
  }
}

/**
 * Evaluate the setup at bar `i` (the ALERT candle). The engine then enters on a break of this
 * candle's high (BULLISH) / low (BEARISH) on a subsequent bar, with the stop at its opposite
 * extreme — identical to EMA5T. Two-sided. Returns "BULLISH" | "BEARISH" | null.
 */
export function detectAltAlert(strategy, i, candles, ind) {
  if (i < 2 || !ind) return null;
  const c = candles[i];
  switch (strategy) {
    case "RSI2": {
      const r = ind.r[i], t = ind.t[i]; if (r == null || t == null) return null;
      if (c.close > t && r < 15) return "BULLISH";
      if (c.close < t && r > 85) return "BEARISH";
      return null;
    }
    case "VWAP": {
      const v = ind.v[i], t = ind.t[i]; if (v == null || t == null) return null;
      if (c.close > t && c.low <= v && c.close > v) return "BULLISH";
      if (c.close < t && c.high >= v && c.close < v) return "BEARISH";
      return null;
    }
    case "MACD": {
      const M = ind.m, L = M.macd[i], h = M.hist[i], h1 = M.hist[i - 1], h2 = M.hist[i - 2];
      if (L == null || h == null || h1 == null || h2 == null) return null;
      if (L > 0 && h1 <= h2 && h > h1) return "BULLISH";
      if (L < 0 && h1 >= h2 && h < h1) return "BEARISH";
      return null;
    }
    case "BOLL": {
      const mid = ind.b.mid[i], t = ind.t[i]; if (mid == null || t == null) return null;
      if (c.close > t && c.low <= mid && c.close > mid) return "BULLISH";
      if (c.close < t && c.high >= mid && c.close < mid) return "BEARISH";
      return null;
    }
    case "STREND": {
      const d = ind.s.dir[i], ln = ind.s.line[i]; if (d == null || ln == null) return null;
      if (d === 1 && c.low <= ln * 1.003 && c.close > ln) return "BULLISH";
      if (d === -1 && c.high >= ln * 0.997 && c.close < ln) return "BEARISH";
      return null;
    }
    default: return null;
  }
}
