import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  CircleDot,
  Clock,
  FileText,
  LayoutDashboard,
  Radio,
  ShieldAlert,
  Target,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { autoTradeApi, accountApi, orderApi } from "../services/api";
import { useTradingStore } from "../store/useTradingStore";
import { formatCurrency } from "../utils/format";
import type { BotStatus } from "../types";

interface FyersData {
  funds: any[];
  positions: any[];
  holdings: any[];
  trades: any[];
  loading: boolean;
  error: string;
}

export function Dashboard() {
  const { settings } = useTradingStore();
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [fyers, setFyers] = useState<FyersData>({
    funds: [],
    positions: [],
    holdings: [],
    trades: [],
    loading: true,
    error: "",
  });
  const [lastTrade, setLastTrade] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;

    async function fetchAll() {
      try {
        const [fundsRes, positionsRes, holdingsRes, tradesRes, botRes] = await Promise.allSettled([
          accountApi.getFunds(),
          accountApi.getPositions(),
          accountApi.getHoldings(),
          orderApi.getTrades(),
          autoTradeApi.getStatus(),
        ]);

        if (!mounted) return;

        const funds = fundsRes.status === "fulfilled" ? fundsRes.value.funds || [] : [];
        const positions = positionsRes.status === "fulfilled" ? positionsRes.value.positions || [] : [];
        const holdings = holdingsRes.status === "fulfilled" ? holdingsRes.value.holdings || [] : [];
        const trades = tradesRes.status === "fulfilled" ? tradesRes.value.trades || [] : [];

        if (botRes.status === "fulfilled") {
          setBotStatus(botRes.value);
        }

        setFyers({
          funds,
          positions,
          holdings,
          trades,
          loading: false,
          error: "",
        });

        if (trades.length > 0) {
          setLastTrade(trades[0]);
        }

        setLogs([
          `${new Date().toLocaleTimeString()} — System heartbeat OK`,
          botRes.status === "fulfilled" && botRes.value.isRunning
            ? "Bot active — scanning for signals"
            : "Bot idle — awaiting operator start",
        ].filter(Boolean) as string[]);
      } catch (err: any) {
        if (mounted) {
          setFyers((prev) => ({ ...prev, loading: false, error: err.message }));
        }
      }
    }

    fetchAll();
    const interval = setInterval(fetchAll, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const availableFunds = fyers.funds.find((f: any) => f.title === "Available Balance")?.equityAmount || 0;
  const openPositions = fyers.positions.filter((p: any) => p.type === "NET" && p.netQty !== 0);
  const todayPnl = fyers.positions.reduce((sum: number, p: any) => sum + (p.pl || 0), 0);

  const botRunning = botStatus?.isRunning || false;
  const botHealth = botStatus?.emergencyStop
    ? "critical"
    : botRunning
      ? "healthy"
      : "idle";
  const botHealthColor = {
    healthy: "text-gain",
    idle: "text-zinc-500",
    critical: "text-loss",
  }[botHealth];

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end mb-5">
        <div>
          <p className="flex items-center gap-1.5 text-2xs text-gain">
            <CircleDot size={10} className={botRunning ? "animate-pulse" : ""} />
            {botRunning ? "Bot operational" : "Bot idle"}
          </p>
        </div>
        <Link
          to="/trading-bot"
          className="rounded-panel border border-gain/20 bg-gain-dim px-5 py-2.5 text-center text-2xs font-semibold text-gain transition hover:bg-gain/20"
        >
          Trading Bot
        </Link>
      </div>

      {/* Bot Status Overview */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Bot Status"
          value={botRunning ? "RUNNING" : "STOPPED"}
          detail={botStatus?.paperTrading ? "Paper trading mode" : "Live execution"}
          icon={Bot}
          tone={botRunning ? "green" : "amber"}
        />
        <MetricCard
          label="Today's P&L"
          value={formatCurrency(todayPnl)}
          detail={`${openPositions.length} open positions`}
          icon={TrendingUp}
          tone={todayPnl >= 0 ? "green" : "rose"}
        />
        <MetricCard
          label="Current Positions"
          value={String(botStatus?.openPositions?.length || 0)}
          detail="Managed by bot"
          icon={Target}
          tone="green"
        />
        <MetricCard
          label="Trades Today"
          value={`${botStatus?.todayTrades || 0} / ${botStatus?.maxTrades || settings.maxTradesPerDay}`}
          detail={botStatus?.todayTrades && botStatus.todayTrades >= (botStatus.maxTrades || settings.maxTradesPerDay) ? "Daily limit reached" : "Within limit"}
          icon={Activity}
          tone={botStatus?.todayTrades && botStatus.todayTrades >= (botStatus.maxTrades || settings.maxTradesPerDay) ? "amber" : "green"}
        />
      </div>

      {/* System Health Row */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Card>
          <div className="flex items-center gap-3">
            <div className={`rounded-panel p-2 ${botHealthColor}`}>
              <Radio size={16} />
            </div>
            <div>
              <p className="text-2xs text-zinc-600">Bot Health</p>
              <p className={`text-2xs font-semibold ${botHealthColor}`}>
                {botHealth === "healthy" ? "Healthy" : botHealth === "idle" ? "Idle" : "Emergency Stop"}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-panel p-2 text-info">
              <Wallet size={16} />
            </div>
            <div>
              <p className="text-2xs text-zinc-600">Broker Status</p>
              <p className="text-2xs font-semibold text-zinc-300">
                {fyers.error ? "Disconnected" : "Connected"}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-panel p-2 text-warn">
              <Zap size={16} />
            </div>
            <div>
              <p className="text-2xs text-zinc-600">Market Status</p>
              <p className="text-2xs font-semibold text-zinc-300">
                {botStatus?.marketStatus || "Unknown"}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Account Data */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Account Overview</span>
          {fyers.loading && <Clock size={12} className="animate-spin text-zinc-700" />}
          {fyers.error && <span className="text-2xs text-loss">(Broker disconnected)</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Available Funds"
            value={formatCurrency(availableFunds)}
            detail="Cash available"
            icon={Wallet}
            tone="green"
          />
          <MetricCard
            label="Portfolio Value"
            value={formatCurrency(fyers.holdings.reduce((sum: number, h: any) => sum + (h.value || 0), 0))}
            detail={`${fyers.holdings.length} holdings`}
            icon={LayoutDashboard}
            tone="green"
          />
          <MetricCard
            label="Daily Risk Used"
            value={formatCurrency(Math.abs(todayPnl))}
            detail={`Limit: ${formatCurrency(settings.capital * (settings.dailyLossLimitPercent / 100))}`}
            icon={ShieldAlert}
            tone="rose"
          />
          <MetricCard
            label="Current Strategy"
            value="5 EMA"
            detail="Automated execution"
            icon={Target}
            tone="green"
          />
        </div>
      </div>

      {/* Recent Activity */}
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card title="System Logs" icon={FileText}>
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {logs.map((log, i) => (
              <p key={i} className="text-2xs text-zinc-700 font-mono">
                {log}
              </p>
            ))}
          </div>
        </Card>

        <Card title="Last Trade" icon={Clock}>
          {lastTrade ? (
            <div className="space-y-1">
              <p className="text-2xs text-zinc-300">
                {lastTrade.symbol} — <span className={lastTrade.pnl >= 0 ? "text-gain" : "text-loss"}>
                  {formatCurrency(lastTrade.pnl || 0)}
                </span>
              </p>
              <p className="text-2xs text-zinc-700">
                {lastTrade.orderDateTime || new Date(lastTrade.orderDateTime).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="text-2xs text-zinc-700">No trades executed yet today.</p>
          )}
        </Card>
      </div>

      {/* Strategy Status */}
      <Card className="mt-5" title="Strategy Status" icon={Activity} action={
        <span className={`rounded-panel border px-2 py-0.5 text-2xs font-medium ${botRunning ? "border-gain/20 bg-gain-dim text-gain" : "border-border-subtle bg-surface text-zinc-600"}`}>
          {botRunning ? "Scanning" : "Standby"}
        </span>
      }>
        <p className="text-2xs text-zinc-500">
          {botRunning
            ? "Bot is actively monitoring 5 EMA crossover conditions on NIFTY and BANKNIFTY. Signals will be generated and executed automatically per configured risk parameters."
            : "Start the Trading Bot to begin automated signal scanning and execution."}
        </p>
      </Card>
    </div>
  );
}