/**
 * Loading placeholders for initial data fetches. Use only for the first load of a
 * view (spinner-or-nothing gaps); subsequent polls should keep stale data on screen.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface ${className}`} aria-hidden="true" />;
}

const ROW_WIDTHS = ["w-full", "w-11/12", "w-full", "w-9/12", "w-10/12", "w-full"];

/** Generic table/list placeholder. */
export function SkeletonRows({ rows = 6, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 p-1 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${ROW_WIDTHS[i % ROW_WIDTHS.length]}`} />
      ))}
    </div>
  );
}

/** Placeholder matching the Stat metric tile. */
export function SkeletonStat() {
  return (
    <div className="rounded-panel border border-border bg-panel p-3" aria-hidden="true">
      <Skeleton className="mb-2 h-3 w-16" />
      <Skeleton className="h-6 w-24" />
    </div>
  );
}
