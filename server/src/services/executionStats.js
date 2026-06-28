/**
 * Execution-quality (TCA) metrics derived from the auto-trader audit log.
 *
 * Pure: takes the audit array, returns aggregate stats. No I/O, so it is unit-testable
 * and can be called on every status poll.
 *
 * Sources in the audit log:
 *  - ORDER_PLACED / PAPER_ORDER  -> order count + placed timestamp (for latency)
 *  - ORDER_FILLED / PAPER_FILL   -> fill count + filled timestamp (for latency)
 *  - ORDER_REJECTED / ORDER_CANCELLED / ENTRY_FAILED -> rejection count
 *  - POSITION_OPENED { avgFillPrice, entryLimitPrice } -> entry slippage vs the limit
 */

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toMs(ts) {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function computeExecutionStats(auditLog = []) {
  const log = Array.isArray(auditLog) ? auditLog : [];

  const placedAt = new Map(); // orderId -> placed time (ms)
  const filledAt = new Map(); // orderId -> filled time (ms)
  let totalOrders = 0;
  let filledOrders = 0;
  let rejectedOrders = 0;
  const slippagePcts = [];

  for (const e of log) {
    if (!e || !e.type) continue;
    const tMs = toMs(e.timestamp);
    switch (e.type) {
      case "ORDER_PLACED":
      case "PAPER_ORDER":
        totalOrders++;
        if (e.orderId && tMs != null) placedAt.set(e.orderId, tMs);
        break;
      case "ORDER_FILLED":
      case "PAPER_FILL":
        filledOrders++;
        if (e.orderId && tMs != null) filledAt.set(e.orderId, tMs);
        break;
      case "ORDER_REJECTED":
      case "ORDER_CANCELLED":
      case "ENTRY_FAILED":
        rejectedOrders++;
        break;
      case "POSITION_OPENED": {
        const fill = Number(e.avgFillPrice);
        const limit = Number(e.entryLimitPrice);
        if (Number.isFinite(fill) && Number.isFinite(limit) && limit > 0) {
          // Positive = paid worse than the limit; negative = filled better than the limit.
          slippagePcts.push(((fill - limit) / limit) * 100);
        }
        break;
      }
      default:
        break;
    }
  }

  const latencies = [];
  for (const [orderId, fAt] of filledAt) {
    const pAt = placedAt.get(orderId);
    if (pAt != null && fAt >= pAt) latencies.push(fAt - pAt);
  }

  const avgSlippagePct = round2(avg(slippagePcts));
  const avgExecutionLatencyMs = Math.round(avg(latencies));
  const fillRate = totalOrders > 0 ? round2((filledOrders / totalOrders) * 100) : 0;
  const rejectionRate = totalOrders > 0 ? round2((rejectedOrders / totalOrders) * 100) : 0;

  let executionScore = 100;
  executionScore -= rejectionRate * 0.5; // each 1% rejection -> -0.5
  executionScore -= Math.max(0, avgSlippagePct) * 5; // each 1% adverse slippage -> -5
  if (avgExecutionLatencyMs > 3000) executionScore -= 10;
  executionScore = Math.round(Math.max(0, Math.min(100, executionScore)));

  return {
    totalOrders,
    filledOrders,
    rejectedOrders,
    avgSlippagePct,
    avgExecutionLatencyMs,
    fillRate,
    rejectionRate,
    executionScore,
  };
}
