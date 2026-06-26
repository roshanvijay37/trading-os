import type { DisciplineSummary, Trade } from "../types";

export function calculateDiscipline(trades: Trade[]): DisciplineSummary {
  if (trades.length === 0) {
    return {
      score: 100,
      currentStreak: 0,
      ruleFollowingTrades: 0,
      totalTrades: 0,
    };
  }

  const sorted = [...trades].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ruleFollowingTrades = trades.filter((trade) => trade.followedRules).length;
  let currentStreak = 0;

  for (const trade of sorted) {
    if (!trade.followedRules) break;
    currentStreak += 1;
  }

  return {
    score: Math.round((ruleFollowingTrades / trades.length) * 100),
    currentStreak,
    ruleFollowingTrades,
    totalTrades: trades.length,
  };
}