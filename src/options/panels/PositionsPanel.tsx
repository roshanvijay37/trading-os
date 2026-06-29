/**
 * Position Dashboard — the live book straight from FYERS (`/account/positions`).
 *
 * Every position row is BROKER data (symbol, qty, avg, LTP, realized/unrealized P/L). Per-row
 * Greeks (net delta/gamma/theta/vega) are COMPUTED by matching each position to its live chain
 * quote via positionGreeks(); a "matched" flag is shown honestly when no live contract is found
 * (wrong expiry/instrument loaded, or market shut). Margin used is pulled once from getFunds().
 *
 * What FYERS retail does NOT carry: per-position stop-loss / target / trailing / risk fields.
 * Those are rendered with an UNAVAILABLE badge and a one-line note rather than invented numbers.
 */

import { useEffect, useMemo, useState } from "react";
import { Briefcase, PlugZap, Wallet, AlertTriangle } from "lucide-react";
import { accountApi } from "../../services/api";
import { useOptionsData } from "../data/OptionsDataProvider";
import { positionGreeks, type PositionGreeks } from "../lib/positions";
import { Panel, ProvenanceBadge, Empty, Spinner, Banner, Stat, Row } from "../components/ui";
import { dec, money, rupee, toneClass, volPct } from "../lib/format";
import type { PositionRow } from "../types";

// ---------------------------------------------------------------------------
// Funds parsing — defensive over the FYERS fund_limit shape (server maps it to `funds`).
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

/** The server returns `{ funds: [...] }`; tolerate the raw `{ fund_limit: [...] }` too. */
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

/** Find the first entry whose title matches any of the given (case-insensitive) needles. */
function findFund(funds: FundEntry[], needles: string[]): FundEntry | undefined {
  return funds.find((f) => needles.some((n) => f.title.toLowerCase().includes(n.toLowerCase())));
}

export function PositionsPanel() {
  const data = useOptionsData();

  return (
    <Panel
      title="Position Dashboard"
      icon={Briefcase}
      badge={<ProvenanceBadge kind="BROKER" />}
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <PositionsBody data={data} />
    </Panel>
  );
}

function PositionsBody({ data }: { data: ReturnType<typeof useOptionsData> }) {
  const { positions, chain, status, connected } = data;

  // --- Margin used (one-off, refreshed on connect). Independent of the chain loop. ---
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

  const greeks = useMemo<PositionGreeks[]>(
    () => positionGreeks(positions, chain),
    [positions, chain],
  );
  const greeksBySymbol = useMemo(() => {
    const m = new Map<string, PositionGreeks>();
    for (const g of greeks) m.set(g.position.symbol, g);
    return m;
  }, [greeks]);

  // --- Honest data states ---
  if (status === "disconnected" || !connected) {
    return (
      <Empty
        icon={PlugZap}
        message="Connect to FYERS to load your live positions. Nothing is shown while disconnected — no stale or sample data."
      />
    );
  }
  if (status === "loading" && positions.length === 0) {
    return <Spinner label="Loading positions…" />;
  }
  if (positions.length === 0) {
    return <Empty icon={Briefcase} message="No open positions." />;
  }

  // --- Totals ---
  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const totalRealized = positions.reduce((s, p) => s + p.realizedPnl, 0);
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const matchedCount = greeks.filter((g) => g.matched).length;

  const used = findFund(funds ?? [], ["utilized", "utilised", "used"]);
  const avail = findFund(funds ?? [], ["available balance", "available"]);
  const total = findFund(funds ?? [], ["total balance", "total"]);

  return (
    <div className="space-y-4">
      {status === "stale" && (
        <Banner tone="warn">Live feed interrupted — showing the last good positions snapshot. Retrying automatically.</Banner>
      )}

      {/* ---- Top summary tiles ---- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Net P/L"
          value={money(totalPnl)}
          tone={totalPnl > 0 ? "green" : totalPnl < 0 ? "rose" : "zinc"}
          sub={<><ProvenanceBadge kind="BROKER" /> across {positions.length} legs</>}
        />
        <Stat
          label="Realized"
          value={money(totalRealized)}
          tone={totalRealized > 0 ? "green" : totalRealized < 0 ? "rose" : "zinc"}
        />
        <Stat
          label="Unrealized"
          value={money(totalUnrealized)}
          tone={totalUnrealized > 0 ? "green" : totalUnrealized < 0 ? "rose" : "zinc"}
        />
        <MarginUsedTile loading={fundsLoading} err={fundsErr} used={used} avail={avail} total={total} />
      </div>

      {chain == null && (
        <Banner tone="info">
          Per-position Greeks need the live option chain to match contracts. The chain isn't loaded for this
          instrument/expiry, so Greeks read "—" and the matched flag is off below.
        </Banner>
      )}

      {/* ---- Positions table ---- */}
      <div className="rounded-panel border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Open positions</span>
          <ProvenanceBadge kind="BROKER" />
          <span className="ml-1 text-[9px] text-zinc-700">Greeks</span>
          <ProvenanceBadge kind="COMPUTED" />
          <span className="ml-auto text-[9px] text-zinc-700">{matchedCount}/{positions.length} matched to live chain</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full border-collapse text-2xs">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                <Th left>Symbol</Th>
                <Th>Side</Th>
                <Th>Qty</Th>
                <Th>Avg</Th>
                <Th>LTP</Th>
                <Th>P/L</Th>
                <Th>Realized</Th>
                <Th>Unrealized</Th>
                <Th>IV</Th>
                <Th>Δ</Th>
                <Th>Γ</Th>
                <Th>Θ</Th>
                <Th>ν</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <PositionTr key={p.symbol || `${p.netQty}-${p.avgPrice}`} p={p} g={greeksBySymbol.get(p.symbol)} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-surface/50 font-semibold">
                <td className="px-2 py-1.5 text-left text-zinc-300">Totals</td>
                <td />
                <td />
                <td />
                <td />
                <td className={`px-2 py-1.5 text-right font-mono ${toneClass(totalPnl)}`}>{money(totalPnl)}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${toneClass(totalRealized)}`}>{money(totalRealized)}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${toneClass(totalUnrealized)}`}>{money(totalUnrealized)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ---- Risk controls FYERS retail doesn't expose ---- */}
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle size={12} className="text-zinc-600" strokeWidth={1.5} />
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Per-position risk controls</span>
          <ProvenanceBadge kind="UNAVAILABLE" />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-4">
          <Row label="Stop-loss" value="—" valueClass="text-zinc-600" />
          <Row label="Target" value="—" valueClass="text-zinc-600" />
          <Row label="Trailing SL" value="—" valueClass="text-zinc-600" />
          <Row label="Risk / leg" value="—" valueClass="text-zinc-600" />
        </div>
        <p className="mt-2 text-2xs leading-relaxed text-zinc-600">
          FYERS net positions don't carry per-position SL/target/trailing fields, so these are shown blank rather
          than invented. Set SL/target via the Trade Ticket (GTT is not exposed in this API).
        </p>
      </div>
    </div>
  );
}

function PositionTr({ p, g }: { p: PositionRow; g: PositionGreeks | undefined }) {
  const matched = g?.matched ?? false;
  const opt = p.option;
  const sideTone =
    p.side === "LONG" ? "text-gain" : p.side === "SHORT" ? "text-loss" : "text-zinc-500";
  return (
    <tr className="border-b border-border-subtle/60 hover:bg-surface/60">
      <td className="px-2 py-1 text-left">
        <div className="font-mono text-zinc-200">{p.symbol || "—"}</div>
        {opt && (
          <div className="text-[9px] text-zinc-600">
            {opt.strike} {opt.optionType}
            {p.productType ? ` · ${p.productType}` : ""}
          </div>
        )}
      </td>
      <td className={`px-2 py-1 text-right font-semibold ${sideTone}`}>{p.side}</td>
      <td className="px-2 py-1 text-right font-mono text-zinc-300">{p.netQty}</td>
      <td className="px-2 py-1 text-right font-mono text-zinc-400">{dec(p.avgPrice, 2)}</td>
      <td className="px-2 py-1 text-right font-mono text-zinc-300">{p.ltp > 0 ? dec(p.ltp, 2) : "—"}</td>
      <td className={`px-2 py-1 text-right font-mono font-semibold ${toneClass(p.pnl)}`}>{money(p.pnl)}</td>
      <td className={`px-2 py-1 text-right font-mono ${toneClass(p.realizedPnl)}`}>{rupee(p.realizedPnl)}</td>
      <td className={`px-2 py-1 text-right font-mono ${toneClass(p.unrealizedPnl)}`}>{rupee(p.unrealizedPnl)}</td>
      <GreekCells g={g} matched={matched} />
    </tr>
  );
}

function GreekCells({ g, matched }: { g: PositionGreeks | undefined; matched: boolean }) {
  if (!g || !matched) {
    return (
      <>
        <td className="px-2 py-1 text-right font-mono text-zinc-700" title="No live chain contract matched">unmatched</td>
        <td className="px-2 py-1 text-right font-mono text-zinc-700">—</td>
        <td className="px-2 py-1 text-right font-mono text-zinc-700">—</td>
        <td className="px-2 py-1 text-right font-mono text-zinc-700">—</td>
      </>
    );
  }
  const n = g.netGreeks;
  return (
    <>
      <td className="px-2 py-1 text-right font-mono text-zinc-400">{g.iv > 0 ? volPct(g.iv) : "—"}</td>
      <td className={`px-2 py-1 text-right font-mono ${toneClass(n.delta)}`}>{dec(n.delta, 2)}</td>
      <td className="px-2 py-1 text-right font-mono text-zinc-400">{dec(n.gamma, 4)}</td>
      <td className={`px-2 py-1 text-right font-mono ${toneClass(n.theta)}`}>{dec(n.theta, 1)}</td>
      <td className="px-2 py-1 text-right font-mono text-zinc-400">{dec(n.vega, 2)}</td>
    </>
  );
}

function MarginUsedTile({
  loading,
  err,
  used,
  avail,
  total,
}: {
  loading: boolean;
  err: string | null;
  used: FundEntry | undefined;
  avail: FundEntry | undefined;
  total: FundEntry | undefined;
}) {
  if (loading) {
    return (
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Wallet size={12} className="text-zinc-600" strokeWidth={1.5} />
          <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Margin used</span>
        </div>
        <p className="font-mono text-lg font-semibold text-zinc-600">…</p>
      </div>
    );
  }
  if (err || !used) {
    return (
      <div className="rounded-panel border border-border bg-panel p-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Wallet size={12} className="text-zinc-600" strokeWidth={1.5} />
          <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Margin used</span>
          <ProvenanceBadge kind="UNAVAILABLE" />
        </div>
        <p className="font-mono text-lg font-semibold text-zinc-600">—</p>
        <p className="mt-0.5 text-2xs text-zinc-600">{err ? err : "No \"Utilized\" entry in funds — see Margin panel."}</p>
      </div>
    );
  }
  return (
    <Stat
      label="Margin used"
      value={rupee(used.equityAmount)}
      tone="amber"
      icon={Wallet}
      sub={
        <>
          <ProvenanceBadge kind="BROKER" />{" "}
          {avail ? `avail ${rupee(avail.equityAmount)}` : total ? `total ${rupee(total.equityAmount)}` : "see Margin panel"}
        </>
      }
    />
  );
}

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return <th className={`px-2 py-1.5 font-semibold ${left ? "text-left" : "text-right"}`}>{children}</th>;
}
