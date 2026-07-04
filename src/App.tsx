import { Navigate, Route, Routes } from "react-router-dom";
import { InstitutionalProvider } from "./store/InstitutionalProvider";
import { Layout } from "./components/Layout";
import { AutoTrade } from "./pages/AutoTrade";
import { CommandCenter } from "./pages/CommandCenter";
import { Journal } from "./pages/Journal";
import { Chart } from "./pages/Chart";
import { Settings } from "./pages/Settings";
import { BacktestLab } from "./pages/BacktestLab";
import { MarketIntelligencePage } from "./pages/MarketIntelligence";
import { OptionsTerminal } from "./options/OptionsTerminal";

export default function App() {
  return (
    <InstitutionalProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<CommandCenter />} />
          <Route path="/chart" element={<Chart />} />
          <Route path="/trading-bot" element={<AutoTrade />} />
          {/* Old bookmarks: risk lives in Command Center's Risk tab; reports merged into Journal. */}
          <Route path="/risk-dashboard" element={<Navigate to="/" replace />} />
          <Route path="/reports" element={<Navigate to="/journal" replace />} />
          <Route path="/market-intelligence" element={<MarketIntelligencePage />} />
          <Route path="/options" element={<OptionsTerminal />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/backtest" element={<BacktestLab />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </InstitutionalProvider>
  );
}
