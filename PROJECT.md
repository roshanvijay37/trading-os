# TradingOS

## Purpose

Protect Roshan from emotional trading.

## Objectives

1. Prevent overtrading.
2. Prevent leverage abuse.
3. Prevent revenge trading.
4. Enforce 1% risk.
5. Allow a maximum of one trade per day.
6. Enforce a daily loss limit of 2%.
7. Improve the discipline score.

## First release boundary

The first release is local-first:

`React → localStorage → Rule Engine → Journal`

Broker integration is deliberately excluded until the rule system is useful and
reliable on its own.
