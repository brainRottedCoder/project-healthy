// AI Client for MegaLLM
// Uses openai package with custom baseURL
// Model is always from process.env.MEGALLM_MODEL (never hardcoded)
// Uses streaming for all AI features
// Supports both hosted backend and self-hosted proxy

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionChunk,
} from "openai/resources/index.js";
import { config } from "dotenv";

// Load .env variables before module constants are evaluated
config();

// Read the model from the environment first, then fall back to the documented default.
export const MODEL = process.env.MEGALLM_MODEL?.trim() || "openai-gpt-oss-120b";

export const DEPLOYED_BACKEND_URL = "https://project-healthy.vercel.app/v1";

// Base URL — prefers PROJECT_HEALTH_BACKEND_URL, then falls back to deployed backend
export const BASE_URL =
  process.env.PROJECT_HEALTH_BACKEND_URL ||
  process.env.MEGALLM_BASE_URL ||
  DEPLOYED_BACKEND_URL;

// Hosted backend URL for zero-config usage
export const HOSTED_BACKEND_URL =
  process.env.PROJECT_HEALTH_BACKEND_URL || DEPLOYED_BACKEND_URL;

// Timeout configuration
const TIMEOUT_MS = parseInt(process.env.MEGALLM_TIMEOUT || "60000", 10);

// Max tokens configuration
export const MAX_TOKENS = parseInt(
  process.env.MEGALLM_MAX_TOKENS || "60000",
  10,
);

// Temperature configuration
const TEMPERATURE = parseFloat(process.env.MEGALLM_TEMPERATURE || "0.7");

// Create AI client instance
// Always uses the hosted backend — no API key required
export const createAIClient = (baseUrl?: string): OpenAI => {
  const baseURL = baseUrl || BASE_URL;

  return new OpenAI({
    apiKey: "ph-no-auth-required",
    baseURL,
    timeout: TIMEOUT_MS,
    maxRetries: 2,
  });
};

// Create client for hosted backend (zero-config)
export const createHostedClient = (): OpenAI => {
  return createAIClient(HOSTED_BACKEND_URL);
};

// Streaming chat completion
export async function* streamChat(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  },
): AsyncGenerator<string, void, unknown> {
  const stream = await client.chat.completions.create({
    model: options?.model ?? MODEL,
    messages,
    temperature: options?.temperature ?? TEMPERATURE,
    max_tokens: options?.maxTokens ?? MAX_TOKENS,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

// Non-streaming chat completion
export async function chat(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: options?.model ?? MODEL,
    messages,
    temperature: options?.temperature ?? TEMPERATURE,
    max_tokens: options?.maxTokens ?? MAX_TOKENS,
    stream: false,
  });

  return completion.choices[0]?.message?.content ?? "";
}

// Count tokens (approximate - for context window management)
// 60k token limit as per RULES.md rule 12
export function estimateTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

// Truncate text if it exceeds token limit
export function truncateForContext(
  text: string,
  maxTokens: number = 60000,
): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }

  const truncated = text.slice(0, maxChars);
  console.warn(
    `Warning: Truncated ${text.length - maxChars} characters to fit within ${maxTokens} token limit`,
  );
  return truncated + "\n\n[... truncated for context limit ...]";
}

// Build context for ph ask
export interface AskContext {
  projectRoot: string;
  relevantFiles: Array<{ path: string; content: string; line?: number }>;
  astIndex?: Record<string, { file: string; line: number }>;
  gitLog?: string;
}

// Build messages for ph ask
export function buildAskMessages(
  question: string,
  context: AskContext,
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are a code analysis assistant for project-health.
You are helping answer questions about the codebase at ${context.projectRoot}.
Provide answers with file:line citations when referencing code.`,
    },
  ];

  // Add relevant file contents
  if (context.relevantFiles.length > 0) {
    let contextText = "Here are the relevant files:\n\n";
    for (const file of context.relevantFiles) {
      contextText += `--- ${file.path}${file.line ? `:${file.line}` : ""} ---\n`;
      contextText += file.content + "\n\n";
    }

    messages.push({
      role: "system",
      content: contextText,
    });
  }

  // Add git log context
  if (context.gitLog) {
    messages.push({
      role: "system",
      content: `Recent git history:\n${context.gitLog}`,
    });
  }

  messages.push({
    role: "user",
    content: question,
  });

  return messages;
}

// Build messages for ph review
export function buildReviewMessages(
  diff: string,
  coverage?: string,
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are conducting a code review.
Analyze the PR diff and provide findings in categories:
- Bugs
- Security issues
- Coverage gaps
- Readability
- Complexity

Provide specific file:line citations and remediation suggestions.`,
    },
  ];

  if (diff) {
    messages.push({
      role: "system",
      content: `PR Diff:\n\`\`\`\n${diff}\n\`\`\``,
    });
  }

  if (coverage) {
    messages.push({
      role: "system",
      content: `Coverage data:\n${coverage}`,
    });
  }

  messages.push({
    role: "user",
    content: "Please review this PR and provide your findings.",
  });

  return messages;
}

// Build messages for ph brief
export function buildBriefMessages(
  fileTree: string,
  entryPoints: string[],
  complexity: Array<{ file: string; complexity: number }>,
  gitShortlog: string,
): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: `Generate an ONBOARDING.md file for a new developer joining this project.
Include these sections:
1. Project Overview
2. Tech Stack
3. Key Files & Entry Points
4. Architecture Overview
5. Development Workflow
6. Testing
7. Common Issues & Tips

Use the provided context to make it accurate.`,
    },
    {
      role: "system",
      content: `File tree:\n${fileTree}`,
    },
    {
      role: "system",
      content: `Entry points: ${entryPoints.join(", ")}`,
    },
    {
      role: "system",
      content: `Most complex files:\n${complexity.map((c) => `${c.file}: ${c.complexity}`).join("\n")}`,
    },
    {
      role: "system",
      content: `Git ownership:\n${gitShortlog}`,
    },
    {
      role: "user",
      content: "Generate the ONBOARDING.md content.",
    },
  ];
}
