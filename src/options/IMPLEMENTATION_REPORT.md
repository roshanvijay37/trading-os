# Options Workspace — Implementation Report

A self-contained **Institutional Options Terminal** added under the new **Options** sidebar
item (`/options`). Zero existing features were modified beyond additive wiring (one route in
`App.tsx`, one nav item in `Layout.tsx`, additive query param on the option-chain route,
additive API methods, one new backend route). Everything renders **live broker data or values
computed from it** — no mock, placeholder, or hardcoded market data anywhere.

## Provenance discipline

Every value carries a badge so nothing is presented dishonestly:

| Badge | Meaning |
|-------|---------|
| **Live** (BROKER) | Straight from the FYERS feed |
| **Computed** (COMPUTED) | Derived locally (Black-Scholes, lognormal model, aggregation) |
| **Proxy** (PROXY) | Defensible stand-in where no direct feed exists, clearly labelled |
| **EOD** | End-of-day NSE data (FII/DII), not intraday |
| **No feed** (UNAVAILABLE) | No source in the FYERS retail API — shown blank, never faked |

## Data foundation

| Source | Endpoint | Fields used |
|--------|----------|-------------|
| Option chain | `GET /api/account/option-chain?symbol&strikecount&expiry` (FYERS `options-chain-v3`) | strike, CE/PE LTP, bid, ask, volume, OI, change-in-OI, spot, India VIX, expiry list |
| Market depth | `POST /api/account/depth` | level-5 bid/ask + qty (on demand) |
| Quotes | `POST /api/account/quote` | LTP/bid/ask/OI/volume |
| Positions | `GET /api/account/positions` | net qty, avg, LTP, P/L, product |
| Funds | `GET /api/account/funds` | available / used / total margin |
| History (any symbol) | `GET /api/options/history?symbol&resolution&days` (FYERS `/data/history`) | OHLCV candles |
| IV history | `GET /api/market/iv-history` | India VIX rank / percentile / min / max |
| FII/DII | `GET /api/market/fii-dii` | EOD cash-market flow |
| **Live orders** | `POST /api/options/place-order`, `/basket-order`, `PATCH /modify-order`, `POST /cancel-order` (FYERS `/orders/sync`) | real order placement |
| Broker margin | `POST /api/options/margin` (FYERS `/multiorder/margin`) | SPAN/exposure where returned |

**FYERS serves no Greeks and no per-strike IV.** IV is solved per-strike from the mid price
(Newton-Raphson + bisection), giving a *real* smile/skew; all Greeks are Black-Scholes-derived
from that IV. The canonical math lives once in `lib/bs.ts` and is reused everywhere (no duplication).

## Features (25 panels)

| # | Panel | Source | Computed fields |
|---|-------|--------|-----------------|
| 1 | **Option Chain** | BROKER | per-strike IV, Δ Γ Θ V, intrinsic/extrinsic |
| 2 | **Greeks** | COMPUTED | Δ Γ Θ V ρ + vanna, vomma, charm, speed, color, lambda/elasticity |
| 3 | **Implied Volatility** | BROKER VIX + COMPUTED | smile, skew, IV rank/percentile, avg/high/low |
| 4 | **OI Analytics** | BROKER | build-up classification, support/resistance, ladder, heatmap, PCR |
| 5 | **Sentiment** | COMPUTED | composite bias from PCR/OI/price/max-pain with scored factors |
| 6 | **Max Pain** | COMPUTED | pain-by-strike curve, expected expiry zone |
| 7 | **Expiry** | COMPUTED | weekly/monthly, theta decay, expected move, gamma risk, IV-crush heuristic |
| 8 | **Volatility** | COMPUTED + BROKER | HV (close-to-close), Parkinson RV, ATR, daily/weekly/expiry expected move |
| 9 | **Probability** | COMPUTED | prob ITM/OTM/touch, expected range, lognormal distribution curve |
| 10 | **Screener** | BROKER + COMPUTED | 12 scans (IV/OI/volume/Greeks/moneyness/momentum) |
| 11 | **Strategy Builder** | live premiums | 22 templates, leg editor, live payoff preview |
| 12 | **Payoff Analyzer** | COMPUTED | expiry & today P/L, break-evens, max P/L, POP, Greeks |
| 13 | **Strategy Analyzer** | COMPUTED + broker margin | R:R, POP, EV, ROI, margin, theta decay |
| 14 | **Calculators** | COMPUTED | Black-Scholes, CRR binomial, Greeks, IV, margin, position size, premium, risk |
| 15 | **Charts** | BROKER history + in-session | underlying & premium candles; in-session OI/IV/PCR/Greeks/volume |
| 16 | **Option Flow** | PROXY + EOD | volume/OI unusual activity, call/put premium flow, FII/DII (EOD) |
| 17 | **Positions** | BROKER | live P/L, per-position net Greeks, margin used |
| 18 | **Margin** | BROKER | available/used, broker margin simulator (SPAN/exposure when returned) |
| 19 | **Portfolio Risk** | COMPUTED | net Greeks, spot×IV stress grid, gap risk |
| 20 | **AI Insights** | COMPUTED | rule-based institutional observations with transparent reasoning |
| 21 | **Alerts** | live eval | price/IV/OI/Δ/PCR/volume/premium, evaluated against the live feed |
| 22 | **Watchlist** | BROKER | favourite strikes/expiries/contracts with live values |
| 23 | **Trade Ticket** | BROKER | **live orders** (market/limit/SL/SL-M, basket) with margin preview + confirm modal |
| 24 | **Historical** | EOD + in-session | India VIX history + in-session OI/PCR/IV/premium playback |
| 25 | **Institutional Summary** | COMPUTED | market bias, dealer GEX, vol, OI trend, positioning, risk zones, AI summary |

## Calculated fields & formulas

- **Implied volatility** — solved from the option mid price (Newton-Raphson, bisection fallback), `lib/bs.ts`.
- **Greeks** — Black-Scholes closed form; theta/charm/color per day, vega/rho per 1 vol/rate point.
- **Dealer GEX** — `Σ γ·OI·lot·S²·0.01` (calls +, puts −), gamma-flip by interpolation (`lib/gamma.ts`, reused).
- **PCR / Max Pain** — `lib/optionMetrics.ts` (reused, unit-tested).
- **Probability** — lognormal terminal model with drift r; touch via first-passage (`lib/probability.ts`).
- **HV / RV / ATR / expected move** — `lib/volatility.ts`.
- **Payoff / POP / EV / margin estimate** — `lib/payoff.ts`.

## Remaining limitations (honest gaps)

- **No block/sweep/“smart-money” tape** in the FYERS retail API → Option Flow uses labelled
  proxies (volume/OI spikes, premium turnover) + EOD FII/DII; true tape shown as **No feed**.
- **SPAN vs exposure margin split** is only shown when the broker margin response includes it.
- **Historical Greeks/OI/IV beyond the session** are not persisted server-side → Historical
  records from when the panel is opened (in-session) plus the persisted India-VIX series.
- **IV term-structure surface across expiries** is not built (one expiry fetched at a time to
  respect rate limits); the per-expiry **smile** is shown.
- **Bid/ask quantities** require the depth call (level-5), fetched on demand rather than streamed.
- **Non-nearest expiry** depends on FYERS honouring the forwarded `timestamp`; it degrades
  gracefully to the nearest expiry (still live data) if not.

## Performance & architecture

- One polling loop in `OptionsDataProvider` feeds all panels (no N+1 fetching); **market-aware
  cadence** — 5 s when open, 30 s when shut — to respect rate limits.
- Greeks/IV computed once per snapshot in the provider and shared via context.
- Isolated failures (positions, IV history, FII/DII) never break the chain view.
- Request timeouts + abort, honest stale/closed/error states, lazy panel rendering (only the
  active panel mounts), `useMemo` on heavy derivations, inline SVG charts (no chart-lib weight).
- Strict TypeScript, single canonical math module, zero duplicated formulas.

## Verification status

Static audit completed: import graph, provenance/tone unions, order-payload safety, and
additive-only changes to existing files all verified. **The final `tsc`/`vite build`/`vitest`
could not be run in this environment (no Node.js / `node_modules` present).** Run on your machine:

```
npm install
npm run build      # tsc -b && vite build  → final typecheck
npm test           # existing suites must stay green
```
