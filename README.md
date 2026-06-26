# TradingOS Institutional v2.0.0

## Autonomous Quantitative Trading Operating System

> "I do not trade. I supervise."

---

## Architecture Overview

TradingOS Institutional is designed for the operator of an autonomous trading system — not a retail trader. Every component is built with the philosophy that the platform observes markets, makes decisions, executes, protects capital, analyses itself, and improves without human intervention.

### Core Design Principles

1. **Capital Protection First** — All trading decisions are secondary to capital preservation
2. **Execution Quality** — Institutional-grade execution with microstructure awareness
3. **Reliability** — Self-healing systems with automatic recovery
4. **Scalability** — Event-driven architecture supporting multiple strategies
5. **Observability** — Every component exposes health, metrics, and events
6. **Research** — Built-in quant research lab for strategy development
7. **Profitability** — Only after all other priorities are satisfied

---

## System Components

### 1. Event System (`src/domain/events/`, `src/infrastructure/events/`)
- 50+ event types covering every system action
- Async event bus with pattern matching
- Event persistence and streaming
- Full audit trail generation

### 2. Market Microstructure Engine (`src/application/market-microstructure/`)
- **Order Book Imbalance** — Real-time bid/ask depth analysis
- **Market Pressure** — Aggressive buy/sell volume tracking
- **VWAP Deviation** — Z-score based execution quality
- **Iceberg Detection** — Hidden order identification
- **Sweep Detection** — Liquidity sweep and stop hunt detection
- **Volume Profile** — POC, Value Area, Low/High Volume Nodes

### 3. Meta Strategy Engine (`src/application/meta-strategy/`)
Every trade must pass Meta AI approval:
- Portfolio VaR impact assessment
- Correlation risk analysis
- Concentration risk monitoring
- Volatility environment check
- Market regime suitability
- Strategy conflict detection
- Signal deduplication
- Execution quality pre-check

### 4. Portfolio Optimization Engine (`src/application/portfolio/`)
- **Mean-Variance Optimization**
- **Kelly Criterion** position sizing
- **Risk Parity** allocation
- **Equal Risk Contribution**
- **Minimum Variance**
- **Adaptive Position Sizing** — Dynamic based on drawdown and volatility
- Stress testing with scenario analysis

### 5. Advanced Research Lab (`src/application/research/`)
- Hypothesis Builder with Zod validation
- Walk Forward Analysis
- Monte Carlo Simulation (10,000+ iterations)
- Robustness Scoring (8 dimensions)
- Factor Discovery with IC/IR calculation
- Parameter Surface Analysis
- Edge Decay Analysis with half-life calculation

### 6. Observability Engine (`src/application/observability/`)
- Component health monitoring (12 component types)
- Real-time metrics collection
- Alert system with severity levels
- MTBF/MTTR calculation
- Availability tracking

### 7. AI Engine (`src/application/ai/`)
- Regime Analysis
- Failure Explanation
- Anomaly Detection
- Strategy Ranking
- Execution Review
- Optimization Suggestions
- Automated Incident Reports
- Weekly CIO Reports
- Monthly Portfolio Reviews
- Yearly Improvement Reports

### 8. Capital Protection Engine (`src/application/capital-protection/`)
- Daily/Weekly/Monthly loss limits
- Max drawdown circuit breakers
- Emergency stop triggers
- Position size limits
- Sector exposure controls
- Cooling-off periods

### 9. Self-Healing Engine (`src/application/self-healing/`)
- Automatic broker reconnection
- Feed recovery procedures
- Latency mitigation
- Recovery procedure framework
- Healing attempt tracking
- Automatic failover

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | System health check |
| `/api/system/health` | GET | Full system health |
| `/api/system/events` | GET | Recent events |
| `/api/system/events/:type` | GET | Events by type |
| `/api/portfolio/metrics` | GET | Portfolio metrics |
| `/api/portfolio/allocation` | GET | Current allocation |
| `/api/meta-strategy/conflicts` | GET | Strategy conflicts |
| `/api/research/hypotheses` | GET | All hypotheses |
| `/api/research/hypothesis` | POST | Create hypothesis |
| `/api/capital/state` | GET | Capital state |
| `/api/observability/components` | GET | Component health |
| `/api/observability/alerts` | GET | Active alerts |
| `/api/ai/results` | GET | AI analysis results |
| `/api/self-healing/log` | GET | Healing log |
| `/api/market-microstructure/liquidity/:symbol` | GET | Liquidity zones |
| `/api/ws/events` | WS | Real-time event stream |

---

## User Interface

### Command Center
- Real-time capital status, daily performance, risk metrics
- Active strategy positions with health indicators
- Live event stream with filtering
- Meta Strategy arbitration log

### Market Intelligence
- Order book imbalance visualization
- Market pressure metrics
- Iceberg detection table
- Sweep detection alerts
- VWAP deviation tracking
- Volume profile analysis

### Portfolio Defense
- Gross/net exposure monitoring
- Strategy allocation drift tracking
- Capital protection status
- Circuit breaker state

### Execution Intelligence
- Slippage analysis
- Latency metrics
- Broker health monitoring
- Recent execution log

### Research Lab
- Hypothesis management
- Robustness score visualization
- Factor discovery table
- Edge decay analysis

### Observability
- System health dashboard
- Active alerts
- Event bus metrics
- Self-healing statistics

### AI Intelligence
- Regime analysis with recommendations
- AI analysis queue
- Automated CIO reports

### System Health
- CPU/Memory/Disk/Network monitoring
- Self-healing action log

---

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Fastify + WebSocket
- **State Management**: Event-driven architecture
- **Validation**: Zod schemas
- **Styling**: Custom CSS (institutional dark theme)
- **Architecture**: Clean Architecture / DDD patterns

---

## Philosophy

This platform is designed for an operator who:
- Does NOT click buy/sell buttons
- Does NOT make discretionary trades
- Supervises an autonomous system that trades on their behalf
- Values capital protection above all else
- Understands that the system improves itself over time

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development (client + server)
npm run dev

# Start server only
npm run dev:server

# Start client only
npm run dev:client

# Build for production
npm run build
```

---

## License

Private / Institutional Use Only