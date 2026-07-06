import crypto from "crypto";
import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

const appId = process.env.FYERS_APP_ID;
const secretId = process.env.FYERS_SECRET_ID;
const redirectUrl = process.env.FYERS_REDIRECT_URL || "http://127.0.0.1:5173";

// Single-operator identity gate (see requireAuth / the /callback check below). Normalized once at
// module load — comparisons elsewhere assume this is already trimmed + uppercased.
const OPERATOR_FYERS_ID = process.env.OPERATOR_FYERS_ID?.trim().toUpperCase() || null;
if (!OPERATOR_FYERS_ID) {
  console.warn(
    "[AUTH] OPERATOR_FYERS_ID is not set — any FYERS account that completes login can control this bot " +
      "(emergency-stop, config, positions). Set OPERATOR_FYERS_ID to your FYERS user ID to restrict access."
  );
}

/**
 * Pure: does this session's stored fy_id match the configured single-operator ID? Returns true
 * when no operator id is configured (gate disabled, preserving prior behavior by default). Shared
 * by the /callback check (refuses to CREATE a non-operator session) and requireAuth (defense in
 * depth against any session that exists by some other path). Exported for unit tests.
 */
export function isOperatorSession(session, operatorFyersId = OPERATOR_FYERS_ID) {
  if (!operatorFyersId) return true;
  return String(session?.userId || "").trim().toUpperCase() === operatorFyersId;
}

// FYERS API base URL
const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";

// Persist sessions to file (survives server restarts)
const SESSIONS_FILE = path.join(process.cwd(), "sessions.json");
// OAuth CSRF state tokens, persisted the same way — a login started right before a restart
// must not be wrongly rejected on callback (see loadState()/re-enabled check below).
const OAUTH_STATE_FILE = path.join(process.cwd(), "oauth-state.json");

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
      return new Map(Object.entries(data));
    }
  } catch (err) {
    console.error("[AUTH] Failed to load sessions:", err.message);
  }
  return new Map();
}

function saveSessions() {
  try {
    const obj = Object.fromEntries(sessions);
    const json = JSON.stringify(obj, null, 2);
    // Write-then-rename: rename is atomic on the same filesystem, so a process kill mid-write
    // (this host is known to OOM under load) can never leave sessions.json truncated/corrupt.
    // A corrupt file's JSON.parse would otherwise throw in loadSessions(), get swallowed, and
    // silently return an empty map — logging out every user, including whatever session the
    // bot itself depends on.
    const tmpFile = `${SESSIONS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, json);
    fs.renameSync(tmpFile, SESSIONS_FILE);
  } catch (err) {
    console.error("[AUTH] Failed to save sessions:", err.message);
  }
}

function loadOAuthState() {
  try {
    if (fs.existsSync(OAUTH_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(OAUTH_STATE_FILE, "utf8"));
      return new Map(Object.entries(data));
    }
  } catch (err) {
    console.error("[AUTH] Failed to load oauth state:", err.message);
  }
  return new Map();
}

function saveOAuthState() {
  try {
    const json = JSON.stringify(Object.fromEntries(stateStore), null, 2);
    const tmpFile = `${OAUTH_STATE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, json);
    fs.renameSync(tmpFile, OAUTH_STATE_FILE);
  } catch (err) {
    console.error("[AUTH] Failed to save oauth state:", err.message);
  }
}

// In-memory session store (persisted to file)
const sessions = loadSessions();
// OAuth CSRF state tokens (persisted to file — see OAUTH_STATE_FILE above)
const stateStore = loadOAuthState();

// Step 1: Get FYERS login URL
router.get("/login", (_req, res) => {
  if (!appId || !secretId) {
    return res.status(500).json({
      error: "FYERS API credentials not configured",
      setupUrl: "https://myaccount.fyers.in/",
    });
  }

  const state = crypto.randomUUID();
  stateStore.set(state, { createdAt: Date.now() });

  // Clean up old states (older than 10 minutes)
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of stateStore.entries()) {
    if (value.createdAt < tenMinutesAgo) {
      stateStore.delete(key);
    }
  }
  saveOAuthState();

  // FYERS v3 OAuth URL - use full appId (with suffix) for OAuth
  const loginUrl = `${FYERS_API_BASE}/generate-authcode?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUrl)}&response_type=code&state=${state}`;

  res.json({ loginUrl, state });
});

// Step 2: Handle OAuth callback and generate access token
router.post("/callback", async (req, res) => {
  const { auth_code, state } = req.body;

  if (!auth_code) {
    return res.status(400).json({ error: "auth_code is required" });
  }

  // CSRF / auth-code-injection guard: `state` must be one WE issued via /login and not yet
  // consumed. Without this, an attacker who completes their own FYERS login can craft a link
  // like https://roshanvijay.com/#auth_code=<attacker_code>&state=<anything> — a victim who
  // merely opens it gets silently connected to the attacker's FYERS identity (the frontend
  // exchanges whatever auth_code/state is in the URL with no user interaction required). state
  // is now persisted (OAUTH_STATE_FILE) so this check is safe across a server restart — a
  // legitimate in-flight login started right before a restart is not wrongly rejected.
  if (!state || !stateStore.has(state)) {
    return res.status(400).json({ error: "Invalid or expired login attempt — please click Connect FYERS again." });
  }

  // Single-use: clear immediately so the same state can never authorize a second exchange.
  stateStore.delete(state);
  saveOAuthState();

  try {
    // Exchange auth_code for access_token using SHA256 hash of secret
    // Use FULL appId (with suffix) for token validation
    const hash = crypto.createHash("sha256");
    hash.update(`${appId}:${secretId}`);
    const appIdHash = hash.digest("hex");

    const tokenResponse = await fetch(`${FYERS_API_BASE}/validate-authcode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        appIdHash: appIdHash,
        code: auth_code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.s !== "ok") {
      throw new Error(tokenData.message || "Failed to get access token");
    }

    const { access_token, refresh_token } = tokenData;

    // Get user profile using the access token. FYERS v3 authenticates via the
    // `Authorization: appId:accessToken` header (same as every other v3 call in this codebase) —
    // NOT query-string params, which is the old/incorrect style this used to send and which FYERS
    // consistently rejected with HTTP 400, leaving every session's identity permanently "unknown".
    const profileResponse = await fetch(`${FYERS_API_BASE}/profile`, {
      headers: { Authorization: `${appId}:${access_token}` },
    });
    const profileData = await profileResponse.json();
    if (!profileResponse.ok || profileData.s !== "ok") {
      // Token was obtained but identity lookup failed — log it rather than silently creating
      // a session with userId "unknown" (which corrupts downstream P&L/audit attribution).
      console.warn(`[AUTH] Profile fetch failed (${profileResponse.status}) — session identity will be 'unknown'`);
    }

    const userId = profileData.data?.fy_id || "unknown";

    // Single-operator gate: this app runs one person's live trading bot. Without this, anyone who
    // completes their OWN FYERS login gets a valid session that can hit /emergency-stop, mutate
    // risk config, or read positions — because bot state is process-wide, not scoped to a specific
    // user. Fail CLOSED: if identity can't be verified (profile fetch failed → "unknown") or it
    // doesn't match, refuse the session rather than assume it's fine.
    if (!isOperatorSession({ userId })) {
      console.warn(`[AUTH] Rejected login from non-operator FYERS account (got "${userId}")`);
      return res.status(403).json({
        error: "This app is configured for a single FYERS account. A different FYERS account tried to connect.",
      });
    }

    // Create session
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      accessToken: access_token,
      refreshToken: refresh_token,
      userId,
      userName: profileData.data?.name || "FYERS User",
      email: profileData.data?.email_id || "",
      broker: "FYERS",
      createdAt: new Date().toISOString(),
    };

    sessions.set(sessionId, session);
    saveSessions();

    res.json({
      success: true,
      sessionId,
      user: {
        userId: session.userId,
        userName: session.userName,
        email: session.email,
        broker: session.broker,
      },
    });
  } catch (error) {
    console.error("FYERS auth error:", error);
    res.status(401).json({
      error: "Failed to authenticate with FYERS",
      message: error.message,
    });
  }
});

// Step 3: Check session status
router.get("/session/:sessionId", (req, res) => {
  // Use getSession which reloads from disk if needed
  const session = getSession(req.params.sessionId);

  if (!session) {
    return res.status(401).json({ error: "Session not found" });
  }

  res.json({
    valid: true,
    user: {
      userId: session.userId,
      userName: session.userName,
      email: session.email,
      broker: session.broker,
    },
  });
});

// Step 3b: Refresh session from file (for server restarts)
router.post("/session/refresh", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId required" });
  }
  
  // Reload from disk in case server restarted
  const freshSessions = loadSessions();
  const session = freshSessions.get(sessionId);

  if (!session) {
    return res.status(401).json({ error: "Session not found" });
  }
  // Every other session-read path (getSession, requireAuth) enforces the 24h TTL — this route
  // must too, or a session everything else correctly treats as expired gets reported valid here.
  if (isSessionExpired(session)) {
    sessions.delete(sessionId);
    saveSessions();
    return res.status(401).json({ error: "Session expired" });
  }

  // Update in-memory store
  sessions.set(sessionId, session);
  
  res.json({
    valid: true,
    sessionId,
    user: {
      userId: session.userId,
      userName: session.userName,
      email: session.email,
      broker: session.broker,
    },
  });
});

// Step 4: Logout - invalidate session
router.post("/logout", (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    sessions.delete(sessionId);
    saveSessions();
  }
  res.json({ success: true });
});

// Session lifetime. FYERS access tokens are valid for one trading day.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function isSessionExpired(session) {
  const created = new Date(session.createdAt).getTime();
  return !Number.isFinite(created) || Date.now() - created >= SESSION_TTL_MS;
}

// ─── TOKEN REFRESH ────────────────────────────────────────────────────
// FYERS v3 access tokens expire daily. The refresh_token (valid ~15 days) can mint a new
// access token without a full re-login, but FYERS requires the account PIN. We read it from
// the FYERS_PIN env var; if it is not set we cannot refresh unattended and callers fall back
// to fail-safe behaviour (stop opening new trades and rely on the already-placed broker SL).
// The PIN is sensitive — storing it enables fully unattended trading — so it is strictly
// opt-in via env and never hardcoded.
const FYERS_REFRESH_URL = `${FYERS_API_BASE}/validate-refresh-token`;
let warnedNoPin = false;
// sessionId -> in-flight refresh Promise. A burst of 401s (an order plus several data polls
// arriving together once the token dies) must trigger only ONE refresh round-trip, not a
// thundering herd that could trip FYERS rate limits or race on the stored token.
const refreshInFlight = new Map();

function getAppIdHash() {
  return crypto.createHash("sha256").update(`${appId}:${secretId}`).digest("hex");
}

/**
 * Exchange the session's refresh_token for a fresh access token and update the session IN
 * PLACE so every holder of this object reference (e.g. the auto-trader's captured
 * `currentSession`) immediately sees the new token. Returns the new access token, or null if
 * refresh is impossible (no PIN / no refresh_token) or the broker rejected it — callers must
 * treat null as "still unauthenticated" and fail safe.
 */
export async function refreshAccessToken(session) {
  if (!session || !session.refreshToken) return null;
  const pin = process.env.FYERS_PIN;
  if (!pin) {
    if (!warnedNoPin) {
      console.warn(
        "[AUTH] Access token expired but FYERS_PIN is not set — cannot auto-refresh. " +
          "Set FYERS_PIN to enable unattended token refresh; until then the bot will stop " +
          "opening new trades and rely on the broker stop-loss for any open position."
      );
      warnedNoPin = true;
    }
    return null;
  }

  if (refreshInFlight.has(session.id)) return refreshInFlight.get(session.id);

  const p = (async () => {
    try {
      const response = await fetch(FYERS_REFRESH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          appIdHash: getAppIdHash(),
          refresh_token: session.refreshToken,
          pin: String(pin),
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.s !== "ok" || !data.access_token) {
        console.error(`[AUTH] Token refresh failed: ${data.message || `HTTP ${response.status}`}`);
        return null;
      }
      // Mutate the shared object so referencing holders see the new token, and reset
      // createdAt so the local 24h TTL does not immediately expire the refreshed session.
      session.accessToken = data.access_token;
      if (data.refresh_token) session.refreshToken = data.refresh_token;
      session.createdAt = new Date().toISOString();
      sessions.set(session.id, session);
      saveSessions();
      console.log("[AUTH] Access token refreshed via refresh_token");
      // Re-arm the live market-data socket with the new token. That feed socket is a
      // process-wide singleton otherwise stranded on the now-dead token; without this it keeps
      // reconnecting with the expired token until the process restarts. Lazy import avoids any
      // module init-order coupling between auth and the tick service.
      try {
        const { onTokenRefreshed } = await import("../services/tickService.js");
        onTokenRefreshed(data.access_token, appId);
      } catch (err) {
        console.error("[AUTH] Feed re-arm after refresh failed:", err.message);
      }
      return data.access_token;
    } catch (err) {
      console.error("[AUTH] Token refresh error:", err.message);
      return null;
    } finally {
      refreshInFlight.delete(session.id);
    }
  })();

  refreshInFlight.set(session.id, p);
  return p;
}

// Helper to get session by ID (used by other routes like backtest)
export function getSession(sessionId) {
  // First check in-memory
  let session = sessions.get(sessionId);
  if (!session) {
    // If not found, reload from disk (server may have restarted)
    const freshSessions = loadSessions();
    session = freshSessions.get(sessionId);
    if (session) sessions.set(sessionId, session);
  }
  if (!session) return null;

  // Enforce expiry on the validation path too (not just getAllSessions). Otherwise a stale
  // 24h+ session keeps authorizing live orders until FYERS itself rejects the token.
  if (isSessionExpired(session)) {
    sessions.delete(sessionId);
    saveSessions();
    return null;
  }
  return session;
}

// Helper to get all active sessions (used by standalone backtester)
export function getAllSessions() {
  const now = Date.now();
  const active = [];
  for (const [id, session] of sessions.entries()) {
    // Session expires after 24 hours
    const created = new Date(session.createdAt).getTime();
    if (now - created < 24 * 60 * 60 * 1000) {
      active.push(session);
    }
  }
  return active;
}

// Middleware to validate session and attach FYERS config
export function requireAuth(req, res, next) {
  const sessionId = req.headers["x-session-id"];

  if (!sessionId) {
    console.log("[AUTH] 401 - No x-session-id header");
    return res.status(401).json({ error: "Session ID required" });
  }

  // Use getSession which reloads from disk if needed
  const session = getSession(sessionId);
  if (!session) {
    // Avoid logging session-id prefixes or the full session-key list (account identifiers).
    console.log("[AUTH] 401 - Invalid or expired session");
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Defense in depth: /callback already refuses to CREATE a session for a non-operator FYERS
  // account, but this catches any session that might exist by some other path (e.g. one persisted
  // in sessions.json from before OPERATOR_FYERS_ID was configured).
  if (!isOperatorSession(session)) {
    console.log("[AUTH] 403 - Session belongs to a non-operator FYERS account");
    return res.status(403).json({ error: "This session does not belong to the configured operator account." });
  }

  // Attach FYERS config to request
  req.fyers = {
    appId,
    accessToken: session.accessToken,
  };
  req.session = session;
  next();
}

export default router;
