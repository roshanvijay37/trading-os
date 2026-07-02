/**
 * Live Option Chain — the centerpiece. ATM-centered, broker bid/ask/volume/OI/ΔOI plus
 * computed IV & Greeks per strike, strike search, CE/PE filter, pinned strikes, and a
 * click-to-trade hook that prefills the Trade Ticket. All values are live or computed
 * from the live feed — never fabricated.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Star, Search } from "lucide-react";
import { useOptionsData } from "../state/OptionsDataProvider";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Segmented, Bar } from "../components/ui";
import { Flash } from "../../components/ui/Flash";
import { dec, compact, signed, volPct } from "../lib/format";
import { emitSelectContract } from "../lib/events";
import type { EnrichedChain, OptionQuote, OptionType, StrikeRow } from "../types";

type SideFilter = "BOTH" | "CE" | "PE";

export function OptionChainPanel() {
  return (
    <Panel
      title="Live Option Chain"
      icon={ListTree}
      badge={<ProvenanceBadge kind="BROKER" />}
      className="h-full"
      bodyClassName="flex flex-col"
      noPad
    >
      <ChainGate>{(chain) => <ChainBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function ChainBody({ chain }: { chain: EnrichedChain }) {
  const [filter, setFilter] = useState<SideFilter>("BOTH");
  const [extended, setExtended] = useState(false);
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<Set<number>>(new Set());
  const atmRef = useRef<HTMLTableRowElement>(null);
  const didCenter = useRef(false);

  // Center the ATM row once per instrument/expiry load.
  useEffect(() => {
    didCenter.current = false;
  }, [chain.instrument.id, chain.selectedExpiry?.ms]);
  useEffect(() => {
    if (!didCenter.current && atmRef.current) {
      atmRef.current.scrollIntoView({ block: "center" });
      didCenter.current = true;
    }
  });

  const maxOi = useMemo(() => {
    let m = 0;
    for (const r of chain.rows) m = Math.max(m, r.ce.oi, r.pe.oi);
    return m;
  }, [chain.rows]);

  const rows = useMemo(() => {
    if (!query.trim()) return chain.rows;
    const q = query.trim();
    return chain.rows.filter((r) => String(r.strike).includes(q));
  }, [chain.rows, query]);

  const pinnedRows = chain.rows.filter((r) => pinned.has(r.strike));

  const togglePin = (strike: number) =>
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(strike) ? next.delete(strike) : next.add(strike);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "BOTH", label: "Calls + Puts" },
            { value: "CE", label: "Calls" },
            { value: "PE", label: "Puts" },
          ]}
        />
        <Segmented
          size="xs"
          value={extended ? "ext" : "std"}
          onChange={(v) => setExtended(v === "ext")}
          options={[
            { value: "std", label: "Standard" },
            { value: "ext", label: "Greeks" },
          ]}
        />
        <div className="relative ml-auto">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Strike…"
            className="w-24 rounded-panel border border-border-subtle bg-surface py-1 pl-6 pr-2 text-2xs font-mono text-zinc-200 outline-none focus:border-border-hover"
          />
        </div>
      </div>

      {pinnedRows.length > 0 && (
        <div className="border-b border-border-subtle bg-surface/40">
          <ChainTable
            rows={pinnedRows}
            chain={chain}
            filter={filter}
            extended={extended}
            maxOi={maxOi}
            pinned={pinned}
            onTogglePin={togglePin}
            label="Pinned"
          />
        </div>
      )}

      {/* Main scroll area */}
      <div className="min-h-0 flex-1 overflow-auto">
        <ChainTable
          rows={rows}
          chain={chain}
          filter={filter}
          extended={extended}
          maxOi={maxOi}
          pinned={pinned}
          onTogglePin={togglePin}
          atmRef={atmRef}
        />
      </div>

      {/* Footer aggregates */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border-subtle px-3 py-1.5 text-2xs">
        <span className="text-zinc-600">Total CE OI <span className="font-mono text-loss">{compact(chain.totalCeOi)}</span></span>
        <span className="text-zinc-600">Total PE OI <span className="font-mono text-gain">{compact(chain.totalPeOi)}</span></span>
        <span className="text-zinc-600">PCR <span className="font-mono text-zinc-300">{dec(chain.pcr, 2)}</span></span>
        <span className="text-zinc-600">Max Pain <span className="font-mono text-zinc-300">{chain.maxPain}</span></span>
        <span className="ml-auto text-zinc-700">Click LTP to load the Trade Ticket · ★ to pin</span>
      </div>
    </div>
  );
}

function ChainTable({
  rows,
  chain,
  filter,
  extended,
  maxOi,
  pinned,
  onTogglePin,
  atmRef,
  label,
}: {
  rows: StrikeRow[];
  chain: EnrichedChain;
  filter: SideFilter;
  extended: boolean;
  maxOi: number;
  pinned: Set<number>;
  onTogglePin: (strike: number) => void;
  atmRef?: React.RefObject<HTMLTableRowElement | null>;
  label?: string;
}) {
  const showCE = filter !== "PE";
  const showPE = filter !== "CE";
  return (
    <table className="chain-grid w-full border-collapse text-2xs">
      <thead className="sticky top-0 z-10 bg-panel">
        <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
          {showCE && (
            <>
              <Th>OI</Th>
              <Th className="hidden sm:table-cell">ΔOI</Th>
              {extended && <Th>Vol</Th>}
              {extended && <Th>Γ</Th>}
              {extended && <Th>Θ</Th>}
              <Th className="hidden sm:table-cell">IV</Th>
              <Th>Δ</Th>
              {extended && <Th>Bid</Th>}
              <Th highlight>LTP</Th>
            </>
          )}
          <Th center>{label ?? "Strike"}</Th>
          {showPE && (
            <>
              <Th highlight>LTP</Th>
              {extended && <Th>Bid</Th>}
              <Th>Δ</Th>
              <Th className="hidden sm:table-cell">IV</Th>
              {extended && <Th>Θ</Th>}
              {extended && <Th>Γ</Th>}
              {extended && <Th>Vol</Th>}
              <Th className="hidden sm:table-cell">ΔOI</Th>
              <Th>OI</Th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const ceItm = row.strike < chain.spot;
          const peItm = row.strike > chain.spot;
          return (
            <tr
              key={row.strike}
              ref={row.isAtm ? atmRef : undefined}
              className={`border-b border-border-subtle/60 ${row.isAtm ? "bg-info-dim" : "hover:bg-surface/60"}`}
            >
              {showCE && <CeCells row={row} itm={ceItm} extended={extended} maxOi={maxOi} />}
              <td className="px-1 py-1 text-center">
                <button
                  onClick={() => onTogglePin(row.strike)}
                  className="group inline-flex items-center gap-1"
                  title="Pin strike"
                >
                  <Star
                    size={9}
                    className={pinned.has(row.strike) ? "fill-warn text-warn" : "text-zinc-700 group-hover:text-zinc-500"}
                  />
                  <span className={`font-mono font-semibold ${row.isAtm ? "text-info" : "text-zinc-300"}`}>{row.strike}</span>
                </button>
              </td>
              {showPE && <PeCells row={row} itm={peItm} extended={extended} maxOi={maxOi} />}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CeCells({ row, itm, extended, maxOi }: { row: StrikeRow; itm: boolean; extended: boolean; maxOi: number }) {
  const q = row.ce;
  const bg = itm ? "bg-warn-dim/40" : "";
  return (
    <>
      <td className={`relative px-1.5 py-1 text-right font-mono text-zinc-400 ${bg}`}>
        <div className="absolute inset-y-1 right-0 w-full opacity-30">
          <Bar value={q.oi} max={maxOi} tone="rose" align="right" />
        </div>
        <span className="relative">{compact(q.oi)}</span>
      </td>
      <td className={`hidden px-1.5 py-1 text-right font-mono sm:table-cell ${bg} ${q.oiChange >= 0 ? "text-gain" : "text-loss"}`}>{compact(q.oiChange)}</td>
      {extended && <td className={`px-1.5 py-1 text-right font-mono text-zinc-500 ${bg}`}>{compact(q.volume)}</td>}
      {extended && <td className={`px-1.5 py-1 text-right font-mono text-zinc-500 ${bg}`}>{dec(q.greeks.gamma, 4)}</td>}
      {extended && <td className={`px-1.5 py-1 text-right font-mono text-loss ${bg}`}>{dec(q.greeks.theta, 1)}</td>}
      <td className={`hidden px-1.5 py-1 text-right font-mono text-zinc-400 sm:table-cell ${bg}`}>{q.iv > 0 ? volPct(q.iv) : "—"}</td>
      <td className={`px-1.5 py-1 text-right font-mono text-zinc-400 ${bg}`}>{q.iv > 0 ? dec(q.greeks.delta, 2) : "—"}</td>
      {extended && <td className={`px-1.5 py-1 text-right font-mono text-zinc-500 ${bg}`}>{dec(q.bid, 1)}</td>}
      <Ltp q={q} bg={bg} />
    </>
  );
}

function PeCells({ row, itm, extended, maxOi }: { row: StrikeRow; itm: boolean; extended: boolean; maxOi: number }) {
  const q = row.pe;
  const bg = itm ? "bg-warn-dim/40" : "";
  return (
    <>
      <Ltp q={q} bg={bg} />
      {extended && <td className={`px-1.5 py-1 text-right font-mono text-zinc-500 ${bg}`}>{dec(q.bid, 1)}</td>}
      <td className={`px-1.5 py-1 text-right font-mono text-zinc-400 ${bg}`}>{q.iv > 0 ? dec(q.greeks.delta, 2) : "—"}</td>
      <td className={`hidden px-1.5 py-1 text-right font-mono text-zinc-400 sm:table-cell ${bg}`}>{q.iv > 0 ? volPct(q.iv) : "—"}</td>
      {extended && <td className={`px-1.5 py-1 text-right font-mono text-loss ${bg}`}>{dec(q.greeks.theta, 1)}</td>}
      {extended && <td className={`px-1.5 py-1 text-right font-mono text-zinc-500 ${bg}`}>{dec(q.greeks.gamma, 4)}</td>}
      {extended && <td className={`px-1.5 py-1 text-right font-mono text-zinc-500 ${bg}`}>{compact(q.volume)}</td>}
      <td className={`hidden px-1.5 py-1 text-right font-mono sm:table-cell ${bg} ${q.oiChange >= 0 ? "text-gain" : "text-loss"}`}>{compact(q.oiChange)}</td>
      <td className={`relative px-1.5 py-1 text-right font-mono text-zinc-400 ${bg}`}>
        <div className="absolute inset-y-1 left-0 w-full opacity-30">
          <Bar value={q.oi} max={maxOi} tone="green" />
        </div>
        <span className="relative">{compact(q.oi)}</span>
      </td>
    </>
  );
}

function Ltp({ q, bg }: { q: OptionQuote; bg: string }) {
  return (
    <td className={`px-1.5 py-1 text-right ${bg}`}>
      <button
        onClick={() => q.symbol && emitSelectContract({ symbol: q.symbol, type: q.type as OptionType, strike: q.strike, ltp: q.ltp, source: "chain" })}
        className="inline-flex items-center gap-1 font-mono font-semibold text-zinc-100 hover:text-info"
        title={q.symbol || "No symbol"}
      >
        <Flash value={q.ltp}>{q.ltp > 0 ? dec(q.ltp, 1) : "—"}</Flash>
        <span className={`text-[9px] ${q.ltpChangePct >= 0 ? "text-gain" : "text-loss"}`}>
          {q.ltpChangePct ? signed(q.ltpChangePct, 1) + "%" : ""}
        </span>
      </button>
    </td>
  );
}

function Th({ children, center, highlight, className = "" }: { children: React.ReactNode; center?: boolean; highlight?: boolean; className?: string }) {
  return (
    <th className={`px-1.5 py-1.5 font-semibold ${center ? "text-center" : "text-right"} ${highlight ? "text-zinc-400" : ""} ${className}`}>
      {children}
    </th>
  );
}
