/**
 * TradingOS — AI CIO Frontend Service
 * Kimi (Moonshot) integration for natural language queries
 */

const isProduction = typeof window !== "undefined" && window.location.hostname === "roshanvijay.com";
const API_BASE = isProduction ? "https://api.roshanvijay.com/api/ai" : "/api/ai";

export interface CIOQueryRequest {
  question: string;
  context?: Record<string, unknown>;
}

export interface CIOQueryResponse {
  success: boolean;
  question: string;
  answer: string;
  model: string;
  timestamp: string;
  error?: string;
  fallback?: string;
}


export interface AIStatusResponse {
  configured: boolean;
  reachable?: boolean;
  model?: string;
  message: string;
}

/**
 * Ask the AI CIO a natural language question
 */
export async function queryCIO(request: CIOQueryRequest): Promise<CIOQueryResponse> {
  const res = await fetch(`${API_BASE}/cio/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return res.json();
}


/**
 * Check if Kimi AI is configured and reachable
 */
export async function getAIStatus(): Promise<AIStatusResponse> {
  const res = await fetch(`${API_BASE}/status`);
  return res.json();
}
