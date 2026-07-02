/**
 * Bordered status badge — the ProvenanceBadge/Banner recipe (border-{t}/30 +
 * translucent bg + toned text) generalized to the shared Tone vocabulary.
 * Use for statuses; use Pill for softer category tags.
 */

import type { ReactNode } from "react";
import type { Tone } from "./atoms";

const BADGE_TONE: Record<Tone, string> = {
  green: "border-gain/30 bg-gain-dim text-gain",
  rose: "border-loss/30 bg-loss-dim text-loss",
  amber: "border-warn/30 bg-warn-dim text-warn",
  blue: "border-info/30 bg-info-dim text-info",
  zinc: "border-border bg-surface text-zinc-400",
};

export function Badge({ tone = "zinc", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}
