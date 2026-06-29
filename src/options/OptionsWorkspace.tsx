/**
 * The Options Terminal shell. Desktop: a dense, keyboard-driven workspace with a left panel
 * rail. Mobile: a stacked, touch-first layout — a compact two-row toolbar, a horizontally
 * scrollable panel chip-strip, and the active panel filling the rest of the screen. A Ctrl-K
 * command palette ("search everywhere") works on both.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, Command, ChevronDown } from "lucide-react";
import { useOptionsData } from "./state/OptionsDataProvider";
import { PANELS, PANEL_GROUPS, type PanelDef } from "./panels/registry";
import { StatusPill, Button } from "./components/ui";
import { dec, fmtTime } from "./lib/format";
import type { InstrumentId } from "./types";

export function OptionsWorkspace() {
  const data = useOptionsData();
  const [activeId, setActiveId] = useState<string>("summary");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const active = PANELS.find((p) => p.id === activeId) ?? PANELS[0];

  // Global keyboard shortcuts (desktop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing) return;
      if (e.key === "[") data.setInstrumentId("NIFTY");
      else if (e.key === "]") data.setInstrumentId("BANKNIFTY");
      else if (e.key.toLowerCase() === "r") data.refresh();
      else if (e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (PANELS[idx]) setActiveId(PANELS[idx].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data]);

  const ActiveComponent = active.Component;

  return (
    <div className="flex h-[calc(100dvh-5rem)] min-h-[440px] flex-col gap-2 lg:h-[calc(100vh-7.5rem)] lg:min-h-[560px]">
      <Toolbar onOpenPalette={() => setPaletteOpen(true)} />

      {/* Mobile: panel chip-strip (above content). Desktop: hidden (left rail used instead). */}
      <MobilePanelNav activeId={activeId} onChange={setActiveId} />

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        {/* Desktop panel rail */}
        <nav className="hidden w-44 shrink-0 flex-col gap-3 overflow-y-auto rounded-panel border border-border bg-panel p-2 lg:flex">
          {PANEL_GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-zinc-700">{group}</p>
              <div className="space-y-0.5">
                {PANELS.filter((p) => p.group === group).map((p) => (
                  <RailItem key={p.id} panel={p} active={p.id === activeId} onClick={() => setActiveId(p.id)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Active panel surface */}
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ActiveComponent />
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onPick={(id) => {
            setActiveId(id);
            setPaletteOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RailItem({ panel, active, onClick }: { panel: PanelDef; active: boolean; onClick: () => void }) {
  const Icon = panel.icon;
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-2xs font-medium transition ${
        active ? "bg-surface text-zinc-100" : "text-zinc-500 hover:bg-surface hover:text-zinc-300"
      }`}
    >
      <Icon size={13} strokeWidth={active ? 2.4 : 1.6} />
      <span className="truncate">{panel.label}</span>
    </button>
  );
}

/** Touch-first horizontal chip nav for phones/tablets. Active chip auto-centers. */
function MobilePanelNav({ activeId, onChange }: { activeId: string; onChange: (id: string) => void }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [activeId]);

  return (
    <div className="lg:hidden">
      <div className="no-scrollbar touch-scroll -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5">
        {PANELS.map((p) => {
          const Icon = p.icon;
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onChange(p.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-panel border px-3 py-2 text-2xs font-medium transition ${
                isActive
                  ? "border-info/40 bg-info-dim text-info"
                  : "border-border-subtle bg-surface text-zinc-400 active:bg-panel-hover"
              }`}
            >
              <Icon size={13} strokeWidth={isActive ? 2.4 : 1.6} />
              <span className="whitespace-nowrap">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toolbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const {
    instrument, setInstrumentId, chain, expiries, selectedExpiryMs, setSelectedExpiryMs,
    strikecount, setStrikecount, status, lastUpdated, refresh,
  } = useOptionsData();

  const instruments: { id: InstrumentId; label: string; short: string }[] = [
    { id: "NIFTY", label: "NIFTY", short: "NF" },
    { id: "BANKNIFTY", label: "BANKNIFTY", short: "BNF" },
  ];

  return (
    <div className="rounded-panel border border-border bg-panel p-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
        {/* Row 1 (mobile): instrument + live metrics + status/refresh */}
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-panel border border-border-subtle bg-surface p-0.5">
            {instruments.map((i) => (
              <button
                key={i.id}
                onClick={() => setInstrumentId(i.id)}
                className={`rounded px-2.5 py-1.5 text-2xs font-semibold transition lg:py-1 ${
                  instrument.id === i.id ? "bg-panel text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span className="sm:hidden">{i.short}</span>
                <span className="hidden sm:inline">{i.label}</span>
              </button>
            ))}
          </div>

          {/* Live metric strip — scrolls horizontally on small screens */}
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-3 overflow-x-auto lg:flex-none lg:gap-3 lg:border-l lg:border-border-subtle lg:pl-3">
            <Metric label="Spot" value={chain?.spot ? dec(chain.spot, 2) : "—"} big />
            <Metric label="ATM" value={chain?.atmStrike ? String(chain.atmStrike) : "—"} />
            <Metric label="VIX" value={chain?.vix ? dec(chain.vix.value, 2) : "—"} />
            <Metric label="PCR" value={chain?.pcr ? dec(chain.pcr, 2) : "—"} />
          </div>

          {/* Status + refresh — pinned right on mobile only (desktop shows them at the end) */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:hidden">
            <StatusPill status={status} />
            <Button tone="ghost" onClick={refresh} className="!px-2 !py-1.5">
              <RefreshCw size={13} className={status === "loading" ? "animate-spin" : ""} />
            </Button>
          </div>
        </div>

        {/* Row 2 (mobile): expiry + strike depth + search */}
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="relative min-w-0 flex-1 lg:flex-none">
            <select
              value={selectedExpiryMs ?? expiries[0]?.ms ?? ""}
              onChange={(e) => setSelectedExpiryMs(Number(e.target.value) || null)}
              className="w-full appearance-none rounded-panel border border-border-subtle bg-surface py-2 pl-2.5 pr-7 text-2xs text-zinc-200 outline-none focus:border-border-hover lg:w-auto lg:py-1.5"
            >
              {expiries.length === 0 && <option value="">Expiry…</option>}
              {expiries.map((e) => (
                <option key={e.ms} value={e.ms}>
                  {e.label} {e.type === "MONTHLY" ? "(M)" : ""} · {e.daysRemaining}d
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          </div>
          <select
            value={strikecount}
            onChange={(e) => setStrikecount(Number(e.target.value))}
            className="shrink-0 rounded-panel border border-border-subtle bg-surface px-2 py-2 text-2xs text-zinc-200 outline-none focus:border-border-hover lg:py-1.5"
            title="Strike depth (each side of ATM)"
          >
            {[10, 15, 20, 25, 30, 40].map((n) => (
              <option key={n} value={n}>±{n}</option>
            ))}
          </select>

          {/* Search — icon on mobile, labelled pill on desktop */}
          <button
            onClick={onOpenPalette}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-panel border border-border-subtle bg-surface px-2.5 py-2 text-2xs text-zinc-400 transition hover:text-zinc-200 lg:ml-0 lg:py-1.5"
          >
            <Search size={13} />
            <span className="hidden sm:inline">Search</span>
            <span className="ml-0.5 hidden items-center gap-0.5 rounded bg-panel px-1 text-[9px] text-zinc-600 lg:inline-flex">
              <Command size={8} />K
            </span>
          </button>
        </div>

        {/* Desktop-only status / last-updated / refresh, pinned far right */}
        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <StatusPill status={status} />
          {lastUpdated && <span className="font-mono text-[9px] text-zinc-600">{fmtTime(lastUpdated)}</span>}
          <Button tone="ghost" onClick={refresh} className="!px-1.5">
            <RefreshCw size={12} className={status === "loading" ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="flex shrink-0 items-baseline gap-1.5">
      <span className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</span>
      <span className={`font-mono ${big ? "text-sm font-semibold text-zinc-100" : "text-2xs text-zinc-300"}`}>{value}</span>
    </div>
  );
}

function CommandPalette({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return PANELS;
    return PANELS.filter((p) => `${p.label} ${p.group} ${p.keywords ?? ""}`.toLowerCase().includes(term));
  }, [q]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-3 pt-[10vh]" onClick={onClose}>
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
            placeholder="Search panels, tools, analytics…"
            className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-700"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, results.length - 1));
              else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
              else if (e.key === "Enter" && results[idx]) onPick(results[idx].id);
              else if (e.key === "Escape") onClose();
            }}
          />
          <span className="rounded bg-surface px-1 text-[9px] text-zinc-600">esc</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {results.length === 0 && <p className="px-3 py-4 text-center text-2xs text-zinc-600">No matches</p>}
          {results.map((p, i) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => onPick(p.id)}
                className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2.5 text-left text-2xs transition lg:py-1.5 ${
                  i === idx ? "bg-surface text-zinc-100" : "text-zinc-400"
                }`}
              >
                <Icon size={14} className="text-zinc-500" />
                <span>{p.label}</span>
                <span className="ml-auto text-[9px] uppercase tracking-wider text-zinc-700">{p.group}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
