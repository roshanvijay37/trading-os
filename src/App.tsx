import { Navigate, Route, Routes } from "react-router-dom";
import { InstitutionalProvider } from "./store/InstitutionalProvider";
import { Layout } from "./components/Layout";
import { AutoTrade } from "./pages/AutoTrade";
import { Dashboard } from "./pages/Dashboard";
import { Journal } from "./pages/Journal";
import { MarketMonitor } from "./pages/MarketMonitor";
import { Chart } from "./pages/Chart";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { Backtest } from "./pages/Backtest";
import { VisualBacktest } from "./pages/VisualBacktest";
import { StrategyManager } from "./pages/StrategyManager";
import { RiskDashboard } from "./pages/RiskDashboard";
import { AICIO } from "./pages/AICIO";
import { MarketIntelligencePage } from "./pages/MarketIntelligence";

export default function App() {
  return (
    <InstitutionalProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/market-monitor" element={<MarketMonitor />} />
          <Route path="/chart" element={<Chart />} />
          <Route path="/trading-bot" element={<AutoTrade />} />
          <Route path="/strategy-manager" element={<StrategyManager />} />
          <Route path="/risk-dashboard" element={<RiskDashboard />} />
          <Route path="/ai-cio" element={<AICIO />} />
          <Route path="/market-intelligence" element={<MarketIntelligencePage />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/visual-backtest" element={<VisualBacktest />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </InstitutionalProvider>
  );
}
