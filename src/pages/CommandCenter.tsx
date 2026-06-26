/**
 * TradingOS — Command Center
 * Merged Dashboard + AI CIO
 */

import { useState } from "react";
import { useInstitutionalStore } from "../store/InstitutionalProvider";
import { Brain, LayoutDashboard, Activity, TrendingUp, TrendingDown, AlertTriangle, Shield, Zap, Bot, Clock, DollarSign, BarChart3, Users } from "lucide-react";
import { queryCIO, getAIStatus, type AIStatusResponse } from "../services/aiCio";

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: string;
  error?: boolean;
}

export function CommandCenter() {
  const { state, applyCIORecommendation } = useInstitutionalStore();
  const { dashboard, portfolioRisk, cioState, strategyStates } = state;

  const [aiStatus, setAiStatus] = useState<AIStatusResponse | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "ai-cio">("overview");

  // Check AI status
  useState(() => {
    getAIStatus().then(setAiStatus).catch(() => setAiStatus({
      configured: false,
      message: "Unable to check AI status",
    }));
  });

  async function handleSend() {
    if (!inputValue.trim() || isLoading) return;
    const question = inputValue.trim();
    setInputValue("");
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: question,
      timestamp: new Date().toLocaleTimeString(),
    };
    setChatMessages((prev) => [...prev, userMsg]);

    try {
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
        activeStrategies: Object.values(strategyStates).filter((s) => (s as any).config.enabled).length,
        runningStrategies: Object.values(strategyStates).filter((s) => (s as any).isRunning).length,
        todaysTrades: dashboard.todaysTrades,
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
    } catch {
      const errorMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "ai",
        content: "AI service unavailable. Rule-based CIO is active.",
        timestamp: new Date().toLocaleTimeString(),
        error: true,
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Command Center</h1>
          <p className="mt-2 text-sm text-zinc-500">Portfolio supervision and AI intelligence</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition ${
              activeTab === "overview" ? "bg-lime-400/10 text-lime-300" : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            <LayoutDashboard size={14} /> Overview
          </button>
          <button
            onClick={() => setActiveTab("ai-cio")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition ${
              activeTab === "ai-cio" ? "bg-lime-400/10 text-lime-300" : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            <Brain size={14} /> AI CIO
          </button>
        </div>
      </div>

      {activeTab === "overview" ? (
        /* OVERVIEW TAB */
        <div className="space-y-6">
          {/* Status Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Bot Status" value={dashboard.botStatus} icon={Bot} color={dashboard.botStatus === "RUNNING" ? "lime" : "amber"} />
            <MetricCard label="Portfolio P&L" value={`${dashboard.portfolioPnL >= 0 ? "+" : ""}${dashboard.portfolioPnL.toFixed(2)}%`} icon={dashboard.portfolioPnL >= 0 ? TrendingUp : TrendingDown} color={dashboard.portfolioPnL >= 0 ? "lime" : "rose"} />
            <MetricCard label="Today's Trades" value={dashboard.todaysTrades} icon={Activity} color="blue" />
            <MetricCard label="Risk Status" value={dashboard.riskStatus} icon={Shield} color={dashboard.riskStatus === "NORMAL" ? "lime" : dashboard.riskStatus === "WARNING" ? "amber" : "rose"} />
          </div>

          {/* Regime + Capital */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className={`rounded-xl border p-4 ${regimeColors[cioState.currentRegime] || "bg-zinc-800"}`}>
              <p className="text-xs opacity-70">Market Regime</p>
              <p className="mt-1 text-xl font-semibold">{cioState.currentRegime.replace("_", " ")}</p>
              <p className="mt-1 text-xs opacity-70">Confidence: {(cioState.regimeConfidence * 100).toFixed(0)}%</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-xs text-zinc-500">Capital Used</p>
              <p className="mt-1 font-mono text-xl font-semibold text-white">{dashboard.capitalUsed.toFixed(1)}%</p>
              <div className="mt-2 h-1.5 rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-lime-400" style={{ width: `${Math.min(dashboard.capitalUsed, 100)}%` }} />
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-xs text-zinc-500">Daily Risk Used</p>
              <p className="mt-1 font-mono text-xl font-semibold text-white">{portfolioRisk.dailyRiskUsed.toFixed(1)}%</p>
              <div className="mt-2 h-1.5 rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(portfolioRisk.dailyRiskUsed, 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Health + Exposure */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-zinc-500" />
                <h3 className="text-sm font-medium text-white">Health Score</h3>
              </div>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-3xl font-semibold text-lime-300">{dashboard.healthScore}</span>
                <span className="mb-1 text-xs text-zinc-500">/ 100</span>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-zinc-500" />
                <h3 className="text-sm font-medium text-white">Execution Score</h3>
              </div>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-3xl font-semibold text-lime-300">{dashboard.executionScore}</span>
                <span className="mb-1 text-xs text-zinc-500">/ 100</span>
              </div>
            </div>
          </div>

          {/* Active Recommendations */}
          {cioState.recommendations.filter((r: any) => !r.applied).length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <h3 className="mb-3 text-sm font-medium text-white flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400" /> Active AI Recommendations
              </h3>
              <div className="space-y-2">
                {cioState.recommendations.filter((r: any) => !r.applied).map((rec: any) => (
                  <div key={rec.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <div>
                      <p className="text-xs font-medium text-white">{rec.type.replace("_", " ")}</p>
                      <p className="text-xs text-zinc-500">{rec.reason}</p>
                    </div>
                    <button onClick={() => applyCIORecommendation(rec.id)} className="rounded bg-lime-400/10 px-3 py-1 text-xs text-lime-300">Apply</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* AI CIO TAB */
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
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
            <div className="grid gap-4 sm:grid-cols-3">
              <MiniCard label="Expected Return" value={`${(cioState.performanceForecast.expectedReturn * 100).toFixed(2)}%`} />
              <MiniCard label="Expected Volatility" value={`${(cioState.performanceForecast.expectedVolatility * 100).toFixed(2)}%`} />
              <MiniCard label="Win Probability" value={`${(cioState.performanceForecast.winProbability * 100).toFixed(0)}%`} />
            </div>
          </div>

          {/* Chat */}
          <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/50 overflow-hidden h-[500px]">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <span className="text-sm font-medium text-white flex items-center gap-2"><Brain size={14} className="text-lime-400" /> Ask the CIO</span>
              {aiStatus?.configured && aiStatus.reachable ? (
                <span className="rounded bg-lime-400/10 px-2 py-0.5 text-[10px] text-lime-300">Online</span>
              ) : (
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">Rule-based</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 && (
                <div className="space-y-2">
                  {["How did we perform today?", "Which strategy is performing best?", "What is the current risk level?"].map((q) => (
                    <button key={q} onClick={() => setInputValue(q)} className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left text-xs text-zinc-400 hover:border-zinc-700">
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`text-xs ${msg.role === "user" ? "text-right" : "text-left"}`}>
                  <span className={`inline-block rounded-lg px-3 py-2 ${msg.role === "user" ? "bg-zinc-800 text-zinc-300" : "border border-zinc-800 bg-zinc-900/50 text-zinc-400"}`}>
                    {msg.content}
                  </span>
                  <p className="mt-0.5 text-[9px] text-zinc-600">{msg.timestamp}</p>
                </div>
              ))}
              {isLoading && <p className="text-xs text-zinc-600">Analyzing...</p>}
            </div>
            <div className="border-t border-zinc-800 p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Ask the CIO..."
                  className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white outline-none placeholder:text-zinc-600"
                />
                <button onClick={handleSend} disabled={isLoading || !inputValue.trim()} className="rounded-lg bg-lime-400/10 px-3 py-2 text-xs text-lime-400 disabled:opacity-30">Send</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  const colors: Record<string, string> = { lime: "text-lime-300", rose: "text-rose-300", amber: "text-amber-300", blue: "text-blue-300" };
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-zinc-500" />
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <p className={`font-mono text-2xl font-semibold ${colors[color] || "text-white"}`}>{value}</p>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900/50 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">{value}</p>
    </div>
  );
}