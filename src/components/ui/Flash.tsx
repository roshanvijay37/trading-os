/**
 * Flash-on-change highlight for live numeric values. Fire-and-forget CSS animation
 * (keyframes flash-up/down/neutral in tailwind.config.js) — no timers or state
 * cleanup, so it is safe on large polled tables (e.g. 50-row option chains).
 * The span is keyed by a change counter: remounting is what reliably restarts a CSS
 * animation (re-applying the same class does not).
 */

import { useRef, type ReactNode } from "react";

type FlashDirection = "up" | "down" | "neutral";

const DIRECTION_CLASS: Record<FlashDirection, string> = {
  up: "animate-flash-up",
  down: "animate-flash-down",
  neutral: "animate-flash-neutral",
};

export function useFlashOnChange(value: unknown): { flashClass: string; flashKey: number } {
  const prev = useRef<unknown>(value);
  const state = useRef<{ key: number; dir: FlashDirection | null }>({ key: 0, dir: null });
  if (!Object.is(prev.current, value)) {
    const dir: FlashDirection =
      typeof value === "number" &&
      typeof prev.current === "number" &&
      Number.isFinite(value) &&
      Number.isFinite(prev.current)
        ? value > prev.current
          ? "up"
          : "down"
        : "neutral";
    prev.current = value;
    state.current = { key: state.current.key + 1, dir };
  }
  const dir = state.current.dir;
  return { flashClass: dir === null ? "" : DIRECTION_CLASS[dir], flashKey: state.current.key };
}

/**
 * One-line adoption: `<Flash value={row.ltp}>{dec(row.ltp, 2)}</Flash>`.
 * `value` is watched for changes (numeric → direction-aware green/red flash);
 * children are what renders (defaults to String(value)).
 */
export function Flash({
  value,
  className = "",
  children,
}: {
  value: number | string | null | undefined;
  className?: string;
  children?: ReactNode;
}) {
  const { flashClass, flashKey } = useFlashOnChange(value);
  return (
    <span key={flashKey} className={`rounded-sm ${flashClass} ${className}`}>
      {children ?? (value == null ? "—" : String(value))}
    </span>
  );
}
