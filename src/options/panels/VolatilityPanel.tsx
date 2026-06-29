/**
 * Volatility Dashboard — historical vs implied vol, ATR and expected moves.
 *
 * Pulls the underlying's own daily and intraday candles (optionsApi.getHistory) and computes
 * Historical Volatility (close-to-close), Realized/Parkinson (high-low) and Wilder ATR locally.
 * Implied vol is the live India VIX (BROKER) with the chain's ATM IV as a cross-check. Expected
 * daily / weekly / expiry moves come from the IV via the volatility lib, and the IV−HV spread
 * tells us whether options screen rich or cheap. Nothing is fabricated: if the candle history
 * fails or is too short the affected metric is shown honestly as unavailable.
 */

import { useEffect, useMemo, useState } from "react";
import { CandlestickChart, Gauge, Move } from "lucide-react";
import { ChainGate } from "../components/ChainGate";
import { Panel, ProvenanceBadge, Stat, Row, Banner, Spinner, Empty } from "../components/ui";
import {
  historicalVolatility,
  parkinsonVolatility,
  atr,
  expectedMoves,
  type Candle,
} from "../lib/volatility";
import { optionsApi } from "../../services/api";
import { volPct, dec, signed, int } from "../lib/format";
import type { EnrichedChain } from "../types";

interface RawCandle {
  time?: number;
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

/** Map a FYERS history candle (time in epoch seconds) to the volatility lib's Candle. */
function toCandles(raw: unknown): Candle[] {
  const arr = Array.isArray((raw as { candles?: unknown })?.candles)
    ? ((raw as { candles: RawCandle[] }).candles)
    : [];
  return arr
    .map((c) => {
      const ts = Number(c.time ?? c.timestamp ?? 0);
      return {
        timestamp: ts > 1e12 ? ts : ts * 1000,
        open: Number(c.open ?? 0),
        high: Number(c.high ?? 0),
        low: Number(c.low ?? 0),
        close: Number(c.close ?? 0),
        volume: Number(c.volume ?? 0),
      };
    })
    .filter((c) => c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function VolatilityPanel() {
  return (
    <Panel
      title="Volatility Dashboard"
      icon={CandlestickChart}
      badge={<ProvenanceBadge kind="COMPUTED" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <ChainGate>{(chain) => <VolBody chain={chain} />}</ChainGate>
    </Panel>
  );
}

function VolBody({ chain }: { chain: EnrichedChain }) {
  const underlying = chain.instrument.underlying;
  const [daily, setDaily] = useState<Candle[]>([]);
  const [intraday, setIntraday] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [d, i] = await Promise.all([
          optionsApi.getHistory(underlying, "D", 60),
          optionsApi.getHistory(underlying, "15", 5),
        ]);
        if (cancelled) return;
        setDaily(toCandles(d));
        setIntraday(toCandles(i));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load underlying candles");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [underlying]);

  // Implied vol: India VIX preferred (BROKER), ATM IV as fallback/cross-check (COMPUTED).
  const atmRow = chain.rows.find((r) => r.isAtm);
  const atmIv = atmRow ? atmRow.ce.iv || atmRow.pe.iv : 0;
  const ivDecimal = chain.vix ? chain.vix.value / 100 : atmIv;

  const hv20 = useMemo(() => historicalVolatility(daily, 20), [daily]);
  const hv10 = useMemo(() => historicalVolatility(daily, 10), [daily]);
  const parkinson = useMemo(() => parkinsonVolatility(daily, 20), [daily]);
  const atr14 = useMemo(() => atr(daily, 14), [daily]);

  const days = chain.selectedExpiry?.daysRemaining ?? 0;
  const moves = useMemo(
    () => expectedMoves(chain.spot, ivDecimal, days),
    [chain.spot, ivDecimal, days],
  );

  // IV − HV spread: positive ⇒ options pricing in more vol than realized ⇒ "rich".
  const spread = ivDecimal > 0 && hv20 > 0 ? ivDecimal - hv20 : null;

  if (loading) return <Spinner label="Loading underlying candles…" />;

  return (
    <div className="space-y-3">
      {error && (
        <Banner tone="warn">
          Couldn't load {chain.instrument.label} candles ({error}). Historical / realized vol and ATR are
          shown as unavailable; IV-based metrics below still use the live feed.
        </Banner>
      )}

      {/* Vol comparison */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          label="Implied Vol"
          value={ivDecimal > 0 ? volPct(ivDecimal) : "—"}
          sub={chain.vix ? "India VIX" : atmIv > 0 ? "ATM IV (no VIX feed)" : "no source"}
          tone="blue"
          icon={Gauge}
        />
        <Stat
          label="Historical Vol (20d)"
          value={hv20 > 0 ? volPct(hv20) : daily.length ? "—" : "no data"}
          sub="close-to-close, annualized"
        />
        <Stat
          label="Realized (Parkinson)"
          value={parkinson > 0 ? volPct(parkinson) : daily.length ? "—" : "no data"}
          sub="high-low estimator, 20d"
        />
        <Stat
          label="HV (10d)"
          value={hv10 > 0 ? volPct(hv10) : daily.length ? "—" : "no data"}
          sub="shorter-window realized"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-0.5">
        <ProvenanceBadge kind="BROKER" label="India VIX" />
        <ProvenanceBadge kind="COMPUTED" label="HV / Parkinson / ATR / moves" />
      </div>

      {/* IV vs HV verdict */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">IV vs HV Spread</span>
          <ProvenanceBadge kind="COMPUTED" />
        </div>
        {spread == null ? (
          <Empty message="Need both India VIX (or ATM IV) and ≥21 daily candles to compare IV against realized vol." />
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-end justify-between">
              <span className="font-mono text-2xl font-semibold text-zinc-100">{signed(spread * 100, 1)}</span>
              <span className="text-2xs text-zinc-500">vol points (IV − HV20)</span>
            </div>
            <Banner tone={spread > 0.01 ? "warn" : spread < -0.01 ? "info" : "info"}>
              {spread > 0.01
                ? "IV > HV — options are pricing more volatility than the underlying has realized (premium looks RICH, favours net sellers)."
                : spread < -0.01
                  ? "IV < HV — options are pricing less volatility than realized (premium looks CHEAP, favours net buyers)."
                  : "IV ≈ HV — options are fairly priced versus realized volatility."}
            </Banner>
            <Row label="Implied Vol" value={volPct(ivDecimal)} />
            <Row label="Historical Vol (20d)" value={volPct(hv20)} />
            <Row label="ATM IV (chain)" value={atmIv > 0 ? volPct(atmIv) : "—"} />
          </div>
        )}
      </div>

      {/* ATR */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          label="ATR (14d)"
          value={atr14 > 0 ? dec(atr14, 1) : daily.length ? "—" : "no data"}
          sub="avg true range, pts/day"
        />
        <Stat label="Daily candles" value={daily.length ? int(daily.length) : "—"} sub="60d daily history" />
        <Stat label="Intraday candles" value={intraday.length ? int(intraday.length) : "—"} sub="15m, 5d" />
        <Stat label="Spot" value={chain.spot > 0 ? dec(chain.spot, 1) : "—"} sub={chain.instrument.label} />
      </div>

      {/* Expected moves + range visualization */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <Move size={12} className="text-zinc-600" />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            Expected Move (from IV)
          </span>
          <ProvenanceBadge kind="COMPUTED" />
        </div>
        {ivDecimal <= 0 || chain.spot <= 0 ? (
          <Empty message="No implied vol source available to project expected moves." />
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <MoveCell label="Daily (1d)" pts={moves.daily} pctVal={moves.dailyPct} />
              <MoveCell label="Weekly (7d)" pts={moves.weekly} pctVal={moves.weeklyPct} />
              <MoveCell
                label={`Expiry (${days}d)`}
                pts={moves.expiry}
                pctVal={moves.expiryPct}
              />
            </div>
            <RangeBar spot={chain.spot} move={moves.expiry} label={`${days}d expiry`} />
          </>
        )}
      </div>
    </div>
  );
}

function MoveCell({ label, pts, pctVal }: { label: string; pts: number; pctVal: number }) {
  return (
    <div className="rounded-panel border border-border bg-surface p-2.5 text-center">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="mt-1 font-mono text-base font-semibold text-zinc-100">
        {pts > 0 ? `±${dec(pts, 0)}` : "—"}
      </p>
      <p className="text-[9px] text-zinc-500">{pts > 0 ? `±${dec(pctVal, 2)}%` : ""}</p>
    </div>
  );
}

/** Visual range bar: ±1σ expiry move around spot. */
function RangeBar({ spot, move, label }: { spot: number; move: number; label: string }) {
  if (!(spot > 0) || !(move > 0)) return null;
  const lower = spot - move;
  const upper = spot + move;
  // Render the move band centered; the band spans 50% of the track width by construction.
  return (
    <div>
      <div className="relative h-9 w-full overflow-hidden rounded-panel bg-surface">
        <div className="absolute inset-y-0 left-1/4 right-1/4 bg-info/20" />
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-info" />
        <div className="absolute inset-y-0 left-1/4 w-px bg-gain/60" />
        <div className="absolute inset-y-0 right-1/4 w-px bg-loss/60" />
        <span className="absolute left-1 top-1/2 -translate-y-1/2 font-mono text-[9px] text-gain">
          {dec(lower, 0)}
        </span>
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[9px] text-info">
          {dec(spot, 0)}
        </span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 font-mono text-[9px] text-loss">
          {dec(upper, 0)}
        </span>
      </div>
      <p className="mt-1 text-center text-[9px] text-zinc-600">
        1σ {label} expected range · ±{dec(move, 0)} pts around spot
      </p>
    </div>
  );
}
