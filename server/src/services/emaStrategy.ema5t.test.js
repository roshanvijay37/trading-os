import { describe, it, expect } from "vitest";
import { detectAlertCandle } from "./emaStrategy.js";
import { calculateEMA } from "./signalCore.js";

// EMA5T = the user's EMA5 alert + the STRICT trend gate validated in the 2026-07 research:
// EMA20 computed over closes EXCLUDING the latest bar, compared against the ALERT bar's
// close. Everything the gate reads was fully closed before any entry could trigger.
const bar = (c, h = c + 1, l = c - 1, o = c) => [0, o, h, l, c, 0];

function trendingSeries(n, start = 100, step = 1) {
  const candles = [];
  for (let i = 0; i < n; i++) {
    const c = start + i * step;
    candles.push(bar(c));
  }
  return candles;
}

describe("detectAlertCandle EMA5T (strict trend gate)", () => {
  it("fires a bullish alert on a pullback bar fully below EMA5 while above the prior EMA20", () => {
    const candles = trendingSeries(30); // strong uptrend: closes 100..129
    const closes = candles.map((c) => c[4]);
    const ema5 = calculateEMA([...closes, 130.5], 5); // EMA at the would-be latest close
    // Alert candidate: entirely below EMA5 (pullback) but still above the uptrend's EMA20.
    const alertBar = bar(ema5 - 6, ema5 - 5, ema5 - 7);
    const latestBar = bar(130.5, 131, 129.5);
    const series = [...candles, alertBar, latestBar];
    const alert = detectAlertCandle(series, "EMA5T");
    expect(alert).not.toBeNull();
    expect(alert.type).toBe("BULLISH_ALERT");
  });

  it("suppresses the same alert when the alert bar closes on the wrong side of EMA20", () => {
    // Downtrend so EMA20 sits ABOVE price: a bullish pullback alert must be gated out.
    const candles = trendingSeries(30, 200, -1); // closes 200..171
    const closes = candles.map((c) => c[4]);
    const ema5 = calculateEMA([...closes, 170], 5);
    const alertBar = bar(ema5 - 6, ema5 - 5, ema5 - 7); // entirely below EMA5 (bullish shape)
    const latestBar = bar(170, 170.5, 169.5);
    const alert = detectAlertCandle([...candles, alertBar, latestBar], "EMA5T");
    // close is far below the falling EMA20 â†’ BULLISH gated out; and it is not a bearish
    // alert either (bar is below EMA5, not above), so no alert at all.
    expect(alert).toBeNull();
  });

  it("plain EMA5 (no gate) still fires where EMA5T is gated out", () => {
    const candles = trendingSeries(30, 200, -1);
    const closes = candles.map((c) => c[4]);
    const ema5 = calculateEMA([...closes, 170], 5);
    const alertBar = bar(ema5 - 6, ema5 - 5, ema5 - 7);
    const latestBar = bar(170, 170.5, 169.5);
    const alert = detectAlertCandle([...candles, alertBar, latestBar], "EMA5");
    expect(alert).not.toBeNull();
    expect(alert.type).toBe("BULLISH_ALERT");
  });
});
