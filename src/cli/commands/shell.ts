// Interactive CLI Shell for project-health (ph)
// Launched after `ph init` or via `ph shell`
// Runs a REPL until the user types "exit", "quit", or presses Ctrl+C

import chalk from "chalk";
import * as readline from "readline";
import type { Command } from "commander";
import { setReplMode, ShellExitError } from "../shell-exit.js";

// ─── Banner ─────────────────────────────────────────────────────────────────

const ACCENT = "#b4befe";
const TEXT = "#cdd6f4";
const DIM = "#3d4466";
const BORDER = "#1e2330";
const SUCCESS = "#a6e3a1";
const INFO = "#89b4fa";

const BANNER = `
${chalk.hex(BORDER)("\u2554" + "\u2550".repeat(61) + "\u2557")}
${chalk.hex(BORDER)("\u2551")}   ${chalk.hex(ACCENT).bold("project-health")} ${chalk.hex(TEXT)("interactive shell")}                           ${chalk.hex(BORDER)("\u2551")}
${chalk.hex(BORDER)("\u2551")}   ${chalk.hex(DIM)("Type a command to run it. 'help' lists all commands.")}            ${chalk.hex(BORDER)("\u2551")}
${chalk.hex(BORDER)("\u2551")}   ${chalk.hex(DIM)("Press Ctrl+C or type 'exit' to quit.")}                           ${chalk.hex(BORDER)("\u2551")}
${chalk.hex(BORDER)("\u255a" + "\u2550".repeat(61) + "\u255d")}
`;

// ─── Command catalogue (name → short description) ───────────────────────────

const COMMANDS: Array<{ name: string; flags?: string; description: string }> = [
  {
    name: "scan",
    flags: "[-f format] [-m module] [--remote url] [--badge]",
    description: "Run all 8 analysis modules in parallel",
  },
  {
    name: "score",
    description: "Print latest cached health score",
  },
  {
    name: "ci-check",
    flags: "[--modules ids] [--fail-under n]",
    description: "Fast CI-focused check (M-05, M-07 by default)",
  },
  {
    name: "diff",
    flags: "[-b base] [-f format]",
    description:
      "Compare current branch against base and run changed-file modules",
  },
  {
    name: "chat",
    flags: "[question] [--full-context]",
    description: "AI chat: interactive REPL or one-shot RAG question",
  },
  {
    name: "review",
    flags: "[-p pr] [--post]",
    description: "AI-powered code / PR review",
  },
  {
    name: "brief",
    flags: "[-o path] [--update]",
    description: "Generate ONBOARDING.md for new developers",
  },
  {
    name: "context",
    flags: "[-o path] [--stdout]",
    description: "Pack repo into an LLM-ready XML context file",
  },
  {
    name: "fix",
    flags: "[--auto] [--dry-run]",
    description: "Auto-fix findings from last scan",
  },
  {
    name: "trend",
    description: "Show health score trend over time",
  },
  {
    name: "dashboard",
    description: "Open the real-time metrics dashboard",
  },
  {
    name: "explore",
    flags: "[-p port]",
    description: "Interactive web UI repo explorer",
  },
  {
    name: "config",
    flags: "[-s key=value] | wizard",
    description: "Manage project-health configuration",
  },
  {
    name: "help",
    description: "Show this command list",
  },
  {
    name: "exit",
    description: "Quit the shell",
  },
];

// ─── Help renderer ───────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(
    `\n${chalk.bold.cyan("Available commands")}  ${chalk.dim("(flags are optional)")}\n`,
  );

  const maxLen = Math.max(...COMMANDS.map((c) => c.name.length));

  for (const cmd of COMMANDS) {
    const name = chalk.green(cmd.name.padEnd(maxLen + 2));
    const flags = cmd.flags ? chalk.dim(cmd.flags + " ") : "";
    console.log(`  ${name}${flags}${chalk.white(cmd.description)}`);
  }

  console.log();
}

// ─── Prompt string ───────────────────────────────────────────────────────────

const PROMPT = chalk.cyan("ph") + chalk.dim(" ❯ ");

// ─── Main shell loop ─────────────────────────────────────────────────────────

export async function startShell(program: Command): Promise<void> {
  // Enable REPL mode so commands throw instead of calling process.exit()
  setReplMode(true);

  console.log(BANNER);
  printHelp();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: PROMPT,
  });

  // Graceful Ctrl+C
  rl.on("SIGINT", () => {
    setReplMode(false);
    console.log(chalk.dim("\n\nGoodbye 👋"));
    rl.close();
    process.exit(0);
  });

  rl.on("close", () => {
    setReplMode(false);
    // stdin closed (terminal closed)
    process.exit(0);
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // ── Built-in shell commands ──────────────────────────────────────────────
    if (input === "exit" || input === "quit") {
      setReplMode(false);
      console.log(chalk.dim("Goodbye 👋"));
      rl.close();
      process.exit(0);
    }

    if (input === "help" || input === "?") {
      printHelp();
      rl.prompt();
      return;
    }

    // ── Delegate to commander ────────────────────────────────────────────────
    // Tokenise respecting quoted strings
    const args = tokenise(input);

    try {
      // commander needs a fresh argv list; we patch process.argv temporarily
      const savedArgv = process.argv;
      process.argv = ["node", "ph", ...args];

      // Disable commander's own process.exit on errors so the shell keeps running
      program.exitOverride();

      await program.parseAsync(["node", "ph", ...args]);

      process.argv = savedArgv;
    } catch (err: unknown) {
      if (err instanceof ShellExitError) {
        // Command used shellExit() — this is normal, just continue the REPL
      } else if (err instanceof Error) {
        // commander throws a CommanderError for --help, -V, unknown commands etc.
        const anyErr = err as any;
        if (
          anyErr.code === "commander.helpDisplayed" ||
          anyErr.code === "commander.version"
        ) {
          // Already printed to stdout — just continue
        } else if (anyErr.code === "commander.unknownCommand") {
          console.error(
            chalk.red(
              `  Unknown command: "${args[0]}". Type 'help' to see what's available.`,
            ),
          );
        } else if (anyErr.code === "commander.unknownOption") {
          console.error(chalk.red(`  ${err.message}`));
        } else {
          // Surface actual runtime errors
          console.error(chalk.red(`  Error: ${err.message}`));
        }
      }
    }

    console.log(); // blank line for breathing room
    rl.prompt();
  });

  // Keep the process alive — readline keeps stdin open
  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
  });
}

// ─── Tokeniser (handles "quoted strings") ────────────────────────────────────

function tokenise(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
        tokens.push(current);
        current = "";
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
