import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { MODEL, BASE_URL } from "../ai-client.js";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "project-health-backend",
    version: "3.0.0",
    model: MODEL,
    baseUrl: BASE_URL,
    rateLimit: config.rateLimitRpm,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
