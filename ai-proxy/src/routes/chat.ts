import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import { executeChat, buildChatParams, createChatCompletionWithFallback } from "../services/chat.js";

const router = Router();

// Only rate limiting — no auth required
router.use(rateLimitMiddleware);

/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat completions endpoint.
 * Supports both streaming (SSE) and non-streaming.
 */
router.post("/chat/completions", async (req: Request, res: Response) => {
  try {
    const { messages, model, temperature, max_tokens, stream } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: '"messages" is required and must be an array',
      });
      return;
    }

    const {
      client,
      model: resolvedModel,
      messages: guardedMessages,
    } = await executeChat(req.body, config.megallmApiKey);
    const params = buildChatParams(resolvedModel, guardedMessages, {
      temperature,
      max_tokens,
    });

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Request-Id", uuidv4());

      const chatStream = await createChatCompletionWithFallback(client, resolvedModel, {
        ...params,
        stream: true,
      });

      for await (const chunk of chatStream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
          );
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      const completion = await createChatCompletionWithFallback(client, resolvedModel, {
        ...params,
        stream: false,
      });
      res.json(completion);
    }
  } catch (error) {
    console.error("[CHAT_ERROR]", error);

    if (error instanceof Error && error.message.includes("rate")) {
      res.status(429).json({
        error: "UPSTREAM_RATE_LIMITED",
        message: "AI provider rate limit reached",
      });
      return;
    }

    res.status(500).json({
      error: "CHAT_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /v1/chat/ask
 * Project Health specific — accepts question + context, returns AI answer.
 */
router.post("/chat/ask", async (req: Request, res: Response) => {
  try {
    const { question, context } = req.body;

    if (!question || typeof question !== "string") {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: '"question" is required',
      });
      return;
    }

    const systemContent = `You are a code analysis assistant for project-health CLI. Provide answers with file:line citations when referencing code.${context ? `\n\nContext:\n${context}` : ""}`;

    const messages = [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: question },
    ];

    const { client, model } = await executeChat(
      { messages },
      config.megallmApiKey,
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const chatStream = await createChatCompletionWithFallback(client, model, {
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: true,
    });

    for await (const chunk of chatStream) {
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
    console.error("[ASK_ERROR]", error);
    res.status(500).json({
      error: "ASK_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /v1/chat/review
 * Project Health specific — code review with diff + coverage context.
 */
router.post("/chat/review", async (req: Request, res: Response) => {
  try {
    const { diff, coverage } = req.body;

    if (!diff || typeof diff !== "string") {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: '"diff" is required',
      });
      return;
    }

    const systemPrompt = `You are conducting a code review.
Analyze the PR diff and provide findings in categories:
- Bugs
- Security issues
- Coverage gaps
- Readability
- Complexity

Provide specific file:line citations and remediation suggestions.`;

    const messages: Array<{ role: "system" | "user"; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "system", content: `PR Diff:\n\`\`\`\n${diff}\n\`\`\`` },
    ];

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

    const { client, model } = await executeChat(
      { messages },
      config.megallmApiKey,
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const chatStream = await createChatCompletionWithFallback(client, model, {
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: true,
    });

    for await (const chunk of chatStream) {
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
    console.error("[REVIEW_ERROR]", error);
    res.status(500).json({
      error: "REVIEW_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /v1/chat/brief
 * Project Health specific — generate ONBOARDING.md content.
 */
router.post("/chat/brief", async (req: Request, res: Response) => {
  try {
    const { fileTree, entryPoints, complexity, gitShortlog } = req.body;

    if (!fileTree) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: '"fileTree" is required',
      });
      return;
    }

    const messages = [
      {
        role: "system" as const,
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
      { role: "system" as const, content: `File tree:\n${fileTree}` },
      {
        role: "system" as const,
        content: `Entry points: ${(entryPoints || []).join(", ")}`,
      },
      {
        role: "system" as const,
        content: `Most complex files:\n${(complexity || []).map((c: any) => `${c.file}: ${c.complexity}`).join("\n")}`,
      },
      {
        role: "system" as const,
        content: `Git ownership:\n${gitShortlog || "N/A"}`,
      },
      { role: "user" as const, content: "Generate the ONBOARDING.md content." },
    ];

    const { client, model } = await executeChat(
      { messages },
      config.megallmApiKey,
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const chatStream = await createChatCompletionWithFallback(client, model, {
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: true,
    });

    for await (const chunk of chatStream) {
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
    console.error("[BRIEF_ERROR]", error);
    res.status(500).json({
      error: "BRIEF_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
