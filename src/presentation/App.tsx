import { useState } from 'react';
import CommandCenter from './views/CommandCenter';
import MarketIntelligence from './views/MarketIntelligence';
import PortfolioDefense from './views/PortfolioDefense';
import ExecutionIntelligence from './views/ExecutionIntelligence';
import ResearchLab from './views/ResearchLab';
import Observability from './views/Observability';
import AIIntelligence from './views/AIIntelligence';
import SystemHealth from './views/SystemHealth';
import './App.css';

type View = 'command' | 'market' | 'portfolio' | 'execution' | 'research' | 'observability' | 'ai' | 'health';

const NAV_ITEMS: { id: View; label: string; shortcut: string }[] = [
  { id: 'command', label: 'COMMAND', shortcut: 'F1' },
  { id: 'market', label: 'MARKET INTEL', shortcut: 'F2' },
  { id: 'portfolio', label: 'PORTFOLIO DEFENSE', shortcut: 'F3' },
  { id: 'execution', label: 'EXECUTION', shortcut: 'F4' },
  { id: 'research', label: 'RESEARCH LAB', shortcut: 'F5' },
  { id: 'observability', label: 'OBSERVABILITY', shortcut: 'F6' },
  { id: 'ai', label: 'AI INTELLIGENCE', shortcut: 'F7' },
  { id: 'health', label: 'SYSTEM HEALTH', shortcut: 'F8' },
];

export default function App() {
  const [activeView, setActiveView] = useState<View>('command');
  const [collapsed, setCollapsed] = useState(false);

  const renderView = () => {
    switch (activeView) {
      case 'command': return <CommandCenter />;
      case 'market': return <MarketIntelligence />;
      case 'portfolio': return <PortfolioDefense />;
      case 'execution': return <ExecutionIntelligence />;
      case 'research': return <ResearchLab />;
      case 'observability': return <Observability />;
      case 'ai': return <AIIntelligence />;
      case 'health': return <SystemHealth />;
    }
  };

  return (
    <div className="tos-app">
      <aside className={`tos-sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="tos-brand">
          <div className="tos-logo">TOS</div>
          {!collapsed && <div className="tos-version">v2.0.0-INST</div>}
        </div>
        <nav className="tos-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`tos-nav-item ${activeView === item.id ? 'active' : ''}`}
              onClick={() => setActiveView(item.id)}
            >
              <span className="tos-nav-label">{collapsed ? item.label[0] : item.label}</span>
              {!collapsed && <span className="tos-nav-shortcut">{item.shortcut}</span>}
            </button>
          ))}
        </nav>
        <div className="tos-status-bar">
          {!collapsed && (
            <>
              <div className="tos-status-indicator healthy" />
              <span className="tos-status-text">SYSTEM OPERATIONAL</span>
            </>
          )}
        </div>
        <button className="tos-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '>' : '<'}
        </button>
      </aside>
      <main className="tos-main">{renderView()}</main>
    </div>
  );
}