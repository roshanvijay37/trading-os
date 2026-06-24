import { BookOpen } from "lucide-react";
import { useTradingStore } from "../store/useTradingStore";
import type { Trade, TradeOutcome } from "../types";
import { formatDate } from "../utils/date";
import { formatCurrency } from "../utils/format";

export function Journal() {
  const { trades, updateTrade } = useTradingStore();

  const updateOutcome = (trade: Trade, outcome: TradeOutcome, pnl: number) => {
    updateTrade({ ...trade, outcome, pnl });
  };

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-white">Journal</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Review execution quality before reviewing money.
      </p>
      {trades.length === 0 ? (
        <div className="mt-16 text-center">
          <BookOpen className="mx-auto text-zinc-700" size={38} />
          <p className="mt-4 text-zinc-400">No trades recorded yet.</p>
          <p className="mt-1 text-sm text-zinc-600">Patience is also a position.</p>
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
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatDate(trade.date)} · Entry {trade.entryPrice} · Stop{" "}
                    {trade.stopLossPrice} · Qty {trade.quantity}
                  </p>
                  {trade.notes && (
                    <p className="mt-3 max-w-2xl text-sm text-zinc-400">{trade.notes}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`mr-2 text-sm font-medium ${
                      trade.pnl > 0
                        ? "text-lime-300"
                        : trade.pnl < 0
                          ? "text-rose-300"
                          : "text-zinc-500"
                    }`}
                  >
                    {formatCurrency(trade.pnl)}
                  </span>
                  {(["WIN", "LOSS", "BREAKEVEN"] as TradeOutcome[]).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      onClick={() => {
                        const raw = window.prompt(
                          `P&L for ${outcome} (use a negative value for a loss):`,
                          outcome === "LOSS" ? `-${trade.riskAmount}` : "0",
                        );
                        if (raw !== null && Number.isFinite(Number(raw))) {
                          updateOutcome(trade, outcome, Number(raw));
                        }
                      }}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-white"
                    >
                      {outcome}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
