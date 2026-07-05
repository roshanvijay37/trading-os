import { describe, it, expect } from "vitest";
import { getChartPalette } from "./chartTheme";

describe("getChartPalette", () => {
  it("returns a light background for light theme and a dark background for dark theme", () => {
    expect(getChartPalette("light").background).toBe("#ffffff");
    expect(getChartPalette("dark").background).toBe("#08080a");
  });

  it("returns a complete palette (no missing fields) for both themes", () => {
    const keys: (keyof ReturnType<typeof getChartPalette>)[] = ["background", "text", "axisLabel", "grid", "border", "crosshair", "spot", "baseline"];
    for (const theme of ["dark", "light"] as const) {
      const palette = getChartPalette(theme);
      for (const key of keys) {
        expect(palette[key]).toBeTruthy();
      }
    }
  });
});
