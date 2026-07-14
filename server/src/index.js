import "dotenv/config";

import dns from "dns";
import cors from "cors";
import express from "express";

// Force IPv4 for all outgoing connections (FYERS API needs IPv4)
dns.setDefaultResultOrder("ipv4first");

import accountRoutes from "./routes/account.js";
import authRoutes from "./routes/auth.js";
import autoTradeRoutes from "./routes/autoTrade.js";
import equityTradeRoutes from "./routes/equityTrader.js";
import backtestRoutes from "./routes/backtest.js";
import orderRoutes from "./routes/orders.js";
import tickRoutes from "./routes/ticks.js";
import marketRoutes from "./routes/market.js";
import optionsRoutes from "./routes/options.js";
import { WebSocketServer } from "ws";
import { addWsClient, removeWsClient } from "./services/tickService.js";
import { alertCritical } from "./services/notifier.js";
import { getWasRunningBeforeBoot as botWasRunning } from "./services/autoTrader.js";
import { getWasRunningBeforeBoot as equityWasRunning } from "./services/equityTrader.js";

// ── Crash containment (2026-07-14 audit) ────────────────────────────────────────────────────
// Without these, one unhandled rejection anywhere leaves the process in an undefined state (or
// node kills it silently) while both trading loops report isRunning=true to nobody. Alert the
// operator, then exit(1) so PM2 restarts a CLEAN process — the bots deliberately do NOT
// auto-resume (surprise trading after a restart is worse than a paused book); the boot alert
// below tells the operator to press Start.
function fatal(kind, err) {
  console.error(`[FATAL] ${kind}:`, err);
  try {
    alertCritical("PROCESS_CRASH", `${kind}: ${err?.message || String(err).slice(0, 300)} — process restarting; BOTS ARE STOPPED until you press Start.`, {});
  } catch {
    /* alerting must never block the exit */
  }
  setTimeout(() => process.exit(1), 1500);
}
process.on("uncaughtException", (err) => fatal("uncaughtException", err));
process.on("unhandledRejection", (err) => fatal("unhandledRejection", err));

// Boot forensics: if either state file says its loop was running when the process died, the
// operator must know the book is now silently stopped.
setTimeout(() => {
  try {
    if (botWasRunning() || equityWasRunning()) {
      alertCritical(
        "BOTS_NOT_RESUMED",
        `Server restarted while ${[botWasRunning() && "futures bot", equityWasRunning() && "equity MIS"].filter(Boolean).join(" + ")} was RUNNING. Nothing auto-resumes — reconnect FYERS and press Start.`,
        {}
      );
    }
  } catch (err) {
    console.error("[BOOT] was-running check failed:", err.message);
  }
}, 3000);

const app = express();
const PORT = process.env.PORT || 3001;

// Log startup info
console.log("Starting TradingOS server...");
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("PORT:", PORT);

// CORS — allow local dev and production domains
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://roshanvijay.com",
  "https://www.roshanvijay.com",
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.log(`[CORS] Blocked origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-session-id", "Authorization"],
  })
);

// Handle preflight OPTIONS requests explicitly so every route (including /api/auth/login)
// responds with the correct CORS headers before any auth or route logic runs.
app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, x-session-id, Authorization");
  }
  res.sendStatus(204);
});

// Safety-net middleware: ensures allowed origins always get CORS headers,
// even if a downstream route errors before the cors package finishes.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, x-session-id, Authorization");
  }
  next();
});


app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/auto-trade", autoTradeRoutes);
app.use("/api/equity-trade", equityTradeRoutes);
app.use("/api/backtest", backtestRoutes);
app.use("/api/ticks", tickRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/options", optionsRoutes);

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server with error handling
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`TradingOS server running on port ${PORT}`);
  console.log(`Allowed CORS origins: ${allowedOrigins.join(", ")}`);
});

// WebSocket Server for tick streaming
const wss = new WebSocketServer({ server, path: "/ws/ticks" });

wss.on("connection", (ws) => {
  console.log("[WS] Client connected to tick stream");
  addWsClient(ws);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === "subscribe" && data.symbol) {
        ws.symbol = data.symbol;
        ws.send(JSON.stringify({
          type: "subscribed",
          symbol: data.symbol,
        }));
      }
    } catch (err) {
      console.error("[WS] Invalid message:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
    removeWsClient(ws);
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err.message);
    removeWsClient(ws);
  });
});

console.log("[WS] WebSocket server ready at /ws/ticks");

server.on("error", (err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// Keep alive for Render
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});