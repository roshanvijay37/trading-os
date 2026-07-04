# TradingOS — Autonomous Futures Trading Bot + Manual Options Workspace

> **"I do not trade. I supervise."** — for the autonomous bot. The Options workspace is a
> deliberate, separate exception where a human places real orders manually.

TradingOS runs one autonomous strategy (**EMA5T**, a trend-gated 5-EMA futures system)
plus a separate manual options-trading terminal, a backtest lab that replays the exact
same live rules, and honest-data market intelligence dashboards — all backed by one
FYERS-connected Express API.

Earlier versions of this README described a much larger "AI CIO" / multi-strategy /
trade-grading platform. That was never the shipped reality and has since been actively
removed — see [What Was Removed](#what-was-removed). This README describes what
actually runs today.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [What Was Removed](#what-was-removed)
3. [Architecture](#architecture)
4. [Pages](#pages)
5. [Strategies](#strategies)
6. [Tech Stack](#tech-stack)
7. [Quick Start](#quick-start)
8. [Development Workflow](#development-workflow)
    - [Windows Development Notes](#windows-development-notes)
9. [Operations & Deployment](#operations--deployment)
    - [Server Access (SSH)](#server-access-ssh)
10. [Documentation](#documentation)
11. [License](#license)

---

## Philosophy

| Principle | Description |
|-----------|-------------|
| **Operator, not Trader (for EMA5T)** | Configure the bot's risk limits, monitor execution, review performance |
| **Manual trading, scoped** | The Options workspace (`/options`) is a deliberate, separate exception — a human places real orders there |
| **Read-Only Surveillance elsewhere** | Live Chart and Market Intelligence are monitoring-only |
| **Risk-First, config-driven** | Risk limits (max trades/day, daily loss %, sizing) are operator-configurable via the bot's own config panel — not hardcoded assumptions |
| **Single Source of Truth** | The live bot and the backtest engine run the identical EMA5T rule set |
| **Honest Data** | Every number is labelled live, model-derived, end-of-day, or unavailable — never a fabricated placeholder |

---

## What Was Removed

- ❌ Generic manual order placement (`POST /api/orders/place`, cancel, modify) — manual
  trading now exists only in the Options workspace, scoped to that one page
- ❌ AI CIO, natural-language chat, LLM-powered market-regime detection (the Kimi/Moonshot
  integration was fully removed; `KIMI_*` env vars are no longer read)
- ❌ Per-trade AI reasoning reports / trade grades
- ❌ Command Center, Risk Dashboard, and Settings pages (Settings in particular was fully
  disconnected — it wrote to `localStorage` and nothing ever read it back)
- ❌ VIX filter and consecutive-loss circuit breaker on new entries (both the live bot and
  the backtest's live-parity gate) — a deliberate product decision
- ❌ Emotion evaluation engine, daily constitution/affirmations, MIS/CNC/BO/CO product
  selectors from the old manual-trading UI

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TRADINGOS PLATFORM                        │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (React 19 + TypeScript + Tailwind CSS)             │
│  ├── Trading Bot ("/")      Start/stop, config, positions,   │
│  │                          signals, logs — the home page    │
│  ├── Live Chart             Candlestick analysis              │
│  ├── Options ("/options")   Manual options trading terminal   │
│  │                          (25 panels, real order placement) │
│  ├── Backtest Lab           EMA5T backtest, Index/Futures     │
│  ├── Market Intelligence    PCR, Max Pain, VIX/IV, breadth,   │
│  │                          GEX (model), FII/DII (EOD)        │
│  └── Journal                Trade audit trail                 │
├─────────────────────────────────────────────────────────────┤
│  Signal core (server-side — the real single source of truth) │
│  ├── signalCore.js           5-EMA + alert rule, shared by     │
│  │                           live AND backtest                │
│  ├── emaStrategy.js          EMA5T's no-lookahead trend gate   │
│  └── autoTrader.js           Live/paper resting-entry engine,  │
│                              risk gates, position monitoring   │
├─────────────────────────────────────────────────────────────┤
│  State Management (React Context + useReducer)                │
│  └── InstitutionalProvider   dashboard/portfolioRisk slices    │
│                              are real (fed every 7s from the   │
│                              bot's /status); several other     │
│                              slices are legacy/unwired — see   │
│                              ARCHITECTURE.md before trusting one│
└─────────────────────────────────────────────────────────────┘
```

---

## Pages

*(current routes — see `src/App.tsx` / `src/components/navigation.ts`)*

| Page | Purpose | Route |
|------|---------|-------|
| **Trading Bot** | Start/stop, config (risk %, max trades/day, daily loss limit %, paper/live), positions, signals, logs — the home page | `/` |
| **Live Chart** | Candlestick with volume, timeframe selector, market status | `/chart` |
| **Options** | Manual options trading terminal — 25 panels, real order placement | `/options` |
| **Backtest Lab** | EMA5T backtest (Index or real futures contract), table/chart toggle | `/backtest` |
| **Market Intelligence** | PCR, Max Pain, India VIX, IV Rank, NIFTY-50 breadth, dealer gamma (model), FII/DII (EOD) | `/market-intelligence` |
| **Journal** | Automated trade audit trail | `/journal` |

`/trading-bot`, `/risk-dashboard`, and `/reports` are old bookmarks that redirect to `/`
or `/journal` — those pages (Command Center, Risk Dashboard, Reports as a standalone
page) were removed, not renamed.

---

## Strategies

| Strategy | Where it lives | Status |
|---|---|---|
| **EMA5T** | `server/src/services/emaStrategy.js`/`autoTrader.js` (not in the frontend registry) | The only live/paper strategy — Bank Nifty/Nifty **futures**, 5-EMA + no-lookahead 20-EMA trend gate, resting stop-entry |
| EMA5 | `src/lib/strategies/registry.ts`, `server/src/routes/backtest.js` | Backtest-only — trades the index directly, no trend gate |
| EMA5_OPTION | `src/lib/strategies/registry.ts`, `server/src/routes/backtest.js` | Backtest-only — Black-Scholes option-premium pricing on the same signal |

EMA5T's risk limits (position sizing mode, risk %, max trades/day, daily loss limit %,
paper/live, active instruments/timeframes) are all configurable from the Trading Bot
page's config panel — not hardcoded. There is no VIX filter and no consecutive-loss
breaker on new entries anymore (removed deliberately).

---

## Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind CSS + Vite
- **State Management**: React Context + useReducer
- **Backend**: Node.js + Express (plain JS, no build step)
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


## Development Workflow

> All active development is done directly in **VS Code**. Commits and pushes are performed using **Git inside VS Code**.
> Local build/test tooling is not run during development; validation happens after deployment:
> - **UI** is deployed to and tested on **GitHub Pages**
> - **Backend** is deployed to and tested on **Ubuntu**

### Windows Development Notes

When editing files on the Windows development machine (VS Code), keep the following in mind:

- **Line endings are CRLF** — files use Windows-style CR+LF (`0x0D 0x0A`) line endings. Exact-string replacements that assume LF-only line endings may fail silently. Use regex-based replacements or Git Bash (`perl`/ `sed`) for multiline edits.
- **Node/npm/Python are not on PATH** in this environment. You cannot run `npm run build`, TypeScript checks, or Python scripts here. Always validate builds on a machine with Node.js installed or on the Ubuntu server after deployment.
- **Use Git Bash for tricky edits** — when the VS Code editor or PowerShell fails to match text, use:
  ```bash
  C:\Users\RoshanV\AppData\Local\Programs\Git\bin\bash.exe
  ```
  then use `perl -0777 -i -pe` or `sed` to make the change.

- **Pitfalls even with Git Bash/perl** — these traps still apply:
  - **Perl replacement strings are double-quoted**, so backslash-r, backslash-n, backslash-t, and `@` are interpreted. To write literal backslash-r-backslash-n in a file you must often pass four backslashes through the shell.
  - **`@` is a Perl array sigil** — text like `ubuntu@api...` must be escaped as `ubuntu\@api...` in replacements.
  - **Backticks in JSX/JS** conflict with shell command substitution. Wrap the whole Perl command in single quotes or switch delimiters.
  - **`perl -0777` treats the file as one string**, but CRLF can still break patterns that assume LF-only line endings. Match CR+LF explicitly or use broader regex patterns.
- **Git `index.lock` can appear transiently** — if a commit fails with "Unable to create .git/index.lock", wait a few seconds and retry.
- **Recommended fix for line-ending warnings**:
  ```bash
  git config core.autocrlf true
  ```
  or use `false` if you want LF everywhere and convert files once.

## Operations & Deployment

### Infrastructure

| Layer | Technology | Location |
|-------|-----------|----------|
| **Frontend** | React + Vite | GitHub Pages (`https://roshanvijay.com`) |
| **Backend** | Node.js + Express | AWS Lightsail Ubuntu (`api.roshanvijay.com`) |
| **Process Manager** | PM2 | Ubuntu |
| **Reverse Proxy** | nginx | Ubuntu |
| **Broker** | FYERS (v3 API) | External |

### Server Access (SSH)

The backend runs on an **AWS Lightsail Ubuntu instance** in the `ap-south-1` (Mumbai) region, exposed via `https://api.roshanvijay.com`.

**SSH key:** `LightsailDefaultKey-ap-south-1.pem` (located in the project root, already gitignored)

**Connect via SSH:**

```bash
# From the project root
ssh -i "LightsailDefaultKey-ap-south-1.pem" ubuntu@api.roshanvijay.com

# Or using the server's public IP if the domain is not resolving
# ssh -i "LightsailDefaultKey-ap-south-1.pem" ubuntu@<LIGHTSAIL_PUBLIC_IP>
```

> **Note:** On macOS/Linux you may need to fix key permissions first:
> ```bash
> chmod 600 LightsailDefaultKey-ap-south-1.pem
> ```

**After logging in, the project is located at:**

```bash
cd ~/trading-os
```

**Common post-login commands:**

```bash
# Check server status
pm2 status
pm2 logs trading-os --lines 50

# Pull latest code and restart
git pull origin main
npm install
pm2 restart trading-os --update-env

# Test API health
curl https://api.roshanvijay.com/api/health
```

### Environment Setup

**.env file location:** `~/trading-os/.env` — only ONE file needed.

**Production `.env` (shape — fill in your own secrets, never commit real values):**
```bash
FYERS_APP_ID=<your-fyers-app-id>
FYERS_SECRET_ID=<your-fyers-secret-id>
FYERS_REDIRECT_URL=https://roshanvijay.com
PORT=3001
```

**Template for new setups:**
```bash
# FYERS API credentials
FYERS_APP_ID=<your-fyers-app-id>
FYERS_SECRET_ID=your-secret-here
FYERS_REDIRECT_URL=https://roshanvijay.com

# Server settings
PORT=3001
FRONTEND_URL=https://roshanvijay.com

# JWT secret for session tokens
JWT_SECRET=<long-random-secret>
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

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502 Bad Gateway` | Backend not running | `pm2 start server/src/index.js --name trading-os` |
| `Cannot find module` | Missing dependency | `npm install` then restart |
| `Connection refused` on :3001 | Backend crashed | Check `pm2 logs trading-os` |
| `FYERS_APP_ID not configured` | `.env` not loaded | Ensure `.env` is at `~/trading-os/.env` |
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
- [CLAUDE.md](CLAUDE.md) — guidance for AI coding assistants working in this repo
- [src/options/IMPLEMENTATION_REPORT.md](src/options/IMPLEMENTATION_REPORT.md) — Options workspace detail

---

## License

Proprietary

