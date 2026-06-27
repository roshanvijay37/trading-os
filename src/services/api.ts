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
  getOptionChain: (symbol: string, strikecount = 10) =>
    fetchWithAuth(`/account/option-chain?symbol=${encodeURIComponent(symbol)}&strikecount=${strikecount}`),
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
    maxHoldBars?: number;
    slippage?: number;
    capitalMode?: "COMPOUND" | "FIXED";
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
    capitalMode?: "COMPOUND" | "FIXED";
  }) =>
    fetchWithAuth("/backtest/run-multi", {
      method: "POST",
      body: JSON.stringify(params),
    }),
};

export function isFyersConnected(): boolean {
  return !!getSessionId();
}
