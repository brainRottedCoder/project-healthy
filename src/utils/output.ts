/**
 * output.ts — Terminal Rendering Layer for project-health (ph)
 *
 * Design philosophy: structure through whitespace, colour carries meaning only,
 * hierarchy through type weight, scannable from 5 feet away.
 *
 * All public functions are pure renderers: receive data → print to stdout → return void.
 * No business logic, no API calls, no file reads.
 */

import chalk from "chalk";
import * as readline from "node:readline";
import { intro, outro, spinner, log } from "@clack/prompts";
import {
  Severity,
  Finding,
  ScoreBand,
  getScoreBand,
  HealthReport,
  ModuleResult,
} from "../types/index.js";
import { analyzeProject, formatProjectOverview } from "./project-analyzer.js";

// ─────────────────────────────────────────────────────────────────────────────
// THEME CONSTANTS — single source of truth for all visual tokens
// ─────────────────────────────────────────────────────────────────────────────

export const THEME = {
  // Base typography
  text: "#cdd6f4",
  dimMeta: "#3d4466",
  sectionLabel: "#4a5180",
  border: "#1e2330",

  // Semantic colours
  critical: "#f38ba8",
  warning: "#f9e2af",
  success: "#a6e3a1",
  info: "#89b4fa",
  ai: "#cba6f7",
  accent: "#b4befe",

  // Spacing
  INDENT: "  ",
  SECTION_GAP: "\n",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Terminal width, clamped to sane bounds */
function cols(): number {
  return Math.max(60, Math.min(process.stdout.columns || 100, 200));
}

/** Horizontal rule adapted to terminal width */
function rule(): string {
  return chalk.hex(THEME.border)("─".repeat(cols() - 4));
}

/** Semantic colour for a numeric score */
export function scoreColour(score: number): string {
  if (score >= 90) return THEME.success;
  if (score >= 75) return THEME.warning;
  if (score >= 60) return THEME.warning;
  if (score >= 40) return THEME.critical;
  return THEME.critical;
}

/** Score band label */
function scoreBandLabel(score: number): string {
  if (score >= 90) return "EXCELLENT";
  if (score >= 75) return "GOOD";
  if (score >= 60) return "MODERATE";
  if (score >= 40) return "HIGH RISK";
  return "CRITICAL";
}

/** Colour for a severity level */
function severityColour(severity: Severity): string {
  switch (severity) {
    case "CRITICAL":
      return THEME.critical;
    case "HIGH":
      return THEME.critical;
    case "MEDIUM":
      return THEME.warning;
    case "LOW":
      return THEME.success;
    default:
      return THEME.text;
  }
}

/** Dot indicator in severity colour */
function severityDot(severity: Severity): string {
  return chalk.hex(severityColour(severity))("●");
}

/** Wrap text to terminal width with a left-hand prefix */
function wrapText(text: string, prefix: string): string {
  const maxWidth = cols() - 4 - prefix.length;
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.length > 0) {
      lines.push(prefix + current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(prefix + current);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION DIVIDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Print a section divider with a label.
 * @example  ──  top findings  ──────────────────────
 */
export function sectionDivider(label: string): void {
  const left = chalk.hex(THEME.sectionLabel)(`  ─  ${label}  `);
  const used = 6 + label.length;
  const remain = Math.max(0, cols() - 4 - used);
  const right = chalk.hex(THEME.border)("─".repeat(remain));
  process.stdout.write(`${left}${right}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD HINTS
// ─────────────────────────────────────────────────────────────────────────────

export interface KeyHint {
  key: string;
  label: string;
}

/** Print keyboard hints row — always at the bottom, small and dim */
export function keyboardHints(hints: KeyHint[]): void {
  const parts = hints.map(
    ({ key, label }) =>
      chalk.dim("[") + chalk.hex(THEME.info)(key) + chalk.dim(`] ${label}`),
  );
  process.stdout.write(`\n  ${parts.join(chalk.dim("  "))}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE BAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Print a single module bar-chart row.
 * Format:  dim-id  dim-name  ████████░░░░  score
 */
export function moduleBar(
  moduleId: string,
  name: string,
  score: number,
  delta?: number,
): void {
  const colour = scoreColour(score);
  const barMax = Math.max(10, cols() - 44);
  const filled = Math.round((score / 100) * barMax);
  const empty = barMax - filled;

  const idStr = chalk.dim(moduleId.padEnd(5));
  const nameStr = chalk.dim(name.slice(0, 14).padEnd(14));
  const bar =
    chalk.hex(colour)("█".repeat(filled)) +
    chalk.hex(THEME.border)("░".repeat(empty));
  const scoreStr = chalk.hex(colour).bold(score.toString().padStart(3));

  let deltaStr = "";
  if (delta !== undefined) {
    if (delta > 0) deltaStr = chalk.hex(THEME.success)(` ↑${delta}`);
    else if (delta < 0)
      deltaStr = chalk.hex(THEME.critical)(` ↓${Math.abs(delta)}`);
    else deltaStr = chalk.dim(" –");
  }

  process.stdout.write(
    `  ${idStr}${nameStr}  ${bar}  ${scoreStr}${deltaStr}\n`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FINDING RENDERER
// ─────────────────────────────────────────────────────────────────────────────

export function renderFinding(finding: Finding): void {
  const colour = severityColour(finding.severity);

  // Line 1: dot + type
  process.stdout.write(
    `  ${severityDot(finding.severity)}  ${chalk.hex(colour).bold(finding.type)}\n`,
  );

  // Line 2: message
  const msgPrefix = `${THEME.INDENT}${THEME.INDENT}`;
  process.stdout.write(wrapText(finding.message, msgPrefix) + "\n");

  // Line 3: module · file:line
  const location = finding.file
    ? `  · ${chalk.hex(THEME.info)(finding.file)}${finding.line ? chalk.dim(":" + finding.line) : ""}`
    : "";
  process.stdout.write(
    `${msgPrefix}${chalk.dim(finding.moduleId)}${location}\n`,
  );

  // Line 4: fix suggestion
  if (finding.fix) {
    process.stdout.write(
      `${msgPrefix}${chalk.hex(THEME.success)("→ ")}${chalk.hex(THEME.success)(finding.fix)}\n`,
    );
  }

  process.stdout.write("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN RENDERER
// ─────────────────────────────────────────────────────────────────────────────

export function renderScan(report: HealthReport): void {
  const score = report.score;
  const colour = scoreColour(score);
  const band = scoreBandLabel(score);
  const totalMs = report.modules.reduce((s, m) => s + m.durationMs, 0);
  const timeStr =
    totalMs > 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`;

  // ── Rule
  process.stdout.write("\n");
  process.stdout.write("  " + rule() + "\n");
  process.stdout.write("\n");

  // ── Big score
  process.stdout.write(
    `  ${chalk.hex(colour).bold(score.toString())}  ` +
      `${chalk.bgHex(colour).hex("#0b0d12").bold(` ${band} `)}  ` +
      `${chalk.dim(`${report.modules.length} modules · ${timeStr} · ph v2.0`)}\n`,
  );

  process.stdout.write("\n");

  // ── Module bars
  for (const mod of report.modules) {
    moduleBar(mod.moduleId, mod.moduleName, mod.score);
  }

  process.stdout.write("\n");

  // ── Top findings (up to 5)
  const topFindings = [...report.findings]
    .sort((a, b) => {
      const order: Record<Severity, number> = {
        CRITICAL: 0,
        HIGH: 1,
        MEDIUM: 2,
        LOW: 3,
      };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, 5);

  if (topFindings.length > 0) {
    sectionDivider("top findings");
    process.stdout.write("\n");
    for (const finding of topFindings) {
      renderFinding(finding);
    }
  }

  if (report.findings.length > 5) {
    process.stdout.write(
      `  ${chalk.dim(`... and ${report.findings.length - 5} more findings`)}\n`,
    );
  }

  process.stdout.write("\n");
  keyboardHints([
    { key: "r", label: "refresh" },
    { key: "a", label: "ask" },
    { key: "f", label: "fix" },
    { key: "q", label: "quit" },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD RENDERER
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanHistory {
  score: number;
  generatedAt: string;
  commitHash?: string;
}

/** Generate a block sparkline for a score series */
function sparkline(scores: number[]): string {
  const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  return scores
    .map((s) => {
      const norm = max === min ? 1 : (s - min) / (max - min);
      const idx = Math.round(norm * (BLOCKS.length - 1));
      const block = BLOCKS[idx];
      const col = scoreColour(s);
      return chalk.hex(col)(block);
    })
    .join("");
}

let _dashboardInterval: ReturnType<typeof setInterval> | null = null;

export function renderDashboard(
  report: HealthReport,
  history: ScanHistory[],
): void {
  if (_dashboardInterval) {
    clearInterval(_dashboardInterval);
    _dashboardInterval = null;
  }

  function draw(): void {
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen

    const score = report.score;
    const colour = scoreColour(score);
    const band = scoreBandLabel(score);
    const recentScores = history.slice(-14).map((h) => h.score);

    // ── Header: big score + sparkline
    const spark = recentScores.length > 1 ? "  " + sparkline(recentScores) : "";
    process.stdout.write("\n");
    process.stdout.write(
      `  ${chalk.hex(colour).bold(score.toString())}  ` +
        `${chalk.bgHex(colour).hex("#0b0d12").bold(` ${band} `)}` +
        `${spark}\n`,
    );
    process.stdout.write("\n");
    process.stdout.write("  " + rule() + "\n");
    process.stdout.write("\n");

    // ── Module bars with deltas
    const prevHistory = history[history.length - 2];
    for (const mod of report.modules) {
      let delta: number | undefined;
      if (prevHistory) {
        // History stores full reports — just use 0 delta if not available
        delta = 0;
      }
      moduleBar(mod.moduleId, mod.moduleName, mod.score, delta);
    }

    process.stdout.write("\n");
    process.stdout.write("  " + rule() + "\n");
    process.stdout.write("\n");

    // ── Recent activity (last 5 history events)
    sectionDivider("recent activity");
    process.stdout.write("\n");

    const recent = history.slice(-5).reverse();
    for (const entry of recent) {
      const ts = new Date(entry.generatedAt).toLocaleTimeString();
      const sc = entry.score;
      const col = scoreColour(sc);
      const hash = entry.commitHash
        ? chalk.dim(` ${entry.commitHash.slice(0, 7)}`)
        : "";
      process.stdout.write(
        `  ${chalk.dim(ts)}  ${chalk.hex(col).bold(sc.toString().padStart(3))}  ` +
          `${chalk.hex(THEME.sectionLabel)(scoreBandLabel(sc))}${hash}\n`,
      );
    }

    if (recent.length === 0) {
      process.stdout.write(`  ${chalk.dim("No scan history yet")}\n`);
    }

    process.stdout.write("\n");
    keyboardHints([
      { key: "r", label: "refresh" },
      { key: "a", label: "ask" },
      { key: "f", label: "fix" },
      { key: "q", label: "quit" },
      { key: "↑↓", label: "navigate" },
    ]);

    process.stdout.write(chalk.dim(`\n  auto-refreshes every 5s\n`));
  }

  draw();
  _dashboardInterval = setInterval(draw, 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX LIST RENDERER (interactive checkbox picker)
// ─────────────────────────────────────────────────────────────────────────────

export interface AutoFix {
  moduleId: string;
  description: string;
  scoreDelta: number;
  severity: "safe" | "manual";
  cveId?: string;
  enabled?: boolean;
}

/**
 * Interactive checkbox picker for `ph fix --auto`.
 * Returns a Promise that resolves to the list of selected fixes.
 */
export async function renderFixList(fixes: AutoFix[]): Promise<AutoFix[]> {
  if (fixes.length === 0) {
    process.stdout.write(`\n  ${chalk.dim("No auto-fixable issues found.")}\n`);
    return [];
  }

  const states: boolean[] = fixes.map((f) => f.severity === "safe");
  let cursor = 0;

  function renderCheckbox(
    checked: boolean,
    isManual: boolean,
    isSelected: boolean,
  ): string {
    const bracket = isSelected
      ? chalk.hex(THEME.info)("[") +
        (checked ? chalk.hex(THEME.success)("✓") : " ") +
        chalk.hex(THEME.info)("]")
      : isManual
        ? chalk.dim("[–]")
        : checked
          ? chalk.dim("[") + chalk.hex(THEME.success)("✓") + chalk.dim("]")
          : chalk.dim("[ ]");
    return bracket;
  }

  function renderList(): void {
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write("\n");
    sectionDivider(`safe fixes (${fixes.filter((_, i) => states[i]).length})`);
    process.stdout.write("\n");

    for (let i = 0; i < fixes.length; i++) {
      const fix = fixes[i];
      const isManual = fix.severity === "manual";
      const isSelected = i === cursor;
      const cb = renderCheckbox(states[i], isManual, isSelected);
      const idStr = chalk.dim(fix.moduleId.padEnd(5));
      const desc = isSelected
        ? chalk.white(fix.description)
        : chalk.hex(THEME.text)(fix.description);
      const delta =
        fix.scoreDelta > 0
          ? chalk.hex(THEME.success)(` +${fix.scoreDelta}pts`)
          : chalk.dim(" manual");
      const cve = fix.cveId ? chalk.dim(` (${fix.cveId})`) : "";

      const line = `  ${cb} ${idStr}  ${desc}${cve}${delta}`;
      process.stdout.write(line + "\n");
    }

    // Summary
    const selected = fixes.filter((_, i) => states[i]);
    const totalDelta = selected.reduce((s, f) => s + (f.scoreDelta || 0), 0);

    process.stdout.write("\n");
    sectionDivider("summary");
    process.stdout.write("\n");
    process.stdout.write(
      `  ${chalk.dim("projected delta")}  ` +
        chalk.hex(THEME.success).bold(`+${totalDelta} pts`) +
        "\n",
    );
    process.stdout.write("\n");

    keyboardHints([
      { key: "↑↓", label: "navigate" },
      { key: "space", label: "toggle" },
      { key: "enter", label: "confirm" },
      { key: "q", label: "quit" },
    ]);
  }

  return new Promise<AutoFix[]>((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(fixes.filter((_, i) => states[i]));
      return;
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    render();

    function render() {
      renderList();
    }

    process.stdin.on(
      "keypress",
      function onKey(_ch: unknown, key: { name?: string; sequence?: string }) {
        if (!key) return;

        const fix = fixes[cursor];
        const isManual = fix?.severity === "manual";

        if (key.name === "up") {
          cursor = Math.max(0, cursor - 1);
        } else if (key.name === "down") {
          cursor = Math.min(fixes.length - 1, cursor + 1);
        } else if (key.sequence === " " && !isManual) {
          states[cursor] = !states[cursor];
        } else if (key.name === "return") {
          process.stdin.removeListener("keypress", onKey);
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdout.write("\n");
          resolve(fixes.filter((_, i) => states[i]));
          return;
        } else if (
          key.name === "q" ||
          (key.name === "c" && key.sequence === "\x03")
        ) {
          process.stdin.removeListener("keypress", onKey);
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdout.write("\n");
          resolve([]);
          return;
        }

        render();
      },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE RENDERER  (ph compare [branch])
// ─────────────────────────────────────────────────────────────────────────────

export function renderCompare(base: HealthReport, head: HealthReport): void {
  const baseCo = scoreColour(base.score);
  const headCo = scoreColour(head.score);
  const delta = head.score - base.score;

  process.stdout.write("\n");

  // ── Side-by-side scores
  process.stdout.write(
    `  ${chalk.hex(baseCo).bold(base.score.toString())}  ${chalk.dim("→")}  ` +
      `${chalk.hex(headCo).bold(head.score.toString())}  ` +
      (delta > 0
        ? chalk.hex(THEME.success).bold(`▲${delta}pts`)
        : delta < 0
          ? chalk.hex(THEME.critical).bold(`▼${Math.abs(delta)}pts`)
          : chalk.dim("no change")) +
      "\n",
  );

  process.stdout.write("\n");
  process.stdout.write("  " + rule() + "\n");

  // ── New findings
  const baseIds = new Set(base.findings.map((f) => f.id));
  const headIds = new Set(head.findings.map((f) => f.id));

  const newFindings = head.findings.filter((f) => !baseIds.has(f.id));
  const resolvedFindings = base.findings.filter((f) => !headIds.has(f.id));
  const unchangedCount = head.findings.filter((f) => baseIds.has(f.id)).length;

  if (newFindings.length > 0) {
    process.stdout.write("\n");
    sectionDivider(`new findings (${newFindings.length})`);
    process.stdout.write("\n");
    for (const f of newFindings) {
      const col = severityColour(f.severity);
      process.stdout.write(
        `  ${chalk.hex(THEME.critical)("+")}  ${chalk.hex(col).bold(f.type)}  ` +
          chalk.hex(THEME.text)(f.message) +
          "\n",
      );
      if (f.file) {
        process.stdout.write(
          `       ${chalk.hex(THEME.info)(f.file)}${f.line ? chalk.dim(":" + f.line) : ""}\n`,
        );
      }
    }
  }

  if (resolvedFindings.length > 0) {
    process.stdout.write("\n");
    sectionDivider(`resolved findings (${resolvedFindings.length})`);
    process.stdout.write("\n");
    for (const f of resolvedFindings) {
      process.stdout.write(
        `  ${chalk.hex(THEME.success)("✓")}  ${chalk.dim(f.type)}  ` +
          chalk.dim(f.message) +
          "\n",
      );
    }
  }

  if (unchangedCount > 0) {
    process.stdout.write("\n");
    process.stdout.write(
      `  ${chalk.dim(`${unchangedCount} findings unchanged`)}\n`,
    );
  }

  process.stdout.write("\n");
  keyboardHints([
    { key: "p", label: "post to PR" },
    { key: "a", label: "ask about diff" },
    { key: "q", label: "quit" },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT RENDERER (readline REPL)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatContext {
  score?: number;
  moduleCount?: number;
  findingCount?: number;
  onMessage: (
    input: string,
    history: Array<{ role: string; content: string }>,
  ) => Promise<AsyncIterable<string> | string>;
  onExit?: () => void;
}

export async function renderChat(ctx: ChatContext): Promise<void> {
  const history: Array<{ role: string; content: string }> = [];

  // Session header
  process.stdout.write("\n");
  if (ctx.score !== undefined) {
    process.stdout.write(
      `  ${chalk.dim("score")} ${chalk.hex(scoreColour(ctx.score)).bold(ctx.score.toString())}  ` +
        `${chalk.dim(`${ctx.moduleCount ?? 0} modules · ${ctx.findingCount ?? 0} findings`)}\n`,
    );
  }
  process.stdout.write("\n");
  process.stdout.write(chalk.dim('  type your question, or "exit" to quit\n'));
  process.stdout.write("\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.hex(THEME.info)("you") + chalk.dim(" › "),
    historySize: 100,
    terminal: true,
  });

  // Enable cursor
  process.stdout.write("\x1b[?25h");

  rl.prompt();

  rl.on("line", async (rawInput) => {
    const input = rawInput.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "exit" || input === "quit") {
      rl.close();
      return;
    }

    history.push({ role: "user", content: input });

    process.stdout.write("\n");
    process.stdout.write(chalk.hex(THEME.success)(" ph") + chalk.dim(" › "));

    try {
      const response = await ctx.onMessage(input, history);

      let fullContent = "";

      if (typeof response === "string") {
        // Non-streaming
        process.stdout.write("    " + response + "\n");
        fullContent = response;
      } else {
        // Streaming — write token by token with left-indent
        let lineStart = true;
        for await (const token of response) {
          if (lineStart) {
            process.stdout.write("    ");
            lineStart = false;
          }
          process.stdout.write(token);
          fullContent += token;
          if (token.includes("\n")) lineStart = true;
        }
        process.stdout.write("\n");
      }

      history.push({ role: "assistant", content: fullContent });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `\n  ${chalk.hex(THEME.critical)("✗")} ${chalk.dim(msg)}\n`,
      );
    }

    process.stdout.write("\n");
    rl.prompt();
  });

  return new Promise<void>((resolve) => {
    rl.on("close", () => {
      process.stdout.write("\n");
      ctx.onExit?.();
      resolve();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT RENDERER
// ─────────────────────────────────────────────────────────────────────────────

export interface InitStep {
  label: string;
  run: () => Promise<string>;
}

// ── ANSI Colour Block Logo (pixel-art style) ─────────────────────────────

const LOGO = `
  ██████╗ ██╗  ██╗
  ██╔══██╗██║  ██║
  ██████╔╝███████║
  ██╔═══╝ ██╔══██║
  ██║     ██║  ██║
  ╚═╝     ╚═╝  ╚═╝
`.trimStart();

// ── Large ASCII Art Header for "project-health" ──────────────────────────

const PH_ASCII_ART = [
  "  ╔═══════════════════════════════════════════════════════════════════════╗",
  "  ║                                                                       ║",
  "  ║    ██████╗ ██████╗  ██████╗      ██╗███████╗ ██████╗████████╗         ║",
  "  ║    ██╔══██╗██╔══██╗██╔═══██╗     ██║██╔════╝██╔════╝╚══██╔══╝         ║",
  "  ║    ██████╔╝██████╔╝██║   ██║     ██║█████╗  ██║        ██║            ║",
  "  ║    ██╔═══╝ ██╔══██╗██║   ██║██   ██║██╔══╝  ██║        ██║            ║",
  "  ║    ██║     ██║  ██║╚██████╔╝╚█████╔╝███████╗╚██████╗   ██║            ║",
  "  ║    ╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚════╝ ╚══════╝ ╚═════╝   ╚═╝            ║",
  "  ║                                                                       ║",
  "  ║           ██╗  ██╗███████╗ █████╗ ██╗  ████████╗██╗  ██╗              ║",
  "  ║           ██║  ██║██╔════╝██╔══██╗██║  ╚══██╔══╝██║  ██║              ║",
  "  ║           ███████║█████╗  ███████║██║     ██║   ███████║              ║",
  "  ║           ██╔══██║██╔══╝  ██╔══██║██║     ██║   ██╔══██║              ║",
  "  ║           ██║  ██║███████╗██║  ██║███████╗██║   ██║  ██║              ║",
  "  ║           ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═╝              ║",
  "  ║                                                                       ║",
  "  ╚═══════════════════════════════════════════════════════════════════════╝",
] as const;

const PH_ASCII_PALETTE = [
  "#f38ba8",
  "#fab387",
  "#f9e2af",
  "#a6e3a1",
  "#74c7ec",
  "#89b4fa",
  "#cba6f7",
] as const;

// ── Modern banner for CLI launch ─────────────────────────────────────────

const BANNER_LINES = [
  "█▀▄▀█ █▀▀ █░█ ▀▄▀ █▀▀ █▄▄ █▀▀ █▀█",
  "█░▀░█ ██▄ ▀▄▀ ░█░ ██▄ █▄█ █▄▄ █▀▄",
] as const;

const BANNER_PALETTE = [
  "#f38ba8",
  "#fab387",
  "#f9e2af",
  "#a6e3a1",
  "#74c7ec",
] as const;

/** RGB gradient colour across the entire art line */
function gradientLine(text: string, palette: readonly string[]): string {
  const chars = [...text];
  const n = chars.length;
  if (n === 0) return text;
  let out = "";
  for (let i = 0; i < n; i++) {
    const pi = Math.floor((i / n) * palette.length) % palette.length;
    out += chalk.hex(palette[pi])(chars[i]);
  }
  return out;
}

/** Show the modern project-health banner on CLI launch */
export function showBanner(): void {
  const pad = "  ";
  process.stdout.write("\n");
  for (const line of BANNER_LINES) {
    process.stdout.write(pad + gradientLine(line, BANNER_PALETTE) + "\n");
  }
  process.stdout.write(
    pad +
      chalk.hex(THEME.accent).bold("project-health") +
      "  " +
      chalk.dim("v2.0.0") +
      "\n",
  );
  process.stdout.write(
    pad +
      chalk.hex(THEME.dimMeta)(
        "AI-powered health score for software repositories",
      ) +
      "\n",
  );
  process.stdout.write("\n");
}

export async function renderInit(steps: InitStep[]): Promise<void> {
  // Large ASCII art header
  process.stdout.write("\n");
  for (const line of PH_ASCII_ART) {
    process.stdout.write(gradientLine(line, PH_ASCII_PALETTE) + "\n");
  }
  process.stdout.write(
    `  ${chalk.hex(THEME.accent).bold("project-health")}  ${chalk.dim("v2.0.0")}  ${chalk.dim("·")}  ${chalk.hex(THEME.dimMeta)("AI-powered codebase intelligence")}\n`,
  );
  process.stdout.write("\n");

  // Clack intro
  intro(chalk.hex(THEME.accent)("Setting up project-health"));

  const s = spinner();
  let allPassed = true;
  const results: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const current = i + 1;
    const total = steps.length;

    s.start(
      `${chalk.hex(THEME.sectionLabel)(`[${current}/${total}]`)} ${chalk.hex(THEME.text)(step.label)}`,
    );

    try {
      const msg = await step.run();
      s.stop(chalk.hex(THEME.success)(`✓ ${step.label}`));
      log.message(chalk.dim(`${chalk.hex(THEME.dimMeta)("→")} ${msg}`));
      results.push(`✓ ${step.label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      s.stop(chalk.hex(THEME.critical)(`✗ ${step.label}`));
      log.warn(chalk.hex(THEME.warning)(msg));
      results.push(`✗ ${step.label}`);
      allPassed = false;
    }
  }

  // Outro
  if (allPassed) {
    outro(chalk.hex(THEME.success)("Initialization complete"));
    process.stdout.write("\n");
    process.stdout.write(
      `  ${chalk.hex(THEME.text)("Next:")} ${chalk.hex(THEME.info)("ph scan")} ${chalk.dim("— analyse your codebase")}\n`,
    );
    process.stdout.write(
      `  ${chalk.hex(THEME.text)("      ")}${chalk.hex(THEME.info)("ph ask")} ${chalk.dim('"explain this repo"')}\n`,
    );
    process.stdout.write(
      `  ${chalk.hex(THEME.text)("      ")}${chalk.hex(THEME.info)("ph chat")} ${chalk.dim("— start a conversation")}\n`,
    );
    process.stdout.write("\n");
  } else {
    outro(chalk.hex(THEME.warning)("Initialized with warnings"));
    process.stdout.write("\n");
    process.stdout.write(
      `  ${chalk.hex(THEME.text)("Review warnings above, then run")} ${chalk.hex(THEME.info)("ph scan")}\n`,
    );
    process.stdout.write("\n");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TREND RENDERER
// ─────────────────────────────────────────────────────────────────────────────

export function renderTrend(history: ScanHistory[]): void {
  if (history.length === 0) {
    process.stdout.write(
      `\n  ${chalk.dim("No scan history. Run ph scan first.")}\n`,
    );
    return;
  }

  const scores = history.slice(-14);
  const values = scores.map((h) => h.score);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);

  // Date range
  const startDate = new Date(scores[0].generatedAt).toLocaleDateString();
  const endDate = new Date(
    scores[scores.length - 1].generatedAt,
  ).toLocaleDateString();

  process.stdout.write("\n");
  sectionDivider("trend");
  process.stdout.write("\n");

  // Full-width sparkline
  process.stdout.write("  " + sparkline(values) + "\n");
  process.stdout.write("\n");

  // Stats row
  process.stdout.write(
    `  ${chalk.hex(THEME.success)("max")} ${chalk.hex(THEME.success).bold(max.toString())}  ` +
      `${chalk.hex(THEME.warning)("avg")} ${chalk.hex(THEME.warning).bold(avg.toString())}  ` +
      `${chalk.hex(THEME.critical)("min")} ${chalk.hex(THEME.critical).bold(min.toString())}  ` +
      `${chalk.dim(startDate + " → " + endDate)}\n`,
  );

  process.stdout.write("\n");

  // Biggest drop
  let biggestDrop = 0;
  let biggestDropIdx = -1;
  let biggestGain = 0;
  let biggestGainIdx = -1;

  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff < biggestDrop) {
      biggestDrop = diff;
      biggestDropIdx = i;
    }
    if (diff > biggestGain) {
      biggestGain = diff;
      biggestGainIdx = i;
    }
  }

  if (biggestDropIdx >= 0) {
    const entry = scores[biggestDropIdx];
    const hash = entry.commitHash
      ? chalk.dim(" " + entry.commitHash.slice(0, 7))
      : "";
    process.stdout.write(
      `  ${chalk.hex(THEME.critical)("▼")} biggest drop  ` +
        `${chalk.hex(THEME.critical).bold(biggestDrop.toString() + "pts")}  ` +
        chalk.dim(new Date(entry.generatedAt).toLocaleDateString()) +
        hash +
        "\n",
    );
  }

  if (biggestGainIdx >= 0) {
    const entry = scores[biggestGainIdx];
    const hash = entry.commitHash
      ? chalk.dim(" " + entry.commitHash.slice(0, 7))
      : "";
    process.stdout.write(
      `  ${chalk.hex(THEME.success)("▲")} biggest gain  ` +
        `${chalk.hex(THEME.success).bold("+" + biggestGain.toString() + "pts")}  ` +
        chalk.dim(new Date(entry.generatedAt).toLocaleDateString()) +
        hash +
        "\n",
    );
  }

  process.stdout.write("\n");
  keyboardHints([
    { key: "r", label: "refresh" },
    { key: "q", label: "quit" },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HANDLER — never raw stack traces
// ─────────────────────────────────────────────────────────────────────────────

export type ErrorCode =
  | "PROXY_NOT_CONFIGURED"
  | "RATE_LIMIT"
  | "MODULE_FAILED"
  | "CONTEXT_TOO_LARGE"
  | "NOT_INITIALISED"
  | "UNKNOWN";

const ERROR_MESSAGES: Record<
  ErrorCode,
  { title: string; hint: string; suggestion?: string }
> = {
  PROXY_NOT_CONFIGURED: {
    title: "Proxy not configured",
    hint: "Set proxy.url in your project-health.config.ts",
    suggestion: "ph init",
  },
  RATE_LIMIT: {
    title: "Rate limit reached",
    hint: "Too many requests — waiting for the window to reset",
  },
  MODULE_FAILED: {
    title: "Module analysis failed",
    hint: "This module was skipped — other modules completed normally",
  },
  CONTEXT_TOO_LARGE: {
    title: "Context window exceeded",
    hint: "Response was truncated gracefully — consider scoping your question",
  },
  NOT_INITIALISED: {
    title: "Project not initialised",
    hint: "Run ph init to set up project-health in this directory",
    suggestion: "ph init",
  },
  UNKNOWN: {
    title: "An unexpected error occurred",
    hint: "If this persists, check your configuration",
  },
};

export function error(code: ErrorCode, context?: Record<string, string>): void {
  const { title, hint, suggestion } =
    ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN;

  let resolvedHint = hint;
  let resolvedTitle = title;

  if (context) {
    // Interpolate context values
    for (const [k, v] of Object.entries(context)) {
      resolvedTitle = resolvedTitle.replace(`{${k}}`, v);
      resolvedHint = resolvedHint.replace(`{${k}}`, v);
    }
  }

  // Special handling for rate limit: show retry seconds
  if (code === "RATE_LIMIT" && context?.retryAfter) {
    resolvedHint = `Retry in ${context.retryAfter}s`;
  }

  process.stdout.write("\n");
  process.stdout.write(
    `  ${chalk.hex(THEME.critical)("✗")}  ${chalk.bold(resolvedTitle)}\n`,
  );
  process.stdout.write(`     ${chalk.dim(resolvedHint)}\n`);

  if (suggestion) {
    process.stdout.write("\n");
    process.stdout.write(
      `  ${chalk.hex(THEME.info)("→")}  ${chalk.dim(suggestion)}\n`,
    );
  }

  process.stdout.write("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARDS-COMPATIBLE LEGACY EXPORTS (used by cli/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated use renderScan() */
export function printHealthReport(report: HealthReport): void {
  renderScan(report);
}

/** @deprecated use renderFinding() */
export function printFinding(finding: Finding): void {
  renderFinding(finding);
}

/** @deprecated use renderFinding() */
export function formatFinding(finding: Finding): string {
  const colour = severityColour(finding.severity);
  const loc = finding.file
    ? ` ${chalk.hex(THEME.info)(finding.file)}${finding.line ? ":" + finding.line : ""}`
    : "";
  return (
    `${chalk.hex(colour)(finding.severity)}  ` +
    `${chalk.bold(finding.type.padEnd(20))}  ` +
    `${loc}  ${finding.message}`
  );
}

export function formatSeverity(severity: Severity): string {
  return chalk.hex(severityColour(severity))(severity);
}

export function formatScoreBand(band: ScoreBand): string {
  const s =
    { EXCELLENT: 100, GOOD: 80, MODERATE: 65, HIGH_RISK: 50, CRITICAL: 20 }[
      band
    ] ?? 50;
  return chalk.hex(scoreColour(s)).bold(band);
}

export function formatHealthScore(score: number, _band: ScoreBand): string {
  return chalk.hex(scoreColour(score)).bold(`${score}/100`);
}

export function printSection(title: string): void {
  sectionDivider(title.toLowerCase());
}

export function printSubSection(title: string): void {
  process.stdout.write(`\n  ${chalk.hex(THEME.sectionLabel)(title)}\n\n`);
}

export function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    process.stdout.write(chalk.dim("  No findings\n"));
    return;
  }
  for (const f of findings) renderFinding(f);
}

export function printModuleResult(result: ModuleResult): void {
  const colour = scoreColour(result.score);
  const status =
    result.status === "ok"
      ? chalk.hex(THEME.success)("✓")
      : result.status === "warning"
        ? chalk.hex(THEME.warning)("●")
        : chalk.hex(THEME.critical)("✗");

  process.stdout.write("\n");
  process.stdout.write(
    `  ${status}  ${chalk.bold(result.moduleName)}  ${chalk.dim(result.moduleId)}\n`,
  );
  process.stdout.write(
    `     ${chalk.dim("score")}  ${chalk.hex(colour).bold(result.score.toString())}` +
      `  ${chalk.dim(result.durationMs + "ms")}\n`,
  );

  if (result.findings.length > 0) {
    process.stdout.write("\n");
    for (const f of result.findings.slice(0, 3)) renderFinding(f);
    if (result.findings.length > 3) {
      process.stdout.write(
        `     ${chalk.dim(`... and ${result.findings.length - 3} more`)}\n`,
      );
    }
  }
}

export function printError(message: string, isRateLimit = false): void {
  if (isRateLimit) {
    error("RATE_LIMIT", {});
  } else {
    process.stdout.write(
      `\n  ${chalk.hex(THEME.critical)("✗")}  ${chalk.bold(message)}\n\n`,
    );
  }
}

export function printSuccess(message: string): void {
  process.stdout.write(
    `  ${chalk.hex(THEME.success)("✓")}  ${chalk.hex(THEME.text)(message)}\n`,
  );
}

export function printWarning(message: string): void {
  process.stdout.write(
    `  ${chalk.hex(THEME.warning)("●")}  ${chalk.hex(THEME.warning)(message)}\n`,
  );
}

export function printInfo(message: string): void {
  process.stdout.write(`  ${chalk.dim("·")}  ${chalk.dim(message)}\n`);
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function printHtml(html: string): void {
  process.stdout.write(html + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// ENHANCED SPINNER SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export type SpinnerStyle =
  | "braille"
  | "dots"
  | "pulse"
  | "arrows"
  | "bounce"
  | "clock"
  | "earth"
  | "moon"
  | "hearts"
  | "module";

interface SpinnerConfig {
  frames: string[];
  interval: number;
}

const SPINNER_STYLES: Record<SpinnerStyle, SpinnerConfig> = {
  braille: {
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    interval: 80,
  },
  dots: {
    frames: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
    interval: 80,
  },
  pulse: {
    frames: ["◐", "◓", "◑", "◒"],
    interval: 120,
  },
  arrows: {
    frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
    interval: 100,
  },
  bounce: {
    frames: ["⠁", "⠂", "⠄", "⠂"],
    interval: 120,
  },
  clock: {
    frames: [
      "🕛",
      "🕐",
      "🕑",
      "🕒",
      "🕓",
      "🕔",
      "🕕",
      "🕖",
      "🕗",
      "🕘",
      "🕙",
      "🕚",
    ],
    interval: 100,
  },
  earth: {
    frames: ["🌍", "🌎", "🌏"],
    interval: 200,
  },
  moon: {
    frames: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
    interval: 150,
  },
  hearts: {
    frames: ["💛", "💚", "💙", "💜", "❤️", "💜", "💙", "💚"],
    interval: 200,
  },
  module: {
    frames: ["⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿", "⣷", "⣶", "⣦", "⣤", "⣄"],
    interval: 80,
  },
};

/** Mapping of operation types to spinner styles for visual variety */
const OPERATION_SPINNERS: Record<string, SpinnerStyle> = {
  init: "braille",
  scan: "dots",
  analyze: "pulse",
  build: "arrows",
  fetch: "bounce",
  generate: "moon",
  process: "module",
  ci: "clock",
  review: "earth",
  context: "pulse",
  brief: "moon",
  diff: "arrows",
  score: "braille",
  fix: "hearts",
};

// Simple spinner interface (kept for backwards compatibility with watch mode)
export interface SimpleSpinner {
  start(text?: string): this;
  succeed(text?: string): this;
  fail(text?: string): this;
  warn(text?: string): this;
  stop(): void;
}

export function createSpinner(
  text: string,
  style: SpinnerStyle = "braille",
): SimpleSpinner {
  const config = SPINNER_STYLES[style] || SPINNER_STYLES.braille;
  const frames = config.frames;
  let frame = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentText = text;

  function startInterval() {
    interval = setInterval(() => {
      process.stdout.write(
        `\r  ${chalk.hex(THEME.info)(frames[frame % frames.length])}  ${chalk.dim(currentText)}`,
      );
      frame++;
    }, config.interval);
  }

  function clear(icon: string, color: string, msg?: string) {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    const label = msg ?? currentText;
    process.stdout.write(
      `\r  ${chalk.hex(color)(icon)}  ${chalk.hex(THEME.text)(label)}\n`,
    );
  }

  const spinner: SimpleSpinner = {
    start(msg?) {
      if (msg) currentText = msg;
      startInterval();
      return this;
    },
    succeed(msg?) {
      clear("✓", THEME.success, msg);
      return this;
    },
    fail(msg?) {
      clear("✗", THEME.critical, msg);
      return this;
    },
    warn(msg?) {
      clear("●", THEME.warning, msg);
      return this;
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write("\n");
    },
  };

  return spinner;
}

/**
 * Create a spinner with automatic style selection based on operation type.
 * Each operation type gets a unique animation style for visual variety.
 */
export function createOperationSpinner(
  operation: string,
  text: string,
): SimpleSpinner {
  const style = OPERATION_SPINNERS[operation] || "braille";
  return createSpinner(text, style);
}

// ─────────────────────────────────────────────────────────────────────────────
// PARALLEL PROGRESS TRACKER — for scan / ci-check module progress
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleProgress {
  moduleId: string;
  moduleName: string;
  status: "pending" | "running" | "done" | "error";
  score?: number;
  durationMs?: number;
}

/**
 * Animated parallel progress display for running multiple modules concurrently.
 * Shows a live-updating board of module statuses with spinners for in-progress items.
 */
export class ParallelProgress {
  private modules: ModuleProgress[];
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private startTime = 0;

  private static SPIN_FRAMES = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
  ];
  private static TICK = 80;

  constructor(moduleList: Array<{ moduleId: string; moduleName: string }>) {
    this.modules = moduleList.map((m) => ({
      moduleId: m.moduleId,
      moduleName: m.moduleName,
      status: "pending",
    }));
  }

  /** Begin rendering the live progress board */
  start(): void {
    this.startTime = Date.now();
    this.render();
    this.interval = setInterval(() => {
      this.frame++;
      this.render();
    }, ParallelProgress.TICK);
  }

  /** Mark a module as running */
  setRunning(moduleId: string): void {
    const mod = this.modules.find((m) => m.moduleId === moduleId);
    if (mod) mod.status = "running";
  }

  /** Mark a module as completed */
  setDone(moduleId: string, score: number, durationMs: number): void {
    const mod = this.modules.find((m) => m.moduleId === moduleId);
    if (mod) {
      mod.status = "done";
      mod.score = score;
      mod.durationMs = durationMs;
    }
  }

  /** Mark a module as errored */
  setError(moduleId: string): void {
    const mod = this.modules.find((m) => m.moduleId === moduleId);
    if (mod) mod.status = "error";
  }

  /** Stop rendering and show final summary */
  finish(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.renderFinal();
  }

  private render(): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const done = this.modules.filter(
      (m) => m.status === "done" || m.status === "error",
    ).length;
    const total = this.modules.length;

    // Move cursor up to overwrite previous render
    const lineCount = this.modules.length + 3;
    process.stdout.write(`\x1b[${lineCount}A`);

    // Header
    process.stdout.write(
      `  ${chalk.hex(THEME.info)(ParallelProgress.SPIN_FRAMES[this.frame % ParallelProgress.SPIN_FRAMES.length])}` +
        `  ${chalk.dim(`Analyzing... ${done}/${total} modules · ${elapsed}s`)}\n`,
    );
    process.stdout.write("\n");

    // Module rows
    for (const mod of this.modules) {
      const idStr = chalk.dim(mod.moduleId.padEnd(5));
      const nameStr = chalk.hex(THEME.text)(mod.moduleName.padEnd(22));

      if (mod.status === "pending") {
        process.stdout.write(
          `  ${chalk.hex(THEME.dimMeta)("○")}  ${idStr} ${nameStr} ${chalk.dim("waiting...")}\n`,
        );
      } else if (mod.status === "running") {
        const spinChar =
          ParallelProgress.SPIN_FRAMES[
            this.frame % ParallelProgress.SPIN_FRAMES.length
          ];
        process.stdout.write(
          `  ${chalk.hex(THEME.info)(spinChar)}  ${idStr} ${nameStr} ${chalk.hex(THEME.info)("running...")}\n`,
        );
      } else if (mod.status === "done") {
        const scoreCol = scoreColour(mod.score ?? 0);
        const timeStr = mod.durationMs ? `${mod.durationMs}ms` : "";
        process.stdout.write(
          `  ${chalk.hex(THEME.success)("✓")}  ${idStr} ${nameStr}` +
            ` ${chalk.hex(scoreCol).bold(String(mod.score ?? ""))}` +
            ` ${chalk.dim(timeStr)}\n`,
        );
      } else if (mod.status === "error") {
        process.stdout.write(
          `  ${chalk.hex(THEME.critical)("✗")}  ${idStr} ${nameStr} ${chalk.hex(THEME.critical)("failed")}\n`,
        );
      }
    }

    // Footer
    process.stdout.write("\n");
  }

  private renderFinal(): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const done = this.modules.filter((m) => m.status === "done").length;
    const failed = this.modules.filter((m) => m.status === "error").length;

    // Overwrite last render
    const lineCount = this.modules.length + 3;
    process.stdout.write(`\x1b[${lineCount}A`);

    // Final header
    process.stdout.write(
      `  ${chalk.hex(THEME.success)("✓")}` +
        `  ${chalk.dim(`Analysis complete · ${done} succeeded, ${failed} failed · ${elapsed}s`)}\n`,
    );
    process.stdout.write("\n");

    // Final module rows
    for (const mod of this.modules) {
      const idStr = chalk.dim(mod.moduleId.padEnd(5));
      const nameStr = chalk.hex(THEME.text)(mod.moduleName.padEnd(22));

      if (mod.status === "done") {
        const scoreCol = scoreColour(mod.score ?? 0);
        const timeStr = mod.durationMs ? `${mod.durationMs}ms` : "";
        process.stdout.write(
          `  ${chalk.hex(THEME.success)("✓")}  ${idStr} ${nameStr}` +
            ` ${chalk.hex(scoreCol).bold(String(mod.score ?? ""))}` +
            ` ${chalk.dim(timeStr)}\n`,
        );
      } else if (mod.status === "error") {
        process.stdout.write(
          `  ${chalk.hex(THEME.critical)("✗")}  ${idStr} ${nameStr} ${chalk.hex(THEME.critical)("failed")}\n`,
        );
      } else {
        process.stdout.write(
          `  ${chalk.dim("○")}  ${idStr} ${nameStr} ${chalk.dim("skipped")}\n`,
        );
      }
    }

    process.stdout.write("\n");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW RENDERER — structured card-based output for ph review
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewFinding {
  category:
    | "bug"
    | "security"
    | "coverage"
    | "readability"
    | "complexity"
    | "performance"
    | "architecture";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface ReviewSummary {
  totalFindings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  verdict: "approve" | "request-changes" | "comment";
  filesReviewed: number;
  linesChanged: { added: number; removed: number };
}

const CATEGORY_ICONS: Record<string, string> = {
  bug: "🐛",
  security: "🔒",
  coverage: "🧪",
  readability: "📖",
  complexity: "🧩",
  performance: "⚡",
  architecture: "🏗️",
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Bug",
  security: "Security",
  coverage: "Coverage",
  readability: "Readability",
  complexity: "Complexity",
  performance: "Performance",
  architecture: "Architecture",
};

const SEVERITY_BADGE: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  critical: { label: " CRITICAL ", color: "#0b0d12", bg: THEME.critical },
  high: { label: " HIGH ", color: "#0b0d12", bg: THEME.warning },
  medium: { label: " MEDIUM ", color: "#0b0d12", bg: "#fab387" },
  low: { label: " LOW ", color: "#0b0d12", bg: THEME.success },
  info: { label: " INFO ", color: "#cdd6f4", bg: THEME.sectionLabel },
};

const VERDICT_STYLES: Record<
  string,
  { icon: string; label: string; color: string }
> = {
  approve: { icon: "✓", label: "APPROVE", color: THEME.success },
  "request-changes": {
    icon: "✗",
    label: "REQUEST CHANGES",
    color: THEME.critical,
  },
  comment: { icon: "●", label: "COMMENT", color: THEME.warning },
};

function boxLine(content: string, width: number): string {
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, width - stripped.length - 2);
  return `${chalk.hex(THEME.border)("│")} ${content}${" ".repeat(pad)}${chalk.hex(THEME.border)("│")}`;
}

function boxTop(width: number): string {
  return chalk.hex(THEME.border)("┌" + "─".repeat(width - 2) + "┐");
}

function boxBottom(width: number): string {
  return chalk.hex(THEME.border)("└" + "─".repeat(width - 2) + "┘");
}

function boxDivider(width: number): string {
  return chalk.hex(THEME.border)("├" + "─".repeat(width - 2) + "┤");
}

export function renderReviewHeader(
  summary: ReviewSummary,
  context?: { branch?: string; prNumber?: number; commitSha?: string },
): void {
  const w = Math.min(cols(), 80);
  const verdict = VERDICT_STYLES[summary.verdict];
  const verdictLine = `${chalk.hex(verdict.color).bold(verdict.icon + " " + verdict.label)}`;

  process.stdout.write("\n");

  // Top border
  process.stdout.write("  " + boxTop(w) + "\n");

  // Title row
  const title = chalk.hex(THEME.info).bold("CODE REVIEW");
  process.stdout.write("  " + boxLine(`  ${title}`, w) + "\n");

  // Context row
  if (context) {
    const parts: string[] = [];
    if (context.prNumber) parts.push(chalk.dim(`PR #${context.prNumber}`));
    if (context.branch) parts.push(chalk.hex(THEME.accent)(context.branch));
    if (context.commitSha) parts.push(chalk.dim(context.commitSha.slice(0, 7)));
    if (parts.length > 0) {
      process.stdout.write(
        "  " + boxLine(`  ${parts.join(chalk.dim(" · "))}`, w) + "\n",
      );
    }
  }

  process.stdout.write("  " + boxDivider(w) + "\n");

  // Stats row
  const statsLine =
    `  ${chalk.dim("files")} ${chalk.hex(THEME.text).bold(String(summary.filesReviewed))}` +
    `   ${chalk.dim("+")}${chalk.hex(THEME.success).bold(String(summary.linesChanged.added))}` +
    ` ${chalk.dim("/")}` +
    ` ${chalk.dim("-")}${chalk.hex(THEME.critical).bold(String(summary.linesChanged.removed))}` +
    `   ${chalk.dim("findings")} ${chalk.hex(THEME.text).bold(String(summary.totalFindings))}`;
  process.stdout.write("  " + boxLine(statsLine, w) + "\n");

  // Severity breakdown
  const sevParts: string[] = [];
  if (summary.critical > 0)
    sevParts.push(
      chalk.hex(THEME.critical).bold(`${summary.critical} critical`),
    );
  if (summary.high > 0)
    sevParts.push(chalk.hex(THEME.warning).bold(`${summary.high} high`));
  if (summary.medium > 0)
    sevParts.push(chalk.hex("#fab387")(`${summary.medium} medium`));
  if (summary.low > 0)
    sevParts.push(chalk.hex(THEME.success)(`${summary.low} low`));
  if (summary.info > 0) sevParts.push(chalk.dim(`${summary.info} info`));
  if (sevParts.length > 0) {
    process.stdout.write(
      "  " + boxLine(`  ${sevParts.join(chalk.dim(" · "))}`, w) + "\n",
    );
  }

  process.stdout.write("  " + boxDivider(w) + "\n");

  // Verdict
  process.stdout.write("  " + boxLine(`  Verdict: ${verdictLine}`, w) + "\n");

  // Bottom border
  process.stdout.write("  " + boxBottom(w) + "\n");
  process.stdout.write("\n");
}

export function renderReviewFinding(
  finding: ReviewFinding,
  index: number,
): void {
  const sevBadge = SEVERITY_BADGE[finding.severity] || SEVERITY_BADGE.info;
  const catIcon = CATEGORY_ICONS[finding.category] || "•";
  const catLabel = CATEGORY_LABELS[finding.category] || finding.category;
  const w = Math.min(cols(), 80);

  // Card top
  process.stdout.write(
    "  " + chalk.hex(THEME.border)("┌" + "─".repeat(w - 2) + "┐") + "\n",
  );

  // Header row: [#n] [SEVERITY] Category · Title
  const badge = chalk
    .bgHex(sevBadge.bg)
    .hex(sevBadge.color)
    .bold(sevBadge.label);
  const numStr = chalk.dim(`#${index + 1}`);
  const header = `  ${numStr} ${badge} ${chalk.hex(THEME.text).bold(catLabel)} ${chalk.dim("·")} ${chalk.hex(THEME.text)(finding.title)}`;
  process.stdout.write("  " + boxLine(header, w) + "\n");

  // Divider
  process.stdout.write("  " + boxDivider(w) + "\n");

  // Description (wrapped)
  const descPrefix = "    ";
  const descLines = wrapText(finding.description, descPrefix).split("\n");
  for (const line of descLines) {
    process.stdout.write("  " + boxLine(line, w) + "\n");
  }

  // File:Line citation
  if (finding.file) {
    const locStr = `    ${chalk.hex(THEME.info)("📄")} ${chalk.hex(THEME.info)(finding.file)}${finding.line ? chalk.dim(":" + finding.line) : ""}`;
    process.stdout.write("  " + boxLine(locStr, w) + "\n");
  }

  // Suggestion
  if (finding.suggestion) {
    process.stdout.write("  " + boxDivider(w) + "\n");
    const sugPrefix = "    ";
    const sugLines = wrapText(`💡 ${finding.suggestion}`, sugPrefix).split(
      "\n",
    );
    for (const line of sugLines) {
      process.stdout.write(
        "  " + boxLine(chalk.hex(THEME.success)(line), w) + "\n",
      );
    }
  }

  // Card bottom
  process.stdout.write("  " + boxBottom(w) + "\n");
  process.stdout.write("\n");
}

export function renderReviewFindings(findings: ReviewFinding[]): void {
  if (findings.length === 0) {
    process.stdout.write(
      `  ${chalk.hex(THEME.success)("✓")}  No findings — clean diff\n\n`,
    );
    return;
  }

  // Group by category
  const grouped = new Map<string, ReviewFinding[]>();
  for (const f of findings) {
    const arr = grouped.get(f.category) || [];
    arr.push(f);
    grouped.set(f.category, arr);
  }

  let idx = 0;
  for (const [category, catFindings] of grouped) {
    const catIcon = CATEGORY_ICONS[category] || "•";
    const catLabel = CATEGORY_LABELS[category] || category;

    sectionDivider(`${catIcon} ${catLabel} (${catFindings.length})`);
    process.stdout.write("\n");

    for (const finding of catFindings) {
      renderReviewFinding(finding, idx);
      idx++;
    }
  }
}

/**
 * Render a raw AI review text as a structured block.
 * Parses the streamed text for section headers and formats them cleanly.
 */
export function renderReviewText(rawText: string): void {
  const lines = rawText.split("\n");
  const w = Math.min(cols(), 80);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect markdown-style headers (## Category)
    if (line.startsWith("## ") || line.startsWith("### ")) {
      const label = line.replace(/^#{2,3}\s*/, "").trim();
      process.stdout.write("\n");
      sectionDivider(label.toLowerCase());
      process.stdout.write("\n");
      continue;
    }

    // Detect bullet points
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const content = line.slice(2);
      process.stdout.write(
        `  ${chalk.hex(THEME.info)("›")}  ${chalk.hex(THEME.text)(content)}\n`,
      );
      continue;
    }

    // Detect numbered items
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      const num = chalk.hex(THEME.accent).bold(`${numMatch[1]}.`);
      process.stdout.write(`  ${num} ${chalk.hex(THEME.text)(numMatch[2])}\n`);
      continue;
    }

    // Detect inline file:line references and highlight them
    if (line.match(/\b[\w./\\-]+\.\w+:\d+/)) {
      const highlighted = line.replace(
        /([\w./\\-]+\.\w+):(\d+)/g,
        (_, file, ln) =>
          `${chalk.hex(THEME.info)(file)}${chalk.dim(":")}${chalk.hex(THEME.accent)(ln)}`,
      );
      process.stdout.write(`    ${highlighted}\n`);
      continue;
    }

    // Regular text
    if (line.length > 0) {
      process.stdout.write(`    ${chalk.hex(THEME.text)(line)}\n`);
    } else {
      process.stdout.write("\n");
    }
  }
}

export function renderReviewFooter(): void {
  process.stdout.write("\n");
  keyboardHints([
    { key: "p", label: "post to PR" },
    { key: "a", label: "ask about diff" },
    { key: "q", label: "quit" },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// CI CHECK RENDERER — structured modern output
// ─────────────────────────────────────────────────────────────────────────────

export function renderCiCheck(report: HealthReport, failUnder: number): void {
  const w = Math.min(cols(), 72);
  const passed = report.score >= failUnder;
  const statusColor = passed ? THEME.success : THEME.critical;
  const statusLabel = passed ? " PASSED " : " FAILED ";
  const statusIcon = passed ? "✓" : "✗";

  process.stdout.write("\n");

  // Header box
  process.stdout.write("  " + boxTop(w) + "\n");

  const title = chalk.hex(THEME.info).bold("CI HEALTH CHECK");
  process.stdout.write("  " + boxLine(`  ${title}`, w) + "\n");

  process.stdout.write("  " + boxDivider(w) + "\n");

  // Score + status
  const scoreStr = chalk.hex(scoreColour(report.score)).bold(`${report.score}`);
  const thresholdStr = chalk.dim(`/ ${failUnder} threshold`);
  const badge = chalk.bgHex(statusColor).hex("#0b0d12").bold(statusLabel);
  const scoreLine = `  ${statusIcon}  Score: ${scoreStr} ${thresholdStr}  ${badge}`;
  process.stdout.write("  " + boxLine(scoreLine, w) + "\n");

  process.stdout.write("  " + boxDivider(w) + "\n");

  // Module breakdown
  for (const mod of report.modules) {
    const col = scoreColour(mod.score);
    const statusChar =
      mod.status === "ok"
        ? chalk.hex(THEME.success)("●")
        : mod.status === "warning"
          ? chalk.hex(THEME.warning)("●")
          : chalk.hex(THEME.critical)("●");

    const modLine =
      `  ${statusChar} ${chalk.dim(mod.moduleId)} ${chalk.hex(THEME.text)(mod.moduleName.padEnd(22))}` +
      ` ${chalk.hex(col).bold(String(mod.score).padStart(3))}${chalk.dim("/100")}` +
      ` ${chalk.dim(`${mod.durationMs}ms`)}`;
    process.stdout.write("  " + boxLine(modLine, w) + "\n");
  }

  process.stdout.write("  " + boxDivider(w) + "\n");

  // Critical findings summary
  const criticals = report.findings.filter((f) => f.severity === "CRITICAL");
  if (criticals.length > 0) {
    const critLine = `  ${chalk.hex(THEME.critical).bold("⚠")}  ${chalk.hex(THEME.critical).bold(`${criticals.length} critical finding${criticals.length > 1 ? "s" : ""}`)}`;
    process.stdout.write("  " + boxLine(critLine, w) + "\n");

    for (const f of criticals.slice(0, 3)) {
      const loc = f.file
        ? ` ${chalk.hex(THEME.info)(f.file)}${f.line ? chalk.dim(":" + f.line) : ""}`
        : "";
      const fLine = `      ${chalk.hex(THEME.critical)(f.type)}${loc}`;
      process.stdout.write("  " + boxLine(fLine, w) + "\n");
      const msgLines = wrapText(f.message, "        ").split("\n");
      for (const ml of msgLines) {
        process.stdout.write("  " + boxLine(ml, w) + "\n");
      }
    }
    if (criticals.length > 3) {
      process.stdout.write(
        "  " +
          boxLine(
            `      ${chalk.dim(`... and ${criticals.length - 3} more`)}`,
            w,
          ) +
          "\n",
      );
    }
  } else {
    process.stdout.write(
      "  " +
        boxLine(`  ${chalk.hex(THEME.success)("✓")}  No critical findings`, w) +
        "\n",
    );
  }

  // Bottom
  process.stdout.write("  " + boxBottom(w) + "\n");
  process.stdout.write("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// BRIEF/GENERATION RENDERER — structured output for ph brief / AI generation
// ─────────────────────────────────────────────────────────────────────────────

export interface BriefSection {
  title: string;
  content: string;
  icon?: string;
}

const SECTION_ICONS: Record<string, string> = {
  "project overview": "🎯",
  overview: "🎯",
  "tech stack": "🛠️",
  architecture: "🏗️",
  "key files": "📁",
  "entry points": "🚪",
  development: "⚙️",
  workflow: "⚙️",
  testing: "🧪",
  "common issues": "🔧",
  tips: "💡",
  "getting started": "🚀",
  contributing: "🤝",
  deployment: "🚢",
  api: "📡",
  database: "🗄️",
};

function findSectionIcon(title: string): string {
  const lower = title.toLowerCase();
  for (const [key, icon] of Object.entries(SECTION_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "📄";
}

export function renderBriefHeader(outputPath: string): void {
  const w = Math.min(cols(), 72);

  process.stdout.write("\n");
  process.stdout.write("  " + boxTop(w) + "\n");

  const title = chalk.hex(THEME.ai).bold("GENERATING DOCUMENTATION");
  process.stdout.write("  " + boxLine(`  ${title}`, w) + "\n");

  process.stdout.write("  " + boxDivider(w) + "\n");

  const outputLine = `  ${chalk.dim("output")} ${chalk.hex(THEME.info)(outputPath)}`;
  process.stdout.write("  " + boxLine(outputLine, w) + "\n");

  process.stdout.write("  " + boxBottom(w) + "\n");
  process.stdout.write("\n");
}

export function renderBriefSections(sections: BriefSection[]): void {
  for (const section of sections) {
    const icon = section.icon || findSectionIcon(section.title);
    sectionDivider(`${icon} ${section.title}`);
    process.stdout.write("\n");

    const contentLines = section.content.split("\n");
    for (const line of contentLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        // Sub-header
        const subLabel = trimmed.replace(/^#+\s*/, "");
        process.stdout.write(`  ${chalk.hex(THEME.accent).bold(subLabel)}\n`);
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        process.stdout.write(
          `  ${chalk.hex(THEME.info)("›")}  ${chalk.hex(THEME.text)(trimmed.slice(2))}\n`,
        );
      } else if (trimmed.length > 0) {
        const wrapped = wrapText(trimmed, "    ");
        process.stdout.write(wrapped + "\n");
      } else {
        process.stdout.write("\n");
      }
    }
    process.stdout.write("\n");
  }
}

export function renderBriefComplete(
  outputPath: string,
  wordCount?: number,
): void {
  process.stdout.write(
    `  ${chalk.hex(THEME.success)("✓")}  ${chalk.hex(THEME.text)("Documentation generated")}\n`,
  );
  process.stdout.write(
    `     ${chalk.dim("file")} ${chalk.hex(THEME.info)(outputPath)}`,
  );
  if (wordCount) {
    process.stdout.write(chalk.dim(` · ${wordCount} words`));
  }
  process.stdout.write("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH ANALYSIS RENDERER — for structured analysis/research output
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalysisMetric {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "stable";
  color?: string;
}

export interface AnalysisSection {
  title: string;
  icon?: string;
  metrics?: AnalysisMetric[];
  findings?: Array<{ severity: string; message: string; detail?: string }>;
  content?: string;
}

export function renderAnalysisHeader(
  title: string,
  subtitle?: string,
  context?: Record<string, string>,
): void {
  const w = Math.min(cols(), 80);

  process.stdout.write("\n");
  process.stdout.write("  " + boxTop(w) + "\n");

  const titleStr = chalk.hex(THEME.info).bold(title.toUpperCase());
  process.stdout.write("  " + boxLine(`  ${titleStr}`, w) + "\n");

  if (subtitle) {
    process.stdout.write("  " + boxLine(`  ${chalk.dim(subtitle)}`, w) + "\n");
  }

  if (context && Object.keys(context).length > 0) {
    process.stdout.write("  " + boxDivider(w) + "\n");
    for (const [key, val] of Object.entries(context)) {
      const line = `  ${chalk.dim(key + ":")} ${chalk.hex(THEME.text)(val)}`;
      process.stdout.write("  " + boxLine(line, w) + "\n");
    }
  }

  process.stdout.write("  " + boxBottom(w) + "\n");
  process.stdout.write("\n");
}

export function renderAnalysisMetrics(metrics: AnalysisMetric[]): void {
  const w = Math.min(cols(), 80);

  // Render metrics in a grid-like layout
  const metricWidth = Math.floor((w - 6) / Math.min(metrics.length, 3));
  const rows: AnalysisMetric[][] = [];
  for (let i = 0; i < metrics.length; i += 3) {
    rows.push(metrics.slice(i, i + 3));
  }

  for (const row of rows) {
    let line = "  ";
    for (const metric of row) {
      const valColor = metric.color || THEME.text;
      const trendIcon =
        metric.trend === "up" ? "↑" : metric.trend === "down" ? "↓" : "·";
      const trendColor =
        metric.trend === "up"
          ? THEME.success
          : metric.trend === "down"
            ? THEME.critical
            : THEME.dimMeta;
      const val = chalk.hex(valColor).bold(String(metric.value));
      const unit = metric.unit ? chalk.dim(metric.unit) : "";
      const trend = chalk.hex(trendColor)(trendIcon);
      const cell = `${val}${unit} ${trend} ${chalk.dim(metric.label)}`;
      line += cell.padEnd(metricWidth);
    }
    process.stdout.write(line + "\n");
  }
  process.stdout.write("\n");
}

export function renderAnalysisSection(section: AnalysisSection): void {
  const icon = section.icon || "📊";
  sectionDivider(`${icon} ${section.title}`);
  process.stdout.write("\n");

  if (section.metrics) {
    renderAnalysisMetrics(section.metrics);
  }

  if (section.findings) {
    for (const f of section.findings) {
      const sevColor = severityColour(f.severity as Severity);
      const dot = chalk.hex(sevColor)("●");
      process.stdout.write(
        `  ${dot}  ${chalk.hex(sevColor).bold(f.severity)} ${chalk.hex(THEME.text)(f.message)}\n`,
      );
      if (f.detail) {
        const wrapped = wrapText(f.detail, "     ");
        process.stdout.write(wrapped + "\n");
      }
    }
    process.stdout.write("\n");
  }

  if (section.content) {
    const lines = section.content.split("\n");
    for (const line of lines) {
      if (line.trim().length > 0) {
        process.stdout.write(`    ${chalk.hex(THEME.text)(line)}\n`);
      } else {
        process.stdout.write("\n");
      }
    }
    process.stdout.write("\n");
  }
}

export function renderAnalysisFooter(summary?: string): void {
  if (summary) {
    process.stdout.write(
      `  ${chalk.hex(THEME.dimMeta)("─")}  ${chalk.dim(summary)}\n`,
    );
  }
  process.stdout.write("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING TEXT FORMATTER — formats AI streaming output in real-time
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a streaming text formatter that intercepts AI output chunks
 * and applies structured formatting in real-time.
 */
export function createStreamFormatter(): {
  write: (chunk: string) => void;
  flush: () => void;
  getRaw: () => string;
} {
  let buffer = "";
  let rawText = "";
  let lastWasHeader = false;

  function processBuffer(): void {
    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();

      // Format markdown headers as section dividers
      if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
        const label = trimmed.replace(/^#{2,3}\s*/, "").trim();
        process.stdout.write("\n");
        sectionDivider(label.toLowerCase());
        process.stdout.write("\n");
        lastWasHeader = true;
        continue;
      }

      // Format bullet points
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        process.stdout.write(
          `  ${chalk.hex(THEME.info)("›")}  ${chalk.hex(THEME.text)(trimmed.slice(2))}\n`,
        );
        lastWasHeader = false;
        continue;
      }

      // Format numbered items
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        process.stdout.write(
          `  ${chalk.hex(THEME.accent).bold(numMatch[1] + ".")} ${chalk.hex(THEME.text)(numMatch[2])}\n`,
        );
        lastWasHeader = false;
        continue;
      }

      // Highlight file:line references inline
      if (trimmed.match(/\b[\w./\\-]+\.\w+:\d+/)) {
        const highlighted = trimmed.replace(
          /([\w./\\-]+\.\w+):(\d+)/g,
          (_, file, ln) =>
            `${chalk.hex(THEME.info)(file)}${chalk.dim(":")}${chalk.hex(THEME.accent)(ln)}`,
        );
        process.stdout.write(`    ${highlighted}\n`);
        lastWasHeader = false;
        continue;
      }

      // Regular text
      if (trimmed.length > 0) {
        if (lastWasHeader) {
          process.stdout.write("\n");
          lastWasHeader = false;
        }
        process.stdout.write(`    ${chalk.hex(THEME.text)(trimmed)}\n`);
      } else {
        process.stdout.write("\n");
        lastWasHeader = false;
      }
    }
  }

  return {
    write(chunk: string) {
      rawText += chunk;
      buffer += chunk;
      processBuffer();
    },
    flush() {
      if (buffer.trim().length > 0) {
        process.stdout.write(`    ${chalk.hex(THEME.text)(buffer.trim())}\n`);
      }
      buffer = "";
    },
    getRaw() {
      return rawText;
    },
  };
}

// HTML report generator (unchanged — not part of terminal UI layer)
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function generateHtmlReport(report: HealthReport): string {
  const band = scoreBandLabel(report.score);
  const scoreColor = scoreColour(report.score);

  let modulesHtml = "";
  for (const mod of report.modules) {
    const modScoreColor = scoreColour(mod.score);
    const statusIcon =
      mod.status === "ok" ? "✓" : mod.status === "warning" ? "●" : "✗";

    let findingsHtml = "";
    for (const f of mod.findings) {
      const sevColour = severityColour(f.severity);
      findingsHtml += `
        <div class="finding" style="border-left:3px solid ${sevColour};padding:8px 12px;margin:8px 0;background:#0d0f17">
          <span style="font-weight:bold;color:${sevColour}">[${f.severity}]</span>
          <span style="margin-left:8px;color:#89b4fa">${f.type}</span>
          ${f.file ? `<span style="color:#3d4466;margin-left:8px">${escapeHtml(f.file)}${f.line ? ":" + f.line : ""}</span>` : ""}
          <div style="margin-top:4px;color:#cdd6f4">${escapeHtml(f.message)}</div>
          ${f.fix ? `<div style="margin-top:4px;color:#a6e3a1;font-size:0.9em">→ ${escapeHtml(f.fix)}</div>` : ""}
        </div>`;
    }

    modulesHtml += `
      <div class="module" style="margin-bottom:24px;border:1px solid #1e2330;border-radius:8px;overflow:hidden">
        <div style="background:#0d0f17;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:bold;color:#cdd6f4">${statusIcon} ${mod.moduleName} <span style="color:#3d4466">${mod.moduleId}</span></span>
          <span style="color:${modScoreColor};font-weight:bold">${mod.score}/100</span>
        </div>
        <div style="padding:16px">
          <div style="color:#3d4466;margin-bottom:12px">${mod.durationMs}ms</div>
          ${findingsHtml || '<div style="color:#a6e3a1">No findings</div>'}
        </div>
      </div>`;
  }

  let actionsHtml = "";
  if (report.topActions.length > 0) {
    actionsHtml = `
      <div style="margin-top:24px">
        <h3 style="color:#cdd6f4;border-bottom:1px solid #1e2330;padding-bottom:8px">Top Actions</h3>
        <ol style="padding-left:20px;color:#cdd6f4">
          ${report.topActions.map((a) => `<li style="margin:8px 0">${escapeHtml(a)}</li>`).join("")}
        </ol>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Project Health Report</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,monospace;line-height:1.6;color:#cdd6f4;max-width:1200px;margin:0 auto;padding:20px;background:#0b0d12}
    h1,h2,h3{color:#cdd6f4}
    .score-section{text-align:center;padding:32px;background:#0d0f17;border:1px solid #1e2330;border-radius:12px;margin-bottom:32px}
    .score{font-size:72px;font-weight:bold;color:${scoreColor}}
    .band{font-size:20px;color:${scoreColor};margin-top:8px;letter-spacing:.2em}
    .meta{color:#3d4466;margin-top:16px}
  </style>
</head>
<body>
  <h1>Project Health Report</h1>
  <div class="score-section">
    <div class="score">${report.score}</div>
    <div class="band">${band}</div>
    <div class="meta">
      <div>${escapeHtml(report.projectRoot)}</div>
      <div>${new Date(report.generatedAt).toLocaleString()}</div>
    </div>
  </div>
  <h2>Module Results</h2>
  ${modulesHtml}
  ${actionsHtml}
</body>
</html>`;
}

// Exit codes
export const ExitCode = {
  SUCCESS: 0,
  FAIL_UNDER: 1,
  RATE_LIMIT: 2,
} as const;
