# TradingOS — Institutional Grade Autonomous Trading Platform

## Architecture Overview

> **"I do not trade. I supervise."**

This document explains the institutional-grade architecture of TradingOS.

---

## Philosophy

The system is **completely automation-first**. The human never buys or sells manually.

- ❌ No Manual Buy
- ❌ No Manual Sell
- ❌ No Manual Exit
- ❌ No Manual Quantity Selection
- ❌ No Manual Order Placement
- ❌ No Manual Symbol Trading
- ❌ No Manual Price Entry

The bot does everything. The user only supervises.

---

## Module Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRADINGOS PLATFORM                        │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (React + Tailwind)                                │
│  ├── Command Center         Dashboard + AI CIO merged       │
│  ├── Strategy Manager       Enable/disable/configure (2)    │
│  ├── Risk Dashboard         Portfolio risk monitoring       │
│  ├── Market Intelligence    PCR, OI, IV, Flow, Gamma        │
│  ├── Trading Bot            Start/stop, emergency, logs     │
│  ├── Live Chart             SVG candlestick analysis        │
│  ├── Backtest Lab           Table/chart toggle view         │
│  ├── Journal                Automatic trade audit           │
│  ├── Reports                Performance analytics           │
│  └── Settings               Platform configuration          │
├─────────────────────────────────────────────────────────────┤
│  State Management (React Context + useReducer)              │
│  ├── InstitutionalProvider   Central state container         │
│  └── useInstitutionalStore   Hook for all components         │
├─────────────────────────────────────────────────────────────┤
│  Core Engine (TypeScript - Single Source of Truth)          │
│  ├── Strategy Registry       Both 5 EMA strategies defined       │
│  ├── Strategy Engine         Unified backtest + live logic   │
│  ├── AI Reasoning Engine     Trade grade generation          │
│  └── Indicator Library       EMA, RSI, VWAP, ATR, BB, ST    │
├─────────────────────────────────────────────────────────────┤
│  Type System (institutional.ts)                             │
│  ├── Strategy System         Configs, states, positions      │
│  ├── AI Decision Engine      Reasoning reports, grades       │
│  ├── AI CIO                  Regime detection, adjustments   │
│  ├── Portfolio Risk          Exposure, limits, breaches      │
│  ├── Market Intelligence     PCR, OI, IV, Flow, Gamma        │
│  ├── Execution Engine        Orders, retry, health           │
│  ├── Bot Health              System metrics, components       │
│  ├── Trade Review            Post-trade analysis             │
│  ├── Reporting               Performance analytics            │
│  ├── Replay & Simulation     Historical playback             │
│  └── Settings                Complete platform config         │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Single Source of Truth for Strategies

**Problem**: Original codebase had duplicate strategy logic — one for backtest, one for live trading.

**Solution**: `src/lib/strategies/engine.ts`

Every strategy is implemented ONCE. Both backtest and live trading use the exact same code:
- `runStrategy()` — generates signals from candles
- `runBacktestEngine()` — runs backtest using same signals
- Live trading calls `runStrategy()` on each new candle

**Strategies Implemented**:
- EMA5 (Subhasish Pani)
- EMA5 Option Buying

> **Where the canonical logic lives:** the live bot (`server/src/services/autoTrader.js`) and the
> server-side backtest (`server/src/routes/backtest.js`) both share the 5-EMA + alert rule in
> **`server/src/services/signalCore.js`** — that is the real single source of truth. The TypeScript
> `src/lib/strategies/engine.ts` (unit-tested) mirrors the same math for the frontend; keep the two
> definitions identical so live and backtest never diverge.

### 2. AI Reasoning Engine

Every trade signal contains an `AIReasoningReport`:
- **Confidence Score** — weighted factor analysis
- **Trade Grade** — A+, A, B, C, REJECT
- **Factor Breakdown** — Trend, Volume, ATR, R:R, Time, Structure
- **Warnings** — Failed factor explanations

Factors analyzed:
| Factor | Weight | Description |
|--------|--------|-------------|
| Trend Alignment | 20% | Price vs EMA20 alignment |
| Volume Confirmation | 15% | Volume > 1.2x average |
| ATR Validation | 15% | Stop loss > 0.5 ATR |
| Risk Reward | 20% | Minimum 1:1.5 R:R |
| Time Filter | 10% | Within optimal hours |
| Market Structure | 20% | Structure aligns with signal |

### 3. AI Chief Investment Officer

Monitors market regime and makes portfolio adjustments:
- **Regime Detection**: Trending Up/Down, Sideways, Volatile, Low Vol, Gap Day, Expiry Day, Event Day
- **Market Context**: VIX, PCR, OI Buildup, A/D Ratio
- **Performance Forecast**: Expected return, volatility, win probability
- **Recommendations**: Auto-generated with urgency levels (LOW → CRITICAL)
- **Adjustments**: Applied changes tracked with before/after values

### 4. Portfolio Risk Engine

Institutional-grade risk monitoring:
- Total Exposure & Portfolio Drawdown
- Daily/Weekly/Monthly Risk Limits
- VaR (95%, 99%)
- Directional, Delta, Gamma, Theta, Vega Exposure
- Strategy Concentration Limits
- Circuit Breakers with automatic halt
- Stress Test Results

### 5. Strategy Manager

Professional strategy configuration:
- **Enable/Disable** with checkboxes
- **Capital Allocation** — percentage of portfolio
- **Risk Per Trade** — % of capital
- **Max Trades/Day**
- **Max Consecutive Losses**
- **Confidence Threshold**
- **Cooldown After Loss**
- **Strategy-specific Parameters** — dynamically generated from registry
- **Trading Session** — FULL, MORNING, AFTERNOON, CUSTOM
- **Allowed Symbols** — per strategy instrument list

### 6. Multi-Strategy Engine

Support running multiple strategies simultaneously:
- Each strategy maintains independent positions
- Each strategy has independent P&L tracking
- Capital allocation enforces portfolio-level limits
- Over-allocation warnings when total > 100%

---

## File Structure

```
src/
├── types/
│   └── institutional.ts          # Complete type system
├── lib/
│   └── strategies/
│       ├── registry.ts            # Strategy definitions (2 strategies)
│       └── engine.ts              # Unified backtest + live engine
├── store/
│   └── InstitutionalProvider.tsx  # React Context state management
├── pages/
│   ├── CommandCenter.tsx          # Dashboard + AI CIO merged
│   ├── AutoTrade.tsx              # Bot control + positions + logs
│   ├── StrategyManager.tsx        # Strategy configuration UI
│   ├── RiskDashboard.tsx          # Portfolio risk monitoring
│   ├── MarketIntelligence.tsx     # Market analytics
│   ├── BacktestLab.tsx            # Backtest + visual chart
│   ├── Chart.tsx                  # Live SVG candlestick
│   ├── Dashboard.tsx              # Legacy dashboard (redirects)
│   ├── Journal.tsx                # Trade audit trail
│   ├── Reports.tsx                # Performance analytics
│   └── Settings.tsx               # Platform configuration
├── components/
│   ├── Card.tsx                   # Institutional panel card
│   ├── Layout.tsx                 # Sidebar + status bar + header
│   ├── MetricCard.tsx             # Metric display component
│   └── FyersConnect.tsx           # Broker connection badge
├── styles.css                     # Global dark theme + utilities
├── tailwind.config.js             # Institutional color tokens
└── App.tsx                        # Routes
```

---

## Why This Architecture?

### Institutional Use Case

| Feature | Institutional Need |
|---------|-------------------|
| Single Source of Truth | Prevents strategy drift between backtest and live |
| AI Reasoning | Regulatory compliance, audit trails |
| Risk Engine | Prevents catastrophic losses |
| CIO | Adapts to changing market conditions |
| Strategy Manager | Portfolio-level allocation control |
| Market Intelligence | Informed decision making |

### Scalability

- **Modular Design**: Each engine is independent
- **Type Safety**: Full TypeScript coverage
- **State Management**: Centralized with predictable updates
- **Extensibility**: New strategies added via registry only

### Testing

- Strategy engine is pure functions — easily unit testable
- Backtest results are deterministic
- AI reasoning is inspectable and auditable
- Risk engine validates all decisions

---

## Future Extensibility

The architecture supports:

1. **Strategy Versioning** — version field in registry + state
2. **Replay Mode** — use backtest engine with recorded data
3. **Simulation Lab** — stress test using modified market data
4. **NL Command Center** — query state with natural language
5. **Advanced Reporting** — metrics already calculated in backtest
6. **Execution Engine** — hook into `runStrategy()` output
7. **Bot Health** — monitor component added to state

---

## Integration with Existing Application

The new institutional architecture wraps the existing application:

- `App.tsx` uses `InstitutionalProvider`
- All existing pages continue to work
- New pages are additive (Strategy Manager, Risk, CIO, Intelligence)
- Backtest page uses `runBacktestEngine()` from unified engine
- AutoTrade page uses `runStrategy()` for live signals

---

## API Design

The state management exposes:

```typescript
// Strategy Actions
toggleStrategy(id)
enableStrategy(id)
disableStrategy(id)
pauseStrategy(id)
resumeStrategy(id)
setStrategyConfig(id, config)

// Risk Actions
setPortfolioRisk(risk)
addRiskBreach(breach)
resolveRiskBreach(id)

// CIO Actions
setCIOState(cio)
applyCIORecommendation(id)

// Platform Actions
setRunning(running)
emergencyStopAll()
resetEmergencyStop()
startAllStrategies()
stopAllStrategies()
```

---

## Conclusion

TradingOS has been transformed from a single-strategy bot into a multi-strategy institutional platform with:

- **2 trading strategies** (5 EMA trend + 5 EMA option) with unified implementation
- **AI reasoning** on every trade
- **AI CIO** for market regime management
- **Portfolio risk engine** with circuit breakers
- **Market intelligence** dashboard
- **Professional strategy manager** with allocation controls

The architecture is production-ready, modular, and designed for institutional use.