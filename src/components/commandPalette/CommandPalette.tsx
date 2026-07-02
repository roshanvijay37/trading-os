/**
 * Global Ctrl/Cmd-K command palette — lifted from the Options Workspace and
 * generalized to the whole app (pages + options panels), with group headers.
 * Mounted once in Layout; open it from anywhere via openCommandPalette().
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import {
  buildCommands,
  filterCommands,
  getPaletteOpen,
  setPaletteOpen,
  subscribePalette,
  type Command,
} from "./registry";

export function CommandPalette() {
  const open = useSyncExternalStore(subscribePalette, getPaletteOpen, getPaletteOpen);
  const navigate = useNavigate();
  if (!open) return null;
  return <PaletteDialog navigate={navigate} onClose={() => setPaletteOpen(false)} />;
}

function PaletteDialog({ navigate, onClose }: { navigate: NavigateFunction; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(() => buildCommands(), []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => filterCommands(commands, q), [commands, q]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  const pick = (c: Command) => {
    c.perform({ navigate });
    onClose();
  };

  // Portal to body at z-[95]: above Modal/ConfirmDialog (z-[90], also body portals) so the
  // palette can never open invisibly beneath a modal while stealing its keyboard focus;
  // below the Toaster (z-[100]).
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/60 px-3 pt-[10vh]" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-panel border border-border bg-panel shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
          <Search size={14} className="text-zinc-600" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a page, panel or tool…"
            className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-700"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, results.length - 1));
              else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
              else if (e.key === "Enter" && results[idx]) pick(results[idx]);
              else if (e.key === "Escape") onClose();
            }}
          />
          <span className="rounded bg-surface px-1 text-[9px] text-zinc-600">esc</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {results.length === 0 && <p className="px-3 py-4 text-center text-2xs text-zinc-600">No matches</p>}
          {results.map((c, i) => {
            const Icon = c.icon;
            const headed = i === 0 || results[i - 1].group !== c.group;
            return (
              <div key={c.id}>
                {headed && (
                  <p className="px-2.5 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-wider text-zinc-700">
                    {c.group}
                  </p>
                )}
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => pick(c)}
                  className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2.5 text-left text-2xs transition lg:py-1.5 ${
                    i === idx ? "bg-surface text-zinc-100" : "text-zinc-400"
                  }`}
                >
                  <Icon size={14} className="text-zinc-500" />
                  <span>{c.label}</span>
                  <span className="ml-auto text-[9px] uppercase tracking-wider text-zinc-700">{c.group}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
