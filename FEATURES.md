# TradingOS — Automation-First Trading Platform

> **I do not trade. I supervise.**

TradingOS is an institutional-grade automated trading platform. The system is designed exclusively for algorithmic execution — no manual order placement is supported.

## Architecture Philosophy

- **Operator, not Trader**: Your role is to configure, monitor, and improve algorithms
- **Bot-Only Execution**: Only the trading bot can place, manage, and exit positions
- **Read-Only Market Data**: Market surveillance without execution capability
- **Risk-First Design**: All guardrails are enforced programmatically

---

## Pages

### Dashboard
- Bot status indicator (Running / Stopped / Emergency)
- Today's P&L with real-time updates
- Current positions managed by bot
- Trade count vs daily limit
- Bot health, broker status, market status
- Daily risk used vs limit
- Current strategy (5 EMA)
- System logs stream
- Last executed trade summary
- Strategy status with scan state

### Market Monitor
- Live option chain for NIFTY and BANKNIFTY
- Real-time spot price with OHLC
- ATM strike highlighting
- Put/Call Ratio (PCR)
- Total OI for CE and PE
- Auto-refreshing read-only data
- **No trading actions — surveillance only**

### Trading Bot
- **Start Bot** — Begin automated scanning and execution
- **Stop Bot** — Halt new signal generation
- **Emergency Stop** — Immediately kill all positions and halt
- Paper trading toggle
- Strategy configuration (risk %, lot sizing, max trades)
- Active positions with live P&L
- Recent signals with execution status
- Real-time execution logs
- Daily P&L tracking
- Risk system status
- Execution mode (LIVE / PAPER)

### Backtest
- Strategy backtesting engine
- Multi-strategy comparison
- Configurable parameters

### Visual Backtest
- Chart-based backtest visualization

### Journal
- Automated trade audit trail
- Bot-execution tagging
- P&L review

### Reports
- Performance analytics

### Settings
- Bot risk parameters
- Capital allocation
- Daily limits

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
- `GET /api/auto-trade/status`
- `GET /api/auto-trade/performance`
- `POST /api/auto-trade/paper-trading`
- `POST /api/auto-trade/config`
- `GET /api/auto-trade/audit`

### Backtest
- `GET /api/backtest/symbols`
- `POST /api/backtest/run`
- `POST /api/backtest/run-multi`

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

## UI Philosophy

Every page reinforces:

> **"I do not trade. I supervise."**

No UI encourages discretionary intervention. The interface resembles a professional automated trading system — Bloomberg Terminal meets QuantConnect.