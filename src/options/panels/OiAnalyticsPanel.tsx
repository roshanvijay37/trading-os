/**
 * Open Interest Analytics — institutional OI read on the live chain.
 *
 * Raw OI / change-in-OI / volume are BROKER (straight from the FYERS feed). The build-up
 * classification (Long/Short Build-up, Long Unwinding, Short Covering) is COMPUTED locally
 * from price + OI deltas. Nothing here is fabricated: when the chain is empty the gate shows
 * the honest closed/disconnected state. The OI ladder (per-strike CE vs PE OI, ATM-centered)
 * is the visual centerpiece.
 */

import { useMemo } from "react";
import { Layers, TrendingUp, TrendingDown, Scale, Crosshair, Activity } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Bar, Pill, Row, SectionTitle, type Tone } from "../components/ui";
import { compact, dec, signed, toneClass } from "../lib/format";
import {
  oiLadder,
  supportResistance,
  buildupTally,
  topOiChanges,
  maxOi,
  type BuildupTally,
} from "../lib/oi";
import type { EnrichedChain, OiBuildup } from "../types";

export function OiAnalyticsPanel() {
  return (
    <Panel
      title="Open Interest Analytics"
      icon={Layers}
      badge={<ProvenanceBadge kind="BROKER" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <OiBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Build-up presentation helpers (COMPUTED classification)
// ---------------------------------------------------------------------------

const BUILDUP_META: Record<OiBuildup, { label: string; tone: Tone }> = {
  LONG_BUILDUP: { label: "Long Build-up", tone: "green" },
  SHORT_BUILDUP: { label: "Short Build-up", tone: "rose" },
  LONG_UNWINDING: { label: "Long Unwinding", tone: "amber" },
  SHORT_COVERING: { label: "Short Covering", tone: "blue" },
  NEUTRAL: { label: "Neutral", tone: "zinc" },
};

const TALLY_ROWS: { key: keyof BuildupTally; label: string; tone: Tone }[] = [
  { key: "longBuildup", label: "Long Build-up", tone: "green" },
  { key: "shortBuildup", label: "Short Build-up", tone: "rose" },
  { key: "longUnwinding", label: "Long Unwinding", tone: "amber" },
  { key: "shortCovering", label: "Short Covering", tone: "blue" },
  { key: "neutral", label: "Neutral", tone: "zinc" },
];

function tallyMax(t: BuildupTally): number {
  return Math.max(t.longBuildup, t.shortBuildup, t.longUnwinding, t.shortCovering, t.neutral, 1);
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function OiBody({ chain }: { chain: EnrichedChain }) {
  const ladder = useMemo(() => oiLadder(chain), [chain]);
  const sr = useMemo(() => supportResistance(chain), [chain]);
  const tally = useMemo(() => buildupTally(chain), [chain]);
  const leaders = useMemo(() => topOiChanges(chain, 8), [chain]);
  const peakOi = useMemo(() => maxOi(chain.rows), [chain.rows]);

  // Highest-OI strikes (peak writing) on each side.
  const peakCe = useMemo(
    () => [...chain.rows].sort((a, b) => b.ce.oi - a.ce.oi)[0],
    [chain.rows],
  );
  const peakPe = useMemo(
    () => [...chain.rows].sort((a, b) => b.pe.oi - a.pe.oi)[0],
    [chain.rows],
  );

  const pcr = chain.pcr;
  const pcrTone: Tone = pcr >= 1.2 ? "green" : pcr <= 0.8 ? "rose" : "zinc";
  const pcrRead =
    pcr >= 1.2 ? "Put-heavy — bullish skew" : pcr <= 0.8 ? "Call-heavy — bearish skew" : "Balanced positioning";

  const totalOi = chain.totalCeOi + chain.totalPeOi;
  const cePct = totalOi > 0 ? (chain.totalCeOi / totalOi) * 100 : 0;
  const pePct = totalOi > 0 ? (chain.totalPeOi / totalOi) * 100 : 0;

  return (
    <div className="space-y-3">
      {/* Top-line stats: Highest OI / PCR / Support / Resistance */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <HeadStat
          label="Peak Call OI"
          icon={TrendingUp}
          value={peakCe ? peakCe.strike.toLocaleString("en-IN") : "—"}
          sub={peakCe ? `${compact(peakCe.ce.oi)} contracts` : "—"}
          tone="rose"
        />
        <HeadStat
          label="Peak Put OI"
          icon={TrendingDown}
          value={peakPe ? peakPe.strike.toLocaleString("en-IN") : "—"}
          sub={peakPe ? `${compact(peakPe.pe.oi)} contracts` : "—"}
          tone="green"
        />
        <HeadStat
          label="PCR (OI)"
          icon={Scale}
          value={dec(pcr, 2)}
          sub={pcrRead}
          tone={pcrTone}
        />
        <HeadStat
          label="Max Pain"
          icon={Crosshair}
          value={chain.maxPain ? chain.maxPain.toLocaleString("en-IN") : "—"}
          sub={`Spot ${dec(chain.spot, 0)}`}
          tone="zinc"
        />
      </div>

      {/* OI Ladder — the centerpiece */}
      <div className="rounded-panel border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <Layers size={12} className="text-zinc-600" />
          <SectionTitle>OI Ladder — Calls vs Puts by Strike</SectionTitle>
          <ProvenanceBadge kind="BROKER" />
          <div className="ml-auto flex items-center gap-3 text-[9px] uppercase tracking-wider text-zinc-600">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-loss/60" /> Call OI</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-gain/60" /> Put OI</span>
          </div>
        </div>
        <div className="max-h-[320px] overflow-auto px-2 py-1">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 px-1 pb-1 text-[9px] uppercase tracking-wider text-zinc-600">
            <span className="text-right">Call OI / ΔOI</span>
            <span className="text-center">Strike</span>
            <span className="text-left">Put OI / ΔOI</span>
          </div>
          {ladder.map((r) => (
            <div
              key={r.strike}
              className={`grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 rounded px-1 py-0.5 ${
                r.isAtm ? "bg-info-dim" : "hover:bg-surface/60"
              }`}
            >
              {/* Call side — bar grows right→left */}
              <div className="flex items-center justify-end gap-1.5">
                <span className={`font-mono text-[9px] ${toneClass(r.ceOiChange)}`}>{signed(r.ceOiChange, 0)}</span>
                <span className="w-10 text-right font-mono text-2xs text-zinc-400">{compact(r.ceOi)}</span>
                <div className="w-[42%]">
                  <Bar value={r.ceOi} max={peakOi} tone="rose" align="right" />
                </div>
              </div>
              {/* Strike */}
              <span
                className={`w-14 text-center font-mono text-2xs font-semibold ${
                  r.isAtm ? "text-info" : "text-zinc-300"
                }`}
              >
                {r.strike}
                {r.isAtm && <span className="ml-1 text-[8px] text-info">ATM</span>}
              </span>
              {/* Put side — bar grows left→right */}
              <div className="flex items-center gap-1.5">
                <div className="w-[42%]">
                  <Bar value={r.peOi} max={peakOi} tone="green" />
                </div>
                <span className="w-10 text-left font-mono text-2xs text-zinc-400">{compact(r.peOi)}</span>
                <span className={`font-mono text-[9px] ${toneClass(r.peOiChange)}`}>{signed(r.peOiChange, 0)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Change-in-OI leaders */}
        <div className="rounded-panel border border-border bg-panel">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <Activity size={12} className="text-zinc-600" />
            <SectionTitle>Change in OI Leaders</SectionTitle>
            <ProvenanceBadge kind="BROKER" />
            <ProvenanceBadge kind="COMPUTED" label="Build-up" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-2xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                  <th className="px-2 py-1.5 text-left">Strike</th>
                  <th className="px-2 py-1.5 text-left">Type</th>
                  <th className="px-2 py-1.5 text-right">ΔOI</th>
                  <th className="px-2 py-1.5 text-right">OI</th>
                  <th className="px-2 py-1.5 text-right">LTP</th>
                  <th className="px-2 py-1.5 text-left">Build-up</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((l) => {
                  const meta = BUILDUP_META[l.buildup];
                  return (
                    <tr key={`${l.strike}-${l.type}`} className="border-b border-border-subtle/60 hover:bg-surface/60">
                      <td className="px-2 py-1 text-left font-mono text-zinc-300">{l.strike}</td>
                      <td className="px-2 py-1 text-left">
                        <span className={`font-mono ${l.type === "CE" ? "text-loss" : "text-gain"}`}>{l.type}</span>
                      </td>
                      <td className={`px-2 py-1 text-right font-mono ${toneClass(l.oiChange)}`}>{signed(l.oiChange, 0)}</td>
                      <td className="px-2 py-1 text-right font-mono text-zinc-400">{compact(l.oi)}</td>
                      <td className="px-2 py-1 text-right font-mono text-zinc-300">{l.ltp > 0 ? dec(l.ltp, 1) : "—"}</td>
                      <td className="px-2 py-1 text-left"><Pill tone={meta.tone}>{meta.label}</Pill></td>
                    </tr>
                  );
                })}
                {leaders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-3 text-center text-2xs text-zinc-600">No OI changes yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Build-up summary (COMPUTED) */}
        <div className="rounded-panel border border-border bg-panel">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <Scale size={12} className="text-zinc-600" />
            <SectionTitle>OI Build-up Summary</SectionTitle>
            <ProvenanceBadge kind="COMPUTED" />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-3">
            <BuildupColumn title="Calls (CE)" tally={tally.ce} />
            <BuildupColumn title="Puts (PE)" tally={tally.pe} />
          </div>
          <p className="px-3 pb-3 text-[9px] leading-relaxed text-zinc-700">
            Bars weighted by |ΔOI|. Build-up is classified locally from price + OI direction, not reported by the broker.
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Dynamic Support & Resistance */}
        <div className="rounded-panel border border-border bg-panel">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <Crosshair size={12} className="text-zinc-600" />
            <SectionTitle>Dynamic Support &amp; Resistance</SectionTitle>
            <ProvenanceBadge kind="BROKER" />
            <ProvenanceBadge kind="COMPUTED" label="Levels" />
          </div>
          <div className="space-y-1 p-3">
            <Row label="Resistance (peak Call OI)" value={<span className="text-loss">{sr.resistance.toLocaleString("en-IN")} · {compact(sr.resistanceOi)}</span>} />
            <Row label="Resistance 2" value={<span className="text-loss/80">{sr.resistance2 ? sr.resistance2.toLocaleString("en-IN") : "—"}</span>} />
            <div className="my-1 border-t border-border-subtle/60" />
            <Row label="Spot" value={<span className="text-zinc-200">{dec(chain.spot, 1)}</span>} />
            <div className="my-1 border-t border-border-subtle/60" />
            <Row label="Support (peak Put OI)" value={<span className="text-gain">{sr.support.toLocaleString("en-IN")} · {compact(sr.supportOi)}</span>} />
            <Row label="Support 2" value={<span className="text-gain/80">{sr.support2 ? sr.support2.toLocaleString("en-IN") : "—"}</span>} />
          </div>
          <p className="px-3 pb-3 text-[9px] leading-relaxed text-zinc-700">
            Support = strike with the most Put OI (put writers defend it); resistance = strike with the most Call OI.
          </p>
        </div>

        {/* OI Trend — total CE vs PE OI */}
        <div className="rounded-panel border border-border bg-panel">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <Activity size={12} className="text-zinc-600" />
            <SectionTitle>OI Trend — Total CE vs PE</SectionTitle>
            <ProvenanceBadge kind="BROKER" />
          </div>
          <div className="space-y-2 p-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-2xs">
                <span className="text-zinc-500">Total Call OI</span>
                <span className="font-mono text-loss">{compact(chain.totalCeOi)} · {dec(cePct, 1)}%</span>
              </div>
              <Bar value={chain.totalCeOi} max={Math.max(chain.totalCeOi, chain.totalPeOi, 1)} tone="rose" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-2xs">
                <span className="text-zinc-500">Total Put OI</span>
                <span className="font-mono text-gain">{compact(chain.totalPeOi)} · {dec(pePct, 1)}%</span>
              </div>
              <Bar value={chain.totalPeOi} max={Math.max(chain.totalCeOi, chain.totalPeOi, 1)} tone="green" />
            </div>
            <div className="mt-2 border-t border-border-subtle/60 pt-2">
              <Row label="PCR (OI)" value={<Pill tone={pcrTone}>{dec(pcr, 2)}</Pill>} />
              <Row label="Volume PCR" value={<span className="text-zinc-300">{chain.totalCeVolume > 0 ? dec(chain.totalPeVolume / chain.totalCeVolume, 2) : "—"}</span>} />
              <p className="mt-1 text-[9px] leading-relaxed text-zinc-700">{pcrRead}.</p>
            </div>
          </div>
        </div>
      </div>

      {/* OI Heatmap */}
      <div className="rounded-panel border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <Layers size={12} className="text-zinc-600" />
          <SectionTitle>OI Heatmap — intensity by strike</SectionTitle>
          <ProvenanceBadge kind="BROKER" />
          <div className="ml-auto flex items-center gap-3 text-[9px] uppercase tracking-wider text-zinc-600">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-loss/70" /> CE</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-gain/70" /> PE</span>
          </div>
        </div>
        <div className="overflow-x-auto p-3">
          <div className="flex gap-2">
            <HeatColumn label="CE" rows={chain.rows.map((r) => ({ strike: r.strike, oi: r.ce.oi, isAtm: r.isAtm }))} peak={peakOi} side="ce" />
            <HeatColumn label="PE" rows={chain.rows.map((r) => ({ strike: r.strike, oi: r.pe.oi, isAtm: r.isAtm }))} peak={peakOi} side="pe" />
          </div>
        </div>
        <p className="px-3 pb-3 text-[9px] leading-relaxed text-zinc-700">
          Cell opacity scales with OI relative to the chain's peak OI ({compact(peakOi)}). Darker = heavier positioning.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HeadStat({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: Tone;
  icon: typeof Layers;
}) {
  const toneText: Record<Tone, string> = {
    green: "text-gain",
    rose: "text-loss",
    amber: "text-warn",
    blue: "text-info",
    zinc: "text-zinc-100",
  };
  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon size={12} className="text-zinc-600" strokeWidth={1.5} />
        <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      </div>
      <p className={`font-mono text-lg font-semibold ${toneText[tone]}`}>{value}</p>
      <p className="mt-0.5 truncate text-2xs text-zinc-600">{sub}</p>
    </div>
  );
}

function BuildupColumn({ title, tally }: { title: string; tally: BuildupTally }) {
  const m = tallyMax(tally);
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
      {TALLY_ROWS.map((row) => (
        <div key={row.key}>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-500">{row.label}</span>
            <span className="font-mono text-zinc-400">{compact(tally[row.key])}</span>
          </div>
          <Bar value={tally[row.key]} max={m} tone={row.tone} />
        </div>
      ))}
    </div>
  );
}

function HeatColumn({
  label,
  rows,
  peak,
  side,
}: {
  label: string;
  rows: { strike: number; oi: number; isAtm: boolean }[];
  peak: number;
  side: "ce" | "pe";
}) {
  // Explicit rgb so intensity reads clearly: rose for CE, green for PE.
  const rgb = side === "ce" ? "244, 63, 94" : "34, 197, 94";
  return (
    <div className="min-w-[88px] flex-1">
      <p className="mb-1 text-center text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{label}</p>
      <div className="space-y-0.5">
        {rows.map((r) => {
          const intensity = peak > 0 ? Math.min(1, r.oi / peak) : 0;
          return (
            <div
              key={r.strike}
              className={`flex items-center justify-between rounded px-2 py-0.5 text-[10px] ${
                r.isAtm ? "ring-1 ring-info/50" : ""
              }`}
              style={{ backgroundColor: `rgba(${rgb}, ${0.08 + intensity * 0.6})` }}
              title={`${label} ${r.strike}: ${r.oi.toLocaleString("en-IN")} OI`}
            >
              <span className={`font-mono ${r.isAtm ? "text-info" : "text-zinc-300"}`}>{r.strike}</span>
              <span className="font-mono text-zinc-200">{compact(r.oi)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
