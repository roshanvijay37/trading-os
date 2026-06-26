# TradingOS — Institutional Grade Autonomous Trading Platform

> **"I do not trade. I supervise."**

TradingOS is an institutional-grade autonomous trading platform designed for hedge funds, quantitative firms, and proprietary trading desks. The system is **completely automation-first** — no manual order placement is supported. The human only configures strategies, supervises execution, analyses performance, and continuously improves the system.

---

## Philosophy

| Principle | Description |
|-----------|-------------|
| **Operator, not Trader** | Configure strategies, monitor execution, review performance |
| **Bot-Only Execution** | Only the trading bot can place, manage, and exit positions |
| **Read-Only Surveillance** | Market data pages are strictly for monitoring |
| **Risk-First Design** | All guardrails are enforced programmatically |
| **Single Source of Truth** | Backtest and live trading use identical strategy code |
| **AI Supervision** | Every trade contains an AI reasoning report |

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
│  ├── Dashboard              Institutional command center     │
│  ├── Strategy Manager       Enable/disable/configure (17)    │
│  ├── Risk Dashboard         Portfolio risk monitoring        │
│  ├── AI CIO                 Market regime & recommendations  │
│  ├── Market Intelligence    PCR, OI, IV, Flow analytics      │
│  ├── Trading Bot            Automated execution control      │
│  ├── Market Monitor         Read-only surveillance           │
│  ├── Live Chart             Technical analysis               │
│  ├── Backtest               Strategy validation              │
│  ├── Visual Backtest        Chart-based replay               │
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

| Page | Purpose | New |
|------|---------|-----|
| **Dashboard** | Bot status, P&L, positions, system health | |
| **Strategy Manager** | Enable/disable 17 strategies, configure capital allocation, risk, sessions | ✅ |
| **Trading Bot** | Start/stop bot, emergency controls, execution logs | |
| **Risk Dashboard** | Portfolio risk monitoring, VaR, circuit breakers, stress tests | ✅ |
| **AI CIO** | Market regime detection, AI recommendations, applied adjustments | ✅ |
| **Market Intelligence** | PCR, OI, IV Rank, Max Pain, Institutional Flow | ✅ |
| **Market Monitor** | Live option chains, spot prices — read-only | |
| **Live Chart** | SVG candlestick with volume, timeframe selector | |
| **Backtest** | Strategy validation using unified engine | |
| **Visual Backtest** | Chart-based backtest review | |
| **Journal** | Automated trade audit trail with AI comments | |
| **Reports** | Performance analytics (Sharpe, Sortino, Calmar) | |
| **Settings** | Platform configuration, broker, risk, capital | |

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

## AI Chief Investment Officer

- **Market Regime Detection**: Trending Up/Down, Sideways, Volatile, Low Volatility, Gap Day, Expiry Day, Event Day
- **Market Context**: VIX, PCR, OI Buildup, Advance/Decline Ratio
- **Performance Forecast**: Expected return, volatility, win probability
- **Recommendations**: Auto-generated with urgency (LOW → CRITICAL)
- **Adjustments**: Tracked portfolio changes with before/after values

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
- **Broker Integration**: FYERS API v3
- **Real-time Data**: WebSocket tick streaming

---

## Quick Start

```bash
# Frontend
cd trading-os
npm install
npm run dev

# Backend
cd server
npm install
npm run dev
```

---

## Documentation

- [FEATURES.md](FEATURES.md) — Feature specifications
- [ARCHITECTURE.md](ARCHITECTURE.md) — Architecture deep dive

---

## License

Proprietary — Institutional Trading Platform