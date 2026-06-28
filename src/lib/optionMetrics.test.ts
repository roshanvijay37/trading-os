import { describe, it, expect } from "vitest";
import {
  normalizeOptionChain,
  extractSpot,
  computePCR,
  computeMaxPain,
  computeExpectedMove,
  type OptionLeg,
} from "./optionMetrics";

describe("normalizeOptionChain / extractSpot", () => {
  const raw = [
    { option_type: "", ltp: 20000 }, // underlying row
    { option_type: "CE", strike_price: 100, oi: 100, ltp: 5 },
    { optionType: "PE", strike: 100, oi: 90, lp: 4 }, // alternate field names
    { option_type: "CE", strike_price: 0, oi: 10 }, // invalid strike -> skipped
  ];

  it("maps CE/PE legs and skips the underlying / invalid rows", () => {
    const legs = normalizeOptionChain(raw);
    expect(legs).toHaveLength(2);
    expect(legs).toContainEqual({ type: "CE", strike: 100, oi: 100, ltp: 5 });
    expect(legs).toContainEqual({ type: "PE", strike: 100, oi: 90, ltp: 4 });
  });

  it("extracts spot from the underlying row", () => {
    expect(extractSpot(raw)).toBe(20000);
    expect(extractSpot([])).toBe(0);
  });
});

describe("computePCR", () => {
  it("is total PE OI / total CE OI", () => {
    const legs: OptionLeg[] = [
      { type: "CE", strike: 100, oi: 100, ltp: 5 },
      { type: "PE", strike: 100, oi: 90, ltp: 4 },
      { type: "PE", strike: 90, oi: 60, ltp: 2 },
    ];
    expect(computePCR(legs)).toBe(1.5); // 150 / 100
  });

  it("returns 0 with no call OI", () => {
    expect(computePCR([{ type: "PE", strike: 100, oi: 50, ltp: 1 }])).toBe(0);
  });
});

describe("computeMaxPain", () => {
  it("finds the strike minimizing holder payout", () => {
    const legs: OptionLeg[] = [
      { type: "CE", strike: 100, oi: 100, ltp: 5 },
      { type: "CE", strike: 110, oi: 50, ltp: 2 },
      { type: "PE", strike: 100, oi: 50, ltp: 4 },
      { type: "PE", strike: 90, oi: 100, ltp: 1 },
    ];
    expect(computeMaxPain(legs)).toBe(100);
  });

  it("returns 0 for an empty chain", () => {
    expect(computeMaxPain([])).toBe(0);
  });
});

describe("computeExpectedMove", () => {
  it("uses the ATM straddle (CE+PE nearest spot)", () => {
    const legs: OptionLeg[] = [
      { type: "CE", strike: 100, oi: 100, ltp: 5 },
      { type: "PE", strike: 100, oi: 90, ltp: 4 },
    ];
    const em = computeExpectedMove(legs, 100);
    expect(em.move).toBe(9);
    expect(em.movePercent).toBe(9);
    expect(em.upper).toBe(109);
    expect(em.lower).toBe(91);
  });

  it("is zero-safe without a spot", () => {
    expect(computeExpectedMove([{ type: "CE", strike: 100, oi: 1, ltp: 5 }], 0)).toEqual({
      move: 0,
      movePercent: 0,
      upper: 0,
      lower: 0,
    });
  });
});
