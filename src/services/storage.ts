import type { Settings, Trade } from "../types";
import { toLocalDateKey } from "../utils/date";

const KEYS = {
  settings: "trading-os:settings",
  trades: "trading-os:trades",
  constitution: "trading-os:constitution",
} as const;

export const DEFAULT_SETTINGS: Settings = {
  capital: 100_000,
  riskPercent: 1,
  dailyLossLimitPercent: 2,
  maxTradesPerDay: 1,
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

  addTrade(trade: Trade): void {
    this.saveTrades([trade, ...this.getTrades()]);
  },

  updateTrade(trade: Trade): void {
    this.saveTrades(
      this.getTrades().map((current) => (current.id === trade.id ? trade : current)),
    );
  },

  getTradesForDate(date = toLocalDateKey()): Trade[] {
    return this.getTrades().filter((trade) => trade.date === date);
  },

  hasAcceptedConstitution(date = toLocalDateKey()): boolean {
    return readJson<string | null>(KEYS.constitution, null) === date;
  },

  acceptConstitution(date = toLocalDateKey()): void {
    writeJson(KEYS.constitution, date);
  },
};
