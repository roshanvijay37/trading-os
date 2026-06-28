/**
 * TradingOS — Market Intelligence
 * Institutional-grade market analytics.
 *
 * Honesty contract: only the cards below the "Live" header are real — they are derived from the
 * live NIFTY option chain (+ India VIX) on every poll. Metrics we cannot source from FYERS
 * (market breadth, FII/DII flow, dealer gamma, IV rank/percentile/skew) are rendered as explicit
 * "no data source" cards rather than fabricated zeros, so the screen never implies fake numbers.
 */

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import {
  Activity, AlertTriangle, BarChart3, Eye, Gauge, Loader2,
  TrendingUp, Users, Wifi, WifiOff, Zap,
} from "lucide-react";

import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { accountApi, marketApi, isFyersConnected } from "../services/api";
import {
  normalizeOptionChain, extractSpot, extractIndiaVix,
  computePCR, computeMaxPain, computeExpectedMove, type IndiaVix,
} from "../lib/optionMetrics";
import { computeGammaExposure, nearestExpiryYears, type GammaExposure } from "../lib/gamma";

/** Shape returned by GET /api/market/iv-history (computeIvStats on the server). */
interface IvStats {
  current: number | null;
  rank: number | null;
  percentile: number | null;
  min: number | null;
  max: number | null;
  samples: number;
  lookbackDays: number;
  minSamples: number;
  sufficient: boolean;
}

const INTEL_SYMBOL = "NSE:NIFTY50-INDEX";
const INTEL_INTERVAL_MS = 30000;

type Status = "disconnected" | "loading" | "live" | "error";

function pcrInterpretation(pcr: number): string {
  if (pcr <= 0) return "—";
  if (pcr >= 1.3) return "Put-heavy (defensive)";
  if (pcr <= 0.7) return "Call-heavy (aggressive)";
  return "Neutral";
}

const STATUS_META: Record<Status, { label: string; cls: string; Icon: ElementType; spin?: boolean }> = {
  disconnected: { label: "Disconnected", cls: "border-warn/30 bg-warn-dim text-warn", Icon: WifiOff },
  loading: { label: "Loading…", cls: "border-border bg-panel text-zinc-400", Icon: Loader2, spin: true },
  live: { label: "Live", cls: "border-gain/30 bg-gain-dim text-gain", Icon: Wifi },
  error: { label: "No market data", cls: "border-loss/30 bg-loss-dim text-loss", Icon: AlertTriangle },
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function MarketIntelligencePage() {
  const { state, setMarketIntel } = useInstitutionalStore();
  const { marketIntel } = state;

  const [status, setStatus] = useState<Status>(() => (isFyersConnected() ? "loading" : "disconnected"));
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [vix, setVix] = useState<IndiaVix | null>(null);
  const [gex, setGex] = useState<GammaExposure | null>(null);
  const [ivStats, setIvStats] = useState<IvStats | null>(null);
  const prevPcrRef = useRef<number | null>(null);
  const hasData = lastUpdated !== null;

  // Compute PCR / Max Pain / Expected Move / India VIX from the live NIFTY option chain.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isFyersConnected()) {
        if (!cancelled) setStatus("disconnected");
        return;
      }
      if (!cancelled) setStatus((s) => (s === "live" ? "live" : "loading"));
      try {
        const res = await accountApi.getOptionChain(INTEL_SYMBOL, 15);
        if (cancelled) return;
        const legs = normalizeOptionChain(res?.optionChain);
        if (legs.length === 0) {
          // Connected, but the broker returned an empty chain (market closed / bad response).
          setStatus("error");
          return;
        }
        const spot = extractSpot(res?.optionChain);
        const pcr = computePCR(legs);
        const em = computeExpectedMove(legs, spot);
        const vixData = extractIndiaVix(res?.indiavix);
        const prev = prevPcrRef.current;
        const pcrChange = prev !== null ? Math.round((pcr - prev) * 100) / 100 : 0;
        prevPcrRef.current = pcr;

        setMarketIntel({
          pcr: {
            current: pcr,
            change: pcrChange,
            percentile: 0, // unsourced — not displayed (needs historical PCR series)
            trend: pcrChange > 0 ? "RISING" : pcrChange < 0 ? "FALLING" : "STABLE",
            interpretation: pcrInterpretation(pcr),
          },
          maxPain: { strike: computeMaxPain(legs), painValue: 0, nearestStrikes: [] },
          expectedMove: {
            move: em.move, movePercent: em.movePercent,
            upperBound: em.upper, lowerBound: em.lower, confidence: 0.68,
          },
        });
        setVix(vixData);

        // Dealer gamma (Black-Scholes, flat India VIX as σ, nearest expiry as T).
        const sigma = vixData ? vixData.value / 100 : 0;
        const t = nearestExpiryYears(res?.expiryData, Date.now());
        setGex(computeGammaExposure(legs, spot, sigma, t));

        setLastUpdated(Date.now());
        setStatus("live");

        // IV Rank/Percentile from the server's persisted VIX series (a fresh sample was just
        // recorded by this option-chain call). Isolated so its failure can't flip the page state.
        try {
          const iv = await marketApi.getIvHistory();
          if (!cancelled) setIvStats(iv);
        } catch {
          /* leave previous IV stats in place */
        }
      } catch {
        // Keep the last good values; surface a stale/error badge instead of silently freezing.
        if (!cancelled) setStatus("error");
      }
    }

    load();
    const id = setInterval(load, INTEL_INTERVAL_MS);
    const onLogout = () => {
      prevPcrRef.current = null;
      setStatus("disconnected");
    };
    window.addEventListener("fyers:logout", onLogout);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("fyers:logout", onLogout);
    };
  }, [setMarketIntel]);

  const meta = STATUS_META[status];

  return (
    <div className="space-y-5">
      {/* Header + connection status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-zinc-600">Real-time NIFTY option-chain analytics. Cards marked “No data source” are not available from the FYERS feed.</p>
        <div className="flex items-center gap-2">
          {lastUpdated !== null && (
            <span className="text-2xs text-zinc-600">Updated {fmtTime(lastUpdated)}</span>
          )}
          <span className={`inline-flex items-center gap-1.5 rounded-panel border px-2 py-1 text-2xs font-medium ${meta.cls}`}>
            <meta.Icon size={11} className={meta.spin ? "animate-spin" : ""} />
            {meta.label}
          </span>
        </div>
      </div>

      {/* Connection / data banner */}
      {status === "disconnected" && (
        <Banner tone="warn">Connect to FYERS to load live market intelligence. No data is shown while disconnected.</Banner>
      )}
      {status === "error" && (
        <Banner tone="loss">
          {hasData
            ? `Live feed interrupted — showing the last snapshot from ${fmtTime(lastUpdated!)}. Retrying every 30s.`
            : "Connected, but the option chain returned no data (the market may be closed). Retrying every 30s."}
        </Banner>
      )}

      {/* ─── Live (real) ─────────────────────────────────────────── */}
      <SectionTitle>Live</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Put/Call Ratio */}
        <Panel icon={Activity} title="Put/Call Ratio">
          <Row label="Current" value={hasData ? marketIntel.pcr.current.toFixed(2) : "—"} mono />
          <Row
            label="Change (since last poll)"
            value={hasData ? `${marketIntel.pcr.change >= 0 ? "+" : ""}${marketIntel.pcr.change.toFixed(2)}` : "—"}
            mono
            valueClass={!hasData ? "" : marketIntel.pcr.change > 0 ? "text-gain" : marketIntel.pcr.change < 0 ? "text-loss" : ""}
          />
          <Row label="Interpretation" value={hasData ? marketIntel.pcr.interpretation : "—"} />
        </Panel>

        {/* Max Pain */}
        <Panel icon={Zap} title="Max Pain">
          <Row label="Strike" value={hasData ? `₹${marketIntel.maxPain.strike.toLocaleString()}` : "—"} mono />
          <Row label="Expected Move" value={hasData ? `±${marketIntel.expectedMove.movePercent.toFixed(2)}%` : "—"} mono />
          <Row
            label="Range"
            value={hasData && marketIntel.expectedMove.move > 0
              ? `₹${marketIntel.expectedMove.lowerBound.toLocaleString()} – ₹${marketIntel.expectedMove.upperBound.toLocaleString()}`
              : "—"}
            mono
          />
        </Panel>

        {/* India VIX */}
        <Panel icon={Gauge} title="India VIX">
          {hasData && vix ? (
            <>
              <p className="font-mono text-xl font-semibold text-zinc-100">{vix.value.toFixed(2)}</p>
              <p className={`text-2xs font-mono ${vix.change >= 0 ? "text-gain" : "text-loss"}`}>
                {vix.change >= 0 ? "+" : ""}{vix.change.toFixed(2)} ({vix.changePercent >= 0 ? "+" : ""}{vix.changePercent.toFixed(2)}%)
              </p>
              <p className="mt-1 text-2xs text-zinc-700">Market-wide implied volatility</p>
            </>
          ) : (
            <p className="font-mono text-xl font-semibold text-zinc-700">—</p>
          )}
        </Panel>

        {/* IV Rank / Percentile (from the persisted India VIX series) */}
        <Panel icon={BarChart3} title="IV Rank / Percentile">
          {ivStats && ivStats.sufficient && ivStats.rank !== null && ivStats.percentile !== null ? (
            <>
              <Row label="IV Rank" value={ivStats.rank.toFixed(0)} mono />
              <Row label="IV Percentile" value={`${ivStats.percentile.toFixed(0)}%`} mono />
              <Row
                label="Range"
                value={ivStats.min !== null && ivStats.max !== null ? `${ivStats.min.toFixed(1)} – ${ivStats.max.toFixed(1)}` : "—"}
                mono
              />
              <p className="pt-1 text-2xs text-zinc-700">{ivStats.samples}-day history · skew unavailable (no per-strike IV)</p>
            </>
          ) : (
            <>
              <p className="font-mono text-xl font-semibold text-zinc-700">—</p>
              <p className="text-2xs text-zinc-600">
                {ivStats
                  ? `Building history — ${ivStats.samples}/${ivStats.minSamples} days needed for a meaningful rank.`
                  : "Connect to begin recording India VIX history."}
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* ─── Model-derived (Black-Scholes) ───────────────────────── */}
      <SectionTitle>Model-derived (Black-Scholes)</SectionTitle>
      <div className="rounded-panel border border-border bg-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye size={12} className="text-zinc-600" />
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">Gamma Exposure (Dealer GEX)</h3>
          <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">Model</span>
        </div>
        {gex ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-2xs text-zinc-600">Net Gamma</p>
                <p className={`font-mono text-2xs ${gex.totalGamma >= 0 ? "text-gain" : "text-loss"}`}>
                  {gex.totalGamma >= 0 ? "+" : ""}₹{gex.totalGamma.toLocaleString()}Cr / 1% move
                </p>
              </div>
              <div>
                <p className="text-2xs text-zinc-600">Zero-Gamma (Flip)</p>
                <p className="font-mono text-2xs text-zinc-200">{gex.zeroGammaLevel > 0 ? `₹${gex.zeroGammaLevel.toLocaleString()}` : "—"}</p>
              </div>
              <div>
                <p className="text-2xs text-zinc-600">Hedge Delta</p>
                <p className="font-mono text-2xs text-zinc-200">{gex.estimatedHedgeDelta.toLocaleString()} / pt</p>
              </div>
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-zinc-700">
              Modelled from a flat India VIX (no per-strike skew) and the nearest expiry; calls-add/puts-subtract dealer convention. Directional read, not a measured Greek.
            </p>
          </>
        ) : (
          <p className="text-2xs text-zinc-600">
            Needs a live India VIX and a parseable expiry from the option chain to model gamma. {status === "disconnected" ? "Connect to FYERS to load." : "Waiting for data…"}
          </p>
        )}
      </div>

      {/* ─── Not available from the FYERS feed ───────────────────── */}
      <SectionTitle>Not available from the FYERS feed</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Unavailable
          icon={TrendingUp}
          title="Market Breadth (Advance / Decline)"
          reason="Requires an NSE advance/decline / index-constituent feed. FYERS does not expose market breadth, so no breadth source is wired."
        />
        <Unavailable
          icon={Users}
          title="Institutional Flow (FII / DII)"
          reason="FII/DII cash & F&O figures come from NSE end-of-day participant data, which is not connected to this backend."
        />
      </div>
    </div>
  );
}

// ─── Presentational helpers ───────────────────────────────────────

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{children}</h2>;
}

function Banner({ tone, children }: { tone: "warn" | "loss"; children: ReactNode }) {
  const cls = tone === "warn" ? "border-warn/30 bg-warn-dim text-warn" : "border-loss/30 bg-loss-dim text-loss";
  return (
    <div className={`flex items-start gap-2 rounded-panel border px-3 py-2 ${cls}`}>
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <p className="text-2xs">{children}</p>
    </div>
  );
}

function Panel({ icon: Icon, title, children }: { icon: ElementType; title: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-border bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={12} className="text-zinc-600" />
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value, mono, valueClass }: { label: string; value: string; mono?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-2xs text-zinc-600">{label}</span>
      <span className={`text-2xs ${mono ? "font-mono text-zinc-200" : "text-zinc-400"} ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function Unavailable({ icon: Icon, title, reason }: { icon: ElementType; title: string; reason: string }) {
  return (
    <div className="rounded-panel border border-border bg-panel/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={12} className="text-zinc-700" />
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-zinc-600">{title}</h3>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">No data source</span>
      </div>
      <p className="text-2xs leading-relaxed text-zinc-600">{reason}</p>
    </div>
  );
}
