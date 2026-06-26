import { Card } from "../components/Card";
import { calculateDiscipline } from "../rules/discipline";
import { useTradingStore } from "../store/useTradingStore";
import { formatCurrency } from "../utils/format";

export function Reports() {
  const { trades } = useTradingStore();
  const closed = trades.filter((trade) => trade.outcome !== "OPEN");
  const wins = closed.filter((trade) => trade.outcome === "WIN").length;
  const pnl = closed.reduce((total, trade) => total + trade.pnl, 0);
  const discipline = calculateDiscipline(trades);
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-white">Reports</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Process metrics first. Outcome metrics second.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Discipline", `${discipline.score}%`],
          ["Rule-following trades", `${discipline.ruleFollowingTrades}/${trades.length}`],
          ["Win rate", `${winRate}%`],
          ["Realized P&L", formatCurrency(pnl)],
        ].map(([label, value]) => (
          <Card key={label}>
            <p className="text-sm text-zinc-500">{label}</p>
            <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <h2 className="font-medium text-white">Monthly insight</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          {trades.length === 0
            ? "No sample yet. The report becomes meaningful after several documented trades."
            : discipline.score === 100
              ? "Every recorded trade followed the rules. Protect this standard; do not optimize for activity."
              : "Your largest opportunity is execution consistency. Review rule breaks before changing strategy."}
        </p>
      </Card>
    </div>
  );
}
