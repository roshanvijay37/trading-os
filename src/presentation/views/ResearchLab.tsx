
export default function ResearchLabView() {
  return (
    <div className="tos-view">
      <div className="tos-header">
        <h1>RESEARCH LAB</h1>
        <span className="tos-badge paper">WALK FORWARD</span>
      </div>
      <div className="tos-grid cols-3">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Hypotheses</h3></div>
          <div className="tos-panel-body">
            <table className="tos-table">
              <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Sharpe</th></tr></thead>
              <tbody>
                <tr><td>momentum_01</td><td>MOMENTUM</td><td style={{ color: 'var(--accent-green)' }}>PRODUCTION</td><td>1.82</td></tr>
                <tr><td>meanrev_03</td><td>MEAN_REVERSION</td><td style={{ color: 'var(--accent-green)' }}>PRODUCTION</td><td>1.45</td></tr>
                <tr><td>breakout_07</td><td>MICROSTRUCTURE</td><td style={{ color: 'var(--accent-yellow)' }}>TESTING</td><td>1.12</td></tr>
                <tr><td>sentiment_04</td><td>SENTIMENT</td><td style={{ color: 'var(--accent-blue)' }}>DRAFT</td><td>--</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Robustness Scores</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">momentum_01</span>
              <span className="tos-metric-value positive">87/100 STRONG_PASS</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill high" style={{ width: '87%' }} />
              </div>
            </div>
            <div className="tos-metric" style={{ marginTop: 16 }}>
              <span className="tos-metric-label">meanrev_03</span>
              <span className="tos-metric-value positive">72/100 PASS</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill high" style={{ width: '72%' }} />
              </div>
            </div>
            <div className="tos-metric" style={{ marginTop: 16 }}>
              <span className="tos-metric-label">breakout_07</span>
              <span className="tos-metric-value neutral">54/100 MARGINAL</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill medium" style={{ width: '54%' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Factor Discovery</h3></div>
          <div className="tos-panel-body">
            <table className="tos-table">
              <thead><tr><th>Factor</th><th>IC</th><th>IR</th><th>Decay</th></tr></thead>
              <tbody>
                <tr><td>price_momentum_20d</td><td>0.082</td><td>1.30</td><td>0.12</td></tr>
                <tr><td>volume_anomaly</td><td>0.065</td><td>1.03</td><td>0.08</td></tr>
                <tr><td>volatility_regime</td><td>0.054</td><td>0.86</td><td>0.15</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="tos-panel">
        <div className="tos-panel-header"><h3>Edge Decay Analysis</h3></div>
        <div className="tos-panel-body">
          <div className="tos-terminal">
            <div className="tos-terminal-line">Strategy: momentum_01 | Lookback: 5 years</div>
            <div className="tos-terminal-line">2020: Sharpe 2.10 | 2021: Sharpe 1.85 | 2022: Sharpe 1.72</div>
            <div className="tos-terminal-line">2023: Sharpe 1.68 | 2024: Sharpe 1.55 | 2025: Sharpe 1.45</div>
            <div className="tos-terminal-line">Decay Rate: 0.08/year | Half-Life: 8.7 years</div>
            <div className="tos-terminal-line" style={{ color: 'var(--accent-green)' }}>{'>'} Edge is stable. Strategy appears durable.</div>
          </div>
        </div>
      </div>
    </div>
  );
}