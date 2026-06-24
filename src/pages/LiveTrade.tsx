import { AlertTriangle, ArrowRight, LockKeyhole, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/Card";
import { EmotionEvaluation } from "../components/EmotionEvaluation";
import { accountApi, isFyersConnected, orderApi } from "../services/api";
import { EmotionEngine } from "../rules/EmotionEngine";
import { RiskEngine } from "../rules/RiskEngine";
import { TradeRules } from "../rules/TradeRules";
import { useTradingStore } from "../store/useTradingStore";
import type { EmotionAnswers, EmotionEvaluation as EmotionResult } from "../types";
import { toLocalDateKey } from "../utils/date";
import { formatCurrency } from "../utils/format";

const initialEmotion: EmotionAnswers = {
  greedScore: 1,
  recoveringLosses: false,
  missedPreviousMove: false,
  increasingLotSize: false,
};

export function LiveTrade() {
  const { settings, trades, addTrade } = useTradingStore();
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const [funds, setFunds] = useState<any>(null);
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [entryPrice, setEntryPrice] = useState(0);
  const [stopLossPrice, setStopLossPrice] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [emotion, setEmotion] = useState(initialEmotion);
  const [emotionResult, setEmotionResult] = useState<EmotionResult>(
    new EmotionEngine().evaluate(initialEmotion),
  );
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<any>(null);

  const today = toLocalDateKey();
  const locked = trades.filter((trade) => trade.date === today).length >= settings.maxTradesPerDay;

  // Check FYERS connection
  useEffect(() => {
    setConnected(isFyersConnected());
    const handle = () => setConnected(isFyersConnected());
    window.addEventListener("fyers:logout", handle);
    return () => window.removeEventListener("fyers:logout", handle);
  }, []);

  // Fetch funds when connected
  useEffect(() => {
    if (connected) {
      accountApi
        .getFunds()
        .then((data) => setFunds(data.funds))
        .catch(() => setFunds(null));
    }
  }, [connected]);

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

  const handleEvaluation = (result: EmotionResult) => {
    setEmotionResult(result);
  };

  const handlePlaceOrder = async () => {
    setError("");
    setPlacing(true);

    if (!symbol.trim()) {
      setError("Enter a trading symbol.");
      setPlacing(false);
      return;
    }

    if (emotionResult.status !== "SAFE") {
      setError(
        emotionResult.status === "COOLDOWN"
          ? "This setup requires a cooldown. Reset the emotional warnings before continuing."
          : "Trade denied by the emotion engine.",
      );
      setPlacing(false);
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

      // Place real order through FYERS
      const orderResponse = await orderApi.place({
        symbol: `NSE:${symbol.trim().toUpperCase()}-EQ`,
        side: side === "LONG" ? 1 : -1,
        qty: quantity,
        type: 2, // Market order
        productType: "INTRADAY",
      });

      setPlacedOrder(orderResponse);

      // Also record in journal
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
        notes: `[FYERS ORDER #${orderResponse.orderId}] ${notes}`,
        createdAt: new Date().toISOString(),
      });
    } catch (caught: any) {
      setError(caught instanceof Error ? caught.message : caught.error || "Unable to place order.");
    } finally {
      setPlacing(false);
    }
  };

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-white outline-none transition focus:border-lime-400/60";

  if (!connected) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <span className="inline-flex rounded-2xl bg-zinc-800 p-4 text-zinc-400">
          <Wallet size={32} />
        </span>
        <h1 className="mt-6 text-3xl font-semibold text-white">Connect FYERS</h1>
        <p className="mt-3 text-zinc-400">
          Link your FYERS account to place live trades through TradingOS.
        </p>
        <p className="mt-2 text-sm text-zinc-600">
          All discipline checks still apply. Real money is at risk.
        </p>
      </div>
    );
  }

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
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Live Trade</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Place real orders through FYERS after passing all discipline checks.
          </p>
        </div>
        {funds && funds[0] && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-right">
            <p className="text-xs text-zinc-500">Available margin</p>
            <p className="text-lg font-semibold text-lime-300">
              {formatCurrency(funds[0].equityAmount || 0)}
            </p>
          </div>
        )}
      </div>

      {placedOrder && (
        <div className="mt-6 rounded-xl border border-lime-400/20 bg-lime-400/10 p-4">
          <p className="text-sm font-medium text-lime-300">
            Order placed successfully!
          </p>
          <p className="mt-1 text-xs text-lime-400/70">
            Order ID: {placedOrder.orderId} | Status: {placedOrder.status}
          </p>
          <button
            onClick={() => {
              setPlacedOrder(null);
              setSymbol("");
              setEntryPrice(0);
              setStopLossPrice(0);
              setQuantity(1);
              setNotes("");
              setEmotion(initialEmotion);
              setEmotionResult(new EmotionEngine().evaluate(initialEmotion));
            }}
            className="mt-3 text-xs text-lime-300 underline"
          >
            Place another trade
          </button>
        </div>
      )}

      {!placedOrder && (
        <div className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" />
              <p className="text-sm font-medium text-white">Live order — real money at risk</p>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-zinc-400">
                Symbol
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="RELIANCE"
                  className={fieldClass}
                />
              </label>
              <label className="text-sm text-zinc-400">
                Side
                <select
                  value={side}
                  onChange={(e) => setSide(e.target.value as "LONG" | "SHORT")}
                  className={fieldClass}
                >
                  <option value="LONG">Long (Buy)</option>
                  <option value="SHORT">Short (Sell)</option>
                </select>
              </label>
              <label className="text-sm text-zinc-400">
                Entry price
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={entryPrice || ""}
                  onChange={(e) => setEntryPrice(Number(e.target.value))}
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
                  onChange={(e) => setStopLossPrice(Number(e.target.value))}
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
                  onChange={(e) => setQuantity(Number(e.target.value))}
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
                onChange={(e) => setNotes(e.target.value)}
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
              onClick={handlePlaceOrder}
              disabled={!risk || emotionResult.status !== "SAFE" || placing}
              className="w-full rounded-xl bg-amber-400 px-5 py-3 font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {placing ? (
                "Placing order…"
              ) : (
                <>
                  Place live order on FYERS <ArrowRight size={17} className="ml-1 inline" />
                </>
              )}
            </button>
            <p className="mt-2 text-center text-xs text-zinc-600">
              All TradingOS discipline checks must pass before a live order is sent.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}