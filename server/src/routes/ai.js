/**
 * TradingOS — AI CIO Kimi (Moonshot) Integration
 * Natural language command center for the Chief Investment Officer
 *
 * Environment variable: KIMI_API_KEY
 */

import { Router } from "express";

const router = Router();

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

  const response = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: NORMALIZED_MODEL,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
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
      ? `\n\nCurrent Context:\n${JSON.stringify(context, null, 2)}`
      : "";

    const userMessage = `Question: ${question}${contextStr}`;

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

    const userMessage = `Analyze this market data and determine the regime:\n\n${JSON.stringify(marketData, null, 2)}`;

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

    const userMessage = `Review this trade:\n\n${JSON.stringify(trade, null, 2)}`;

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