/**
 * Standard data-state gate for panels that need the live chain. Renders honest
 * disconnected / loading / market-closed / error states, and only calls `children`
 * with a guaranteed-non-null EnrichedChain when data is actually available.
 */

import type { ReactNode } from "react";
import { PlugZap, AlertTriangle } from "lucide-react";
import { useOptionsData } from "../state/OptionsDataProvider";
import { Empty, Banner } from "./ui";
import { SkeletonRows } from "../../components/ui/Skeleton";
import type { EnrichedChain } from "../types";

export function ChainGate({
  children,
  requireRows = true,
  skeleton,
}: {
  children: (chain: EnrichedChain) => ReactNode;
  requireRows?: boolean;
  /** Shape-specific placeholder for the initial load (defaults to generic rows). */
  skeleton?: ReactNode;
}) {
  const { status, chain, error } = useOptionsData();
  const loadingPlaceholder = skeleton ?? <SkeletonRows rows={8} />;

  if (status === "disconnected") {
    return <Empty icon={PlugZap} message="Connect to FYERS to load the live options feed. Nothing is shown while disconnected." />;
  }
  if (status === "loading" && !chain) return <>{loadingPlaceholder}</>;
  if ((status === "error" || (!chain && status !== "loading"))) {
    return <Empty icon={AlertTriangle} message={error || "Option chain unavailable. Retrying automatically."} />;
  }
  if (!chain) return <>{loadingPlaceholder}</>;
  if (requireRows && chain.rows.length === 0) {
    return (
      <div className="space-y-2">
        <Banner tone="warn">
          Connected, but the chain returned no strikes — the market may be closed. Showing nothing rather than stale zeros.
        </Banner>
      </div>
    );
  }
  return (
    <>
      {status === "stale" && (
        <div className="mb-2">
          <Banner tone="warn">Live feed interrupted — showing the last good snapshot. Retrying automatically.</Banner>
        </div>
      )}
      {children(chain)}
    </>
  );
}
