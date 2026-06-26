import React, { useEffect, useState } from 'react';

interface SystemStatus {
  mode: 'LIVE' | 'PAPER' | 'STOPPED';
  uptime: string;
  strategiesActive: number;
  strategiesTotal: number;
  positionsOpen: number;
  capitalDeployed: number;
  capitalAvailable: number;
  dailyPnL: number;
  dailyReturn: number;
  winRate: number;
  sharpe: number;
  maxDrawdown: number;
  var95: number;
  lastSignal: string;
  lastTrade: string;
  systemHealth: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  metaAIStatus: 'ACTIVE' | 'STANDBY';
  circuitBreaker: 'ARMED' | 'TRIPPED' | 'COOLING';
}

export default function CommandCenter() {
  const [status, setStatus] = useState<SystemStatus>({
    mode: 'PAPER',
    uptime: '14:32:17',
    strategiesActive: 12,
    strategiesTotal: 18,
    positionsOpen: 7,
    capitalDeployed: 4200000,
    capitalAvailable: 5800000,
    dailyPnL: 124500,
    dailyReturn: 1.25,
    winRate: 58.3,
    sharpe: 1.82,
    maxDrawdown: 4.2,
    var95: 85000,
    lastSignal: '2s ago',
    lastTrade: '8s ago',
    systemHealth: 'HEALTHY',
    metaAIStatus: 'ACTIVE',
    circuitBreaker: 'ARMED',
  });

  const [events, setEvents] = useState<Array<{ time: string; event: string; source: string; detail: string }>>([
    { time: '14:32:15', event: 'SIGNAL_APPROVED', source: 'MetaAI', detail: 'RELIANCE trend_long approved by MetaStrategy' },
    { time: '14:32:08', event: 'TRADE_FILLED', source: 'Execution', detail: 'INFY 850 qty @ 1842.50' },
    { time: '14:31:55', event: 'REGIME_CHANGED', source: 'MarketIntel', detail: 'NIFTY50 → trending_up_weak (conf: 0.72)' },
    { time: '14:31:42', event: 'PORTFOLIO_REBALANCED', source: 'PortfolioOpt', detail: 'Risk parity allocation updated' },
    { time: '14:31:20', event: 'LIQUIDITY_VOID', source: 'Microstructure', detail: 'ICICIBANK bid side absorption detected' },
    { time: '14:30:55', event: 'STRATEGY_HEALTH', source: 'Observability', detail: 'momentum_01 health: DEGRADED (3 losses)' },
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatus((s) => ({
        ...s,
        uptime: new Date().toISOString().split('T')[1].split('.')[0],
        dailyPnL: s.dailyPnL + (Math.random() - 0.48) * 500,
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatCurrency = (n: number) =>
    '₹' + (n / 100000).toFixed(2) + 'L';

  const formatPercent = (n: number) =>
    (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

  return (
    <div className="tos-view">
      <div className="tos-header">
        <h1>COMMAND CENTER</h1>
        <span className={`tos-badge ${status.mode.toLowerCase()}`}>{status.mode}</span>
      </div>

      <div className="tos-grid cols-4">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Capital Status</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Total Capital</span>
              <span className="tos-metric-value neutral">₹1.00Cr</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Deployed</span>
              <span className="tos-metric-value neutral">{formatCurrency(status.capitalDeployed)}</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Available</span>
              <span className="tos-metric-value neutral">{formatCurrency(status.capitalAvailable)}</span>
            </div>
          </div>
        </div>

        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Daily Performance</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">P&L</span>
              <span className={`tos-metric-value ${status.dailyPnL >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(status.dailyPnL)}
              </span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Return</span>
              <span className={`tos-metric-value ${status.dailyReturn >= 0 ? 'positive' : 'negative'}`}>
                {formatPercent(status.dailyReturn)}
              </span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Win Rate</span>
              <span className="tos-metric-value neutral">{status.winRate.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Risk Metrics</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Sharpe Ratio</span>
              <span className="tos-metric-value neutral">{status.sharpe.toFixed(2)}</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Max Drawdown</span>
              <span className="tos-metric-value negative">{status.maxDrawdown.toFixed(2)}%</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">VaR (95%)</span>
              <span className="tos-metric-value negative">{formatCurrency(status.var95)}</span>
            </div>
          </div>
        </div>

        <div className="tos-panel">
          <div className="tos-panel-header"><h3>System Status</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Uptime</span>
              <span className="tos-metric-value neutral">{status.uptime}</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Meta AI</span>
              <span className={`tos-metric-value ${status.metaAIStatus === 'ACTIVE' ? 'positive' : 'negative'}`}>
                {status.metaAIStatus}
              </span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Circuit Breaker</span>
              <span className={`tos-metric-value ${status.circuitBreaker === 'ARMED' ? 'positive' : 'negative'}`}>
                {status.circuitBreaker}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="tos-grid cols-2">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Active Strategies</h3></div>
          <div className="tos-panel-body">
            <table className="tos-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Size</th>
                  <th>Entry</th>
                  <th>P&L</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>momentum_01</td>
                  <td>RELIANCE</td>
                  <td>LONG</td>
                  <td>500</td>
                  <td>2845.20</td>
                  <td style={{ color: 'var(--accent-green)' }}>+12,450</td>
                  <td><span style={{ color: 'var(--accent-green)' }}>●</span> HEALTHY</td>
                </tr>
                <tr>
                  <td>meanrev_03</td>
                  <td>INFY</td>
                  <td>SHORT</td>
                  <td>850</td>
                  <td>1845.00</td>
                  <td style={{ color: 'var(--accent-red)' }}>-3,200</td>
                  <td><span style={{ color: 'var(--accent-yellow)' }}>●</span> DEGRADED</td>
                </tr>
                <tr>
                  <td>breakout_07</td>
                  <td>TCS</td>
                  <td>LONG</td>
                  <td>200</td>
                  <td>4250.00</td>
                  <td style={{ color: 'var(--accent-green)' }}>+8,100</td>
                  <td><span style={{ color: 'var(--accent-green)' }}>●</span> HEALTHY</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Event Stream</h3></div>
          <div className="tos-panel-body">
            <div className="tos-log">
              {events.map((e, i) => (
                <div key={i} className="tos-log-entry">
                  <span className="tos-log-time">{e.time}</span>
                  <span className="tos-log-event">{e.event}</span>
                  <span className="tos-log-source">[{e.source}]</span>
                  <span>{e.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="tos-panel">
        <div className="tos-panel-header"><h3>Meta Strategy Arbitration Log</h3></div>
        <div className="tos-panel-body">
          <div className="tos-terminal">
            <div className="tos-terminal-line">
              <span className="tos-terminal-prompt">$</span>
              <span className="tos-terminal-cmd">meta-ai evaluate signal_7a3f9b</span>
            </div>
            <div className="tos-terminal-line" style={{ color: 'var(--text-muted)' }}>
              {'>'} Signal: RELIANCE LONG @ 2845.20 | Size: 500 | Conf: 0.82
            </div>
            <div className="tos-terminal-line" style={{ color: 'var(--text-muted)' }}>
              {'>'} Portfolio VaR impact: 0.8% [PASS]
            </div>
            <div className="tos-terminal-line" style={{ color: 'var(--text-muted)' }}>
              {'>'} Correlation risk: 0.15 [PASS]
            </div>
            <div className="tos-terminal-line" style={{ color: 'var(--text-muted)' }}>
              {'>'} Regime suitability: 0.89 [PASS]
            </div>
            <div className="tos-terminal-line" style={{ color: 'var(--accent-green)' }}>
              {'>'} VERDICT: APPROVE | Final size: 500 | Urgency: immediate
            </div>
            <div className="tos-terminal-line" style={{ marginTop: 8 }}>
              <span className="tos-terminal-prompt">$</span>
              <span className="tos-terminal-cmd">meta-ai evaluate signal_8e2d1a</span>
            </div>
            <div className="tos-terminal-line" style={{ color: 'var(--text-muted)' }}>
              {'>'} Signal: HDFCBANK SHORT @ 1680.50 | Size: 1200 | Conf: 0.71
            </div>
            <div className="tos-terminal-line" style={{ color: 'var(--text-muted)' }}>
              {'>'} Portfolio VaR impact: 2.1% [EXCEEDS THRESHOLD]
            </div>
            <div className="tos-terminal-line" style={{ color: 'var(--accent-red)' }}>
              {'>'} VERDICT: REDUCE_SIZE | Final size: 600 | Urgency: opportunistic
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}