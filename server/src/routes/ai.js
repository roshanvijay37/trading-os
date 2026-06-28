/**
 * TradingOS — AI CIO Kimi (Moonshot) Integration
 * Natural language command center for the Chief Investment Officer
 *
 * Environment variable: KIMI_API_KEY
 */

import { Router } from "express";

const router = Router();

// TODO(security): These /api/ai/* routes are currently UNAUTHENTICATED and have NO rate
// limiting. They proxy to a paid Kimi/Moonshot LLM using the server's KIMI_API_KEY, so an
// unauthenticated caller can run up the bill (cost-DoS) and inject arbitrary prompts. Before
// production, add requireAuth (mirror server/src/routes/orders.js) and an express-rate-limit
// instance to this router. Left as a flagged TODO pending an auth-wiring decision so the
// already-deployed frontend's AI calls are not broken.

const LLM_TIMEOUT_MS = 30000;
// Cap request body sizes injected into LLM prompts to bound token cost / prompt-injection.
const MAX_INPUT_CHARS = 8000;

function clampForPrompt(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return str.length > MAX_INPUT_CHARS ? str.slice(0, MAX_INPUT_CHARS) + "\n...[truncated]" : str;
}

const VALID_REGIMES = new Set([
  "TRENDING_UP", "TRENDING_DOWN", "SIDEWAYS", "VOLATILE",
  "LOW_VOLATILITY", "GAP_DAY", "EXPIRY_DAY", "EVENT_DAY", "UNKNOWN",
]);
const VALID_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "EXTREME"]);

const KIMI_BASE_URL = process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1";
const KIMI_MODEL = process.env.KIMI_MODEL || "moonshot-v1-8k";

// Strip moonshot: prefix if present (some providers use it, Moonshot API does not)
const NORMALIZED_MODEL = KIMI_MODEL.replace(/^moonshot:/, "");

/**
 * Helper: Call Kimi API with system prompt + user message
 */
async function callKimi(systemPrompt, userMessage, temperature = 0.3) {
  const apiKey = process.env.KIMI_API_KEY;

  if (!apiKey) {
    throw new Error("KIMI_API_KEY not configured. Set it in server/.env");
  }

  // kimi-k2.6 only supports temperature=1
  const effectiveTemp = NORMALIZED_MODEL === "kimi-k2.6" ? 1 : temperature;

  const response = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: NORMALIZED_MODEL,
      temperature: effectiveTemp,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
    // Bound the request so a slow/hung LLM can't hold the Express connection forever.
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Kimi API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "No response from AI.";
}

// ─── System Prompts ─────────────────────────────────────────────

const CIO_SYSTEM_PROMPT = `You are the Chief Investment Officer (CIO) of an institutional-grade autonomous trading platform called TradingOS.

Your responsibilities:
1. Analyze market regime and explain it in clear, professional language
2. Answer questions about portfolio performance, strategy behavior, and risk
3. Provide actionable recommendations with reasoning
4. Be concise but thorough — like a hedge fund CIO briefing a principal

Context you may receive:
- Current market regime (Trending, Sideways, Volatile, etc.)
- Portfolio risk metrics (exposure, drawdown, VaR)
- Strategy performance (P&L, win rate, trades taken)
- Market intelligence (PCR, OI, IV, institutional flow)

Rules:
- Always base answers on the data provided
- If data is insufficient, say so clearly
- Never make up performance numbers
- Use institutional language, not retail trader slang
- Format numbers with ₹ for INR, % for percentages`;

const REGIME_SYSTEM_PROMPT = `You are a quantitative market analyst specializing in regime detection.

Analyze the provided market data and classify the regime with detailed reasoning.

Output format (strict JSON):
{
  "regime": "TRENDING_UP | TRENDING_DOWN | SIDEWAYS | VOLATILE | LOW_VOLATILITY | GAP_DAY | EXPIRY_DAY | EVENT_DAY",
  "confidence": 0.0-1.0,
  "reasoning": "Detailed explanation in 2-3 sentences",
  "keyFactors": ["factor 1", "factor 2", "factor 3"],
  "recommendedAction": "What the portfolio should do",
  "riskLevel": "LOW | MEDIUM | HIGH | EXTREME"
}`;

const TRADE_REVIEW_SYSTEM_PROMPT = `You are a senior quantitative trade analyst reviewing completed trades.

Review the trade data provided and generate a comprehensive analysis.

Output format:
- Trade Grade: A+ / A / B / C / D
- Entry Quality: Excellent / Good / Fair / Poor
- Exit Quality: Excellent / Good / Fair / Poor
- Risk Management: Assessment
- What Went Right: Bullet points
- What Went Wrong: Bullet points
- Lessons: Key takeaways
- Suggested Improvements: Concrete actions`;

// ─── Routes ─────────────────────────────────────────────────────

/**
 * POST /api/ai/cio/query
 * Natural language query to the AI CIO
 */
router.post("/cio/query", async (req, res) => {
  try {
    const { question, context } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }

    const contextStr = context
      ? `\n\nCurrent Context:\n${clampForPrompt(context)}`
      : "";

    const userMessage = `Question: ${clampForPrompt(question)}${contextStr}`;

    const answer = await callKimi(CIO_SYSTEM_PROMPT, userMessage, 0.4);

    res.json({
      success: true,
      question,
      answer,
      model: NORMALIZED_MODEL,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[AI CIO] Query error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      fallback: "AI service unavailable. Using rule-based CIO instead.",
    });
  }
});

/**
 * POST /api/ai/cio/regime
 * LLM-powered regime detection with reasoning
 */
router.post("/cio/regime", async (req, res) => {
  try {
    const { marketData } = req.body;

    if (!marketData) {
      return res.status(400).json({ error: "marketData is required" });
    }

    const userMessage = `Analyze this market data and determine the regime:\n\n${clampForPrompt(marketData)}`;

    const answer = await callKimi(REGIME_SYSTEM_PROMPT, userMessage, 0.2);

    // Try to parse JSON response
    let parsed;
    try {
      parsed = JSON.parse(answer);
    } catch {
      // If not valid JSON, wrap the text response
      parsed = {
        regime: "UNKNOWN",
        confidence: 0,
        reasoning: answer,
        keyFactors: [],
        recommendedAction: "Manual review required",
        riskLevel: "HIGH",
      };
    }

    // Validate/normalize LLM output before it flows downstream — the model (or a crafted
    // prompt) can return out-of-spec values that consumers would otherwise trust.
    if (!VALID_REGIMES.has(parsed.regime)) parsed.regime = "UNKNOWN";
    if (!VALID_RISK_LEVELS.has(parsed.riskLevel)) parsed.riskLevel = "HIGH";
    const conf = Number(parsed.confidence);
    parsed.confidence = Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0;

    res.json({
      success: true,
      ...parsed,
      model: NORMALIZED_MODEL,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[AI CIO] Regime error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * POST /api/ai/trade/review
 * AI-powered trade review
 */
router.post("/trade/review", async (req, res) => {
  try {
    const { trade } = req.body;

    if (!trade) {
      return res.status(400).json({ error: "Trade data is required" });
    }

    const userMessage = `Review this trade:\n\n${clampForPrompt(trade)}`;

    const answer = await callKimi(TRADE_REVIEW_SYSTEM_PROMPT, userMessage, 0.3);

    res.json({
      success: true,
      tradeId: trade.id,
      review: answer,
      model: NORMALIZED_MODEL,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[AI] Trade review error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/ai/status
 * Check if Kimi AI is configured and reachable
 */
router.get("/status", async (req, res) => {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    return res.json({
      configured: false,
      message: "KIMI_API_KEY not set. Add it to server/.env",
    });
  }

  try {
    // Quick health check — minimal chat completion
    const response = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: NORMALIZED_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (response.ok) {
      res.json({
        configured: true,
        reachable: true,
        model: NORMALIZED_MODEL,
        message: "Kimi AI connected and ready",
      });
    } else {
      const errText = await response.text();
      res.json({
        configured: true,
        reachable: false,
        message: `Kimi API returned ${response.status}: ${errText}`,
      });
    }
  } catch (err) {
    res.json({
      configured: true,
      reachable: false,
      message: `Connection error: ${err.message}`,
    });
  }
});

export default router;