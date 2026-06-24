import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { autoTradeApi } from "../services/api";
import {
  Play,
  Square,
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Target,
  Shield,
  Zap,
  BarChart3,
} from "lucide-react";

interface Position {
  id: string;
  optionSymbol: string;
  quantity: number;
  entryPrice: number;
  currentSL: number;
  target: number;
  pnl: number;
  status: string;
  underlying: string;
}

interface Signal {
  type: string;
  entryPrice: number;
  stopLoss: number;
  target: number;
  timestamp: number;
  underlying: string;
  status: string;
}

interface AutoTradeStatus {
  isRunning: boolean;
  marketStatus: string;
  todayTrades: number;
  maxTrades: number;
  openPositions: Position[];
  activeAlert: any;
  latestData: Record<string, any>;
  recentSignals: Signal[];
  config: {
    CAPITAL: number;
    RISK_PERCENT: number;
    MAX_TRADES_PER_DAY: number;
    POLL_INTERVAL_MS: number;
    UNDERLYINGS: { name: string; symbol: string; lotSize: number }[];
  };
}

export function AutoTrade() {
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshInterval, setRefreshInterval] = useState<number | null>(null);

  const fetchStatus = async () => {
    try {
      const data = await autoTradeApi.getStatus();
      setStatus(data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to fetch status");
    }
  };

  useEffect(() => {
    fetchStatus();
    // Auto-refresh every 5 seconds when running
    const interval = setInterval(() => {
      fetchStatus();
    }, 5000);
    setRefreshInterval(interval);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  const handleStart = async () => {
    setLoading(true);
    setError("");
    try {
      await autoTradeApi.start();
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || "Failed to start");
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setError("");
    try {
      await autoTradeApi.stop();
      await fetchStatus();
    } catch (err: any) {
      setError(err.message || "Failed to stop");
    } finally {
      setLoading(false);
    }
  };

  const isRunning = status?.isRunning || false;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Auto Trader
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Automated 5 EMA strategy by Subhasish Pani
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isRunning ? (
            <span className="flex items-center gap-1.5 rounded-full bg-lime-400/10 px-3 py-1.5 text-xs font-medium text-lime-300">
              <Activity size={14} className="animate-pulse" />
              Running
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400">
              <XCircle size={14} />
              Stopped
            </span>
          )}
        </div>
      </div>

      {/* Control Panel */}
      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-white">Trading Bot Control</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {isRunning
                ? "Bot is actively scanning for 5 EMA setups"
                : "Start the bot to begin automated trading"}
            </p>
          </div>
          <div className="flex gap-3">
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-lime-400 px-5 py-2.5 font-semibold text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
              >
                <Play size={18} />
                {loading ? "Starting..." : "Start Bot"}
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-rose-500 px-5 py-2.5 font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50"
              >
                <Square size={18} />
                {loading ? "Stopping..." : "Stop Bot"}
              </button>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">
            {error}
          </p>
        )}
      </Card>

      {status && (
        <>
          {/* Stats Grid */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-400/10 p-2 text-blue-300">
                  <BarChart3 size={20} />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Market Status</p>
                  <p className="text-lg font-semibold text-white">
                    {status.marketStatus}
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-400/10 p-2 text-amber-300">
                  <Zap size={20} />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Trades Today</p>
                  <p className="text-lg font-semibold text-white">
                    {status.todayTrades} / {status.maxTrades}
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-lime-400/10 p-2 text-lime-300">
                  <Target size={20} />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Open Positions</p>
                  <p className="text-lg font-semibold text-white">
                    {status.openPositions?.length || 0}
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-400/10 p-2 text-purple-300">
                  <Shield size={20} />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Capital</p>
                  <p className="text-lg font-semibold text-white">
                    ₹{(status.config?.CAPITAL || 0).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Configuration */}
          <Card className="mt-6">
            <h3 className="text-sm font-medium text-white">Strategy Configuration</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs text-zinc-500">Risk Per Trade</p>
                <p className="text-sm font-medium text-white">
                  {status.config?.RISK_PERCENT || 1}%
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs text-zinc-500">Max Trades/Day</p>
                <p className="text-sm font-medium text-white">
                  {status.config?.MAX_TRADES_PER_DAY || 2}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs text-zinc-500">Scan Interval</p>
                <p className="text-sm font-medium text-white">
                  {(status.config?.POLL_INTERVAL_MS || 30000) / 1000}s
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs text-zinc-500">Underlyings</p>
                <p className="text-sm font-medium text-white">
                  {status.config?.UNDERLYINGS?.map((u) => u.name).join(", ") || "NIFTY, BANKNIFTY"}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs text-zinc-500">Target R:R</p>
                <p className="text-sm font-medium text-white">1:2</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-xs text-zinc-500">Trailing SL</p>
                <p className="text-sm font-medium text-white">Enabled</p>
              </div>
            </div>
          </Card>

          {/* Live Data */}
          {status.latestData && Object.keys(status.latestData).length > 0 && (
            <Card className="mt-6">
              <h3 className="text-sm font-medium text-white">Live Market Data</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {Object.entries(status.latestData).map(([name, data]: [string, any]) => (
                  <div
                    key={name}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-white">{name}</p>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          data.ltp > (data.candles?.[data.candles.length - 2]?.[4] || 0)
                            ? "bg-lime-400/10 text-lime-300"
                            : "bg-rose-500/10 text-rose-300"
                        }`}
                      >
                        ₹{data.ltp?.toFixed(2) || "-"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      Last updated: {new Date(data.lastUpdated).toLocaleTimeString()}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Active Alert */}
          {status.activeAlert && (
            <Card className="mt-6 border-amber-400/20">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400" />
                <h3 className="text-sm font-medium text-amber-300">Active Alert</h3>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-zinc-500">Type</p>
                  <p className="text-sm font-medium text-white">
                    {status.activeAlert.type === "BULLISH_ALERT" ? (
                      <span className="flex items-center gap-1 text-lime-300">
                        <TrendingUp size={14} /> Bullish
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-rose-300">
                        <TrendingDown size={14} /> Bearish
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Underlying</p>
                  <p className="text-sm font-medium text-white">
                    {status.activeAlert.underlying}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">5 EMA</p>
                  <p className="text-sm font-medium text-white">
                    {status.activeAlert.ema5?.toFixed(2)}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Open Positions */}
          {status.openPositions && status.openPositions.length > 0 && (
            <Card className="mt-6">
              <h3 className="text-sm font-medium text-white">Open Positions</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="pb-2 text-left">Symbol</th>
                      <th className="pb-2 text-right">Qty</th>
                      <th className="pb-2 text-right">Entry</th>
                      <th className="pb-2 text-right">Current SL</th>
                      <th className="pb-2 text-right">Target</th>
                      <th className="pb-2 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {status.openPositions.map((pos) => (
                      <tr key={pos.id} className="text-zinc-300">
                        <td className="py-2">
                          <span className="font-medium text-white">{pos.optionSymbol}</span>
                          <span className="ml-2 text-xs text-zinc-500">{pos.underlying}</span>
                        </td>
                        <td className="py-2 text-right">{pos.quantity}</td>
                        <td className="py-2 text-right">₹{pos.entryPrice?.toFixed(2)}</td>
                        <td className="py-2 text-right">₹{pos.currentSL?.toFixed(2)}</td>
                        <td className="py-2 text-right">₹{pos.target?.toFixed(2)}</td>
                        <td
                          className={`py-2 text-right font-medium ${
                            pos.pnl >= 0 ? "text-lime-300" : "text-rose-300"
                          }`}
                        >
                          ₹{pos.pnl?.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Recent Signals */}
          {status.recentSignals && status.recentSignals.length > 0 && (
            <Card className="mt-6">
              <h3 className="text-sm font-medium text-white">Recent Signals</h3>
              <div className="mt-4 space-y-2">
                {status.recentSignals.slice(0, 10).map((signal, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                  >
                    <div className="flex items-center gap-3">
                      {signal.type === "LONG" ? (
                        <TrendingUp size={16} className="text-lime-300" />
                      ) : (
                        <TrendingDown size={16} className="text-rose-300" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-white">
                          {signal.type} - {signal.underlying}
                        </p>
                        <p className="text-xs text-zinc-500">
                          Entry: ₹{signal.entryPrice?.toFixed(2)} | SL: ₹
                          {signal.stopLoss?.toFixed(2)} | Target: ₹
                          {signal.target?.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        signal.status === "EXECUTED"
                          ? "bg-lime-400/10 text-lime-300"
                          : signal.status === "FAILED"
                          ? "bg-rose-500/10 text-rose-300"
                          : "bg-amber-400/10 text-amber-300"
                      }`}
                    >
                      {signal.status}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}