/**
 * Margin Dashboard — funds + a live broker margin simulator.
 *
 * Top: Available / Used / Total margin parsed defensively from FYERS `/account/funds`
 * (BROKER). Every labelled entry the broker returns is rendered honestly; we never invent a
 * value that isn't in the payload.
 *
 * Bottom: a Margin Simulator. Pick a live chain contract (strike + CE/PE) + side + lots, and
 * the panel builds a real INTRADAY order and asks FYERS (`/options/margin` → /multiorder/margin)
 * for the required margin (BROKER). If the broker call is unavailable, a clearly-labelled local
 * premium-based estimate is shown instead. The SPAN-vs-Exposure split is only shown if the broker
 * response actually carries those fields; otherwise it is rendered UNAVAILABLE with a note.
 */

import { useEffect, useMemo, useState } from "react";
import { Scale, PlugZap, Calculator } from "lucide-react";
import { accountApi, optionsApi, type OrderRequest } from "../../services/api";
import { useOptionsData } from "../data/OptionsDataProvider";
import {
  Panel,
  ProvenanceBadge,
  Empty,
  Spinner,
  Banner,
  Stat,
  Row,
  Select,
  Segmented,
  NumberField,
  Button,
} from "../components/ui";
import { rupee, dec } from "../lib/format";
import type { EnrichedChain, OptionType, StrikeRow } from "../types";

// ---------------------------------------------------------------------------
// Funds parsing (defensive over the FYERS fund_limit shape; server maps it to `funds`).
// ---------------------------------------------------------------------------

interface FundEntry {
  title: string;
  equityAmount: number;
  commodityAmount: number;
}

function numOf(v: unknown): number {
  const x = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function parseFundLimit(raw: unknown): FundEntry[] {
  const root = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.funds)
    ? root.funds
    : Array.isArray(root.fund_limit)
      ? root.fund_limit
      : [];
  return (list as Record<string, unknown>[]).map((e) => ({
    title: String(e.title ?? ""),
    equityAmount: numOf(e.equityAmount),
    commodityAmount: numOf(e.commodityAmount),
  }));
}

function findFund(funds: FundEntry[], needles: string[]): FundEntry | undefined {
  return funds.find((f) => needles.some((n) => f.title.toLowerCase().includes(n.toLowerCase())));
}

// ---------------------------------------------------------------------------
// Broker margin-response parsing (FYERS /multiorder/margin → response.data).
// Field names vary; we read several plausible keys but only surface what's present.
// ---------------------------------------------------------------------------

interface ParsedMargin {
  total: number | null;
  span: number | null;
  exposure: number | null;
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    if (k in obj) {
      const v = obj[k];
      const n = typeof v === "string" ? parseFloat(v) : Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseBrokerMargin(margin: unknown): ParsedMargin {
  const m = (margin ?? {}) as Record<string, unknown>;
  // FYERS sometimes nests per-order details under data[] with a summary at the top level.
  return {
    total: pickNum(m, ["margin_total", "total", "margin_new_order", "marginRequired", "margin"]),
    span: pickNum(m, ["span", "span_margin", "spanMargin", "margin_span"]),
    exposure: pickNum(m, ["exposure", "exposure_margin", "exposureMargin", "margin_exposure"]),
  };
}

export function MarginPanel() {
  const data = useOptionsData();

  return (
    <Panel
      title="Margin Dashboard"
      icon={Scale}
      badge={<ProvenanceBadge kind="BROKER" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <MarginBody data={data} />
    </Panel>
  );
}

function MarginBody({ data }: { data: ReturnType<typeof useOptionsData> }) {
  const { chain, connected } = data;

  const [funds, setFunds] = useState<FundEntry[] | null>(null);
  const [fundsErr, setFundsErr] = useState<string | null>(null);
  const [fundsLoading, setFundsLoading] = useState(false);

  useEffect(() => {
    if (!connected) {
      setFunds(null);
      return;
    }
    let cancelled = false;
    setFundsLoading(true);
    accountApi
      .getFunds()
      .then((res) => {
        if (cancelled) return;
        setFunds(parseFundLimit(res));
        setFundsErr(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFundsErr(err instanceof Error ? err.message : "Failed to load funds");
      })
      .finally(() => {
        if (!cancelled) setFundsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  if (!connected) {
    return (
      <Empty
        icon={PlugZap}
        message="Connect to FYERS to load your margin balances and the live broker margin simulator."
      />
    );
  }

  const avail = findFund(funds ?? [], ["available balance", "available"]);
  const used = findFund(funds ?? [], ["utilized", "utilised", "used"]);
  const total = findFund(funds ?? [], ["total balance", "total", "limit at start"]);
  // Anything we couldn't bucket — show it honestly rather than drop it.
  const known = new Set([avail, used, total].filter(Boolean));
  const other = (funds ?? []).filter((f) => !known.has(f));

  return (
    <div className="space-y-4">
      {/* ---- Funds ---- */}
      {fundsLoading && !funds ? (
        <Spinner label="Loading funds…" />
      ) : fundsErr ? (
        <Banner tone="loss">Funds unavailable: {fundsErr}</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat
              label="Available margin"
              value={avail ? rupee(avail.equityAmount) : "—"}
              tone="green"
              sub={avail ? <ProvenanceBadge kind="BROKER" /> : <ProvenanceBadge kind="UNAVAILABLE" />}
            />
            <Stat
              label="Used margin"
              value={used ? rupee(used.equityAmount) : "—"}
              tone="amber"
              sub={used ? <ProvenanceBadge kind="BROKER" /> : <ProvenanceBadge kind="UNAVAILABLE" />}
            />
            <Stat
              label="Total balance"
              value={total ? rupee(total.equityAmount) : "—"}
              tone="blue"
              sub={total ? <ProvenanceBadge kind="BROKER" /> : <ProvenanceBadge kind="UNAVAILABLE" />}
            />
          </div>

          {/* Every other labelled fund line, verbatim. */}
          {(funds?.length ?? 0) > 0 && (
            <div className="rounded-panel border border-border bg-panel p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">All fund lines</span>
                <ProvenanceBadge kind="BROKER" />
                <span className="ml-auto text-[9px] text-zinc-700">equity segment</span>
              </div>
              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {(funds ?? []).map((f, i) => (
                  <Row key={`${f.title}-${i}`} label={f.title || "(untitled)"} value={rupee(f.equityAmount)} />
                ))}
              </div>
              {other.length > 0 && (
                <p className="mt-2 text-[9px] text-zinc-700">
                  Lines not mapped to Available/Used/Total above are still shown verbatim — labels come straight from FYERS.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ---- Simulator ---- */}
      <MarginSimulator chain={chain} />
    </div>
  );
}

function MarginSimulator({ chain }: { chain: EnrichedChain | null }) {
  const [strike, setStrike] = useState<number | null>(null);
  const [type, setType] = useState<OptionType>("CE");
  const [side, setSide] = useState<"BUY" | "SELL">("SELL");
  const [lots, setLots] = useState(1);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<{ available: boolean; parsed: ParsedMargin; message?: string } | null>(null);
  const [reqErr, setReqErr] = useState<string | null>(null);

  // Default the strike to ATM once the chain arrives.
  useEffect(() => {
    if (chain && strike == null && chain.rows.length > 0) {
      const atm = chain.rows.find((r) => r.isAtm) ?? chain.rows[Math.floor(chain.rows.length / 2)];
      setStrike(atm.strike);
    }
  }, [chain, strike]);

  const selectedRow = useMemo<StrikeRow | undefined>(
    () => chain?.rows.find((r) => r.strike === strike),
    [chain, strike],
  );
  const quote = selectedRow ? (type === "CE" ? selectedRow.ce : selectedRow.pe) : undefined;
  const lotSize = chain?.instrument.lotSize ?? 0;
  const qty = lots * lotSize;

  // Local fallback estimate: premium for BUY (debit), a SPAN-style notional band for SELL.
  // Clearly labelled COMPUTED — never presented as the broker's number.
  const localEstimate = useMemo(() => {
    if (!quote || !chain || qty <= 0) return null;
    if (side === "BUY") return quote.ltp * qty; // long option: margin ≈ premium paid
    // Short option: rough notional band (~spot×qty×12%) + premium received as a placeholder only.
    return chain.spot * qty * 0.12 + quote.ltp * qty;
  }, [quote, chain, qty, side]);

  const canCalc = !!quote && !!quote.symbol && qty > 0;

  const calc = async () => {
    if (!quote?.symbol || qty <= 0) return;
    setLoading(true);
    setReqErr(null);
    setResp(null);
    const order: OrderRequest = {
      symbol: quote.symbol,
      side,
      qty,
      orderType: "MARKET",
      productType: "INTRADAY",
      validity: "DAY",
    };
    try {
      const r = await optionsApi.getMargin([order]);
      setResp({ available: !!r?.available, parsed: parseBrokerMargin(r?.margin), message: r?.message });
    } catch (err: unknown) {
      setReqErr(err instanceof Error ? err.message : "Margin request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-panel border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <Calculator size={12} className="text-zinc-600" strokeWidth={1.5} />
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Margin simulator</span>
        <ProvenanceBadge kind="BROKER" />
        <span className="ml-auto text-[9px] text-zinc-700">FYERS /multiorder/margin</span>
      </div>

      <div className="p-3">
        {!chain || chain.rows.length === 0 ? (
          <Banner tone="info">
            The live option chain isn't loaded (instrument/expiry not selected, or market closed). The simulator builds
            its order from real chain contracts, so it stays disabled rather than inventing a symbol.
          </Banner>
        ) : (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label>Strike</Label>
                <Select value={strike ?? ""} onChange={(v) => setStrike(Number(v))}>
                  {chain.rows.map((r) => (
                    <option key={r.strike} value={r.strike}>
                      {r.strike}
                      {r.isAtm ? " (ATM)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Segmented
                  value={type}
                  onChange={setType}
                  options={[
                    { value: "CE", label: "Call" },
                    { value: "PE", label: "Put" },
                  ]}
                />
              </div>
              <div>
                <Label>Side</Label>
                <Segmented
                  value={side}
                  onChange={setSide}
                  options={[
                    { value: "BUY", label: "Buy" },
                    { value: "SELL", label: "Sell" },
                  ]}
                />
              </div>
              <div className="w-20">
                <Label>Lots</Label>
                <NumberField value={lots} min={1} step={1} onChange={(v) => setLots(Math.max(1, Math.round(v) || 1))} />
              </div>
              <Button tone="blue" onClick={calc} disabled={!canCalc || loading}>
                {loading ? "Calculating…" : "Get broker margin"}
              </Button>
            </div>

            {/* Order preview */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-zinc-600">
              <span>
                Order <span className="font-mono text-zinc-300">{quote?.symbol || "—"}</span>
              </span>
              <span>
                Qty <span className="font-mono text-zinc-300">{qty}</span>{" "}
                <span className="text-zinc-700">({lots} × {lotSize})</span>
              </span>
              <span>
                Premium <span className="font-mono text-zinc-300">{quote && quote.ltp > 0 ? dec(quote.ltp, 2) : "—"}</span>
              </span>
            </div>

            {/* Result */}
            <div className="mt-3">
              {reqErr ? (
                <Banner tone="loss">{reqErr}</Banner>
              ) : resp && resp.available ? (
                <BrokerMarginResult parsed={resp.parsed} localEstimate={localEstimate} />
              ) : resp && !resp.available ? (
                <LocalEstimateResult
                  localEstimate={localEstimate}
                  reason={resp.message || "Broker margin endpoint did not return a value."}
                />
              ) : (
                <p className="text-2xs text-zinc-600">
                  Pick a contract and side, then request the broker margin. A local estimate is shown if the broker call
                  is unavailable.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BrokerMarginResult({
  parsed,
  localEstimate,
}: {
  parsed: ParsedMargin;
  localEstimate: number | null;
}) {
  const hasSplit = parsed.span != null || parsed.exposure != null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat
          label="Required margin"
          value={parsed.total != null ? rupee(parsed.total) : "—"}
          tone="amber"
          sub={parsed.total != null ? <ProvenanceBadge kind="BROKER" /> : <ProvenanceBadge kind="UNAVAILABLE" />}
        />
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">SPAN</span>
            {parsed.span != null ? <ProvenanceBadge kind="BROKER" /> : <ProvenanceBadge kind="UNAVAILABLE" />}
          </div>
          <p className="font-mono text-lg font-semibold text-zinc-200">
            {parsed.span != null ? rupee(parsed.span) : "—"}
          </p>
        </div>
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Exposure</span>
            {parsed.exposure != null ? <ProvenanceBadge kind="BROKER" /> : <ProvenanceBadge kind="UNAVAILABLE" />}
          </div>
          <p className="font-mono text-lg font-semibold text-zinc-200">
            {parsed.exposure != null ? rupee(parsed.exposure) : "—"}
          </p>
        </div>
      </div>
      {!hasSplit && (
        <p className="text-2xs leading-relaxed text-zinc-600">
          The broker returned the total required margin but did not break out the SPAN vs Exposure split for this
          basket, so those tiles are blank rather than estimated.
        </p>
      )}
      {localEstimate != null && (
        <p className="text-2xs text-zinc-700">
          Local reference estimate (COMPUTED): {rupee(localEstimate)} — for sanity-check only; the broker figure above
          is authoritative.
        </p>
      )}
    </div>
  );
}

function LocalEstimateResult({
  localEstimate,
  reason,
}: {
  localEstimate: number | null;
  reason: string;
}) {
  return (
    <div className="space-y-2">
      <Banner tone="warn">Broker margin unavailable — {reason}. Showing a local estimate instead.</Banner>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat
          label="Estimated margin"
          value={localEstimate != null ? rupee(localEstimate) : "—"}
          tone="amber"
          sub={<ProvenanceBadge kind="COMPUTED" />}
        />
        <div className="col-span-2 rounded-panel border border-border bg-panel p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">SPAN / Exposure split</span>
            <ProvenanceBadge kind="UNAVAILABLE" />
          </div>
          <p className="text-2xs leading-relaxed text-zinc-600">
            No broker response, so the regulated SPAN/Exposure split can't be shown. The estimate is a rough
            premium-/notional-based figure (long ≈ premium; short ≈ ~12% of notional + premium) and is not the broker's
            blocked margin.
          </p>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{children}</div>;
}
