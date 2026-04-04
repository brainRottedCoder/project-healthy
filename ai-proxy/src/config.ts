import { config as loadEnv } from "dotenv";

// Load .env.local first, then fall back to .env
loadEnv({ path: [".env.local", ".env"] });

function required(key: string): string {
  const val = process.env[key];
  if (!val || val.trim() === "") {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),
  nodeEnv: optional("NODE_ENV", "development"),

  // AI
  megallmApiKey: required("MEGALLM_API_KEY"),
  megallmBaseUrl: optional("MEGALLM_BASE_URL", "https://ai.megallm.io/v1"),
  model: optional("MEGALLM_MODEL", "claude-sonnet-4-6"),
  geminiApiKey: optional("GEMINI_API_KEY", ""), // Optional, only needed for fallback
  geminiBaseUrl: optional("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"),
  geminiModel: optional("GEMINI_MODEL", "gemini-2.5-pro"),
  maxTokens: parseInt(optional("MEGALLM_MAX_TOKENS", "60000"), 10),
  temperature: parseFloat(optional("MEGALLM_TEMPERATURE", "0.7")),
  timeout: parseInt(optional("MEGALLM_TIMEOUT", "120000"), 10),

  // Rate limiting
  rateLimitRpm: parseInt(optional("RATE_LIMIT_RPM", "60"), 10),
};
