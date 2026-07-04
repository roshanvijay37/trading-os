import { Navigate, Route, Routes } from "react-router-dom";
import { InstitutionalProvider } from "./store/InstitutionalProvider";
import { Layout } from "./components/Layout";
import { AutoTrade } from "./pages/AutoTrade";
import { Journal } from "./pages/Journal";
import { Chart } from "./pages/Chart";
import { BacktestLab } from "./pages/BacktestLab";
import { MarketIntelligencePage } from "./pages/MarketIntelligence";
import { OptionsTerminal } from "./options/OptionsTerminal";

export default function App() {
  return (
    <InstitutionalProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<AutoTrade />} />
          <Route path="/chart" element={<Chart />} />
          {/* Old bookmarks: Command Center (dashboard+risk overview) removed — the bot page is
              now home; everything is configured/monitored there. Reports merged into Journal. */}
          <Route path="/trading-bot" element={<Navigate to="/" replace />} />
          <Route path="/risk-dashboard" element={<Navigate to="/" replace />} />
          <Route path="/reports" element={<Navigate to="/journal" replace />} />
          <Route path="/market-intelligence" element={<MarketIntelligencePage />} />
          <Route path="/options" element={<OptionsTerminal />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/backtest" element={<BacktestLab />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </InstitutionalProvider>
  );
}
