/**
 * App-wide toast notifications. Module-level observer store + one <Toaster/> mounted
 * in Layout — no Context, so non-component code (API error paths, alert evaluators,
 * promise chains) can call toast.error(...) directly, mirroring the CustomEvent-bus
 * philosophy of src/options/lib/events.ts.
 *
 * Rules of use: fire only on user-initiated actions and edge transitions (e.g. alert
 * untriggered → triggered). Never toast from polling loops — live data states already
 * have StatusPill / ChainGate / Banner. Pass a stable `id` where a repeat should
 * replace instead of stack.
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";

export type ToastKind = "success" | "error" | "warn" | "info";

export interface ToastOptions {
  /** Stable id: a toast with the same id is replaced (timer reset) instead of stacked. */
  id?: string;
  title?: string;
  /** Auto-dismiss delay in ms. Defaults: error 8000, others 4000. Pass 0 to keep until dismissed. */
  duration?: number;
}

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: ReactNode;
  title?: string;
  duration: number;
}

const MAX_TOASTS = 4;

let toasts: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): ToastItem[] {
  return toasts;
}

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t != null) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function scheduleDismiss(id: string, duration: number) {
  clearTimer(id);
  if (duration <= 0 || !Number.isFinite(duration)) return;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      dismiss(id);
    }, duration),
  );
}

function push(kind: ToastKind, message: ReactNode, opts?: ToastOptions): string {
  const id = opts?.id ?? `toast-${++seq}`;
  const duration = opts?.duration ?? (kind === "error" ? 8000 : 4000);
  const item: ToastItem = { id, kind, message, title: opts?.title, duration };
  const existing = toasts.findIndex((t) => t.id === id);
  if (existing >= 0) {
    toasts = toasts.map((t, i) => (i === existing ? item : t));
  } else {
    toasts = [...toasts, item];
    while (toasts.length > MAX_TOASTS) {
      clearTimer(toasts[0].id);
      toasts = toasts.slice(1);
    }
  }
  scheduleDismiss(id, duration);
  emit();
  return id;
}

function dismiss(id: string) {
  clearTimer(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function dismissAll() {
  for (const t of toasts) clearTimer(t.id);
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}

export const toast = {
  success: (message: ReactNode, opts?: ToastOptions) => push("success", message, opts),
  error: (message: ReactNode, opts?: ToastOptions) => push("error", message, opts),
  warn: (message: ReactNode, opts?: ToastOptions) => push("warn", message, opts),
  info: (message: ReactNode, opts?: ToastOptions) => push("info", message, opts),
  dismiss,
  dismissAll,
};

function pauseAllTimers() {
  for (const t of toasts) clearTimer(t.id);
}

function resumeAllTimers() {
  for (const t of toasts) scheduleDismiss(t.id, t.duration);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const KIND_META: Record<ToastKind, { icon: LucideIcon; cls: string; iconCls: string }> = {
  success: { icon: CheckCircle2, cls: "border-gain/30 bg-gain-dim text-gain", iconCls: "text-gain" },
  error: { icon: XCircle, cls: "border-loss/30 bg-loss-dim text-loss", iconCls: "text-loss" },
  warn: { icon: AlertTriangle, cls: "border-warn/30 bg-warn-dim text-warn", iconCls: "text-warn" },
  info: { icon: Info, cls: "border-info/30 bg-info-dim text-info", iconCls: "text-info" },
};

function ToastCard({ item }: { item: ToastItem }) {
  const meta = KIND_META[item.kind];
  const IconCmp = meta.icon;
  return (
    <div className="pointer-events-auto animate-toast-in overflow-hidden rounded-panel border border-border bg-panel shadow-panel">
      {/* -dim tones are 10% alpha, so they sit on an opaque bg-panel to stay readable over content */}
      <div className={`flex items-start gap-2 rounded-panel border px-3 py-2 ${meta.cls}`}>
        <IconCmp size={14} className={`mt-px shrink-0 ${meta.iconCls}`} />
        <div className="min-w-0 flex-1">
          {item.title && <p className="text-2xs font-semibold">{item.title}</p>}
          <div className="break-words text-2xs">{item.message}</div>
        </div>
        <button
          onClick={() => dismiss(item.id)}
          aria-label="Dismiss notification"
          className="shrink-0 rounded p-0.5 text-zinc-500 transition hover:text-zinc-200"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

/** Mount once (Layout). Bottom-right stack, max 4, pause-on-hover. */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (items.length === 0) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      onMouseEnter={pauseAllTimers}
      onMouseLeave={resumeAllTimers}
    >
      {items.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>,
    document.body,
  );
}
