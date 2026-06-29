/**
 * Local persistence for user-owned options data (watchlist, alerts, saved strategies).
 * These are user preferences, not market data, so localStorage is the right home — no
 * fabricated server state. Each accessor is defensive against malformed/old payloads.
 */

import type { OptionAlert, WatchItem } from "../types";

const WATCH_KEY = "options.watchlist.v1";
const ALERT_KEY = "options.alerts.v1";
const STRATEGY_KEY = "options.strategies.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export const watchlistStore = {
  all: (): WatchItem[] => read<WatchItem[]>(WATCH_KEY, []),
  save: (items: WatchItem[]) => write(WATCH_KEY, items),
  add: (item: WatchItem): WatchItem[] => {
    const items = watchlistStore.all().filter((w) => w.id !== item.id);
    items.unshift(item);
    write(WATCH_KEY, items);
    return items;
  },
  remove: (id: string): WatchItem[] => {
    const items = watchlistStore.all().filter((w) => w.id !== id);
    write(WATCH_KEY, items);
    return items;
  },
};

export const alertStore = {
  all: (): OptionAlert[] => read<OptionAlert[]>(ALERT_KEY, []),
  save: (items: OptionAlert[]) => write(ALERT_KEY, items),
  add: (item: OptionAlert): OptionAlert[] => {
    const items = [item, ...alertStore.all()];
    write(ALERT_KEY, items);
    return items;
  },
  update: (id: string, patch: Partial<OptionAlert>): OptionAlert[] => {
    const items = alertStore.all().map((a) => (a.id === id ? { ...a, ...patch } : a));
    write(ALERT_KEY, items);
    return items;
  },
  remove: (id: string): OptionAlert[] => {
    const items = alertStore.all().filter((a) => a.id !== id);
    write(ALERT_KEY, items);
    return items;
  },
};

export interface SavedStrategy {
  id: string;
  name: string;
  instrument: string;
  legs: unknown;
  createdAt: number;
}

export const strategyStore = {
  all: (): SavedStrategy[] => read<SavedStrategy[]>(STRATEGY_KEY, []),
  add: (item: SavedStrategy): SavedStrategy[] => {
    const items = [item, ...strategyStore.all().filter((s) => s.id !== item.id)];
    write(STRATEGY_KEY, items);
    return items;
  },
  remove: (id: string): SavedStrategy[] => {
    const items = strategyStore.all().filter((s) => s.id !== id);
    write(STRATEGY_KEY, items);
    return items;
  },
};
