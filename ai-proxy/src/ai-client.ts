import OpenAI from "openai";

export const MODEL = process.env.MEGALLM_MODEL || "claude-sonnet-4-6";
export const BASE_URL =
  process.env.MEGALLM_BASE_URL || "https://ai.megallm.io/v1";
export const MAX_TOKENS = parseInt(
  process.env.MEGALLM_MAX_TOKENS || "60000",
  10,
);
export const TEMPERATURE = parseFloat(process.env.MEGALLM_TEMPERATURE || "0.7");
const TIMEOUT_MS = parseInt(process.env.MEGALLM_TIMEOUT || "120000", 10);

export function createAIClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    timeout: TIMEOUT_MS,
    maxRetries: 3,
  });
}

export function createGeminiClient(apiKey: string, baseURL: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL,
    timeout: TIMEOUT_MS,
    maxRetries: 3,
  });
}
