/**
 * Institutional Summary — the flagship landing dashboard for the Options Workspace.
 *
 * A grid of tiles + sections that fuses the live chain into one read: Market Bias
 * (computeSentiment), Dealer Gamma Exposure (computeGammaExposure over OI-weighted legs),
 * Volatility (India VIX + solved per-strike IV), OI / PCR positioning, dynamic
 * support/resistance, key risk zones, and a rule-based natural-language synthesis.
 *
 * Every number is sourced from `chain`, the shared libs, or `data` — nothing is fabricated.
 * Metrics with no source render an honest UNAVAILABLE badge instead of a fake value.
 */

import { useMemo } from "react";
import {
  LayoutDashboard,
  Gauge,
  Activity,
  Layers,
  Scale,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import {
  Panel,
  ProvenanceBadge,
  SectionTitle,
  Stat,
  Row,
  Bar,
  Pill,
  Banner,
  type Tone,
} from "../components/ui";
import { computeSentiment, type SentimentLabel } from "../lib/sentiment";
import { supportResistance } from "../lib/oi";
import { ivSummary } from "../lib/volatility";
import { compact, dec, signed, volPct } from "../lib/format";
import { computeGammaExposure, type GammaExposure } from "../../lib/gamma";
import type { OptionLeg } from "../../lib/optionMetrics";
import type { EnrichedChain } from "../types";

const BIAS_TONE: Record<SentimentLabel, Tone> = {
  BULLISH: "green",
  BEARISH: "rose",
  NEUTRAL: "amber",
};

const BIAS_ICON: Record<SentimentLabel, typeof TrendingUp> = {
  BULLISH: TrendingUp,
  BEARISH: TrendingDown,
  NEUTRAL: Minus,
};

export function SummaryPanel() {
  return (
    <Panel
      title="Institutional Summary"
      icon={LayoutDashboard}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <SummaryBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function SummaryBody({ chain }: { chain: EnrichedChain }) {
  const sentiment = useMemo(() => computeSentiment(chain), [chain]);
  const sr = useMemo(() => supportResistance(chain), [chain]);
  const iv = useMemo(() => ivSummary(chain), [chain]);

  const gex = useMemo<GammaExposure | null>(() => {
    const legs: OptionLeg[] = chain.rows.flatMap((r) => [
      { type: "CE", strike: r.strike, oi: r.ce.oi, ltp: r.ce.ltp },
      { type: "PE", strike: r.strike, oi: r.pe.oi, ltp: r.pe.ltp },
    ]);
    const sigma = chain.vix ? chain.vix.value / 100 : 0;
    const t = chain.selectedExpiry?.t ?? 0;
    return computeGammaExposure(legs, chain.spot, sigma, t, { lotSize: chain.instrument.lotSize });
  }, [chain]);

  const BiasIcon = BIAS_ICON[sentiment.label];
  const biasTone = BIAS_TONE[sentiment.label];

  // -100..+100 → 0..100 for the gauge fill.
  const gaugePct = Math.min(100, Math.max(0, (sentiment.score + 100) / 2));

  const pcrTone: Tone = chain.pcr >= 1 ? "green" : chain.pcr > 0 ? "rose" : "zinc";
  const oiSkew = chain.totalCeOi + chain.totalPeOi;

  return (
    <div className="space-y-3">
      {/* ---- Headline tiles ---- */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          label="Market Bias"
          value={sentiment.label}
          tone={biasTone}
          icon={BiasIcon}
          sub={`Score ${signed(sentiment.score, 0)} · conf ${Math.round(sentiment.confidence * 100)}%`}
        />
        <Stat
          label="Spot"
          value={dec(chain.spot, 1)}
          tone="zinc"
          icon={Activity}
          sub={`${chain.instrument.label} · ATM ${chain.atmStrike}`}
        />
        <Stat
          label="PCR"
          value={chain.pcr > 0 ? dec(chain.pcr, 2) : "—"}
          tone={pcrTone}
          icon={Scale}
          sub={chain.pcr >= 1 ? "Put-heavy" : chain.pcr > 0 ? "Call-heavy" : "No OI"}
        />
        <Stat
          label="India VIX"
          value={chain.vix ? dec(chain.vix.value, 2) : "—"}
          tone={chain.vix ? (chain.vix.change >= 0 ? "green" : "rose") : "zinc"}
          icon={Gauge}
          sub={chain.vix ? `${signed(chain.vix.change, 2)} (${signed(chain.vix.changePercent, 1)}%)` : "No VIX feed"}
        />
      </div>

      {/* ---- Market Bias gauge ---- */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Market Bias</SectionTitle>
          <Pill tone={biasTone}>{sentiment.label}</Pill>
        </div>
        <BiasGauge pct={gaugePct} score={sentiment.score} tone={biasTone} />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Row label="Score" value={signed(sentiment.score, 0)} valueClass="text-zinc-200" />
          <Row label="Confidence" value={`${Math.round(sentiment.confidence * 100)}%`} valueClass="text-zinc-200" />
          <Row label="Signals" value={String(sentiment.factors.length)} valueClass="text-zinc-200" />
        </div>
      </div>

      {/* ---- Two-column: Gamma + Volatility ---- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Dealer Gamma Exposure */}
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Layers size={12} className="text-zinc-600" />
            <SectionTitle>Dealer Gamma Exposure</SectionTitle>
            <ProvenanceBadge kind="COMPUTED" />
          </div>
          {gex ? (
            <div className="space-y-0.5">
              <Row
                label="Net Dealer Gamma"
                value={`${signed(gex.totalGamma, 2)} Cr/1%`}
                valueClass={gex.totalGamma >= 0 ? "text-gain" : "text-loss"}
              />
              <Row
                label="Gamma Flip"
                value={gex.flipPoint > 0 ? String(gex.flipPoint) : "—"}
                valueClass="text-zinc-200"
              />
              <Row
                label="Hedge Δ / point"
                value={signed(gex.estimatedHedgeDelta, 0)}
                valueClass="text-zinc-200"
              />
              <p className="mt-2 text-2xs leading-relaxed text-zinc-600">
                {gex.totalGamma >= 0
                  ? "Positive net gamma → dealers buy dips / sell rips, dampening moves (pinning likely)."
                  : "Negative net gamma → dealers sell weakness / buy strength, amplifying moves (trend risk)."}{" "}
                Model assumes a flat IV (VIX) and the long-call/short-put dealer convention.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <ProvenanceBadge kind="UNAVAILABLE" />
              <p className="text-2xs text-zinc-600">
                Gamma needs spot, a VIX-based IV and time to expiry. One of these is missing in the live snapshot — shown
                blank rather than as a zero.
              </p>
            </div>
          )}
        </div>

        {/* Volatility */}
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Gauge size={12} className="text-zinc-600" />
            <SectionTitle>Volatility</SectionTitle>
            <ProvenanceBadge kind="COMPUTED" />
          </div>
          <div className="space-y-0.5">
            <Row
              label="India VIX"
              value={chain.vix ? `${dec(chain.vix.value, 2)} (${signed(chain.vix.changePercent, 1)}%)` : "—"}
              valueClass={chain.vix ? (chain.vix.change >= 0 ? "text-gain" : "text-loss") : "text-zinc-500"}
            />
            <Row label="Avg chain IV" value={iv.avg > 0 ? volPct(iv.avg) : "—"} valueClass="text-zinc-200" />
            <Row label="IV high" value={iv.high > 0 ? volPct(iv.high) : "—"} valueClass="text-loss" />
            <Row label="IV low" value={iv.low > 0 ? volPct(iv.low) : "—"} valueClass="text-gain" />
            {!chain.vix && (
              <p className="mt-2 text-2xs text-zinc-600">
                India VIX feed absent in this snapshot; chain IV is the per-strike Black-Scholes solve.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- OI / Positioning ---- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Activity size={12} className="text-zinc-600" />
            <SectionTitle>OI Trend &amp; PCR</SectionTitle>
            <ProvenanceBadge kind="BROKER" />
          </div>
          <div className="space-y-2">
            <div>
              <div className="mb-1 flex items-center justify-between text-2xs">
                <span className="text-loss">CE OI {compact(chain.totalCeOi)}</span>
                <span className="text-gain">PE OI {compact(chain.totalPeOi)}</span>
              </div>
              <div className="flex gap-1">
                <div className="flex-1">
                  <Bar value={chain.totalCeOi} max={oiSkew} tone="rose" align="right" />
                </div>
                <div className="flex-1">
                  <Bar value={chain.totalPeOi} max={oiSkew} tone="green" />
                </div>
              </div>
            </div>
            <Row
              label="PCR (PE/CE OI)"
              value={chain.pcr > 0 ? dec(chain.pcr, 2) : "—"}
              valueClass={pcrTone === "green" ? "text-gain" : pcrTone === "rose" ? "text-loss" : "text-zinc-200"}
            />
            <Row label="CE Volume" value={compact(chain.totalCeVolume)} valueClass="text-zinc-200" />
            <Row label="PE Volume" value={compact(chain.totalPeVolume)} valueClass="text-zinc-200" />
          </div>
        </div>

        {/* Institutional Positioning */}
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Scale size={12} className="text-zinc-600" />
            <SectionTitle>Institutional Positioning</SectionTitle>
            <ProvenanceBadge kind="BROKER" />
          </div>
          <div className="space-y-0.5">
            <Row
              label="Resistance (top CE OI)"
              value={sr.resistance > 0 ? `${sr.resistance} · ${compact(sr.resistanceOi)}` : "—"}
              valueClass="text-loss"
            />
            <Row label="Resistance 2" value={sr.resistance2 > 0 ? String(sr.resistance2) : "—"} valueClass="text-zinc-300" />
            <Row
              label="Support (top PE OI)"
              value={sr.support > 0 ? `${sr.support} · ${compact(sr.supportOi)}` : "—"}
              valueClass="text-gain"
            />
            <Row label="Support 2" value={sr.support2 > 0 ? String(sr.support2) : "—"} valueClass="text-zinc-300" />
            <p className="mt-2 text-2xs text-zinc-600">
              Put writers defend support; call writers cap resistance. Levels are the strikes with the most open interest.
            </p>
          </div>
        </div>
      </div>

      {/* ---- Major Risk Zones ---- */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <ShieldAlert size={12} className="text-zinc-600" />
          <SectionTitle>Major Risk Zones</SectionTitle>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <ZoneTile label="Max Pain" value={chain.maxPain > 0 ? String(chain.maxPain) : "—"} tone="amber" spot={chain.spot} level={chain.maxPain} />
          <ZoneTile
            label="Gamma Flip"
            value={gex && gex.flipPoint > 0 ? String(gex.flipPoint) : "—"}
            tone="blue"
            spot={chain.spot}
            level={gex?.flipPoint ?? 0}
          />
          <ZoneTile label="Support" value={sr.support > 0 ? String(sr.support) : "—"} tone="green" spot={chain.spot} level={sr.support} />
          <ZoneTile label="Resistance" value={sr.resistance > 0 ? String(sr.resistance) : "—"} tone="rose" spot={chain.spot} level={sr.resistance} />
        </div>
      </div>

      {/* ---- Rule-based AI Summary ---- */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles size={12} className="text-info" />
          <SectionTitle>AI Summary</SectionTitle>
          <ProvenanceBadge kind="COMPUTED" />
        </div>
        <Banner tone="info">
          Rule-based synthesis of the live signals above — a deterministic heuristic, not a generative or fabricated forecast.
        </Banner>
        <div className="mt-2 space-y-1.5">
          {buildNarrative(chain, sentiment.label, sentiment.score, sr, gex, iv).map((line, i) => (
            <p key={i} className="text-2xs leading-relaxed text-zinc-300">
              <span className="mr-1 text-zinc-600">›</span>
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function BiasGauge({ pct, score, tone }: { pct: number; score: number; tone: Tone }) {
  const fill = tone === "green" ? "bg-gain/60" : tone === "rose" ? "bg-loss/60" : "bg-warn/60";
  return (
    <div className="relative">
      <div className="flex justify-between text-[9px] uppercase tracking-wider text-zinc-600">
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>
      <div className="relative mt-1 h-3 w-full overflow-hidden rounded-sm bg-surface">
        {/* center marker */}
        <div className="absolute left-1/2 top-0 z-10 h-full w-px bg-border" />
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <div
        className="mt-0.5 text-2xs font-mono text-zinc-500"
        style={{ marginLeft: `calc(${Math.min(96, Math.max(2, pct))}% - 12px)` }}
      >
        {signed(score, 0)}
      </div>
    </div>
  );
}

function ZoneTile({
  label,
  value,
  tone,
  spot,
  level,
}: {
  label: string;
  value: string;
  tone: Tone;
  spot: number;
  level: number;
}) {
  const distPct = level > 0 && spot > 0 ? ((level - spot) / spot) * 100 : NaN;
  const textTone =
    tone === "green" ? "text-gain" : tone === "rose" ? "text-loss" : tone === "amber" ? "text-warn" : "text-info";
  return (
    <div className="rounded-panel border border-border bg-surface/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className={`mt-0.5 font-mono text-sm font-semibold ${textTone}`}>{value}</p>
      <p className="text-[9px] font-mono text-zinc-600">
        {Number.isFinite(distPct) ? `${signed(distPct, 1)}% from spot` : "—"}
      </p>
    </div>
  );
}

/** Deterministic natural-language synthesis of the live signals. No fabricated numbers. */
function buildNarrative(
  chain: EnrichedChain,
  label: SentimentLabel,
  score: number,
  sr: ReturnType<typeof supportResistance>,
  gex: GammaExposure | null,
  iv: ReturnType<typeof ivSummary>,
): string[] {
  const lines: string[] = [];

  lines.push(
    `Composite bias reads ${label} (${signed(score, 0)}/100) on ${chain.instrument.label} at ${dec(chain.spot, 1)}, ` +
      `weighing PCR, OI build-up, ATM price action and the max-pain pull.`,
  );

  if (chain.pcr > 0) {
    lines.push(
      `PCR ${dec(chain.pcr, 2)} is ${chain.pcr >= 1.3 ? "strongly put-heavy" : chain.pcr >= 1 ? "put-leaning" : chain.pcr <= 0.6 ? "strongly call-heavy" : "call-leaning"} ` +
        `(${compact(chain.totalPeOi)} PE vs ${compact(chain.totalCeOi)} CE OI) — ${chain.pcr >= 1 ? "support building beneath price" : "resistance building overhead"}.`,
    );
  }

  if (sr.support > 0 && sr.resistance > 0) {
    lines.push(
      `Heaviest OI walls sit at ${sr.resistance} (call resistance) and ${sr.support} (put support); ` +
        `a clean break of either redraws the trading range.`,
    );
  }

  if (chain.maxPain > 0) {
    const rel = chain.spot - chain.maxPain;
    lines.push(
      `Max pain is ${chain.maxPain}, ${Math.abs(rel) < 1 ? "right at spot" : rel > 0 ? `${dec(rel, 0)} pts below spot (downward pull into expiry)` : `${dec(-rel, 0)} pts above spot (upward pull into expiry)`}.`,
    );
  }

  if (gex) {
    lines.push(
      gex.totalGamma >= 0
        ? `Net dealer gamma is positive (${signed(gex.totalGamma, 2)} Cr/1%)${gex.flipPoint > 0 ? `, flipping negative below ${gex.flipPoint}` : ""} — expect mean-reversion and pinning while above the flip.`
        : `Net dealer gamma is negative (${signed(gex.totalGamma, 2)} Cr/1%)${gex.flipPoint > 0 ? `, turning positive above ${gex.flipPoint}` : ""} — hedging flows amplify moves; trend and gap risk are elevated.`,
    );
  }

  if (iv.avg > 0 && chain.vix) {
    lines.push(
      `India VIX ${dec(chain.vix.value, 2)} with average chain IV ${volPct(iv.avg)} (range ${volPct(iv.low)}–${volPct(iv.high)}); ` +
        `${chain.vix.change >= 0 ? "rising vol favours premium sellers being cautious" : "easing vol supports premium-selling structures"}.`,
    );
  }

  return lines;
}
