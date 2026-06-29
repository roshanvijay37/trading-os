/**
 * Trade Ticket — places REAL orders on the connected live FYERS account.
 *
 * Every "Place" path routes through a confirmation modal that spells out exactly what will hit
 * the broker, including a blunt live-money warning. The contract is selected from the LIVE chain
 * (or prefilled from a click elsewhere via onSelectContract); quantity is lots × the instrument
 * lot size; the margin impact is fetched from the broker (optionsApi.getMargin) and falls back to
 * a clearly-labelled local estimate only when the broker can't price it. No order is ever placed
 * implicitly — the user confirms each time. Nothing about prices or margin is fabricated.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Receipt,
  AlertTriangle,
  ShoppingBasket,
  Trash2,
  X,
  Loader2,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Segmented, Select, NumberField, Button, Banner } from "../components/ui";
import { onSelectContract } from "../lib/events";
import { dec, rupee, compact } from "../lib/format";
import { optionsApi, type OrderRequest } from "../../services/api";
import type {
  EnrichedChain,
  OptionQuote,
  OrderSide,
  OrderType,
  ProductType,
} from "../types";

type Validity = "DAY" | "IOC";

interface Draft {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  validity: Validity;
  lots: number;
  limitPrice: number;
  stopPrice: number;
}

const DEFAULT_DRAFT: Draft = {
  symbol: "",
  side: "BUY",
  orderType: "MARKET",
  productType: "INTRADAY",
  validity: "DAY",
  lots: 1,
  limitPrice: 0,
  stopPrice: 0,
};

function needsLimit(t: OrderType): boolean {
  return t === "LIMIT" || t === "SL";
}
function needsStop(t: OrderType): boolean {
  return t === "SL" || t === "SL-M";
}

/** Build the absolute OrderRequest from a draft + chain context (qty = lots × lotSize). */
function toOrder(draft: Draft, lotSize: number): OrderRequest {
  return {
    symbol: draft.symbol,
    side: draft.side,
    qty: Math.max(0, Math.round(draft.lots)) * lotSize,
    orderType: draft.orderType,
    limitPrice: needsLimit(draft.orderType) ? draft.limitPrice : undefined,
    stopPrice: needsStop(draft.orderType) ? draft.stopPrice : undefined,
    productType: draft.productType,
    validity: draft.validity,
  };
}

function findQuote(chain: EnrichedChain, symbol: string): OptionQuote | null {
  for (const r of chain.rows) {
    if (r.ce.symbol === symbol) return r.ce;
    if (r.pe.symbol === symbol) return r.pe;
  }
  return null;
}

function symbolShort(symbol: string): string {
  if (!symbol) return "—";
  const m = symbol.match(/(\d{4,6}(?:CE|PE))$/);
  return m ? m[1] : symbol.replace(/^.*:/, "");
}

export function TradeTicketPanel() {
  return (
    <Panel
      title="Trade Ticket"
      icon={Receipt}
      badge={<ProvenanceBadge kind="BROKER" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <Ticket chain={chain} />}</ChainGate>
    </Panel>
  );
}

interface MarginState {
  loading: boolean;
  available: number | null;
  margin: number | null;
  error: string | null;
}

type Confirm =
  | { kind: "single"; order: OrderRequest }
  | { kind: "basket"; orders: OrderRequest[] };

interface PlaceResult {
  ok: boolean;
  message: string;
}

function Ticket({ chain }: { chain: EnrichedChain }) {
  const lotSize = chain.instrument.lotSize;
  const [draft, setDraft] = useState<Draft>(() => ({ ...DEFAULT_DRAFT }));
  const [basket, setBasket] = useState<OrderRequest[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<PlaceResult | null>(null);
  const [margin, setMargin] = useState<MarginState>({ loading: false, available: null, margin: null, error: null });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // Prefill from a contract selected elsewhere (chain click, watchlist).
  useEffect(() => {
    const off = onSelectContract((d) => {
      setResult(null);
      setDraft((prev) => ({
        ...prev,
        symbol: d.symbol,
        // Seed a sensible limit at the clicked LTP for non-market orders.
        limitPrice: d.ltp > 0 ? d.ltp : prev.limitPrice,
      }));
    });
    return off;
  }, []);

  // All CE/PE symbols on the live chain, for manual selection.
  const symbolOptions = useMemo(() => {
    const out: { symbol: string; label: string }[] = [];
    for (const r of chain.rows) {
      if (r.ce.symbol) out.push({ symbol: r.ce.symbol, label: `${r.strike} CE` });
      if (r.pe.symbol) out.push({ symbol: r.pe.symbol, label: `${r.strike} PE` });
    }
    return out;
  }, [chain.rows]);

  const quote = draft.symbol ? findQuote(chain, draft.symbol) : null;
  const lots = Number.isFinite(draft.lots) ? Math.max(0, Math.round(draft.lots)) : 0;
  const qty = lots * lotSize;

  // Reference price for the premium estimate: limit price when set, else live LTP.
  const refPrice =
    needsLimit(draft.orderType) && draft.limitPrice > 0
      ? draft.limitPrice
      : quote?.ltp ?? 0;
  const premiumEstimate = refPrice > 0 ? refPrice * qty : 0;

  const order = useMemo(() => toOrder(draft, lotSize), [draft, lotSize]);

  const orderValid =
    !!draft.symbol &&
    qty > 0 &&
    (!needsLimit(draft.orderType) || draft.limitPrice > 0) &&
    (!needsStop(draft.orderType) || draft.stopPrice > 0);

  // Debounced broker margin fetch on every material change of the order.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const fetchMargin = useCallback((o: OrderRequest) => {
    const myId = ++reqIdRef.current;
    setMargin((m) => ({ ...m, loading: true, error: null }));
    optionsApi
      .getMargin([o])
      .then((res: { available?: number; margin?: number }) => {
        if (reqIdRef.current !== myId) return;
        const av = typeof res?.available === "number" ? res.available : null;
        const mg = typeof res?.margin === "number" ? res.margin : null;
        if (mg == null) {
          setMargin({ loading: false, available: av, margin: null, error: "Broker did not return a margin figure" });
        } else {
          setMargin({ loading: false, available: av, margin: mg, error: null });
        }
      })
      .catch((err: unknown) => {
        if (reqIdRef.current !== myId) return;
        setMargin({
          loading: false,
          available: null,
          margin: null,
          error: err instanceof Error ? err.message : "Margin lookup failed",
        });
      });
  }, []);

  useEffect(() => {
    if (!orderValid) {
      setMargin({ loading: false, available: null, margin: null, error: null });
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchMargin(order), 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [order, orderValid, fetchMargin]);

  // Local fallback estimate (clearly labelled, never presented as the broker figure):
  // buys ≈ premium paid; sells ≈ a coarse SPAN-ish notional proxy.
  const estimatedMargin = useMemo(() => {
    if (draft.side === "BUY") return premiumEstimate;
    const notional = chain.spot * qty;
    return notional * 0.15 + premiumEstimate; // coarse short-premium proxy
  }, [draft.side, premiumEstimate, chain.spot, qty]);

  const addToBasket = () => {
    if (!orderValid) return;
    setBasket((b) => [...b, order]);
  };
  const removeBasket = (i: number) => setBasket((b) => b.filter((_, idx) => idx !== i));

  const doPlace = async (c: Confirm) => {
    setPlacing(true);
    setResult(null);
    try {
      if (c.kind === "single") {
        const res = await optionsApi.placeOrder(c.order);
        if (res?.success) {
          setResult({ ok: true, message: `Order placed${res.id ? ` · id ${res.id}` : ""}` });
        } else {
          setResult({ ok: false, message: res?.message || res?.error || "Broker rejected the order" });
        }
      } else {
        const res = await optionsApi.basketOrder(c.orders);
        const placed = typeof res?.placed === "number" ? res.placed : 0;
        const total = typeof res?.total === "number" ? res.total : c.orders.length;
        const ok = placed === total && total > 0;
        setResult({
          ok,
          message: ok
            ? `Basket placed · ${placed}/${total} orders`
            : `Basket partially placed · ${placed}/${total} — check positions`,
        });
        if (ok) setBasket([]);
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Order failed" });
    } finally {
      setPlacing(false);
      setConfirm(null);
    }
  };

  const isSell = draft.side === "SELL";
  const basketHasSell = basket.some((o) => o.side === "SELL");

  return (
    <div className="space-y-3">
      <Banner tone="loss">
        <span className="flex items-center gap-1.5">
          <ShieldAlert size={12} />
          <span>
            This ticket places <span className="font-semibold">REAL orders</span> on your live FYERS account. Orders
            execute immediately at the broker — there is no paper mode here.
          </span>
        </span>
      </Banner>

      {result && (
        <Banner tone={result.ok ? "info" : "loss"}>
          <span className="flex items-center gap-1.5">
            {result.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {result.message}
          </span>
        </Banner>
      )}

      {/* Contract */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Contract</span>
          <ProvenanceBadge kind="BROKER" />
          <span className="ml-auto text-[9px] text-zinc-600">{chain.instrument.label} · lot {lotSize}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={draft.symbol} onChange={(v) => set("symbol", v)} className="min-w-[10rem]">
            <option value="">Select strike…</option>
            {symbolOptions.map((o) => (
              <option key={o.symbol} value={o.symbol}>
                {o.label}
              </option>
            ))}
          </Select>
          {draft.symbol && (
            <span className="font-mono text-2xs text-zinc-300">{symbolShort(draft.symbol)}</span>
          )}
          {quote && quote.hasData ? (
            <span className="ml-auto flex items-center gap-3 font-mono text-[10px] text-zinc-400">
              <span>LTP <span className="text-zinc-100">{quote.ltp > 0 ? dec(quote.ltp, 1) : "—"}</span></span>
              <span>Bid {dec(quote.bid, 1)}</span>
              <span>Ask {dec(quote.ask, 1)}</span>
            </span>
          ) : draft.symbol ? (
            <span className="ml-auto text-[10px] text-zinc-600">no live quote for this strike</span>
          ) : null}
        </div>
      </div>

      {/* Order params */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Side">
            <Segmented
              value={draft.side}
              onChange={(v) => set("side", v)}
              options={[
                { value: "BUY", label: <span className="text-gain">BUY</span> },
                { value: "SELL", label: <span className="text-loss">SELL</span> },
              ]}
            />
          </Field>
          <Field label="Order type">
            <Segmented
              size="xs"
              value={draft.orderType}
              onChange={(v) => set("orderType", v)}
              options={[
                { value: "MARKET", label: "MKT" },
                { value: "LIMIT", label: "LMT" },
                { value: "SL", label: "SL" },
                { value: "SL-M", label: "SL-M" },
              ]}
            />
          </Field>
          <Field label="Product">
            <Segmented
              size="xs"
              value={draft.productType}
              onChange={(v) => set("productType", v)}
              options={[
                { value: "INTRADAY", label: "INTRADAY" },
                { value: "MARGIN", label: "MARGIN" },
                { value: "CNC", label: "CNC" },
              ]}
            />
          </Field>
          <Field label="Validity">
            <Segmented
              size="xs"
              value={draft.validity}
              onChange={(v) => set("validity", v)}
              options={[
                { value: "DAY", label: "DAY" },
                { value: "IOC", label: "IOC" },
              ]}
            />
          </Field>
          <Field label="Lots">
            <NumberField value={Number.isFinite(draft.lots) ? draft.lots : ""} onChange={(v) => set("lots", v)} min={1} step={1} />
          </Field>
          <Field label="Quantity (abs)">
            <div className="rounded-panel border border-border-subtle bg-surface/60 px-2 py-1 font-mono text-2xs text-zinc-300">
              {lots} × {lotSize} = <span className="text-zinc-100">{qty || "—"}</span>
            </div>
          </Field>
          {needsLimit(draft.orderType) && (
            <Field label="Limit price">
              <NumberField value={draft.limitPrice || ""} onChange={(v) => set("limitPrice", v)} min={0} step={0.05} />
            </Field>
          )}
          {needsStop(draft.orderType) && (
            <Field label="Stop / trigger price">
              <NumberField value={draft.stopPrice || ""} onChange={(v) => set("stopPrice", v)} min={0} step={0.05} />
            </Field>
          )}
        </div>

        {isSell && (
          <div className="mt-3">
            <Banner tone="warn">
              <span className="flex items-center gap-1.5">
                <AlertTriangle size={12} />
                Selling (writing) options carries <span className="font-semibold">theoretically undefined risk</span> —
                losses on a naked short are not capped by the premium received. Ensure this is hedged or sized
                accordingly.
              </span>
            </Banner>
          </div>
        )}
      </div>

      {/* Live preview */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Preview</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <Preview
            label="Est. premium"
            value={premiumEstimate > 0 ? rupee(premiumEstimate) : "—"}
            sub={refPrice > 0 ? `${dec(refPrice, 1)} × ${qty || 0}` : "no price"}
            badge={<ProvenanceBadge kind="COMPUTED" />}
          />
          <Preview
            label="Margin impact"
            value={
              margin.loading ? (
                <span className="inline-flex items-center gap-1 text-zinc-400">
                  <Loader2 size={11} className="animate-spin" /> …
                </span>
              ) : margin.margin != null ? (
                rupee(margin.margin)
              ) : orderValid ? (
                rupee(estimatedMargin)
              ) : (
                "—"
              )
            }
            sub={
              margin.margin != null
                ? margin.available != null
                  ? `avail ${rupee(margin.available)}`
                  : "broker required margin"
                : orderValid
                  ? margin.error
                    ? `est. — ${margin.error}`
                    : "local estimate"
                  : "set a valid order"
            }
            badge={
              margin.margin != null ? (
                <ProvenanceBadge kind="BROKER" />
              ) : (
                <ProvenanceBadge kind="COMPUTED" label="Estimate" />
              )
            }
          />
        </div>
        {margin.margin != null && margin.available != null && margin.margin > margin.available && (
          <div className="mt-2">
            <Banner tone="loss">Required margin exceeds available funds — the broker will likely reject this order.</Banner>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone={isSell ? "rose" : "green"}
          disabled={!orderValid || placing}
          onClick={() => {
            setResult(null);
            setConfirm({ kind: "single", order });
          }}
          className="px-4 py-1.5 text-xs font-semibold"
        >
          {isSell ? "SELL — Place live order" : "BUY — Place live order"}
        </Button>
        <Button tone="zinc" disabled={!orderValid} onClick={addToBasket}>
          <span className="flex items-center gap-1">
            <ShoppingBasket size={12} /> Add to basket
          </span>
        </Button>
      </div>

      {/* Basket */}
      {basket.length > 0 && (
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <ShoppingBasket size={12} className="text-zinc-600" />
            <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
              Basket ({basket.length})
            </span>
            <ProvenanceBadge kind="BROKER" />
          </div>
          <div className="space-y-1.5">
            {basket.map((o, i) => (
              <div
                key={`${o.symbol}_${i}`}
                className="flex items-center gap-2 rounded-panel border border-border-subtle bg-surface/40 px-2.5 py-1.5 text-2xs"
              >
                <span className={`font-semibold ${o.side === "BUY" ? "text-gain" : "text-loss"}`}>{o.side}</span>
                <span className="font-mono text-zinc-200">{symbolShort(o.symbol)}</span>
                <span className="text-zinc-500">
                  {o.qty} · {o.orderType}
                  {o.limitPrice ? ` @ ${dec(o.limitPrice, 1)}` : ""}
                  {o.stopPrice ? ` trig ${dec(o.stopPrice, 1)}` : ""}
                </span>
                <span className="ml-auto text-[9px] text-zinc-600">{o.productType}</span>
                <button
                  onClick={() => removeBasket(i)}
                  className="rounded p-1 text-zinc-500 hover:bg-loss-dim hover:text-loss"
                  title="Remove"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              tone="amber"
              disabled={placing}
              onClick={() => {
                setResult(null);
                setConfirm({ kind: "basket", orders: basket });
              }}
            >
              Place all {basket.length} orders
            </Button>
            <Button tone="ghost" onClick={() => setBasket([])}>
              Clear basket
            </Button>
            {basketHasSell && <span className="text-[9px] text-warn">contains short legs · undefined risk</span>}
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          confirm={confirm}
          lotSize={lotSize}
          spot={chain.spot}
          brokerMargin={margin.margin}
          estimatedMargin={estimatedMargin}
          placing={placing}
          onCancel={() => setConfirm(null)}
          onConfirm={() => doPlace(confirm)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Preview({
  label,
  value,
  sub,
  badge,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</span>
        {badge}
      </div>
      <p className="font-mono text-sm font-semibold text-zinc-100">{value}</p>
      {sub != null && <p className="mt-0.5 text-[9px] text-zinc-600">{sub}</p>}
    </div>
  );
}

function ConfirmModal({
  confirm,
  lotSize,
  spot,
  brokerMargin,
  estimatedMargin,
  placing,
  onCancel,
  onConfirm,
}: {
  confirm: Confirm;
  lotSize: number;
  spot: number;
  brokerMargin: number | null;
  estimatedMargin: number;
  placing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const orders = confirm.kind === "single" ? [confirm.order] : confirm.orders;
  const hasSell = orders.some((o) => o.side === "SELL");
  const totalNotional = orders.reduce((s, o) => {
    const px = o.limitPrice && o.limitPrice > 0 ? o.limitPrice : 0;
    return s + px * o.qty;
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-panel border border-loss/40 bg-panel shadow-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <ShieldAlert size={14} className="text-loss" />
          <h3 className="text-2xs font-semibold uppercase tracking-wider text-loss">
            Confirm {confirm.kind === "basket" ? `basket · ${orders.length} orders` : "live order"}
          </h3>
          <button onClick={onCancel} className="ml-auto rounded p-1 text-zinc-500 hover:text-zinc-200" disabled={placing}>
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-auto p-4">
          <div className="rounded-panel border border-loss/40 bg-loss-dim px-3 py-2 text-2xs text-loss">
            <span className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={12} />
              This places a REAL order on your live FYERS account.
            </span>
            <p className="mt-1 text-loss/80">
              Funds and positions will change immediately. Review every line below before confirming.
            </p>
          </div>

          <div className="space-y-2">
            {orders.map((o, i) => (
              <div key={`${o.symbol}_${i}`} className="rounded-panel border border-border-subtle bg-surface/40 p-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`text-2xs font-semibold ${o.side === "BUY" ? "text-gain" : "text-loss"}`}>
                    {o.side}
                  </span>
                  <span className="font-mono text-2xs text-zinc-100">{symbolShort(o.symbol)}</span>
                  <span className="ml-auto text-[9px] text-zinc-600">{o.productType} · {o.validity}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                  <Line k="Qty" v={`${o.qty} (${Math.round(o.qty / lotSize)} lot${o.qty / lotSize === 1 ? "" : "s"})`} />
                  <Line k="Type" v={o.orderType} />
                  {o.limitPrice ? <Line k="Limit" v={dec(o.limitPrice, 2)} /> : null}
                  {o.stopPrice ? <Line k="Trigger" v={dec(o.stopPrice, 2)} /> : null}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-panel border border-border-subtle bg-surface/40 p-2.5 text-[10px]">
            <Line
              k="Margin impact"
              v={
                confirm.kind === "single" && brokerMargin != null
                  ? `${rupee(brokerMargin)} (broker)`
                  : `${rupee(confirm.kind === "single" ? estimatedMargin : totalNotional || estimatedMargin)} (estimate)`
              }
            />
            {confirm.kind === "single" && brokerMargin == null && (
              <p className="mt-1 text-zinc-600">Broker margin unavailable — figure shown is a local estimate, not the broker's.</p>
            )}
            {confirm.kind === "basket" && (
              <p className="mt-1 text-zinc-600">
                Notional from limit-priced legs: {totalNotional > 0 ? rupee(totalNotional) : "—"} · index spot {compact(spot)}.
                Broker margin is netted at placement.
              </p>
            )}
          </div>

          {hasSell && (
            <div className="rounded-panel border border-warn/30 bg-warn-dim px-3 py-2 text-[10px] text-warn">
              Contains a SHORT (sell) leg — undefined / uncapped loss potential on the naked portion.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <Button tone="ghost" onClick={onCancel} disabled={placing}>
            Cancel
          </Button>
          <Button tone="rose" onClick={onConfirm} disabled={placing} className="px-4 font-semibold">
            {placing ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Placing…
              </span>
            ) : (
              "Confirm & place live"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-zinc-600">{k}</span>
      <span className="font-mono text-zinc-200">{v}</span>
    </div>
  );
}
