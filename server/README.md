# TradingOS FYERS Server

Backend server that connects TradingOS to your real FYERS account via FYERS API v3.

## Setup

### 1. Get FYERS API credentials

1. Have a FYERS trading account (open at [fyers.in](https://fyers.in/) if needed)
2. Go to [myaccount.fyers.in](https://myaccount.fyers.in/) → API
3. Create a new app:
   - **App Name**: `TradingOS`
   - **Redirect URL**: `http://localhost:5173/live-trade`
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
FYERS_REDIRECT_URL=http://localhost:5173/live-trade

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
| POST | `/api/auth/logout` | Invalidate session |

### Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/orders/place` | Place a real order |
| DELETE | `/api/orders/cancel/:id` | Cancel an order |
| PUT | `/api/orders/modify/:id` | Modify an order |
| GET | `/api/orders/history` | Get order history |
| GET | `/api/orders/:id` | Get order details |
| GET | `/api/orders/trades/today` | Get today's trades |

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

## FYERS Order Parameters

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
- All routes (except `/api/auth/login`) require a valid `x-session-id` header

## Production Deployment

1. Use a proper session store (Redis, PostgreSQL)
2. Add HTTPS
3. Set up CORS properly for your domain
4. Consider adding rate limiting
5. Deploy the backend separately from the frontend