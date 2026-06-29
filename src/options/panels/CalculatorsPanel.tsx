/**
 * Option Calculators — a segmented set of COMPUTED tools.
 *
 * Every calculator here is locally COMPUTED via lib/bs.ts (Black-Scholes, Greeks, IV) or
 * plain arithmetic. Nothing is broker-fed: the numeric INPUTS are user-entered, but when a
 * live chain is connected we PREFILL sensible defaults (spot, ATM strike, ATM IV, days-to-
 * expiry, risk-free rate, lot size) from it so the trader starts from reality, not zeros.
 *
 * Calculators:
 *   - Black-Scholes price (+ a Cox-Ross-Rubinstein binomial price for comparison, implemented
 *     inline in this file with an American/European toggle and N steps).
 *   - Greeks (reuses computeGreeks; all first- and second-order Greeks).
 *   - Implied Volatility (impliedVol from a market price).
 *   - Margin (simple SPAN-style estimate for a short option — labelled an estimate; the broker
 *     SPAN+Exposure number lives in the Margin panel).
 *   - Position Size / Lots (capital, risk%, SL points → max lots given the chain lot size).
 *   - Premium (price × lot × lots → total premium / cost).
 *   - Risk (entry, SL, qty → ₹ risk; R-multiple to a target).
 */

import { useMemo, useState } from "react";
import {
  Calculator,
  Sigma,
  Activity,
  Percent,
  Wallet,
  Layers,
  Coins,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useOptionsData } from "../state/OptionsDataProvider";
import { Panel, ProvenanceBadge, Segmented, Select, NumberField, Row, Banner } from "../components/ui";
import { bsPrice, computeGreeks, impliedVol, DEFAULT_R } from "../lib/bs";
import { dec, signed, volPct, rupee, int } from "../lib/format";
import type { EnrichedChain, OptionType, StrikeRow } from "../types";

// ---------------------------------------------------------------------------
// Inline Cox-Ross-Rubinstein binomial pricer (kept local to this calculator file).
// European or American, N steps. Same continuous-q convention as bs.ts.
// ---------------------------------------------------------------------------

interface CrrInputs {
  type: OptionType;
  spot: number;
  strike: number;
  t: number; // years
  r: number;
  q: number;
  sigma: number;
  steps: number;
  american: boolean;
}

function crrPrice({ type, spot, strike, t, r, q, sigma, steps, american }: CrrInputs): number {
  if (!(spot > 0) || !(strike > 0) || steps < 1) return 0;
  if (!(t > 0) || !(sigma > 0)) {
    return type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }
  const dt = t / steps;
  const u = Math.exp(sigma * Math.sqrt(dt));
  const d = 1 / u;
  const disc = Math.exp(-r * dt);
  const p = (Math.exp((r - q) * dt) - d) / (u - d);
  if (!(p >= 0) || !(p <= 1)) return 0; // arbitrage / numerical breakdown guard

  // Terminal payoffs.
  const values: number[] = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const st = spot * Math.pow(u, steps - i) * Math.pow(d, i);
    values[i] = type === "CE" ? Math.max(0, st - strike) : Math.max(0, strike - st);
  }
  // Backward induction.
  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      let v = disc * (p * values[i] + (1 - p) * values[i + 1]);
      if (american) {
        const st = spot * Math.pow(u, step - i) * Math.pow(d, i);
        const exercise = type === "CE" ? Math.max(0, st - strike) : Math.max(0, strike - st);
        v = Math.max(v, exercise);
      }
      values[i] = v;
    }
  }
  return values[0];
}

// ---------------------------------------------------------------------------
// Prefill defaults from the live chain (guard for null — calculators work standalone).
// ---------------------------------------------------------------------------

interface Prefill {
  connected: boolean;
  spot: number;
  strike: number;
  days: number;
  iv: number; // decimal
  r: number;
  lotSize: number;
  type: OptionType;
  ltp: number;
}

function derivePrefill(chain: EnrichedChain | null, lotSize: number): Prefill {
  if (!chain) {
    return {
      connected: false,
      spot: 0,
      strike: 0,
      days: 7,
      iv: 0.13,
      r: DEFAULT_R,
      lotSize,
      type: "CE",
      ltp: 0,
    };
  }
  const atm: StrikeRow | undefined = chain.rows.find((row) => row.isAtm) ?? chain.rows[0];
  const vixIv = chain.vix && chain.vix.value > 0 ? chain.vix.value / 100 : 0;
  const atmIv = atm ? atm.ce.iv || atm.pe.iv || vixIv : vixIv;
  const days = chain.selectedExpiry?.daysRemaining ?? 7;
  return {
    connected: true,
    spot: chain.spot,
    strike: atm?.strike ?? chain.atmStrike,
    days: days > 0 ? days : 1,
    iv: atmIv > 0 ? atmIv : chain.instrument.fallbackIv,
    r: chain.riskFreeRate || DEFAULT_R,
    lotSize: chain.instrument.lotSize,
    type: "CE",
    ltp: atm ? atm.ce.ltp : 0,
  };
}

type CalcId = "bs" | "greeks" | "iv" | "margin" | "size" | "premium" | "risk";

const CALCS: { id: CalcId; label: string }[] = [
  { id: "bs", label: "Black-Scholes" },
  { id: "greeks", label: "Greeks" },
  { id: "iv", label: "Implied Vol" },
  { id: "margin", label: "Margin" },
  { id: "size", label: "Position Size" },
  { id: "premium", label: "Premium" },
  { id: "risk", label: "Risk" },
];

export function CalculatorsPanel() {
  const data = useOptionsData();
  const [calc, setCalc] = useState<CalcId>("bs");

  const prefill = useMemo(
    () => derivePrefill(data.chain, data.instrument.lotSize),
    [data.chain, data.instrument.lotSize],
  );

  return (
    <Panel
      title="Option Calculators"
      icon={Calculator}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="xs"
            value={calc}
            onChange={(v) => setCalc(v as CalcId)}
            options={CALCS.map((c) => ({ value: c.id, label: c.label }))}
          />
        </div>

        {prefill.connected ? (
          <p className="px-0.5 text-[9px] text-zinc-600">
            Prefilled from the live {data.instrument.label} chain (spot {dec(prefill.spot, 1)}, ATM{" "}
            {prefill.strike}, IV {volPct(prefill.iv)}, {int(prefill.days)}d). Every output is COMPUTED — edit any input
            freely.
          </p>
        ) : (
          <Banner tone="info">
            No live chain connected — calculators run standalone on the inputs you enter. Connect FYERS to prefill
            spot / strike / IV / expiry from the live chain.
          </Banner>
        )}

        {calc === "bs" && <BlackScholesCalc prefill={prefill} />}
        {calc === "greeks" && <GreeksCalc prefill={prefill} />}
        {calc === "iv" && <IvCalc prefill={prefill} />}
        {calc === "margin" && <MarginCalc prefill={prefill} />}
        {calc === "size" && <PositionSizeCalc prefill={prefill} />}
        {calc === "premium" && <PremiumCalc prefill={prefill} />}
        {calc === "risk" && <RiskCalc prefill={prefill} />}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Shared field/result building blocks
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center justify-between">
        <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">{label}</span>
        {hint && <span className="text-[9px] text-zinc-700">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function TypeToggle({ value, onChange }: { value: OptionType; onChange: (v: OptionType) => void }) {
  return (
    <Segmented
      value={value}
      onChange={(v) => onChange(v as OptionType)}
      options={[
        { value: "CE", label: "Call (CE)" },
        { value: "PE", label: "Put (PE)" },
      ]}
    />
  );
}

function ResultCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-panel border border-border bg-panel p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={12} className="text-zinc-600" strokeWidth={1.5} />
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{title}</span>
        <ProvenanceBadge kind="COMPUTED" />
      </div>
      {children}
    </div>
  );
}

function BigValue({ value, sub, tone = "zinc" }: { value: string; sub?: string; tone?: "zinc" | "gain" | "loss" }) {
  const cls = tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-zinc-100";
  return (
    <div>
      <p className={`font-mono text-2xl font-semibold ${cls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-2xs text-zinc-600">{sub}</p>}
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

/** Two-column shell: inputs left, results right. */
function CalcShell({ inputs, results }: { inputs: React.ReactNode; results: React.ReactNode }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="space-y-3 rounded-panel border border-border bg-panel p-3">
        <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Inputs</span>
        {inputs}
      </div>
      <div className="space-y-3">{results}</div>
    </div>
  );
}

const daysToT = (days: number) => Math.max(days, 0) / 365;

// ---------------------------------------------------------------------------
// 1) Black-Scholes (+ inline CRR binomial)
// ---------------------------------------------------------------------------

function BlackScholesCalc({ prefill }: { prefill: Prefill }) {
  const [type, setType] = useState<OptionType>(prefill.type);
  const [spot, setSpot] = useState(prefill.spot);
  const [strike, setStrike] = useState(prefill.strike);
  const [days, setDays] = useState(prefill.days);
  const [ivPct, setIvPct] = useState(prefill.iv * 100);
  const [rPct, setRPct] = useState(prefill.r * 100);
  const [american, setAmerican] = useState(false);
  const [steps, setSteps] = useState(200);

  const t = daysToT(days);
  const sigma = ivPct / 100;
  const r = rPct / 100;

  const bs = useMemo(() => bsPrice({ type, spot, strike, t, r, sigma }), [type, spot, strike, t, r, sigma]);
  const crr = useMemo(
    () => crrPrice({ type, spot, strike, t, r, q: 0, sigma, steps: Math.max(1, Math.round(steps)), american }),
    [type, spot, strike, t, r, sigma, steps, american],
  );
  const greeks = useMemo(
    () => computeGreeks({ type, spot, strike, t, r, sigma }, bs),
    [type, spot, strike, t, r, sigma, bs],
  );
  const intrinsic = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const extrinsic = Math.max(0, bs - intrinsic);
  const diff = bs > 0 ? crr - bs : 0;

  const valid = spot > 0 && strike > 0 && t > 0 && sigma > 0;

  return (
    <CalcShell
      inputs={
        <>
          <Field label="Option type">
            <TypeToggle value={type} onChange={setType} />
          </Field>
          <FieldGrid>
            <Field label="Spot">
              <NumberField value={spot} onChange={setSpot} step={1} min={0} />
            </Field>
            <Field label="Strike">
              <NumberField value={strike} onChange={setStrike} step={prefill.connected ? undefined : 1} min={0} />
            </Field>
            <Field label="Days to expiry" hint={`T = ${dec(t, 4)}y`}>
              <NumberField value={days} onChange={setDays} step={1} min={0} />
            </Field>
            <Field label="IV %">
              <NumberField value={ivPct} onChange={setIvPct} step={0.5} min={0} />
            </Field>
            <Field label="Risk-free %">
              <NumberField value={rPct} onChange={setRPct} step={0.25} min={0} />
            </Field>
            <Field label="Binomial steps (N)">
              <NumberField value={steps} onChange={setSteps} step={50} min={1} />
            </Field>
          </FieldGrid>
          <Field label="Binomial exercise style">
            <Segmented
              size="xs"
              value={american ? "amer" : "euro"}
              onChange={(v) => setAmerican(v === "amer")}
              options={[
                { value: "euro", label: "European" },
                { value: "amer", label: "American" },
              ]}
            />
          </Field>
        </>
      }
      results={
        !valid ? (
          <Banner tone="warn">Enter a positive spot, strike, time and IV to price the option.</Banner>
        ) : (
          <>
            <ResultCard title="Fair Value" icon={Sigma}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-zinc-600">Black-Scholes</p>
                  <BigValue value={rupee(bs)} sub={`${dec(bs, 2)} / unit`} />
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-zinc-600">
                    CRR Binomial · {american ? "American" : "European"}
                  </p>
                  <BigValue value={rupee(crr)} sub={`${dec(crr, 2)} / unit`} />
                </div>
              </div>
              <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
                <Row label="Binomial − BS" value={signed(diff, 3)} valueClass={Math.abs(diff) < 0.5 ? "text-zinc-400" : "text-warn"} />
                <Row label="Intrinsic value" value={dec(intrinsic, 2)} />
                <Row label="Extrinsic (time) value" value={dec(extrinsic, 2)} />
              </div>
              <p className="mt-2 text-[9px] text-zinc-700">
                European CRR converges to Black-Scholes as N grows; American adds early-exercise value (matters mostly
                for deep-ITM puts).
              </p>
            </ResultCard>

            <GreeksTable greeks={greeks} />
          </>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 2) Greeks
// ---------------------------------------------------------------------------

function GreeksCalc({ prefill }: { prefill: Prefill }) {
  const [type, setType] = useState<OptionType>(prefill.type);
  const [spot, setSpot] = useState(prefill.spot);
  const [strike, setStrike] = useState(prefill.strike);
  const [days, setDays] = useState(prefill.days);
  const [ivPct, setIvPct] = useState(prefill.iv * 100);
  const [rPct, setRPct] = useState(prefill.r * 100);

  const t = daysToT(days);
  const sigma = ivPct / 100;
  const r = rPct / 100;
  const price = useMemo(() => bsPrice({ type, spot, strike, t, r, sigma }), [type, spot, strike, t, r, sigma]);
  const greeks = useMemo(
    () => computeGreeks({ type, spot, strike, t, r, sigma }, price),
    [type, spot, strike, t, r, sigma, price],
  );
  const valid = spot > 0 && strike > 0 && t > 0 && sigma > 0;

  return (
    <CalcShell
      inputs={
        <>
          <Field label="Option type">
            <TypeToggle value={type} onChange={setType} />
          </Field>
          <FieldGrid>
            <Field label="Spot">
              <NumberField value={spot} onChange={setSpot} step={1} min={0} />
            </Field>
            <Field label="Strike">
              <NumberField value={strike} onChange={setStrike} step={1} min={0} />
            </Field>
            <Field label="Days to expiry" hint={`T = ${dec(t, 4)}y`}>
              <NumberField value={days} onChange={setDays} step={1} min={0} />
            </Field>
            <Field label="IV %">
              <NumberField value={ivPct} onChange={setIvPct} step={0.5} min={0} />
            </Field>
            <Field label="Risk-free %">
              <NumberField value={rPct} onChange={setRPct} step={0.25} min={0} />
            </Field>
            <Field label="Model price">
              <div className="rounded-panel border border-border-subtle bg-surface px-2 py-1 text-2xs font-mono text-zinc-300">
                {valid ? dec(price, 2) : "—"}
              </div>
            </Field>
          </FieldGrid>
        </>
      }
      results={
        !valid ? (
          <Banner tone="warn">Enter a positive spot, strike, time and IV to compute Greeks.</Banner>
        ) : (
          <GreeksTable greeks={greeks} full />
        )
      }
    />
  );
}

function GreeksTable({ greeks, full }: { greeks: ReturnType<typeof computeGreeks>; full?: boolean }) {
  return (
    <ResultCard title={full ? "Greeks (1st + 2nd order)" : "Greeks"} icon={Activity}>
      <div className="grid grid-cols-2 gap-x-4">
        <div>
          <p className="mb-1 text-[9px] uppercase tracking-wider text-zinc-700">First order</p>
          <Row label="Delta (Δ)" value={dec(greeks.delta, 4)} />
          <Row label="Gamma (Γ)" value={dec(greeks.gamma, 6)} />
          <Row label="Theta (Θ) /day" value={dec(greeks.theta, 3)} valueClass="text-loss" />
          <Row label="Vega (V) /1%" value={dec(greeks.vega, 3)} />
          <Row label="Rho (ρ) /1%" value={dec(greeks.rho, 3)} />
          <Row label="Lambda (λ)" value={dec(greeks.lambda, 2)} />
        </div>
        <div>
          <p className="mb-1 text-[9px] uppercase tracking-wider text-zinc-700">Second order</p>
          <Row label="Vanna" value={dec(greeks.vanna, 5)} />
          <Row label="Vomma" value={dec(greeks.vomma, 5)} />
          <Row label="Charm /day" value={dec(greeks.charm, 5)} />
          <Row label="Speed" value={dec(greeks.speed, 7)} />
          <Row label="Color /day" value={dec(greeks.color, 7)} />
        </div>
      </div>
      <p className="mt-2 text-[9px] text-zinc-700">
        Vega / Rho per 1 vol-point. Theta / Charm / Color per calendar day. λ is elasticity (Δ·S/price).
      </p>
    </ResultCard>
  );
}

// ---------------------------------------------------------------------------
// 3) Implied Volatility
// ---------------------------------------------------------------------------

function IvCalc({ prefill }: { prefill: Prefill }) {
  const [type, setType] = useState<OptionType>(prefill.type);
  const [spot, setSpot] = useState(prefill.spot);
  const [strike, setStrike] = useState(prefill.strike);
  const [days, setDays] = useState(prefill.days);
  const [rPct, setRPct] = useState(prefill.r * 100);
  const [marketPrice, setMarketPrice] = useState(prefill.ltp > 0 ? prefill.ltp : 0);

  const t = daysToT(days);
  const r = rPct / 100;
  const iv = useMemo(
    () => impliedVol(type, marketPrice, spot, strike, t, r),
    [type, marketPrice, spot, strike, t, r],
  );
  const intrinsic = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const greeks = useMemo(
    () => (iv > 0 ? computeGreeks({ type, spot, strike, t, r, sigma: iv }, marketPrice) : null),
    [iv, type, spot, strike, t, r, marketPrice],
  );

  const valid = spot > 0 && strike > 0 && t > 0 && marketPrice > 0;
  const noTimeValue = valid && marketPrice <= intrinsic + 1e-6;

  return (
    <CalcShell
      inputs={
        <>
          <Field label="Option type">
            <TypeToggle value={type} onChange={setType} />
          </Field>
          <FieldGrid>
            <Field label="Market price (LTP)" hint={prefill.ltp > 0 ? "from chain" : undefined}>
              <NumberField value={marketPrice} onChange={setMarketPrice} step={0.5} min={0} />
            </Field>
            <Field label="Spot">
              <NumberField value={spot} onChange={setSpot} step={1} min={0} />
            </Field>
            <Field label="Strike">
              <NumberField value={strike} onChange={setStrike} step={1} min={0} />
            </Field>
            <Field label="Days to expiry" hint={`T = ${dec(t, 4)}y`}>
              <NumberField value={days} onChange={setDays} step={1} min={0} />
            </Field>
            <Field label="Risk-free %">
              <NumberField value={rPct} onChange={setRPct} step={0.25} min={0} />
            </Field>
          </FieldGrid>
        </>
      }
      results={
        !valid ? (
          <Banner tone="warn">Enter a positive market price, spot, strike and time to solve implied vol.</Banner>
        ) : noTimeValue ? (
          <Banner tone="warn">
            Market price ({dec(marketPrice, 2)}) is at or below intrinsic value ({dec(intrinsic, 2)}) — there is no
            time value, so implied vol is undefined. This is honest: no IV is fabricated.
          </Banner>
        ) : iv <= 0 ? (
          <Banner tone="warn">No implied vol root found in [0.1%, 500%] for this price. Check the inputs.</Banner>
        ) : (
          <>
            <ResultCard title="Implied Volatility" icon={Percent}>
              <BigValue value={volPct(iv, 2)} sub={`σ = ${dec(iv, 4)} (annualized)`} tone="zinc" />
              <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
                <Row label="Intrinsic value" value={dec(intrinsic, 2)} />
                <Row label="Time value" value={dec(Math.max(0, marketPrice - intrinsic), 2)} />
                <Row label="BS price at this IV" value={dec(bsPrice({ type, spot, strike, t, r, sigma: iv }), 2)} />
              </div>
            </ResultCard>
            {greeks && <GreeksTable greeks={greeks} />}
          </>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 4) Margin (SPAN-style estimate for a SHORT option)
// ---------------------------------------------------------------------------

function MarginCalc({ prefill }: { prefill: Prefill }) {
  const [spot, setSpot] = useState(prefill.spot);
  const [premium, setPremium] = useState(prefill.ltp > 0 ? prefill.ltp : 0);
  const [lots, setLots] = useState(1);
  const [lotSize, setLotSize] = useState(prefill.lotSize);
  const [factorPct, setFactorPct] = useState(12); // ~SPAN+Exposure proxy for index shorts

  const qty = Math.max(0, Math.round(lots)) * Math.max(0, Math.round(lotSize));
  const factor = factorPct / 100;
  const grossSpan = spot * qty * factor; // notional × factor
  const premiumReceived = premium * qty;
  const estMargin = Math.max(0, grossSpan - premiumReceived);
  const valid = spot > 0 && qty > 0;

  return (
    <CalcShell
      inputs={
        <>
          <FieldGrid>
            <Field label="Spot / underlying">
              <NumberField value={spot} onChange={setSpot} step={1} min={0} />
            </Field>
            <Field label="Premium / unit">
              <NumberField value={premium} onChange={setPremium} step={0.5} min={0} />
            </Field>
            <Field label="Lots">
              <NumberField value={lots} onChange={setLots} step={1} min={0} />
            </Field>
            <Field label="Lot size" hint={prefill.connected ? "from chain" : undefined}>
              <NumberField value={lotSize} onChange={setLotSize} step={1} min={1} />
            </Field>
            <Field label="SPAN factor %" hint="~10–14% index">
              <NumberField value={factorPct} onChange={setFactorPct} step={0.5} min={0} />
            </Field>
          </FieldGrid>
        </>
      }
      results={
        !valid ? (
          <Banner tone="warn">Enter a positive spot and at least one lot to estimate short-option margin.</Banner>
        ) : (
          <ResultCard title="Short-Option Margin (estimate)" icon={Wallet}>
            <BigValue value={rupee(estMargin)} sub={`${int(qty)} qty · factor ${dec(factorPct, 1)}%`} />
            <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
              <Row label="Notional (spot × qty)" value={rupee(spot * qty)} />
              <Row label="Gross SPAN+Exposure" value={rupee(grossSpan)} />
              <Row label="Premium received" value={rupee(premiumReceived)} valueClass="text-gain" />
              <Row label="Net blocked (estimate)" value={rupee(estMargin)} />
            </div>
            <Banner tone="info">
              This is a rough SPAN-style ESTIMATE (notional × factor − premium received) for a single short leg, not
              the broker's number. The exact SPAN + Exposure margin from FYERS lives in the Margin panel.
            </Banner>
          </ResultCard>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 5) Position Size / Lots
// ---------------------------------------------------------------------------

function PositionSizeCalc({ prefill }: { prefill: Prefill }) {
  const [capital, setCapital] = useState(100000);
  const [riskPct, setRiskPct] = useState(1);
  const [slPoints, setSlPoints] = useState(20);
  const [lotSize, setLotSize] = useState(prefill.lotSize);

  const riskBudget = capital * (riskPct / 100);
  const riskPerLot = slPoints * lotSize;
  const maxLots = riskPerLot > 0 ? Math.floor(riskBudget / riskPerLot) : 0;
  const qty = maxLots * lotSize;
  const actualRisk = qty * slPoints;
  const valid = capital > 0 && slPoints > 0 && lotSize > 0;

  return (
    <CalcShell
      inputs={
        <>
          <FieldGrid>
            <Field label="Capital (₹)">
              <NumberField value={capital} onChange={setCapital} step={5000} min={0} />
            </Field>
            <Field label="Risk per trade %">
              <NumberField value={riskPct} onChange={setRiskPct} step={0.25} min={0} />
            </Field>
            <Field label="Stop-loss (points)">
              <NumberField value={slPoints} onChange={setSlPoints} step={1} min={0} />
            </Field>
            <Field label="Lot size" hint={prefill.connected ? "from chain" : undefined}>
              <NumberField value={lotSize} onChange={setLotSize} step={1} min={1} />
            </Field>
          </FieldGrid>
        </>
      }
      results={
        !valid ? (
          <Banner tone="warn">Enter positive capital, stop-loss points and lot size to size the position.</Banner>
        ) : (
          <ResultCard title="Max Position Size" icon={Layers}>
            <BigValue value={`${int(maxLots)} lots`} sub={`${int(qty)} qty @ ${lotSize}/lot`} />
            <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
              <Row label="Risk budget" value={rupee(riskBudget)} />
              <Row label="Risk per lot (SL × lotSize)" value={rupee(riskPerLot)} />
              <Row label="Actual risk at max lots" value={rupee(actualRisk)} valueClass="text-loss" />
              <Row
                label="Budget utilised"
                value={riskBudget > 0 ? `${dec((actualRisk / riskBudget) * 100, 1)}%` : "—"}
              />
            </div>
            {maxLots === 0 && (
              <Banner tone="warn">
                Risk per lot ({rupee(riskPerLot)}) already exceeds your risk budget ({rupee(riskBudget)}) — no lots fit
                this stop. Widen capital / risk% or tighten the stop.
              </Banner>
            )}
          </ResultCard>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 6) Premium
// ---------------------------------------------------------------------------

function PremiumCalc({ prefill }: { prefill: Prefill }) {
  const [price, setPrice] = useState(prefill.ltp > 0 ? prefill.ltp : 0);
  const [lots, setLots] = useState(1);
  const [lotSize, setLotSize] = useState(prefill.lotSize);

  const qty = Math.max(0, Math.round(lots)) * Math.max(0, Math.round(lotSize));
  const total = price * qty;
  const perLot = price * lotSize;
  const valid = price > 0 && qty > 0;

  return (
    <CalcShell
      inputs={
        <>
          <FieldGrid>
            <Field label="Price / unit" hint={prefill.ltp > 0 ? "from chain" : undefined}>
              <NumberField value={price} onChange={setPrice} step={0.5} min={0} />
            </Field>
            <Field label="Lots">
              <NumberField value={lots} onChange={setLots} step={1} min={0} />
            </Field>
            <Field label="Lot size" hint={prefill.connected ? "from chain" : undefined}>
              <NumberField value={lotSize} onChange={setLotSize} step={1} min={1} />
            </Field>
          </FieldGrid>
        </>
      }
      results={
        !valid ? (
          <Banner tone="warn">Enter a positive price and at least one lot to compute total premium.</Banner>
        ) : (
          <ResultCard title="Total Premium / Cost" icon={Coins}>
            <BigValue value={rupee(total)} sub={`${int(qty)} qty × ${dec(price, 2)}`} />
            <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
              <Row label="Premium per lot" value={rupee(perLot)} />
              <Row label="Quantity" value={int(qty)} />
              <Row label="Price per unit" value={dec(price, 2)} />
            </div>
            <p className="mt-2 text-[9px] text-zinc-700">
              For a buyer this is the debit paid (max loss); for a seller it's the credit received. Brokerage / taxes
              are not included.
            </p>
          </ResultCard>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 7) Risk / R-multiple
// ---------------------------------------------------------------------------

function RiskCalc({ prefill }: { prefill: Prefill }) {
  const [entry, setEntry] = useState(prefill.ltp > 0 ? prefill.ltp : 0);
  const [stop, setStop] = useState(prefill.ltp > 0 ? Math.max(0, prefill.ltp * 0.8) : 0);
  const [target, setTarget] = useState(prefill.ltp > 0 ? prefill.ltp * 1.4 : 0);
  const [lots, setLots] = useState(1);
  const [lotSize, setLotSize] = useState(prefill.lotSize);

  const qty = Math.max(0, Math.round(lots)) * Math.max(0, Math.round(lotSize));
  const riskPts = Math.abs(entry - stop);
  const rewardPts = Math.abs(target - entry);
  const riskAmt = riskPts * qty;
  const rewardAmt = rewardPts * qty;
  const rMultiple = riskPts > 0 ? rewardPts / riskPts : 0;
  const valid = entry > 0 && qty > 0 && riskPts > 0;

  return (
    <CalcShell
      inputs={
        <>
          <FieldGrid>
            <Field label="Entry price">
              <NumberField value={entry} onChange={setEntry} step={0.5} min={0} />
            </Field>
            <Field label="Stop-loss price">
              <NumberField value={stop} onChange={setStop} step={0.5} min={0} />
            </Field>
            <Field label="Target price">
              <NumberField value={target} onChange={setTarget} step={0.5} min={0} />
            </Field>
            <Field label="Lots">
              <NumberField value={lots} onChange={setLots} step={1} min={0} />
            </Field>
            <Field label="Lot size" hint={prefill.connected ? "from chain" : undefined}>
              <NumberField value={lotSize} onChange={setLotSize} step={1} min={1} />
            </Field>
          </FieldGrid>
        </>
      }
      results={
        !valid ? (
          <Banner tone="warn">Enter entry, a different stop-loss and at least one lot to compute ₹ risk.</Banner>
        ) : (
          <ResultCard title="Risk / Reward" icon={ShieldAlert}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] uppercase tracking-wider text-zinc-600">₹ Risk</p>
                <BigValue value={rupee(riskAmt)} sub={`${dec(riskPts, 2)} pts × ${int(qty)}`} tone="loss" />
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wider text-zinc-600">₹ Reward</p>
                <BigValue value={rupee(rewardAmt)} sub={`${dec(rewardPts, 2)} pts × ${int(qty)}`} tone="gain" />
              </div>
            </div>
            <div className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
              <Row
                label="R-multiple (reward : risk)"
                value={rewardPts > 0 ? `${dec(rMultiple, 2)} R` : "—"}
                valueClass={rMultiple >= 2 ? "text-gain" : rMultiple >= 1 ? "text-zinc-200" : "text-loss"}
              />
              <Row label="Risk per unit" value={dec(riskPts, 2)} />
              <Row label="Reward per unit" value={dec(rewardPts, 2)} />
              <Row label="Quantity" value={int(qty)} />
            </div>
            {rMultiple > 0 && rMultiple < 1 && (
              <Banner tone="warn">
                Reward:risk is below 1R — you're risking more than the target pays. Most systematic edges want ≥ 1.5–2R.
              </Banner>
            )}
          </ResultCard>
        )
      }
    />
  );
}
