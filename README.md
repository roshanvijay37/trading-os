# TradingOS — Institutional Grade Autonomous Trading Platform

> **"I do not trade. I supervise."**

TradingOS is an institutional-grade autonomous trading platform designed for hedge funds, quantitative firms, and proprietary trading desks. The system is **completely automation-first** — no manual order placement is supported. The human only configures strategies, supervises execution, analyses performance, and continuously improves the system.

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
│  ├── Command Center         Dashboard + AI CIO merged        │
│  ├── Strategy Manager       Enable/disable/configure (17)    │
│  ├── Risk Dashboard         Portfolio risk monitoring        │
│  ├── Market Intelligence    Live data + analytics merged     │
│  ├── Trading Bot            Automated execution control      │
│  ├── Live Chart             Technical analysis               │
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

| Page | Purpose | New |
|------|---------|-----|
| **Command Center** | Bot status, P&L, AI CIO, regime, chat | ✅ |
| **Strategy Manager** | Enable/disable 17 strategies, configure capital allocation, risk, sessions | ✅ |
| **Trading Bot** | Start/stop bot, emergency controls, execution logs | |
| **Risk Dashboard** | Portfolio risk monitoring, VaR, circuit breakers, stress tests | ✅ |
| **Market Intelligence** | Live option chains + PCR, IV, institutional flow analytics | ✅ |
| **Live Chart** | SVG candlestick with volume, timeframe selector | |
| **Backtest Lab** | Strategy backtest with table/chart toggle | ✅ |
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

## Command Center

Merged **Dashboard** + **AI CIO** into a single supervision hub with two tabs:

### Overview Tab
- Bot status, Portfolio P&L, Today's trades
- Capital used, Daily risk used
- Health Score, Execution Score
- Market Regime display with confidence
- Active AI Recommendations with apply action

### AI CIO Tab
- **Market Regime Detection**: Trending Up/Down, Sideways, Volatile, Low Volatility, Gap Day, Expiry Day, Event Day
- **Market Context**: VIX, PCR, OI Buildup, Advance/Decline Ratio
- **Performance Forecast**: Expected return, volatility, win probability
- **Adjustments**: Tracked portfolio changes with before/after values

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
# Frontend
cd trading-os
npm install
npm run dev

# Backend
cd server
npm install
npm run dev
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

Proprietary — Institutional Trading Platform