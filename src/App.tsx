import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { storage } from "./services/storage";
import { AutoTrade } from "./pages/AutoTrade";
import { Constitution } from "./pages/Constitution";
import { Dashboard } from "./pages/Dashboard";
import { Journal } from "./pages/Journal";
import { LiveTrade } from "./pages/LiveTrade";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { Backtest } from "./pages/Backtest";
import { VisualBacktest } from "./pages/VisualBacktest";

function DailyGate() {
  return storage.hasAcceptedConstitution() ? <Layout /> : <Navigate to="/constitution" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/constitution" element={<Constitution />} />
      <Route element={<DailyGate />}>
        <Route index element={<Dashboard />} />
        <Route path="/live-trade" element={<LiveTrade />} />
        <Route path="/auto-trade" element={<AutoTrade />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/backtest" element={<Backtest />} />
        <Route path="/visual-backtest" element={<VisualBacktest />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
