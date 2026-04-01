// CLI Entry Point for project-health
// Uses commander for CLI framework (as per RULES.md rule 4)

import { Command } from "commander";
import chalk from "chalk";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { simpleGit } from "simple-git";
import { shouldIgnorePath } from "../utils/ignore.js";
import {
  detectProjectType,
  getWeightPreset,
  getValidProjectTypes,
  hasCustomWeightConfig,
  type ProjectType,
} from "../utils/project-type.js";
import {
  createCacheManager,
  initCache,
  checkCacheExists,
} from "../cache/index.js";
import { createConfigManager } from "../config/index.js";
import {
  runAllModules,
  runSingleModule,
  createHealthReport,
  modules,
} from "../modules/index.js";
import {
  printHealthReport,
  printJson,
  printHtml,
  printError,
  printSuccess,
  printWarning,
  printInfo,
  ExitCode,
  generateHtmlReport,
  createSpinner,
  createOperationSpinner,
  ParallelProgress,
  renderInit,
  printModuleResult as printModuleResultFn,
  renderReviewHeader,
  renderReviewText,
  renderReviewFooter,
  renderCiCheck,
  renderBriefHeader,
  renderBriefComplete,
  renderAnalysisHeader,
  renderAnalysisFooter,
  createStreamFormatter,
  THEME,
  sectionDivider,
  showBanner,
} from "../utils/output.js";
import { getModuleName } from "../modules/index.js";
import { toSarif } from "../formatters/sarif.js";
import { appendHistoryEntry } from "../history/index.js";
import { buildRagAskMessages, buildRagContext } from "../proxy/rag.js";
import {
  createAIClient,
  chat,
  streamChat,
  MODEL,
  MAX_TOKENS,
  estimateTokens,
  truncateForContext,
} from "../proxy/ai-client.js";
import {
  buildCiCheckJson,
  parseCiCheckModules,
  renderCiCheckText,
} from "./commands/ci-check.js";
import { registerTrendCommand } from "./commands/trend.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerFixCommand } from "./commands/fix.js";
import { runContextCommand } from "./commands/context.js";
import { buildContextDocument } from "../context/index.js";
import { startShell } from "./commands/shell.js";
import type {
  ModuleId,
  ProjectHealthConfig,
  HealthReport,
} from "../types/index.js";
import type { InitStep } from "../utils/output.js";
import { createLogger } from "../utils/logger.js";
import {
  parseGitHubUrl,
  fetchRepoContents,
  cloneToTemp,
} from "../utils/github-fetcher.js";

const log = createLogger("ph:cli");

// REPL-safe exit helpers — imported from shared module to avoid circular deps
import { ShellExitError, setReplMode, shellExit } from "./shell-exit.js";
export { ShellExitError, setReplMode, shellExit };

const program = new Command();

// Show modern banner on launch (only in interactive terminals)
if (process.stdout.isTTY && !process.env.PH_NO_BANNER) {
  showBanner();
}

// Get project root (current directory)
function getProjectRoot(): string {
  return process.cwd();
}

// Load configuration
async function loadConfig(projectRoot: string): Promise<ProjectHealthConfig> {
  const configManager = createConfigManager(projectRoot);
  return configManager.load();
}

function createEmptyReport(projectRoot: string): HealthReport {
  return {
    score: 0,
    generatedAt: new Date().toISOString(),
    projectRoot,
    modules: [],
    findings: [],
    topActions: [],
  };
}

async function seedCacheIndexes(projectRoot: string): Promise<void> {
  const cache = createCacheManager(projectRoot);
  await cache.saveLastScan(createEmptyReport(projectRoot));
  await cache.saveAstIndex({});
  await cache.saveDocsIndex({});
}

async function writeProjectConfig(projectRoot: string): Promise<void> {
  const configManager = createConfigManager(projectRoot);
  const config = await configManager.load();
  await configManager.save(config);
}

function updateGitignore(projectRoot: string): string {
  const gitignorePath = join(projectRoot, ".gitignore");

  try {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    if (!gitignore.includes(".ph-cache/")) {
      writeFileSync(
        gitignorePath,
        gitignore + "\n# Cache directory for project-health\n.ph-cache/\n",
      );
      return "added .ph-cache/";
    }

    return ".ph-cache/ already present";
  } catch (err) {
    log("Error in init .gitignore: %O", err);
    writeFileSync(
      gitignorePath,
      "# Cache directory for project-health\n.ph-cache/\n",
    );
    return "created .gitignore with .ph-cache/";
  }
}

async function installGitHook(projectRoot: string): Promise<string> {
  const gitDir = join(projectRoot, ".git", "hooks");
  if (!existsSync(gitDir)) {
    return "skipped, .git directory not found";
  }

  mkdirSync(gitDir, { recursive: true });

  const postCommitHook = join(gitDir, "post-commit");
  const hookContent = `#!/bin/sh
# Project Health post-commit hook - AI-05 Commit Doc Updater
# Automatically updates stale documentation after source file commits

# Get the project root (assuming we're in the repo root)
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"

if [ -n "$PROJECT_ROOT" ]; then
  node "$PROJECT_ROOT/dist/hooks/post-commit.js" "$PROJECT_ROOT" 2>/dev/null || true
fi
`;
  writeFileSync(postCommitHook, hookContent);

  try {
    const { chmodSync } = await import("node:fs");
    chmodSync(postCommitHook, 0o755);
  } catch (err) {
    log("Error in init chmod: %O", err);
  }

  return "post-commit hook ready";
}

function createInitSteps(projectRoot: string): InitStep[] {
  return [
    {
      label: "Create cache directory",
      run: async () => {
        const cachePath = await initCache(projectRoot);
        return `created ${cachePath}/`;
      },
    },
    {
      label: "Seed cache indexes",
      run: async () => {
        await seedCacheIndexes(projectRoot);
        return "ast-index.json, docs-index.json, last-scan.json";
      },
    },
    {
      label: "Write project config",
      run: async () => {
        await writeProjectConfig(projectRoot);
        return "project-health.config.ts with default weights";
      },
    },
    {
      label: "Update .gitignore",
      run: async () => updateGitignore(projectRoot),
    },
    {
      label: "Install git hook",
      run: async () => installGitHook(projectRoot),
    },
  ];
}

async function runInitSteps(projectRoot: string): Promise<void> {
  for (const step of createInitSteps(projectRoot)) {
    await step.run();
  }
}

async function ensureProjectInitialized(projectRoot: string): Promise<void> {
  if (await checkCacheExists(projectRoot)) {
    return;
  }

  await runInitSteps(projectRoot);
}

// ph init command
program
  .command("init")
  .description("Initialize project-health in the current directory")
  .action(async () => {
    try {
      const projectRoot = getProjectRoot();
      await renderInit(createInitSteps(projectRoot));
      // After successful init, launch the interactive shell
      await startShell(program);
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      shellExit(ExitCode.FAIL_UNDER);
    }
  });

// Badge generation function
function generateShieldBadge(score: number): string {
  let color: string;
  let label: string;

  if (score >= 90) {
    color = "green";
    label = "EXCELLENT";
  } else if (score >= 75) {
    color = "blue";
    label = "GOOD";
  } else if (score >= 60) {
    color = "yellow";
    label = "MODERATE";
  } else if (score >= 40) {
    color = "orange";
    label = "HIGH RISK";
  } else {
    color = "red";
    label = "CRITICAL";
  }

  return `![Health](https://img.shields.io/badge/health-${score}%25-${color})`;
}

// ph scan command
program
  .command("scan")
  .description("Run all 8 analysis modules in parallel")
  .option(
    "-f, --format <format>",
    "Output format: terminal, json, html, sarif",
    "terminal",
  )
  .option("-o, --output <file>", "Output file path (for HTML format)")
  .option(
    "--fail-under <score>",
    "Exit with code 1 if score is below threshold",
    (val) => parseInt(val, 10),
    0,
  )
  .option("-m, --module <id>", "Run a single module (e.g., M-01)")
  .option("-w, --watch", "Watch mode - re-run on file changes")
  .option(
    "--project-type <type>",
    `Override auto-detected project type (${getValidProjectTypes().join(", ")})`,
  )
  .option(
    "--remote <url>",
    "Analyze a remote GitHub repo without cloning (e.g., https://github.com/owner/repo)",
  )
  .option("--badge", "Generate shields.io health badge and print to stdout")
  .option("--badge-insert", "Auto-insert badge into README.md")
  .action(async (options) => {
    try {
      const projectRoot = getProjectRoot();
      await ensureProjectInitialized(projectRoot);

      const config = await loadConfig(projectRoot);

      // Detect or use override project type
      let projectType: ProjectType;
      const validTypes = getValidProjectTypes();

      if (options.projectType) {
        // User provided override
        if (!validTypes.includes(options.projectType as ProjectType)) {
          printError(
            `Invalid project type: ${options.projectType}. Valid types: ${validTypes.join(", ")}`,
          );
          shellExit(ExitCode.FAIL_UNDER);
        }
        projectType = options.projectType as ProjectType;
      } else {
        // Auto-detect project type
        projectType = detectProjectType(projectRoot);
      }

      // Apply weight preset if user hasn't set custom weights in config
      const weightPreset = getWeightPreset(projectType);
      const hasCustomWeights = hasCustomWeightConfig(projectRoot);

      if (!hasCustomWeights) {
        config.scoring.weights = { ...weightPreset };
        printInfo(
          `Detected project type: ${projectType} — using ${projectType} weight preset`,
        );
      } else if (options.projectType) {
        printInfo(
          `Using project type override: ${projectType} — custom scoring weights preserved`,
        );
      } else {
        printInfo(
          `Detected project type: ${projectType} — custom scoring weights preserved`,
        );
      }

      let results;

      if (options.module) {
        // Run single module with spinner
        let moduleIdStr = options.module.toUpperCase();

        const friendlyMap: Record<string, ModuleId> = {
          CICD: "M-01",
          QUALITY: "M-02",
          DOCS: "M-03",
          FLAKINESS: "M-04",
          SECURITY: "M-05",
          PRCOMPLEXITY: "M-06",
          ENV: "M-07",
          BUILDPERF: "M-08",
        };

        const moduleId = (friendlyMap[moduleIdStr] || moduleIdStr) as ModuleId;

        if (!modules.has(moduleId)) {
          printError(
            `Unknown module: ${options.module}. Use M-01 through M-08 or module names.`,
          );
          shellExit(ExitCode.FAIL_UNDER);
        }
        const moduleName = getModuleName(moduleId);
        const spinner = createOperationSpinner(
          "analyze",
          `Running ${moduleName}...`,
        );
        spinner.start();
        const result = await runSingleModule(moduleId, config, modules);
        spinner.succeed(
          `${moduleName} completed — score ${result.score}/100 (${result.durationMs}ms)`,
        );
        results = [result];
      } else {
        // Run all modules in parallel with animated progress board
        const allModuleIds = [
          "M-01",
          "M-02",
          "M-03",
          "M-04",
          "M-05",
          "M-06",
          "M-07",
          "M-08",
        ] as ModuleId[];
        const moduleList = allModuleIds.map((id) => ({
          moduleId: id,
          moduleName: getModuleName(id),
        }));

        const progress = new ParallelProgress(moduleList);
        progress.start();

        // Mark all as running immediately
        for (const id of allModuleIds) {
          progress.setRunning(id);
        }

        // Run each module individually to track progress
        const runModuleWithProgress = async (moduleId: ModuleId) => {
          const startMs = Date.now();
          try {
            const result = await runSingleModule(moduleId, config, modules);
            progress.setDone(moduleId, result.score, result.durationMs);
            return result;
          } catch {
            progress.setError(moduleId);
            return {
              moduleId,
              moduleName: getModuleName(moduleId),
              score: 0,
              status: "error" as const,
              findings: [],
              metadata: {},
              durationMs: Date.now() - startMs,
            };
          }
        };

        results = await Promise.all(
          allModuleIds.map((id) => runModuleWithProgress(id)),
        );
        progress.finish();
      }

      // Create health report
      const report = await createHealthReport(results, config, projectRoot);

      // Output based on format
      if (options.format === "json") {
        printJson(report);
      } else if (options.format === "html") {
        // Generate self-contained HTML report
        const html = generateHtmlReport(report);
        if (options.output) {
          writeFileSync(options.output, html);
          printSuccess(`HTML report written to ${options.output}`);
        } else {
          printHtml(html);
        }
      } else if (options.format === "sarif") {
        console.log(JSON.stringify(toSarif(report), null, 2));
      } else {
        printHealthReport(report);
      }

      try {
        await appendHistoryEntry(report);
      } catch (historyError) {
        printWarning(
          `Could not persist scan history: ${
            historyError instanceof Error
              ? historyError.message
              : String(historyError)
          }`,
        );
      }

      // Check fail-under threshold (P9-TC01, P9-TC02)
      if (options.failUnder > 0 && report.score < options.failUnder) {
        process.stderr.write(
          `\nHealth score ${report.score} is below threshold ${options.failUnder}\n`,
        );
        shellExit(ExitCode.FAIL_UNDER);
      }

      // Handle watch mode
      if (options.watch) {
        const { shouldIgnorePath } = await import("../utils/ignore.js");
        printInfo("\nWatch mode enabled. Press Ctrl+C to exit.");

        // Watch for file changes
        const { watch } = await import("node:fs");
        const watcher = watch(
          projectRoot,
          { recursive: true },
          async (eventType, filename) => {
            if (!filename) return;

            // Use shared ignore list to skip irrelevant files
            if (shouldIgnorePath(filename)) return;

            // Determine which module to re-run based on file extension
            let moduleToRun: ModuleId | null = null;

            if (filename.match(/\.(ts|tsx|js|jsx)$/)) {
              // TypeScript/JavaScript files - run M-02 Code Quality
              moduleToRun = "M-02";
            } else if (filename.match(/\.md$|\.rst$|\.adoc$/)) {
              // Documentation files - run M-03 Docs
              moduleToRun = "M-03";
            } else if (filename.match(/\.(yaml|yml)$/)) {
              // CI config files - run M-01 CI/CD
              moduleToRun = "M-01";
            } else if (filename.match(/^\.env/)) {
              // Env files - run M-07 Environment
              moduleToRun = "M-07";
            } else if (filename.match(/\.json$/)) {
              // Package files - check for package.json or lock files
              if (
                filename.includes("package.json") ||
                filename.includes("lock")
              ) {
                moduleToRun = "M-05";
              }
            }

            if (moduleToRun) {
              console.log(`\n📁 File changed: ${filename}`);
              console.log(`🔄 Re-running ${moduleToRun}...`);

              const moduleRunner = modules.get(moduleToRun);
              if (moduleRunner) {
                try {
                  const moduleResult = await moduleRunner(config);
                  const spinner = createSpinner("Running module...");
                  spinner.succeed(
                    `${moduleResult.moduleName} completed in ${moduleResult.durationMs}ms`,
                  );

                  if (moduleResult.findings.length > 0) {
                    console.log(
                      `\n📋 Findings for ${moduleResult.moduleName}:`,
                    );
                    for (const finding of moduleResult.findings.slice(0, 5)) {
                      console.log(`  ${finding.severity}: ${finding.message}`);
                    }
                  }
                } catch (error) {
                  console.error(`Error running module: ${error}`);
                }
              }
            }
          },
        );

        // Handle graceful shutdown
        process.on("SIGINT", () => {
          console.log("\n\n👋 Watch mode stopped.");
          watcher.close();
          process.exit(ExitCode.SUCCESS);
        });

        // Keep the process running
        return;
      }

      shellExit(ExitCode.SUCCESS);
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      shellExit(ExitCode.FAIL_UNDER);
    }
  });

// ph ci-check command
program
  .command("ci-check")
  .description("Run a fast CI-focused check using critical modules only")
  .option(
    "--modules <ids>",
    "Comma-separated module IDs to run (default: M-05,M-07)",
  )
  .option(
    "--fail-under <score>",
    "Exit with code 1 if score is below threshold",
    (val) => parseInt(val, 10),
    60,
  )
  .option("-f, --format <format>", "Output format: json, text", "text")
  .option(
    "--timeout <ms>",
    "Timeout in milliseconds (default: 60000)",
    (val) => parseInt(val, 10),
    60_000,
  )
  .action(async (options) => {
    const timeoutMs = options.timeout;
    const timeoutMessage = `ci-check timed out after ${Math.round(timeoutMs / 1000)} seconds`;

    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      const projectRoot = getProjectRoot();
      const initialized = await checkCacheExists(projectRoot);
      if (!initialized) {
        printError('Project not initialized. Run "ph init" first.');
        shellExit(ExitCode.FAIL_UNDER);
      }

      const selectedModules = parseCiCheckModules(options.modules);
      const config = await loadConfig(projectRoot);

      const ciSpinner = createOperationSpinner(
        "ci",
        `Running CI check (${selectedModules.length} modules)...`,
      );
      ciSpinner.start();

      const runPromise = (async () => {
        const results = await Promise.all(
          selectedModules.map((moduleId) =>
            runSingleModule(moduleId, config, modules),
          ),
        );

        return createHealthReport(results, config, projectRoot);
      })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(timeoutMessage)),
          timeoutMs,
        );
      });

      const report = await Promise.race([runPromise, timeoutPromise]);

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      ciSpinner.succeed(`CI check complete — score ${report.score}/100`);

      if (options.format === "json") {
        printJson(buildCiCheckJson(report, options.failUnder));
      } else if (options.format === "text") {
        renderCiCheck(report, options.failUnder);
      } else {
        printError(`Unsupported format: ${options.format}. Use json or text.`);
        shellExit(ExitCode.FAIL_UNDER);
      }

      if (report.score < options.failUnder) {
        shellExit(ExitCode.FAIL_UNDER);
      }

      shellExit(ExitCode.SUCCESS);
    } catch (error) {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (error instanceof Error && error.message === timeoutMessage) {
        printError(error.message);
        shellExit(2);
      }

      printError(error instanceof Error ? error.message : String(error));
      shellExit(ExitCode.FAIL_UNDER);
    }
  });

// ph score command
program
  .command("score")
  .description("Print the latest health score without re-running modules")
  .action(async () => {
    try {
      const projectRoot = getProjectRoot();
      const cache = createCacheManager(projectRoot);

      const scoreSpinner = createOperationSpinner(
        "score",
        "Reading cached score...",
      );
      scoreSpinner.start();

      const lastScan = await cache.getLastScan();

      if (!lastScan) {
        scoreSpinner.fail("No cached score");
        printError('No previous scan found. Run "ph scan" first.');
        shellExit(ExitCode.FAIL_UNDER);
      }

      scoreSpinner.succeed(`Health score: ${lastScan.score}/100`);
      printJson({ score: lastScan.score, generatedAt: lastScan.generatedAt });
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      shellExit(ExitCode.FAIL_UNDER);
    }
  });

// ─── Unified Chat Function ──────────────────────────────────────────
// Combines ph ask (RAG one-shot) + ph chat (multi-turn REPL)
// Two modes:
//   1. One-shot:  runChat({ question: "..." }) — RAG context, single response
//   2. REPL:      runChat({}) — interactive multi-turn with RAG per question
async function runChat(opts: {
  question?: string;
  proxy?: string;
  fullContext?: boolean;
}): Promise<void> {
  const projectRoot = getProjectRoot();
  const cache = createCacheManager(projectRoot);

  // Resolve AI client
  const baseUrl =
    opts.proxy ||
    process.env.PROJECT_HEALTH_BACKEND_URL ||
    process.env.MEGALLM_BASE_URL ||
    "https://project-healthy.vercel.app/v1";
  const client = createAIClient(baseUrl);

  // Check if RAG cache is available
  const astIndexPath = join(projectRoot, ".ph-cache", "ast-index.json");
  const lastScanPath = join(projectRoot, ".ph-cache", "last-scan.json");
  const hasRagCache = existsSync(astIndexPath) && existsSync(lastScanPath);
  const hasFullContext =
    opts.fullContext &&
    existsSync(join(projectRoot, ".ph-cache", "context.xml"));

  // Get last scan for system context
  const lastScan = await cache.getLastScan();

  // Build system message with scan results
  let systemContent =
    "You are a code analysis assistant for project-health CLI. " +
    "Provide answers with file:line citations when referencing code.";

  if (lastScan) {
    systemContent += `\n\nCurrent project health scan results:
- Overall Score: ${lastScan.score ?? "N/A"}/100
- Modules: ${(lastScan.modules ?? []).map((m: any) => `${m.moduleId}:${m.score}`).join(", ")}
- Top Issues: ${(lastScan.findings ?? [])
      .slice(0, 3)
      .map((f: any) => f.message)
      .join("; ")}`;
  }

  // ─── One-shot mode (replaces ph ask) ──────────────────────────────
  if (opts.question) {
    let prompt: string;

    if (opts.fullContext) {
      // Use full repository context (from ph context command)
      if (!existsSync(join(projectRoot, ".ph-cache", "context.xml"))) {
        printInfo(
          "Generating full context (run 'ph context' first for faster subsequent runs)...",
        );
        const fullContext = await buildContextDocument(projectRoot, {
          includeFileContents: true,
          includeDiffs: true,
          includeGitLog: true,
          maxFileSizeBytes: 128 * 1024,
          sortBy: "path",
          gitLogLimit: 20,
          diffCharLimit: 20000,
        });
        prompt = `You are a codebase expert. Use the following full repository context to answer the question.\n\n${fullContext}\n\nUSER QUESTION: ${opts.question}\n\nProvide specific file:line references when answering.`;
      } else {
        const fullContext = readFileSync(
          join(projectRoot, ".ph-cache", "context.xml"),
          "utf-8",
        );
        prompt = `You are a codebase expert. Use the following full repository context to answer the question.\n\n${fullContext}\n\nUSER QUESTION: ${opts.question}\n\nProvide specific file:line references when answering.`;
      }
    } else {
      // Use AST index based RAG
      if (!hasRagCache) {
        printError(
          "Missing .ph-cache/ast-index.json or .ph-cache/last-scan.json. Run `ph scan` first.",
        );
        shellExit(ExitCode.FAIL_UNDER);
      }
      const { prompt: ragPrompt } = await buildRagContext(
        projectRoot,
        opts.question,
      );
      prompt = ragPrompt;
    }

    // Compose messages: system + user prompt
    const messages = [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: prompt },
    ];

    // Stream response
    process.stdout.write("\n");
    for await (const chunk of streamChat(client, messages)) {
      process.stdout.write(chunk);
    }
    process.stdout.write("\n");
    return;
  }

  // ─── REPL mode (interactive multi-turn) ────────────────────────────

  // Initialize messages array
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemContent }];

  // Print welcome
  console.log("\n=== Project Health Chat ===");
  if (opts.fullContext) {
    console.log(
      "Full context mode enabled — using complete repository context for richer answers.",
    );
  } else if (hasRagCache) {
    console.log(
      "RAG context enabled — questions will reference relevant files automatically.",
    );
  }
  console.log(
    "Ask questions about your codebase. Type 'exit' or press Ctrl+C to quit.\n",
  );

  // Create readline interface
  // Use a no-op output stream to prevent double-echo on Windows/PowerShell.
  // The terminal already echoes typed characters; readline's output write
  // causes a second copy of every character to appear.
  const readline = await import("readline");
  const { Writable } = await import("node:stream");
  const noopOutput = new Writable({
    write(_chunk, _encoding, cb) {
      cb();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: noopOutput,
    terminal: false,
  });

  const askQuestion = (): Promise<void> => {
    return new Promise((resolve) => {
      process.stdout.write("> ");
      rl.question("", async (userInput) => {
        if (!userInput.trim() || userInput.toLowerCase() === "exit") {
          // Save session on exit
          const sessionId = Date.now().toString();
          await cache.saveSession({
            id: sessionId,
            createdAt: new Date().toISOString(),
            messages: messages.slice(1), // Exclude system
          });
          console.log("\nSession saved. Goodbye!");
          rl.close();
          resolve();
          return;
        }

        try {
          // Build turn messages — inject RAG context if available
          let turnMessages: Array<{
            role: "system" | "user" | "assistant";
            content: string;
          }>;

          if (opts.fullContext) {
            // Full context mode: use ph context output
            let fullContextContent: string;
            if (!existsSync(join(projectRoot, ".ph-cache", "context.xml"))) {
              printInfo("Generating full context (first run may be slow)...");
              fullContextContent = await buildContextDocument(projectRoot, {
                includeFileContents: true,
                includeDiffs: true,
                includeGitLog: true,
                maxFileSizeBytes: 128 * 1024,
                sortBy: "path",
                gitLogLimit: 20,
                diffCharLimit: 20000,
              });
            } else {
              fullContextContent = readFileSync(
                join(projectRoot, ".ph-cache", "context.xml"),
                "utf-8",
              );
            }

            turnMessages = [
              ...messages,
              {
                role: "user" as const,
                content: `Use the following full repository context to answer:\n\n${fullContextContent}\n\nUSER QUESTION: ${userInput}`,
              },
            ];
          } else if (hasRagCache) {
            // RAG mode: build enriched prompt with relevant files
            const { prompt: ragPrompt } = await buildRagContext(
              projectRoot,
              userInput,
            );
            const ragMessages = buildRagAskMessages(ragPrompt);

            // Use the RAG user message (has file context) instead of raw input
            turnMessages = [
              ...messages,
              {
                role: "user" as const,
                content: String(ragMessages[1].content),
              },
            ];
          } else {
            // No RAG: use raw input
            turnMessages = [...messages, { role: "user", content: userInput }];
          }

          // Stream response
          process.stdout.write("\nAssistant: ");
          let assistantResponse = "";
          for await (const chunk of streamChat(client, turnMessages as any)) {
            process.stdout.write(chunk);
            assistantResponse += chunk;
          }
          process.stdout.write("\n\n");

          // Add to conversation history (use raw input for history, not RAG prompt)
          messages.push({ role: "user", content: userInput });
          messages.push({ role: "assistant", content: assistantResponse });
        } catch (error) {
          printError(error instanceof Error ? error.message : String(error));
        }

        // Continue the loop
        askQuestion().then(resolve);
      });
    });
  };

  await askQuestion();
}

// ph ask command (deprecated alias — use "ph chat" instead)
program
  .command("ask <question>")
  .description(
    "[deprecated] Ask a question -- use ph chat '<question>' instead",
  )
  .option("-p, --proxy <url>", "Proxy server URL")
  .action(async (question, options) => {
    printWarning('ph ask is deprecated. Use ph chat "<question>" instead.');
    await runChat({ question, proxy: options.proxy });
  });

// ph chat command — unified REPL + one-shot RAG query
// Usage:
//   ph chat              → interactive multi-turn REPL
//   ph chat "question"   → one-shot RAG query (replaces ph ask)
//   ph chat --full-context → use full repository context for RAG
program
  .command("chat [question]")
  .description(
    "AI chat: interactive REPL or one-shot question with RAG context",
  )
  .option("-p, --proxy <url>", "Proxy server URL")
  .option(
    "--full-context",
    "Use full repository context (from ph context) for richer RAG responses",
  )
  .action(async (question: string | undefined, options) => {
    await runChat({
      question,
      proxy: options.proxy,
      fullContext: options.fullContext,
    });
  });
program
  .command("review")
  .description("AI-powered PR review")
  .option(
    "-p, --pr <number>",
    "PR number to review (instead of current branch)",
  )
  .option("--post", "Post review findings as GitHub PR comment")
  .option("-c, --coverage <path>", "Path to coverage JSON file")
  .option("--proxy <url>", "Proxy server URL")
  .action(async (options) => {
    try {
      const projectRoot = getProjectRoot();
      const git = simpleGit(projectRoot);
      const config = loadConfig(projectRoot);

      let diff = "";
      let coverage = "";
      let prNumber: number | undefined;
      let reviewBody = "";

      // Check for coverage file
      if (options.coverage) {
        try {
          const coveragePath = resolve(projectRoot, options.coverage);
          coverage = readFileSync(coveragePath, "utf-8");
        } catch (err) {
          log("Error in review: %O", err);
          printWarning(`Could not read coverage file: ${options.coverage}`);
        }
      }

      if (options.pr) {
        prNumber = parseInt(options.pr, 10);

        const githubToken = process.env.GITHUB_TOKEN;
        if (!githubToken) {
          printError("GITHUB_TOKEN required for --pr option");
          shellExit(1);
        }

        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: githubToken });

        // Get remote
        const remotes = await git.getRemotes(true);
        const originRemote = remotes.find((r) => r.name === "origin");
        if (!originRemote?.refs.fetch) {
          printError("Could not determine GitHub remote");
          shellExit(1);
        }

        const remoteUrl = originRemote.refs.fetch;
        const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (!match) {
          printError("Could not parse GitHub owner/repo from remote");
          shellExit(1);
        }
        const owner = match[1];
        const repo = match[2].replace(/\.git$/, "");

        // Fetch PR diff
        const { data: pullRequest } = await octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });

        // Get PR diff
        const { data: files } = await octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
        });

        diff = files
          .map((f) => `--- ${f.filename}\n+++ ${f.filename}\n${f.patch || ""}`)
          .join("\n");

        if (files.length > 0) {
          const prInfo = `# PR #${prNumber}: ${pullRequest.title}\n\n${pullRequest.body || ""}`;
          diff = prInfo + "\n\n" + diff;
        }
      } else {
        // Get local diff
        try {
          const status = await git.status();
          const diffSummary = await git.diff(["--stat"]);

          if (diffSummary.trim()) {
            diff = await git.diff(["--patch"]);
          } else if (status.staged.length > 0) {
            diff = await git.diff(["--cached", "--patch"]);
          }
        } catch (err) {
          log("Error in review: %O", err);
          printWarning("Could not get git diff - no changes detected");
        }
      }

      if (!diff.trim()) {
        printWarning("No changes to review");
        return;
      }

      const reviewSpinner = createOperationSpinner(
        "review",
        "Analyzing code changes...",
      );
      reviewSpinner.start();

      // Build messages with diff and coverage
      const truncatedDiff = truncateForContext(diff, 50000);
      const { buildReviewMessages } = await import("../proxy/ai-client.js");
      const messages = buildReviewMessages(
        truncatedDiff,
        coverage.length > 0 ? coverage : undefined,
      );

      // Use OpenAI client directly (hosted backend)
      const baseUrl =
        options.proxy ||
        process.env.PROJECT_HEALTH_BACKEND_URL ||
        process.env.MEGALLM_BASE_URL ||
        "https://project-healthy.vercel.app/v1";
      const client = createAIClient(baseUrl);

      reviewSpinner.succeed("Code analysis complete");

      // Render structured review header
      renderReviewHeader(
        {
          totalFindings: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
          verdict: "comment",
          filesReviewed: prNumber
            ? 0
            : (await simpleGit(projectRoot).diff(["--stat"]))
                .split("\n")
                .filter((l) => l.trim()).length,
          linesChanged: { added: 0, removed: 0 },
        },
        {
          branch: (await simpleGit(projectRoot).branchLocal()).current,
          prNumber: prNumber,
        },
      );

      // Stream formatted review output
      const formatter = createStreamFormatter();
      let findingBuffer = "";
      for await (const chunk of streamChat(client, messages)) {
        formatter.write(chunk);
        findingBuffer += chunk;
      }
      formatter.flush();

      reviewBody = findingBuffer;
      renderReviewFooter();

      // Post to GitHub if requested
      if (options.post && prNumber) {
        const githubToken = process.env.GITHUB_TOKEN;
        if (!githubToken) {
          printError("GITHUB_TOKEN required for --post option");
          shellExit(1);
        }

        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: githubToken });

        const remotes = await git.getRemotes(true);
        const originRemote = remotes.find((r) => r.name === "origin");
        if (!originRemote?.refs.fetch) {
          printError("Could not determine GitHub remote");
          shellExit(1);
        }

        const remoteUrl = originRemote.refs.fetch;
        const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (!match) {
          printError("Could not parse GitHub owner/repo from remote");
          shellExit(1);
        }
        const owner = match[1];
        const repo = match[2].replace(/\.git$/, "");

        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: `## AI Code Review\n\n${reviewBody}\n\n---\n*Generated by project-health CLI*`,
        });

        printSuccess(`Review posted to PR #${prNumber}`);
      }
    } catch (error) {
      printError(
        `Review failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      shellExit(1);
    }
  });

// ph brief command
program
  .command("brief")
  .description("Generate ONBOARDING.md for new developers")
  .option("-u, --update", "Regenerate on each release tag")
  .option("-o, --output <path>", "Output file path", "ONBOARDING.md")
  .option("--proxy <url>", "Proxy server URL")
  .action(async (options) => {
    try {
      const projectRoot = getProjectRoot();
      const git = simpleGit(projectRoot);

      const briefSpinner = createOperationSpinner(
        "brief",
        "Building file tree...",
      );
      briefSpinner.start();

      // Build file tree (3 levels deep) using shared ignore list
      function buildFileTree(
        dir: string,
        depth: number = 0,
        maxDepth: number = 3,
      ): string {
        if (depth > maxDepth) return "";

        let tree = "";
        try {
          const entries = readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            const rel = fullPath
              .replace(projectRoot, "")
              .replace(/\\/g, "/")
              .replace(/^\//, "");

            // Use shared ignore list
            if (shouldIgnorePath(rel)) continue;

            const indent = "  ".repeat(depth);

            if (entry.isDirectory()) {
              tree += `${indent}${entry.name}/\n`;
              tree += buildFileTree(fullPath, depth + 1, maxDepth);
            } else if (
              entry.name.endsWith(".ts") ||
              entry.name.endsWith(".js") ||
              entry.name.endsWith(".json") ||
              entry.name.endsWith(".md")
            ) {
              tree += `${indent}${entry.name}\n`;
            }
          }
        } catch (err) {
          log("Error in buildFileTree: %O", err);
          // Ignore permission errors
        }

        return tree;
      }

      const fileTree = buildFileTree(projectRoot);
      briefSpinner.succeed("File tree built");

      // Detect entry points from package.json
      let entryPoints: string[] = [];
      const packageJsonPath = join(projectRoot, "package.json");
      if (existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
          if (pkg.main) entryPoints.push(pkg.main);
          if (pkg.exports) entryPoints.push(...Object.keys(pkg.exports));
          if (pkg.type === "module" && pkg.name) {
            entryPoints.push(
              "src/index.ts",
              "src/main.ts",
              "src/app.ts",
              "index.ts",
              "app.ts",
            );
          }
        } catch (err) {
          log("Error in brief: %O", err);
          // Ignore
        }
      }

      // Also scan for common entry files
      const entryFilePatterns = [
        "index.ts",
        "main.ts",
        "app.ts",
        "server.ts",
        "index.js",
        "main.js",
      ];
      for (const pattern of entryFilePatterns) {
        const possiblePath = join(projectRoot, "src", pattern);
        if (existsSync(possiblePath)) {
          entryPoints.push(possiblePath);
        }
      }

      briefSpinner.start("Analyzing git ownership...");

      // Get git shortlog for ownership — timeout after 5s to avoid hanging on Windows
      let gitShortlog = "";
      try {
        const shortlogPromise = git.raw([
          "shortlog",
          "-sn",
          "--no-merges",
          "HEAD",
        ]);
        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("git shortlog timed out")), 5000),
        );
        gitShortlog = await Promise.race([shortlogPromise, timeoutPromise]);
      } catch (err) {
        log("Error in brief: %O", err);
        printWarning(
          "Could not get git ownership data — continuing without it",
        );
      }

      briefSpinner.succeed("Git ownership analyzed");
      briefSpinner.start("Calculating complexity...");

      // Get complexity data (using fallback regex approach)
      const complexity: Array<{ file: string; complexity: number }> = [];
      try {
        const srcDir = join(projectRoot, "src");
        if (existsSync(srcDir)) {
          function scanComplexity(dir: string) {
            try {
              const entries = readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                if (entry.name.startsWith(".")) continue;

                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                  scanComplexity(fullPath);
                } else if (entry.name.endsWith(".ts")) {
                  try {
                    const content = readFileSync(fullPath, "utf-8");
                    // Count complexity indicators
                    let score = 0;
                    score +=
                      (content.match(/function\s+\w+/g) || []).length * 2;
                    score += (content.match(/class\s+\w+/g) || []).length * 3;
                    score += (content.match(/if\s*\(/g) || []).length;
                    score += (content.match(/for\s*\(/g) || []).length;
                    score += (content.match(/while\s*\(/g) || []).length;
                    score += (content.match(/switch\s*\(/g) || []).length;
                    score += (content.match(/\?\s*[^:]+:/g) || []).length;

                    if (score > 0) {
                      complexity.push({
                        file: fullPath.replace(projectRoot + "/", ""),
                        complexity: score,
                      });
                    }
                  } catch (err) {
                    log("Error in scanComplexity: %O", err);
                    // Ignore read errors
                  }
                }
              }
            } catch (err) {
              log("Error in scanComplexity: %O", err);
              // Ignore permission errors
            }
          }
          scanComplexity(srcDir);
        }
      } catch (err) {
        log("Error in brief: %O", err);
        // Ignore
      }

      // Sort by complexity and take top 10
      complexity.sort((a, b) => b.complexity - a.complexity);
      const topComplexity = complexity.slice(0, 10);

      briefSpinner.succeed("Complexity calculated");
      briefSpinner.start("Generating ONBOARDING.md with AI...");

      // Build messages
      const { buildBriefMessages } = await import("../proxy/ai-client.js");

      const messages = buildBriefMessages(
        fileTree,
        entryPoints,
        topComplexity,
        gitShortlog,
      );

      briefSpinner.succeed("AI content ready");

      const outputPath = resolve(projectRoot, options.output);
      renderBriefHeader(outputPath);

      // Use OpenAI client directly (hosted backend)
      const baseUrl =
        options.proxy ||
        process.env.PROJECT_HEALTH_BACKEND_URL ||
        process.env.MEGALLM_BASE_URL ||
        "https://project-healthy.vercel.app/v1";
      const client = createAIClient(baseUrl);

      const formatter = createStreamFormatter();
      let content = "";
      for await (const chunk of streamChat(client, messages)) {
        formatter.write(chunk);
        content += chunk;
      }
      formatter.flush();

      // Write ONBOARDING.md
      writeFileSync(outputPath, content, "utf-8");

      renderBriefComplete(outputPath, content.split(/\s+/).length);

      // If --update flag, set up git hook for future runs
      if (options.update) {
        printInfo("Setting up git tag hook for automatic regeneration...");
        const hooksDir = join(projectRoot, ".git", "hooks");
        const postTagHook = join(hooksDir, "post-tag");

        try {
          const hookContent = `#!/bin/bash
if [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  npx ph brief --update
fi
`;
          writeFileSync(postTagHook, hookContent, "utf-8");
          printSuccess("Git tag hook installed");
        } catch (err) {
          log("Error in brief: %O", err);
          printWarning(
            "Could not install git hook - you may need to run with admin privileges",
          );
        }
      }
    } catch (error) {
      printError(
        `Brief generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      shellExit(1);
    }
  });

// ph context command
program
  .command("context")
  .description(
    "Generate an LLM-ready repository context file inspired by repomix-style packed output",
  )
  .option("-o, --output <path>", "Output XML file path")
  .option("--stdout", "Print the generated context document to stdout")
  .option(
    "--max-file-size <kb>",
    "Maximum per-file content size in KB before truncation",
    (val) => parseInt(val, 10),
  )
  .option("--max-files <count>", "Maximum number of files to include", (val) =>
    parseInt(val, 10),
  )
  .option(
    "--split-output <chars>",
    "Split large outputs into numbered XML files by approximate character budget",
    (val) => parseInt(val, 10),
  )
  .option("--sort <mode>", "File ordering: path or changes", "path")
  .option(
    "--header <text>",
    "Inline header text to inject into the context file",
  )
  .option(
    "--header-file <path>",
    "Read a custom header block from a file and inject it into the context file",
  )
  .option(
    "--git-log-limit <count>",
    "Number of recent commits to embed",
    (val) => parseInt(val, 10),
  )
  .option(
    "--diff-limit <chars>",
    "Maximum git diff characters to include per diff section",
    (val) => parseInt(val, 10),
  )
  .option("--no-file-contents", "Skip embedding file bodies")
  .option("--no-diffs", "Skip embedding unstaged and staged git diffs")
  .option("--no-log", "Skip embedding recent git log entries")
  .action(async (options) => {
    try {
      const projectRoot = getProjectRoot();
      await runContextCommand(projectRoot, options);
    } catch (error) {
      printError(
        `Context generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      shellExit(ExitCode.FAIL_UNDER);
    }
  });

// ph config command
const configCmd = program
  .command("config")
  .description("Manage project-health configuration")
  .option("-s, --set <key=value>", "Set a configuration value")
  .action(async (options) => {
    try {
      const projectRoot = getProjectRoot();
      const configManager = createConfigManager(projectRoot);
      const config = await configManager.load();

      if (options.set) {
        const [key, value] = options.set.split("=");
        // Try to parse as number if applicable
        let parsedValue: unknown = value;
        if (!isNaN(Number(value))) {
          parsedValue = Number(value);
        } else if (value === "true") {
          parsedValue = true;
        } else if (value === "false") {
          parsedValue = false;
        }

        await configManager.setValue(key, parsedValue);
        printSuccess(`Set ${key}=${value}`);
      } else {
        // Print current config
        console.log(JSON.stringify(config, null, 2));
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      shellExit(ExitCode.FAIL_UNDER);
    }
  });

// ph config wizard — interactive configuration
import { runConfigWizard } from "./commands/config-wizard.js";

configCmd
  .command("wizard")
  .description("Interactive configuration wizard")
  .action(async () => {
    try {
      await runConfigWizard();
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      shellExit(ExitCode.FAIL_UNDER);
    }
  });

// ph diff command
import { runDiffCommand } from "./commands/diff.js";

program
  .command("diff")
  .description(
    "Compare current branch against base, run relevant modules on changed files only",
  )
  .option("-b, --base <branch>", "Base branch to compare against", "main")
  .option("-f, --format <format>", "Output format: json or text", "text")
  .action(async (options) => {
    try {
      const diffSpinner = createOperationSpinner(
        "diff",
        `Comparing against ${options.base}...`,
      );
      diffSpinner.start();

      const result = await runDiffCommand({
        base: options.base,
        format: options.format,
      });

      diffSpinner.succeed(
        `Diff complete — ${result.changedFiles.length} files changed`,
      );

      if (options.format === "json") {
        // Output JSON
        const output = {
          baseBranch: result.baseBranch,
          changedFiles: result.changedFiles,
          modulesInvoked: result.modulesInvoked,
          newFindings: result.newFindings,
          resolvedFindings: result.resolvedFindings,
          scoreDelta: result.scoreDelta,
          impactScore: result.impactScore,
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        // Structured text output using analysis renderer
        const scoreDeltaStr =
          result.scoreDelta > 0
            ? `+${result.scoreDelta}`
            : String(result.scoreDelta);
        const impactColor =
          result.impactScore > 0.5
            ? THEME.critical
            : result.impactScore > 0.2
              ? THEME.warning
              : THEME.success;

        renderAnalysisHeader(
          "DIFF ANALYSIS",
          `Comparing against ${chalk.hex(THEME.accent)(result.baseBranch)}`,
          {
            "Files changed": String(result.changedFiles.length),
            "Modules invoked": result.modulesInvoked.join(", ") || "none",
            "Score delta": scoreDeltaStr,
            Impact: `${(result.impactScore * 100).toFixed(0)}%`,
          },
        );

        // Show new findings inline with structured rendering
        if (result.newFindings.length > 0) {
          sectionDivider(`new findings (${result.newFindings.length})`);
          process.stdout.write("\n");
          for (const f of result.newFindings.slice(0, 15)) {
            const sev =
              f.severity === "CRITICAL"
                ? chalk.hex(THEME.critical)(`[${f.severity}]`)
                : f.severity === "HIGH"
                  ? chalk.hex(THEME.warning)(`[${f.severity}]`)
                  : chalk.dim(`[${f.severity}]`);
            const loc = f.file
              ? ` ${chalk.hex(THEME.info)(f.file)}${f.line ? chalk.dim(":" + f.line) : ""}`
              : "";
            process.stdout.write(
              `  ${sev} ${chalk.hex(THEME.text)(f.type)}${chalk.dim(loc)}\n`,
            );
            process.stdout.write(
              `         ${chalk.hex(THEME.text)(f.message)}\n`,
            );
          }
          if (result.newFindings.length > 15) {
            process.stdout.write(
              chalk.dim(`  ... and ${result.newFindings.length - 15} more\n`),
            );
          }
        }

        if (result.resolvedFindings.length > 0) {
          sectionDivider(`resolved (${result.resolvedFindings.length})`);
          process.stdout.write("\n");
          for (const f of result.resolvedFindings.slice(0, 5)) {
            process.stdout.write(
              `  ${chalk.hex(THEME.success)("✓")} ${chalk.dim(f.type)} ${chalk.dim(f.message)}\n`,
            );
          }
        }

        if (result.impactScore > 0.5) {
          renderAnalysisFooter(
            "⚠ This change degrades project health significantly",
          );
        } else if (result.impactScore > 0.2) {
          renderAnalysisFooter(
            "⚡ Moderate health impact — review findings above",
          );
        } else {
          renderAnalysisFooter("✓ Low impact");
        }
      }

      // Exit code 1 if impact > 50%
      if (result.impactScore > 0.5) {
        shellExit(ExitCode.FAIL_UNDER);
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      shellExit(ExitCode.FAIL_UNDER);
    }
  });

registerTrendCommand(program);

// ph fix command - Auto-fix findings from last scan
import { FIX_STRATEGIES, findFixStrategy } from "../fix/strategies.js";
import { Finding } from "../types/index.js";

interface ScanReport {
  score: number;
  generatedAt: string;
  projectRoot: string;
  modules: Array<{
    moduleId: string;
    moduleName: string;
    score: number;
    status: string;
    findings: Finding[];
    metadata: Record<string, unknown>;
    durationMs: number;
  }>;
  findings: Finding[];
  topActions: string[];
}

// Explore - Interactive repository explorer with web UI
program
  .command("explore")
  .description(
    "Interactive repository explorer with web UI (file tree, commit history, diffs)",
  )
  .option("-p, --port <port>", "Port for web server", "7878")
  .action(async (options) => {
    try {
      const projectRoot = process.cwd();
      const { runExplore } = await import("./commands/explore.js");
      await runExplore(projectRoot, { port: parseInt(options.port) });
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      shellExit(1);
    }
  });

// Version — read dynamically from package.json
const _pkgJson = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf-8"),
);
program
  .version(_pkgJson.version)
  .name("ph")
  .description("AI-powered health score for software repositories");

// Register plug-in commands
registerDashboardCommand(program);
registerFixCommand(program);

// ph shell command — re-enter the interactive REPL without re-initialising
program
  .command("shell")
  .description("Launch the interactive ph shell (REPL)")
  .action(async () => {
    await startShell(program);
  });

// Parse command line arguments
program.parse(process.argv);
