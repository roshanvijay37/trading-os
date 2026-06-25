import { useEffect, useState } from "react";
import {
  Activity,
  Flame,
  IndianRupee,
  ShieldAlert,
  Target,
  TrendingUp,
  Wallet,
  Briefcase,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { calculateDiscipline } from "../rules/discipline";
import { accountApi, orderApi } from "../services/api";
import { useTradingStore } from "../store/useTradingStore";
import { toLocalDateKey } from "../utils/date";
import { formatCurrency, formatPercent } from "../utils/format";

interface FyersData {
  funds: any[];
  positions: any[];
  holdings: any[];
  trades: any[];
  loading: boolean;
  error: string;
}

export function Dashboard() {
  const { settings, trades } = useTradingStore();
  const todayTrades = trades.filter((trade) => trade.date === toLocalDateKey());
  const discipline = calculateDiscipline(trades);
  const tradeLocked = todayTrades.length >= settings.maxTradesPerDay;

  const [fyers, setFyers] = useState<FyersData>({
    funds: [],
    positions: [],
    holdings: [],
    trades: [],
    loading: true,
    error: "",
  });

  useEffect(() => {
    let mounted = true;
    const interval = setInterval(() => {
      fetchRealTimeData();
    }, 5000); // Refresh every 5 seconds

    async function fetchRealTimeData() {
      try {
        const [fundsRes, positionsRes, holdingsRes, tradesRes] = await Promise.allSettled([
          accountApi.getFunds(),
          accountApi.getPositions(),
          accountApi.getHoldings(),
          orderApi.getTrades(),
        ]);

        if (!mounted) return;

        const funds = fundsRes.status === "fulfilled" ? fundsRes.value.funds || [] : [];
        const positions = positionsRes.status === "fulfilled" ? positionsRes.value.positions || [] : [];
        const holdings = holdingsRes.status === "fulfilled" ? holdingsRes.value.holdings || [] : [];
        const trades = tradesRes.status === "fulfilled" ? tradesRes.value.trades || [] : [];

        setFyers({
          funds,
          positions,
          holdings,
          trades,
          loading: false,
          error: "",
        });
      } catch (err: any) {
        if (mounted) {
          setFyers((prev) => ({ ...prev, loading: false, error: err.message }));
        }
      }
    }

    fetchRealTimeData();

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Calculate real metrics
  const availableFunds = fyers.funds.find((f: any) => f.title === "Available Balance")?.equityAmount || 0;
  const portfolioValue = fyers.holdings.reduce((sum: number, h: any) => sum + (h.value || 0), 0);
  const openPositions = fyers.positions.filter((p: any) => p.type === "NET" && p.netQty !== 0);
  const todayPnl = fyers.positions.reduce((sum: number, p: any) => sum + (p.pl || 0), 0);

  return (
    <div>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-lime-300">Risk manager online</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Protect the process. Let outcomes take care of themselves.
          </p>
        </div>
        <Link
          to="/live-trade"
          className={`rounded-xl px-5 py-2.5 text-center text-sm font-semibold ${
            tradeLocked
              ? "bg-zinc-800 text-zinc-500"
              : "bg-lime-400 text-zinc-950 hover:bg-lime-300"
          }`}
        >
          {tradeLocked ? "Trading locked today" : "Live Trade"}
        </Link>
      </div>

      {/* FYERS Real-Time Data */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-300">Live Account</h2>
          {fyers.loading && <Loader2 size={14} className="animate-spin text-zinc-500" />}
          {fyers.error && <span className="text-xs text-rose-400">(FYERS disconnected)</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Available Funds"
            value={formatCurrency(availableFunds)}
            detail="Cash available for trading"
            icon={Wallet}
            tone="green"
          />
          <MetricCard
            label="Portfolio Value"
            value={formatCurrency(portfolioValue)}
            detail={`${fyers.holdings.length} holdings`}
            icon={Briefcase}
            tone="green"
          />
          <MetricCard
            label="Today's P&L"
            value={formatCurrency(todayPnl)}
            detail={`${openPositions.length} open positions`}
            icon={BarChart3}
            tone={todayPnl >= 0 ? "green" : "rose"}
          />
          <MetricCard
            label="Day's Trades"
            value={String(fyers.trades.length)}
            detail="Executed today"
            icon={Activity}
            tone="green"
          />
        </div>
      </div>

      {/* System Settings */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">System Settings</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Capital"
            value={formatCurrency(settings.capital)}
            detail="Configured trading capital"
            icon={IndianRupee}
          />
          <MetricCard
            label="Risk per trade"
            value={formatPercent(settings.riskPercent)}
            detail={formatCurrency(settings.capital * (settings.riskPercent / 100))}
            icon={Target}
          />
          <MetricCard
            label="Daily loss limit"
            value={formatPercent(settings.dailyLossLimitPercent)}
            detail={formatCurrency(
              settings.capital * (settings.dailyLossLimitPercent / 100),
            )}
            icon={ShieldAlert}
            tone="rose"
          />
          <MetricCard
            label="Trades taken today"
            value={`${todayTrades.length} / ${settings.maxTradesPerDay}`}
            detail={tradeLocked ? "No more trades allowed" : "Trade slot available"}
            icon={Activity}
            tone={tradeLocked ? "rose" : "green"}
          />
          <MetricCard
            label="Discipline score"
            value={`${discipline.score}%`}
            detail={`${discipline.ruleFollowingTrades} rule-following trades`}
            icon={TrendingUp}
            tone={discipline.score < 70 ? "amber" : "green"}
          />
          <MetricCard
            label="Current streak"
            value={`${discipline.currentStreak} trades`}
            detail="Consecutive disciplined executions"
            icon={Flame}
            tone="amber"
          />
        </div>
      </div>

      <Card className="mt-6">
        <p className="text-sm font-medium text-white">System principle</p>
        <blockquote className="mt-3 max-w-2xl text-lg leading-8 text-zinc-400">
          "A good trade is a rule-following trade, regardless of P&L."
        </blockquote>
      </Card>
    </div>
  );
}