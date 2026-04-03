import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HealthReport } from "../src/types/index.js";
import {
  buildAnalysis,
  buildFileTree,
  flattenFiles,
  getFileCommits,
} from "../src/cli/commands/explore/data.js";

let testIdx = 0;

function getTestDir(): string {
  testIdx++;
  const dir = join(process.cwd(), `.test-explore-${Date.now()}-${testIdx}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(root: string, relPath: string, content: string) {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

function makeEmptyScan(projectRoot: string): HealthReport {
  return {
    score: 0,
    generatedAt: "2026-04-01T00:00:00.000Z",
    projectRoot,
    modules: [],
    findings: [],
    topActions: [],
  };
}

describe("explore data", () => {
  it("includes real project dotfiles and sibling workspaces in the tree", () => {
    const dir = getTestDir();
    writeFile(dir, "package.json", JSON.stringify({ name: "fixture" }));
    writeFile(dir, ".env.example", "API_URL=http://localhost\n");
    writeFile(dir, ".gitignore", "dist\n");
    writeFile(dir, ".github/workflows/ci.yml", "name: ci\n");
    writeFile(dir, "ai-proxy/src/index.ts", "export const proxy = true;\n");
    writeFile(dir, "src/index.ts", "export const main = true;\n");
    writeFile(dir, ".ph-cache/last-scan.json", "{}\n");
    writeFile(dir, "node_modules/pkg/index.js", "module.exports = {};\n");

    const tree = buildFileTree(dir, new Map());
    const paths = flattenFiles(tree).map((entry) => entry.path);

    expect(paths).toContain(".env.example");
    expect(paths).toContain(".gitignore");
    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths).toContain("ai-proxy/src/index.ts");
    expect(paths).not.toContain(".ph-cache/last-scan.json");
    expect(paths).not.toContain("node_modules/pkg/index.js");
  });

  it("does not fabricate hot files or a health score from an empty scan cache", () => {
    const dir = getTestDir();
    writeFile(
      dir,
      "package.json",
      JSON.stringify({
        name: "explore-empty",
        type: "module",
        dependencies: { commander: "^12.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    );
    writeFile(dir, "src/index.ts", "export const index = true;\n");
    writeFile(dir, "src/modules/m01/index.ts", "export const moduleOne = true;\n");

    const tree = buildFileTree(dir, new Map());
    const analysis = buildAnalysis(dir, tree, {}, makeEmptyScan(dir), null);

    expect(analysis.healthScore).toBeNull();
    expect(analysis.scanStatus).toBe("missing");
    expect(analysis.hotFiles).toEqual([]);
    expect(analysis.descriptor.fileCount).toBe(2);
    expect(analysis.descriptor.entryPoints).toContain("src/index.ts");
    expect(analysis.descriptor.moduleCount).toBeGreaterThanOrEqual(2);
  });

  it("marks cached analysis stale when newer commits or dirty files exist", () => {
    const dir = getTestDir();
    writeFile(
      dir,
      "package.json",
      JSON.stringify({
        name: "explore-stale",
        type: "module",
        dependencies: { commander: "^12.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    );
    writeFile(dir, "src/index.ts", "export const index = true;\n");

    const gitMap = new Map([
      [
        "src/index.ts",
        {
          hash: "abcdef1234567",
          author: "Test User",
          date: "2026-04-03T10:00:00.000Z",
          message: "Recent change",
          changeCount: 4,
        },
      ],
    ]);
    const tree = buildFileTree(dir, gitMap);
    const scan: HealthReport = {
      score: 88,
      generatedAt: "2026-04-01T08:00:00.000Z",
      projectRoot: dir,
      modules: [
        {
          moduleId: "M-02",
          moduleName: "Code Quality",
          score: 88,
          status: "warning",
          findings: [],
          metadata: {},
          durationMs: 100,
        },
      ],
      findings: [],
      topActions: [],
    };
    const status = {
      modified: ["src/index.ts"],
      created: [],
      deleted: [],
      staged: [],
      not_added: [],
      conflicted: [],
      renamed: [],
    } as any;

    const analysis = buildAnalysis(dir, tree, {}, scan, status);

    expect(analysis.healthScore).toBe(88);
    expect(analysis.scanStatus).toBe("stale");
    expect(analysis.scanSummary).toContain("newer commits exist");
    expect(analysis.scanSummary).toContain("unscanned local file");
    expect(analysis.repositoryStats.dirtyFileCount).toBe(1);
    expect(analysis.hotFiles[0]?.path).toBe("src/index.ts");
    expect(analysis.hotFiles[0]?.pendingChanges).toBe(true);
    expect(analysis.hotFiles[0]?.lastAge).toContain("pending changes");
  });

  it("parses numstat diff output for file timelines", async () => {
    const seen: string[][] = [];
    const git = {
      log: async () => ({
        all: [
          {
            hash: "abcdef123456",
            message: "touch file",
            author_name: "Tester",
            date: "2026-04-03T10:00:00.000Z",
          },
        ],
      }),
      raw: async () => "parenthash\n",
      diff: async (args: string[]) => {
        seen.push(args);
        return args[0] === "--numstat" ? "12\t4\tsrc/index.ts\n" : "";
      },
    };

    const commits = await getFileCommits(git as any, "src/index.ts");

    expect(seen[0]?.[0]).toBe("--numstat");
    expect(commits).toHaveLength(1);
    expect(commits[0].additions).toBe(12);
    expect(commits[0].deletions).toBe(4);
  });
});
