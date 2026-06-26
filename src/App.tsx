import { Navigate, Route, Routes } from "react-router-dom";
import { InstitutionalProvider } from "./store/InstitutionalProvider";
import { Layout } from "./components/Layout";
import { AutoTrade } from "./pages/AutoTrade";
import { CommandCenter } from "./pages/CommandCenter";
import { Journal } from "./pages/Journal";
import { Chart } from "./pages/Chart";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { BacktestLab } from "./pages/BacktestLab";
import { StrategyManager } from "./pages/StrategyManager";
import { RiskDashboard } from "./pages/RiskDashboard";
import { MarketIntelligencePage } from "./pages/MarketIntelligence";

export default function App() {
  return (
    <InstitutionalProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<CommandCenter />} />
          <Route path="/chart" element={<Chart />} />
          <Route path="/trading-bot" element={<AutoTrade />} />
          <Route path="/strategy-manager" element={<StrategyManager />} />
          <Route path="/risk-dashboard" element={<RiskDashboard />} />
          <Route path="/market-intelligence" element={<MarketIntelligencePage />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/backtest" element={<BacktestLab />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </InstitutionalProvider>
  );
}
