import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRAME_MS = 80;
const PHASE_DELAY_MS = 180;
const FRAMES = ["[    ]", "[=   ]", "[==  ]", "[=== ]", "[====]"];

function getPackageMeta(): { name: string; version: string } {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf-8"),
    ) as { name?: string; version?: string };
    return {
      name: pkg.name || "project-healthy",
      version: pkg.version || "unknown",
    };
  } catch {
    return { name: "project-healthy", version: "unknown" };
  }
}

export function shouldShowInstallAnimation(env: NodeJS.ProcessEnv): boolean {
  if (!process.stdout.isTTY) return false;
  if (env.CI === "true" || env.CI === "1") return false;
  if (env.TERM === "dumb") return false;
  if (env.npm_config_loglevel === "silent") return false;
  return true;
}

function clearCurrentLine(): void {
  process.stdout.write("\r\x1b[2K");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderPhase(label: string): Promise<void> {
  for (const frame of FRAMES) {
    clearCurrentLine();
    process.stdout.write(`${frame} ${label}`);
    await sleep(FRAME_MS);
  }
  clearCurrentLine();
  process.stdout.write(`[done] ${label}\n`);
  await sleep(PHASE_DELAY_MS);
}

export async function runPostinstallAnimation(): Promise<void> {
  const { name, version } = getPackageMeta();

  process.stdout.write("\n");
  process.stdout.write(`Installing ${name} v${version}\n`);
  await renderPhase("Loading CLI surface");
  await renderPhase("Wiring analysis modules");
  await renderPhase("Preparing local commands");
  process.stdout.write("Ready: run `ph init` to start.\n\n");
}

const invokedAsScript =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedAsScript && shouldShowInstallAnimation(process.env)) {
  await runPostinstallAnimation();
}
