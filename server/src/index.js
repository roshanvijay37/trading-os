import "dotenv/config";

import cors from "cors";
import express from "express";

import accountRoutes from "./routes/account.js";
import authRoutes from "./routes/auth.js";
import backtestRoutes from "./routes/backtest.js";
import orderRoutes from "./routes/orders.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Log startup info
console.log("Starting TradingOS server...");
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("PORT:", PORT);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/backtest", backtestRoutes);

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server with error handling
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`TradingOS server running on port ${PORT}`);
  console.log(`Allowing CORS from: ${process.env.FRONTEND_URL || "http://localhost:5173"}`);
});

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