
export default function SystemHealth() {
  return (
    <div className="tos-view">
      <div className="tos-header">
        <h1>SYSTEM HEALTH</h1>
        <span className="tos-badge live">ALL SYSTEMS GO</span>
      </div>
      <div className="tos-grid cols-4">
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>CPU</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-value neutral">12%</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill high" style={{ width: '12%' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Memory</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-value neutral">3.2GB / 16GB</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill high" style={{ width: '20%' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Disk</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-value neutral">45GB / 500GB</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill medium" style={{ width: '9%' }} />
              </div>
            </div>
          </div>
        </div>
        <div className="tos-panel">
          <div className="tos-panel-header"><h3>Network</h3></div>
          <div className="tos-panel-body">
            <div className="tos-metric">
              <span className="tos-metric-value neutral">12 Mbps</span>
              <div className="tos-progress-bar" style={{ marginTop: 8 }}>
                <div className="tos-progress-bar-fill high" style={{ width: '12%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="tos-panel">
        <div className="tos-panel-header"><h3>Self-Healing Log</h3></div>
        <div className="tos-panel-body">
          <table className="tos-table">
            <thead><tr><th>Time</th><th>Component</th><th>Action</th><th>Result</th></tr></thead>
            <tbody>
              <tr><td>12:45:22</td><td>broker</td><td>RECONNECT</td><td style={{ color: 'var(--accent-green)' }}>SUCCESS</td></tr>
              <tr><td>10:32:08</td><td>feed</td><td>RECONNECT_WEBSOCKET</td><td style={{ color: 'var(--accent-green)' }}>SUCCESS</td></tr>
              <tr><td>08:15:45</td><td>latency</td><td>REDUCE_BATCH_SIZE</td><td style={{ color: 'var(--accent-green)' }}>SUCCESS</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}