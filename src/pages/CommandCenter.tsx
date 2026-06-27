/**
 * TradingOS — Command Center
 * Merged Dashboard + AI CIO
 */

import { useState } from "react";
import { useInstitutionalStore } from "../store/InstitutionalProvider";
import {
  Brain,
  LayoutDashboard,
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  Zap,
  Bot,
  Send,
} from "lucide-react";
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

  const regimeColors: Record<string, { bg: string; text: string; border: string }> = {
    TRENDING_UP: { bg: "bg-gain-dim", text: "text-gain", border: "border-gain/20" },
    TRENDING_DOWN: { bg: "bg-loss-dim", text: "text-loss", border: "border-loss/20" },
    SIDEWAYS: { bg: "bg-warn-dim", text: "text-warn", border: "border-warn/20" },
    VOLATILE: { bg: "bg-info-dim", text: "text-info", border: "border-info/20" },
    LOW_VOLATILITY: { bg: "bg-info-dim", text: "text-info", border: "border-info/20" },
    GAP_DAY: { bg: "bg-warn-dim", text: "text-warn", border: "border-warn/20" },
    EXPIRY_DAY: { bg: "bg-info-dim", text: "text-info", border: "border-info/20" },
    EVENT_DAY: { bg: "bg-warn-dim", text: "text-warn", border: "border-warn/20" },
  };

  return (
    <div className="space-y-5">
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 rounded-panel border border-border bg-panel p-1 w-fit">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-2xs font-medium transition ${
            activeTab === "overview" ? "bg-surface text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <LayoutDashboard size={12} /> Overview
        </button>
        <button
          onClick={() => setActiveTab("ai-cio")}
          className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-2xs font-medium transition ${
            activeTab === "ai-cio" ? "bg-surface text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Brain size={12} /> AI CIO
        </button>
      </div>

      {activeTab === "overview" ? (
        <div className="space-y-5">
          {/* Metric Row */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Bot Status" value={dashboard.botStatus} icon={Bot} tone={dashboard.botStatus === "RUNNING" ? "green" : "amber"} />
            <MetricCard label="Portfolio P&L" value={`${dashboard.portfolioPnL >= 0 ? "+" : ""}${dashboard.portfolioPnL.toFixed(2)}%`} icon={dashboard.portfolioPnL >= 0 ? TrendingUp : TrendingDown} tone={dashboard.portfolioPnL >= 0 ? "green" : "rose"} />
            <MetricCard label="Today's Trades" value={dashboard.todaysTrades} icon={Activity} tone="blue" />
            <MetricCard label="Risk Status" value={dashboard.riskStatus} icon={Shield} tone={dashboard.riskStatus === "HEALTHY" ? "green" : dashboard.riskStatus === "WARNING" ? "amber" : "rose"} />
          </div>

          {/* Regime + Capital + Risk */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className={`rounded-panel border p-4 ${regimeColors[cioState.currentRegime]?.border || "border-border"} ${regimeColors[cioState.currentRegime]?.bg || "bg-panel"}`}>
              <p className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Market Regime</p>
              <p className={`mt-1 font-mono text-lg font-semibold ${regimeColors[cioState.currentRegime]?.text || "text-zinc-100"}`}>
                {cioState.currentRegime.replace("_", " ")}
              </p>
              <p className="mt-1 text-2xs text-zinc-500">Confidence: {(cioState.regimeConfidence * 100).toFixed(0)}%</p>
            </div>
            <div className="rounded-panel border border-border bg-panel p-4">
              <p className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Capital Used</p>
              <p className="mt-1 font-mono text-lg font-semibold text-zinc-100">{dashboard.capitalUsed.toFixed(1)}%</p>
              <div className="mt-2 h-1 rounded-full bg-surface">
                <div className="h-full rounded-full bg-gain" style={{ width: `${Math.min(dashboard.capitalUsed, 100)}%` }} />
              </div>
            </div>
            <div className="rounded-panel border border-border bg-panel p-4">
              <p className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Daily Risk Used</p>
              <p className="mt-1 font-mono text-lg font-semibold text-zinc-100">{portfolioRisk.dailyRiskUsed.toFixed(1)}%</p>
              <div className="mt-2 h-1 rounded-full bg-surface">
                <div className="h-full rounded-full bg-warn" style={{ width: `${Math.min(portfolioRisk.dailyRiskUsed, 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Health + Execution */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-panel border border-border bg-panel p-4">
              <div className="flex items-center gap-2">
                <Activity size={12} className="text-zinc-600" />
                <h3 className="text-2xs font-medium uppercase tracking-wider text-zinc-500">Health Score</h3>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-mono text-2xl font-semibold text-gain">{dashboard.healthScore}</span>
                <span className="mb-1 text-2xs text-zinc-600">/ 100</span>
              </div>
            </div>
            <div className="rounded-panel border border-border bg-panel p-4">
              <div className="flex items-center gap-2">
                <Zap size={12} className="text-zinc-600" />
                <h3 className="text-2xs font-medium uppercase tracking-wider text-zinc-500">Execution Score</h3>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-mono text-2xl font-semibold text-gain">{dashboard.executionScore}</span>
                <span className="mb-1 text-2xs text-zinc-600">/ 100</span>
              </div>
            </div>
          </div>

          {/* Active Recommendations */}
          {cioState.recommendations.filter((r: any) => !r.applied).length > 0 && (
            <div className="rounded-panel border border-border bg-panel p-4">
              <h3 className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">
                <AlertTriangle size={12} className="text-warn" /> Active AI Recommendations
              </h3>
              <div className="space-y-2">
                {cioState.recommendations.filter((r: any) => !r.applied).map((rec: any) => (
                  <div key={rec.id} className="flex items-center justify-between rounded border border-border-subtle bg-surface p-3">
                    <div>
                      <p className="text-2xs font-medium text-zinc-300">{rec.type.replace("_", " ")}</p>
                      <p className="text-2xs text-zinc-600">{rec.reason}</p>
                    </div>
                    <button onClick={() => applyCIORecommendation(rec.id)} className="rounded border border-gain/20 bg-gain-dim px-3 py-1 text-2xs font-medium text-gain hover:bg-gain/20 transition">Apply</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <div className={`rounded-panel border p-5 ${regimeColors[cioState.currentRegime]?.border || "border-border"} ${regimeColors[cioState.currentRegime]?.bg || "bg-panel"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xs font-medium uppercase tracking-wider text-zinc-600">Current Market Regime</p>
                  <p className={`mt-1 font-mono text-xl font-semibold ${regimeColors[cioState.currentRegime]?.text || "text-zinc-100"}`}>
                    {cioState.currentRegime.replace("_", " ")}
                  </p>
                  <p className="mt-1 text-2xs text-zinc-500">Confidence: {(cioState.regimeConfidence * 100).toFixed(0)}%</p>
                </div>
                <Brain size={32} className="text-zinc-700" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniCard label="Expected Return" value={`${(cioState.performanceForecast.expectedReturn * 100).toFixed(2)}%`} />
              <MiniCard label="Expected Volatility" value={`${(cioState.performanceForecast.expectedVolatility * 100).toFixed(2)}%`} />
              <MiniCard label="Win Probability" value={`${(cioState.performanceForecast.winProbability * 100).toFixed(0)}%`} />
            </div>
          </div>

          {/* Chat Panel */}
          <div className="flex flex-col rounded-panel border border-border bg-panel overflow-hidden h-[480px]">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
              <span className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-400">
                <Brain size={12} className="text-gain" /> Ask the CIO
              </span>
              {aiStatus?.configured && aiStatus.reachable ? (
                <span className="rounded bg-gain-dim px-1.5 py-0.5 text-2xs text-gain">Online</span>
              ) : (
                <span className="rounded bg-surface px-1.5 py-0.5 text-2xs text-zinc-600">Rule-based</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 && (
                <div className="space-y-2">
                  {["How did we perform today?", "Which strategy is performing best?", "What is the current risk level?"].map((q) => (
                    <button key={q} onClick={() => setInputValue(q)} className="w-full rounded border border-border-subtle bg-surface px-3 py-2 text-left text-2xs text-zinc-500 hover:border-border-hover transition">
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`text-2xs ${msg.role === "user" ? "text-right" : "text-left"}`}>
                  <span className={`inline-block rounded-panel px-3 py-2 ${msg.role === "user" ? "bg-surface text-zinc-300" : "border border-border-subtle bg-surface text-zinc-400"}`}>
                    {msg.content}
                  </span>
                  <p className="mt-0.5 text-2xs text-zinc-700">{msg.timestamp}</p>
                </div>
              ))}
              {isLoading && <p className="text-2xs text-zinc-600">Analyzing...</p>}
            </div>
            <div className="border-t border-border-subtle p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Ask the CIO..."
                  className="flex-1 rounded-panel border border-border-subtle bg-surface px-3 py-2 text-2xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-border-hover"
                />
                <button onClick={handleSend} disabled={isLoading || !inputValue.trim()} className="rounded-panel border border-gain/20 bg-gain-dim px-3 py-2 text-2xs font-medium text-gain disabled:opacity-30 transition hover:bg-gain/20">
                  <Send size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: React.ElementType; tone?: string }) {
  const tones: Record<string, string> = { green: "text-gain", rose: "text-loss", amber: "text-warn", blue: "text-info" };
  return (
    <div className="rounded-panel border border-border bg-panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon size={14} className="text-zinc-600" strokeWidth={1.5} />
        <span className="text-2xs font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      </div>
      <p className={`font-mono text-xl font-semibold ${tones[tone || ""] || "text-zinc-100"}`}>{value}</p>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel border border-border-subtle bg-surface p-3">
      <p className="text-2xs text-zinc-600">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-zinc-200">{value}</p>
    </div>
  );
}