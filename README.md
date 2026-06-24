# TradingOS

A local-first trading discipline system built with React, Vite, TypeScript, and
Tailwind CSS.

## Current safeguards

- Daily constitution acceptance
- One-trade-per-day lock
- 1% position risk calculation
- 2% daily loss limit
- Pre-trade emotion evaluation
- Local trade journal and discipline scoring

No broker API is connected. Data stays in the browser's `localStorage`.

## Run locally

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run build
```

## GitHub Pages

The app uses `HashRouter` and a relative Vite base, so the generated `dist`
directory can be hosted under a GitHub Pages repository path.
