# TradingOS FYERS Server

Backend server that connects TradingOS to your real FYERS account via FYERS API v3.

## Setup

### 1. Get FYERS API credentials

1. Have a FYERS trading account (open at [fyers.in](https://fyers.in/) if needed)
2. Go to [myaccount.fyers.in](https://myaccount.fyers.in/) → API
3. Create a new app:
   - **App Name**: `TradingOS`
   - **Redirect URL**: must exactly match `FYERS_REDIRECT_URL` below (production uses
     `https://roshanvijay.com` — the frontend root, not a sub-path; the OAuth callback is
     handled server-side via `POST /api/auth/callback`, not a dedicated frontend route)
   - **App Type**: `Trading`
4. Note down your **App ID** and **Secret ID**

### 2. Configure environment variables

```bash
cd trading-os/server
cp .env.example .env
```

Edit `.env`:

```env
FYERS_APP_ID=your_actual_app_id
FYERS_SECRET_ID=your_actual_secret_id
FYERS_REDIRECT_URL=http://localhost:5173

PORT=3001
FRONTEND_URL=http://localhost:5173
JWT_SECRET=any_random_string_for_security
```

### 3. Install dependencies and start

```bash
npm install
npm run dev
```

Server will start on `http://localhost:3001`

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/login` | Get FYERS OAuth login URL |
| POST | `/api/auth/callback` | Exchange auth_code for access token |
| GET | `/api/auth/session/:id` | Check if session is valid |
| POST | `/api/auth/session/refresh` | Refresh an access token |
| POST | `/api/auth/logout` | Invalidate session |

### Orders (read-only audit — see Options below for real order placement)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders/history` | Get order history |
| GET | `/api/orders/trades/today` | Get today's trades |

> Generic manual order placement (`POST /place`, cancel, modify) was removed from here.
> The only place a human can place a **real broker order** now is the Options workspace
> (`/api/options/*`, below), scoped to that one page. The autonomous bot places its own
> orders internally via `services/orderExecution.js`, not through this route.

### Auto Trading — the bot (`/api/auto-trade`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auto-trade/start` | Start the bot |
| POST | `/api/auto-trade/stop` | Stop the bot |
| POST | `/api/auto-trade/emergency-stop` | Halt all trading, flatten open positions |
| POST | `/api/auto-trade/reset-emergency` | Clear the emergency halt |
| GET | `/api/auto-trade/status` | Bot status, positions, signals, config, health |
| GET | `/api/auto-trade/performance` | Performance summary |
| POST | `/api/auto-trade/paper-trading` | Toggle paper/live (only while stopped) |
| POST | `/api/auto-trade/config` | Update risk/strategy/instrument/timeframe config (bounds-validated; invalid fields dropped, never clamped) |
| GET | `/api/auto-trade/audit` | Audit log |

### Options workspace — manual live trading (`/api/options`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/options/place-order` | Place a **real** broker order |
| POST | `/api/options/basket-order` | Place a basket of real orders |
| PATCH | `/api/options/modify-order` | Modify a real order |
| POST | `/api/options/cancel-order` | Cancel a real order |
| POST | `/api/options/margin` | Broker margin simulator |
| GET | `/api/options/history` | OHLCV candles for any symbol |

### Backtest (`/api/backtest`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/backtest/run` | Run a backtest (EMA5T, or legacy EMA5/EMA5_OPTION) |
| POST | `/api/backtest/run-multi` | Run multiple strategies over the same candles |
| POST | `/api/backtest/data` | Raw historical candles |
| POST | `/api/backtest/futures-range` | Resolve the current futures contract + its real available date range |
| GET | `/api/backtest/symbols` | Available symbols/strategies/timeframes |
| GET | `/api/backtest/holidays` | NSE trading holidays |
| POST | `/api/backtest/holidays/refresh` | Refresh holidays from NSE |

### Account
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/account/profile` | Get user profile |
| GET | `/api/account/funds` | Get available margins |
| GET | `/api/account/holdings` | Get holdings |
| GET | `/api/account/positions` | Get positions |
| POST | `/api/account/quote` | Get market quotes |
| POST | `/api/account/depth` | Get market depth |
| GET | `/api/account/search` | Search instruments |
| GET | `/api/account/option-chain` | Option chain (+ India VIX) |
| GET | `/api/account/breadth` | NIFTY-50 advance/decline breadth |

### Market (public — no session required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/market/status` | NSE market open/closed/holiday status |
| GET | `/api/market/iv-history` | India VIX rank/percentile (persisted series) |
| GET | `/api/market/fii-dii` | FII/DII end-of-day cash flow (NSE) |

## FYERS Order Parameters

Used both by the Options workspace's manual order placement and internally by the
autonomous bot's own order execution (`services/orderExecution.js`) — confirmed against
`ORDER_TYPE`/`ORDER_SIDE` there.

| Parameter | Values | Description |
|-----------|--------|-------------|
| `symbol` | `NSE:RELIANCE-EQ` | Trading symbol with exchange prefix |
| `side` | `1` (Buy), `-1` (Sell) | Order side |
| `type` | `1` Limit, `2` Market, `3` Stop, `4` Stoplimit | Order type |
| `qty` | number | Quantity |
| `productType` | `INTRADAY`, `CNC`, `CO`, `BO`, `MARGIN` | Product type |

## How it works

1. User clicks **"Connect FYERS"** in TradingOS
2. Backend generates a FYERS OAuth login URL
3. User logs into FYERS and authorizes the app
4. FYERS redirects back with an `auth_code`
5. Backend exchanges `auth_code` for `access_token`
6. The `access_token` is stored in a server-side session
7. All subsequent API calls use the session ID to authenticate with FYERS

## Security Notes

- **Never commit `.env` to git** — it contains your Secret ID
- The server uses in-memory session storage. For production, use **Redis** or a database
- Access tokens expire and need daily reconnection (typical for broker APIs)
- The frontend never sees your Secret ID — all FYERS API calls go through the backend
- Most routes require a valid `x-session-id` header; the `/api/market/*` routes above and
  `/api/auth/login` are deliberately public (no broker session needed)

## Production Deployment

The production backend is deployed on an **AWS Lightsail Ubuntu instance** and served behind nginx at `https://api.roshanvijay.com`.

### SSH Access

Use the Lightsail default key located at the project root:

```bash
chmod 600 LightsailDefaultKey-ap-south-1.pem
ssh -i "LightsailDefaultKey-ap-south-1.pem" ubuntu@api.roshanvijay.com
```

Once logged in:

```bash
cd ~/trading-os

# View status
pm2 status
pm2 logs trading-os --lines 50

# Deploy latest code
git pull origin main
npm install
pm2 restart trading-os --update-env
```

### Deployment Checklist

1. Use a proper session store (Redis, PostgreSQL)
2. Add HTTPS
3. Set up CORS properly for your domain
4. Consider adding rate limiting
5. Deploy the backend separately from the frontend