import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { accountApi, isFyersConnected } from "../services/api";
import { Radio, TrendingUp, TrendingDown, Activity, Eye, AlertCircle } from "lucide-react";
import type { OptionChainItem } from "../types";

interface QuoteData {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  high?: number;
  low?: number;
  open?: number;
}

export function MarketMonitor() {
  const [connected, setConnected] = useState(false);
  const [underlying, setUnderlying] = useState<"NIFTY" | "BANKNIFTY">("NIFTY");
  const [optionChain, setOptionChain] = useState<OptionChainItem[]>([]);
  const [spotQuote, setSpotQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const symbolMap = {
    NIFTY: "NSE:NIFTY50-INDEX",
    BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  } as const;

  // Check connection
  useEffect(() => {
    setConnected(isFyersConnected());
    const handle = () => setConnected(isFyersConnected());
    window.addEventListener("fyers:logout", handle);
    return () => window.removeEventListener("fyers:logout", handle);
  }, []);

  // Fetch option chain and spot quote
  useEffect(() => {
    if (!connected) return;

    let mounted = true;
    const interval = setInterval(() => {
      fetchData();
    }, 3000);

    async function fetchData() {
      setLoading(true);
      try {
        const [chainRes, quoteRes] = await Promise.allSettled([
          accountApi.getOptionChain(symbolMap[underlying], 20),
          accountApi.getQuotes([symbolMap[underlying]]),
        ]);

        if (!mounted) return;

        if (chainRes.status === "fulfilled") {
          setOptionChain(chainRes.value.optionChain || []);
        }

        if (quoteRes.status === "fulfilled" && quoteRes.value.quotes?.[0]) {
          const q = quoteRes.value.quotes[0];
          setSpotQuote({
            symbol: q.symbol || underlying,
            ltp: q.lp || q.ltp || 0,
            change: q.ch || 0,
            changePercent: q.chp || 0,
            high: q.high_price || q.high || 0,
            low: q.low_price || q.low || 0,
            open: q.open_price || q.open || 0,
          });
        }

        setLastUpdated(new Date());
        setError("");
      } catch (err: any) {
        if (mounted) setError(err.message || "Data fetch error");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [connected, underlying]);

  // Calculate ATM strike
  const atmStrike = spotQuote
    ? Math.round(spotQuote.ltp / (underlying === "NIFTY" ? 50 : 100)) * (underlying === "NIFTY" ? 50 : 100)
    : null;

  // Calculate PCR if data available
  const ceOi = optionChain
    .filter((o) => (o.option_type || o.optionType) === "CE")
    .reduce((sum, o) => sum + (o.oi || o.open_interest || 0), 0);
  const peOi = optionChain
    .filter((o) => (o.option_type || o.optionType) === "PE")
    .reduce((sum, o) => sum + (o.oi || o.open_interest || 0), 0);
  const pcr = ceOi > 0 ? (peOi / ceOi).toFixed(2) : "—";

  if (!connected) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <span className="inline-flex rounded-2xl bg-zinc-800 p-4 text-zinc-400">
          <Eye size={32} />
        </span>
        <h1 className="mt-6 text-3xl font-semibold text-white">Market Monitor</h1>
        <p className="mt-3 text-zinc-400">
          Connect FYERS to view live option chains, spot prices, and market data.
        </p>
        <p className="mt-2 text-sm text-zinc-600">
          This is a read-only dashboard. No orders can be placed here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white">Market Monitor</h1>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
              <Radio size={10} className={loading ? "animate-pulse" : ""} />
              LIVE
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Read-only market surveillance. All data refreshes automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-zinc-600">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <select
            value={underlying}
            onChange={(e) => setUnderlying(e.target.value as "NIFTY" | "BANKNIFTY")}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none"
          >
            <option value="NIFTY">NIFTY 50</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300 flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Spot Price Header */}
      {spotQuote && (
        <Card className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider">{underlying} Spot</p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-3xl font-bold text-white">₹{spotQuote.ltp.toLocaleString()}</span>
                <span
                  className={`flex items-center text-sm font-medium ${
                    spotQuote.change >= 0 ? "text-lime-300" : "text-rose-300"
                  }`}
                >
                  {spotQuote.change >= 0 ? <TrendingUp size={14} className="mr-1" /> : <TrendingDown size={14} className="mr-1" />}
                  {spotQuote.change >= 0 ? "+" : ""}
                  {spotQuote.change.toFixed(2)} ({spotQuote.changePercent >= 0 ? "+" : ""}
                  {spotQuote.changePercent.toFixed(2)}%)
                </span>
              </div>
            </div>
            <div className="flex gap-6 text-xs text-zinc-500">
              <div>
                <span className="block text-zinc-600">Open</span>
                <span className="text-zinc-300">₹{spotQuote.open?.toLocaleString()}</span>
              </div>
              <div>
                <span className="block text-zinc-600">High</span>
                <span className="text-lime-300">₹{spotQuote.high?.toLocaleString()}</span>
              </div>
              <div>
                <span className="block text-zinc-600">Low</span>
                <span className="text-rose-300">₹{spotQuote.low?.toLocaleString()}</span>
              </div>
              <div>
                <span className="block text-zinc-600">ATM Strike</span>
                <span className="text-amber-300">₹{atmStrike}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* PCR & Summary */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-400/10 p-2 text-blue-300">
              <Activity size={18} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Put/Call Ratio</p>
              <p className="text-lg font-semibold text-white">{pcr}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-lime-400/10 p-2 text-lime-300">
              <TrendingUp size={18} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">CE Total OI</p>
              <p className="text-lg font-semibold text-white">{ceOi.toLocaleString()}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-rose-400/10 p-2 text-rose-300">
              <TrendingDown size={18} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">PE Total OI</p>
              <p className="text-lg font-semibold text-white">{peOi.toLocaleString()}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* OI Heatmap */}
      <Card className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-white">
            OI Heatmap — {underlying === "BANKNIFTY" ? "Bank Nifty" : "Nifty 50"}
          </p>
          {loading && <p className="text-xs text-zinc-500">Refreshing...</p>}
        </div>
        {optionChain.length > 0 ? (
          <OIHeatmap optionChain={optionChain} atmStrike={atmStrike} underlying={underlying} />
        ) : (
          <p className="text-sm text-zinc-500">
            {loading ? "Fetching option chain..." : "No options data available."}
          </p>
        )}
      </Card>

      {/* Option Chain Table */}
      <Card className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-white">
            Option Chain — {underlying === "BANKNIFTY" ? "Bank Nifty" : "Nifty 50"}
          </p>
        </div>
        {optionChain.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="pb-2 text-left">Strike</th>
                  <th className="pb-2 text-left">Type</th>
                  <th className="pb-2 text-right">LTP</th>
                  <th className="pb-2 text-right">Change %</th>
                  <th className="pb-2 text-right">OI</th>
                  <th className="pb-2 text-right">OI Change</th>
                  <th className="pb-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {optionChain.map((opt, idx) => {
                  const strike = opt.strike_price || opt.strike || 0;
                  const isATM = atmStrike !== null && Math.abs(strike - atmStrike) < (underlying === "NIFTY" ? 25 : 50);
                  const type = opt.option_type || opt.optionType;
                  const ltp = opt.ltp || opt.lp || opt.last_price || 0;
                  const chp = opt.ltpchp || opt.chp || opt.change_percent || 0;
                  const oi = opt.oi || opt.open_interest || 0;

                  return (
                    <tr
                      key={idx}
                      className={`text-zinc-300 transition ${
                        isATM ? "bg-amber-400/5" : "hover:bg-zinc-900/50"
                      }`}
                    >
                      <td className="py-2 font-medium">
                        ₹{strike.toLocaleString()}
                        {isATM && (
                          <span className="ml-1.5 rounded bg-amber-400/20 px-1 py-0.5 text-[9px] text-amber-300">
                            ATM
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            type === "CE"
                              ? "bg-lime-400/10 text-lime-300"
                              : "bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          {type}
                        </span>
                      </td>
                      <td className="py-2 text-right">₹{ltp.toFixed(2)}</td>
                      <td className={`py-2 text-right ${chp >= 0 ? "text-lime-400" : "text-rose-400"}`}>
                        {chp >= 0 ? "+" : ""}
                        {chp.toFixed(2)}%
                      </td>
                      <td className="py-2 text-right">{oi.toLocaleString()}</td>
                      <td className="py-2 text-right text-zinc-500">—</td>
                      <td className="py-2 text-center">
                        <span className="text-[10px] text-zinc-600">Monitor only</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            {loading ? "Fetching option chain..." : "No options data available."}
          </p>
        )}
      </Card>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <p className="flex items-center gap-2 text-xs text-zinc-600">
          <Eye size={12} />
          This page is read-only. Signal generation and order execution are handled exclusively by the Trading Bot.
        </p>
      </div>
    </div>
  );
}

// ─── OI Heatmap Component ───────────────────────────────────────
function OIHeatmap({
  optionChain,
  atmStrike,
  underlying,
}: {
  optionChain: OptionChainItem[];
  atmStrike: number | null;
  underlying: "NIFTY" | "BANKNIFTY";
}) {
  // Group by strike — pair CE and PE
  const strikeMap = new Map<number, { ce?: OptionChainItem; pe?: OptionChainItem }>();

  for (const opt of optionChain) {
    const strike = opt.strike_price || opt.strike || 0;
    const type = opt.option_type || opt.optionType;
    if (!strikeMap.has(strike)) strikeMap.set(strike, {});
    const entry = strikeMap.get(strike)!;
    if (type === "CE") entry.ce = opt;
    else entry.pe = opt;
  }

  const strikes = Array.from(strikeMap.keys()).sort((a, b) => a - b);

  // Find max OI for scaling
  let maxOI = 0;
  for (const s of strikes) {
    const { ce, pe } = strikeMap.get(s)!;
    maxOI = Math.max(maxOI, ce?.oi || ce?.open_interest || 0, pe?.oi || pe?.open_interest || 0);
  }
  if (maxOI === 0) maxOI = 1;

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[1fr_60px_1fr] gap-2 text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
        <div className="text-right">Call OI</div>
        <div className="text-center">Strike</div>
        <div className="text-left">Put OI</div>
      </div>

      {strikes.map((strike) => {
        const { ce, pe } = strikeMap.get(strike)!;
        const isATM = atmStrike !== null && Math.abs(strike - atmStrike) < (underlying === "NIFTY" ? 25 : 50);

        const ceOI = ce?.oi || ce?.open_interest || 0;
        const peOI = pe?.oi || pe?.open_interest || 0;
        const ceWidth = (ceOI / maxOI) * 100;
        const peWidth = (peOI / maxOI) * 100;

        const ceLtp = ce?.ltp || ce?.lp || ce?.last_price || 0;
        const peLtp = pe?.ltp || pe?.lp || pe?.last_price || 0;
        const ceChp = ce?.ltpchp || ce?.chp || ce?.change_percent || 0;
        const peChp = pe?.ltpchp || pe?.chp || pe?.change_percent || 0;

        return (
          <div
            key={strike}
            className={`grid grid-cols-[1fr_60px_1fr] gap-2 items-center rounded py-0.5 ${
              isATM ? "bg-amber-400/10" : "hover:bg-zinc-900/30"
            }`}
          >
            {/* Call OI Bar (right-aligned) */}
            <div className="flex justify-end items-center gap-1.5">
              <div className="text-right">
                <p className="text-[10px] text-zinc-400">{ceOI.toLocaleString()}</p>
                <p className={`text-[9px] ${ceChp >= 0 ? "text-lime-400" : "text-rose-400"}`}>
                  {ceLtp > 0 ? `₹${ceLtp.toFixed(1)}` : "—"}
                </p>
              </div>
              <div className="w-full max-w-[120px] h-4 bg-zinc-900 rounded-sm overflow-hidden flex justify-end">
                <div
                  className="h-full bg-lime-400/40 transition-all"
                  style={{ width: `${ceWidth}%` }}
                />
              </div>
            </div>

            {/* Strike */}
            <div className={`text-center font-mono text-[11px] font-semibold ${isATM ? "text-amber-300" : "text-zinc-300"}`}>
              {strike.toLocaleString()}
              {isATM && <span className="block text-[8px] text-amber-400/70">ATM</span>}
            </div>

            {/* Put OI Bar (left-aligned) */}
            <div className="flex justify-start items-center gap-1.5">
              <div className="w-full max-w-[120px] h-4 bg-zinc-900 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-rose-400/40 transition-all"
                  style={{ width: `${peWidth}%` }}
                />
              </div>
              <div className="text-left">
                <p className="text-[10px] text-zinc-400">{peOI.toLocaleString()}</p>
                <p className={`text-[9px] ${peChp >= 0 ? "text-lime-400" : "text-rose-400"}`}>
                  {peLtp > 0 ? `₹${peLtp.toFixed(1)}` : "—"}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
