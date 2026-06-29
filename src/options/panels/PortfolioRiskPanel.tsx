/**
 * Portfolio Risk Dashboard — net Greeks and a spot/IV stress grid for the live book.
 *
 * (a) Net Delta / Gamma / Vega / Theta / Rho from aggregateGreeks(positionGreeks(positions, chain)).
 *     All COMPUTED (FYERS serves no Greeks); needs the live chain to match each position to a
 *     contract, so when no chain is loaded we say so and the tiles read "—".
 *
 * (b) Stress Test / Scenario Analysis. For a grid of spot shifts (−3%…+3%) × IV shifts
 *     (−2, 0, +2 vol pts), each MATCHED option position is repriced with bsPrice() using the
 *     matched chain contract's strike/type/IV and t = chain.selectedExpiry.t, and the portfolio
 *     MTM P/L change is summed (scaled by netQty × −sign for the unit, i.e. (newPx − curPx) × qty).
 *     Unmatched positions are excluded and counted honestly. Gap Risk = worst (most negative) cell.
 *
 * Nothing is fabricated: spot/IV come from the live chain, prices from Black-Scholes on solved IV.
 */

import { useMemo } from "react";
import { ShieldAlert, PlugZap, Activity } from "lucide-react";
import { useOptionsData } from "../state/OptionsDataProvider";
import { positionGreeks, aggregateGreeks, type PositionGreeks } from "../lib/positions";
import { bsPrice } from "../lib/bs";
import { Panel, ProvenanceBadge, Empty, Spinner, Banner, Stat } from "../components/ui";
import { dec, money, toneClass, pct, volPct } from "../lib/format";
import type { EnrichedChain, Greeks, OptionType } from "../types";

const SPOT_SHIFTS = [-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03];
const IV_SHIFTS = [-0.02, 0, 0.02]; // absolute vol points (decimal)

/** A position that matched a live chain contract — everything needed to reprice it. */
interface Repriceable {
  symbol: string;
  qty: number;
  type: OptionType;
  strike: number;
  iv: number;
  curPrice: number;
}

const GREEK_TILES: { key: keyof Greeks; label: string; hint: string; dp: number }[] = [
  { key: "delta", label: "Net Delta", hint: "₹/pt spot · book", dp: 2 },
  { key: "gamma", label: "Net Gamma", hint: "∂delta/∂spot", dp: 4 },
  { key: "vega", label: "Net Vega", hint: "₹ per 1% IV", dp: 2 },
  { key: "theta", label: "Net Theta", hint: "₹/day decay", dp: 1 },
  { key: "rho", label: "Net Rho", hint: "₹ per 1% rate", dp: 2 },
];

export function PortfolioRiskPanel() {
  const data = useOptionsData();

  return (
    <Panel
      title="Portfolio Risk Dashboard"
      icon={ShieldAlert}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <RiskBody data={data} />
    </Panel>
  );
}

function RiskBody({ data }: { data: ReturnType<typeof useOptionsData> }) {
  const { positions, chain, status, connected } = data;

  const greeks = useMemo<PositionGreeks[]>(
    () => positionGreeks(positions, chain),
    [positions, chain],
  );
  const netGreeks = useMemo(() => aggregateGreeks(greeks), [greeks]);
  const matchedCount = greeks.filter((g) => g.matched).length;

  // Build the repriceable set from matched positions + their live chain contract.
  const repriceable = useMemo<Repriceable[]>(() => {
    if (!chain) return [];
    const bySymbol = new Map<string, { type: OptionType; strike: number; iv: number; price: number }>();
    for (const row of chain.rows) {
      if (row.ce.symbol) bySymbol.set(row.ce.symbol, { type: "CE", strike: row.ce.strike, iv: row.ce.iv, price: row.ce.ltp });
      if (row.pe.symbol) bySymbol.set(row.pe.symbol, { type: "PE", strike: row.pe.strike, iv: row.pe.iv, price: row.pe.ltp });
    }
    const out: Repriceable[] = [];
    for (const p of positions) {
      const c = bySymbol.get(p.symbol);
      if (!c || !(c.iv > 0)) continue; // need a solvable IV to reprice
      out.push({ symbol: p.symbol, qty: p.netQty, type: c.type, strike: c.strike, iv: c.iv, curPrice: c.price });
    }
    return out;
  }, [positions, chain]);

  // --- Honest data states ---
  if (status === "disconnected" || !connected) {
    return (
      <Empty
        icon={PlugZap}
        message="Connect to FYERS to load your positions and run portfolio stress tests. Nothing is shown while disconnected."
      />
    );
  }
  if (status === "loading" && positions.length === 0) {
    return <Spinner label="Loading positions…" />;
  }

  const hasPositions = positions.length > 0;

  return (
    <div className="space-y-4">
      {status === "stale" && (
        <Banner tone="warn">Live feed interrupted — risk is computed off the last good snapshot. Retrying automatically.</Banner>
      )}

      {!hasPositions && (
        <Empty icon={ShieldAlert} message="No open positions — there is no live book to stress. Add positions to see portfolio Greeks and scenario P/L." />
      )}

      {hasPositions && (
        <>
          {chain == null ? (
            <Banner tone="info">
              Portfolio Greeks and the stress grid need the live option chain to match your positions to contracts and
              their solved IV. The chain isn't loaded for this instrument/expiry, so Greeks read "—" and stress is
              unavailable. Load the matching instrument/expiry in the workspace header.
            </Banner>
          ) : (
            matchedCount === 0 && (
              <Banner tone="warn">
                None of your {positions.length} positions matched a contract in the currently-loaded chain
                (likely a different instrument or expiry). Switch the workspace to the matching instrument/expiry to
                compute Greeks and stress P/L.
              </Banner>
            )
          )}

          {/* ---- Net Greek tiles ---- */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {GREEK_TILES.map((t) => {
              const v = netGreeks[t.key];
              const live = matchedCount > 0;
              return (
                <Stat
                  key={t.key}
                  label={t.label}
                  value={live ? dec(v, t.dp) : "—"}
                  tone={!live ? "zinc" : v > 0 ? "green" : v < 0 ? "rose" : "zinc"}
                  sub={
                    <>
                      <ProvenanceBadge kind={live ? "COMPUTED" : "UNAVAILABLE"} /> {t.hint}
                    </>
                  }
                />
              );
            })}
          </div>

          {/* ---- Stress grid ---- */}
          {chain && matchedCount > 0 && (
            <StressGrid chain={chain} repriceable={repriceable} positions={positions.length} matched={matchedCount} />
          )}

          <p className="text-2xs leading-relaxed text-zinc-600">
            Greeks and scenario P/L are Black-Scholes-derived from each position's solved per-strike IV (FYERS serves
            neither). Theta is per calendar day; vega and rho per one percentage-point. Positions with no matching live
            contract or no solvable IV are excluded from the stress grid and counted above.
          </p>
        </>
      )}
    </div>
  );
}

function StressGrid({
  chain,
  repriceable,
  positions,
  matched,
}: {
  chain: EnrichedChain;
  repriceable: Repriceable[];
  positions: number;
  matched: number;
}) {
  const t = chain.selectedExpiry?.t ?? 0;
  const spot = chain.spot;
  const r = chain.riskFreeRate;

  // Compute portfolio MTM P/L change for every (spotShift, ivShift) cell.
  const grid = useMemo(() => {
    return IV_SHIFTS.map((ivShift) =>
      SPOT_SHIFTS.map((spotShift) => {
        const newSpot = spot * (1 + spotShift);
        let pnl = 0;
        for (const leg of repriceable) {
          const sigma = Math.max(0.0001, leg.iv + ivShift);
          const newPx = bsPrice({ type: leg.type, spot: newSpot, strike: leg.strike, t, r, sigma });
          // P/L on the position = (mark change) × signed quantity. Long qty>0 gains when px rises.
          pnl += (newPx - leg.curPrice) * leg.qty;
        }
        return pnl;
      }),
    );
  }, [repriceable, spot, t, r]);

  // Worst-case cell = Gap Risk; best-case for reference.
  let worst = Infinity;
  let best = -Infinity;
  let worstLabel = "";
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      const v = grid[i][j];
      if (v < worst) {
        worst = v;
        worstLabel = `${pct(SPOT_SHIFTS[j] * 100, 0)} spot, ${signedVol(IV_SHIFTS[i])} IV`;
      }
      if (v > best) best = v;
    }
  }

  const maxAbs = Math.max(Math.abs(worst), Math.abs(best), 1);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          label="Gap risk (worst case)"
          value={money(worst)}
          tone={worst < 0 ? "rose" : "zinc"}
          icon={ShieldAlert}
          sub={<><ProvenanceBadge kind="COMPUTED" /> {worstLabel}</>}
        />
        <Stat
          label="Best case"
          value={money(best)}
          tone={best > 0 ? "green" : "zinc"}
          sub={<ProvenanceBadge kind="COMPUTED" />}
        />
        <Stat
          label="Legs stressed"
          value={`${repriceable.length} / ${positions}`}
          tone="zinc"
          sub={`${matched} matched · ${positions - repriceable.length} excluded`}
        />
      </div>

      <div className="rounded-panel border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <Activity size={12} className="text-zinc-600" strokeWidth={1.5} />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Scenario P/L grid</span>
          <ProvenanceBadge kind="COMPUTED" />
          <span className="ml-auto text-[9px] text-zinc-700">rows = IV shift · cols = spot shift</span>
        </div>
        <div className="overflow-auto p-3">
          <table className="w-full border-collapse text-2xs">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                <th className="px-2 py-1.5 text-left">IV \ Spot</th>
                {SPOT_SHIFTS.map((s) => (
                  <th key={s} className="px-2 py-1.5 text-right font-mono">
                    {s === 0 ? "0%" : pct(s * 100, 0)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {IV_SHIFTS.map((iv, i) => (
                <tr key={iv} className="border-t border-border-subtle/60">
                  <td className="px-2 py-1.5 text-left font-mono text-zinc-400">{signedVol(iv)}</td>
                  {grid[i].map((cell, j) => (
                    <Cell key={j} value={cell} maxAbs={maxAbs} base={SPOT_SHIFTS[j] === 0 && iv === 0} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[9px] text-zinc-700">
            Each cell is the portfolio MTM P/L change from the current mark if spot moves (column) and IV shifts
            (row), repriced with Black-Scholes at t = {dec((t || 0) * 365, 1)} days. The "0% / 0" cell is ~₹0 by
            construction (current mark).
          </p>
        </div>
      </div>
    </div>
  );
}

function Cell({ value, maxAbs, base }: { value: number; maxAbs: number; base: boolean }) {
  const intensity = Math.min(1, Math.abs(value) / maxAbs);
  const bg =
    Math.abs(value) < 1
      ? ""
      : value > 0
        ? `rgba(16,185,129,${(0.12 + intensity * 0.4).toFixed(2)})`
        : `rgba(239,68,68,${(0.12 + intensity * 0.4).toFixed(2)})`;
  return (
    <td
      className={`px-2 py-1.5 text-right font-mono ${toneClass(value)} ${base ? "ring-1 ring-inset ring-info/40" : ""}`}
      style={bg ? { backgroundColor: bg } : undefined}
      title={base ? "Current mark (baseline)" : undefined}
    >
      {money(value)}
    </td>
  );
}

/** Signed vol-point label, e.g. -0.02 → "-2.0 vol". */
function signedVol(iv: number): string {
  if (iv === 0) return "0 vol";
  const sign = iv > 0 ? "+" : "-";
  return `${sign}${volPct(Math.abs(iv)).replace("%", "")} vol`;
}
