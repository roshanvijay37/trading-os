# TradingOS — Features

> **"I do not trade. I supervise."** — for the autonomous bot. The Options workspace is a
> deliberate, separate exception where a human places real orders manually (see below).

TradingOS runs one autonomous futures strategy (EMA5T) plus a manual options-trading
workspace, backtesting tooling, and honest-data market dashboards, on a FYERS-backed
Express API.

---

## Philosophy

- **Bot-only execution for EMA5T**: the automated strategy places, manages, and exits its
  own positions — no manual buy/sell/exit for it.
- **Manual execution, scoped**: the Options workspace is a separate, intentional
  exception — see its own section below.
- **Read-only surveillance elsewhere**: Market Intelligence and Live Chart are
  observation-only.
- **Risk-first, config-driven**: risk limits are operator-configurable (bot config panel,
  Backtest Lab), not hardcoded assumptions baked into code.
- **Single source of truth**: the live bot and the backtest replay the identical EMA5T
  rule set (`server/src/services/signalCore.js` + `emaStrategy.js`).
- **Honest data**: every number is labelled live, model-derived, end-of-day, or
  unavailable — never a fabricated placeholder shown as real.

---

## Pages

*(current routes — see `src/App.tsx` / `src/components/navigation.ts`, the single source
of truth for what's actually live)*

### Trading Bot (`/` — the home page)
- Start/Stop the bot, Emergency Stop / Reset E-Stop
- Config panel: sizing mode (risk % or fixed lots), risk per trade %, max trades/day,
  **daily loss limit %**, paper/live toggle, active strategies (EMA5T only), active
  instruments (NIFTY/BANKNIFTY), timeframes
- Active positions with live P&L, SL, fill price
- Recent signals, execution logs, data-source visibility (websocket vs. REST fallback)
- Daily P&L, risk-system status (ACTIVE/HALTED), execution mode (PAPER/LIVE), tick-feed status

The strategy itself: a 5-EMA alert-candle breakout, gated by a no-lookahead 20-EMA trend
filter, trading Bank Nifty/Nifty **futures** via a resting stop-entry order (not a market
order on signal). Paper mode runs the *same* order-placement code path as live (simulated
at the broker layer, not skipped) — see `autoTrader.js`'s `manageFuturesPending`.

**Removed circuit breakers** (deliberate product decision, not a bug): there is no VIX
filter and no consecutive-loss breaker on new entries anymore. What remains: max
trades/day, daily loss limit (flattens open positions too, not just blocks new entries),
a 14:00 IST entry cutoff, a 15:15 IST forced square-off, margin tracking across every
concurrently-open position, and a price-feed staleness check.

### Live Chart (`/chart`)
- Candlestick chart with volume
- Symbol selector, timeframe selector
- Auto-refresh while the market is open; shows historical data when closed
- Market status indicator (Open / Closed / Holiday)

### Options (`/options`)
A **separate, manual** options trading terminal — 25 panels (chain, Greeks, IV
smile/skew, OI analytics, max pain, probability, strategy builder, payoff analyzer,
screener, positions, margin, alerts, watchlist, a **live order ticket**, and more) fed by
one polling provider. This is where **real, human-initiated broker orders** get placed —
market/limit/SL/SL-M, single or basket — with a margin preview and confirmation modal,
no separate server-side risk gate. See `src/options/IMPLEMENTATION_REPORT.md` for the
full panel-by-panel breakdown and its honest-data badge system (Live / Computed / Proxy
/ EOD / No feed).

### Backtest Lab (`/backtest`)
- Runs the **actual EMA5T rules** — not a separate/simplified approximation — over
  historical candles
- **Data source toggle**: Index (years of history, not the literal traded instrument) or
  Futures (the real current-month contract, auto-resolved; From/To auto-fill to
  whatever window FYERS actually has for it)
- Configurable: capital, risk %, target R:R, slippage %, capital mode (compounding/fixed),
  **max trades/day**, **daily loss limit %** — all operator-set, not hardcoded
- View toggle: Both / Candles (with entry/exit/SL/target markers) / Table (trade log) /
  Equity chart
- The backend also still supports two older, backtest-only strategies (`EMA5` on the
  index, `EMA5_OPTION` with Black-Scholes option-premium pricing) for historical
  comparison — the UI only exposes EMA5T

### Market Intelligence (`/market-intelligence`)
Honest-sourcing analytics — nothing here is a fabricated zero shown as real:
- **Live option chain** (NIFTY/BANKNIFTY), spot OHLC, ATM strike, PCR, total OI
- **Put/Call Ratio**, **Max Pain**, **Expected Move**
- **India VIX** + **IV Rank/Percentile** from a persisted series (shows "building
  history" until enough samples accrue, never a misleading number)
- **Market Breadth (NIFTY 50)** — advance/decline derived live from constituent quotes
  (FYERS has no breadth endpoint)
- **Dealer Gamma Exposure (GEX)** — Black-Scholes model estimate, explicitly badged "Model"
- **FII/DII flow** — NSE end-of-day participant data, labelled EOD; degrades to an
  explicit "unavailable" state if NSE blocks the scrape (can happen on the deployed host)

### Journal (`/journal`)
- Automated trade audit trail

*(`/reports`, `/risk-dashboard`, and `/trading-bot` are old bookmarks that redirect to
`/journal` or `/` — those pages were removed, see "What Was Removed" below.)*

---

## Backend API

*(verified against the actual mounted routes in `server/src/index.js` — not aspirational)*

### Authentication (`/api/auth`)
- `GET /login` — FYERS OAuth URL
- `POST /callback` — exchange `auth_code` for an access token
- `GET /session/:id`, `POST /session/refresh`, `POST /logout`

### Auto Trading — the bot (`/api/auto-trade`)
- `POST /start`, `POST /stop`
- `POST /emergency-stop`, `POST /reset-emergency`
- `GET /status`, `GET /performance`, `GET /audit`
- `POST /paper-trading` — toggle paper/live (only while stopped)
- `POST /config` — update risk/strategy/instrument/timeframe config (bounds-validated;
  invalid fields are dropped, never clamped)

### Backtest (`/api/backtest`)
- `POST /run`, `POST /run-multi`, `POST /data`
- `POST /futures-range` — resolve the current futures contract + its real available date range
- `GET /symbols`, `GET /holidays`, `POST /holidays/refresh`

### Options workspace — manual live trading (`/api/options`)
- `POST /place-order`, `POST /basket-order`, `PATCH /modify-order`, `POST /cancel-order`
  — **real broker orders**
- `POST /margin` — broker margin simulator
- `GET /history` — OHLCV candles for any symbol

### Account (`/api/account`, read-only market data + broker state)
- `GET /profile`, `GET /funds`, `GET /holdings`, `GET /positions`
- `POST /quote`, `POST /depth`, `GET /search`
- `GET /option-chain` (+ India VIX), `GET /breadth`

### Orders — read-only audit (`/api/orders`)
- `GET /history`, `GET /trades/today`
- (Manual order *placement* was removed from here — it lives only under
  `/api/options/*` now, scoped to the Options workspace.)

### Market — public, no session required (`/api/market`)
- `GET /status` — NSE open/closed/holiday
- `GET /iv-history` — India VIX rank/percentile from the persisted series
- `GET /fii-dii` — FII/DII end-of-day cash flow

---

## What Was Removed

- ❌ Generic manual order placement (`POST /api/orders/place`, `DELETE /api/orders/cancel`,
  `PUT /api/orders/modify`) — manual trading now exists only in the Options workspace
- ❌ AI CIO, natural-language chat, LLM-powered regime detection (Kimi/Moonshot
  integration — fully removed, `KIMI_*` env vars are no longer read)
- ❌ Per-trade AI reasoning reports / trade grades (A+ through REJECT)
- ❌ Command Center, Risk Dashboard, and Settings pages — deleted; Settings in
  particular was fully disconnected (wrote to `localStorage`, nothing ever read it back,
  never touched the backend)
- ❌ VIX filter and consecutive-loss circuit breaker on new entries (both the live bot
  and the backtest's live-parity gate)
- ❌ Emotion evaluation engine, daily constitution/affirmations, MIS/CNC/BO/CO product
  selectors on the old manual-trading UI

---

## Strategies

| Strategy | Where it lives | Status |
|---|---|---|
| **EMA5T** | `server/src/services/emaStrategy.js` / `autoTrader.js` (not in the frontend registry) | The only live/paper strategy — Bank Nifty/Nifty **futures**, 5-EMA + no-lookahead 20-EMA trend gate, resting stop-entry |
| EMA5 | `src/lib/strategies/registry.ts`, `server/src/routes/backtest.js` | Backtest-only now — trades the index directly, no trend gate |
| EMA5_OPTION | `src/lib/strategies/registry.ts`, `server/src/routes/backtest.js` | Backtest-only now — Black-Scholes option-premium pricing on the same signal |

---

## Market Holidays

- **Backend** fetches from the NSE holiday API on startup
- **Fallback**: cached list on disk if the fetch fails
- **Manual refresh**: `POST /api/backtest/holidays/refresh`
- Frontend Chart and Bot both respect holidays; shows the holiday name instead of "Market Open"

---

## UI Philosophy

> **"I do not trade. I supervise."** — for everything except the Options workspace,
> which is deliberately, transparently a manual trading terminal.

---

## Documentation

- [README.md](README.md) — overview and quick start
- [ARCHITECTURE.md](ARCHITECTURE.md) — architecture deep dive
- [src/options/IMPLEMENTATION_REPORT.md](src/options/IMPLEMENTATION_REPORT.md) — Options workspace detail
