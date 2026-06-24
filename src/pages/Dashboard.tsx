import {
  Activity,
  Flame,
  IndianRupee,
  ShieldAlert,
  Target,
  TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { MetricCard } from "../components/MetricCard";
import { calculateDiscipline } from "../rules/discipline";
import { useTradingStore } from "../store/useTradingStore";
import { toLocalDateKey } from "../utils/date";
import { formatCurrency, formatPercent } from "../utils/format";

export function Dashboard() {
  const { settings, trades } = useTradingStore();
  const todayTrades = trades.filter((trade) => trade.date === toLocalDateKey());
  const discipline = calculateDiscipline(trades);
  const tradeLocked = todayTrades.length >= settings.maxTradesPerDay;

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
          to="/new-trade"
          className={`rounded-xl px-5 py-2.5 text-center text-sm font-semibold ${
            tradeLocked
              ? "bg-zinc-800 text-zinc-500"
              : "bg-lime-400 text-zinc-950 hover:bg-lime-300"
          }`}
        >
          {tradeLocked ? "Trading locked today" : "Evaluate a trade"}
        </Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

      <Card className="mt-6">
        <p className="text-sm font-medium text-white">System principle</p>
        <blockquote className="mt-3 max-w-2xl text-lg leading-8 text-zinc-400">
          “A good trade is a rule-following trade, regardless of P&amp;L.”
        </blockquote>
      </Card>
    </div>
  );
}
