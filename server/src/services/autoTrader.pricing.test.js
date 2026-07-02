import { describe, it, expect } from "vitest";
import { roundToTick, OPTION_TICK } from "./autoTrader.js";

// roundToTick snaps every computed order price onto the ₹0.05 tick grid. FYERS rejects off-tick
// prices, and a rejected stop-loss order would leave a naked position — so this must always return a
// clean multiple of 0.05. dir: "up" for a marketable BUY limit, "down" for a protective stop, "near"
// for targets.
describe("roundToTick (₹0.05 tick-grid safety)", () => {
  const isOnGrid = (p) => Math.round((p / OPTION_TICK) * 1e6) % 1e6 === 0;

  it("rounds to the nearest tick by default", () => {
    expect(roundToTick(101.36)).toBe(101.35);
    expect(roundToTick(101.38)).toBe(101.4);
    expect(roundToTick(0.07)).toBe(0.05);
  });

  it("rounds a buy limit UP so it stays marketable and valid", () => {
    expect(roundToTick(101.36, "up")).toBe(101.4);
    expect(roundToTick(101.31, "up")).toBe(101.35);
  });

  it("rounds a protective stop DOWN (valid, never tighter than intended)", () => {
    expect(roundToTick(101.39, "down")).toBe(101.35);
    expect(roundToTick(0.09, "down")).toBe(0.05);
  });

  it("leaves an already-on-grid price unchanged in every direction", () => {
    for (const dir of ["up", "down", "near"]) {
      expect(roundToTick(100.0, dir)).toBe(100.0);
      expect(roundToTick(101.35, dir)).toBe(101.35);
      expect(roundToTick(0.05, dir)).toBe(0.05);
    }
  });

  it("always returns a clean multiple of the tick", () => {
    for (const raw of [0.06, 0.13, 12.34, 87.77, 101.36, 249.99, 1000.03]) {
      for (const dir of ["up", "down", "near"]) {
        expect(isOnGrid(roundToTick(raw, dir))).toBe(true);
      }
    }
  });

  it("guards non-positive / garbage input", () => {
    expect(roundToTick(0)).toBe(0);
    expect(roundToTick(-5)).toBe(0);
    expect(roundToTick(undefined)).toBe(0);
    expect(roundToTick(NaN)).toBe(0);
  });
});
