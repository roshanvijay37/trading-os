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
  } = signals;

  let score = 100;
  if (emergencyStop) score -= 50;
  // A dead market-data feed DURING market hours is a real problem; when closed it's expected.
  if (marketOpen && !wsConnected) score -= 30;
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

  const components = [
    { name: "Engine", status: isRunning ? "HEALTHY" : "IDLE" },
    { name: "Broker Feed", status: wsConnected ? "HEALTHY" : marketOpen ? "DOWN" : "IDLE" },
    {
      name: "Risk",
      status: emergencyStop ? "CRITICAL" : consecutiveLosses >= maxConsecutiveLosses ? "WARNING" : "HEALTHY",
    },
  ];

  return { healthScore: score, overallStatus, components, lastUpdated: new Date().toISOString() };
}
