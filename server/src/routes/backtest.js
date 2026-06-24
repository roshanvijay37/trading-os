import express from "express";
import { getSession, getAllSessions } from "./auth.js";

const router = express.Router();

const appId = process.env.FYERS_APP_ID;
const FYERS_DATA_BASE = "https://api-t1.fyers.in/data";

// In-memory cache for historical data
const dataCache = new Map();

// ─── RSI Calculation ──────────────────────────────────────────────
function calculateRSI(closes, period = 2) {
  const rsi = [];
  if (closes.length < period + 1) return rsi;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gain += change;
    else loss += Math.abs(change);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const g = change > 0 ? change : 0;
    const l = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

// ─── EMA Calculation ──────────────────────────────────────────────
function calculateEMA(closes, period) {
  const ema = [];
  if (closes.length < period) return ema;

  // Start with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  let prevEMA = sum / period;
  ema.push(prevEMA);

  const multiplier = 2 / (period + 1);

  for (let i = period; i < closes.length; i++) {
    prevEMA = (closes[i] - prevEMA) * multiplier + prevEMA;
    ema.push(prevEMA);
  }

  return ema;
}

// ─── Inside Candle Detection ──────────────────────────────────────
function isInsideCandle(prev, current) {
  return current.high < prev.high && current.low > prev.low;
}

// ─── Fetch Historical Data from FYERS ─────────────────────────────
// FYERS limits: max 100 days for intraday resolutions (1,2,3,5,10,15,20,30,45,60,120,180,240)
const INTRADAY_RESOLUTIONS = ["1", "2", "3", "5", "10", "15", "20", "30", "45", "60", "120", "180", "240"];
const MAX_DAYS_PER_REQUEST = 100;
const DAY_IN_SECONDS = 86400;

async function fetchHistoricalData(symbol, resolution, fromTs, toTs, accessToken) {
  const cacheKey = `${symbol}_${resolution}_${fromTs}_${toTs}`;
  if (dataCache.has(cacheKey)) return dataCache.get(cacheKey);

  const isIntraday = INTRADAY_RESOLUTIONS.includes(resolution);
  const totalDays = (toTs - fromTs) / DAY_IN_SECONDS;

  // If intraday and more than 100 days, chunk the requests
  if (isIntraday && totalDays > MAX_DAYS_PER_REQUEST) {
    console.log(`FYERS limit: ${resolution}m max ${MAX_DAYS_PER_REQUEST} days. Chunking ${totalDays} days...`);
    let allCandles = [];
    let currentFrom = fromTs;

    while (currentFrom < toTs) {
      let currentTo = currentFrom + (MAX_DAYS_PER_REQUEST * DAY_IN_SECONDS);
      if (currentTo > toTs) currentTo = toTs;

      const chunk = await fetchSingleRange(symbol, resolution, currentFrom, currentTo, accessToken);
      allCandles = allCandles.concat(chunk);

      currentFrom = currentTo + 1;
    }

    // Remove duplicates (FYERS may overlap)
    const seen = new Set();
    const unique = allCandles.filter(c => {
      const key = c[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    dataCache.set(cacheKey, unique);
    return unique;
  }

  // Single request for daily or < 100 days
  return fetchSingleRange(symbol, resolution, fromTs, toTs, accessToken);
}

async function fetchSingleRange(symbol, resolution, fromTs, toTs, accessToken) {
  const cacheKey = `${symbol}_${resolution}_${fromTs}_${toTs}`;
  if (dataCache.has(cacheKey)) return dataCache.get(cacheKey);

  const url = `${FYERS_DATA_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&date_format=0&range_from=${fromTs}&range_to=${toTs}&cont_flag=1`;

  console.log("Fetching FYERS data:", url);

  const response = await fetch(url, {
    headers: {
      Authorization: `${appId}:${accessToken}`,
    },
  });

  const data = await response.json();
  console.log("FYERS response:", JSON.stringify(data).slice(0, 500));

  if (data.s !== "ok") {
    throw new Error(data.message || `FYERS error: ${JSON.stringify(data)}`);
  }

  const candles = data.candles || [];
  dataCache.set(cacheKey, candles);
  return candles;
}

// ─── Parse FYERS Candle Format ────────────────────────────────────
function parseCandles(rawCandles) {
  return rawCandles.map((c) => ({
    timestamp: c[0] * 1000,
    datetime: new Date(c[0] * 1000).toISOString(),
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
  }));
}

// ─── Backtest Engine ──────────────────────────────────────────────
function runBacktest(candles, config) {
  const {
    strategy = "RSI",
    rsiPeriod = 2,
    oversoldThreshold = 10,
    overboughtThreshold = 90,
    emaPeriod = 5,
    capital = 1000000,
    riskPercent = 1,
    slBuffer = 0.005,
    targetMultiplier = 2,
    maxHoldBars = 12,
  } = config;

  // Pre-calculate indicators
  const closes = candles.map((c) => c.close);
  const rsiValues = calculateRSI(closes, rsiPeriod);
  const emaValues = calculateEMA(closes, emaPeriod);
  const rsiOffset = candles.length - rsiValues.length;
  const emaOffset = candles.length - emaValues.length;

  const trades = [];
  const equityCurve = [{ date: candles[0].datetime, equity: capital }];
  let currentCapital = capital;
  let position = null;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let totalPnL = 0;
  let maxDrawdown = 0;
  let peakEquity = capital;
  let maxConsecutiveLosses = 0;
  let currentConsecutiveLosses = 0;

  // Alert Candle tracking for 5 EMA strategy
  let alertCandle = null;

  // Inside Candle tracking
  let motherCandle = null;
  let insideCandle = null;

  // Traffic Light tracking
  let trend = null; // 'UP', 'DOWN', null
  let pullback = false;

  const warmup = Math.max(rsiOffset, emaOffset, 50);

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    const prev2Candle = candles[i - 2];
    const rsi = i >= rsiOffset ? rsiValues[i - rsiOffset] : null;
    const prevRsi = i - 1 >= rsiOffset ? rsiValues[i - 1 - rsiOffset] : null;
    const ema = i >= emaOffset ? emaValues[i - emaOffset] : null;

    if (currentCapital > peakEquity) peakEquity = currentCapital;
    const drawdown = ((peakEquity - currentCapital) / peakEquity) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    // ── Exit Logic (common for all strategies) ────────────────────
    if (position) {
      const barsHeld = i - position.entryBar;
      let exitPrice = null;
      let exitReason = "";

      if (position.side === "LONG" && candle.low <= position.sl) {
        exitPrice = Math.max(candle.open, position.sl);
        exitReason = "SL";
      } else if (position.side === "SHORT" && candle.high >= position.sl) {
        exitPrice = Math.min(candle.open, position.sl);
        exitReason = "SL";
      } else if (position.side === "LONG" && candle.high >= position.target) {
        exitPrice = Math.min(candle.open, position.target);
        exitReason = "TARGET";
      } else if (position.side === "SHORT" && candle.low <= position.target) {
        exitPrice = Math.max(candle.open, position.target);
        exitReason = "TARGET";
      } else if (barsHeld >= maxHoldBars) {
        exitPrice = candle.close;
        exitReason = "TIME";
      }

      // RSI-specific exits
      if (strategy === "RSI" && exitPrice === null) {
        if (position.side === "LONG" && rsi > overboughtThreshold) {
          exitPrice = candle.close;
          exitReason = "RSI_REVERSE";
        } else if (position.side === "SHORT" && rsi < oversoldThreshold) {
          exitPrice = candle.close;
          exitReason = "RSI_REVERSE";
        }
      }

      if (exitPrice !== null) {
        const pnl = position.side === "LONG"
          ? (exitPrice - position.entryPrice) * position.qty
          : (position.entryPrice - exitPrice) * position.qty;

        const pnlPercent = (pnl / (position.entryPrice * position.qty)) * 100;

        currentCapital += pnl;
        totalTrades++;
        totalPnL += pnl;

        if (pnl > 0) {
          wins++;
          currentConsecutiveLosses = 0;
        } else {
          losses++;
          currentConsecutiveLosses++;
          if (currentConsecutiveLosses > maxConsecutiveLosses) {
            maxConsecutiveLosses = currentConsecutiveLosses;
          }
        }

        trades.push({
          id: totalTrades,
          entryTime: position.entryTime,
          exitTime: candle.datetime,
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          qty: position.qty,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          exitReason,
          barsHeld,
          capitalAfter: Math.round(currentCapital * 100) / 100,
        });

        equityCurve.push({
          date: candle.datetime,
          equity: Math.round(currentCapital * 100) / 100,
        });

        position = null;
        alertCandle = null;
      }
      continue;
    }

    // ════════════════════════════════════════════════════════════════
    // ENTRY LOGIC — Strategy Selection
    // ════════════════════════════════════════════════════════════════

    // ── RSI 2-Period Strategy ────────────────────────────────────
    if (strategy === "RSI" && rsi !== null && prevRsi !== null) {
      if (prevRsi > oversoldThreshold && rsi <= oversoldThreshold) {
        const entryPrice = candle.open;
        const stopDistance = entryPrice * slBuffer;
        const sl = Math.round((entryPrice - stopDistance) * 100) / 100;
        const riskAmount = currentCapital * (riskPercent / 100);
        const qty = Math.floor(riskAmount / stopDistance);

        if (qty > 0) {
          const targetDistance = stopDistance * targetMultiplier;
          const target = Math.round((entryPrice + targetDistance) * 100) / 100;

          position = {
            side: "LONG",
            entryPrice,
            qty,
            sl,
            target,
            entryBar: i,
            entryTime: candle.datetime,
          };
        }
      } else if (prevRsi < overboughtThreshold && rsi >= overboughtThreshold) {
        const entryPrice = candle.open;
        const stopDistance = entryPrice * slBuffer;
        const sl = Math.round((entryPrice + stopDistance) * 100) / 100;
        const riskAmount = currentCapital * (riskPercent / 100);
        const qty = Math.floor(riskAmount / stopDistance);

        if (qty > 0) {
          const targetDistance = stopDistance * targetMultiplier;
          const target = Math.round((entryPrice - targetDistance) * 100) / 100;

          position = {
            side: "SHORT",
            entryPrice,
            qty,
            sl,
            target,
            entryBar: i,
            entryTime: candle.datetime,
          };
        }
      }
    }

    // ── 5 EMA Strategy (Subhasish Pani) ──────────────────────────
    else if (strategy === "EMA5" && ema !== null) {
      // Bullish Setup: Candle closes COMPLETELY BELOW 5 EMA
      if (prevCandle.close < ema && prevCandle.high < ema) {
        // New Alert Candle
        alertCandle = {
          candle: prevCandle,
          type: "BULLISH",
          index: i - 1,
        };
      }
      // Bearish Setup: Candle closes COMPLETELY ABOVE 5 EMA
      else if (prevCandle.close > ema && prevCandle.low > ema) {
        alertCandle = {
          candle: prevCandle,
          type: "BEARISH",
          index: i - 1,
        };
      }

      // Check for entry on current candle
      if (alertCandle) {
        const ac = alertCandle.candle;
        const riskAmount = currentCapital * (riskPercent / 100);

        // Bullish Entry: Break above Alert Candle high
        if (alertCandle.type === "BULLISH" && candle.high > ac.high) {
          const entryPrice = ac.high;
          const sl = ac.low;
          const stopDistance = entryPrice - sl;
          
          if (stopDistance > 0) {
            const qty = Math.floor(riskAmount / stopDistance);
            if (qty > 0) {
              const targetDistance = stopDistance * targetMultiplier;
              const target = Math.round((entryPrice + targetDistance) * 100) / 100;

              position = {
                side: "LONG",
                entryPrice,
                qty,
                sl: Math.round(sl * 100) / 100,
                target,
                entryBar: i,
                entryTime: candle.datetime,
              };
              alertCandle = null;
            }
          }
        }
        // Bearish Entry: Break below Alert Candle low
        else if (alertCandle.type === "BEARISH" && candle.low < ac.low) {
          const entryPrice = ac.low;
          const sl = ac.high;
          const stopDistance = sl - entryPrice;

          if (stopDistance > 0) {
            const qty = Math.floor(riskAmount / stopDistance);
            if (qty > 0) {
              const targetDistance = stopDistance * targetMultiplier;
              const target = Math.round((entryPrice - targetDistance) * 100) / 100;

              position = {
                side: "SHORT",
                entryPrice,
                qty,
                sl: Math.round(sl * 100) / 100,
                target,
                entryBar: i,
                entryTime: candle.datetime,
              };
              alertCandle = null;
            }
          }
        }
      }
    }

    // ── Traffic Light Strategy (Subhasish Pani) ──────────────────
    else if (strategy === "TRAFFIC_LIGHT" && ema !== null) {
      // Calculate trend using 20 EMA and 50 EMA
      const ema20 = calculateEMA(closes.slice(0, i + 1), 20);
      const ema50 = calculateEMA(closes.slice(0, i + 1), 50);
      const currentEMA20 = ema20[ema20.length - 1];
      const currentEMA50 = ema50[ema50.length - 1];
      const prevEMA20 = ema20.length > 1 ? ema20[ema20.length - 2] : currentEMA20;

      // Determine trend
      if (currentEMA20 > currentEMA50) {
        trend = "UP";
      } else if (currentEMA20 < currentEMA50) {
        trend = "DOWN";
      }

      // Check for pullback (yellow light)
      // Price comes near EMA20 in an uptrend
      if (trend === "UP" && prevCandle.low <= currentEMA20 && prevCandle.close >= currentEMA20 * 0.998) {
        pullback = true;
      }
      // Price comes near EMA20 in a downtrend
      else if (trend === "DOWN" && prevCandle.high >= currentEMA20 && prevCandle.close <= currentEMA20 * 1.002) {
        pullback = true;
      }

      // Enter on momentum continuation (green light)
      const riskAmount = currentCapital * (riskPercent / 100);

      if (trend === "UP" && pullback && candle.close > prevCandle.high) {
        // Bullish continuation
        const entryPrice = candle.close;
        const sl = Math.min(prevCandle.low, currentEMA50);
        const stopDistance = entryPrice - sl;

        if (stopDistance > 0) {
          const qty = Math.floor(riskAmount / stopDistance);
          if (qty > 0) {
            const targetDistance = stopDistance * targetMultiplier;
            const target = Math.round((entryPrice + targetDistance) * 100) / 100;

            position = {
              side: "LONG",
              entryPrice,
              qty,
              sl: Math.round(sl * 100) / 100,
              target,
              entryBar: i,
              entryTime: candle.datetime,
            };
            pullback = false;
          }
        }
      } else if (trend === "DOWN" && pullback && candle.close < prevCandle.low) {
        // Bearish continuation
        const entryPrice = candle.close;
        const sl = Math.max(prevCandle.high, currentEMA50);
        const stopDistance = sl - entryPrice;

        if (stopDistance > 0) {
          const qty = Math.floor(riskAmount / stopDistance);
          if (qty > 0) {
            const targetDistance = stopDistance * targetMultiplier;
            const target = Math.round((entryPrice - targetDistance) * 100) / 100;

            position = {
              side: "SHORT",
              entryPrice,
              qty,
              sl: Math.round(sl * 100) / 100,
              target,
              entryBar: i,
              entryTime: candle.datetime,
            };
            pullback = false;
          }
        }
      }
    }

    // ── Inside Candle Breakout Strategy ──────────────────────────
    else if (strategy === "INSIDE_CANDLE") {
      // Check if previous candle is Inside Candle of the one before it
      if (isInsideCandle(prev2Candle, prevCandle)) {
        motherCandle = prev2Candle;
        insideCandle = prevCandle;
      }

      if (motherCandle && insideCandle) {
        const riskAmount = currentCapital * (riskPercent / 100);
        const entryPrice = insideCandle.high;
        const sl = insideCandle.low;
        const stopDistance = entryPrice - sl;

        if (stopDistance > 0 && candle.high > insideCandle.high) {
          const qty = Math.floor(riskAmount / stopDistance);
          if (qty > 0) {
            const targetDistance = stopDistance * targetMultiplier;
            const target = Math.round((entryPrice + targetDistance) * 100) / 100;

            position = {
              side: "LONG",
              entryPrice,
              qty,
              sl: Math.round(sl * 100) / 100,
              target,
              entryBar: i,
              entryTime: candle.datetime,
            };
            motherCandle = null;
            insideCandle = null;
          }
        }
      }
    }
  }

  if (position) {
    const lastCandle = candles[candles.length - 1];
    const exitPrice = lastCandle.close;
    const pnl = position.side === "LONG"
      ? (exitPrice - position.entryPrice) * position.qty
      : (position.entryPrice - exitPrice) * position.qty;

    currentCapital += pnl;
    totalTrades++;
    totalPnL += pnl;
    if (pnl > 0) wins++; else losses++;

    trades.push({
      id: totalTrades,
      entryTime: position.entryTime,
      exitTime: lastCandle.datetime,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      qty: position.qty,
      pnl: Math.round(pnl * 100) / 100,
      pnlPercent: Math.round((pnl / (position.entryPrice * position.qty)) * 100 * 100) / 100,
      exitReason: "END_OF_DATA",
      barsHeld: candles.length - position.entryBar,
      capitalAfter: Math.round(currentCapital * 100) / 100,
    });
  }

  const totalReturn = ((currentCapital - capital) / capital) * 100;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / losses : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

  return {
    summary: {
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalPnL: Math.round(totalPnL * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      finalCapital: Math.round(currentCapital * 100) / 100,
      maxConsecutiveLosses,
    },
    trades,
    equityCurve,
  };
}

// ─── API Endpoint: Run Backtest ───────────────────────────────────
router.post("/run", async (req, res) => {
  const {
    symbol = "NSE:NIFTYBANK-INDEX",
    resolution = "5",
    fromDate,
    toDate,
    strategy = "RSI",
    rsiPeriod = 2,
    oversoldThreshold = 10,
    overboughtThreshold = 90,
    emaPeriod = 5,
    capital = 1000000,
    riskPercent = 1,
    slBuffer = 0.005,
    targetMultiplier = 2,
    maxHoldBars = 12,
  } = req.body;

  if (!fromDate || !toDate) {
    return res.status(400).json({ error: "fromDate and toDate are required (YYYY-MM-DD format)" });
  }

  const sessionId = req.headers["x-session-id"];
  if (!sessionId) {
    return res.status(401).json({ error: "FYERS session required for backtesting" });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired FYERS session" });
  }

  try {
    const fromTs = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(toDate).getTime() / 1000) + 86400;

    const rawCandles = await fetchHistoricalData(symbol, resolution, fromTs, toTs, session.accessToken);
    const candles = parseCandles(rawCandles);

    if (candles.length < 20) {
      return res.status(400).json({ error: "Insufficient data for backtest" });
    }

    const result = runBacktest(candles, {
      strategy,
      rsiPeriod,
      oversoldThreshold,
      overboughtThreshold,
      emaPeriod,
      capital,
      riskPercent,
      slBuffer,
      targetMultiplier,
      maxHoldBars,
    });

    res.json({
      success: true,
      symbol,
      resolution,
      strategy,
      fromDate,
      toDate,
      totalCandles: candles.length,
      ...result,
    });
  } catch (error) {
    console.error("Backtest error:", error);
    res.status(500).json({ error: error.message || "Backtest failed" });
  }
});

// ─── API Endpoint: Get raw historical data ────────────────────────
router.post("/data", async (req, res) => {
  const { symbol, resolution, fromDate, toDate } = req.body;

  if (!symbol || !fromDate || !toDate) {
    return res.status(400).json({ error: "symbol, fromDate, and toDate are required" });
  }

  let sessionId = req.headers["x-session-id"];
  let session = sessionId ? getSession(sessionId) : null;
  
  // If no session ID provided or invalid, try to use any active session
  if (!session) {
    const sessions = getAllSessions();
    if (sessions.length > 0) {
      session = sessions[0];
      console.log("Using available session for /backtest/data:", session.userId);
    }
  }

  if (!session) {
    return res.status(401).json({ error: "No active FYERS session. Please connect FYERS at https://roshanvijay.com" });
  }

  try {
    const fromTs = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTs = Math.floor(new Date(toDate).getTime() / 1000) + 86400;

    const rawCandles = await fetchHistoricalData(symbol, resolution, fromTs, toTs, session.accessToken);
    const candles = parseCandles(rawCandles);

    res.json({
      success: true,
      symbol,
      resolution,
      fromDate,
      toDate,
      totalCandles: candles.length,
      candles,
    });
  } catch (error) {
    console.error("Data fetch error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch data" });
  }
});

// ─── API Endpoint: Get available symbols ──────────────────────────
router.get("/symbols", (_req, res) => {
  res.json({
    indices: [
      { symbol: "NSE:NIFTYBANK-INDEX", name: "Bank Nifty" },
      { symbol: "NSE:NIFTY50-INDEX", name: "Nifty 50" },
      { symbol: "NSE:FINNIFTY-INDEX", name: "Fin Nifty" },
      { symbol: "BSE:SENSEX", name: "Sensex" },
    ],
    timeframes: [
      { value: "1", label: "1 Minute" },
      { value: "5", label: "5 Minutes" },
      { value: "15", label: "15 Minutes" },
      { value: "30", label: "30 Minutes" },
      { value: "60", label: "1 Hour" },
      { value: "D", label: "Daily" },
    ],
  });
});

export default router;