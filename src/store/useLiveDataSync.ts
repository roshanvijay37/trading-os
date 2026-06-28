/**
 * Polls the backend auto-trader status and feeds the institutional store with REAL data,
 * so the Command Center and Risk Dashboard show live values instead of static defaults.
 * Mount once (in Layout). No-ops cleanly when the user is not connected to FYERS.
 */
import { useEffect } from "react";
import { useInstitutionalStore } from "./InstitutionalProvider";
import { autoTradeApi, isFyersConnected } from "../services/api";
import { deriveLiveMetrics } from "./liveMetrics";

const SYNC_INTERVAL_MS = 7000;

export function useLiveDataSync() {
  const { setDashboard, setPortfolioRisk } = useInstitutionalStore();

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (!isFyersConnected()) return; // not logged in -> leave defaults, retry next tick
      try {
        const status = await autoTradeApi.getStatus();
        if (cancelled || !status) return;
        const { dashboard, portfolioRisk } = deriveLiveMetrics(status);
        setDashboard(dashboard);
        setPortfolioRisk(portfolioRisk);
      } catch {
        // transient/network errors are ignored; the next tick retries
      }
    }

    tick();
    const id = setInterval(tick, SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setDashboard, setPortfolioRisk]);
}
