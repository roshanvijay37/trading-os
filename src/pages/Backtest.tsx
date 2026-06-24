import { useState } from "react";
import { Play, RotateCcw, TrendingUp, TrendingDown, Target, Shield, DollarSign, BarChart3, Activity, Clock, MessageSquare, Settings2 } from "lucide-react";
import { backtestApi } from "../services/api";

interface BacktestSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalReturn: number;
  totalPnL: number;
  maxDrawdown: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  finalCapital: number;
  maxConsecutiveLosses: number;
}

interface Trade {
  id: number;
  entryTime: string;
  exitTime: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
  barsHeld: number;
  capitalAfter: number;
}

interface EquityPoint {
  date: string;
  equity: number;
}

interface BacktestResult {
  success: boolean;
  symbol: string;
  resolution: string;
  fromDate: string;
  toDate: string;
  totalCandles: number;
  summary: BacktestSummary;
  trades: Trade[];
  equityCurve: EquityPoint[];
}

// Natural language parser (client-side)
function parseNaturalLanguage(text: string) {
  const t = text.toLowerCase();
  const config: Record<string, any> = {};

  // Symbol
  if (t.includes("bank nifty")) config.symbol = "NSE:NIFTYBANK-INDEX";
  else if (t.includes("nifty 50") || t.includes("nifty")) config.symbol = "NSE:NIFTY50-INDEX";
  else if (t.includes("fin nifty")) config.symbol = "NSE:FINNIFTY-INDEX";
  else if (t.includes("sensex")) config.symbol = "BSE:SENSEX";
  else config.symbol = "NSE:NIFTYBANK-INDEX";

  // Strategy
  if (t.includes("option buying") || t.includes("ce buy") || t.includes("pe buy")) config.strategy = "EMA5_OPTION";
  else if (t.includes("5 ema") || t.includes("ema 5") || t.includes("subhasish") || t.includes("pani")) config.strategy = "EMA5";
  else if (t.includes("traffic light") || t.includes("traffic")) config.strategy = "TRAFFIC_LIGHT";
  else if (t.includes("inside candle") || t.includes("mother candle")) config.strategy = "INSIDE_CANDLE";
  else config.strategy = "RSI";

  // Timeframe
  if (t.includes("1 min")) config.resolution = "1";
  else if (t.includes("5 min")) config.resolution = "5";
  else if (t.includes("15 min")) config.resolution = "15";
  else if (t.includes("30 min")) config.resolution = "30";
  else if (t.includes("1 hour") || t.includes("hourly")) config.resolution = "60";
  else if (t.includes("daily") || t.includes("day")) config.resolution = "D";
  else config.resolution = "5";

  // Dates
  const end = new Date().toISOString().split("T")[0];
  let days = 90;
  if (t.includes("1 year")) days = 365;
  else if (t.includes("2 year")) days = 730;
  else if (t.includes("6 month")) days = 180;
  else if (t.includes("3 month")) days = 90;
  else if (t.includes("1 month")) days = 30;
  const start = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  config.fromDate = start;
  config.toDate = end;

  // Capital
  const capMatch = text.match(/(\d+)\s*(?:lac|lakh)/i);
  config.capital = capMatch ? parseInt(capMatch[1]) * 100000 : 1000000;

  // Risk
  const riskMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*risk/i);
  config.riskPercent = riskMatch ? parseFloat(riskMatch[1]) : 1;

  // Stop loss
  const slMatch = text.match(/stop\s*loss\s+(\d+(?:\.\d+)?)\s*%/i);
  config.slBuffer = slMatch ? parseFloat(slMatch[1]) / 100 : 0.005;

  // RSI
  const rsiMatch = text.match(/rsi\s*(?:\()?(\d+)?(?:\))?\s*(?:<|below|under)\s*(\d+)/i);
  if (rsiMatch) {
    config.rsiPeriod = rsiMatch[1] ? parseInt(rsiMatch[1]) : 14;
    config.oversoldThreshold = parseInt(rsiMatch[2]);
  } else {
    config.rsiPeriod = 2;
    config.oversoldThreshold = 10;
  }

  const rsiExitMatch = text.match(/(?:sell|exit).*rsi\s*(?:>|above)\s*(\d+)/i);
  config.overboughtThreshold = rsiExitMatch ? parseInt(rsiExitMatch[1]) : 90;

  // Target / R:R
  let rrMatch = text.match(/(\d+(?:\.\d+)?)\s*[:\-]\s*(\d+(?:\.\d+)?)\s*(?:r[:\s]?r|risk\s*reward)/i);
  if (!rrMatch) {
    rrMatch = text.match(/risk[:\s]*reward\s*(?:ratio)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*[:\-]\s*(\d+(?:\.\d+)?)/i);
  }
  if (rrMatch) {
    config.targetMultiplier = parseFloat(rrMatch[2]) / parseFloat(rrMatch[1]);
  } else {
    config.targetMultiplier = 2;
  }

  return config;
}

export function Backtest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"manual" | "nlp">("manual");
  const [nlpText, setNlpText] = useState("");

  // Form state
  const [symbol, setSymbol] = useState("NSE:NIFTYBANK-INDEX");
  const [resolution, setResolution] = useState("5");
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1825);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [strategy, setStrategy] = useState<"RSI" | "EMA5" | "EMA5_OPTION" | "TRAFFIC_LIGHT" | "INSIDE_CANDLE" | "VWAP_REVERSAL" | "ORB" | "CPR_BREAKOUT" | "EMA9_20" | "FAILED_BREAKOUT" | "OPENING_MOMENTUM">("RSI");
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>(["EMA5"]);
  const [multiMode, setMultiMode] = useState(false);
  const [multiResult, setMultiResult] = useState<any>(null);
  const [rsiPeriod, setRsiPeriod] = useState(2);
  const [oversold, setOversold] = useState(10);
  const [overbought, setOverbought] = useState(90);
  const [capital, setCapital] = useState(1000000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [targetMult, setTargetMult] = useState(2);
  const [slippage, setSlippage] = useState(0.02);

  const symbols = [
    { value: "NSE:NIFTYBANK-INDEX", label: "Bank Nifty" },
    { value: "NSE:NIFTY50-INDEX", label: "Nifty 50" },
  ];

  const timeframes = [
    { value: "1", label: "1 Minute", maxDays: 1825 },
    { value: "5", label: "5 Minutes", maxDays: 1825 },
    { value: "15", label: "15 Minutes", maxDays: 1825 },
    { value: "30", label: "30 Minutes", maxDays: 1825 },
    { value: "60", label: "1 Hour", maxDays: 1825 },
    { value: "D", label: "Daily", maxDays: 1825 },
  ];

  const strategies = [
    { value: "RSI", label: "RSI 2-Period (Mean Reversion)" },
    { value: "EMA5", label: "5 EMA (Subhasish Pani)" },
    { value: "EMA5_OPTION", label: "5 EMA Option Buying (Subhasish Pani)" },
    { value: "TRAFFIC_LIGHT", label: "Traffic Light (Subhasish Pani)" },
    { value: "INSIDE_CANDLE", label: "Inside Candle Breakout" },
    { value: "VWAP_REVERSAL", label: "VWAP Reversal (Anant Ladha)" },
    { value: "ORB", label: "Opening Range Breakout" },
    { value: "CPR_BREAKOUT", label: "CPR Breakout (Vivek Bajaj)" },
    { value: "EMA9_20", label: "9/20 EMA Crossover" },
    { value: "FAILED_BREAKOUT", label: "Failed Breakout (Al Brooks)" },
    { value: "OPENING_MOMENTUM", label: "Opening Momentum" },
  ];

  const getMaxDays = (res: string) => timeframes.find((t) => t.value === res)?.maxDays || 90;

  const validateDateRange = () => {
    const maxDays = getMaxDays(resolution);
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > maxDays) {
      const newStart = new Date(end.getTime() - maxDays * 86400000);
      setFromDate(newStart.toISOString().split("T")[0]);
      return `FYERS limits ${timeframes.find((t) => t.value === resolution)?.label} data to ~${maxDays} days. Adjusted start date.`;
    }
    return null;
  };

  const runBacktest = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    setMultiResult(null);

    if (mode === "manual") {
      const warning = validateDateRange();
      if (warning) {
        setError(warning);
      }
    }

    try {
      let params: any;
      
      if (mode === "nlp") {
        if (!nlpText.trim()) {
          setError("Please type a strategy description");
          setLoading(false);
          return;
        }
        params = parseNaturalLanguage(nlpText);
      } else if (multiMode) {
        if (selectedStrategies.length === 0) {
          setError("Select at least one strategy");
          setLoading(false);
          return;
        }
        params = {
          symbol,
          resolution,
          fromDate,
          toDate,
          strategies: selectedStrategies,
          capital,
          riskPercent,
          targetMultiplier: targetMult,
        };
        const data = await backtestApi.runMulti({ ...params, slippage });
        setMultiResult(data);
        setLoading(false);
        return;
      } else {
        params = {
          symbol,
          resolution,
          fromDate,
          toDate,
          strategy,
          rsiPeriod,
          oversoldThreshold: oversold,
          overboughtThreshold: overbought,
          capital,
          riskPercent,
          targetMultiplier: targetMult,
          slippage,
        };
      }
      
      const data = await backtestApi.run(params);
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  const formatPercent = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

  const renderEquityCurve = () => {
    if (!result || result.equityCurve.length < 2) return null;

    const curve = result.equityCurve;
    const width = 800;
    const height = 250;
    const padding = 40;

    const equities = curve.map((p) => p.equity);
    const minE = Math.min(...equities);
    const maxE = Math.max(...equities);
    const range = maxE - minE || 1;

    const xScale = (i: number) => padding + (i / (curve.length - 1)) * (width - 2 * padding);
    const yScale = (v: number) => height - padding - ((v - minE) / range) * (height - 2 * padding);

    const pathD = curve
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(p.equity)}`)
      .join(" ");

    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <h3 className="mb-4 text-sm font-medium text-zinc-300">Equity Curve</h3>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 300 }}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = padding + t * (height - 2 * padding);
            return (
              <line
                key={t}
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="#27272a"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            );
          })}
          <path d={pathD} fill="none" stroke="#a3e635" strokeWidth={2} />
          <text x={padding} y={yScale(curve[0].equity) - 8} fill="#a3e635" fontSize={11}>
            {formatCurrency(curve[0].equity)}
          </text>
          <text
            x={width - padding}
            y={yScale(curve[curve.length - 1].equity) - 8}
            fill="#a3e635"
            fontSize={11}
            textAnchor="end"
          >
            {formatCurrency(curve[curve.length - 1].equity)}
          </text>
        </svg>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Backtest Strategy</h1>
        <p className="mt-1 text-sm text-zinc-500">Test RSI, 5 EMA, Option Buying, Traffic Light, or Inside Candle strategies</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setMode("manual")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition ${
            mode === "manual" 
              ? "bg-lime-400 text-zinc-950" 
              : "border border-zinc-700 text-zinc-400 hover:border-zinc-500"
          }`}
        >
          <Settings2 size={16} />
          Manual
        </button>
        <button
          onClick={() => setMode("nlp")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition ${
            mode === "nlp" 
              ? "bg-lime-400 text-zinc-950" 
              : "border border-zinc-700 text-zinc-400 hover:border-zinc-500"
          }`}
        >
          <MessageSquare size={16} />
          Natural Language
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        {mode === "nlp" ? (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-300">
                Describe Your Strategy
              </label>
              <textarea
                value={nlpText}
                onChange={(e) => setNlpText(e.target.value)}
                placeholder="Example: 5 EMA option buying on Bank Nifty 15 min, 1:3 risk reward, 10 lakh capital, last 3 months"
                className="h-32 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-lime-400 resize-none"
              />
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <p className="text-xs text-zinc-500">
                <strong className="text-zinc-400">Supported:</strong> RSI, 5 EMA, Option Buying, Traffic Light, Inside Candle, Stop Loss %, Risk:Reward, Capital (lakh), Timeframes (1m/5m/15m/1h/daily), Periods (1mo/3mo/6mo/1yr)
              </p>
              <p className="mt-1 text-xs text-amber-400">
                <strong>Tip:</strong> 1 Hour timeframe works best — FYERS provides up to 1 year of 1h data!
              </p>
            </div>
          </div>
        ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="col-span-2">
            <div className="flex items-center gap-3 mb-2">
              <label className="text-xs text-zinc-500">Strategy</label>
              <button
                onClick={() => setMultiMode(!multiMode)}
                className={`text-[10px] px-2 py-0.5 rounded transition ${
                  multiMode ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {multiMode ? "Multi ON" : "Multi"}
              </button>
            </div>
            {multiMode ? (
              <div className="grid grid-cols-2 gap-2">
                {strategies.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStrategies.includes(s.value)}
                      onChange={() => {
                        setSelectedStrategies(prev =>
                          prev.includes(s.value)
                            ? prev.filter(x => x !== s.value)
                            : [...prev, s.value]
                        );
                      }}
                      className="rounded border-zinc-600"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            ) : (
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as any)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
              >
                {strategies.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            >
              {symbols.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Timeframe</label>
            <select
              value={resolution}
              onChange={(e) => {
                const newRes = e.target.value;
                setResolution(newRes);
                // Auto-adjust fromDate to max available data for this timeframe
                const maxDays = timeframes.find((t) => t.value === newRes)?.maxDays || 90;
                const newFrom = new Date(Date.now() - maxDays * 86400000).toISOString().split("T")[0];
                setFromDate(newFrom);
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            >
              {timeframes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
          </div>

          {strategy === "RSI" && (
          <>
          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">RSI Period</label>
            <input
              type="number"
              value={rsiPeriod}
              onChange={(e) => setRsiPeriod(Number(e.target.value))}
              min={1}
              max={50}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Oversold (less than)</label>
            <input
              type="number"
              value={oversold}
              onChange={(e) => setOversold(Number(e.target.value))}
              min={1}
              max={50}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Overbought (greater than)</label>
            <input
              type="number"
              value={overbought}
              onChange={(e) => setOverbought(Number(e.target.value))}
              min={50}
              max={99}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
          </div>
          </>
          )}

          {strategy === "EMA5" && (
          <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-xs text-zinc-400">
              <strong className="text-lime-300">5 EMA Strategy (Subhasish Pani):</strong>
            </p>
            <ul className="mt-1 text-xs text-zinc-500 list-disc list-inside">
              <li>CE Buy: Candle closes completely BELOW 5 EMA → Break above Alert Candle high</li>
              <li>PE Buy: Candle closes completely ABOVE 5 EMA → Break below Alert Candle low</li>
              <li>SL = Alert Candle high/low | Target = 1:3 R:R minimum</li>
            </ul>
          </div>
          )}

          {strategy === "EMA5_OPTION" && (
          <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-xs text-zinc-400">
              <strong className="text-lime-300">5 EMA Option Buying (Subhasish Pani):</strong>
            </p>
            <ul className="mt-1 text-xs text-zinc-500 list-disc list-inside">
              <li>LONG (CE): 15-min trend bullish (price {'>'} 20 EMA) + Alert Candle below 5 EMA → Break high</li>
              <li>SHORT (PE): 5-min trend bearish (price {'<'} 20 EMA) + Alert Candle above 5 EMA → Break low</li>
              <li>Risk only 1% of capital | Trail stop using previous candle highs/lows</li>
            </ul>
          </div>
          )}

          {strategy === "TRAFFIC_LIGHT" && (
          <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-xs text-zinc-400">
              <strong className="text-lime-300">Traffic Light Strategy (Subhasish Pani):</strong>
            </p>
            <ul className="mt-1 text-xs text-zinc-500 list-disc list-inside">
              <li>Trend = 20 EMA vs 50 EMA direction</li>
              <li>Yellow Light: Pullback to 20 EMA</li>
              <li>Green Light: Momentum continuation (break prev candle high/low)</li>
              <li>Only trade WITH the trend</li>
            </ul>
          </div>
          )}

          {strategy === "INSIDE_CANDLE" && (
          <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-xs text-zinc-400">
              <strong className="text-lime-300">Inside Candle Breakout:</strong>
            </p>
            <ul className="mt-1 text-xs text-zinc-500 list-disc list-inside">
              <li>Identify Mother Candle and Inside Candle</li>
              <li>Buy above Inside Candle high</li>
              <li>SL below Inside Candle low</li>
            </ul>
          </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Capital (₹)</label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              min={10000}
              step={10000}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Risk % per Trade</label>
            <input
              type="number"
              value={riskPercent}
              onChange={(e) => setRiskPercent(Number(e.target.value))}
              min={0.1}
              max={10}
              step={0.1}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Target Multiplier (R:R)</label>
            <input
              type="number"
              value={targetMult}
              onChange={(e) => setTargetMult(Number(e.target.value))}
              min={1}
              max={5}
              step={0.5}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-zinc-500">Slippage (%)</label>
            <input
              type="number"
              value={slippage}
              onChange={(e) => setSlippage(Number(e.target.value))}
              min={0}
              max={1}
              step={0.01}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-lime-400"
            />
            <p className="mt-1 text-[10px] text-zinc-600">
              {slippage}% = ~{Math.round(50000 * slippage / 100)} pts on BANKNIFTY
            </p>
          </div>
        </div>
        )}
        <div className="mt-5 flex gap-3">
          <button
            onClick={runBacktest}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-lime-400 px-5 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
          >
            <Play size={16} />
            {loading ? "Running..." : "Run Backtest"}
          </button>
          {result && (
            <button
              onClick={() => setResult(null)}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-white"
            >
              <RotateCcw size={16} />
              Clear
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}
      </div>

      {multiResult && (
        <div className="space-y-6">
          <div className="rounded-xl border border-lime-500/30 bg-lime-500/5 p-5">
            <h3 className="mb-3 text-sm font-medium text-lime-300">
              Combined Results — {multiResult.strategies.join(", ")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 text-xs">
              <div className="rounded bg-zinc-900 p-2">
                <p className="text-zinc-500">Total Trades</p>
                <p className="font-bold text-white">{multiResult.combined.totalTrades}</p>
              </div>
              <div className="rounded bg-zinc-900 p-2">
                <p className="text-zinc-500">Win Rate</p>
                <p className="font-bold text-sky-400">{multiResult.combined.winRate.toFixed(1)}%</p>
              </div>
              <div className="rounded bg-zinc-900 p-2">
                <p className="text-zinc-500">Total P&L</p>
                <p className={`font-bold ${multiResult.combined.totalPnL >= 0 ? "text-lime-400" : "text-rose-400"}`}>
                  {formatCurrency(multiResult.combined.totalPnL)}
                </p>
              </div>
              <div className="rounded bg-zinc-900 p-2">
                <p className="text-zinc-500">Return</p>
                <p className={`font-bold ${multiResult.combined.totalReturn >= 0 ? "text-lime-400" : "text-rose-400"}`}>
                  {multiResult.combined.totalReturn.toFixed(2)}%
                </p>
              </div>
              <div className="rounded bg-zinc-900 p-2">
                <p className="text-zinc-500">Final Capital</p>
                <p className="font-bold text-white">{formatCurrency(multiResult.combined.finalCapital)}</p>
              </div>
            </div>
          </div>

          {multiResult.results.map((r: any) => (
            <div key={r.strategy} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <h4 className="text-sm font-medium text-zinc-300 mb-2">{r.strategy}</h4>
              <div className="grid gap-3 sm:grid-cols-4 text-xs">
                <div className="rounded bg-zinc-900 p-2">
                  <p className="text-zinc-500">Trades</p>
                  <p className="font-bold text-white">{r.summary.totalTrades}</p>
                </div>
                <div className="rounded bg-zinc-900 p-2">
                  <p className="text-zinc-500">Win Rate</p>
                  <p className="font-bold text-sky-400">{r.summary.winRate.toFixed(1)}%</p>
                </div>
                <div className="rounded bg-zinc-900 p-2">
                  <p className="text-zinc-500">P&L</p>
                  <p className={`font-bold ${r.summary.totalPnL >= 0 ? "text-lime-400" : "text-rose-400"}`}>
                    {formatCurrency(r.summary.totalPnL)}
                  </p>
                </div>
                <div className="rounded bg-zinc-900 p-2">
                  <p className="text-zinc-500">Profit Factor</p>
                  <p className="font-bold text-amber-400">{r.summary.profitFactor.toFixed(2)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<BarChart3 size={18} />}
              label="Total Return"
              value={formatPercent(result.summary.totalReturn)}
              color={result.summary.totalReturn >= 0 ? "lime" : "rose"}
            />
            <StatCard
              icon={<Target size={18} />}
              label="Win Rate"
              value={`${result.summary.winRate.toFixed(1)}%`}
              color="blue"
            />
            <StatCard
              icon={<TrendingUp size={18} />}
              label="Profit Factor"
              value={result.summary.profitFactor.toFixed(2)}
              color={result.summary.profitFactor >= 1 ? "lime" : "rose"}
            />
            <StatCard
              icon={<Shield size={18} />}
              label="Max Drawdown"
              value={`${result.summary.maxDrawdown.toFixed(2)}%`}
              color="rose"
            />
            <StatCard
              icon={<DollarSign size={18} />}
              label="Total P&L"
              value={formatCurrency(result.summary.totalPnL)}
              color={result.summary.totalPnL >= 0 ? "lime" : "rose"}
            />
            <StatCard
              icon={<Activity size={18} />}
              label="Total Trades"
              value={String(result.summary.totalTrades)}
              color="zinc"
            />
            <StatCard
              icon={<TrendingDown size={18} />}
              label="Avg Loss"
              value={formatCurrency(result.summary.avgLoss)}
              color="rose"
            />
            <StatCard
              icon={<Clock size={18} />}
              label="Max Consecutive Losses"
              value={String(result.summary.maxConsecutiveLosses)}
              color="orange"
            />
          </div>

          {renderEquityCurve()}

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-4 text-sm font-medium text-zinc-300">
              Trade Log ({result.trades.length} trades)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500">
                    <th className="pb-2 text-left">#</th>
                    <th className="pb-2 text-left">Side</th>
                    <th className="pb-2 text-right">Entry</th>
                    <th className="pb-2 text-right">Exit</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">P&L</th>
                    <th className="pb-2 text-right">%</th>
                    <th className="pb-2 text-center">Exit</th>
                    <th className="pb-2 text-right">Bars</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {result.trades.map((trade) => (
                    <tr key={trade.id} className="text-zinc-300">
                      <td className="py-2">{trade.id}</td>
                      <td className="py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            trade.side === "LONG"
                              ? "bg-lime-400/10 text-lime-300"
                              : "bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          {trade.side}
                        </span>
                      </td>
                      <td className="py-2 text-right">{trade.entryPrice.toFixed(2)}</td>
                      <td className="py-2 text-right">{trade.exitPrice.toFixed(2)}</td>
                      <td className="py-2 text-right">{trade.qty}</td>
                      <td
                        className={`py-2 text-right font-medium ${
                          trade.pnl >= 0 ? "text-lime-400" : "text-rose-400"
                        }`}
                      >
                        {trade.pnl >= 0 ? "+" : ""}
                        {trade.pnl.toFixed(0)}
                      </td>
                      <td
                        className={`py-2 text-right ${
                          trade.pnlPercent >= 0 ? "text-lime-400" : "text-rose-400"
                        }`}
                      >
                        {trade.pnlPercent.toFixed(2)}%
                      </td>
                      <td className="py-2 text-center">
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {trade.exitReason}
                        </span>
                      </td>
                      <td className="py-2 text-right text-zinc-500">{trade.barsHeld}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "lime" | "rose" | "blue" | "zinc" | "orange";
}) {
  const colorClasses = {
    lime: "text-lime-400 bg-lime-400/10 border-lime-400/20",
    rose: "text-rose-400 bg-rose-500/10 border-rose-500/20",
    blue: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    zinc: "text-zinc-400 bg-zinc-800 border-zinc-700",
    orange: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium opacity-70">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}