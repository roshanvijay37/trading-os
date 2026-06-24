import { describe, expect, it } from "vitest";
import { EmotionEngine } from "./EmotionEngine";

describe("EmotionEngine", () => {
  const engine = new EmotionEngine();

  it("allows a calm trade", () => {
    expect(
      engine.evaluate({
        greedScore: 3,
        recoveringLosses: false,
        missedPreviousMove: false,
        increasingLotSize: false,
      }).status,
    ).toBe("SAFE");
  });

  it("requires cooldown for FOMO", () => {
    expect(
      engine.evaluate({
        greedScore: 3,
        recoveringLosses: false,
        missedPreviousMove: true,
        increasingLotSize: false,
      }).status,
    ).toBe("COOLDOWN");
  });

  it("denies revenge trading", () => {
    expect(
      engine.evaluate({
        greedScore: 3,
        recoveringLosses: true,
        missedPreviousMove: false,
        increasingLotSize: false,
      }).status,
    ).toBe("TRADE_DENIED");
  });
});
