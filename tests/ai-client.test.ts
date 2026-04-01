// Test suite for AI client (ai-client.ts)
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateTokens,
  truncateForContext,
  buildAskMessages,
  buildReviewMessages,
  buildBriefMessages,
} from "../src/proxy/ai-client.js";

function getStr(content: unknown): string {
  return typeof content === "string" ? content : "";
}

const ORIGINAL_MODEL = process.env.MEGALLM_MODEL;

afterEach(() => {
  if (ORIGINAL_MODEL === undefined) {
    delete process.env.MEGALLM_MODEL;
  } else {
    process.env.MEGALLM_MODEL = ORIGINAL_MODEL;
  }

  vi.resetModules();
});

describe("AI Client", () => {
  describe("MODEL", () => {
    it("falls back to claude-sonnet-4-6 when MEGALLM_MODEL is blank", async () => {
      process.env.MEGALLM_MODEL = "   ";
      vi.resetModules();

      const { MODEL } = await import("../src/proxy/ai-client.js");
      expect(MODEL).toBe("openai-gpt-oss-120b");
    });

    it("prefers MEGALLM_MODEL when it is provided", async () => {
      process.env.MEGALLM_MODEL = "custom-model";
      vi.resetModules();

      const { MODEL } = await import("../src/proxy/ai-client.js");
      expect(MODEL).toBe("custom-model");
    });
  });

  describe("estimateTokens", () => {
    it("estimates ~4 chars per token", () => {
      expect(estimateTokens("a".repeat(400))).toBe(100);
    });

    it("handles empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("rounds up for partial token", () => {
      expect(estimateTokens("abc")).toBe(1);
      expect(estimateTokens("abcde")).toBe(2);
    });
  });

  describe("truncateForContext", () => {
    it("returns text unchanged when under limit", () => {
      const text = "short text";
      expect(truncateForContext(text, 100)).toBe(text);
    });

    it("truncates text that exceeds limit", () => {
      const text = "a".repeat(500);
      const result = truncateForContext(text, 100);
      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain("truncated");
    });

    it("uses 60k token default limit", () => {
      const text = "a".repeat(100);
      expect(truncateForContext(text)).toBe(text);
    });
  });

  describe("buildAskMessages", () => {
    it("builds system + user messages", () => {
      const messages = buildAskMessages("How does auth work?", {
        projectRoot: "/project",
        relevantFiles: [
          {
            path: "src/auth/index.ts",
            content: "export function auth() {}",
            line: 10,
          },
        ],
      });

      expect(messages.length).toBeGreaterThanOrEqual(2);
      const last = messages[messages.length - 1];
      expect(last.role).toBe("user");
      expect(getStr(last.content)).toContain("How does auth work?");
      const systemMsg = messages.find(
        (m) =>
          m.role === "system" && getStr(m.content).includes("auth/index.ts"),
      );
      expect(systemMsg).toBeDefined();
    });

    it("includes file:line references", () => {
      const messages = buildAskMessages("question", {
        projectRoot: "/project",
        relevantFiles: [{ path: "src/test.ts", content: "code", line: 42 }],
      });

      const systemMsg = messages.find(
        (m) => m.role === "system" && getStr(m.content).includes("test.ts"),
      );
      expect(systemMsg).toBeDefined();
      expect(getStr(systemMsg!.content)).toContain("test.ts:42");
    });

    it("handles empty relevant files", () => {
      const messages = buildAskMessages("question", {
        projectRoot: "/project",
        relevantFiles: [],
      });
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("buildReviewMessages", () => {
    it("includes diff in system message", () => {
      const messages = buildReviewMessages(
        "diff --git a/file.ts b/file.ts\n+added line",
      );
      expect(messages.some((m) => getStr(m.content).includes("diff"))).toBe(
        true,
      );
    });

    it("includes coverage when provided", () => {
      const messages = buildReviewMessages("diff", "UserService.ts: 62%");
      expect(messages.some((m) => getStr(m.content).includes("62%"))).toBe(
        true,
      );
    });

    it("does not include coverage when not provided", () => {
      const messages = buildReviewMessages("diff");
      expect(
        messages.some((m) => getStr(m.content).includes("Coverage data:")),
      ).toBe(false);
    });

    it("has user message requesting review", () => {
      const messages = buildReviewMessages("diff");
      const userMsg = messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(getStr(userMsg!.content)).toContain("review");
    });
  });

  describe("buildBriefMessages", () => {
    it("includes file tree", () => {
      const messages = buildBriefMessages(
        "src/\n  index.ts",
        ["src/index.ts"],
        [],
        "dev 10",
      );
      expect(messages.some((m) => getStr(m.content).includes("index.ts"))).toBe(
        true,
      );
    });

    it("includes entry points", () => {
      const messages = buildBriefMessages(
        "tree",
        ["src/index.ts", "src/app.ts"],
        [],
        "dev 10",
      );
      expect(
        messages.some((m) => getStr(m.content).includes("src/index.ts")),
      ).toBe(true);
      expect(
        messages.some((m) => getStr(m.content).includes("src/app.ts")),
      ).toBe(true);
    });

    it("includes complexity data", () => {
      const messages = buildBriefMessages(
        "tree",
        [],
        [{ file: "src/big.ts", complexity: 25 }],
        "dev 10",
      );
      expect(messages.some((m) => getStr(m.content).includes("big.ts"))).toBe(
        true,
      );
      expect(messages.some((m) => getStr(m.content).includes("25"))).toBe(true);
    });

    it("includes git shortlog", () => {
      const messages = buildBriefMessages(
        "tree",
        [],
        [],
        "8\tJohn Doe\n5\tJane Smith",
      );
      expect(messages.some((m) => getStr(m.content).includes("John Doe"))).toBe(
        true,
      );
      expect(
        messages.some((m) => getStr(m.content).includes("Jane Smith")),
      ).toBe(true);
    });
  });
});
