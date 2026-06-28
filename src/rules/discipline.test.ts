import { describe, it, expect } from "vitest";
import { calculateDiscipline } from "./discipline";
import type { Trade } from "../types";

// calculateDiscipline only reads `createdAt` and `followedRules`; build minimal trades.
function trade(createdAt: string, followedRules: boolean): Trade {
  return { createdAt, followedRules } as unknown as Trade;
}

describe("calculateDiscipline", () => {
  it("returns a perfect, empty summary for no trades", () => {
    expect(calculateDiscipline([])).toEqual({
      score: 100,
      currentStreak: 0,
      ruleFollowingTrades: 0,
      totalTrades: 0,
    });
  });

  it("scores the percentage of rule-following trades", () => {
    const trades = [
      trade("2026-01-01", true),
      trade("2026-01-02", true),
      trade("2026-01-03", false),
    ];
    const summary = calculateDiscipline(trades);
    expect(summary.ruleFollowingTrades).toBe(2);
    expect(summary.totalTrades).toBe(3);
    expect(summary.score).toBe(67); // round(2/3 * 100)
  });

  it("counts the current streak from the most recent trade backwards", () => {
    // Most recent (by createdAt) is the loss -> streak breaks immediately.
    const broken = calculateDiscipline([
      trade("2026-01-01", true),
      trade("2026-01-02", true),
      trade("2026-01-03", false),
    ]);
    expect(broken.currentStreak).toBe(0);

    // All rule-following -> streak equals count.
    const clean = calculateDiscipline([
      trade("2026-01-01", true),
      trade("2026-01-02", true),
    ]);
    expect(clean.currentStreak).toBe(2);
    expect(clean.score).toBe(100);
  });
});
