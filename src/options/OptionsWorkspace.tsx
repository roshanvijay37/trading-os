/**
 * The Options Terminal shell: a dense, keyboard-driven institutional workspace.
 * Top toolbar (instrument / expiry / strike depth / live status), a grouped panel rail,
 * a Ctrl-K command palette ("search everywhere"), and a full-height active panel surface.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, Command, ChevronDown } from "lucide-react";
import { useOptionsData } from "./state/OptionsDataProvider";
import { PANELS, PANEL_GROUPS, type PanelDef } from "./panels/registry";
import { StatusPill, Button } from "./components/ui";
import { dec, fmtTime, volPct } from "./lib/format";
import type { InstrumentId } from "./types";

export function OptionsWorkspace() {
  const data = useOptionsData();
  const [activeId, setActiveId] = useState<string>("summary");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const active = PANELS.find((p) => p.id === activeId) ?? PANELS[0];

  // Global keyboard shortcuts.
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
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[560px] flex-col gap-2">
      <Toolbar onOpenPalette={() => setPaletteOpen(true)} />

      <div className="flex min-h-0 flex-1 gap-2">
        {/* Panel rail */}
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

        {/* Mobile panel selector */}
        <div className="lg:hidden">
          <MobilePanelSelect activeId={activeId} onChange={setActiveId} />
        </div>

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

function Toolbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { instrument, setInstrumentId, chain, expiries, selectedExpiryMs, setSelectedExpiryMs, strikecount, setStrikecount, status, lastUpdated, refresh } = useOptionsData();

  const instruments: { id: InstrumentId; label: string }[] = [
    { id: "NIFTY", label: "NIFTY" },
    { id: "BANKNIFTY", label: "BANKNIFTY" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-panel border border-border bg-panel px-3 py-2">
      {/* Instrument */}
      <div className="inline-flex items-center gap-0.5 rounded-panel border border-border-subtle bg-surface p-0.5">
        {instruments.map((i) => (
          <button
            key={i.id}
            onClick={() => setInstrumentId(i.id)}
            className={`rounded px-2.5 py-1 text-2xs font-semibold transition ${
              instrument.id === i.id ? "bg-panel text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>

      {/* Spot + VIX */}
      <div className="flex items-center gap-3 border-l border-border-subtle pl-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-zinc-600">Spot</span>
          <span className="font-mono text-sm font-semibold text-zinc-100">{chain?.spot ? dec(chain.spot, 2) : "—"}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-zinc-600">ATM</span>
          <span className="font-mono text-2xs text-zinc-300">{chain?.atmStrike || "—"}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-zinc-600">VIX</span>
          <span className="font-mono text-2xs text-zinc-300">{chain?.vix ? dec(chain.vix.value, 2) : "—"}</span>
        </div>
        <div className="hidden items-baseline gap-1.5 sm:flex">
          <span className="text-[9px] uppercase tracking-wider text-zinc-600">PCR</span>
          <span className="font-mono text-2xs text-zinc-300">{chain?.pcr ? dec(chain.pcr, 2) : "—"}</span>
        </div>
      </div>

      {/* Expiry + depth */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={selectedExpiryMs ?? expiries[0]?.ms ?? ""}
            onChange={(e) => setSelectedExpiryMs(Number(e.target.value) || null)}
            className="appearance-none rounded-panel border border-border-subtle bg-surface py-1 pl-2.5 pr-6 text-2xs text-zinc-200 outline-none focus:border-border-hover"
          >
            {expiries.length === 0 && <option value="">Expiry…</option>}
            {expiries.map((e) => (
              <option key={e.ms} value={e.ms}>
                {e.label} {e.type === "MONTHLY" ? "(M)" : ""} · {e.daysRemaining}d
              </option>
            ))}
          </select>
          <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-600" />
        </div>
        <select
          value={strikecount}
          onChange={(e) => setStrikecount(Number(e.target.value))}
          className="rounded-panel border border-border-subtle bg-surface px-2 py-1 text-2xs text-zinc-200 outline-none focus:border-border-hover"
          title="Strike depth (each side of ATM)"
        >
          {[10, 15, 20, 25, 30, 40].map((n) => (
            <option key={n} value={n}>±{n}</option>
          ))}
        </select>
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onOpenPalette}
          className="hidden items-center gap-1.5 rounded-panel border border-border-subtle bg-surface px-2 py-1 text-2xs text-zinc-500 hover:text-zinc-300 sm:flex"
        >
          <Search size={11} />
          Search
          <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-panel px-1 text-[9px] text-zinc-600">
            <Command size={8} />K
          </span>
        </button>
        <StatusPill status={status} />
        {lastUpdated && <span className="hidden font-mono text-[9px] text-zinc-600 md:inline">{fmtTime(lastUpdated)}</span>}
        <Button tone="ghost" onClick={refresh} className="!px-1.5">
          <RefreshCw size={12} className={status === "loading" ? "animate-spin" : ""} />
        </Button>
      </div>
    </div>
  );
}

function MobilePanelSelect({ activeId, onChange }: { activeId: string; onChange: (id: string) => void }) {
  return (
    <select
      value={activeId}
      onChange={(e) => onChange(e.target.value)}
      className="w-40 rounded-panel border border-border-subtle bg-surface px-2 py-1.5 text-2xs text-zinc-200 outline-none"
    >
      {PANEL_GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {PANELS.filter((p) => p.group === g).map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-panel border border-border bg-panel shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <Search size={13} className="text-zinc-600" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search panels, tools, analytics…"
            className="flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-700"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, results.length - 1));
              else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
              else if (e.key === "Enter" && results[idx]) onPick(results[idx].id);
              else if (e.key === "Escape") onClose();
            }}
          />
          <span className="rounded bg-surface px-1 text-[9px] text-zinc-600">esc</span>
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {results.length === 0 && <p className="px-3 py-4 text-center text-2xs text-zinc-600">No matches</p>}
          {results.map((p, i) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => onPick(p.id)}
                className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-2xs transition ${
                  i === idx ? "bg-surface text-zinc-100" : "text-zinc-400"
                }`}
              >
                <Icon size={13} className="text-zinc-500" />
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
