import type { Trade } from "../types";

const KEYS = {
  trades: "trading-os:trades",
} as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota exceeded or private-mode storage disabled — don't let a persistence failure
    // crash the caller (e.g. saving settings/trades).
    console.error(`[storage] Failed to write ${key}:`, err);
  }
}

export const storage = {
  getTrades(): Trade[] {
    return readJson<Trade[]>(KEYS.trades, []);
  },

  saveTrades(trades: Trade[]): void {
    writeJson(KEYS.trades, trades);
  },
};
