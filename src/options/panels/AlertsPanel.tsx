/**
 * Alerts — user-defined price/IV/OI/Δ/PCR/volume/premium triggers, persisted locally via
 * alertStore. Alerts are evaluated LIVE against the in-memory option chain on every feed
 * update while this app is open — there is NO server-side push, and we say so honestly. A
 * symbol-scoped alert reads the matching chain quote (ltp/iv/oi/volume/greeks.delta/extrinsic);
 * a PCR alert reads chain.pcr. Nothing is fabricated: when the chain has no live value for a
 * metric we leave the current reading blank rather than inventing one.
 */

import { useEffect, useMemo, useState } from "react";
import { BellRing, Plus, Trash2, Pause, Play, CheckCircle2, AlertTriangle } from "lucide-react";
import { useOptionsData } from "../data/OptionsDataProvider";
import { Panel, ProvenanceBadge, Segmented, Select, NumberField, Button, Banner, Empty, Pill } from "../components/ui";
import { alertStore } from "../lib/storage";
import { dec, volPct, compact, fmtTime } from "../lib/format";
import type { AlertMetric, AlertOp, EnrichedChain, OptionAlert, OptionQuote } from "../types";

const METRICS: { value: AlertMetric; label: string; scope: "SYMBOL" | "INSTRUMENT" }[] = [
  { value: "PRICE", label: "Price (LTP)", scope: "SYMBOL" },
  { value: "PREMIUM", label: "Premium (time value)", scope: "SYMBOL" },
  { value: "IV", label: "IV", scope: "SYMBOL" },
  { value: "DELTA", label: "Delta", scope: "SYMBOL" },
  { value: "OI", label: "Open Interest", scope: "SYMBOL" },
  { value: "VOLUME", label: "Volume", scope: "SYMBOL" },
  { value: "PCR", label: "PCR (chain)", scope: "INSTRUMENT" },
];

const OPS: AlertOp[] = [">", ">=", "<", "<="];

function metricScope(m: AlertMetric): "SYMBOL" | "INSTRUMENT" {
  return METRICS.find((x) => x.value === m)?.scope ?? "SYMBOL";
}

/** Read the current live value for an alert, or null when the chain can't provide it. */
function readCurrent(alert: OptionAlert, chain: EnrichedChain): number | null {
  if (alert.metric === "PCR") {
    return Number.isFinite(chain.pcr) && chain.pcr > 0 ? chain.pcr : null;
  }
  if (!alert.symbol) return null;
  let quote: OptionQuote | undefined;
  for (const r of chain.rows) {
    if (r.ce.symbol === alert.symbol) {
      quote = r.ce;
      break;
    }
    if (r.pe.symbol === alert.symbol) {
      quote = r.pe;
      break;
    }
  }
  if (!quote || !quote.hasData) return null;
  switch (alert.metric) {
    case "PRICE":
      return quote.ltp > 0 ? quote.ltp : null;
    case "PREMIUM":
      return Number.isFinite(quote.extrinsic) ? quote.extrinsic : null;
    case "IV":
      return quote.iv > 0 ? quote.iv : null;
    case "DELTA":
      return quote.iv > 0 ? quote.greeks.delta : null;
    case "OI":
      return Number.isFinite(quote.oi) ? quote.oi : null;
    case "VOLUME":
      return Number.isFinite(quote.volume) ? quote.volume : null;
    default:
      return null;
  }
}

function holds(current: number, op: AlertOp, threshold: number): boolean {
  switch (op) {
    case ">":
      return current > threshold;
    case ">=":
      return current >= threshold;
    case "<":
      return current < threshold;
    case "<=":
      return current <= threshold;
  }
}

/** Display a metric value in its natural units (IV/Delta as %, others raw). */
function fmtMetric(metric: AlertMetric, v: number): string {
  if (metric === "IV") return volPct(v);
  if (metric === "DELTA") return dec(v, 2);
  if (metric === "PCR") return dec(v, 2);
  if (metric === "OI" || metric === "VOLUME") return compact(v);
  return dec(v, 1);
}

function fmtThreshold(metric: AlertMetric, v: number): string {
  if (metric === "IV") return `${dec(v, 1)}%`;
  return fmtMetric(metric, v);
}

export function AlertsPanel() {
  const data = useOptionsData();
  const chain = data.chain;
  const [alerts, setAlerts] = useState<OptionAlert[]>(() => alertStore.all());

  // Form state
  const [metric, setMetric] = useState<AlertMetric>("PRICE");
  const [op, setOp] = useState<AlertOp>(">");
  const [threshold, setThreshold] = useState<number>(0);
  const [symbol, setSymbol] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const scope = metricScope(metric);

  // Strikes (CE/PE) available from the live chain, for the symbol picker.
  const symbolOptions = useMemo(() => {
    if (!chain) return [] as { symbol: string; label: string }[];
    const out: { symbol: string; label: string }[] = [];
    for (const r of chain.rows) {
      if (r.ce.symbol) out.push({ symbol: r.ce.symbol, label: `${r.strike} CE` });
      if (r.pe.symbol) out.push({ symbol: r.pe.symbol, label: `${r.strike} PE` });
    }
    return out;
  }, [chain]);

  // LIVE evaluation: whenever the feed snapshot changes, re-check every active alert and
  // stamp triggeredAt the first time its condition holds. Persisted so it survives reloads.
  useEffect(() => {
    if (!chain) return;
    const all = alertStore.all();
    let changed = false;
    for (const a of all) {
      if (!a.active || a.triggeredAt) continue;
      // A symbol-scoped alert must match this instrument's chain.
      if (a.instrument !== chain.instrument.id) continue;
      const cur = readCurrent(a, chain);
      if (cur == null) continue;
      if (holds(cur, a.op, a.threshold)) {
        alertStore.update(a.id, { triggeredAt: Date.now() });
        changed = true;
      }
    }
    if (changed) setAlerts(alertStore.all());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain?.asOf, chain?.instrument.id]);

  const addAlert = () => {
    if (!Number.isFinite(threshold)) return;
    if (scope === "SYMBOL" && !symbol) return;
    const item: OptionAlert = {
      id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      instrument: data.instrument.id,
      symbol: scope === "SYMBOL" ? symbol : undefined,
      metric,
      op,
      threshold,
      note: note.trim() || undefined,
      createdAt: Date.now(),
      active: true,
    };
    setAlerts(alertStore.add(item));
    setNote("");
  };

  const toggle = (a: OptionAlert) => {
    // Re-arming a triggered alert clears its trigger stamp so it can fire again.
    const patch: Partial<OptionAlert> = a.active
      ? { active: false }
      : { active: true, triggeredAt: undefined };
    setAlerts(alertStore.update(a.id, patch));
  };

  const remove = (id: string) => setAlerts(alertStore.remove(id));

  const triggered = alerts.filter((a) => a.triggeredAt);
  const armed = alerts.filter((a) => a.active && !a.triggeredAt);
  const paused = alerts.filter((a) => !a.active && !a.triggeredAt);

  return (
    <Panel
      title="Alerts"
      icon={BellRing}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <div className="space-y-3">
        <Banner tone="info">
          Alerts evaluate <span className="font-semibold">live, in this browser tab, while the app is open</span> — there
          is no server-side push or background watcher. Symbol metrics read the live chain quote; PCR reads the chain
          aggregate. Nothing is shown when the feed has no value.
        </Banner>

        {/* Create */}
        <div className="rounded-panel border border-border bg-panel p-3">
          <div className="mb-2 flex items-center gap-2">
            <Plus size={12} className="text-zinc-600" />
            <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">New alert</span>
            <span className="ml-auto text-[9px] text-zinc-600">{data.instrument.label}</span>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={metric} onChange={(v) => setMetric(v as AlertMetric)}>
                {METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <Segmented
                size="xs"
                value={op}
                onChange={(v) => setOp(v)}
                options={OPS.map((o) => ({ value: o, label: o }))}
              />
              <div className="w-28">
                <NumberField
                  value={Number.isFinite(threshold) ? threshold : ""}
                  onChange={(v) => setThreshold(v)}
                  step={metric === "IV" ? 0.5 : metric === "DELTA" || metric === "PCR" ? 0.05 : 1}
                  placeholder={metric === "IV" ? "vol %" : "threshold"}
                />
              </div>
              {metric === "IV" && <span className="text-[9px] text-zinc-600">enter vol %, e.g. 14.5</span>}
            </div>

            {scope === "SYMBOL" ? (
              <div className="flex flex-wrap items-center gap-2">
                {symbolOptions.length > 0 ? (
                  <Select value={symbol} onChange={(v) => setSymbol(v)} className="min-w-[9rem]">
                    <option value="">Select strike…</option>
                    {symbolOptions.map((o) => (
                      <option key={o.symbol} value={o.symbol}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-2xs text-zinc-600">
                    Connect to the live chain to pick a strike for symbol-scoped alerts.
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[9px] text-zinc-600">Instrument-level alert on the {data.instrument.label} chain PCR.</p>
            )}

            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)…"
              className="w-full rounded-panel border border-border-subtle bg-surface px-2 py-1 text-2xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-border-hover"
            />

            <div className="flex justify-end">
              <Button
                tone="blue"
                onClick={addAlert}
                disabled={!Number.isFinite(threshold) || (scope === "SYMBOL" && !symbol)}
              >
                Add alert
              </Button>
            </div>
          </div>
        </div>

        {/* Triggered */}
        {triggered.length > 0 && (
          <AlertGroup
            title="Triggered"
            icon={CheckCircle2}
            iconClass="text-warn"
            alerts={triggered}
            chain={chain}
            onToggle={toggle}
            onRemove={remove}
          />
        )}

        {/* Armed */}
        <AlertGroup
          title={`Armed (${armed.length})`}
          icon={BellRing}
          iconClass="text-gain"
          alerts={armed}
          chain={chain}
          onToggle={toggle}
          onRemove={remove}
          emptyMessage="No armed alerts. Create one above — it will start evaluating against the live chain immediately."
        />

        {/* Paused */}
        {paused.length > 0 && (
          <AlertGroup
            title="Paused"
            icon={Pause}
            iconClass="text-zinc-500"
            alerts={paused}
            chain={chain}
            onToggle={toggle}
            onRemove={remove}
          />
        )}
      </div>
    </Panel>
  );
}

function AlertGroup({
  title,
  icon: Icon,
  iconClass,
  alerts,
  chain,
  onToggle,
  onRemove,
  emptyMessage,
}: {
  title: string;
  icon: typeof BellRing;
  iconClass: string;
  alerts: OptionAlert[];
  chain: EnrichedChain | null;
  onToggle: (a: OptionAlert) => void;
  onRemove: (id: string) => void;
  emptyMessage?: string;
}) {
  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={12} className={iconClass} />
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{title}</span>
      </div>
      {alerts.length === 0 ? (
        emptyMessage ? (
          <Empty message={emptyMessage} icon={AlertTriangle} />
        ) : null
      ) : (
        <div className="space-y-1.5">
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} chain={chain} onToggle={onToggle} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  chain,
  onToggle,
  onRemove,
}: {
  alert: OptionAlert;
  chain: EnrichedChain | null;
  onToggle: (a: OptionAlert) => void;
  onRemove: (id: string) => void;
}) {
  const sameInstrument = chain?.instrument.id === alert.instrument;
  const current = chain && sameInstrument ? readCurrent(alert, chain) : null;
  const isHolding = current != null && holds(current, alert.op, alert.threshold);

  const target =
    alert.metric === "PCR" ? "PCR" : symbolShort(alert.symbol) || alert.metric;

  const stateTone = alert.triggeredAt
    ? "amber"
    : !alert.active
      ? "zinc"
      : isHolding
        ? "green"
        : "blue";

  return (
    <div
      className={`flex items-center gap-2 rounded-panel border px-2.5 py-1.5 ${
        alert.triggeredAt ? "border-warn/30 bg-warn-dim/40" : "border-border-subtle bg-surface/40"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-2xs text-zinc-200">{target}</span>
          <Pill tone={stateTone}>
            {alert.metric} {alert.op} {fmtThreshold(alert.metric, alert.threshold)}
          </Pill>
          {alert.metric === "PCR" ? (
            <ProvenanceBadge kind="COMPUTED" label="PCR" />
          ) : (
            <ProvenanceBadge kind="BROKER" />
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[9px]">
          {!sameInstrument && chain ? (
            <span className="text-zinc-600">
              Switch to {alert.instrument} to evaluate (chain showing {chain.instrument.label})
            </span>
          ) : current == null ? (
            <span className="text-zinc-600">{chain ? "no live value" : "feed offline"}</span>
          ) : (
            <span className="text-zinc-500">
              now <span className={`font-mono ${isHolding ? "text-gain" : "text-zinc-300"}`}>{fmtMetric(alert.metric, current)}</span>
              {isHolding && !alert.triggeredAt ? <span className="ml-1 text-gain">· condition met</span> : null}
            </span>
          )}
          {alert.triggeredAt && (
            <span className="text-warn">fired {fmtTime(alert.triggeredAt)}</span>
          )}
          {alert.note && <span className="truncate text-zinc-600">· {alert.note}</span>}
        </div>
      </div>
      <button
        onClick={() => onToggle(alert)}
        className="rounded p-1 text-zinc-500 hover:bg-surface hover:text-zinc-200"
        title={alert.active && !alert.triggeredAt ? "Pause" : "Arm / re-arm"}
      >
        {alert.active && !alert.triggeredAt ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <button
        onClick={() => onRemove(alert.id)}
        className="rounded p-1 text-zinc-500 hover:bg-loss-dim hover:text-loss"
        title="Delete"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

/** Shorten a FYERS option symbol for compact display, e.g. NSE:NIFTY25JAN24500CE → 24500CE. */
function symbolShort(symbol?: string): string {
  if (!symbol) return "";
  const m = symbol.match(/(\d{4,6}(?:CE|PE))$/);
  return m ? m[1] : symbol.replace(/^.*:/, "");
}
