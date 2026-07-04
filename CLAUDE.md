# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

This is **two separate npm packages** in one repo:

- **Root (`/`)** — the React 19 + TypeScript + Vite + Tailwind frontend (SPA). Source in `src/`.
- **`server/`** — the Node.js + Express backend (plain JS, ESM, **no build step**). Source in `server/src/`. Has its own `package.json` / `node_modules`.

The frontend **never** talks to FYERS (the broker) directly. All broker calls go through the backend, which holds the credentials. Treat this boundary as a hard rule.

## Commands

Run frontend commands from the repo root; backend commands from `server/`.

```bash
# Frontend (root) — dev server on :5173
npm install
npm run dev
npm run build          # tsc -b (typecheck, noEmit) THEN vite build — this is also the typecheck
npm run preview

# Backend (server/) — API + WebSocket on :3001
cd server && npm install && npm run dev   # node --watch src/index.js

# Tests — vitest, run from the ROOT (there is no test script in server/)
npm test                       # runs ALL tests: src/**/*.test.{ts,tsx} AND server/src/**/*.test.js
npm run test:watch
npx vitest run server/src/services/signalCore.test.js   # a single file
npm test -- -t "computeBreadth"                          # a single test by name
```

There is **no linter** configured. `npm run build` (i.e. `tsc -b`) is the typecheck gate for the frontend; the server is unchecked JS, so be conservative there.

## Windows dev environment (important)

The primary dev machine is Windows + VS Code, and **Node/npm are not reliably on PATH** there — you often cannot run `npm`/`tsc`/`vitest` locally. When you can't run the toolchain:
- Syntax-check server JS with `node --check <file>` if a `node.exe` is reachable.
- Pure server modules (those importing only `fs`/`path`) can be exercised directly via a small `node` script using `file:///` imports.
- Otherwise, validation happens after deploy (see README "Operations & Deployment").

Files use **CRLF** line endings. Exact-string edits that assume LF can mismatch.

## Architecture: the parts that span multiple files

### Auth & session (frontend ↔ backend ↔ FYERS)
FYERS OAuth, brokered entirely by the server (`server/src/routes/auth.js`):
1. Frontend hits `GET /api/auth/login` → server returns a FYERS OAuth URL.
2. User authorizes → FYERS redirects back with `auth_code` → `POST /api/auth/callback` exchanges it for an access token.
3. The token lives in a **server-side, in-memory session** (lost on restart; tokens also expire ~daily → user must reconnect).
4. The frontend stores only the session id in `localStorage` as `fyersSessionId` and sends it as the `x-session-id` header (see `src/services/api.ts` `fetchWithAuth`). Every route except `/api/auth/login` requires it (`requireAuth` in `server/src/routes/auth.js`).
On a 401 "Invalid or expired session", the frontend clears the session and dispatches a `fyers:logout` window event that pages listen for.

### Single source of truth for trade signals (server)
The 5-EMA rule + EMA definition live in **`server/src/services/signalCore.js`** and are shared by:
- **Live trading** — `server/src/services/autoTrader.js` (the autonomous bot) via `emaStrategy.js`.
- **Backtesting** — `server/src/routes/backtest.js` (option-aware Black-Scholes mode lives in `blackScholes.js`).

Read the `signalCore.js` header before touching signal logic: live and backtest previously diverged (different EMA seeding + alert rule) and were deliberately unified. **Do not fork this logic** — both paths must fire on the same candles.

**EMA5T** — Bank Nifty/Nifty **futures**, the 5-EMA alert rule plus a no-lookahead 20-EMA trend gate (`emaStrategy.js`), entering via a resting stop-entry order — is the only strategy the live/paper bot runs (`CONFIG.SELECTED_STRATEGIES` is hard-limited to `["EMA5T"]` in `autoTrader.js`). As of this session, live and paper trading run through the *same* order-placement code path (`manageFuturesPending` in `autoTrader.js`) — paper mode calls the same `placeStopEntry`/`placeMarketExit` functions with `paperTrading:true`, it does not simulate in a separate branch. `routes/backtest.js` has its own EMA5T branch that replays the identical rule set (same alert/trend-gate math, same day-boundary resets, same entry cutoff) against either the index or the real current-month futures contract.

There is also a TypeScript engine at `src/lib/strategies/engine.ts` (`runStrategy` / `runBacktestEngine`, unit-tested in `engine.test.ts`) that mirrors the same EMA/alert math. It is **not** wired into any page (the Backtest Lab calls the server via `backtestApi.run`); keep its math identical to `signalCore.js` if you change either.

### Strategies
`src/lib/strategies/registry.ts` defines **two**, `EMA5` and `EMA5_OPTION` — but these are **backtest-only now** (kept for historical comparison; the UI no longer exposes them). **EMA5T, the actual live/paper strategy, is not in this registry at all** — it's defined directly in `emaStrategy.js`/`autoTrader.js` and, separately, in `routes/backtest.js`'s own EMA5T branch. Don't assume "adding a strategy = a registry entry + engine implementation" — that pattern describes the two legacy registry strategies, not how EMA5T was actually built. (The README/ARCHITECTURE docs used to mention "17 strategies" — that was always aspirational, never real; both docs have since been corrected to describe the actual strategy landscape.)

### Frontend state
A single `InstitutionalProvider` (`src/store/InstitutionalProvider.tsx`, React Context + `useReducer`) exists, but not all of its state is live: the `dashboard`/`portfolioRisk` slices are real (fed every 7s by `useLiveDataSync` from the bot's `/status`, gated on being logged into FYERS), while other slices predate the current app (e.g. a `settings` slice and CIO-related state) and have no reader or writer anywhere in `src/` — verify a slice is actually wired (grep for who dispatches into it and who reads it back) before trusting it reflects anything real. Components use the `useInstitutionalStore()` hook and its action creators rather than dispatching raw actions. `src/pages/CommandCenter.tsx`, `RiskDashboard.tsx`, and `Settings.tsx` were deleted (dead/redundant — Settings in particular never called the backend at all); `/` now renders `AutoTrade.tsx` directly. `src/pages/StrategyManager.tsx` still exists on disk but has no route and no nav entry — it is not part of the live app.

### Market data is honest by contract
`src/pages/MarketIntelligence.tsx` enforces a rule worth preserving across the app: **never render fabricated/zero data as if real.** Each metric is explicitly one of: live (from FYERS), model-derived (badged "Model", e.g. Black-Scholes gamma), end-of-day (NSE, labelled with as-of date), or an explicit "unavailable" state. Examples of this pattern server-side:
- `ivHistory.js` exposes `sufficient: false` until enough samples accrue, so IV Rank shows "building history" instead of a misleading number.
- `marketBreadth.js` derives NIFTY-50 advance/decline from FYERS constituent quotes (FYERS has no breadth endpoint); skips unresolved symbols and reports `counted`.
- `fiiDii.js` scrapes NSE EOD participant data with a cookie bootstrap and degrades to stale-cache or `available:false` when NSE blocks the request (NSE rate-limits datacenter IPs, so this can fail on the deployed host even when it works locally).

### Server-side persistence
The backend writes JSON state to **`process.cwd()`** (so it depends on where PM2 starts it — production starts from `~/trading-os`): `auto-trade-state.json`, `auto-trade-audit.jsonl`, `alerts.jsonl`, `data/iv-history.json`, `data/fii-dii.json`. These reset if the working dir changes or the host is ephemeral; the relevant services accept env overrides (`IV_HISTORY_FILE`, `FII_DII_FILE`, `ALERT_LOG_FILE`).

### Real-time ticks
The server runs a WebSocket server at `/ws/ticks` (`server/src/index.js` + `server/src/services/tickService.js`); the FYERS data socket lives in `fyersDataSocketV3.js`. The frontend consumes it via `src/store/useLiveDataSync.ts`.

## Environment variables (server/.env)

See `server/.env.example`. Required for broker features: `FYERS_APP_ID`, `FYERS_SECRET_ID`, `FYERS_REDIRECT_URL` (must exactly match the FYERS app config), `JWT_SECRET`. Server: `PORT` (default 3001), `FRONTEND_URL` (CORS). (The AI CIO / Kimi integration was removed in July 2026; `KIMI_*` vars are no longer read.)

## Deployment

Frontend → GitHub Pages (`https://roshanvijay.com`). Backend → AWS Lightsail Ubuntu behind nginx (`https://api.roshanvijay.com`), managed by PM2 as process `trading-os`. SSH key `LightsailDefaultKey-ap-south-1.pem` is in the repo root (gitignored). Full SSH/PM2/nginx/SSL runbook is in **README.md** ("Operations & Deployment"); the common deploy is:

```bash
cd ~/trading-os && git pull origin main && npm install && pm2 restart trading-os --update-env
```
