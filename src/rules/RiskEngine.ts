import type { RiskCalculation } from "../types";

export class RiskEngine {
  calculate(
    capital: number,
    riskPercent: number,
    entryPrice: number,
    stopLossPrice: number,
  ): RiskCalculation {
    this.assertPositive("Capital", capital);
    this.assertPositive("Risk percent", riskPercent);
    this.assertPositive("Entry price", entryPrice);
    this.assertPositive("Stop-loss price", stopLossPrice);

    if (riskPercent > 100) {
      throw new Error("Risk percent cannot exceed 100%.");
    }

    const stopDistance = Math.abs(entryPrice - stopLossPrice);
    if (stopDistance === 0) {
      throw new Error("Entry and stop-loss prices must be different.");
    }

    const riskAmount = capital * (riskPercent / 100);
    const maxQuantity = Math.floor(riskAmount / stopDistance);

    if (maxQuantity < 1) {
      throw new Error("Capital is too low for one unit at this stop distance.");
    }

    return { riskAmount, stopDistance, maxQuantity };
  }

  validateQuantity(quantity: number, calculation: RiskCalculation): void {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Quantity must be a positive whole number.");
    }

    if (quantity > calculation.maxQuantity) {
      throw new Error(
        `Quantity exceeds risk limit. Maximum allowed is ${calculation.maxQuantity}.`,
      );
    }
  }

  private assertPositive(label: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} must be greater than zero.`);
    }
  }
}
