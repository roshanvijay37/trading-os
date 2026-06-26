/**
 * TradingOS — AI CIO Frontend Service
 * Kimi (Moonshot) integration for natural language queries
 */

const API_BASE = "/api/ai";

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

export interface RegimeDetectRequest {
  marketData: Record<string, unknown>;
}

export interface RegimeDetectResponse {
  success: boolean;
  regime: string;
  confidence: number;
  reasoning: string;
  keyFactors: string[];
  recommendedAction: string;
  riskLevel: string;
  model: string;
  timestamp: string;
  error?: string;
}

export interface TradeReviewRequest {
  trade: Record<string, unknown>;
}

export interface TradeReviewResponse {
  success: boolean;
  tradeId: string;
  review: string;
  model: string;
  timestamp: string;
  error?: string;
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
 * Use LLM to detect market regime from data
 */
export async function detectRegimeLLM(request: RegimeDetectRequest): Promise<RegimeDetectResponse> {
  const res = await fetch(`${API_BASE}/cio/regime`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return res.json();
}

/**
 * Get AI-powered trade review
 */
export async function reviewTradeAI(request: TradeReviewRequest): Promise<TradeReviewResponse> {
  const res = await fetch(`${API_BASE}/trade/review`, {
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