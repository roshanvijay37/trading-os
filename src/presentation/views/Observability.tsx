
export default function Observability() {
  return (
    <div className="tos-view">
      <div className="tos-header">
        <h1>OBSERVABILITY</h1>
        <span className="tos-badge live">MONITORING</span>
      </div>
      <div className="tos-grid cols-4">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>System Health</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Overall</span>
              <span className="tos-metric-value positive">HEALTHY</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Availability</span>
              <span className="tos-metric-value positive">99.97%</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">MTTR</span>
              <span className="tos-metric-value neutral">4.2 min</span>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Active Alerts</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Critical</span>
              <span className="tos-metric-value positive">0</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Warning</span>
              <span className="tos-metric-value neutral">2</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Info</span>
              <span className="tos-metric-value neutral">12</span>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Event Bus</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Events/sec</span>
              <span className="tos-metric-value neutral">1,247</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Subscribers</span>
              <span className="tos-metric-value neutral">34</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Queue Depth</span>
              <span className="tos-metric-value positive">0</span>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Self-Healing</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-label">Recoveries</span>
              <span className="tos-metric-value positive">3</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Success Rate</span>
              <span className="tos-metric-value positive">100%</span>
            </div>
            <div className="tos-metric" style={{ marginTop: 12 }}>
              <span className="tos-metric-label">Last Action</span>
              <span className="tos-metric-value neutral">2h ago</span>
            </div>
          </div>
        </div>
      </div>
      <div className="tos-panel">
        <div className="tos-panel-header"><h3>Component Health Matrix</h3></div>
        <div className="tos-panel-body">
          <table className="tos-table">
            <thead><tr><th>Component</th><th>Status</th><th>Latency</th><th>Error Rate</th><th>Throughput</th><th>Uptime</th></tr></thead>
            <tbody>
              <tr><td>market-microstructure</td><td style={{ color: 'var(--accent-green)' }}>HEALTHY</td><td>12ms</td><td>0.00%</td><td>1,200/s</td><td>14:32:17</td></tr>
              <tr><td>portfolio-optimization</td><td style={{ color: 'var(--accent-green)' }}>HEALTHY</td><td>45ms</td><td>0.00%</td><td>30/s</td><td>14:32:17</td></tr>
              <tr><td>ai-engine</td><td style={{ color: 'var(--accent-green)' }}>HEALTHY</td><td>120ms</td><td>0.02%</td><td>5/s</td><td>14:32:17</td></tr>
              <tr><td>capital-protection</td><td style={{ color: 'var(--accent-green)' }}>HEALTHY</td><td>2ms</td><td>0.00%</td><td>50/s</td><td>14:32:17</td></tr>
              <tr><td>self-healing</td><td style={{ color: 'var(--accent-green)' }}>HEALTHY</td><td>8ms</td><td>0.00%</td><td>1/s</td><td>14:32:17</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}