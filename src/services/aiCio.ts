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

const AI_TIMEOUT_MS = 35000;

/**
 * Ask the AI CIO a natural language question.
 * Always resolves to a typed CIOQueryResponse — network/HTTP/parse failures become a
 * structured failure object so callers never crash on res.json() or read undefined fields.
 */
export async function queryCIO(request: CIOQueryRequest): Promise<CIOQueryResponse> {
  const fail = (error: string): CIOQueryResponse => ({
    success: false,
    question: request.question,
    answer: "",
    model: "",
    timestamp: new Date().toISOString(),
    error,
    fallback: "AI service unavailable. Using rule-based CIO instead.",
  });

  try {
    const res = await fetch(`${API_BASE}/cio/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!res.ok) return fail(`HTTP ${res.status}`);
    return (await res.json()) as CIOQueryResponse;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Network error");
  }
}


/**
 * Check if Kimi AI is configured and reachable.
 * Never throws — returns a not-configured/unreachable status on any failure.
 */
export async function getAIStatus(): Promise<AIStatusResponse> {
  try {
    const res = await fetch(`${API_BASE}/status`, {
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { configured: false, reachable: false, message: `HTTP ${res.status}` };
    }
    return (await res.json()) as AIStatusResponse;
  } catch (err) {
    return {
      configured: false,
      reachable: false,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}
