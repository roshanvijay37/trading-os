import type { Settings, Trade } from "../types";

const KEYS = {
  settings: "trading-os:settings",
  trades: "trading-os:trades",
} as const;

export const DEFAULT_SETTINGS: Settings = {
  capital: 100_000,
  riskPercent: 1,
  dailyLossLimitPercent: 2,
  maxTradesPerDay: 10,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export const storage = {
  getSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(KEYS.settings, {}) };
  },

  saveSettings(settings: Settings): void {
    writeJson(KEYS.settings, settings);
  },

  getTrades(): Trade[] {
    return readJson<Trade[]>(KEYS.trades, []);
  },

  saveTrades(trades: Trade[]): void {
    writeJson(KEYS.trades, trades);
  },
};
