/**
 * Shared presentational atoms for the whole app, matching the dark institutional
 * theme (ink/surface/panel/border + gain/loss/warn/info tokens). Moved verbatim from
 * src/options/components/ui.tsx so the options workspace and the main pages compose
 * the same kit. Options-specific badges (ProvenanceBadge, StatusPill) stay in the
 * options workspace; everything generic lives here.
 */

import { Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Panel / layout
// ---------------------------------------------------------------------------

export function Panel({
  title,
  icon: Icon,
  badge,
  actions,
  children,
  className = "",
  bodyClassName = "",
  noPad,
}: {
  title?: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noPad?: boolean;
}) {
  return (
    <div className={`flex min-h-0 flex-col rounded-panel border border-border bg-panel shadow-panel ${className}`}>
      {(title || actions) && (
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          {Icon && <Icon size={12} className="text-zinc-600" />}
          {title && <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>}
          {badge}
          {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={`${noPad ? "" : "p-3"} min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{children}</h2>;
}

export type Tone = "green" | "rose" | "amber" | "blue" | "zinc";

const TONE_TEXT: Record<Tone, string> = {
  green: "text-gain",
  rose: "text-loss",
  amber: "text-warn",
  blue: "text-info",
  zinc: "text-zinc-100",
};
const TONE_BG: Record<Tone, string> = {
  green: "bg-gain/10",
  rose: "bg-loss/10",
  amber: "bg-warn/10",
  blue: "bg-info/10",
  zinc: "bg-zinc-800",
};

/** Compact metric tile. */
export function Stat({
  label,
  value,
  sub,
  tone = "zinc",
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        {Icon && <Icon size={12} className="text-zinc-600" strokeWidth={1.5} />}
        <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      </div>
      <p className={`font-mono text-lg font-semibold ${TONE_TEXT[tone]}`}>{value}</p>
      {sub != null && <p className="mt-0.5 text-2xs text-zinc-600">{sub}</p>}
    </div>
  );
}

/** Key/value line. */
export function Row({
  label,
  value,
  valueClass = "text-zinc-200",
  mono = true,
}: {
  label: ReactNode;
  value: ReactNode;
  valueClass?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-2xs text-zinc-600">{label}</span>
      <span className={`text-2xs ${mono ? "font-mono" : ""} ${valueClass}`}>{value}</span>
    </div>
  );
}

/** Horizontal proportion bar (OI ladders, distributions, etc.). */
export function Bar({
  value,
  max,
  tone = "blue",
  align = "left",
  className = "",
}: {
  value: number;
  max: number;
  tone?: Tone;
  align?: "left" | "right";
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className={`h-2 w-full overflow-hidden rounded-sm bg-surface ${className}`}>
      <div
        className={`h-full ${TONE_BG[tone].replace("/10", "/60")} ${align === "right" ? "ml-auto" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Pill({ children, tone = "zinc" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${TONE_BG[tone]} ${TONE_TEXT[tone]}`}>
      {children}
    </span>
  );
}

export function Empty({ message, icon: Icon }: { message: string; icon?: LucideIcon }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
      {Icon && <Icon size={20} className="text-zinc-700" />}
      <p className="max-w-xs text-2xs text-zinc-600">{message}</p>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center gap-2 text-2xs text-zinc-500">
      <Loader2 size={14} className="animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}

export function Banner({ tone, children }: { tone: "warn" | "loss" | "info"; children: ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warn/30 bg-warn-dim text-warn"
      : tone === "loss"
        ? "border-loss/30 bg-loss-dim text-loss"
        : "border-info/30 bg-info-dim text-info";
  return <div className={`rounded-panel border px-3 py-2 text-2xs ${cls}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "xs";
}) {
  const pad = size === "xs" ? "px-2 py-0.5" : "px-2.5 py-1";
  return (
    <div className="inline-flex items-center gap-0.5 rounded-panel border border-border-subtle bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded ${pad} text-2xs font-medium transition ${
            value === o.value ? "bg-panel text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({
  value,
  onChange,
  children,
  className = "",
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-panel border border-border-subtle bg-surface px-2.5 py-1 text-2xs text-zinc-200 outline-none focus:border-border-hover ${className}`}
    >
      {children}
    </select>
  );
}

export function NumberField({
  value,
  onChange,
  step = 1,
  min,
  placeholder,
  className = "",
}: {
  value: number | string;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      placeholder={placeholder}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={`w-full rounded-panel border border-border-subtle bg-surface px-2 py-1 text-2xs font-mono text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-border-hover ${className}`}
    />
  );
}

export function Button({
  children,
  onClick,
  tone = "zinc",
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: Tone | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const tones: Record<string, string> = {
    green: "border-gain/30 bg-gain-dim text-gain hover:bg-gain/20",
    rose: "border-loss/30 bg-loss-dim text-loss hover:bg-loss/20",
    amber: "border-warn/30 bg-warn-dim text-warn hover:bg-warn/20",
    blue: "border-info/30 bg-info-dim text-info hover:bg-info/20",
    zinc: "border-border bg-surface text-zinc-300 hover:border-border-hover hover:text-zinc-100",
    ghost: "border-transparent text-zinc-500 hover:bg-surface hover:text-zinc-200",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-panel border px-2.5 py-1 text-2xs font-medium transition disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export { TONE_TEXT, TONE_BG };
