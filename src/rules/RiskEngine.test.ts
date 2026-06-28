import { describe, it, expect } from "vitest";
import { RiskEngine } from "./RiskEngine";

const engine = new RiskEngine();

describe("RiskEngine.calculate", () => {
  it("computes risk amount, stop distance, and max quantity", () => {
    const result = engine.calculate(100000, 1, 100, 95);
    expect(result.riskAmount).toBe(1000);
    expect(result.stopDistance).toBe(5);
    expect(result.maxQuantity).toBe(200); // floor(1000 / 5)
  });

  it("floors max quantity (never rounds up risk)", () => {
    // riskAmount 1000, stopDistance 7 -> 142.85 -> 142
    const result = engine.calculate(100000, 1, 100, 93);
    expect(result.maxQuantity).toBe(142);
  });

  it("rejects non-positive capital", () => {
    expect(() => engine.calculate(0, 1, 100, 95)).toThrow(/Capital/);
  });

  it("rejects risk percent above 100", () => {
    expect(() => engine.calculate(100000, 101, 100, 95)).toThrow(/cannot exceed 100/);
  });

  it("rejects zero stop distance (entry === stop)", () => {
    expect(() => engine.calculate(100000, 1, 100, 100)).toThrow(/must be different/);
  });

  it("rejects capital too small for a single unit", () => {
    // riskAmount 0.1, stopDistance 5 -> floor(0.02) = 0
    expect(() => engine.calculate(10, 1, 100, 95)).toThrow(/too low/);
  });
});

describe("RiskEngine.validateQuantity", () => {
  const calc = engine.calculate(100000, 1, 100, 95); // maxQuantity 200

  it("accepts a quantity within the limit", () => {
    expect(() => engine.validateQuantity(150, calc)).not.toThrow();
  });

  it("rejects a quantity above the risk limit", () => {
    expect(() => engine.validateQuantity(201, calc)).toThrow(/exceeds risk limit/);
  });

  it("rejects non-integer or sub-1 quantities", () => {
    expect(() => engine.validateQuantity(0, calc)).toThrow(/positive whole number/);
    expect(() => engine.validateQuantity(1.5, calc)).toThrow(/positive whole number/);
  });
});
