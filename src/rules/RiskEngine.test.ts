import { describe, expect, it } from "vitest";
import { RiskEngine } from "./RiskEngine";

describe("RiskEngine", () => {
  const engine = new RiskEngine();

  it("calculates the risk budget and maximum quantity", () => {
    expect(engine.calculate(100_000, 1, 250, 245)).toEqual({
      riskAmount: 1_000,
      stopDistance: 5,
      maxQuantity: 200,
    });
  });

  it("supports short trades by using absolute stop distance", () => {
    expect(engine.calculate(100_000, 1, 250, 255).maxQuantity).toBe(200);
  });

  it("rejects a quantity above the risk limit", () => {
    const calculation = engine.calculate(100_000, 1, 250, 245);
    expect(() => engine.validateQuantity(201, calculation)).toThrow(
      "Quantity exceeds risk limit",
    );
  });

  it("rejects an invalid stop", () => {
    expect(() => engine.calculate(100_000, 1, 250, 250)).toThrow(
      "Entry and stop-loss prices must be different",
    );
  });
});
