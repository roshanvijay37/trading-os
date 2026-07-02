/**
 * Options-workspace UI entry point. The generic atoms (Panel, Stat, Row, Bar, Pill,
 * Button, …) moved to src/components/ui/atoms.tsx so the whole app shares one kit;
 * they are re-exported here so the ~26 panel imports keep working unchanged. Only the
 * badges tied to options-domain types (Provenance, DataStatus) live in this file.
 */

import type { DataStatus, Provenance } from "../types";

export * from "../../components/ui/atoms";

// ---------------------------------------------------------------------------
// Provenance + status
// ---------------------------------------------------------------------------

const PROVENANCE_META: Record<Provenance, { label: string; cls: string }> = {
  BROKER: { label: "Live", cls: "border-gain/30 bg-gain-dim text-gain" },
  COMPUTED: { label: "Computed", cls: "border-info/30 bg-info-dim text-info" },
  PROXY: { label: "Proxy", cls: "border-warn/30 bg-warn-dim text-warn" },
  EOD: { label: "EOD", cls: "border-border bg-surface text-zinc-400" },
  UNAVAILABLE: { label: "No feed", cls: "border-border bg-surface text-zinc-600" },
};

export function ProvenanceBadge({ kind, label }: { kind: Provenance; label?: string }) {
  const m = PROVENANCE_META[kind];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide border ${m.cls}`}>
      {label ?? m.label}
    </span>
  );
}

const STATUS_META: Record<DataStatus, { label: string; cls: string; dot: string }> = {
  disconnected: { label: "Disconnected", cls: "text-warn", dot: "bg-warn" },
  loading: { label: "Loading", cls: "text-zinc-400", dot: "bg-zinc-500 animate-pulse" },
  live: { label: "Live", cls: "text-gain", dot: "bg-gain animate-pulse" },
  stale: { label: "Stale", cls: "text-warn", dot: "bg-warn" },
  closed: { label: "Market closed", cls: "text-zinc-400", dot: "bg-zinc-600" },
  error: { label: "No data", cls: "text-loss", dot: "bg-loss" },
};

export function StatusPill({ status }: { status: DataStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-2xs font-medium ${m.cls}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}
