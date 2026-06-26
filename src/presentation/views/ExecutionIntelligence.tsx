import React from 'react';

export default function ExecutionIntelligence() {
  return (
    <div className="tos-view">
      <div className="tos-header">
        <h1>EXECUTION INTELLIGENCE</h1>
        <span className="tos-badge live">TWAP ENABLED</span>
      </div>
      <div className="tos-grid cols-3">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Slippage Analysis</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Avg Slippage</span>
              <span className="tos-metric-value positive">0.03%</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Market Impact</span>
              <span className="tos-metric-value positive">0.08%</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Fill Rate</span>
              <span className="tos-metric-value positive">97.2%</span>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Latency</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Feed Latency</span>
              <span className="tos-metric-value positive">12ms</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Order Latency</span>
              <span className="tos-metric-value positive">45ms</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Round Trip</span>
              <span className="tos-metric-value neutral">89ms</span>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Broker Health</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Primary</span>
              <span className="tos-metric-value positive">● CONNECTED</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Failover</span>
              <span className="tos-metric-value neutral">○ STANDBY</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Last Heartbeat</span>
              <span className="tos-metric-value positive">2ms ago</span>
            </div>
          </div>
        </div>
      </div>
      <div className="tos-panel">
        <div className="tos-panel-header"><h3>Recent Executions</h3></div>
        <div className="tos-panel-body">
          <table className="tos-table">
            <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>Slippage</th><th>Venue</th></tr></thead>
            <tbody>
              <tr><td>14:32:08</td><td>INFY</td><td>BUY</td><td>850</td><td>1842.50</td><td style={{ color: 'var(--accent-green)' }}>0.02%</td><td>NSE</td></tr>
              <tr><td>14:31:45</td><td>RELIANCE</td><td>BUY</td><td>500</td><td>2845.20</td><td style={{ color: 'var(--accent-green)' }}>0.01%</td><td>NSE</td></tr>
              <tr><td>14:30:22</td><td>TCS</td><td>SELL</td><td>200</td><td>4250.00</td><td style={{ color: 'var(--accent-yellow)' }}>0.05%</td><td>NSE</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}