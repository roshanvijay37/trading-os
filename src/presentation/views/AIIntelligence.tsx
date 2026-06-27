
export default function AIIntelligence() {
  return (
    <div className="tos-view">
      <div className="tos-header">
        <h1>AI INTELLIGENCE</h1>
        <span className="tos-badge live">ACTIVE</span>
      </div>
      <div className="tos-grid cols-2">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Regime Analysis</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Current Regime</span>
              <span className="tos-metric-value positive">trending_up_weak</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Confidence</span>
              <span className="tos-metric-value positive">72%</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Duration</span>
              <span className="tos-metric-value neutral">47 periods</span>
            </div>
            <div className="tos-terminal" style={{ marginTop: 16 }}>
              <div className="tos-terminal-line" style={{ color: 'var(--accent-cyan)' }}>AI Recommendation:</div>
              <div className="tos-terminal-line">{'>'} Favor momentum strategies</div>
              <div className="tos-terminal-line">{'>'} Increase trend-following allocation</div>
              <div className="tos-terminal-line">{'>'} Reduce mean-reversion exposure</div>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>AI Analysis Queue</h3></div>
          <div className="tos-panel-body">
            <table className="tos-table">
              <thead><tr><th>Type</th><th>Priority</th><th>Status</th><th>Confidence</th></tr></thead>
              <tbody>
                <tr><td>REGIME_ANALYSIS</td><td>HIGH</td><td style={{ color: 'var(--accent-green)' }}>COMPLETE</td><td>0.72</td></tr>
                <tr><td>STRATEGY_RANKING</td><td>MEDIUM</td><td style={{ color: 'var(--accent-green)' }}>COMPLETE</td><td>0.85</td></tr>
                <tr><td>EXECUTION_REVIEW</td><td>LOW</td><td style={{ color: 'var(--accent-yellow)' }}>PENDING</td><td>--</td></tr>
                <tr><td>ANOMALY_DETECTION</td><td>HIGH</td><td style={{ color: 'var(--accent-green)' }}>COMPLETE</td><td>0.80</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="tos-panel">
        <div className="tos-panel-header"><h3>CIO Weekly Report</h3></div>
        <div className="tos-panel-body">
          <div className="tos-terminal">
            <div className="tos-terminal-line" style={{ color: 'var(--accent-cyan)' }}>WEEKLY CIO REPORT - Week 26</div>
            <div className="tos-terminal-line">{'>'} Portfolio performance within expected parameters</div>
            <div className="tos-terminal-line">{'>'} No critical alerts this week</div>
            <div className="tos-terminal-line">{'>'} Sharpe ratio improved from 1.68 to 1.82</div>
            <div className="tos-terminal-line">{'>'} Recommendation: Continue current strategy mix</div>
            <div className="tos-terminal-line">{'>'} Monitor emerging volatility patterns in NIFTY50</div>
          </div>
        </div>
      </div>
    </div>
  );
}