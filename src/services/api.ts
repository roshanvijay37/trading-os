/// <reference types="vite/client" />
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

function getSessionId(): string | null {
  return localStorage.getItem("fyersSessionId");
}

const DEFAULT_TIMEOUT_MS = 20000;

async function fetchWithAuth(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
) {
  const sessionId = getSessionId();
  const headers = new Headers(options.headers);

  headers.set("Content-Type", "application/json");
  if (sessionId) {
    headers.set("x-session-id", sessionId);
  }

  // Abort hung requests so a slow/black-holed broker connection can't leave promises pending
  // forever (polling loops would otherwise stack unresolved requests and freeze the UI).
  const { timeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Request timed out: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    
    // Only clear session if OUR server says session is invalid
    // Don't clear for FYERS API 401 (expired token)
    if (response.status === 401 && error.error === "Invalid or expired session") {
      localStorage.removeItem("fyersSessionId");
      window.dispatchEvent(new Event("fyers:logout"));
    }
    
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth
export const authApi = {
  getLoginUrl: () => fetchWithAuth("/auth/login"),
  exchangeToken: (authCode: string, state?: string) =>
    fetchWithAuth("/auth/callback", {
      method: "POST",
      body: JSON.stringify({ auth_code: authCode, state }),
    }),
  checkSession: (sessionId: string) => fetchWithAuth(`/auth/session/${sessionId}`),
  logout: () => {
    const sessionId = getSessionId();
    if (sessionId) {
      fetchWithAuth("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
    localStorage.removeItem("fyersSessionId");
  },
};

// Account
export const accountApi = {
  getProfile: () => fetchWithAuth("/account/profile"),
  getFunds: () => fetchWithAuth("/account/funds"),
  getHoldings: () => fetchWithAuth("/account/holdings"),
  getPositions: () => fetchWithAuth("/account/positions"),
  getQuotes: (symbols: string[]) =>
    fetchWithAuth("/account/quote", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
  getOptionChain: (symbol: string, strikecount = 10, expiry?: string | number) =>
    fetchWithAuth(
      `/account/option-chain?symbol=${encodeURIComponent(symbol)}&strikecount=${strikecount}` +
        (expiry != null && expiry !== "" ? `&expiry=${encodeURIComponent(String(expiry))}` : ""),
    ),
  // Level-5 market depth (bid/ask with quantities) for a single symbol.
  getDepth: (symbol: string) =>
    fetchWithAuth("/account/depth", {
      method: "POST",
      body: JSON.stringify({ symbol, ohlcv_flag: 1 }),
    }),
  // Market breadth (advance/decline) derived live from the NIFTY 50 constituent quotes.
  getBreadth: () => fetchWithAuth("/account/breadth"),
};

// Options Workspace — live orders, broker margin, and arbitrary-symbol history.
export interface OrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  orderType: "MARKET" | "LIMIT" | "SL" | "SL-M";
  limitPrice?: number;
  stopPrice?: number;
  productType: "INTRADAY" | "MARGIN" | "CNC";
  validity: "DAY" | "IOC";
}

export const optionsApi = {
  placeOrder: (order: OrderRequest) =>
    fetchWithAuth("/options/place-order", { method: "POST", body: JSON.stringify(order) }),
  basketOrder: (orders: OrderRequest[]) =>
    fetchWithAuth("/options/basket-order", { method: "POST", body: JSON.stringify({ orders }) }),
  modifyOrder: (payload: { id: string; limitPrice?: number; stopPrice?: number; qty?: number; orderType?: string }) =>
    fetchWithAuth("/options/modify-order", { method: "PATCH", body: JSON.stringify(payload) }),
  cancelOrder: (id: string) =>
    fetchWithAuth("/options/cancel-order", { method: "POST", body: JSON.stringify({ id }) }),
  getMargin: (orders: OrderRequest[]) =>
    fetchWithAuth("/options/margin", { method: "POST", body: JSON.stringify({ orders }) }),
  getHistory: (symbol: string, resolution = "5", days = 5) =>
    fetchWithAuth(`/options/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&days=${days}`),
};

// Orders — read-only for bot audit trail
export const orderApi = {
  getHistory: () => fetchWithAuth("/orders/history"),
  getTrades: () => fetchWithAuth("/orders/trades/today"),
};

// Auto Trading — bot control center
export const autoTradeApi = {
  start: () => fetchWithAuth("/auto-trade/start", { method: "POST" }),
  stop: () => fetchWithAuth("/auto-trade/stop", { method: "POST" }),
  getStatus: () => fetchWithAuth("/auto-trade/status"),
  getPerformance: () => fetchWithAuth("/auto-trade/performance"),
  emergencyStop: () => fetchWithAuth("/auto-trade/emergency-stop", { method: "POST" }),
  resetEmergency: () => fetchWithAuth("/auto-trade/reset-emergency", { method: "POST" }),
  setPaperTrading: (enabled: boolean) => fetchWithAuth("/auto-trade/paper-trading", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  }),
  getAuditLog: (limit?: number) => fetchWithAuth(`/auto-trade/audit?limit=${limit || 100}`),
  updateConfig: (config: Record<string, any>) => fetchWithAuth("/auto-trade/config", {
    method: "POST",
    body: JSON.stringify(config),
  }),
};

export const backtestApi = {
  getSymbols: () => fetchWithAuth("/backtest/symbols"),
  getHolidays: () => fetchWithAuth("/backtest/holidays"),
  refreshHolidays: () => fetchWithAuth("/backtest/holidays/refresh", { method: "POST" }),
  run: (params: {
    symbol: string;
    resolution: string;
    fromDate: string;
    toDate: string;
    strategy?: string;
    capital?: number;
    riskPercent?: number;
    slBuffer?: number;
    targetMultiplier?: number;
    trendEmaPeriod?: number;
    maxHoldBars?: number;
    slippage?: number;
    capitalMode?: "COMPOUND" | "FIXED";
    // Pricing model: "INDEX" (trade the index, P&L in points) or "BLACK_SCHOLES"
    // (trade ATM options on the same signals, P&L in option premium with theta/delta/costs).
    pricingModel?: "INDEX" | "BLACK_SCHOLES";
    annualizedIV?: number;
    riskFreeRate?: number;
    strikeInterval?: number;
    lotSize?: number;
    expiryWeekday?: number;
    optionSpreadPct?: number;
    brokeragePerOrder?: number;
    // IV source for the BS model: "FLAT" (use annualizedIV) or "INDIA_VIX" (use the India VIX
    // level at each bar). ivMultiplier scales VIX → instrument IV (BankNifty runs above VIX).
    ivSource?: "FLAT" | "INDIA_VIX";
    ivMultiplier?: number;
    // EMA5T only: "INDEX" (default, years of history) trades the index directly; "FUTURES"
    // resolves and trades the actual current-month contract (the literal live instrument) —
    // real availability varies (a few weeks to a few months depending on FYERS' cont_flag
    // behaviour), so let the UI ask /futures-range rather than assuming a fixed window.
    instrumentSource?: "INDEX" | "FUTURES";
    // Live-parity risk gates — configurable here rather than silently defaulted server-side,
    // matching the bot's own config (Max Trades/Day, Daily Loss Limit %) instead of a
    // separate backtest-only assumption.
    maxTradesPerDay?: number;
    maxRiskPerDayPercent?: number;
    // Position sizing: "RISK" scales qty with riskPercent/stop distance (this engine's original
    // behaviour); "LOTS" trades a fixed qty (lotSize × fixedLots) every time, matching EMA5T's
    // actual live sizing — the bot never scales with risk%, always exactly 1 lot by default.
    positionSizingMode?: "RISK" | "LOTS";
    fixedLots?: number;
  }) =>
    fetchWithAuth("/backtest/run", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  // EMA5T FUTURES only: resolves the current tradable contract and its real earliest/latest
  // available candle date, so the UI can auto-fill From/To instead of the user guessing.
  resolveFuturesRange: (symbol: string): Promise<{ success: boolean; tradedSymbol: string; earliestDate: string; latestDate: string }> =>
    fetchWithAuth("/backtest/futures-range", {
      method: "POST",
      body: JSON.stringify({ symbol }),
    }),
  runMulti: (params: {
    symbol: string;
    resolution: string;
    fromDate: string;
    toDate: string;
    strategies: string[];
    capital?: number;
    riskPercent?: number;
    targetMultiplier?: number;
    capitalMode?: "COMPOUND" | "FIXED";
  }) =>
    fetchWithAuth("/backtest/run-multi", {
      method: "POST",
      body: JSON.stringify(params),
    }),
};

// Market — public aggregate analytics (no broker session required)
export const marketApi = {
  getStatus: () => fetchWithAuth("/market/status"),
  getIvHistory: () => fetchWithAuth("/market/iv-history"),
  // FII/DII end-of-day cash-market flow from NSE participant data (no broker session required).
  getFiiDii: () => fetchWithAuth("/market/fii-dii"),
};

export function isFyersConnected(): boolean {
  return !!getSessionId();
}

/**
 * Unauthenticated round-trip latency probe against /api/health.
 * Returns the round-trip time in ms, or null if the server is unreachable.
 */
export async function pingApi(): Promise<number | null> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return Math.round(end - start);
  } catch {
    return null;
  }
}
