/// <reference types="vite/client" />
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

function getSessionId(): string | null {
  return localStorage.getItem("fyersSessionId");
}

async function fetchWithAuth(path: string, options: RequestInit = {}) {
  const sessionId = getSessionId();
  const headers = new Headers(options.headers);

  headers.set("Content-Type", "application/json");
  if (sessionId) {
    headers.set("x-session-id", sessionId);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Clear invalid session
    localStorage.removeItem("fyersSessionId");
    window.dispatchEvent(new Event("fyers:logout"));
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
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
  searchInstruments: (query: string, exchange = "NSE") =>
    fetchWithAuth(`/account/search?q=${encodeURIComponent(query)}&exchange=${exchange}`),
  getOptionChain: (symbol: string, strikecount = 10) =>
    fetchWithAuth(`/account/option-chain?symbol=${encodeURIComponent(symbol)}&strikecount=${strikecount}`),
};

// Orders
export const orderApi = {
  place: (params: {
    symbol: string;
    side: number; // 1 = Buy, -1 = Sell
    qty: number;
    type?: number; // 1 = Limit, 2 = Market, 3 = Stop, 4 = Stoplimit
    limitPrice?: number;
    stopPrice?: number;
    productType?: string; // INTRADAY, CNC, CO, BO, MARGIN
  }) =>
    fetchWithAuth("/orders/place", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  cancel: (orderId: string) =>
    fetchWithAuth(`/orders/cancel/${orderId}`, {
      method: "DELETE",
    }),
  getHistory: () => fetchWithAuth("/orders/history"),
  getTrades: () => fetchWithAuth("/orders/trades/today"),
};

// Auto Trading
export const autoTradeApi = {
  start: () => fetchWithAuth("/auto-trade/start", { method: "POST" }),
  stop: () => fetchWithAuth("/auto-trade/stop", { method: "POST" }),
  getStatus: () => fetchWithAuth("/auto-trade/status"),
  getPerformance: () => fetchWithAuth("/auto-trade/performance"),
};

export const backtestApi = {
  getSymbols: () => fetchWithAuth("/backtest/symbols"),
  run: (params: {
    symbol: string;
    resolution: string;
    fromDate: string;
    toDate: string;
    strategy?: string;
    rsiPeriod?: number;
    oversoldThreshold?: number;
    overboughtThreshold?: number;
    capital?: number;
    riskPercent?: number;
    slBuffer?: number;
    targetMultiplier?: number;
    maxHoldBars?: number;
  }) =>
    fetchWithAuth("/backtest/run", {
      method: "POST",
      body: JSON.stringify(params),
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
  }) =>
    fetchWithAuth("/backtest/run-multi", {
      method: "POST",
      body: JSON.stringify(params),
    }),
};

export function isFyersConnected(): boolean {
  return !!getSessionId();
}
