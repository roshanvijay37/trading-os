import { describe, it, expect } from "vitest";
import { bsGamma, computeGammaExposure, nearestExpiryYears } from "./gamma";
import type { OptionLeg } from "./optionMetrics";

describe("bsGamma", () => {
  it("matches the closed-form ATM gamma", () => {
    // spot=K=100, sigma=0.2, t=1, r=0 -> d1=0.1, pdf(0.1)/20 ≈ 0.019848
    expect(bsGamma(100, 100, 0.2, 1, 0)).toBeCloseTo(0.019848, 5);
  });

  it("is highest near ATM and decays far OTM/ITM", () => {
    const atm = bsGamma(100, 100, 0.2, 1, 0);
    const otm = bsGamma(100, 200, 0.2, 1, 0);
    expect(atm).toBeGreaterThan(otm);
    expect(otm).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 for degenerate inputs", () => {
    expect(bsGamma(0, 100, 0.2, 1)).toBe(0);
    expect(bsGamma(100, 100, 0, 1)).toBe(0);
    expect(bsGamma(100, 100, 0.2, 0)).toBe(0);
  });
});

describe("computeGammaExposure", () => {
  const legs: OptionLeg[] = [
    { type: "CE", strike: 24000, oi: 1000, ltp: 120 },
    { type: "PE", strike: 24000, oi: 1000, ltp: 110 },
    { type: "CE", strike: 24500, oi: 800, ltp: 40 },
    { type: "PE", strike: 23500, oi: 800, ltp: 35 },
  ];

  it("returns null when IV / expiry / spot are missing", () => {
    expect(computeGammaExposure(legs, 24000, 0, 0.02)).toBeNull();
    expect(computeGammaExposure(legs, 0, 0.13, 0.02)).toBeNull();
    expect(computeGammaExposure([], 24000, 0.13, 0.02)).toBeNull();
  });

  it("sign follows the call/put convention (all calls > 0, all puts < 0)", () => {
    const calls = legs.filter((l) => l.type === "CE");
    const puts = legs.filter((l) => l.type === "PE");
    expect(computeGammaExposure(calls, 24000, 0.13, 0.02)!.totalGamma).toBeGreaterThan(0);
    expect(computeGammaExposure(puts, 24000, 0.13, 0.02)!.totalGamma).toBeLessThan(0);
  });

  it("produces a full result shape for a balanced chain", () => {
    const gex = computeGammaExposure(legs, 24000, 0.13, 0.02)!;
    expect(gex).not.toBeNull();
    expect(gex.gammaByStrike).toHaveLength(3); // 23500 / 24000 / 24500
    expect(Number.isFinite(gex.totalGamma)).toBe(true);
    expect(Number.isInteger(gex.estimatedHedgeDelta)).toBe(true);
  });
});

describe("nearestExpiryYears", () => {
  const now = 1_700_000_000_000; // fixed ms epoch

  it("parses epoch-second strings and returns the soonest future expiry", () => {
    const sevenDays = now / 1000 + 7 * 24 * 3600;
    const data = [
      { date: "past", expiry: String(now / 1000 - 3600) }, // already expired -> ignored
      { date: "next", expiry: String(sevenDays) },
      { date: "far", expiry: String(now / 1000 + 30 * 24 * 3600) },
    ];
    expect(nearestExpiryYears(data, now)).toBeCloseTo(7 / 365, 4);
  });

  it("returns 0 when nothing is parseable / all in the past", () => {
    expect(nearestExpiryYears([], now)).toBe(0);
    expect(nearestExpiryYears([{ expiry: String(now / 1000 - 100) }], now)).toBe(0);
    expect(nearestExpiryYears(null, now)).toBe(0);
  });
});
