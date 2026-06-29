/**
 * Market Sentiment — a transparent, factor-by-factor read of the live chain.
 *
 * computeSentiment(chain) yields a BULLISH / BEARISH / NEUTRAL verdict on a -100..+100
 * scale plus an itemised list of individually-scored factors (PCR, OI build-up, ATM price
 * action, max-pain pull, S/R position). Each factor is rendered with a signed score bar and
 * an explanation, so the verdict is auditable rather than a black box.
 *
 * Every value comes from `computeSentiment` over the live `chain`. Nothing is fabricated.
 */

import { useMemo } from "react";
import { Compass, TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, SectionTitle, Row, Pill, Banner, type Tone } from "../components/ui";
import { computeSentiment, type SentimentFactor, type SentimentLabel } from "../lib/sentiment";
import { signed } from "../lib/format";
import type { EnrichedChain } from "../types";

const LABEL_TONE: Record<SentimentLabel, Tone> = {
  BULLISH: "green",
  BEARISH: "rose",
  NEUTRAL: "amber",
};

const LABEL_ICON: Record<SentimentLabel, typeof TrendingUp> = {
  BULLISH: TrendingUp,
  BEARISH: TrendingDown,
  NEUTRAL: Minus,
};

const LABEL_TEXT: Record<SentimentLabel, string> = {
  BULLISH: "text-gain",
  BEARISH: "text-loss",
  NEUTRAL: "text-warn",
};

/** Plain-language explanation of what each factor measures. */
const FACTOR_EXPLAIN: Record<string, string> = {
  "Put/Call Ratio": "PE/CE open-interest balance. High (put-heavy) signals support building; low (call-heavy) signals overhead resistance.",
  "OI Build-up": "Net put writing vs call writing today. Put writers defend support (bullish); call writers cap upside (bearish).",
  "ATM Price Action": "Whether ATM calls are gaining premium faster than puts (bullish) or vice-versa (bearish) this session.",
  "Max Pain Pull": "Spot's position relative to max pain — price tends to gravitate toward max pain into expiry.",
  "S/R Position": "Where spot sits inside the OI-defined support/resistance band — nearer resistance is stretched, nearer support is coiled.",
};

export function SentimentPanel() {
  return (
    <Panel
      title="Market Sentiment"
      icon={Compass}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <SentimentBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function SentimentBody({ chain }: { chain: EnrichedChain }) {
  const result = useMemo(() => computeSentiment(chain), [chain]);
  const Icon = LABEL_ICON[result.label];
  const tone = LABEL_TONE[result.label];

  // -100..+100 → 0..100 gauge fill.
  const gaugePct = Math.min(100, Math.max(0, (result.score + 100) / 2));

  return (
    <div className="space-y-3">
      {/* ---- Verdict ---- */}
      <div className="rounded-panel border border-border bg-panel p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`flex h-11 w-11 items-center justify-center rounded-panel bg-surface ${LABEL_TEXT[result.label]}`}>
              <Icon size={22} strokeWidth={2} />
            </span>
            <div>
              <p className={`font-mono text-2xl font-bold ${LABEL_TEXT[result.label]}`}>{result.label}</p>
              <p className="text-2xs text-zinc-600">
                {chain.instrument.label} · spot {chain.spot.toFixed(1)}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className={`font-mono text-2xl font-bold ${LABEL_TEXT[result.label]}`}>{signed(result.score, 0)}</p>
            <p className="text-2xs text-zinc-600">-100 … +100</p>
          </div>
        </div>

        {/* gauge */}
        <div className="mt-4">
          <div className="flex justify-between text-[9px] uppercase tracking-wider text-zinc-600">
            <span>Bearish</span>
            <span>Neutral</span>
            <span>Bullish</span>
          </div>
          <div className="relative mt-1 h-3 w-full overflow-hidden rounded-sm bg-surface">
            <div className="absolute left-1/2 top-0 z-10 h-full w-px bg-border" />
            <div
              className={`h-full ${tone === "green" ? "bg-gain/60" : tone === "rose" ? "bg-loss/60" : "bg-warn/60"}`}
              style={{ width: `${gaugePct}%` }}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Row label="Verdict" value={result.label} valueClass={LABEL_TEXT[result.label]} />
          <Row label="Confidence" value={`${Math.round(result.confidence * 100)}%`} valueClass="text-zinc-200" />
          <Row label="Active signals" value={String(result.factors.length)} valueClass="text-zinc-200" />
        </div>
      </div>

      {/* ---- Factors ---- */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Contributing Factors</SectionTitle>
          <span className="text-[9px] uppercase tracking-wider text-zinc-600">score −1 … +1</span>
        </div>
        {result.factors.length === 0 ? (
          <Banner tone="warn">
            No directional factors cleared their thresholds this snapshot — the chain reads flat. Shown honestly rather than
            forcing a bias.
          </Banner>
        ) : (
          <div className="space-y-2">
            {result.factors.map((f) => (
              <FactorRow key={f.label} factor={f} />
            ))}
          </div>
        )}
      </div>

      {/* ---- Method note ---- */}
      <Banner tone="info">
        <span className="inline-flex items-start gap-1.5">
          <Info size={11} className="mt-0.5 shrink-0" />
          <span>
            Sentiment is a transparent weighted blend of the factors above, each computed from the live option chain. The
            aggregate is the mean factor score scaled to ±100 — no opaque model, no fabricated inputs.
          </span>
        </span>
      </Banner>
    </div>
  );
}

function FactorRow({ factor }: { factor: SentimentFactor }) {
  const bullish = factor.score > 0;
  const bearish = factor.score < 0;
  const tone: Tone = bullish ? "green" : bearish ? "rose" : "zinc";
  const fill = bullish ? "bg-gain/60" : bearish ? "bg-loss/60" : "bg-zinc-600";
  // |score| up to ~0.7 (max factor weight); scale the half-bar fill to that.
  const widthPct = Math.min(100, (Math.abs(factor.score) / 0.7) * 100);

  return (
    <div className="rounded-panel border border-border bg-panel p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xs font-semibold text-zinc-200">{factor.label}</span>
          <Pill tone={tone}>{bullish ? "Bullish" : bearish ? "Bearish" : "Neutral"}</Pill>
        </div>
        <span className={`font-mono text-2xs font-semibold ${bullish ? "text-gain" : bearish ? "text-loss" : "text-zinc-400"}`}>
          {signed(factor.score, 2)}
        </span>
      </div>

      {/* centered signed score bar */}
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-surface">
        <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
        <div
          className={`absolute top-0 h-full ${fill}`}
          style={
            bearish
              ? { right: "50%", width: `${widthPct / 2}%` }
              : { left: "50%", width: `${widthPct / 2}%` }
          }
        />
      </div>

      <p className="mt-1.5 text-2xs text-zinc-400">{factor.detail}</p>
      {FACTOR_EXPLAIN[factor.label] && (
        <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-600">{FACTOR_EXPLAIN[factor.label]}</p>
      )}
    </div>
  );
}
