/**
 * Composite operational health from REAL engine / feed / risk signals. Pure (the caller
 * supplies the signals), so it is unit-testable and the same logic feeds the UI health score.
 */
export function computeHealthSnapshot(signals = {}) {
  const {
    isRunning = false,
    wsConnected = false,
    emergencyStop = false,
    consecutiveLosses = 0,
    maxConsecutiveLosses = 3,
    marketOpen = false,
    // True if any actively-traded underlying/timeframe's feed is currently stale
    // (isCandleStale/isTickStale in autoTrader.js) — a "connected" socket that stopped
    // delivering fresh ticks/candles is otherwise indistinguishable from a healthy one here.
    feedStale = false,
  } = signals;

  let score = 100;
  if (emergencyStop) score -= 50;
  // A dead market-data feed DURING market hours is a real problem; when closed it's expected.
  if (marketOpen && !wsConnected) score -= 30;
  // A stale-but-connected feed is a lesser degradation than a dropped connection — only
  // penalize it when the connection itself is otherwise fine (avoid double-counting on top
  // of the DOWN penalty above).
  else if (marketOpen && wsConnected && feedStale) score -= 15;
  const lossRatio = maxConsecutiveLosses > 0 ? Math.min(consecutiveLosses / maxConsecutiveLosses, 1) : 0;
  score -= Math.round(lossRatio * 20);
  score = Math.max(0, Math.min(100, score));

  const overallStatus = emergencyStop
    ? "CRITICAL"
    : score >= 80
      ? "HEALTHY"
      : score >= 50
        ? "WARNING"
        : "CRITICAL";

  const brokerFeedStatus = !wsConnected
    ? (marketOpen ? "DOWN" : "IDLE")
    : (marketOpen && feedStale ? "STALE" : "HEALTHY");

  const components = [
    { name: "Engine", status: isRunning ? "HEALTHY" : "IDLE" },
    { name: "Broker Feed", status: brokerFeedStatus },
    {
      name: "Risk",
      status: emergencyStop ? "CRITICAL" : consecutiveLosses >= maxConsecutiveLosses ? "WARNING" : "HEALTHY",
    },
  ];

  return { healthScore: score, overallStatus, components, lastUpdated: new Date().toISOString() };
}
