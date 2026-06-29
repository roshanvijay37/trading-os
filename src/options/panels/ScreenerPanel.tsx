/**
 * Option Screener — runs the 12 preset scans from lib/screener.ts against the LIVE chain.
 *
 * Each scan flattens the broker chain into contract rows (CE & PE) and ranks them
 * (highest IV/OI/volume/Greeks, moneyness buckets, momentum). The table is sortable by any
 * column; clicking a row emits `emitSelectContract({source:"screener"})` to prefill the Trade
 * Ticket. Broker fields (LTP, OI, ΔOI, Volume, chg%) are LIVE; IV and the Greeks (Δ/Γ/Θ/V)
 * are COMPUTED locally — both provenances are badged. Empty scans are shown honestly.
 */

import { useMemo, useState } from "react";
import { Filter, MousePointerClick, SlidersHorizontal } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Select, Segmented, Empty, Pill } from "../components/ui";
import { SCANS, runScan, type ScanId, type ScreenerRow } from "../lib/screener";
import { emitSelectContract } from "../lib/events";
import { dec, compact, signed, volPct, int } from "../lib/format";
import type { EnrichedChain } from "../types";

type SortKey =
  | "strike"
  | "ltp"
  | "iv"
  | "oi"
  | "oiChange"
  | "volume"
  | "delta"
  | "gamma"
  | "theta"
  | "vega"
  | "ltpChangePct";

type SortDir = "asc" | "desc";

const LIMITS = [10, 25, 50, 100];

export function ScreenerPanel() {
  return (
    <Panel
      title="Option Screener"
      icon={Filter}
      badge={<ProvenanceBadge kind="BROKER" />}
      className="h-full"
      bodyClassName="flex flex-col"
      noPad
    >
      <ChainGate>{(chain) => <ScreenerBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function ScreenerBody({ chain }: { chain: EnrichedChain }) {
  const [scan, setScan] = useState<ScanId>("highest-oi");
  const [limit, setLimit] = useState(25);
  // null sort key ⇒ keep the scan's native ranking order.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const baseRows = useMemo(() => runScan(chain, scan, limit), [chain, scan, limit]);

  const rows = useMemo(() => {
    if (!sortKey) return baseRows;
    const sorted = [...baseRows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [baseRows, sortKey, sortDir]);

  const activeScan = SCANS.find((s) => s.id === scan);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handleSelect = (row: ScreenerRow) => {
    if (!row.symbol) return;
    emitSelectContract({
      symbol: row.symbol,
      type: row.type,
      strike: row.strike,
      ltp: row.ltp,
      source: "screener",
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal size={11} className="text-zinc-600" />
          <Select value={scan} onChange={(v) => { setScan(v as ScanId); setSortKey(null); }}>
            {SCANS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-zinc-600">Limit</span>
          <Segmented
            size="xs"
            value={String(limit)}
            onChange={(v) => setLimit(Number(v))}
            options={LIMITS.map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <ProvenanceBadge kind="BROKER" label="Live LTP/OI/Vol" />
          <ProvenanceBadge kind="COMPUTED" label="IV / Greeks" />
        </div>
      </div>

      {activeScan && (
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-2xs text-zinc-600">
          <span className="font-medium text-zinc-400">{activeScan.label}</span>
          <span className="text-zinc-700">·</span>
          <span>{activeScan.description}</span>
          <span className="ml-auto text-zinc-700">{int(rows.length)} contracts</span>
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <Empty
            icon={Filter}
            message={`The "${activeScan?.label ?? scan}" scan returned no contracts from the current live chain. Nothing is shown rather than empty rows — try another scan or widen the strike count.`}
          />
        ) : (
          <table className="w-full border-collapse text-2xs">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                <Th>Symbol</Th>
                <SortTh label="Strike" col="strike" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <Th center>Type</Th>
                <Th center>Moneyness</Th>
                <SortTh label="LTP" col="ltp" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="chg%" col="ltpChangePct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="IV" col="iv" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="OI" col="oi" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="ΔOI" col="oiChange" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Vol" col="volume" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Δ" col="delta" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Γ" col="gamma" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Θ" col="theta" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="V" col="vega" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.symbol}
                  onClick={() => handleSelect(row)}
                  className={`cursor-pointer border-b border-border-subtle/60 hover:bg-surface/60 ${
                    row.type === "CE" ? "bg-loss/[0.04]" : "bg-gain/[0.04]"
                  }`}
                  title="Click to load the Trade Ticket"
                >
                  <td className="px-2 py-1 font-mono text-zinc-300">
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick size={9} className="text-zinc-700" />
                      {shortSymbol(row.symbol)}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono font-semibold text-zinc-200">{row.strike}</td>
                  <td className="px-1.5 py-1 text-center">
                    <Pill tone={row.type === "CE" ? "rose" : "green"}>{row.type}</Pill>
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    <span className={moneynessClass(row.moneyness)}>{row.moneyness}</span>
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono font-semibold text-zinc-100">
                    {row.ltp > 0 ? dec(row.ltp, 1) : "—"}
                  </td>
                  <td className={`px-1.5 py-1 text-right font-mono ${row.ltpChangePct >= 0 ? "text-gain" : "text-loss"}`}>
                    {row.ltpChangePct ? signed(row.ltpChangePct, 1) + "%" : "—"}
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono text-zinc-400">
                    {row.iv > 0 ? volPct(row.iv) : "—"}
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono text-zinc-300">{compact(row.oi)}</td>
                  <td className={`px-1.5 py-1 text-right font-mono ${row.oiChange >= 0 ? "text-gain" : "text-loss"}`}>
                    {compact(row.oiChange)}
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono text-zinc-400">{compact(row.volume)}</td>
                  <td className="px-1.5 py-1 text-right font-mono text-zinc-400">
                    {row.iv > 0 ? dec(row.delta, 2) : "—"}
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono text-zinc-500">
                    {row.iv > 0 ? dec(row.gamma, 4) : "—"}
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono text-loss">
                    {row.iv > 0 ? dec(row.theta, 1) : "—"}
                  </td>
                  <td className="px-1.5 py-1 text-right font-mono text-zinc-500">
                    {row.iv > 0 ? dec(row.vega, 2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-x-4 border-t border-border-subtle px-3 py-1.5 text-2xs text-zinc-700">
        <span>
          {chain.instrument.label} · spot{" "}
          <span className="font-mono text-zinc-400">{dec(chain.spot, 1)}</span>
        </span>
        {chain.selectedExpiry && (
          <span>
            Expiry <span className="font-mono text-zinc-400">{chain.selectedExpiry.label}</span>
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-zinc-700">
          <MousePointerClick size={10} /> Click a row to load the Trade Ticket
        </span>
      </div>
    </div>
  );
}

/** Trim "NSE:" prefix for a denser symbol column; full symbol stays in the tooltip-able row. */
function shortSymbol(sym: string): string {
  return sym.replace(/^NSE:/, "");
}

function moneynessClass(m: ScreenerRow["moneyness"]): string {
  if (m === "ATM") return "rounded px-1.5 py-0.5 text-[9px] font-semibold text-info bg-info/10";
  if (m === "ITM") return "rounded px-1.5 py-0.5 text-[9px] font-semibold text-warn bg-warn/10";
  return "rounded px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500 bg-surface";
}

function Th({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <th className={`px-1.5 py-1.5 font-semibold ${center ? "text-center" : "text-right"} first:text-left`}>
      {children}
    </th>
  );
}

function SortTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th className="px-1.5 py-1.5 text-right font-semibold">
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-0.5 transition hover:text-zinc-300 ${active ? "text-info" : ""}`}
      >
        {label}
        <span className="text-[8px]">{active ? (sortDir === "desc" ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
}
