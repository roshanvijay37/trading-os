# TradingOS - Feature Documentation

> **Version**: 1.0.0  
> **Last Updated**: June 25, 2026  
> **Author**: Roshan Vijay  
> **Description**: Complete trading platform for FYERS broker with automated 5 EMA strategy execution, backtesting, and live trading capabilities.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Authentication](#authentication)
3. [Dashboard](#dashboard)
4. [Live Trading](#live-trading)
5. [Auto Trading (Bot)](#auto-trading-bot)
6. [Backtest Engine](#backtest-engine)
7. [Visual Backtest](#visual-backtest)
8. [Trade Journal](#trade-journal)
9. [Reports & Analytics](#reports--analytics)
10. [Settings](#settings)
11. [API Endpoints](#api-endpoints)
12. [Strategies](#strategies)
13. [Configuration](#configuration)
14. [Deployment](#deployment)

---

## System Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript + Tailwind CSS + Vite |
| **Backend** | Node.js + Express + ES Modules |
| **Charts** | Lightweight Charts v4 (TradingView-style) |
| **Broker** | FYERS API v3 |
| **Hosting** | GitHub Pages (Frontend) + Ubuntu VPS (Backend) |
| **Process Manager** | PM2 |

### Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   GitHub Pages  │────▶│   Ubuntu VPS     │────▶│  FYERS API  │
│  (React App)    │     │  (Node/Express)  │     │             │
└─────────────────┘     └──────────────────┘     └─────────────┘
                               │
                        ┌──────┴──────┐
                        │  In-Memory  │
                        │   Session   │
                        │    Store    │
                        └─────────────┘
```

### File Structure

```
trading-os/
├── src/                          # Frontend
│   ├── components/               # Reusable UI components
│   │   ├── Layout.tsx           # Sidebar + navigation
│   │   ├── Card.tsx             # Stats card component
│   │   └── FyersConnect.tsx     # Broker connection widget
│   ├── pages/                   # Route pages
│   │   ├── Dashboard.tsx        # Main dashboard
│   │   ├── LiveTrade.tsx        # Manual order placement
│   │   ├── AutoTrade.tsx        # Bot control panel
│   │   ├── Backtest.tsx         # Strategy backtester
│   │   ├── VisualBacktest.tsx   # Chart-based backtest
│   │   ├── Journal.tsx          # Trade journal
│   │   ├── Reports.tsx          # Performance reports
│   │   ├── Settings.tsx         # User preferences
│   │   └── Constitution.tsx     # Terms acceptance
│   ├── services/
│   │   ├── api.ts               # API client (all endpoints)
│   │   └── storage.ts           # LocalStorage helpers
│   └── hooks/
│       └── useDailyAccess.ts    # Daily constitution check
├── server/                       # Backend
│   └── src/
│       ├── index.js             # Express server setup
│       ├── routes/
│       │   ├── auth.js          # FYERS OAuth flow
│       │   ├── account.js       # Profile, funds, positions
│       │   ├── orders.js        # Order placement/cancel
│       │   ├── backtest.js      # Backtest engine
│       │   ├── autoTrade.js     # Bot control API
│       │   └── auth.js          # Session management
│       └── services/
│           ├── emaStrategy.js   # 5 EMA strategy logic
│           ├── autoTrader.js    # Automated trading engine
│           └── fyersService.js  # FYERS API wrapper
├── .github/
│   └── workflows/
│       └── deploy.yml           # GitHub Actions CI/CD
└── package.json
```

---

## Authentication

### FYERS OAuth 2.0 Integration

1. **Login Flow**: User clicks "Connect FYERS" → Redirected to FYERS auth URL → User logs in → Redirect back with auth code
2. **Token Exchange**: Backend exchanges auth code for access token
3. **Session Storage**: Session stored in-memory Map with `sessionId`
4. **Auto-Refresh**: Sessions persist until expiry (no refresh token - re-login required)

### Session Management

```javascript
// Session structure
{
  userId: "FY12345",
  accessToken: "eyJhbGciOiJIUzI1NiIs...",
  refreshToken: "...",
  appId: "YOUR_APP_ID",
  sessionId: "uuid-v4",
  createdAt: "2026-06-25T10:00:00Z"
}
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | GET | Get FYERS login URL |
| `/api/auth/callback` | POST | Exchange auth code for token |
| `/api/auth/session/:id` | GET | Check session validity |
| `/api/auth/logout` | POST | Clear session |

---

## Dashboard

### Features

- **Portfolio Overview**: Total funds, available margin, day's P&L
- **Market Status**: Live market open/close indicator
- **Quick Actions**: Connect FYERS, navigate to trading pages
- **Recent Activity**: Last 5 trades/signals

---

## Live Trading

### Manual Order Placement

- **Order Types**: Market, Limit, Stop, Stop-Limit
- **Product Types**: Intraday (MIS), Delivery (CNC), Cover Order (CO), Bracket Order (BO)
- **Symbols**: Search and select any NSE/BSE instrument
- **Validation**: Quantity checks, margin validation

### Option Chain

- **Strikes**: ATM ± 10 strikes displayed
- **Greeks**: Delta, Theta, Vega, Gamma (if available from broker)
- **LTP**: Last traded price with change indicator
- **OI**: Open Interest data

### Quote Display

- Real-time quotes for selected symbols
- Bid/Ask spread visibility
- 52-week high/low

---

## Auto Trading (Bot)

### 5 EMA Strategy (Subhasish Pani)

**Logic:**
1. **Alert Candle Detection**: Candle closes completely below 5 EMA (bullish setup) or above 5 EMA (bearish setup)
2. **Breakout Entry**: Next candle breaks above/below alert candle high/low
3. **Stop Loss**: Alert candle low (long) / high (short)
4. **Target**: 1:2 Risk:Reward minimum
5. **Time Exit**: Square off at 3:15 PM if position open

### Bot Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Auto-Start** | ✅ | Start/stop bot from UI |
| **Multi-Underlying** | ✅ | NIFTY + BANKNIFTY simultaneously |
| **Per-Underlying Alerts** | ✅ | Each index has independent alert tracking |
| **Duplicate Prevention** | ✅ | `processedSignals` Set prevents double entries |
| **State Persistence** | ✅ | Positions saved to `auto-trade-state.json` |
| **Server Restart Recovery** | ✅ | Reloads open positions on restart |
| **No Trade Limit** | ✅ | `MAX_TRADES_PER_DAY: 999` (unlimited) |
| **Trailing SL Disabled** | ✅ | `TRAILING_SL_ENABLED: false` |

### Bot Configuration

```javascript
{
  POLL_INTERVAL_MS: 30000,        // 30-second polling
  UNDERLYINGS: [
    { name: "NIFTY", symbol: "NSE:NIFTY50-INDEX", lotSize: 75 },
    { name: "BANKNIFTY", symbol: "NSE:NIFTYBANK-INDEX", lotSize: 30 }
  ],
  CAPITAL: 100000,
  RISK_PERCENT: 1,                // 1% per trade
  MAX_TRADES_PER_DAY: 999,        // Unlimited
  TARGET_MULTIPLIER: 2,           // 1:2 R:R
  TRAILING_SL_ENABLED: false,     // Disabled
  ORDER_TYPE: "LIMIT",
  SLIPPAGE_BUFFER_PCT: 0.5
}
```

### Bot Status API Response

```json
{
  "isRunning": true,
  "marketStatus": "OPEN",
  "todayTrades": 3,
  "maxTrades": 999,
  "openPositions": [...],
  "activeAlerts": {
    "NIFTY": { "type": "BULLISH", ... },
    "BANKNIFTY": null
  },
  "latestData": {
    "NIFTY": { "ltp": 24500, "candles": [...] }
  },
  "recentSignals": [...],
  "config": {...}
}
```

### UI Features

- **Start/Stop Button**: Toggle bot with one click
- **Live Stats**: Trades today, open positions, market status
- **Active Alerts**: Shows pending alert candles per underlying
- **Open Positions Table**: Real-time P&L, SL, target
- **Recent Signals**: Last 10 signals with status (EXECUTED/FAILED)

---

## Backtest Engine

### Features

- **11 Strategies**: RSI, 5 EMA, 5 EMA Option, Traffic Light, Inside Candle, VWAP, ORB, CPR, 9/20 EMA, Failed Breakout, Opening Momentum
- **Multi-Strategy Backtest**: Run multiple strategies simultaneously and compare
- **Natural Language Input**: Type strategy description, parser auto-configures
- **Customizable Parameters**: Capital, risk %, R:R, slippage, stop loss buffer
- **Date Range**: Any historical period FYERS supports

### Slippage Configuration

- **Adjustable**: 0% to 1% in 0.01% steps
- **Real-time Preview**: Shows point impact (e.g., "0.02% = ~10 pts on BANKNIFTY")
- **Applied To**: Entry and exit prices

### Backtest Metrics

| Metric | Description |
|--------|-------------|
| Total Return | % return over period |
| Win Rate | Winning trades / Total trades |
| Profit Factor | Gross profit / Gross loss |
| Expectancy | Average P&L per trade |
| Max Drawdown | Largest peak-to-trough decline |
| Avg Win/Loss | Average winning/losing trade |
| Max Consecutive Losses | Worst losing streak |

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/backtest/run` | Single strategy backtest |
| `POST /api/backtest/run-multi` | Multiple strategies comparison |
| `POST /api/backtest/data` | Raw historical data |
| `GET /api/backtest/symbols` | Available symbols & timeframes |
| `POST /api/backtest/test-range` | Test data availability |

---

## Visual Backtest

### Interactive Charts

- **Dual Charts**: Nifty 50 + Bank Nifty side-by-side
- **Candlestick Rendering**: Lightweight Charts with OHLC data
- **Trade Markers**: Entry arrows (▲/▼) and exit squares (P&L labeled)
- **Zoom/Pan**: Mouse wheel zoom, click-drag to pan
- **Visible Range**: Shows last 200 candles by default for clarity

### Premium Themes

| Theme | Bullish | Bearish | Style |
|-------|---------|---------|-------|
| **Midnight** | Green | Red | Classic dark |
| **TradingView** | Teal | Coral | Pro trading platform |
| **Ocean** | Cyan | Pink | Modern cool tones |
| **Amber** | Gold | Red | Warm luxury |

### Custom Color Picker

- **9 Adjustable Colors**: Background, text, grid, border, bullish, bearish, wick up, wick down, crosshair
- **Live Preview**: Changes apply instantly to both charts
- **Persistence**: Saved to localStorage across sessions
- **Color Input**: Native HTML5 color picker with hex display

### UI Enhancements

- **Glassmorphism**: `backdrop-blur-sm` with semi-transparent backgrounds
- **Gradient Panels**: Subtle top-to-bottom gradients
- **Glow Effects**: Lime accent glows on active elements
- **Smooth Animations**: `animate-in slide-in-from-top` on panels
- **Hover States**: Interactive stat pills and buttons

---

## Trade Journal

### Features

- **Manual Entry**: Log trades with notes, emotions, lessons
- **Tags**: Categorize trades (setup type, outcome, mistakes)
- **Search**: Filter by symbol, date, strategy, P&L
- **Statistics**: Win rate by setup, common mistakes

---

## Reports & Analytics

### Performance Reports

- **Daily/Weekly/Monthly P&L**
- **Strategy-wise Performance**: Which strategy works best
- **Drawdown Analysis**: Max drawdown periods
- **Trade Distribution**: Win/loss histogram
- **Time-based Analysis**: Best hours/days to trade

---

## Settings

### User Preferences

- **Theme**: Dark mode (default)
- **Notifications**: Browser push notifications for signals
- **Risk Parameters**: Default capital, risk %, R:R
- **API Keys**: FYERS App ID configuration

---

## API Endpoints

### Authentication

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/login` | GET | No | Get FYERS OAuth URL |
| `/api/auth/callback` | POST | No | Exchange auth code |
| `/api/auth/session/:id` | GET | No | Validate session |
| `/api/auth/logout` | POST | Session | Clear session |

### Account

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/account/profile` | GET | Session | User profile |
| `/api/account/funds` | GET | Session | Fund details |
| `/api/account/positions` | GET | Session | Open positions |
| `/api/account/holdings` | GET | Session | Stock holdings |
| `/api/account/quote` | POST | Session | Multi-symbol quotes |
| `/api/account/search` | GET | Session | Symbol search |
| `/api/account/option-chain` | GET | Session | Option chain data |

### Orders

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/orders/place` | POST | Session | Place new order |
| `/api/orders/cancel/:id` | DELETE | Session | Cancel order |
| `/api/orders/history` | GET | Session | Order history |
| `/api/orders/trades/today` | GET | Session | Today's trades |

### Auto Trading

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auto-trade/start` | POST | Session | Start bot |
| `/api/auto-trade/stop` | POST | Session | Stop bot |
| `/api/auto-trade/status` | GET | Session | Get bot status |
| `/api/auto-trade/performance` | GET | Session | Performance metrics |

### Backtest

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/backtest/run` | POST | Session | Run backtest |
| `/api/backtest/run-multi` | POST | Session | Multi-strategy |
| `/api/backtest/data` | POST | Session | Raw data |
| `/api/backtest/symbols` | GET | No | Available symbols |
| `/api/backtest/test-range` | POST | Session | Test data range |

---

## Strategies

### 1. RSI 2-Period (Mean Reversion)
- **Entry**: RSI < 10 (long), RSI > 90 (short)
- **Exit**: RSI reversion or stop loss
- **Best For**: Range-bound markets

### 2. 5 EMA (Subhasish Pani)
- **Entry**: Alert candle below/above 5 EMA + breakout
- **SL**: Alert candle extreme
- **Target**: 1:2 R:R minimum
- **Best For**: Trending markets, morning sessions

### 3. 5 EMA Option Buying
- **Entry**: 15m trend + 5m alert candle setup
- **SL**: Alert candle extreme
- **Trail**: Previous candle highs/lows
- **Best For**: Options buyers with directional bias

### 4. Traffic Light
- **Trend**: 20 EMA vs 50 EMA
- **Entry**: Pullback to 20 EMA + continuation
- **Best For**: Strong trending days

### 5. Inside Candle Breakout
- **Setup**: Mother candle + inside candle
- **Entry**: Break above inside candle high
- **Best For**: Low volatility expanding to high volatility

### 6. VWAP Reversal (Anant Ladha)
- **Entry**: Price below VWAP reclaims with volume
- **Best For**: Mean reversion at VWAP

### 7. Opening Range Breakout (ORB)
- **Entry**: Break of first 15-min range
- **Best For**: Opening momentum

### 8. CPR Breakout (Vivek Bajaj)
- **Entry**: Above CPR + volume + break of prev day high
- **Best For**: Pivot-based breakouts

### 9. 9/20 EMA Crossover
- **Trend**: 9 EMA > 20 EMA
- **Entry**: Pullback to 9 EMA
- **Best For**: Swing trading

### 10. Failed Breakout (Al Brooks)
- **Entry**: False breakdown + reclaim
- **Best For**: Trap trading

### 11. Opening Momentum
- **Entry**: First 20-min momentum
- **Best For**: Opening volatility

---

## Configuration

### Environment Variables

```bash
# Server
FYERS_APP_ID=your_app_id
FYERS_SECRET_ID=your_secret
FYERS_REDIRECT_URI=https://roshanvijay.com
PORT=3001

# Frontend (build time)
VITE_API_URL=https://api.roshanvijay.com/api
```

### FYERS API Configuration

- **App Type**: Private (for individual trading)
- **Redirect URI**: Must match exactly in FYERS dashboard
- **IPv4 Forcing**: `dns.setDefaultResultOrder("ipv4first")` for Ubuntu compatibility
- **Rate Limits**: 10 requests/second for orders, 100/day for historical data

---

## Deployment

### Frontend (GitHub Pages)

```bash
# GitHub Actions auto-deploys on push to main
# Workflow: .github/workflows/deploy.yml
npm run build  # Creates dist/ folder
# GitHub Pages serves dist/ folder
```

### Backend (Ubuntu VPS)

```bash
cd ~/trading-os
git pull origin main
npm install
npm run build
pm2 restart trading-os  # Or: pm2 start server/src/index.js --name trading-os
```

### PM2 Configuration

```bash
# Check status
pm2 status
pm2 logs trading-os

# Restart
pm2 restart trading-os

# Update on code change
pm2 reload trading-os
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name api.roshanvijay.com;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Known Limitations

| Limitation | Workaround |
|------------|-----------|
| Session lost on server restart | Re-login to FYERS |
| No real-time WebSocket | 30-second polling interval |
| Market orders have slippage | Use limit orders when possible |
| Options backtest uses index data | Adjust expectations for delta/theta |
| Single user per session | Each login creates new session |

---

## Future Enhancements

- [ ] WebSocket integration for real-time data
- [ ] Options-specific backtest ( Greeks-aware)
- [ ] Multi-leg strategies (spreads, iron condors)
- [ ] Telegram/Discord notifications
- [ ] Mobile app (React Native)
- [ ] Paper trading mode
- [ ] Strategy optimizer (walk-forward analysis)

---

## Support

- **GitHub**: https://github.com/roshanvijay37/trading-os
- **FYERS API Docs**: https://myapi.fyers.in/docsv3
- **Issue Tracker**: Use GitHub Issues

---

*Built with ❤️ for the Indian trading community*