/**
 * Color palette for canvas/SVG charts (lightweight-charts + the hand-rolled SVG panels), which
 * can't pick up CSS custom properties the way Tailwind classes do — they take literal color
 * strings. Kept in sync by role, not value, with the CSS vars in src/styles.css: e.g. `grid` here
 * is the same structural role as `border-subtle`, `text` the same role as zinc-500. Accent colors
 * (gain/loss/warn/info-ish hues) are intentionally identical across themes, same as the Tailwind
 * tokens — only backgrounds/gridlines/axis text/bright reference lines flip.
 */
import type { Theme } from "../store/theme";

export interface ChartPalette {
  background: string;
  /** Default axis/tick text color (chart library "textColor", role = zinc-500). */
  text: string;
  /** Faint axis-label text in hand-rolled SVG charts (role = zinc-600/700). */
  axisLabel: string;
  /** Gridlines / panel borders (role = border-subtle / border). */
  grid: string;
  border: string;
  /** Crosshair / hover guideline (role = border-hover, a bit more visible than grid). */
  crosshair: string;
  /** Bright reference line — e.g. spot price marker (role = zinc-200, high-emphasis). */
  spot: string;
  /** Zero-line / baseline dashed reference (role = zinc-600, mid-emphasis). */
  baseline: string;
}

const DARK: ChartPalette = {
  background: "#08080a",
  text: "#71717a",
  axisLabel: "#3f3f46",
  grid: "#131318",
  border: "#23232a",
  crosshair: "#3e3e48",
  spot: "#e4e4e7",
  baseline: "#52525b",
};

const LIGHT: ChartPalette = {
  background: "#ffffff",
  text: "#71717a",
  axisLabel: "#a1a1aa",
  grid: "#e4e4e7",
  border: "#d4d4d8",
  crosshair: "#a1a1aa",
  spot: "#18181b",
  baseline: "#a1a1aa",
};

export function getChartPalette(theme: Theme): ChartPalette {
  return theme === "light" ? LIGHT : DARK;
}
