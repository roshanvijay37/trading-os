# TradingOS — Institutional Grade Autonomous Trading Platform

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

## Table of Contents

1. [Philosophy](#philosophy)
2. [What Was Removed](#what-was-removed)
3. [Architecture](#architecture)
4. [Pages](#pages)
5. [Strategies (17)](#strategies-17)
6. [AI Decision Engine](#ai-decision-engine)
7. [Command Center](#command-center)
8. [Portfolio Risk Engine](#portfolio-risk-engine)
9. [Tech Stack](#tech-stack)
10. [Quick Start](#quick-start)
11. [Operations & Deployment](#operations--deployment)
12. [Documentation](#documentation)
13. [License](#license)

---

## Philosophy

This platform is designed for an operator who:
- Does NOT click buy/sell buttons
- Does NOT make discretionary trades
- Supervises an autonomous system that trades on their behalf
- Values capital protection above all else
- Understands that the system improves itself over time

---

## What Was Removed

All manual trading capabilities have been eliminated:

- ❌ Manual Buy/Sell buttons
- ❌ Order placement forms
- ❌ Quantity/Price/Order type selectors
- ❌ MIS/CNC/BO/CO product selectors
- ❌ Emotion evaluation engine
- ❌ Daily constitution/affirmations
- ❌ Manual order confirmation dialogs
- ❌ Manual position closing
- ❌ Manual symbol search for trading

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRADINGOS PLATFORM                        │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (React + TypeScript + Tailwind CSS)               │
│  ├── Command Center         Dashboard + AI CIO merged        │
│  ├── Strategy Manager       Enable/disable/configure (17)    │
│  ├── Risk Dashboard         Portfolio risk monitoring        │
│  ├── Market Intelligence    Live data + analytics merged     │
│  ├── Trading Bot            Automated execution control      │
│  ├── Live Chart             SVG candlestick analysis         │
│  ├── Backtest Lab           Strategy validation + charts     │
│  ├── Journal                Automatic trade audit            │
│  ├── Reports                Performance analytics            │
│  └── Settings               Platform configuration           │
├─────────────────────────────────────────────────────────────┤
│  Core Engine (TypeScript - Single Source of Truth)          │
│  ├── Strategy Registry       17 strategies with parameters   │
│  ├── Unified Engine          Same code for backtest + live   │
│  ├── AI Reasoning Engine     Trade grading A+ to REJECT      │
│  └── Indicator Library       EMA, RSI, VWAP, ATR, BB, ST    │
├─────────────────────────────────────────────────────────────┤
│  State Management (React Context + useReducer)              │
│  ├── Strategy Configs        Per-strategy allocation & risk  │
│  ├── Portfolio Risk          Exposure, limits, breaches      │
│  ├── AI CIO State            Regime, recommendations         │
│  └── Market Intelligence     Live analytics data             │
└─────────────────────────────────────────────────────────────┘
```

---

## Pages

| Page | Purpose | Route |
|------|---------|-------|
| **Command Center** | Bot status, P&L, market regime, AI CIO chat | `/` |
| **Trading Bot** | Start/stop bot, emergency controls, execution logs, positions, signals | `/trading-bot` |
| **Strategy Manager** | Enable/disable 17 strategies, configure capital allocation, risk, sessions | `/strategy-manager` |
| **Live Chart** | SVG candlestick with volume, timeframe selector, market status | `/chart` |
| **Backtest Lab** | Strategy backtest with table/chart toggle view | `/backtest` |
| **Market Intelligence** | PCR, IV, institutional flow, gamma exposure analytics | `/market-intelligence` |
| **Risk Dashboard** | Portfolio risk monitoring, VaR, circuit breakers, stress tests | `/risk-dashboard` |
| **Journal** | Automated trade audit trail | `/journal` |
| **Reports** | Performance analytics (discipline, win rate, P&L) | `/reports` |
| **Settings** | Platform configuration, broker, risk, capital | `/settings` |

Navigation: 10 items in grouped sidebar sections (Operations, Research, Risk, Records, System).

---

## Strategies (17)

| Strategy | Category | Author |
|----------|----------|--------|
| 5 EMA Trend | Trend Following | Subhasish Pani |
| 5 EMA Option Buying | Option | Subhasish Pani |
| RSI 2-Period | Mean Reversion | Larry Connors |
| Traffic Light | Trend Following | Subhasish Pani |
| Inside Candle Breakout | Breakout | Price Action |
| VWAP Reversal | Mean Reversion | Anant Ladha |
| Opening Range Breakout | Breakout | Toby Crabel |
| CPR Breakout | Breakout | Vivek Bajaj |
| 9/20 EMA Crossover | Trend Following | Power of Stocks |
| Failed Breakout | Mean Reversion | Al Brooks |
| Opening Momentum | Momentum | Intraday Momentum |
| Mean Reversion | Mean Reversion | Statistical |
| Bollinger Breakout | Breakout | Volatility |
| SuperTrend | Trend Following | ATR-Based |
| Option Momentum | Option | OI + Volume |
| Price Action | Trend Following | Pattern Based |
| Custom Strategy | Custom | User Defined |

Each strategy supports:
- **Capital Allocation** — % of portfolio
- **Risk Per Trade** — % of capital
- **Max Trades/Day**
- **Max Consecutive Losses**
- **Confidence Threshold**
- **Cooldown After Loss**
- **Trading Session** — FULL, MORNING, AFTERNOON, CUSTOM
- **Strategy-specific Parameters** — dynamically from registry

---

## AI Decision Engine

Every trade signal contains an `AIReasoningReport`:

- **Confidence Score** — weighted 6-factor analysis
- **Trade Grade** — A+, A, B, C, REJECT
- **Factor Breakdown**:
  | Factor | Weight | Description |
  |--------|--------|-------------|
  | Trend Alignment | 20% | Price vs EMA20 alignment |
  | Volume Confirmation | 15% | Volume > 1.2x average |
  | ATR Validation | 15% | Stop loss > 0.5 ATR |
  | Risk Reward | 20% | Minimum 1:1.5 R:R |
  | Time Filter | 10% | Within optimal hours |
  | Market Structure | 20% | Structure aligns with signal |

---

## Command Center

Merged **Dashboard** + **AI CIO** into a single supervision hub with two tabs:

### Overview Tab
- Bot status, Portfolio P&L, Today's trades
- Capital used, Daily risk used (progress bars)
- Health Score, Execution Score
- Market Regime display with confidence and color coding
- Active AI Recommendations with apply action

### AI CIO Tab
- **Market Regime Detection**: Trending Up/Down, Sideways, Volatile, Low Volatility, Gap Day, Expiry Day, Event Day
- **Performance Forecast**: Expected return, volatility, win probability
- **Kimi AI Chat**: Natural language interface for portfolio queries

### Kimi AI (Moonshot) Chat

The AI CIO includes a **natural language chat interface** powered by Kimi K2.6:

- Ask questions like *"How did we perform today?"*, *"Why did Strategy Alpha lose money?"*
- AI explains trade decisions with institutional reasoning
- LLM-powered regime detection with detailed justification
- Graceful fallback to rule-based CIO when AI is unavailable

**Environment Variables:**
```
KIMI_API_KEY=sk-your-key
KIMI_MODEL=kimi-k2.6
KIMI_BASE_URL=https://api.moonshot.ai/v1
```

**Supported Models:** `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k`, `kimi-k2.6`
**Supported Endpoints:** `api.moonshot.cn/v1`, `api.moonshot.ai/v1`, `api.kimi.ai/v1`

---

## Portfolio Risk Engine

- Total Exposure & Portfolio Drawdown
- Daily/Weekly/Monthly Risk Limits
- VaR (95%, 99%)
- Directional, Delta, Gamma, Theta, Vega Exposure
- Strategy Concentration Limits
- Circuit Breakers with automatic halt
- Stress Test Results

---

## Tech Stack

- **Frontend**: React 19 + TypeScript 5.9 + Tailwind CSS + Vite
- **State Management**: React Context + useReducer
- **Backend**: Node.js + Express
- **AI Engine**: Kimi (Moonshot) LLM with configurable base URL
- **Broker Integration**: FYERS API v3
- **Real-time Data**: WebSocket tick streaming

---

## Quick Start

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

### Merged Pages

| Before | After |
|--------|-------|
| Dashboard + AI CIO | **Command Center** |
| Backtest + Visual Backtest | **Backtest Lab** |
| Market Monitor + Market Intelligence | **Market Intelligence** |

Navigation simplified from 13 items → 10 items.

---

## Operations & Deployment

### Infrastructure

| Layer | Technology | Location |
|-------|-----------|----------|
| **Frontend** | React + Vite | GitHub Pages (`https://roshanvijay.com`) |
| **Backend** | Node.js + Express | Ubuntu EC2 (`api.roshanvijay.com`) |
| **Process Manager** | PM2 | Ubuntu |
| **Reverse Proxy** | nginx | Ubuntu |
| **AI Engine** | Kimi (Moonshot) API | External |
| **Broker** | FYERS (v3 API) | External |

### Environment Setup

**.env file location:** `~/trading-os/.env` — only ONE file needed.

**Current production `.env`:**
```bash
# Kimi Model (override if needed)
# Options: moonshot-v1-8k | moonshot-v1-32k | moonshot-v1-128k | moonshot:kimi-k2.6
KIMI_MODEL=moonshot:kimi-k2.6
KIMI_API_KEY=REDACTED-KIMI-KEY
FYERS_APP_ID=REDACTED-APP-ID
FYERS_SECRET_ID=REDACTED-SECRET
FYERS_REDIRECT_URL=https://roshanvijay.com
PORT=3001
KIMI_BASE_URL=https://api.moonshot.ai/v1
```

**Template for new setups:**
```bash
# FYERS API credentials
FYERS_APP_ID=REDACTED-APP-ID
FYERS_SECRET_ID=your-secret-here
FYERS_REDIRECT_URL=https://roshanvijay.com

# Server settings
PORT=3001
FRONTEND_URL=https://roshanvijay.com

# JWT secret for session tokens
JWT_SECRET=REDACTED-JWT

# Kimi AI (Moonshot) API Key
# Get from https://platform.moonshot.ai/
KIMI_API_KEY=sk-your-key-here
KIMI_MODEL=moonshot:kimi-k2.6
KIMI_BASE_URL=https://api.moonshot.ai/v1
```

### Quick Deploy (One-Liner)

```bash
cd ~/trading-os && git pull origin main && npm install && pm2 restart trading-os
```

Or step by step:

```bash
cd ~/trading-os
git pull origin main
npm install
pm2 restart trading-os
```

### Full Reset & Restart

```bash
cd ~/trading-os
git fetch origin
git reset --hard origin/main
npm install
pm2 delete trading-os
pm2 start server/src/index.js --name trading-os
pm2 save
```

### Health Checks

```bash
curl https://api.roshanvijay.com/api/health
curl https://api.roshanvijay.com/api/auth/login
curl https://api.roshanvijay.com/api/ai/status
```

### PM2 Commands

```bash
pm2 list
pm2 logs trading-os --lines 50
pm2 restart trading-os --update-env
pm2 monit
```

### Nginx Config

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

### Set KIMI_API_KEY

```bash
echo "KIMI_API_KEY=sk-your-new-key" >> ~/trading-os/.env
pm2 restart trading-os --update-env
```

Or replace existing:
```bash
sed -i 's/KIMI_API_KEY=.*/KIMI_API_KEY=sk-your-new-key/' ~/trading-os/.env
pm2 restart trading-os --update-env
```

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502 Bad Gateway` | Backend not running | `pm2 start server/src/index.js --name trading-os` |
| `Cannot find module` | Missing dependency | `npm install` then restart |
| `Connection refused` on :3001 | Backend crashed | Check `pm2 logs trading-os` |
| `FYERS_APP_ID not configured` | `.env` not loaded | Ensure `.env` is at `~/trading-os/.env` |
| `Kimi API error 401` | Invalid key | Regenerate at platform.moonshot.ai |
| Port already in use | Old process running | `sudo lsof -i :3001` then `kill -9 <PID>` |

### Swap for npm install

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Firewall

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

### SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## Documentation

- [FEATURES.md](FEATURES.md) — Feature specifications
- [ARCHITECTURE.md](ARCHITECTURE.md) — Architecture deep dive

---

## License

Private / Institutional Use Only
