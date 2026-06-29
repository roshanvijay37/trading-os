/**
 * Strategy Analyzer — a metrics dashboard for the working strategy. Reads the legs
 * (StrategyProvider) and the live chain, runs computePayoff for Risk:Reward, Probability
 * of Profit, Expected Value, ROI, net Greeks, theta decay, break-evens and max profit/loss
 * (all COMPUTED). For Margin Required it resolves each leg to its live broker symbol from
 * the chain, builds OrderRequests, and calls optionsApi.getMargin — surfacing the broker
 * figure (BROKER badge) when available, else the local SPAN-style estimate (COMPUTED).
 * FUT legs and legs without a resolvable symbol force the local estimate. No fabricated data.
 */

import { useEffect, useMemo, useState } from "react";
import { Gauge, Percent, Scale, Sigma, Wallet, Activity, AlertCircle } from "lucide-react";
import { useStrategy } from "../data/StrategyProvider";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Stat, Row, Empty, Banner } from "../components/ui";
import { computePayoff, type PayoffOpts } from "../lib/payoff";
import { money, dec, signed, rupee } from "../lib/format";
import { optionsApi, type OrderRequest } from "../../services/api";
import type { EnrichedChain, PayoffResult, StrategyLeg } from "../types";

export function StrategyAnalyzerPanel() {
  return (
    <Panel
      title="Strategy Analyzer"
      icon={Gauge}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <AnalyzerBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function buildOpts(chain: EnrichedChain): PayoffOpts {
  const atmRow = chain.rows.find((r) => r.isAtm) ?? chain.rows[0];
  const atmIv =
    (atmRow ? atmRow.ce.iv || atmRow.pe.iv : 0) || (chain.vix ? chain.vix.value / 100 : 0.15);
  return {
    lotSize: chain.instrument.lotSize,
    spot: chain.spot,
    atmIv,
    nowMs: Date.now(),
    riskFreeRate: chain.riskFreeRate,
  };
}

/** Resolve a leg to its live broker symbol from the chain. FUT legs have no chain symbol. */
function symbolForLeg(chain: EnrichedChain, leg: StrategyLeg): string | null {
  if (leg.instrument === "FUT") return null;
  const row = chain.rows.find((r) => r.strike === leg.strike);
  if (!row) return null;
  const sym = leg.instrument === "CE" ? row.ce.symbol : row.pe.symbol;
  return sym && sym.length > 0 ? sym : null;
}

interface MarginState {
  status: "idle" | "loading" | "broker" | "fallback" | "error";
  brokerMargin: number | null;
  error: string | null;
}

/** Shape of the FYERS /options/margin response as mapped by the server. */
interface BrokerMarginResponse {
  available?: boolean;
  margin?: unknown; // FYERS /multiorder/margin payload (field names vary)
  message?: string;
}

function AnalyzerBody({ chain }: { chain: EnrichedChain }) {
  const strat = useStrategy();
  const opts = useMemo(() => buildOpts(chain), [chain]);
  const result = useMemo<PayoffResult>(() => computePayoff(strat.legs, opts), [strat.legs, opts]);

  // Build broker orders from legs; if any leg can't be resolved to a symbol we can't ask the
  // broker for an authoritative number, so we fall back to the local estimate (labelled COMPUTED).
  const { orders, resolvable } = useMemo(() => {
    const built: OrderRequest[] = [];
    let ok = strat.legs.length > 0;
    for (const leg of strat.legs) {
      const symbol = symbolForLeg(chain, leg);
      if (!symbol) {
        ok = false;
        continue;
      }
      built.push({
        symbol,
        side: leg.action,
        qty: leg.lots * chain.instrument.lotSize,
        orderType: "MARKET",
        productType: "MARGIN",
        validity: "DAY",
      });
    }
    return { orders: built, resolvable: ok };
  }, [strat.legs, chain]);

  const [margin, setMargin] = useState<MarginState>({ status: "idle", brokerMargin: null, error: null });

  // Fetch the broker margin whenever the resolved order set changes.
  useEffect(() => {
    if (!resolvable || orders.length === 0) {
      setMargin({ status: "fallback", brokerMargin: null, error: null });
      return;
    }
    let cancelled = false;
    setMargin((m) => ({ ...m, status: "loading", error: null }));
    optionsApi
      .getMargin(orders)
      .then((res: BrokerMarginResponse) => {
        if (cancelled) return;
        const value = res?.available ? extractMargin(res.margin) : null;
        if (value != null && Number.isFinite(value) && value > 0) {
          setMargin({ status: "broker", brokerMargin: value, error: null });
        } else {
          // Broker reachable but no usable total (or available=false): fall back honestly.
          setMargin({ status: "fallback", brokerMargin: null, error: res?.message ?? null });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Margin request failed";
        setMargin({ status: "error", brokerMargin: null, error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [orders, resolvable]);

  if (strat.legs.length === 0) {
    return (
      <Empty
        icon={Gauge}
        message="No strategy to analyze. Load a template or add legs in the Strategy Builder to populate the metrics."
      />
    );
  }

  const usingBroker = margin.status === "broker" && margin.brokerMargin != null;
  const marginValue = usingBroker ? (margin.brokerMargin as number) : result.marginEstimate;

  const roi =
    Number.isFinite(result.maxProfit) && marginValue > 0 ? (result.maxProfit / marginValue) * 100 : NaN;

  const rrLabel = result.riskReward > 0 ? `1 : ${dec(result.riskReward, 2)}` : "Undefined";

  return (
    <div className="space-y-4">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-semibold text-zinc-300">{strat.name}</span>
        <span className="text-[9px] text-zinc-700">
          {strat.legs.length} leg{strat.legs.length === 1 ? "" : "s"} · lot size {chain.instrument.lotSize}
        </span>
      </div>

      {/* ---- Primary metric tiles ---- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          label="Risk : Reward"
          value={rrLabel}
          tone={result.riskReward >= 1 ? "green" : "amber"}
          icon={Scale}
          sub={result.riskReward > 0 ? "reward per 1 risked" : "unbounded leg"}
        />
        <Stat
          label="Prob of Profit"
          value={`${dec(result.probOfProfit * 100, 1)}%`}
          tone="blue"
          icon={Percent}
          sub="Lognormal model"
        />
        <Stat
          label="Expected Value"
          value={money(result.expectedValue)}
          tone={result.expectedValue >= 0 ? "green" : "rose"}
          icon={Sigma}
          sub="EV under model"
        />
        <Stat
          label="ROI on margin"
          value={Number.isFinite(roi) ? `${dec(roi, 1)}%` : "—"}
          tone={Number.isFinite(roi) && roi >= 0 ? "green" : "zinc"}
          icon={Gauge}
          sub={Number.isFinite(result.maxProfit) ? "max profit / margin" : "unbounded profit"}
        />
        <Stat
          label="Margin Required"
          value={marginValue > 0 ? rupee(marginValue) : "—"}
          tone="zinc"
          icon={Wallet}
          sub={
            <span className="inline-flex items-center gap-1">
              {margin.status === "loading" ? (
                "Fetching broker…"
              ) : usingBroker ? (
                <ProvenanceBadge kind="BROKER" />
              ) : (
                <>
                  <ProvenanceBadge kind="COMPUTED" />
                  <span>SPAN estimate</span>
                </>
              )}
            </span>
          }
        />
        <Stat
          label="Theta / day"
          value={money(result.greeks.theta)}
          tone={result.greeks.theta >= 0 ? "green" : "rose"}
          icon={Activity}
          sub={result.greeks.theta >= 0 ? "collecting decay" : "paying decay"}
        />
      </div>

      {/* ---- Margin provenance note ---- */}
      {margin.status === "error" && (
        <Banner tone="warn">
          Broker margin unavailable ({margin.error}). Showing the local SPAN-style estimate instead — labelled
          COMPUTED, not broker-confirmed.
        </Banner>
      )}
      {margin.status === "fallback" && !resolvable && (
        <div className="flex items-start gap-1.5 text-[9px] text-zinc-600">
          <AlertCircle size={11} className="mt-px shrink-0 text-zinc-700" />
          <span>
            One or more legs (e.g. a future, or a strike not on the live chain) has no broker symbol, so an
            authoritative broker margin can't be requested. Showing the local SPAN-style estimate.
          </span>
        </div>
      )}

      {/* ---- Detail panels ---- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Profit / Loss profile</span>
            <ProvenanceBadge kind="COMPUTED" />
          </div>
          <Row
            label="Max profit"
            value={Number.isFinite(result.maxProfit) ? money(result.maxProfit) : "Unlimited"}
            valueClass="text-gain"
          />
          <Row
            label="Max loss"
            value={Number.isFinite(result.maxLoss) ? money(result.maxLoss) : "Unlimited"}
            valueClass="text-loss"
          />
          <Row
            label={result.netPremium < 0 ? "Net credit" : "Net debit"}
            value={money(Math.abs(result.netPremium))}
            valueClass={result.netPremium < 0 ? "text-gain" : "text-loss"}
          />
          <Row
            label="Break-even(s)"
            value={result.breakevens.length > 0 ? result.breakevens.map((b) => dec(b, 1)).join("  ·  ") : "—"}
          />
          <Row
            label="Margin"
            value={
              <span className="inline-flex items-center gap-1.5">
                {marginValue > 0 ? rupee(marginValue) : "—"}
                <ProvenanceBadge kind={usingBroker ? "BROKER" : "COMPUTED"} />
              </span>
            }
          />
        </div>

        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Activity size={12} className="text-zinc-600" strokeWidth={1.5} />
            <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Net Greeks</span>
            <ProvenanceBadge kind="COMPUTED" />
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            <Row label="Delta" value={signed(result.greeks.delta, 2)} valueClass={toneOf(result.greeks.delta)} />
            <Row label="Gamma" value={signed(result.greeks.gamma, 4)} valueClass={toneOf(result.greeks.gamma)} />
            <Row label="Theta / day" value={money(result.greeks.theta)} valueClass={toneOf(result.greeks.theta)} />
            <Row label="Vega" value={signed(result.greeks.vega, 1)} valueClass={toneOf(result.greeks.vega)} />
            <Row label="Rho" value={signed(result.greeks.rho, 1)} valueClass={toneOf(result.greeks.rho)} />
            <Row label="Vanna" value={signed(result.greeks.vanna, 2)} valueClass={toneOf(result.greeks.vanna)} />
          </div>
        </div>
      </div>

      <p className="text-[9px] leading-relaxed text-zinc-700">
        Risk:Reward, POP, Expected Value, ROI, Greeks and the P/L profile are COMPUTED from the live chain via the
        Black-Scholes payoff engine. Margin is the broker SPAN+Exposure figure (BROKER) when every leg resolves to a
        live symbol, otherwise the local SPAN-style estimate (COMPUTED). Nothing here is fabricated.
      </p>
    </div>
  );
}

function toneOf(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "text-zinc-300";
  return n > 0 ? "text-gain" : "text-loss";
}

/**
 * Pull the total required margin out of the FYERS /multiorder/margin payload (res.margin).
 * Field names vary across the response, so several plausible keys are read; values may be
 * strings or numbers. Only a positive finite number is accepted — anything else returns null
 * and the caller falls back to the local SPAN-style estimate.
 */
function extractMargin(margin: unknown): number | null {
  if (margin == null || typeof margin !== "object") return null;
  const obj = margin as Record<string, unknown>;
  const keys = ["margin_total", "total", "margin_new_order", "marginRequired", "totalMargin", "margin"];
  for (const k of keys) {
    if (!(k in obj)) continue;
    const v = obj[k];
    const n = typeof v === "string" ? parseFloat(v) : Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
