/** Page-level underline tabs (replaces the ad-hoc per-page tab markup). */

import type { LucideIcon } from "lucide-react";

export function Tabs({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: { id: string; label: string; icon?: LucideIcon }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex items-center gap-1 border-b border-border ${className}`}>
      {tabs.map((t) => {
        const active = t.id === value;
        const IconCmp = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b px-3 py-2 text-2xs font-medium transition ${
              active ? "border-info text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {IconCmp && <IconCmp size={12} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
