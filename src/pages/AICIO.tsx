/**
 * TradingOS — AI Chief Investment Officer
 * Market regime detection and automated portfolio adjustments
 * With Kimi AI (Moonshot) natural language integration
 */

import { useState, useEffect, useRef } from "react";
import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { Brain, TrendingUp, TrendingDown, Minus, CheckCircle, Send, Bot, User, AlertCircle, Sparkles } from "lucide-react";
import { queryCIO, getAIStatus, type AIStatusResponse } from "../services/aiCio";

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: string;
  error?: boolean;
}

export function AICIO() {
  const { state, applyCIORecommendation } = useInstitutionalStore();
  const { cioState, dashboard, portfolioRisk, strategyStates } = state;

  const [aiStatus, setAiStatus] = useState<AIStatusResponse | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Check AI status on mount
  useEffect(() => {
    getAIStatus().then(setAiStatus).catch(() => setAiStatus({
      configured: false,
      message: "Unable to check AI status",
    }));
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const regimeColors: Record<string, string> = {
    TRENDING_UP: "bg-lime-400/10 text-lime-300",
    TRENDING_DOWN: "bg-rose-400/10 text-rose-300",
    SIDEWAYS: "bg-amber-400/10 text-amber-300",
    VOLATILE: "bg-purple-400/10 text-purple-300",
    LOW_VOLATILITY: "bg-blue-400/10 text-blue-300",
    GAP_DAY: "bg-orange-400/10 text-orange-300",
    EXPIRY_DAY: "bg-cyan-400/10 text-cyan-300",
    EVENT_DAY: "bg-pink-400/10 text-pink-300",
  };

  async function handleSend() {
    if (!inputValue.trim() || isLoading) return;

    const question = inputValue.trim();
    setInputValue("");
    setIsLoading(true);

    // Add user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: question,
      timestamp: new Date().toLocaleTimeString(),
    };
    setChatMessages((prev) => [...prev, userMsg]);

    try {
      // Build context from current state
      const context = {
        regime: cioState.currentRegime,
        regimeConfidence: cioState.regimeConfidence,
        portfolioPnL: dashboard.portfolioPnL,
        capitalUsed: dashboard.capitalUsed,
        capitalTotal: dashboard.capitalTotal,
        riskStatus: dashboard.riskStatus,
        totalExposure: portfolioRisk.totalExposure,
        portfolioDrawdown: portfolioRisk.portfolioDrawdown,
        dailyRiskUsed: portfolioRisk.dailyRiskUsed,
        var95: portfolioRisk.var95,
        activeStrategies: Object.values(strategyStates).filter((s) => s.config.enabled).length,
        runningStrategies: Object.values(strategyStates).filter((s) => s.isRunning).length,
        todaysTrades: dashboard.todaysTrades,
        marketContext: cioState.marketContext,
      };

      const response = await queryCIO({ question, context });

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "ai",
        content: response.success ? response.answer : (response.fallback || response.error || "No response"),
        timestamp: new Date().toLocaleTimeString(),
        error: !response.success,
      };
      setChatMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "ai",
        content: "AI service unavailable. The rule-based CIO is still active and supervising all strategies.",
        timestamp: new Date().toLocaleTimeString(),
        error: true,
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">AI Chief Investment Officer</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Autonomous market regime detection and portfolio supervision.
          {aiStatus?.configured && aiStatus.reachable && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-lime-400/10 px-2 py-0.5 text-[10px] text-lime-300">
              <Sparkles size={10} /> Kimi AI Active
            </span>
          )}
        </p>
      </div>

      {/* AI Status Banner */}
      {aiStatus && !aiStatus.configured && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
          <AlertCircle size={18} className="text-amber-300" />
          <div>
            <p className="text-sm font-medium text-amber-300">Kimi AI Not Configured</p>
            <p className="text-xs text-amber-400/70">
              Add KIMI_API_KEY to server/.env to enable natural language queries. Rule-based CIO is still active.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Left Column — Regime & Context */}
        <div className="space-y-6">
          {/* Current Regime */}
          <div className={`rounded-xl border p-6 ${regimeColors[cioState.currentRegime] || "bg-zinc-800"}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs opacity-70">Current Market Regime</p>
                <p className="mt-1 text-2xl font-semibold">{cioState.currentRegime.replace("_", " ")}</p>
                <p className="mt-1 text-xs opacity-70">Confidence: {(cioState.regimeConfidence * 100).toFixed(0)}%</p>
              </div>
              <Brain size={40} className="opacity-30" />
            </div>
          </div>

          {/* Market Context */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ContextCard label="VIX Level" value={cioState.marketContext.vixLevel.toFixed(2)} trend={cioState.marketContext.vixTrend} />
            <ContextCard label="PCR Trend" value={cioState.marketContext.pcrTrend} />
            <ContextCard label="OI Buildup" value={cioState.marketContext.oiBuildup} />
            <ContextCard label="A/D Ratio" value={cioState.marketContext.advanceDeclineRatio.toFixed(2)} />
          </div>

          {/* Performance Forecast */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
            <h3 className="mb-4 text-sm font-medium text-white">Performance Forecast</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <ForecastItem label="Expected Return" value={`${(cioState.performanceForecast.expectedReturn * 100).toFixed(2)}%`} />
              <ForecastItem label="Expected Volatility" value={`${(cioState.performanceForecast.expectedVolatility * 100).toFixed(2)}%`} />
              <ForecastItem label="Win Probability" value={`${(cioState.performanceForecast.winProbability * 100).toFixed(0)}%`} />
            </div>
          </div>

          {/* Active Recommendations */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
            <h3 className="mb-4 text-sm font-medium text-white">AI Recommendations</h3>
            {cioState.recommendations.length === 0 ? (
              <p className="text-xs text-zinc-600">No active recommendations. Market conditions are stable.</p>
            ) : (
              <div className="space-y-2">
                {cioState.recommendations.filter((r: { applied: boolean }) => !r.applied).map((rec: { id: string; type: string; reason: string; urgency: string; targetValue: number }) => (
                  <div key={rec.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div>
                      <p className="text-xs font-medium text-white">{rec.type.replace("_", " ")}</p>
                      <p className="text-xs text-zinc-500">{rec.reason}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                        rec.urgency === "CRITICAL" ? "bg-rose-400/10 text-rose-300" :
                        rec.urgency === "HIGH" ? "bg-orange-400/10 text-orange-300" :
                        rec.urgency === "MEDIUM" ? "bg-amber-400/10 text-amber-300" :
                        "bg-zinc-800 text-zinc-500"
                      }`}>{rec.urgency}</span>
                      <button onClick={() => applyCIORecommendation(rec.id)} className="rounded p-1 text-lime-400 hover:bg-lime-400/10">
                        <CheckCircle size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Adjustments */}
          {cioState.activeAdjustments.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <h3 className="mb-4 text-sm font-medium text-white">Applied Adjustments</h3>
              <div className="space-y-2">
                {cioState.activeAdjustments.map((adj: { id: string; type: string; oldValue: number; newValue: number; reason: string }) => (
                  <div key={adj.id} className="flex items-center justify-between rounded-lg bg-zinc-900/50 p-3">
                    <div>
                      <p className="text-xs font-medium text-white">{adj.type}</p>
                      <p className="text-xs text-zinc-500">{adj.reason}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-zinc-500">{adj.oldValue.toFixed(2)} → <span className="text-lime-300">{adj.newValue.toFixed(2)}</span></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column — Chat Interface */}
        <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-lime-400" />
              <span className="text-sm font-medium text-white">Ask the CIO</span>
            </div>
            {aiStatus?.configured && aiStatus.reachable ? (
              <span className="rounded bg-lime-400/10 px-2 py-0.5 text-[10px] text-lime-300">Online</span>
            ) : (
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">Rule-based</span>
            )}
          </div>

          {/* Chat Messages */}
          <div className="flex-1 min-h-[300px] max-h-[500px] overflow-y-auto p-4 space-y-4">
            {chatMessages.length === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-600 text-center">Ask the AI CIO about your portfolio</p>
                <div className="space-y-2">
                  {[
                    "How did we perform today?",
                    "Why is the portfolio exposed?",
                    "Which strategy is performing best?",
                    "What is the current risk level?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setInputValue(q);
                      }}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-300"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatMessages.map((msg) => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "ai" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lime-400/10">
                    <Bot size={12} className={msg.error ? "text-rose-400" : "text-lime-400"} />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  msg.role === "user"
                    ? "bg-zinc-800 text-zinc-200"
                    : msg.error
                    ? "border border-rose-400/20 bg-rose-400/5 text-rose-300"
                    : "border border-zinc-800 bg-zinc-900/50 text-zinc-300"
                }`}>
                  <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  <p className="mt-1 text-[9px] text-zinc-600">{msg.timestamp}</p>
                </div>
                {msg.role === "user" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                    <User size={12} className="text-zinc-400" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-lime-400/10">
                  <Bot size={12} className="text-lime-400 animate-pulse" />
                </div>
                <span>Analyzing...</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={aiStatus?.configured ? "Ask the CIO..." : "Kimi AI not configured — rule-based mode"}
                disabled={isLoading}
                className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-lime-400/30"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !inputValue.trim()}
                className="rounded-lg bg-lime-400/10 p-2 text-lime-400 transition hover:bg-lime-400/20 disabled:opacity-30"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextCard({ label, value, trend }: { label: string; value: string; trend?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-lg font-mono font-semibold text-white">{value}</p>
        {trend && (
          trend === "RISING" ? <TrendingUp size={14} className="text-lime-400" /> :
          trend === "FALLING" ? <TrendingDown size={14} className="text-rose-400" /> :
          <Minus size={14} className="text-zinc-500" />
        )}
      </div>
    </div>
  );
}

function ForecastItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900/50 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">{value}</p>
    </div>
  );
}