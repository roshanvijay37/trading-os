# TradingOS — Automation-First Trading Platform

> **I do not trade. I supervise.**

TradingOS is an institutional-grade automated trading platform designed exclusively for algorithmic execution. The system does not support manual order placement — only the configured trading bot can execute orders.

## Philosophy

- **Operator, not Trader**: Configure strategies, monitor execution, review performance
- **Bot-Only Execution**: The trading bot handles signal generation, position sizing, order placement, and exit logic
- **Read-Only Surveillance**: Market data pages are strictly for monitoring
- **Risk-First Design**: All guardrails are enforced programmatically, not by human discipline

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Backend**: Node.js + Express
- **Broker Integration**: FYERS API v3
- **Real-time Data**: WebSocket tick streaming

## Pages

| Page | Purpose |
|------|---------|
| **Dashboard** | Bot status, P&L, positions, system health |
| **Trading Bot** | Start/stop bot, configure strategy, view logs |
| **Market Monitor** | Live option chains, spot prices, PCR — read-only |
| **Backtest** | Strategy validation |
| **Visual Backtest** | Chart-based backtest review |
| **Journal** | Automated trade audit trail |
| **Reports** | Performance analytics |
| **Settings** | Bot risk parameters |

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

## What Was Removed

All manual trading capabilities have been eliminated:
- Manual Buy/Sell buttons
- Order placement forms
- Quantity/Price/Order type selectors
- MIS/CNC/BO/CO product selectors
- Emotion evaluation engine
- Daily constitution/affirmations
- Manual order confirmation dialogs
- Manual position closing

The platform is now purely an **algorithmic trading operations center**.