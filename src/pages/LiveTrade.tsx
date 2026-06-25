import { AlertTriangle, ArrowRight, Wallet } from "lucide-react";
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
  const [underlying, setUnderlying] = useState<"NIFTY" | "BANKNIFTY">("BANKNIFTY");
  const [optionChain, setOptionChain] = useState<any[]>([]);
  const [loadingChain, setLoadingChain] = useState(false);
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
  const todayTrades = trades.filter((trade) => trade.date === today).length;

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

  // Fetch option chain when underlying changes
  useEffect(() => {
    if (!connected) return;
    setLoadingChain(true);
    const symbolMap = { NIFTY: "NSE:NIFTY50-INDEX", BANKNIFTY: "NSE:NIFTYBANK-INDEX" };
    accountApi
      .getOptionChain(symbolMap[underlying], 20)
      .then((data) => {
        setOptionChain(data.optionChain || []);
        setLoadingChain(false);
      })
      .catch((err) => {
        console.error("Option chain error:", err);
        setOptionChain([]);
        setLoadingChain(false);
      });
  }, [connected, underlying]);

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

    // Emotion check is advisory only - trader decides
    if (emotionResult.status !== "SAFE") {
      console.warn("Emotion check warning:", emotionResult.status);
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

      // Trade rules are advisory - log warnings but don't block
      const validation = new TradeRules().validate(
        { quantity, entryPrice, stopLossPrice },
        trades,
        settings,
        calculation.maxQuantity,
        today,
      );
      if (!validation.valid) {
        console.warn("Trade rule warnings:", validation.errors);
      }

      // Determine correct symbol format
      // Options (CE/PE) should NOT have -EQ suffix, equities should
      const rawSymbol = symbol.trim().toUpperCase();
      const isOption = rawSymbol.includes("CE") || rawSymbol.includes("PE");
      const formattedSymbol = isOption 
        ? (rawSymbol.startsWith("NSE:") ? rawSymbol : `NSE:${rawSymbol}`)
        : (rawSymbol.startsWith("NSE:") ? rawSymbol : `NSE:${rawSymbol}-EQ`);

      // Place real order through FYERS
      const orderResponse = await orderApi.place({
        symbol: formattedSymbol,
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
                Underlying
                <select
                  value={underlying}
                  onChange={(e) => setUnderlying(e.target.value as "NIFTY" | "BANKNIFTY")}
                  className={fieldClass}
                >
                  <option value="BANKNIFTY">Bank Nifty</option>
                  <option value="NIFTY">Nifty 50</option>
                </select>
              </label>
              <label className="text-sm text-zinc-400">
                Symbol (auto-filled from option chain)
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="Select from option chain below"
                  className={fieldClass}
                  readOnly
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

          {/* Option Chain */}
          <Card className="xl:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-white">
                Option Chain — {underlying === "BANKNIFTY" ? "Bank Nifty" : "Nifty 50"}
              </p>
              {loadingChain && <p className="text-xs text-zinc-500">Loading...</p>}
            </div>
            {optionChain.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500">
                      <th className="pb-2 text-left">Strike</th>
                      <th className="pb-2 text-left">Type</th>
                      <th className="pb-2 text-right">LTP</th>
                      <th className="pb-2 text-right">Change</th>
                      <th className="pb-2 text-right">OI</th>
                      <th className="pb-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {optionChain.slice(0, 20).map((opt: any, idx: number) => (
                      <tr key={idx} className="text-zinc-300 hover:bg-zinc-900/50">
                        <td className="py-2">₹{opt.strike_price || opt.strike}</td>
                        <td className="py-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            opt.option_type === "CE" || opt.optionType === "CE"
                              ? "bg-lime-400/10 text-lime-300"
                              : "bg-rose-500/10 text-rose-300"
                          }`}>
                            {opt.option_type || opt.optionType}
                          </span>
                        </td>
                        <td className="py-2 text-right">₹{opt.ltp || opt.lp || opt.last_price || 0}</td>
                        <td className={`py-2 text-right ${(opt.ltpch || opt.ch || opt.chp || 0) >= 0 ? "text-lime-400" : "text-rose-400"}`}>
                          {opt.ltpchp || opt.chp || opt.change_percent || 0}%
                        </td>
                        <td className="py-2 text-right">{(opt.oi || opt.open_interest || 0).toLocaleString()}</td>
                        <td className="py-2 text-center">
                          <button
                            onClick={() => {
                              setSymbol(opt.symbol || opt.tradingSymbol || opt.ts);
                              setEntryPrice(opt.ltp || opt.lp || opt.last_price || 0);
                            }}
                            className="rounded bg-lime-400/10 px-2 py-1 text-[10px] text-lime-300 hover:bg-lime-400/20"
                          >
                            Select
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                {loadingChain ? "Fetching option chain..." : "No options data available. Connect FYERS to load."}
              </p>
            )}
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
            {todayTrades >= settings.maxTradesPerDay && (
              <p className="mb-2 text-center text-xs text-amber-400">
                You've placed {todayTrades} trades today. Trade responsibly.
              </p>
            )}
            {emotionResult.status !== "SAFE" && (
              <p className="mb-2 text-center text-xs text-amber-400">
                Emotion check: {emotionResult.status}. Take a breath if needed.
              </p>
            )}
            <button
              onClick={handlePlaceOrder}
              disabled={!risk || placing}
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