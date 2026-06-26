# TradingOS — Institutional Grade Autonomous Trading Platform

> **"I do not trade. I supervise."**

TradingOS is an institutional-grade autonomous trading platform designed for hedge funds, quantitative firms, and proprietary trading desks. The system is **completely automation-first** — no manual order placement is supported.

---

## Philosophy

- **Operator, not Trader**: Configure strategies, monitor execution, review performance
- **Bot-Only Execution**: Only the trading bot can place, manage, and exit positions
- **Read-Only Market Data**: Market surveillance without execution capability
- **Risk-First Design**: All guardrails are enforced programmatically
- **Single Source of Truth**: Backtest and live trading use identical strategy code
- **AI Supervision**: Every trade contains an AI reasoning report

---

## Pages

### Command Center
Merged **Dashboard** + **AI CIO** with two tabs:

**Overview Tab:**
- Bot status indicator (Running / Stopped / Emergency)
- Today's P&L with real-time updates
- Current positions managed by bot
- Trade count vs daily limit
- Bot health, broker status, market status
- Daily risk used vs limit
- **Running Strategies** count with status
- **Paused Strategies** count
- System logs stream
- Last executed trade summary
- Strategy status with scan state
- **Health Score** and **Execution Score**
- Active alerts and warnings

**AI CIO Tab:**
- **Current Market Regime** display with confidence
- Regime types: Trending Up/Down, Sideways, Volatile, Low Volatility, Gap Day, Expiry Day, Event Day
- **Market Context**: VIX, PCR, OI Buildup, A/D Ratio
- **Performance Forecast**: Expected Return, Volatility, Win Probability
- **AI Recommendations** with urgency levels (LOW, MEDIUM, HIGH, CRITICAL)
- Apply recommendation action
- **Applied Adjustments** history with before/after values
- **Natural Language Chat** powered by Kimi K2.6

### Strategy Manager
- **17 Strategies** with enable/disable checkboxes
- Capital Allocation % per strategy
- Risk % per strategy
- Max Trades per strategy
- Max Consecutive Losses
- Trading Session selection (FULL, MORNING, AFTERNOON, CUSTOM)
- Allowed Symbols per strategy
- Allowed Expiry (WEEKLY, MONTHLY, BOTH)
- Allowed Days
- Max Drawdown limit
- Daily Loss Limit
- Cooldown After Loss (minutes)
- Confidence Threshold
- Priority and Execution Weight
- **Strategy-specific Parameters** dynamically loaded from registry
- Category filtering (Trend Following, Mean Reversion, Momentum, Breakout, Option, Custom)
- Real-time allocation tracker with over-allocation warnings
- Individual strategy status (ACTIVE, PAUSED, COOLDOWN, HALTED, DISABLED)

### Trading Bot
- **Start Bot** — Begin automated scanning and execution
- **Stop Bot** — Halt new signal generation
- **Emergency Stop** — Immediately kill all positions and halt
- **Reset E-Stop** — Clear emergency state and resume readiness
- Paper trading toggle
- Strategy configuration (risk %, lot sizing, max trades)
- Active positions with live P&L
- Recent signals with execution status
- Real-time execution logs
- Daily P&L tracking
- Risk system status
- Execution mode (LIVE / PAPER)

### Risk Dashboard
- **Total Exposure** monitoring
- **Portfolio Drawdown** with limits
- **Daily Risk Used** vs limit
- **Capital Utilized** percentage
- **Strategy Exposure** breakdown
- **Directional Exposure** (net long/short)
- **Delta, Gamma, Theta, Vega Exposure**
- **Net Premium Risk**
- **VaR (95%, 99%)**
- **Risk Limits** configuration
- **Active Risk Breaches** with severity
- **Stress Test Results** (PASS/FAIL)
- Circuit breaker status

### Market Intelligence
Merged **Market Monitor** + **Market Intelligence**:

**Live Tab:**
- Live option chain for NIFTY and BANKNIFTY
- Real-time spot price with OHLC
- ATM strike highlighting
- Put/Call Ratio (PCR)
- Total OI for CE and PE
- Auto-refreshing read-only data
- **No trading actions — surveillance only**

**Analytics Tab:**
- **Advance/Decline** metrics
- **Put/Call Ratio (PCR)** with percentile
- **Max Pain** strike
- **Expected Move** with confidence
- **IV Rank** and **IV Percentile**
- **IV Skew** and ATM IV
- **Institutional Flow**: FII/DII Cash & F&O
- **OI Heatmap** visualization
- Market breadth indicators

### Live Chart
- SVG candlestick chart with volume bars
- Symbol selector: BANKNIFTY, NIFTY 50, FINNIFTY, SENSEX
- Timeframe selector: 1m, 5m, 15m, 30m, 1h, Daily
- Auto-refresh every 5 seconds when market is open
- OHLC bar for latest candle
- Shows historical data when market is closed
- Market status indicator (Open / Closed / Holiday)

### Backtest Lab
Merged **Backtest** + **Visual Backtest**:

- Strategy backtesting using **unified engine** (same code as live trading)
- **17 strategies** available
- Configurable parameters
- Default date range: **5 years ago → today**
- **View Toggle**: Both | Table | Chart
- **Table View**: Trade log with entry/exit/P&L details
- **Chart View**: Equity curve with trade markers (lightweight-charts)
- **AI Reasoning Reports** on every simulated trade
- **Trade Grades** (A+, A, B, C, REJECT)
- **Capital Mode**: Compounding vs Fixed

### Journal
- Automated trade audit trail
- Bot-execution tagging
- P&L review
- **AI Comments** on each trade
- **Trade Grade** record
- Screenshot and chart capture

### Reports
- Performance analytics
- **Sharpe Ratio**, **Sortino Ratio**, **Calmar Ratio**
- **Profit Factor**, **SQN**, **Expectancy**
- Equity curve visualization
- Hourly/Weekday/Monthly performance breakdown
- Strategy comparison
- Export PDF / Excel

### Settings
- Broker configuration
- Risk parameters
- Capital allocation
- Daily limits
- Strategy defaults
- Trading sessions
- Notifications
- Paper trading
- Emergency stop
- Execution engine
- AI engine
- Logging
- Reports
- Backup and audit

---

## Backend API

### Authentication
- `GET /api/auth/login` — FYERS OAuth URL
- `POST /api/auth/callback` — Token exchange
- `POST /api/auth/logout` — Session termination

### Account (Read-Only Market Data)
- `GET /api/account/profile`
- `GET /api/account/funds`
- `GET /api/account/holdings`
- `GET /api/account/positions`
- `POST /api/account/quote` — Live quotes
- `GET /api/account/option-chain` — Options data

### Orders (Read-Only Audit)
- `GET /api/orders/history` — Order book
- `GET /api/orders/trades/today` — Today's trades

### Auto Trading (Bot Control)
- `POST /api/auto-trade/start`
- `POST /api/auto-trade/stop`
- `POST /api/auto-trade/emergency-stop`
- `POST /api/auto-trade/reset-emergency` — Clear emergency halt
- `GET /api/auto-trade/status`
- `GET /api/auto-trade/performance`
- `POST /api/auto-trade/paper-trading`
- `POST /api/auto-trade/config`
- `GET /api/auto-trade/audit`

### Backtest
- `GET /api/backtest/symbols`
- `POST /api/backtest/run`
- `POST /api/backtest/run-multi`
- `GET /api/backtest/holidays` — NSE trading holidays
- `POST /api/backtest/holidays/refresh` — Refresh from NSE

### AI CIO (Kimi Integration)
- `GET /api/ai/status` — Check AI connection health
- `POST /api/ai/cio/query` — Natural language query with context
- `POST /api/ai/cio/regime` — LLM-powered regime detection
- `POST /api/ai/trade/review` — AI trade review with grading

**Environment Variables:**
```
KIMI_API_KEY=sk-your-key
KIMI_MODEL=kimi-k2.6
KIMI_BASE_URL=https://api.moonshot.ai/v1
```

---

## What Was Removed

All manual trading features have been eliminated:

- ❌ Manual Buy/Sell buttons
- ❌ Order placement forms
- ❌ Quantity/Price/Order type inputs
- ❌ MIS/CNC/BO/CO selectors
- ❌ Manual order confirmation dialogs
- ❌ Manual position closing
- ❌ Manual symbol search for trading
- ❌ Emotion evaluation engine
- ❌ Daily constitution/affirmations
- ❌ Manual trade validation UI
- ❌ `POST /api/orders/place`
- ❌ `DELETE /api/orders/cancel`

---

## AI Decision Engine

Every trade signal contains an `AIReasoningReport`:

| Factor | Weight | Description |
|--------|--------|-------------|
| Trend Alignment | 20% | Price vs EMA20 alignment |
| Volume Confirmation | 15% | Volume > 1.2x average |
| ATR Validation | 15% | Stop loss > 0.5 ATR |
| Risk Reward | 20% | Minimum 1:1.5 R:R |
| Time Filter | 10% | Within optimal hours |
| Market Structure | 20% | Structure aligns with signal |

**Trade Grades**: A+ | A | B | C | REJECT

---

## Strategies (17)

| # | Strategy | Category | Author |
|---|----------|----------|--------|
| 1 | 5 EMA Trend | Trend Following | Subhasish Pani |
| 2 | 5 EMA Option Buying | Option | Subhasish Pani |
| 3 | RSI 2-Period | Mean Reversion | Larry Connors |
| 4 | Traffic Light | Trend Following | Subhasish Pani |
| 5 | Inside Candle Breakout | Breakout | Price Action |
| 6 | VWAP Reversal | Mean Reversion | Anant Ladha |
| 7 | Opening Range Breakout | Breakout | Toby Crabel |
| 8 | CPR Breakout | Breakout | Vivek Bajaj |
| 9 | 9/20 EMA Crossover | Trend Following | Power of Stocks |
| 10 | Failed Breakout | Mean Reversion | Al Brooks |
| 11 | Opening Momentum | Momentum | Intraday Momentum |
| 12 | Mean Reversion | Mean Reversion | Statistical |
| 13 | Bollinger Breakout | Breakout | Volatility |
| 14 | SuperTrend | Trend Following | ATR-Based |
| 15 | Option Momentum | Option | OI + Volume |
| 16 | Price Action | Trend Following | Pattern Based |
| 17 | Custom Strategy | Custom | User Defined |

---

## Market Holidays

NSE trading holidays are handled dynamically:

- **Backend** fetches from NSE API (`nseindia.com/api/holiday-master`) on startup
- **Fallback**: Cached list stored in `data/holidays.json`
- **Manual refresh**: `POST /api/backtest/holidays/refresh`
- **Frontend** Chart and Bot both respect holidays
- Shows holiday name (e.g., "Holiday — Republic Day") instead of "Market Open"

---

## UI Philosophy

Every page reinforces:

> **"I do not trade. I supervise."**

No UI encourages discretionary intervention. The interface resembles a professional automated trading system — Bloomberg Terminal meets QuantConnect meets Jane Street internal tools.

---

## Documentation

- [README.md](README.md) — Overview and quick start
- [ARCHITECTURE.md](ARCHITECTURE.md) — Architecture deep dive

---

## License

Proprietary — Institutional Trading Platform