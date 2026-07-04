# TradingOS — Architecture Overview

> **"I do not trade. I supervise."**

This document explains the current architecture of TradingOS: a focused, single-strategy
autonomous futures trading bot (EMA5T) plus a separate, manual options-trading workspace,
backtesting tooling, and market-intelligence dashboards — all sitting on one FYERS-backed
Express API.

Earlier drafts of this document described a much larger "AI CIO" / multi-strategy /
trade-grading platform. That vision was never the shipped reality and has since been
actively removed (AI CIO, Kimi/Moonshot chat, per-trade AI reasoning reports, the
Command Center/Risk Dashboard/Settings/Strategy Manager pages). This document now
describes what actually exists and runs in production.

---

## Philosophy

The **autonomous bot** (EMA5T) is fully automation-first — it places, manages, and exits
its own positions with no manual intervention. The **Options workspace** is a deliberate
exception to that rule: it is a separate, manual trading terminal where a human places
real orders directly (see below) — this is not a bug or leftover, it is a distinct,
intentional feature.

---

## Module Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRADINGOS PLATFORM                        │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (React 19 + TypeScript + Tailwind), route "/"…    │
│  ├── Trading Bot ("/")      Start/stop, config, positions,  │
│  │                          signals, logs — the home page   │
│  ├── Live Chart             SVG/lightweight-charts candles  │
│  ├── Options ("/options")   Manual options trading terminal │
│  │                          (25 panels, real order placement)│
│  ├── Backtest Lab           EMA5T backtest, Index/Futures    │
│  ├── Market Intelligence    PCR, Max Pain, VIX/IV, breadth,  │
│  │                          GEX (model), FII/DII (EOD)       │
│  └── Journal                Trade audit trail                │
├─────────────────────────────────────────────────────────────┤
│  State Management (React Context + useReducer)               │
│  ├── InstitutionalProvider   Central state container         │
│  └── useInstitutionalStore   Hook for components             │
│  (dashboard/portfolioRisk slices are real, fed every 7s by   │
│   useLiveDataSync from the bot's /status; several other      │
│   slices — e.g. a "settings" slice, CIO state — are legacy   │
│   and unread/unwritten; don't assume something here is live  │
│   without checking who actually dispatches into it)          │
├─────────────────────────────────────────────────────────────┤
│  Signal core (JS, server-side — the REAL single source of   │
│  truth for trading logic)                                    │
│  ├── signalCore.js           5-EMA + alert-candle rule,       │
│  │                           shared by live AND backtest      │
│  ├── emaStrategy.js          EMA5T: adds the no-lookahead     │
│  │                           EMA20 trend gate                 │
│  ├── autoTrader.js           Live/paper resting stop-entry     │
│  │                           lifecycle, risk gates, monitoring│
│  └── routes/backtest.js      Same EMA5T rules replayed over   │
│                              historical candles (Index or the │
│                              real current-month futures       │
│                              contract)                        │
└─────────────────────────────────────────────────────────────┘
```

There is also a TypeScript mirror at `src/lib/strategies/engine.ts` — see
[CLAUDE.md](CLAUDE.md) for why it exists and its relationship to `signalCore.js`.

---

## Key Design Decisions

### 1. One real strategy, one real source of truth

**EMA5T** — a 5-EMA alert-candle breakout, gated by a no-lookahead 20-EMA trend filter,
trading Bank Nifty / Nifty **futures** via a resting stop-entry order — is the only
strategy the live/paper bot runs (`CONFIG.SELECTED_STRATEGIES` is hard-limited to
`["EMA5T"]`). It is defined directly in `emaStrategy.js`/`autoTrader.js`, **not** in
`src/lib/strategies/registry.ts` — that registry still only lists two older strategies
(`EMA5`, `EMA5_OPTION`) that are backtest-only now (kept for historical comparison,
no longer live-tradable). Don't assume "adding a strategy = a registry entry" — EMA5T
itself is proof that isn't how the current live strategy was actually built.

**As of this session**, the live bot and the backtest engine run the *exact same*
resting-entry design end to end: paper mode calls the same `placeStopEntry` order
placement the live path uses (paper-mode order placement is simulated, not skipped),
so a paper trading day is a real rehearsal of the live code path, not a separate
simulation. See `manageFuturesPending`'s doc comment in `autoTrader.js` for the
detailed design.

### 2. Honest data, no fabricated numbers

`src/pages/MarketIntelligence.tsx` sets the pattern the rest of the app follows: every
metric is explicitly one of **live** (FYERS), **model-derived** (badged "Model", e.g.
Black-Scholes gamma), **end-of-day** (NSE, labelled with an as-of date), or an explicit
**unavailable** state — never a fabricated zero presented as real. `ivHistory.js`,
`marketBreadth.js`, and `fiiDii.js` all implement this. The Options workspace
(`src/options/`) follows the same discipline with an explicit badge system (Live /
Computed / Proxy / EOD / No feed) — see `src/options/IMPLEMENTATION_REPORT.md`.

### 3. Manual trading exists — scoped to one page

There is no generic "place an order" surface anymore (`POST /api/orders/place` and
friends were removed). The Options workspace (`/options`) is the one deliberate
exception: it places real broker orders (`POST /api/options/place-order`,
`/basket-order`, `PATCH /modify-order`, `POST /cancel-order`) directly from user
action, with a confirmation modal and margin preview but no server-side risk gate of
its own — the safety model there is "the human is the risk gate," not automation.
Treat any change here as touching a live-money surface.

### 4. Risk gates live in config, not in code

The bot's own risk limits (max trades/day, daily loss %, position sizing mode/lots,
paper vs. live, which strategies/instruments/timeframes are active) are all editable
via the Trading Bot page's config panel, backed by `POST /api/auto-trade/config` →
`autoTrader.js`'s `CONFIG` object (bounds-validated by `sanitizeConfigUpdates`, dropped
rather than clamped if out of range). A VIX filter and a consecutive-loss circuit
breaker existed at one point in both the live bot and the backtest's live-parity
gating; both were deliberately removed (not needed, per explicit product decision) —
if you see either mentioned elsewhere, that's now historical.

### 5. Backtest mirrors live, not the other way around

`routes/backtest.js`'s EMA5T branch reuses the identical alert/trend-gate rule
`emaStrategy.js` uses live, plus the same day-boundary resets, entry-cutoff, and
resting-breakout entry shape. It can run against either the index (years of history,
not the literal traded instrument) or the actual current-month futures contract
(the literal instrument, but FYERS only serves a real window of history for it —
resolved and auto-filled by `POST /api/backtest/futures-range`). Max trades/day and
daily-loss-limit % are operator-configurable in the Backtest Lab UI, not hardcoded.

---

## File Structure (trading-relevant subset)

```
src/
├── types/
│   └── index.ts, institutional.ts   # Type definitions (institutional.ts predates
│                                     # much of the current app; not everything in it
│                                     # is still wired up — verify before trusting a field)
├── lib/
│   └── strategies/
│       ├── registry.ts              # EMA5/EMA5_OPTION only — backtest-only, legacy
│       └── engine.ts                # TS mirror of signalCore.js's math (unused by any page)
├── store/
│   ├── InstitutionalProvider.tsx    # React Context state management
│   └── useLiveDataSync.ts           # Polls the bot's /status every 7s, feeds dashboard/
│                                     # portfolioRisk into the store
├── pages/
│   ├── AutoTrade.tsx                 # Bot control + config + positions + logs — now "/"
│   ├── MarketIntelligence.tsx        # Market analytics (honest-data pattern)
│   ├── BacktestLab.tsx               # EMA5T backtest, Index/Futures toggle
│   ├── Chart.tsx                     # Live candlestick
│   └── Journal.tsx                   # Trade audit trail
├── options/                          # Manual options trading terminal (see its own
│                                     # IMPLEMENTATION_REPORT.md) — 25 panels, one
│                                     # polling provider, real order placement
├── components/
│   ├── ui/                           # Shared UI kit (Panel, Stat, Tabs, toast, etc.)
│   ├── navigation.ts                 # Single source of truth for the page list —
│                                     # if a page isn't in here, it likely isn't routed
│   └── Layout.tsx                    # Sidebar + status bar + header
└── App.tsx                           # Routes — old bookmarks (/trading-bot,
                                      # /risk-dashboard, /reports) redirect to "/" or
                                      # "/journal" rather than 404ing

server/src/
├── services/
│   ├── signalCore.js                # 5-EMA + alert rule (single source of truth)
│   ├── emaStrategy.js               # EMA5T trend gate on top of signalCore.js
│   ├── autoTrader.js                # The bot: config, risk gates, resting entry
│   │                                 # lifecycle, position monitoring, reconciliation
│   ├── orderExecution.js            # Broker order placement/polling/cancel + retry
│   └── futuresCosts.js              # Futures STT/exchange/stamp/GST cost model
└── routes/
    ├── autoTrade.js                  # Bot control API
    ├── backtest.js                   # EMA5T + legacy EMA5/EMA5_OPTION backtest
    ├── options.js                    # Manual options order placement API
    ├── account.js, market.js, orders.js, auth.js, ticks.js
```

Some files still exist on disk without being wired into the app at all (e.g.
`src/pages/StrategyManager.tsx` has no route, no nav entry, and nothing imports it) —
their presence in the repo doesn't mean they're part of the live product. Check
`src/App.tsx` and `src/components/navigation.ts` before trusting that a page is real.

---

## Why This Architecture?

| Decision | Reason |
|---|---|
| Single strategy, hard-limited in config | The validated edge is EMA5T specifically; the code refuses (`ALLOWED_STRATEGIES`) to silently run anything else |
| Signal logic lives once, server-side | Prevents the exact live/backtest divergence bug this codebase has hit before (see `signalCore.js`'s header) |
| Manual trading scoped to one page | Keeps the automated bot's "never touched by a human" guarantee intact while still allowing deliberate manual execution where wanted |
| Config-driven risk limits | An operator can tune risk without a code change or redeploy |
| Honest-data badging | A model estimate or a stale value must never be visually indistinguishable from a live broker number |

### Testing

- `signalCore.js`, `autoTrader.js`'s pure decision helpers (`planReconciliation`,
  `classifyExit`, `futuresOrderSide`, `computeCommittedMargin`, staleness checks, etc.),
  and the backtest engine are unit-tested with vitest, run from the repo root
  (`npm test` — see [CLAUDE.md](CLAUDE.md)).
- Impure orchestration (`closePosition`, the live order-placement lifecycle) is tested
  sparingly and carefully, mocking only the broker layer — see
  `autoTrader.reentrancy.test.js` for the pattern.

---

## Documentation

- [README.md](README.md) — overview, quick start, deployment runbook
- [FEATURES.md](FEATURES.md) — feature-by-feature detail
- [CLAUDE.md](CLAUDE.md) — guidance for AI coding assistants working in this repo
- [src/options/IMPLEMENTATION_REPORT.md](src/options/IMPLEMENTATION_REPORT.md) — the
  Options workspace in detail
