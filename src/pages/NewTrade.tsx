import { LockKeyhole } from "lucide-react";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "../components/Card";
import { EmotionEvaluation } from "../components/EmotionEvaluation";
import { EmotionEngine } from "../rules/EmotionEngine";
import { RiskEngine } from "../rules/RiskEngine";
import { TradeRules } from "../rules/TradeRules";
import { useTradingStore } from "../store/useTradingStore";
import type { EmotionAnswers, EmotionEvaluation as EmotionResult, TradeSide } from "../types";
import { toLocalDateKey } from "../utils/date";
import { formatCurrency } from "../utils/format";

const initialEmotion: EmotionAnswers = {
  greedScore: 1,
  recoveringLosses: false,
  missedPreviousMove: false,
  increasingLotSize: false,
};

export function NewTrade() {
  const { settings, trades, addTrade } = useTradingStore();
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<TradeSide>("LONG");
  const [entryPrice, setEntryPrice] = useState(0);
  const [stopLossPrice, setStopLossPrice] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [emotion, setEmotion] = useState(initialEmotion);
  const [emotionResult, setEmotionResult] = useState<EmotionResult>(
    new EmotionEngine().evaluate(initialEmotion),
  );
  const [error, setError] = useState("");
  const today = toLocalDateKey();
  const locked = trades.filter((trade) => trade.date === today).length >= settings.maxTradesPerDay;

  const risk = useMemo(() => {
    try {
      return new RiskEngine().calculate(
        settings.capital,
        settings.riskPercent,
        entryPrice,
        stopLossPrice,
      );
    } catch {
      return null;
    }
  }, [entryPrice, settings.capital, settings.riskPercent, stopLossPrice]);

  const handleEvaluation = useCallback((result: EmotionResult) => {
    setEmotionResult(result);
  }, []);

  if (locked) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <span className="inline-flex rounded-2xl bg-rose-400/10 p-4 text-rose-300">
          <LockKeyhole size={32} />
        </span>
        <h1 className="mt-6 text-3xl font-semibold text-white">Trading Locked.</h1>
        <p className="mt-3 text-zinc-400">Come back tomorrow.</p>
        <p className="mt-2 text-sm text-zinc-600">
          One trade is enough. More action does not create more edge.
        </p>
        <Link
          to="/journal"
          className="mt-7 inline-block rounded-xl border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300"
        >
          Review today’s trade
        </Link>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!symbol.trim()) {
      setError("Enter a trading symbol.");
      return;
    }
    if (emotionResult.status !== "SAFE") {
      setError(
        emotionResult.status === "COOLDOWN"
          ? "This setup requires a cooldown. Reset the emotional warnings before continuing."
          : "Trade denied by the emotion engine.",
      );
      return;
    }

    try {
      const engine = new RiskEngine();
      const calculation = engine.calculate(
        settings.capital,
        settings.riskPercent,
        entryPrice,
        stopLossPrice,
      );
      engine.validateQuantity(quantity, calculation);

      const validation = new TradeRules().validate(
        { quantity, entryPrice, stopLossPrice },
        trades,
        settings,
        calculation.maxQuantity,
        today,
      );
      if (!validation.valid) throw new Error(validation.errors.join(" "));

      addTrade({
        id: crypto.randomUUID(),
        date: today,
        symbol: symbol.trim().toUpperCase(),
        side,
        entryPrice,
        stopLossPrice,
        quantity,
        riskAmount: calculation.stopDistance * quantity,
        emotionStatus: emotionResult.status,
        followedRules: true,
        outcome: "OPEN",
        pnl: 0,
        notes,
        createdAt: new Date().toISOString(),
      });
      navigate("/journal");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save trade.");
    }
  };

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-white outline-none transition focus:border-lime-400/60";

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-white">New Trade</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Permission is earned by passing every rule—not by wanting the trade.
      </p>
      <form onSubmit={submit} className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <p className="text-sm font-medium text-white">Setup and risk</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-zinc-400">
              Symbol
              <input
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                placeholder="RELIANCE"
                className={fieldClass}
              />
            </label>
            <label className="text-sm text-zinc-400">
              Side
              <select
                value={side}
                onChange={(event) => setSide(event.target.value as TradeSide)}
                className={fieldClass}
              >
                <option value="LONG">Long</option>
                <option value="SHORT">Short</option>
              </select>
            </label>
            <label className="text-sm text-zinc-400">
              Entry price
              <input
                type="number"
                min="0"
                step="any"
                value={entryPrice || ""}
                onChange={(event) => setEntryPrice(Number(event.target.value))}
                className={fieldClass}
              />
            </label>
            <label className="text-sm text-zinc-400">
              Stop-loss price
              <input
                type="number"
                min="0"
                step="any"
                value={stopLossPrice || ""}
                onChange={(event) => setStopLossPrice(Number(event.target.value))}
                className={fieldClass}
              />
            </label>
            <label className="text-sm text-zinc-400">
              Quantity
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                className={fieldClass}
              />
            </label>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5">
              <p className="text-xs text-zinc-500">Maximum allowed</p>
              <p className="mt-1 text-lg font-semibold text-lime-300">
                {risk ? `${risk.maxQuantity} units` : "Enter valid prices"}
              </p>
              {risk && (
                <p className="text-xs text-zinc-600">
                  Risk budget {formatCurrency(risk.riskAmount)}
                </p>
              )}
            </div>
          </div>
          <label className="mt-4 block text-sm text-zinc-400">
            Setup notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Why does this trade belong in the playbook?"
              className={fieldClass}
            />
          </label>
        </Card>
        <EmotionEvaluation
          answers={emotion}
          onChange={setEmotion}
          onEvaluation={handleEvaluation}
        />
        <div className="xl:col-span-2">
          {error && (
            <p className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!risk || emotionResult.status !== "SAFE"}
            className="w-full rounded-xl bg-lime-400 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Pass rules and record trade
          </button>
        </div>
      </form>
    </div>
  );
}
