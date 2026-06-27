import { useCallback, useEffect, useState } from "react";
import { storage } from "../services/storage";
import type { Settings, Trade } from "../types";

const STORAGE_EVENT = "trading-os:storage-updated";

function notifyStorageUpdate(): void {
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

export function useTradingStore() {
  const [settings, setSettingsState] = useState<Settings>(storage.getSettings);
  const [trades, setTrades] = useState<Trade[]>(storage.getTrades);

  const refresh = useCallback(() => {
    setSettingsState(storage.getSettings());
    setTrades(storage.getTrades());
  }, []);

  useEffect(() => {
    window.addEventListener("storage", refresh);
    window.addEventListener(STORAGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(STORAGE_EVENT, refresh);
    };
  }, [refresh]);

  return {
    settings,
    trades,
    saveSettings(next: Settings) {
      storage.saveSettings(next);
      notifyStorageUpdate();
    },
  };
}
