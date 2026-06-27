
export default function PortfolioDefense() {
  return (
    <div className="tos-view">
      <div className="tos-header">
        <h1>PORTFOLIO DEFENSE ENGINE</h1>
        <span className="tos-badge live">RISK_PARITY</span>
      </div>
      <div className="tos-grid cols-4">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Gross Exposure</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-value neutral">42.0%</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill medium" style={{ width: '42%' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Net Exposure</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-value positive">+28.5%</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill high" style={{ width: '57%' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Margin Util</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-value neutral">8.4%</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill high" style={{ width: '17%' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Leverage</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-value neutral">1.42x</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tos-grid cols-2">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Strategy Allocations</h3></div>
          <div className="tos-panel-body">
            <table className="tos-table">
              <thead><tr><th>Strategy</th><th>Weight</th><th>Target</th><th>Drift</th><th>Action</th></tr></thead>
              <tbody>
                <tr><td>momentum_01</td><td>22%</td><td>25%</td><td style={{ color: 'var(--accent-yellow)' }}>-3%</td><td>INCREASE</td></tr>
                <tr><td>meanrev_03</td><td>18%</td><td>15%</td><td style={{ color: 'var(--accent-green)' }}>+3%</td><td>DECREASE</td></tr>
                <tr><td>breakout_07</td><td>12%</td><td>12%</td><td style={{ color: 'var(--accent-green)' }}>0%</td><td>HOLD</td></tr>
                <tr><td>stat_arb_02</td><td>15%</td><td>18%</td><td style={{ color: 'var(--accent-yellow)' }}>-3%</td><td>INCREASE</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Capital Protection</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Daily Limit</span>
              <span className="tos-metric-value positive">1.25% / 3.00%</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Circuit Breaker</span>
              <span className="tos-metric-value positive">ARMED</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Max Drawdown</span>
              <span className="tos-metric-value positive">4.20% / 15.00%</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">VaR (95%)</span>
              <span className="tos-metric-value neutral">₹0.85L</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}