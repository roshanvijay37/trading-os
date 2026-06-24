import type { Settings, Trade, ValidationResult } from "../types";
import { toLocalDateKey } from "../utils/date";

export class TradeRules {
  validate(
    candidate: Pick<Trade, "quantity" | "entryPrice" | "stopLossPrice">,
    existingTrades: Trade[],
    settings: Settings,
    maxQuantity: number,
    date = toLocalDateKey(),
  ): ValidationResult {
    const errors: string[] = [];
    const todayTrades = existingTrades.filter((trade) => trade.date === date);
    const todayLoss = todayTrades.reduce(
      (total, trade) => total + Math.min(trade.pnl, 0),
      0,
    );
    const dailyLossLimit = settings.capital * (settings.dailyLossLimitPercent / 100);

    if (todayTrades.length >= settings.maxTradesPerDay) {
      errors.push("The daily trade limit has already been reached.");
    }
    if (Math.abs(todayLoss) >= dailyLossLimit) {
      errors.push("The daily loss limit has been reached.");
    }
    if (candidate.quantity > maxQuantity) {
      errors.push(`Quantity exceeds the risk limit of ${maxQuantity}.`);
    }
    if (candidate.entryPrice === candidate.stopLossPrice) {
      errors.push("Entry and stop-loss prices must be different.");
    }

    return { valid: errors.length === 0, errors };
  }
}
