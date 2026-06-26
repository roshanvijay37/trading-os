import React from 'react';

export default function MarketIntelligence() {
  return (
    <div className="tos-view">
      <div className="tos-header">
        <h1>MARKET INTELLIGENCE</h1>
        <span className="tos-badge live">REALTIME</span>
      </div>
      <div className="tos-grid cols-2">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Order Book Imbalance</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">RELIANCE</span>
              <span className="tos-metric-value positive">+0.42 BULLISH</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill high" style={{ width: '71%' }} />
              </div>
            </div>
            <div className="tos-metric" style={{ marginTop: 16 }}>
              <span className="tos-metric-label">INFY</span>
              <span className="tos-metric-value negative">-0.28 BEARISH</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill low" style={{ width: '36%' }} />
              </div>
            </div>
            <div className="tos-metric" style={{ marginTop: 16 }}>
              <span className="tos-metric-label">TCS</span>
              <span className="tos-metric-value neutral">+0.05 NEUTRAL</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill medium" style={{ width: '52%' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Market Pressure</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Aggressive Buy Volume</span>
              <span className="tos-metric-value positive">2.4M</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Aggressive Sell Volume</span>
              <span className="tos-metric-value negative">1.8M</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Net Pressure</span>
              <span className="tos-metric-value positive">+0.62</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tos-grid cols-3">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Iceberg Detection</h3></div>
          <div className="tos-panel-body">
            <table className="tos-table">
              <thead><tr><th>Symbol</th><th>Price</th><th>Est. Size</th><th>Conf</th></tr></thead>
              <tbody>
                <tr><td>RELIANCE</td><td>2845.00</td><td>15,000</td><td style={{ color: 'var(--accent-yellow)' }}>72%</td></tr>
                <tr><td>HDFCBANK</td><td>1680.50</td><td>8,500</td><td style={{ color: 'var(--accent-green)' }}>85%</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Sweep Detection</h3></div>
          <div className="tos-panel-body">
            <table className="tos-table">
              <thead><tr><th>Symbol</th><th>Type</th><th>Level</th><th>Conf</th></tr></thead>
              <tbody>
                <tr><td>ICICIBANK</td><td>LIQUIDITY_SWEEP</td><td>1120.00</td><td style={{ color: 'var(--accent-red)' }}>65%</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="tos-panel">
          <div className="tos-panel-header"><h3>VWAP Deviation</h3></div>
          <div className="tos-panel-body">
            <table className="tos-table">
              <thead><tr><th>Symbol</th><th>VWAP</th><th>Price</th><th>Z-Score</th></tr></thead>
              <tbody>
                <tr><td>RELIANCE</td><td>2838.50</td><td>2845.20</td><td style={{ color: 'var(--accent-yellow)' }}>+1.8</td></tr>
                <tr><td>INFY</td><td>1848.00</td><td>1842.50</td><td style={{ color: 'var(--accent-green)' }}>-0.9</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="tos-panel">
        <div className="tos-panel-header"><h3>Volume Profile - RELIANCE</h3></div>
        <div className="tos-panel-body">
          <div className="tos-terminal">
            <div className="tos-terminal-line">POC: 2835.00 | VAH: 2850.00 | VAL: 2820.00 | VA Ratio: 68%</div>
            <div className="tos-terminal-line">Low Volume Nodes: 2805.00, 2865.00</div>
            <div className="tos-terminal-line">High Volume Nodes: 2835.00 (POC), 2842.00</div>
          </div>
        </div>
      </div>
    </div>
  );
}