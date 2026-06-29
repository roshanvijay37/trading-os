/**
 * Option Flow — an HONEST flow read on a retail feed.
 *
 * FYERS' retail API exposes NO block-trade tape, no exchange order flags, and no
 * smart-money/institutional print stream. So nothing here pretends to be a real options
 * tape. Instead we build defensible PROXIES from the live chain (clearly badged PROXY):
 *   - "Unusual Activity" = strikes where volume runs hot vs OI (vol/OI) or |ΔOI| is top-tier.
 *   - "Call vs Put Flow"  = Σ(volume × ltp) premium turnover per side, with a bias bar.
 *   - "Premium Flow"      = total premium traded (Σ volume × ltp), split CE / PE.
 * The only genuine institutional figure available is NSE's EOD FII/DII CASH-market flow
 * (badged EOD) — fetched from marketApi.getFiiDii(); when unreachable we say so plainly.
 * True block / sweep tape is shown as UNAVAILABLE with a one-line reason. Never invented.
 */

import { useEffect, useMemo, useState } from "react";
import { Waves, Zap, Building2, Ban, ArrowLeftRight } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Bar, Pill, Row, SectionTitle, Banner, type Tone } from "../components/ui";
import { compact, dec, signed, money, toneClass } from "../lib/format";
import { marketApi } from "../../services/api";
import type { EnrichedChain } from "../types";

// Shape returned by GET /api/market/fii-dii (NSE EOD participant data, ₹ crore per leg).
interface FiiDiiLeg {
  buy: number | null;
  sell: number | null;
  net: number | null;
}
interface FiiDiiResponse {
  available: boolean;
  source?: string;
  fetchedAt?: string;
  stale?: boolean;
  error?: string;
  date?: string | null;
  fii?: FiiDiiLeg | null;
  dii?: FiiDiiLeg | null;
}

export function FlowPanel() {
  return (
    <Panel
      title="Option Flow"
      icon={Waves}
      badge={<ProvenanceBadge kind="PROXY" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <div className="space-y-3">
        <Banner tone="info">
          The FYERS retail feed has no block-trade or smart-money tape. Everything below is a
          defensible PROXY derived from the live chain, or NSE EOD cash data — labelled per source.
        </Banner>
        <ChainGate>{(chain) => <FlowBody chain={chain} />}</ChainGate>
        <FiiDiiBlock />
        <UnavailableBlock />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Chain-derived proxies
// ---------------------------------------------------------------------------

interface UnusualRow {
  strike: number;
  type: "CE" | "PE";
  volume: number;
  oi: number;
  volOi: number;
  oiChange: number;
  premium: number; // ₹ notional turnover = volume × ltp × (1, lot-size-agnostic per-unit)
}

function FlowBody({ chain }: { chain: EnrichedChain }) {
  // Premium turnover per side: Σ(volume × ltp). Per-unit (lot size cancels in the CE/PE ratio).
  const { ceTurnover, peTurnover, unusual } = useMemo(() => {
    let ce = 0;
    let pe = 0;
    const rows: UnusualRow[] = [];
    for (const r of chain.rows) {
      const cePrem = r.ce.volume * r.ce.ltp;
      const pePrem = r.pe.volume * r.pe.ltp;
      ce += cePrem;
      pe += pePrem;
      if (r.ce.volume > 0 || r.ce.oiChange !== 0) {
        rows.push({
          strike: r.strike,
          type: "CE",
          volume: r.ce.volume,
          oi: r.ce.oi,
          volOi: r.ce.oi > 0 ? r.ce.volume / r.ce.oi : 0,
          oiChange: r.ce.oiChange,
          premium: cePrem,
        });
      }
      if (r.pe.volume > 0 || r.pe.oiChange !== 0) {
        rows.push({
          strike: r.strike,
          type: "PE",
          volume: r.pe.volume,
          oi: r.pe.oi,
          volOi: r.pe.oi > 0 ? r.pe.volume / r.pe.oi : 0,
          oiChange: r.pe.oiChange,
          premium: pePrem,
        });
      }
    }
    // Screen: rank by a blend of vol/OI ratio (churn) and |ΔOI| (fresh positioning).
    // Both are normalised so neither dominates, then we surface the top contracts.
    const maxVolOi = Math.max(1, ...rows.map((x) => x.volOi));
    const maxAbsChg = Math.max(1, ...rows.map((x) => Math.abs(x.oiChange)));
    const scored = rows
      .map((x) => ({ ...x, score: x.volOi / maxVolOi + Math.abs(x.oiChange) / maxAbsChg }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return { ceTurnover: ce, peTurnover: pe, unusual: scored };
  }, [chain.rows]);

  const total = ceTurnover + peTurnover;
  const cePct = total > 0 ? (ceTurnover / total) * 100 : 0;
  const pePct = total > 0 ? (peTurnover / total) * 100 : 0;
  const bias = cePct - pePct;
  const biasTone: Tone = bias > 8 ? "rose" : bias < -8 ? "green" : "zinc";
  const biasRead =
    bias > 8 ? "Call premium dominant — upside chasing / call writing" : bias < -8 ? "Put premium dominant — hedging / put writing" : "Balanced premium turnover";

  return (
    <>
      {/* Call vs Put premium flow */}
      <div className="rounded-panel border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <ArrowLeftRight size={12} className="text-zinc-600" />
          <SectionTitle>Call Flow vs Put Flow — premium turnover</SectionTitle>
          <ProvenanceBadge kind="PROXY" />
        </div>
        <div className="space-y-2 p-3">
          {/* Bias bar — single track split CE (left, rose) / PE (right, green) */}
          <div className="flex h-3 w-full overflow-hidden rounded-sm bg-surface">
            <div className="h-full bg-loss/60" style={{ width: `${cePct}%` }} title={`Call ${dec(cePct, 1)}%`} />
            <div className="h-full bg-gain/60" style={{ width: `${pePct}%` }} title={`Put ${dec(pePct, 1)}%`} />
          </div>
          <div className="flex items-center justify-between text-2xs">
            <span className="font-mono text-loss">Calls {money(ceTurnover)} · {dec(cePct, 1)}%</span>
            <span className="font-mono text-gain">{dec(pePct, 1)}% · {money(peTurnover)} Puts</span>
          </div>
          <div className="border-t border-border-subtle/60 pt-2">
            <Row
              label="Flow bias"
              value={<Pill tone={biasTone}>{bias >= 0 ? "Calls" : "Puts"} {signed(Math.abs(bias), 1)}%</Pill>}
            />
            <p className="mt-1 text-[9px] leading-relaxed text-zinc-700">
              Proxy: Σ(volume × LTP) per side. Premium turnover, not directional buy/sell — the retail feed
              doesn't flag aggressor side. {biasRead}.
            </p>
          </div>
        </div>
      </div>

      {/* Premium flow totals */}
      <div className="grid grid-cols-3 gap-2">
        <FlowStat label="Total Premium" value={money(total)} sub="Σ vol × LTP (per-unit)" tone="zinc" />
        <FlowStat label="Call Premium" value={money(ceTurnover)} sub={`${dec(cePct, 1)}% of flow`} tone="rose" />
        <FlowStat label="Put Premium" value={money(peTurnover)} sub={`${dec(pePct, 1)}% of flow`} tone="green" />
      </div>

      {/* Unusual activity table */}
      <div className="rounded-panel border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <Zap size={12} className="text-zinc-600" />
          <SectionTitle>Large Trades / Unusual Activity</SectionTitle>
          <ProvenanceBadge kind="PROXY" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                <th className="px-2 py-1.5 text-left">Strike</th>
                <th className="px-2 py-1.5 text-left">Type</th>
                <th className="px-2 py-1.5 text-right">Volume</th>
                <th className="px-2 py-1.5 text-right">OI</th>
                <th className="px-2 py-1.5 text-right">Vol/OI</th>
                <th className="px-2 py-1.5 text-right">ΔOI</th>
                <th className="px-2 py-1.5 text-right">Premium</th>
              </tr>
            </thead>
            <tbody>
              {unusual.map((u) => (
                <tr key={`${u.strike}-${u.type}`} className="border-b border-border-subtle/60 hover:bg-surface/60">
                  <td className="px-2 py-1 text-left font-mono text-zinc-300">{u.strike}</td>
                  <td className="px-2 py-1 text-left">
                    <span className={`font-mono ${u.type === "CE" ? "text-loss" : "text-gain"}`}>{u.type}</span>
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-zinc-300">{compact(u.volume)}</td>
                  <td className="px-2 py-1 text-right font-mono text-zinc-400">{compact(u.oi)}</td>
                  <td className="px-2 py-1 text-right font-mono">
                    <span className={u.volOi >= 1 ? "text-warn" : "text-zinc-400"}>{u.oi > 0 ? dec(u.volOi, 2) : "—"}</span>
                  </td>
                  <td className={`px-2 py-1 text-right font-mono ${toneClass(u.oiChange)}`}>{signed(u.oiChange, 0)}</td>
                  <td className="px-2 py-1 text-right font-mono text-zinc-300">{money(u.premium)}</td>
                </tr>
              ))}
              {unusual.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-center text-2xs text-zinc-600">No volume or OI movement yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-3 pb-3 pt-2 text-[9px] leading-relaxed text-zinc-700">
          Proxy screen: ranked by vol/OI churn + fresh |ΔOI|. A high vol/OI ratio means today's volume rivals
          standing OI (intraday churn). This is NOT a block-trade tape — the retail feed exposes none.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// FII / DII EOD block (genuine institutional figure — cash market, end of day)
// ---------------------------------------------------------------------------

function FiiDiiBlock() {
  const [data, setData] = useState<FiiDiiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const d = (await marketApi.getFiiDii()) as FiiDiiResponse;
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled) setData({ available: false, error: err instanceof Error ? err.message : "request failed" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasFigures = !!data?.available && (!!data.fii || !!data.dii);

  return (
    <div className="rounded-panel border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Building2 size={12} className="text-zinc-600" />
        <SectionTitle>Smart Money — FII / DII Cash Flow</SectionTitle>
        <ProvenanceBadge kind="EOD" />
      </div>
      <div className="p-3">
        {loading ? (
          <p className="text-2xs text-zinc-600">Loading NSE end-of-day figures…</p>
        ) : hasFigures ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FiiDiiLegView label="FII / FPI (Foreign)" leg={data?.fii} />
              <FiiDiiLegView label="DII (Domestic)" leg={data?.dii} />
            </div>
            <p className="mt-3 text-[9px] leading-relaxed text-zinc-700">
              Net cash buy/sell in ₹ crore{data?.date ? ` · as of ${data.date}` : ""}. Source: NSE participant data
              {data?.stale ? " · cached (latest NSE refresh failed)" : ""}. This is END-OF-DAY NSE CASH-market flow —
              not intraday options flow.
            </p>
          </>
        ) : (
          <p className="text-2xs leading-relaxed text-zinc-600">
            NSE end-of-day FII/DII data is currently unreachable{data?.error ? ` (${data.error})` : ""}. NSE
            rate-limits non-browser clients, so this can fail from some hosts; nothing is shown rather than guessed.
          </p>
        )}
      </div>
    </div>
  );
}

function FiiDiiLegView({ label, leg }: { label: string; leg?: FiiDiiLeg | null }) {
  const net = leg?.net ?? null;
  const netClass = net == null ? "text-zinc-700" : net >= 0 ? "text-gain" : "text-loss";
  return (
    <div className="rounded-panel border border-border bg-surface/40 p-3">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${netClass}`}>
        {net == null ? "—" : `${net >= 0 ? "+" : "-"}₹${Math.abs(net).toLocaleString("en-IN")} Cr`}
      </p>
      <div className="mt-1.5 space-y-0.5">
        <Row label="Buy" value={<span className="text-zinc-300">{leg?.buy == null ? "—" : `₹${leg.buy.toLocaleString("en-IN")} Cr`}</span>} />
        <Row label="Sell" value={<span className="text-zinc-300">{leg?.sell == null ? "—" : `₹${leg.sell.toLocaleString("en-IN")} Cr`}</span>} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Genuinely unavailable: real block / sweep / institutional options tape
// ---------------------------------------------------------------------------

function UnavailableBlock() {
  return (
    <div className="rounded-panel border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Ban size={12} className="text-zinc-600" />
        <SectionTitle>Institutional Options Tape</SectionTitle>
        <ProvenanceBadge kind="UNAVAILABLE" />
      </div>
      <div className="space-y-1.5 p-3">
        <UnavailableRow item="Block trades" reason="FYERS retail API exposes no block-trade prints or sizes." />
        <UnavailableRow item="Sweep / multi-leg detection" reason="No exchange aggressor or order-routing flags in the retail feed." />
        <UnavailableRow item="Smart-money / dealer print stream" reason="No real-time institutional options tape is available to retail." />
      </div>
    </div>
  );
}

function UnavailableRow({ item, reason }: { item: string; reason: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle/60 py-1 last:border-0">
      <span className="text-2xs text-zinc-400">{item}</span>
      <span className="max-w-[60%] text-right text-[9px] leading-relaxed text-zinc-700">{reason}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared stat tile
// ---------------------------------------------------------------------------

function FlowStat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: Tone }) {
  const toneText: Record<Tone, string> = {
    green: "text-gain",
    rose: "text-loss",
    amber: "text-warn",
    blue: "text-info",
    zinc: "text-zinc-100",
  };
  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      <p className={`mt-1 font-mono text-base font-semibold ${toneText[tone]}`}>{value}</p>
      <p className="mt-0.5 truncate text-2xs text-zinc-600">{sub}</p>
    </div>
  );
}
