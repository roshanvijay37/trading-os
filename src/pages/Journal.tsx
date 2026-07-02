import { BookOpen, Bot } from "lucide-react";
import { Badge, Panel } from "../components/ui";
import { useTradingStore } from "../store/useTradingStore";
import { formatDate } from "../utils/date";
import { formatCurrency } from "../utils/format";

export function Journal() {
  const { trades } = useTradingStore();

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <span className="flex items-center gap-1.5 rounded-panel border border-border-subtle bg-surface px-2.5 py-1 text-2xs text-zinc-500">
          <Bot size={10} />
          Bot-executed only
        </span>
      </div>

      {trades.length === 0 ? (
        <div className="mt-16 text-center">
          <BookOpen className="mx-auto text-zinc-800" size={32} />
          <p className="mt-4 text-2xs text-zinc-500">No trades recorded yet.</p>
          <p className="mt-1 text-2xs text-zinc-700">The bot will populate this journal automatically.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {trades.map((trade) => (
            <Panel key={trade.id}>
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xs font-semibold text-zinc-200">{trade.symbol}</h2>
                    <Badge tone={trade.side === "LONG" ? "green" : "rose"}>{trade.side}</Badge>
                    <Badge tone={trade.outcome === "WIN" ? "green" : trade.outcome === "LOSS" ? "rose" : "zinc"}>
                      {trade.outcome}
                    </Badge>
                    <Badge tone="zinc">
                      <Bot size={8} />
                      AUTO
                    </Badge>
                  </div>
                  <p className="mt-1 text-2xs text-zinc-600">
                    {formatDate(trade.date)} · Entry {trade.entryPrice} · Stop{" "}
                    {trade.stopLossPrice} · Qty {trade.quantity}
                  </p>
                  {trade.notes && (
                    <p className="mt-3 max-w-2xl text-2xs text-zinc-400">{trade.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-2xs font-medium ${
                      trade.pnl > 0
                        ? "text-gain"
                        : trade.pnl < 0
                          ? "text-loss"
                          : "text-zinc-600"
                    }`}
                  >
                    {formatCurrency(trade.pnl)}
                  </span>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}