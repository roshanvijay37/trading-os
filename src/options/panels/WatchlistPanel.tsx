/**
 * Watchlist — favourite strikes / contracts / expiries / strategies, persisted locally via
 * watchlistStore (user data, not market data). For CONTRACT and STRIKE items we read the LIVE
 * value (LTP, IV, OI, ΔOI) straight from the in-memory chain and re-render with the feed —
 * never a cached or invented number. Clicking a contract emits a select event so the Trade
 * Ticket prefills. A live "select-contract" listener offers a one-click add of whatever the
 * user just clicked elsewhere (e.g. in the chain).
 */

import { useEffect, useMemo, useState } from "react";
import { Star, Trash2, Plus, ArrowUpRight, Layers, CalendarClock } from "lucide-react";
import { useOptionsData } from "../state/OptionsDataProvider";
import { Panel, ProvenanceBadge, Button, Empty, Pill, Banner } from "../components/ui";
import { watchlistStore } from "../lib/storage";
import { onSelectContract, emitSelectContract, type SelectContractDetail } from "../lib/events";
import { dec, compact, signed, volPct, toneClass } from "../lib/format";
import type { EnrichedChain, OptionQuote, OptionType, WatchItem } from "../types";

/** Resolve the live quote for a watch item from the chain (by symbol, then by strike+inferred side). */
function resolveQuote(item: WatchItem, chain: EnrichedChain | null): OptionQuote | null {
  if (!chain || chain.instrument.id !== item.instrument) return null;
  if (item.symbol) {
    for (const r of chain.rows) {
      if (r.ce.symbol === item.symbol) return r.ce;
      if (r.pe.symbol === item.symbol) return r.pe;
    }
  }
  return null;
}

function inferType(symbol?: string): OptionType | null {
  if (!symbol) return null;
  if (symbol.endsWith("CE")) return "CE";
  if (symbol.endsWith("PE")) return "PE";
  return null;
}

function symbolShort(symbol?: string): string {
  if (!symbol) return "";
  const m = symbol.match(/(\d{4,6}(?:CE|PE))$/);
  return m ? m[1] : symbol.replace(/^.*:/, "");
}

export function WatchlistPanel() {
  const data = useOptionsData();
  const chain = data.chain;
  const [items, setItems] = useState<WatchItem[]>(() => watchlistStore.all());
  const [pending, setPending] = useState<SelectContractDetail | null>(null);

  // Offer to add whatever the user just selected elsewhere (chain/screener).
  useEffect(() => {
    const off = onSelectContract((d) => setPending(d));
    return off;
  }, []);

  const addContract = (d: SelectContractDetail) => {
    const item: WatchItem = {
      id: `wl_${d.symbol}`,
      kind: "CONTRACT",
      instrument: data.instrument.id,
      label: `${d.strike} ${d.type}`,
      symbol: d.symbol,
      strike: d.strike,
      createdAt: Date.now(),
    };
    setItems(watchlistStore.add(item));
    setPending(null);
  };

  const addAtm = () => {
    if (!chain) return;
    const atm = chain.rows.find((r) => r.isAtm);
    if (!atm) return;
    const ce = atm.ce;
    const pe = atm.pe;
    let next = items;
    if (ce.symbol) {
      next = watchlistStore.add({
        id: `wl_${ce.symbol}`,
        kind: "CONTRACT",
        instrument: data.instrument.id,
        label: `${atm.strike} CE (ATM)`,
        symbol: ce.symbol,
        strike: atm.strike,
        createdAt: Date.now(),
      });
    }
    if (pe.symbol) {
      next = watchlistStore.add({
        id: `wl_${pe.symbol}`,
        kind: "CONTRACT",
        instrument: data.instrument.id,
        label: `${atm.strike} PE (ATM)`,
        symbol: pe.symbol,
        strike: atm.strike,
        createdAt: Date.now(),
      });
    }
    setItems(next);
  };

  const addExpiry = () => {
    if (!chain?.selectedExpiry) return;
    const ex = chain.selectedExpiry;
    const item: WatchItem = {
      id: `wl_exp_${data.instrument.id}_${ex.ms}`,
      kind: "EXPIRY",
      instrument: data.instrument.id,
      label: `${ex.label} · ${ex.type}`,
      createdAt: Date.now(),
    };
    setItems(watchlistStore.add(item));
  };

  const remove = (id: string) => setItems(watchlistStore.remove(id));

  const open = (item: WatchItem) => {
    const q = resolveQuote(item, chain);
    const type = inferType(item.symbol);
    if (item.symbol && type) {
      emitSelectContract({
        symbol: item.symbol,
        type,
        strike: item.strike ?? q?.strike ?? 0,
        ltp: q?.ltp ?? 0,
        source: "watchlist",
      });
    }
  };

  const { live, others } = useMemo(() => {
    const liveKinds = items.filter((i) => i.kind === "CONTRACT" || i.kind === "STRIKE");
    const rest = items.filter((i) => i.kind !== "CONTRACT" && i.kind !== "STRIKE");
    return { live: liveKinds, others: rest };
  }, [items]);

  return (
    <Panel
      title="Watchlist"
      icon={Star}
      badge={<ProvenanceBadge kind="BROKER" />}
      className="h-full"
      bodyClassName="overflow-auto"
      actions={
        <div className="flex items-center gap-1.5">
          <Button tone="ghost" onClick={addAtm} disabled={!chain}>
            <span className="flex items-center gap-1">
              <Plus size={11} /> ATM
            </span>
          </Button>
          <Button tone="ghost" onClick={addExpiry} disabled={!chain?.selectedExpiry}>
            <span className="flex items-center gap-1">
              <CalendarClock size={11} /> Expiry
            </span>
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Pending add from a select-contract event */}
        {pending && (
          <Banner tone="info">
            <div className="flex items-center justify-between gap-2">
              <span>
                Add <span className="font-mono font-semibold">{pending.strike} {pending.type}</span> to your watchlist?
              </span>
              <div className="flex items-center gap-1.5">
                <Button tone="blue" onClick={() => addContract(pending)}>
                  Add
                </Button>
                <Button tone="ghost" onClick={() => setPending(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </Banner>
        )}

        {items.length === 0 && !pending ? (
          <Empty
            icon={Star}
            message="Nothing watched yet. Click a strike's LTP in the Option Chain to load it here, or use the ATM / Expiry quick-add buttons above."
          />
        ) : (
          <>
            {/* Live contracts / strikes */}
            {live.length > 0 && (
              <div className="rounded-panel border border-border bg-panel p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Layers size={12} className="text-zinc-600" />
                  <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Contracts</span>
                  <ProvenanceBadge kind="BROKER" />
                  <span className="ml-auto text-[9px] text-zinc-600">click to load Trade Ticket</span>
                </div>
                <div className="space-y-1.5">
                  {live.map((item) => (
                    <LiveRow key={item.id} item={item} chain={chain} onOpen={open} onRemove={remove} />
                  ))}
                </div>
              </div>
            )}

            {/* Expiries / strategies */}
            {others.length > 0 && (
              <div className="rounded-panel border border-border bg-panel p-3">
                <div className="mb-2 flex items-center gap-2">
                  <CalendarClock size={12} className="text-zinc-600" />
                  <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                    Expiries &amp; Strategies
                  </span>
                </div>
                <div className="space-y-1.5">
                  {others.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-panel border border-border-subtle bg-surface/40 px-2.5 py-1.5"
                    >
                      <Pill tone={item.kind === "EXPIRY" ? "blue" : "amber"}>{item.kind}</Pill>
                      <span className="min-w-0 flex-1 truncate text-2xs text-zinc-200">{item.label}</span>
                      <span className="text-[9px] text-zinc-600">{item.instrument}</span>
                      <button
                        onClick={() => remove(item.id)}
                        className="rounded p-1 text-zinc-500 hover:bg-loss-dim hover:text-loss"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function LiveRow({
  item,
  chain,
  onOpen,
  onRemove,
}: {
  item: WatchItem;
  chain: EnrichedChain | null;
  onOpen: (item: WatchItem) => void;
  onRemove: (id: string) => void;
}) {
  const q = resolveQuote(item, chain);
  const sameInstrument = chain?.instrument.id === item.instrument;
  const clickable = !!inferType(item.symbol);

  return (
    <div className="flex items-center gap-2 rounded-panel border border-border-subtle bg-surface/40 px-2.5 py-1.5">
      <button
        onClick={() => clickable && onOpen(item)}
        disabled={!clickable}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        title={clickable ? "Load into Trade Ticket" : item.label}
      >
        <span className="truncate font-mono text-2xs text-zinc-200">{symbolShort(item.symbol) || item.label}</span>
        {clickable && <ArrowUpRight size={10} className="text-zinc-600" />}
      </button>

      <div className="flex items-center gap-3 font-mono text-[10px]">
        {!sameInstrument ? (
          <span className="text-zinc-600">{item.instrument} — switch chain</span>
        ) : !q || !q.hasData ? (
          <span className="text-zinc-600">no live value</span>
        ) : (
          <>
            <Metric label="LTP" value={q.ltp > 0 ? dec(q.ltp, 1) : "—"} sub={
              q.ltpChangePct ? <span className={toneClass(q.ltpChangePct)}>{signed(q.ltpChangePct, 1)}%</span> : null
            } />
            <Metric label="IV" value={q.iv > 0 ? volPct(q.iv) : "—"} />
            <Metric label="OI" value={compact(q.oi)} />
            <Metric
              label="ΔOI"
              value={<span className={toneClass(q.oiChange)}>{compact(q.oiChange)}</span>}
            />
          </>
        )}
      </div>

      <button
        onClick={() => onRemove(item.id)}
        className="rounded p-1 text-zinc-500 hover:bg-loss-dim hover:text-loss"
        title="Remove"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-[8px] uppercase tracking-wide text-zinc-600">{label}</span>
      <span className="text-zinc-200">
        {value}
        {sub ? <span className="ml-1">{sub}</span> : null}
      </span>
    </span>
  );
}
