import { useCallback, useEffect, useState } from "react";
import { storage } from "../services/storage";
import type { Trade } from "../types";

export function useTradingStore() {
  const [trades, setTrades] = useState<Trade[]>(storage.getTrades);

  const refresh = useCallback(() => {
    setTrades(storage.getTrades());
  }, []);

  // Native "storage" event only — fires on a change from another tab/window.
  useEffect(() => {
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [refresh]);

  return { trades };
}
