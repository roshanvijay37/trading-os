import crypto from "crypto";
import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

const appId = process.env.FYERS_APP_ID;
const secretId = process.env.FYERS_SECRET_ID;
const redirectUrl = process.env.FYERS_REDIRECT_URL || "http://127.0.0.1:5173";

// FYERS API base URL
const FYERS_API_BASE = "https://api-t1.fyers.in/api/v3";

// Persist sessions to file (survives server restarts)
const SESSIONS_FILE = path.join(process.cwd(), "sessions.json");

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
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error("[AUTH] Failed to save sessions:", err.message);
  }
}

// In-memory session store (persisted to file)
const sessions = loadSessions();
const stateStore = new Map(); // Store state tokens for validation

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

  // TODO(security): OAuth state (CSRF) validation is disabled because the in-memory
  // stateStore is lost on server restart, which would reject legitimate callbacks. Re-enable
  // once state is persisted (e.g. Redis) so the callback is protected against CSRF /
  // auth-code injection:
  //   if (state && !stateStore.has(state)) {
  //     return res.status(400).json({ error: "Invalid or expired state" });
  //   }

  // Clear used state
  if (state) {
    stateStore.delete(state);
  }

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

    // Get user profile using the access token
    const profileResponse = await fetch(
      `${FYERS_API_BASE}/profile?client_id=${appId}&access_token=${access_token}`,
    );
    const profileData = await profileResponse.json();
    if (!profileResponse.ok || profileData.s !== "ok") {
      // Token was obtained but identity lookup failed — log it rather than silently creating
      // a session with userId "unknown" (which corrupts downstream P&L/audit attribution).
      console.warn(`[AUTH] Profile fetch failed (${profileResponse.status}) — session identity will be 'unknown'`);
    }

    // Create session
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      accessToken: access_token,
      refreshToken: refresh_token,
      userId: profileData.data?.fy_id || "unknown",
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

// TODO(auth): A refresh_token is stored on the session but never used. FYERS v3 access
// tokens expire daily; without a refresh path (POST {FYERS_API_BASE}/validate-refresh-token
// with the refresh_token + appIdHash + PIN), every live action — including placing the
// broker stop-loss for an open position — fails once the token expires, and the only
// recovery is a manual re-login. Implement a refresh-and-retry-once wrapper before relying
// on this unattended. (Requires the user's PIN, so confirm how it is supplied/stored.)

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

  // Attach FYERS config to request
  req.fyers = {
    appId,
    accessToken: session.accessToken,
  };
  req.session = session;
  next();
}

export default router;
