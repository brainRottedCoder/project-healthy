import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { requestLogger } from "./middleware/logger.js";
import { errorHandler } from "./middleware/error.js";
import healthRoutes from "./routes/health.js";
import chatRoutes from "./routes/chat.js";

const app = express();

// ─── Global middleware ───────────────────────────────────────────────────────

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(requestLogger);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use(healthRoutes); // GET /health
app.use("/v1", chatRoutes); // POST /v1/chat/*

// Root welcome
app.get("/", (_req, res) => {
  res.json({
    service: "project-health-backend",
    version: "3.0.0",
    endpoints: [
      "GET  /health",
      "POST /v1/chat/completions",
      "POST /v1/chat/ask",
      "POST /v1/chat/review",
      "POST /v1/chat/brief",
    ],
  });
});

// ─── Error handler (must be last) ────────────────────────────────────────────

app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(config.port, "0.0.0.0", () => {
  console.log("");
  console.log("  ┌──────────────────────────────────────────┐");
  console.log("  │    Project Health Backend v3.0.0         │");
  console.log("  └──────────────────────────────────────────┘");
  console.log("");
  console.log(`  →  http://localhost:${config.port}`);
  console.log(`  →  Model:       ${config.model}`);
  console.log(`  →  Base URL:    ${config.megallmBaseUrl}`);
  console.log(`  →  Rate limit:  ${config.rateLimitRpm} req/min`);
  console.log(`  →  Env:         ${config.nodeEnv}`);
  console.log("");
});

export default app;
