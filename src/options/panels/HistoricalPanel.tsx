/**
 * Historical Analytics — deliberately, painfully honest about provenance.
 *
 * There is NO server-side intraday history store for OI / Greeks / PCR / premium / volume in
 * the FYERS retail API, so this panel does NOT fabricate one. It offers exactly two real sources:
 *
 *  1. PERSISTED India-VIX IV stats (marketApi.getIvHistory) — IV Rank / Percentile and the
 *     observed min–max VIX band. The endpoint returns aggregate stats, not a raw daily series,
 *     so we render the rank as a band/gauge, not a fake reconstructed line.
 *
 *  2. IN-SESSION snapshots — recorded locally from the live chain only while this panel is open
 *     (one per feed update, capped). These power inline SVG sparklines and a playback scrubber.
 *
 * Anything "historical" beyond the recording window is marked UNAVAILABLE — never invented.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { History, Gauge, Play, Database, Info } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Stat, Banner, Empty, Spinner, Segmented } from "../components/ui";
import { dec, compact, volPct, fmtTime } from "../lib/format";
import { marketApi } from "../../services/api";
import type { EnrichedChain } from "../types";

interface IvStats {
  current: number | null;
  rank: number | null;
  percentile: number | null;
  min: number | null;
  max: number | null;
  samples: number;
  lookbackDays: number;
  sufficient: boolean;
}

interface Snapshot {
  t: number;
  pcr: number;
  atmIv: number;
  totalCeOi: number;
  totalPeOi: number;
  spot: number;
  atmPremium: number;
}

const MAX_SNAPSHOTS = 500;

function num(v: unknown): number | null {
  const x = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
}

export function HistoricalPanel() {
  return (
    <Panel
      title="Historical Analytics"
      icon={History}
      badge={<ProvenanceBadge kind="EOD" label="Mixed sources" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <HistoryBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function HistoryBody({ chain }: { chain: EnrichedChain }) {
  // --- Persisted IV history (aggregate stats only) ---
  const [iv, setIv] = useState<IvStats | null>(null);
  const [ivLoading, setIvLoading] = useState(true);
  const [ivError, setIvError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIvLoading(true);
    setIvError(null);
    (async () => {
      try {
        const res = await marketApi.getIvHistory();
        if (cancelled) return;
        setIv({
          current: num(res?.current),
          rank: num(res?.rank),
          percentile: num(res?.percentile),
          min: num(res?.min),
          max: num(res?.max),
          samples: num(res?.samples) ?? 0,
          lookbackDays: num(res?.lookbackDays) ?? 0,
          sufficient: res?.sufficient === true,
        });
      } catch (err) {
        if (!cancelled) setIvError(err instanceof Error ? err.message : "Failed to load IV history");
      } finally {
        if (!cancelled) setIvLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- In-session recorder: append a snapshot on each new chain timestamp ---
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const lastAsOf = useRef<number>(0);

  useEffect(() => {
    if (!chain?.asOf || chain.asOf === lastAsOf.current) return;
    lastAsOf.current = chain.asOf;
    const atmRow = chain.rows.find((r) => r.isAtm);
    const atmIv = atmRow ? atmRow.ce.iv || atmRow.pe.iv : 0;
    const atmPremium = atmRow ? (atmRow.ce.ltp || 0) + (atmRow.pe.ltp || 0) : 0;
    const snap: Snapshot = {
      t: chain.asOf,
      pcr: chain.pcr,
      atmIv,
      totalCeOi: chain.totalCeOi,
      totalPeOi: chain.totalPeOi,
      spot: chain.spot,
      atmPremium,
    };
    setSnaps((prev) => {
      const next = [...prev, snap];
      return next.length > MAX_SNAPSHOTS ? next.slice(next.length - MAX_SNAPSHOTS) : next;
    });
  }, [chain?.asOf, chain]);

  return (
    <div className="space-y-3">
      <Banner tone="warn">
        <span className="flex items-center gap-1.5">
          <Info size={12} />
          <span>
            The FYERS retail API has <span className="font-semibold">no intraday history store</span> for OI / Greeks /
            PCR / premium. This panel shows only what's real: persisted India-VIX IV stats, plus snapshots recorded
            locally from the moment this panel was opened. It never reconstructs a history it doesn't have.
          </span>
        </span>
      </Banner>

      {/* IV Rank / Percentile (persisted) */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <Gauge size={12} className="text-zinc-600" />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            India VIX — IV Rank &amp; Percentile
          </span>
          <ProvenanceBadge kind="EOD" label="Persisted VIX" />
        </div>
        {ivLoading ? (
          <Spinner label="Loading India VIX history…" />
        ) : ivError ? (
          <Banner tone="loss">India VIX history unavailable — {ivError}</Banner>
        ) : !iv ? (
          <Empty message="No India VIX history returned." />
        ) : !iv.sufficient ? (
          <div className="space-y-2">
            <Banner tone="warn">
              Building history — {iv.samples} sample{iv.samples === 1 ? "" : "s"} stored. IV Rank / Percentile are
              withheld until the lookback is meaningful, rather than shown as a misleading number.
            </Banner>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Current VIX" value={iv.current != null ? dec(iv.current, 2) : "—"} tone="blue" />
              <Stat label="Min seen" value={iv.min != null ? dec(iv.min, 2) : "—"} />
              <Stat label="Max seen" value={iv.max != null ? dec(iv.max, 2) : "—"} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat
                label="IV Rank"
                value={iv.rank != null ? dec(iv.rank, 0) : "—"}
                sub="0 = period low · 100 = high"
                tone={iv.rank != null && iv.rank >= 50 ? "amber" : "green"}
              />
              <Stat
                label="IV Percentile"
                value={iv.percentile != null ? `${dec(iv.percentile, 0)}%` : "—"}
                sub="% of days IV was lower"
                tone={iv.percentile != null && iv.percentile >= 50 ? "amber" : "green"}
              />
              <Stat label="Current VIX" value={iv.current != null ? dec(iv.current, 2) : "—"} tone="blue" />
              <Stat
                label={`${iv.lookbackDays || ""}d Band`.trim()}
                value={iv.min != null && iv.max != null ? `${dec(iv.min, 1)}–${dec(iv.max, 1)}` : "—"}
                sub={`${iv.samples} samples`}
              />
            </div>
            {iv.current != null && iv.min != null && iv.max != null && (
              <RankBand current={iv.current} min={iv.min} max={iv.max} />
            )}
          </div>
        )}
        <p className="mt-2 text-[9px] leading-relaxed text-zinc-600">
          The IV-history endpoint returns aggregate rank/percentile and the min–max band — not a raw daily series — so
          we render the position-in-band rather than drawing a reconstructed line.
        </p>
      </div>

      {/* In-session recorder */}
      <SessionRecorder snaps={snaps} />

      {/* Honest "no deeper history" notice */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <Database size={12} className="text-zinc-600" />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            Historical OI / Greeks / PCR / Premium / Volume
          </span>
          <ProvenanceBadge kind="UNAVAILABLE" />
        </div>
        <p className="text-2xs leading-relaxed text-zinc-500">
          No server-side time-series store exists for these in the FYERS retail API. There is nothing to plot beyond the
          in-session window above — and we will not fabricate one. Persist snapshots server-side (or wire a market-data
          vendor) to unlock true multi-day history here.
        </p>
      </div>
    </div>
  );
}

/** Where current VIX sits within its observed min–max band. */
function RankBand({ current, min, max }: { current: number; min: number; max: number }) {
  const span = max - min;
  const pct = span > 0 ? ((current - min) / span) * 100 : 50;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-sm bg-surface">
        <div className="h-full bg-gradient-to-r from-gain/40 via-info/30 to-loss/50" />
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-zinc-100"
          style={{ left: `${clamped}%` }}
          title={`VIX ${dec(current, 2)}`}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-zinc-600">
        <span className="font-mono">{dec(min, 1)}</span>
        <span className="font-mono text-zinc-300">now {dec(current, 2)}</span>
        <span className="font-mono">{dec(max, 1)}</span>
      </div>
    </div>
  );
}

type Series = "pcr" | "atmIv" | "oi" | "atmPremium";

function SessionRecorder({ snaps }: { snaps: Snapshot[] }) {
  const [series, setSeries] = useState<Series>("pcr");
  const [cursor, setCursor] = useState<number | null>(null);

  // Keep the scrubber pinned to the latest sample unless the user has grabbed it.
  const max = snaps.length - 1;
  const idx = cursor == null ? max : Math.min(cursor, max);
  const active = idx >= 0 ? snaps[idx] : null;

  const startedAt = snaps.length > 0 ? snaps[0].t : 0;

  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Play size={12} className="text-zinc-600" />
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">In-session recording</span>
        <ProvenanceBadge kind="COMPUTED" label="This session" />
        <span className="ml-auto text-[9px] text-zinc-600">
          {snaps.length} snapshot{snaps.length === 1 ? "" : "s"}
          {startedAt ? ` · since ${fmtTime(startedAt)}` : ""} · cap {MAX_SNAPSHOTS}
        </span>
      </div>

      {snaps.length < 2 ? (
        <Empty
          icon={History}
          message="Recording started — sparklines and playback appear once at least two live feed updates have been captured."
        />
      ) : (
        <>
          {/* Sparklines */}
          <div className="mb-3">
            <Segmented
              size="xs"
              value={series}
              onChange={(v) => setSeries(v)}
              options={[
                { value: "pcr", label: "PCR" },
                { value: "atmIv", label: "ATM IV" },
                { value: "oi", label: "CE/PE OI" },
                { value: "atmPremium", label: "ATM premium" },
              ]}
            />
          </div>
          <SeriesChart snaps={snaps} series={series} cursorIdx={idx} />

          {/* Playback scrubber */}
          <div className="mt-3">
            <input
              type="range"
              min={0}
              max={max}
              value={idx}
              onChange={(e) => setCursor(parseInt(e.target.value, 10))}
              className="w-full accent-info"
            />
            <div className="mt-1 flex items-center justify-between text-[9px] text-zinc-600">
              <span>{fmtTime(snaps[0].t)}</span>
              <button
                onClick={() => setCursor(null)}
                className="rounded px-1.5 py-0.5 text-info hover:bg-info-dim"
                title="Jump to latest"
              >
                {cursor == null ? "live" : "← back to latest"}
              </button>
              <span>{fmtTime(snaps[max].t)}</span>
            </div>
          </div>

          {/* Values at the scrubbed moment */}
          {active && (
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
              <Stat label="At" value={fmtTime(active.t)} tone="zinc" />
              <Stat label="Spot" value={compact(active.spot)} tone="blue" />
              <Stat label="PCR" value={active.pcr > 0 ? dec(active.pcr, 2) : "—"} />
              <Stat label="ATM IV" value={active.atmIv > 0 ? volPct(active.atmIv) : "—"} />
              <Stat label="ATM premium" value={active.atmPremium > 0 ? dec(active.atmPremium, 1) : "—"} />
              <Stat
                label="CE / PE OI"
                value={`${compact(active.totalCeOi)} / ${compact(active.totalPeOi)}`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Inline SVG sparkline over the in-session snapshots. For "oi" plots CE and PE as two lines. */
function SeriesChart({ snaps, series, cursorIdx }: { snaps: Snapshot[]; series: Series; cursorIdx: number }) {
  const W = 600;
  const H = 140;
  const PADX = 8;
  const PADY = 12;

  const primary = (s: Snapshot): number => {
    switch (series) {
      case "pcr":
        return s.pcr;
      case "atmIv":
        return s.atmIv * 100;
      case "oi":
        return s.totalCeOi;
      case "atmPremium":
        return s.atmPremium;
    }
  };
  const secondary = series === "oi" ? (s: Snapshot) => s.totalPeOi : null;

  const allVals: number[] = [];
  for (const s of snaps) {
    const p = primary(s);
    if (Number.isFinite(p)) allVals.push(p);
    if (secondary) {
      const q = secondary(s);
      if (Number.isFinite(q)) allVals.push(q);
    }
  }
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1;
  const loY = lo - pad;
  const hiY = hi + pad;

  const n = snaps.length;
  const x = (i: number) => (n <= 1 ? PADX : PADX + (i / (n - 1)) * (W - 2 * PADX));
  const y = (v: number) => (hiY === loY ? H / 2 : H - PADY - ((v - loY) / (hiY - loY)) * (H - 2 * PADY));

  const path = (sel: (s: Snapshot) => number) =>
    snaps
      .map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(sel(s)).toFixed(1)}`)
      .join(" ");

  const cursorX = x(cursorIdx);

  const label =
    series === "pcr" ? "PCR" : series === "atmIv" ? "ATM IV %" : series === "oi" ? "OI" : "ATM premium ₹";

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label={`${label} sparkline`}>
        {/* baseline grid */}
        <line x1={PADX} x2={W - PADX} y1={y((loY + hiY) / 2)} y2={y((loY + hiY) / 2)} stroke="#1a1a20" strokeWidth={1} />
        {/* cursor */}
        <line x1={cursorX} x2={cursorX} y1={PADY} y2={H - PADY} stroke="#3f3f46" strokeWidth={1} strokeDasharray="3 3" />
        {/* secondary (PE OI) */}
        {secondary && <path d={path(secondary)} fill="none" stroke="#10b981" strokeWidth={1.5} />}
        {/* primary */}
        <path d={path(primary)} fill="none" stroke={series === "oi" ? "#ef4444" : "#3b82f6"} strokeWidth={1.5} />
        {/* cursor dot on primary */}
        <circle cx={cursorX} cy={y(primary(snaps[cursorIdx]))} r={2.5} fill="#fafafa" />
      </svg>
      <div className="flex items-center justify-between text-[9px] text-zinc-600">
        <span>
          {series === "oi" ? (
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded-sm bg-loss" /> CE OI
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-3 rounded-sm bg-gain" /> PE OI
              </span>
            </span>
          ) : (
            label
          )}
        </span>
        <span className="font-mono">
          {dec(loY, series === "pcr" || series === "atmIv" ? 1 : 0)} – {dec(hiY, series === "pcr" || series === "atmIv" ? 1 : 0)}
        </span>
      </div>
    </div>
  );
}
