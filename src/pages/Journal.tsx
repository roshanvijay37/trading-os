import { BookOpen, Bot } from "lucide-react";
import { useTradingStore } from "../store/useTradingStore";
import { formatDate } from "../utils/date";
import { formatCurrency } from "../utils/format";

export function Journal() {
  const { trades } = useTradingStore();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Journal</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Automated trade audit trail. Review execution quality.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
          <Bot size={14} />
          Bot-executed only
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="mt-16 text-center">
          <BookOpen className="mx-auto text-zinc-700" size={38} />
          <p className="mt-4 text-zinc-400">No trades recorded yet.</p>
          <p className="mt-1 text-sm text-zinc-600">The bot will populate this journal automatically.</p>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {trades.map((trade) => (
            <article
              key={trade.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
            >
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-white">{trade.symbol}</h2>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                        trade.side === "LONG"
                          ? "bg-lime-400/10 text-lime-300"
                          : "bg-rose-400/10 text-rose-300"
                      }`}
                    >
                      {trade.side}
                    </span>
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                      {trade.outcome}
                    </span>
                    <span className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
                      <Bot size={10} />
                      AUTO
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatDate(trade.date)} · Entry {trade.entryPrice} · Stop{" "}
                    {trade.stopLossPrice} · Qty {trade.quantity}
                  </p>
                  {trade.notes && (
                    <p className="mt-3 max-w-2xl text-sm text-zinc-400">{trade.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm font-medium ${
                      trade.pnl > 0
                        ? "text-lime-300"
                        : trade.pnl < 0
                          ? "text-rose-300"
                          : "text-zinc-500"
                    }`}
                  >
                    {formatCurrency(trade.pnl)}
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}