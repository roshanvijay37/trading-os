/**
 * Strategy Builder — assemble a multi-leg options strategy from a template gallery or by
 * hand. Templates anchor to the live ATM strike and pull live premiums/IV from the chain
 * via the strategy provider; legs are then freely editable (action, instrument, strike,
 * lots, price, IV) with add / remove / reorder. A live summary strip and a compact inline
 * SVG payoff preview (expiry P/L) are COMPUTED from computePayoff on every edit. Other
 * panels can push legs in via the onAddLeg event bus. No fabricated data — premiums and IV
 * originate from the live chain.
 */

import { useEffect, useMemo } from "react";
import { Wrench, Plus, Trash2, ArrowUp, ArrowDown, Layers } from "lucide-react";
import { useStrategy } from "../state/StrategyProvider";
import { ChainGate } from "../components/ChainGate";
import {
  Panel,
  ProvenanceBadge,
  Segmented,
  Select,
  NumberField,
  Button,
  Empty,
  Pill,
} from "../components/ui";
import { computePayoff, type PayoffOpts } from "../lib/payoff";
import { useMeasuredWidth } from "../../components/charts/svgHover";
import { money, dec, volPct, signed } from "../lib/format";
import { onAddLeg } from "../lib/events";
import { useTheme } from "../../store/theme";
import { getChartPalette } from "../../lib/chartTheme";
import type {
  EnrichedChain,
  LegAction,
  LegInstrument,
  PayoffResult,
  StrategyLeg,
  StrategyTemplate,
} from "../types";

const CATEGORY_ORDER: StrategyTemplate["category"][] = [
  "BULLISH",
  "BEARISH",
  "NEUTRAL",
  "VOLATILITY",
  "INCOME",
  "SYNTHETIC",
  "ARBITRAGE",
];

const CATEGORY_TONE: Record<StrategyTemplate["category"], "green" | "rose" | "blue" | "amber" | "zinc"> = {
  BULLISH: "green",
  BEARISH: "rose",
  NEUTRAL: "blue",
  VOLATILITY: "amber",
  INCOME: "green",
  SYNTHETIC: "blue",
  ARBITRAGE: "zinc",
};

export function StrategyBuilderPanel() {
  return (
    <Panel
      title="Strategy Builder"
      icon={Wrench}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <BuilderBody chain={chain} />}</ChainGate>
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

function BuilderBody({ chain }: { chain: EnrichedChain }) {
  const strat = useStrategy();

  // Let other panels (option chain, screener, etc.) push legs into the builder.
  useEffect(() => {
    return onAddLeg((d) => {
      strat.addLeg({ action: d.action, instrument: d.instrument, strike: d.strike });
    });
  }, [strat]);

  const opts = useMemo(() => buildOpts(chain), [chain]);
  const result = useMemo<PayoffResult>(() => computePayoff(strat.legs, opts), [strat.legs, opts]);

  const grouped = useMemo(() => {
    const map = new Map<StrategyTemplate["category"], StrategyTemplate[]>();
    for (const t of strat.templates) {
      const arr = map.get(t.category) ?? [];
      arr.push(t);
      map.set(t.category, arr);
    }
    return map;
  }, [strat.templates]);

  const strikes = useMemo(() => chain.rows.map((r) => r.strike), [chain.rows]);

  return (
    <div className="space-y-4">
      {/* ---- Template gallery ---- */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Layers size={12} className="text-zinc-600" strokeWidth={1.5} />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Template gallery</span>
          <span className="ml-auto text-[9px] text-zinc-700">
            ATM {chain.atmStrike} · spot {dec(chain.spot, 0)}
          </span>
        </div>
        <div className="space-y-3">
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped.get(cat);
            if (!items || items.length === 0) return null;
            return (
              <div key={cat}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Pill tone={CATEGORY_TONE[cat]}>{cat}</Pill>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => strat.loadTemplate(t.id)}
                      className="group rounded-panel border border-border bg-panel px-2.5 py-2 text-left transition hover:border-border-hover hover:bg-surface/60"
                      title={t.description}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-2xs font-semibold text-zinc-200 group-hover:text-zinc-100">{t.name}</span>
                        <span className="shrink-0 text-[9px] font-medium text-zinc-600">{t.outlook}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-zinc-600">{t.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Leg editor ---- */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            Legs <span className="text-zinc-700">({strat.legs.length})</span>
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button tone="blue" onClick={() => strat.addLeg()}>
              <span className="inline-flex items-center gap-1">
                <Plus size={11} /> Add leg
              </span>
            </Button>
            <Button tone="zinc" onClick={() => strat.clear()} disabled={strat.legs.length === 0}>
              Clear
            </Button>
          </div>
        </div>

        {strat.legs.length === 0 ? (
          <Empty icon={Wrench} message="No legs yet. Pick a template above or add a leg to start building." />
        ) : (
          <div className="overflow-x-auto rounded-panel border border-border">
            <table className="w-full min-w-[640px] border-collapse text-2xs">
              <thead className="bg-surface/40">
                <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                  <Th center>#</Th>
                  <Th>Action</Th>
                  <Th>Type</Th>
                  <Th>Strike</Th>
                  <Th>Lots</Th>
                  <Th>Price</Th>
                  <Th>IV</Th>
                  <Th center>Order</Th>
                  <Th center>—</Th>
                </tr>
              </thead>
              <tbody>
                {strat.legs.map((leg, i) => (
                  <LegRow
                    key={leg.id}
                    leg={leg}
                    index={i}
                    last={i === strat.legs.length - 1}
                    strikes={strikes}
                    chain={chain}
                    onUp={() => moveLeg(strat.legs, i, -1, strat.setLegs)}
                    onDown={() => moveLeg(strat.legs, i, 1, strat.setLegs)}
                    onUpdate={(patch) => strat.updateLeg(leg.id, patch)}
                    onRemove={() => strat.removeLeg(leg.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Live summary + preview ---- */}
      {strat.legs.length > 0 && <SummaryStrip result={result} chain={chain} />}
    </div>
  );
}

function moveLeg(legs: StrategyLeg[], index: number, dir: -1 | 1, setLegs: (l: StrategyLeg[]) => void) {
  const next = index + dir;
  if (next < 0 || next >= legs.length) return;
  const copy = legs.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  setLegs(copy);
}

function LegRow({
  leg,
  index,
  last,
  strikes,
  chain,
  onUp,
  onDown,
  onUpdate,
  onRemove,
}: {
  leg: StrategyLeg;
  index: number;
  last: boolean;
  strikes: number[];
  chain: EnrichedChain;
  onUp: () => void;
  onDown: () => void;
  onUpdate: (patch: Partial<StrategyLeg>) => void;
  onRemove: () => void;
}) {
  const isFut = leg.instrument === "FUT";
  const knownStrike = strikes.includes(leg.strike);

  // When instrument or strike changes, re-anchor price/IV to the live chain value.
  const repriceFor = (instrument: LegInstrument, strike: number): Partial<StrategyLeg> => {
    const price = priceFromChain(chain, instrument, strike);
    const iv = ivFromChain(chain, instrument, strike);
    return { price, iv };
  };

  return (
    <tr className="border-t border-border-subtle/60 hover:bg-surface/40">
      <td className="px-1.5 py-1 text-center font-mono text-zinc-600">{index + 1}</td>
      <td className="px-1.5 py-1">
        <Segmented<LegAction>
          size="xs"
          value={leg.action}
          onChange={(v) => onUpdate({ action: v })}
          options={[
            { value: "BUY", label: "Buy" },
            { value: "SELL", label: "Sell" },
          ]}
        />
      </td>
      <td className="px-1.5 py-1">
        <Select
          value={leg.instrument}
          onChange={(v) => {
            const instrument = v as LegInstrument;
            if (instrument === "FUT") {
              onUpdate({ instrument, strike: 0, ...repriceFor(instrument, 0) });
            } else {
              const strike = knownStrike ? leg.strike : chain.atmStrike;
              onUpdate({ instrument, strike, ...repriceFor(instrument, strike) });
            }
          }}
        >
          <option value="CE">CE</option>
          <option value="PE">PE</option>
          <option value="FUT">FUT</option>
        </Select>
      </td>
      <td className="px-1.5 py-1">
        {isFut ? (
          <span className="font-mono text-zinc-600">—</span>
        ) : strikes.length > 0 ? (
          <Select
            value={knownStrike ? String(leg.strike) : ""}
            onChange={(v) => {
              const strike = Number(v);
              onUpdate({ strike, ...repriceFor(leg.instrument, strike) });
            }}
          >
            {!knownStrike && <option value="">{leg.strike || "—"}</option>}
            {strikes.map((s) => (
              <option key={s} value={s}>
                {s}
                {s === chain.atmStrike ? " (ATM)" : ""}
              </option>
            ))}
          </Select>
        ) : (
          <NumberField
            value={leg.strike}
            step={chain.instrument.strikeInterval}
            onChange={(v) => Number.isFinite(v) && onUpdate({ strike: v, ...repriceFor(leg.instrument, v) })}
            className="w-20"
          />
        )}
      </td>
      <td className="px-1.5 py-1">
        <NumberField
          value={leg.lots}
          min={1}
          step={1}
          onChange={(v) => Number.isFinite(v) && v > 0 && onUpdate({ lots: Math.round(v) })}
          className="w-14"
        />
      </td>
      <td className="px-1.5 py-1">
        <NumberField
          value={Number.isFinite(leg.price) ? Number(leg.price.toFixed(2)) : 0}
          min={0}
          step={0.05}
          onChange={(v) => Number.isFinite(v) && onUpdate({ price: v })}
          className="w-20"
        />
      </td>
      <td className="px-1.5 py-1 text-right font-mono text-zinc-400">{isFut ? "—" : volPct(leg.iv)}</td>
      <td className="px-1.5 py-1 text-center">
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
            leg.action === "BUY" ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"
          }`}
        >
          {leg.action === "BUY" ? "Debit" : "Credit"}
        </span>
      </td>
      <td className="px-1.5 py-1">
        <div className="flex items-center justify-center gap-0.5">
          <IconBtn label="Move up" disabled={index === 0} onClick={onUp}>
            <ArrowUp size={11} />
          </IconBtn>
          <IconBtn label="Move down" disabled={last} onClick={onDown}>
            <ArrowDown size={11} />
          </IconBtn>
          <IconBtn label="Remove leg" tone="loss" onClick={onRemove}>
            <Trash2 size={11} />
          </IconBtn>
        </div>
      </td>
    </tr>
  );
}

function priceFromChain(chain: EnrichedChain, instrument: LegInstrument, strike: number): number {
  if (instrument === "FUT") return chain.spot;
  const row = chain.rows.find((r) => r.strike === strike);
  if (!row) return 0;
  return instrument === "CE" ? row.ce.ltp : row.pe.ltp;
}

function ivFromChain(chain: EnrichedChain, instrument: LegInstrument, strike: number): number {
  if (instrument === "FUT") return 0;
  const row = chain.rows.find((r) => r.strike === strike);
  const vixIv = chain.vix ? chain.vix.value / 100 : 0;
  if (!row) return vixIv;
  const iv = instrument === "CE" ? row.ce.iv : row.pe.iv;
  return iv > 0 ? iv : vixIv;
}

function SummaryStrip({ result, chain }: { result: PayoffResult; chain: EnrichedChain }) {
  const credit = result.netPremium < 0;
  return (
    <section className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Live summary</span>
        <ProvenanceBadge kind="COMPUTED" />
        <span className="ml-auto text-[9px] text-zinc-700">P/L per position · lot size {chain.instrument.lotSize}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <SummaryCell
          label={credit ? "Net credit" : "Net debit"}
          value={money(Math.abs(result.netPremium))}
          tone={credit ? "text-gain" : "text-loss"}
        />
        <SummaryCell
          label="Max profit"
          value={Number.isFinite(result.maxProfit) ? money(result.maxProfit) : "Unlimited"}
          tone="text-gain"
        />
        <SummaryCell
          label="Max loss"
          value={Number.isFinite(result.maxLoss) ? money(result.maxLoss) : "Unlimited"}
          tone="text-loss"
        />
        <SummaryCell
          label="Net delta"
          value={signed(result.greeks.delta, 2)}
          tone={result.greeks.delta >= 0 ? "text-gain" : "text-loss"}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-zinc-600">
        <span>
          Break-even{result.breakevens.length === 1 ? "" : "s"}{" "}
          <span className="font-mono text-zinc-300">
            {result.breakevens.length > 0 ? result.breakevens.map((b) => dec(b, 0)).join(" · ") : "—"}
          </span>
        </span>
        <span>
          POP <span className="font-mono text-zinc-300">{dec(result.probOfProfit * 100, 1)}%</span>
        </span>
        <span>
          R:R{" "}
          <span className="font-mono text-zinc-300">
            {result.riskReward > 0 ? `1 : ${dec(result.riskReward, 2)}` : "Undefined"}
          </span>
        </span>
      </div>

      <div className="mt-3">
        <PayoffPreview result={result} chain={chain} />
      </div>
    </section>
  );
}

function SummaryCell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</div>
      <p className={`mt-0.5 font-mono text-sm font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

const PV_W = 560;
const PV_H = 110;
const PV_PAD_X = 8;
const PV_PAD_Y = 8;

function PayoffPreview({ result, chain }: { result: PayoffResult; chain: EnrichedChain }) {
  // Measured width so the viewBox matches the rendered CSS px — no more
  // preserveAspectRatio="none" stretching at narrow widths.
  const [wrapRef, measuredW] = useMeasuredWidth<HTMLDivElement>();
  const width = measuredW || PV_W;
  const geom = useMemo(() => {
    const pts = result.points;
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p.spot);
    const minX = xs[0];
    const maxX = xs[xs.length - 1];
    const ys = pts.map((p) => p.expiryPnl);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (!(maxX > minX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    const plotW = width - 2 * PV_PAD_X;
    const plotH = PV_H - 2 * PV_PAD_Y;
    const sx = (s: number) => PV_PAD_X + ((s - minX) / (maxX - minX)) * plotW;
    const sy = (v: number) => PV_PAD_Y + (1 - (v - minY) / (maxY - minY)) * plotH;
    const zeroY = sy(0);
    const line = pts.map((p) => `${sx(p.spot).toFixed(1)},${sy(p.expiryPnl).toFixed(1)}`).join(" ");
    const spotX = sx(Math.min(maxX, Math.max(minX, chain.spot)));
    const bes = result.breakevens.filter((b) => b >= minX && b <= maxX).map(sx);
    return { sx, sy, zeroY, line, spotX, bes };
  }, [result.points, result.breakevens, chain.spot, width]);
  const palette = getChartPalette(useTheme());

  if (!geom) return <p className="text-[9px] text-zinc-700">Not enough resolution to draw the payoff preview.</p>;

  const zeroInView = geom.zeroY >= PV_PAD_Y && geom.zeroY <= PV_H - PV_PAD_Y;

  return (
    <div ref={wrapRef}>
      <svg viewBox={`0 0 ${width} ${PV_H}`} className="w-full">
        {zeroInView && (
          <line x1={PV_PAD_X} y1={geom.zeroY} x2={width - PV_PAD_X} y2={geom.zeroY} stroke={palette.axisLabel} strokeWidth={1} strokeDasharray="3 3" />
        )}
        <polyline points={geom.line} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        {geom.bes.map((x, i) => (
          <line key={i} x1={x} y1={PV_PAD_Y} x2={x} y2={PV_H - PV_PAD_Y} stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 2" />
        ))}
        <line x1={geom.spotX} y1={PV_PAD_Y} x2={geom.spotX} y2={PV_H - PV_PAD_Y} stroke={palette.spot} strokeWidth={1} />
      </svg>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  tone?: "loss";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded p-1 transition disabled:opacity-30 ${
        tone === "loss" ? "text-zinc-600 hover:bg-loss/10 hover:text-loss" : "text-zinc-600 hover:bg-surface hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function Th({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <th className={`px-1.5 py-1.5 font-semibold ${center ? "text-center" : "text-left"}`}>{children}</th>;
}
