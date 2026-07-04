# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

This is **two separate npm packages** in one repo:

- **Root (`/`)** — the React 19 + TypeScript + Vite + Tailwind frontend (SPA). Source in `src/`.
- **`server/`** — the Node.js + Express backend (plain JS, ESM, **no build step**). Source in `server/src/`. Has its own `package.json` / `node_modules`.

The frontend **never** talks to FYERS (the broker) directly. All broker and AI calls go through the backend, which holds the credentials. Treat this boundary as a hard rule.

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

There is also a TypeScript engine at `src/lib/strategies/engine.ts` (`runStrategy` / `runBacktestEngine`, unit-tested in `engine.test.ts`) that mirrors the same EMA/alert math. It is **not** wired into any page (the Backtest Lab calls the server via `backtestApi.run`); keep its math identical to `signalCore.js` if you change either.

### Strategies
Defined **only** in `src/lib/strategies/registry.ts`. There are currently **two**: `EMA5` and `EMA5_OPTION`. (The README/ARCHITECTURE docs mention "17 strategies" — that is aspirational/outdated; trust the registry.) Adding a strategy = a registry entry + the engine implementation.

### Frontend state
A single `InstitutionalProvider` (`src/store/InstitutionalProvider.tsx`, React Context + `useReducer`) holds nearly all app state (strategies, risk, CIO, execution, dashboard, market intel, settings). Components use the `useInstitutionalStore()` hook and its action creators rather than dispatching raw actions.

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
