/**
 * Global dark/light theme switch. A plain module-level store (not React Context) since the
 * value is read outside components too (chart color palettes in src/lib/chartTheme.ts) — any
 * component that needs to react to a change calls useTheme(), which subscribes via
 * useSyncExternalStore. The actual color values live in CSS custom properties (src/styles.css),
 * flipped wholesale by the data-theme attribute this module sets on <html>.
 */
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "trading-os-theme";
const listeners = new Set<() => void>();

function readStored(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

let current: Theme = readStored();

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing / disabled storage — theme still applies for this page load.
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#09090b");
}

apply(current);

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme) {
  if (theme === current) return;
  current = theme;
  apply(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(current === "dark" ? "light" : "dark");
}

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
