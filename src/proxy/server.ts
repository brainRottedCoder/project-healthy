// Proxy server for MegaLLM AI calls
// Hosted backend — no auth required, anyone can use AI features

import express from "express";
import { config } from "dotenv";
import OpenAI from "openai";
import { MODEL, MAX_TOKENS, BASE_URL } from "./ai-client.js";
import type { Request, Response } from "express";

// Load .env file
config();

// Get configurations from environment
export const PROXY_CONFIG = {
  port: parseInt(process.env.PORT || "3000", 10),
  megallmApiKey: process.env.MEGALLM_API_KEY || "",
  megallmBaseUrl: process.env.MEGALLM_BASE_URL || "https://ai.megallm.io/v1",
  megallmModel: process.env.MEGALLM_MODEL || MODEL,
  maxTokens: parseInt(process.env.MEGALLM_MAX_TOKENS || String(MAX_TOKENS), 10),
  temperature: parseFloat(process.env.MEGALLM_TEMPERATURE || "0.7"),
};

// Create the upstream AI client (connects to MegaLLM, not to self)
function createUpstreamClient(): OpenAI {
  return new OpenAI({
    apiKey: PROXY_CONFIG.megallmApiKey || "ph-placeholder",
    baseURL: PROXY_CONFIG.megallmBaseUrl,
    timeout: 60000,
    maxRetries: 2,
  });
}

// Create Express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    model: PROXY_CONFIG.megallmModel,
  });
});

// Chat completion endpoint (streaming)
app.post("/v1/chat/completions", async (req: Request, res: Response) => {
  try {
    let { messages, model, temperature, max_tokens } = req.body;

    // Validate messages
    if (!messages || !Array.isArray(messages)) {
      res
        .status(400)
        .json({ error: "messages is required and must be an array" });
      return;
    }

    // Token guard - enforce 60k token limit
    // Estimate tokens as ~4 characters per token
    const MAX_CHARS = 60 * 1000 * 4; // 60k tokens * 4 chars
    let totalChars = 0;
    const truncationWarnings: string[] = [];

    messages = messages.map((msg: any) => {
      if (typeof msg.content === "string") {
        const msgChars = msg.content.length;
        if (totalChars + msgChars > MAX_CHARS) {
          const remainingChars = MAX_CHARS - totalChars;
          if (remainingChars > 100) {
            truncationWarnings.push(
              `Context truncated: ${msg.role} message exceeds limit`,
            );
            return {
              ...msg,
              content:
                msg.content.slice(0, remainingChars) + "\n...[truncated]...",
            };
          }
        }
        totalChars += msgChars;
      }
      return msg;
    });

    if (truncationWarnings.length > 0) {
      console.warn("Token truncation warnings:", truncationWarnings);
    }

    const modelToUse = model || PROXY_CONFIG.megallmModel;
    const aiClient = createUpstreamClient();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await aiClient.chat.completions.create({
      model: modelToUse,
      messages,
      temperature: temperature ?? PROXY_CONFIG.temperature,
      max_tokens: max_tokens ?? PROXY_CONFIG.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        );
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("AI request error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Non-streaming chat completion
app.post(
  "/v1/chat/completions/nostream",
  async (req: Request, res: Response) => {
    try {
      const { messages, model, temperature, max_tokens } = req.body;

      if (!messages || !Array.isArray(messages)) {
        res
          .status(400)
          .json({ error: "messages is required and must be an array" });
        return;
      }

      const modelToUse = model || PROXY_CONFIG.megallmModel;
      const aiClient = createUpstreamClient();

      const completion = await aiClient.chat.completions.create({
        model: modelToUse,
        messages,
        temperature: temperature ?? PROXY_CONFIG.temperature,
        max_tokens: max_tokens ?? PROXY_CONFIG.maxTokens,
        stream: false,
      });

      res.json(completion);
    } catch (error) {
      console.error("AI request error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

// Start server
export function startServer(): void {
  app.listen(PROXY_CONFIG.port, () => {
    console.log(`Proxy server started on port ${PROXY_CONFIG.port}`);
    console.log(`MegaLLM endpoint: ${PROXY_CONFIG.megallmBaseUrl}`);
    console.log(`Default model: ${PROXY_CONFIG.megallmModel}`);
  });
}

// Run if called directly
if (process.argv[1] && (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.js"))) {
  startServer();
}

export default app;
