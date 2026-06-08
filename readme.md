# Project Health (ph) 🚀

**The unified CLI & IDE tool for deep codebase intelligence**

`project-healthy` (ph) is an advanced, all-in-one CLI binary and IDE extension
designed to run deep, automated analyses on any software repository. It combines
eight parallel analysis modules and an AI intelligence layer powered by
**MegaLLM** to provide actionable insights, unified health scores, and
conversational code interaction.

---

## 📖 Executive Summary

Developers often juggle between multiple tools to evaluate codebase health—CI
dashboards, linters, security scanners, documentation wikis, and PR reviewers.
`ph` solves this fragmentation by offering **one command, one score, and one
conversation**.

Running `ph scan` orchestrates eight analysis modules in parallel to generate a
comprehensive 0-100 codebase health score, severity-ranked findings, and an
actionable top-3 task list. An embedded AI layer powers conversational code
interrogation, PR reviews, onboarding document generation, and intelligent
documentation updates.

## 🎯 Primary Goals

- **Single Binary**: Fast, global installation
  (`npm install -g project-healthy`).
- **Parallel Analysis**: Eight distinct modules run concurrently (under 60s for
  typical projects).
- **Unified Scoring**: 0–100 weighted health score with actionable insights.
- **MegaLLM-powered AI**: High-quality LLM integrations routed through a hosted
  backend (supporting Claude, GPT, Gemini, etc.).
- **Zero-Config AI**: Install from npm and start using AI features immediately —
  no API keys, no authentication, no setup.
- **IDE & CI/CD Support**: VS Code extension included, alongside CI pipeline
  integration (e.g., block merges if score drops below a threshold).

---

## 🏗 Architecture Overview

### 1. Analysis Pipeline

The execution pipeline seamlessly integrates multiple insights:
`User runs: ph scan` → **Analysis Orchestrator** (Runs M01 to M08 concurrently)
→ **Score Aggregator** (Computes `HealthReport`) → **Output Layer** (Displays
Terminal | JSON | HTML)

### 2. Local Context Cache (`.ph-cache/`)

The tool leverages a local workspace cache located at the project root to
support AI grounding and temporal state checks:

- `ast-index.json`: Maps symbol names to locations.
- `docs-index.json`: Maps source files to their referencing doc sections.
- `last-scan.json`: Context injector for AI queries.
- `sessions/`: Chat history files for persistent context.

### 3. AI Backend Architecture

AI calls are routed through a hosted backend at
`https://project-healthy.vercel.app/v1`. The backend interacts with the MegaLLM
API using secured keys on the server side. No third-party LLM API keys run on
the developer's local machine. The CLI connects directly to the hosted backend
with no authentication required.

```
CLI (ph) → https://project-healthy.vercel.app/v1 → MegaLLM API
          (hosted, public, no auth)               (server-side API key)
```

---

## 🧩 Core Analysis Modules (M-01 to M-08)

`ph` calculates your health score using eight diverse, weighted modules.

| ID       | Module Name             | Weight | Primary Purpose                             | How it works                                                                  |
| :------- | :---------------------- | :----: | :------------------------------------------ | :---------------------------------------------------------------------------- |
| **M-05** | **Dependency Security** |  20%   | Detect CVEs & license risks.                | Analyzes `npm audit`/`pip-audit` and license compatibility.                   |
| **M-02** | **Code Quality**        |  18%   | Linting, complexity, duplicates, dead code. | Runs ESLint, computes cyclomatic complexity, checks via `ts-prune` & `jscpd`. |
| **M-01** | **CI/CD Pipeline**      |  15%   | Build reliability & CI bottlenecks.         | Analyzes CI YAML and fetches run history from GitHub/GitLab.                  |
| **M-04** | **Test Flakiness**      |  14%   | Detects inconsistently failing tests.       | Parses JUnit XML reports cross-referenced against Git commit history.         |
| **M-07** | **Env Integrity**       |  13%   | `.env` drift and secret leakage prevention. | Scans `git history` for secrets, diffs `.env.example`, checks Dockerfiles.    |
| **M-08** | **Build Performance**   |  10%   | Caching efficiency & build bottlenecks.     | Parses CI logs to find duration anomalies and cache misses.                   |
| **M-03** | **Docs Freshness**      |   6%   | Identifies stale documentation.             | Correlates source code modification dates against related markdown sections.  |
| **M-06** | **PR Complexity**       |   4%   | Flags PRs too large or complex for review.  | Computes lines changed, cross-module impact, and review turnaround times.     |

### Health Score Labels

- **90–100 (EXCELLENT)**: No immediate action needed.
- **75–89 (GOOD)**: Address low-severity issues during sprints.
- **60–74 (MODERATE)**: Remediation sprint required within 2 weeks.
- **40–59 (HIGH RISK)**: Immediate action required on critical issues.
- **0–39 (CRITICAL)**: Block new features; dedicated remediation needed.

---

## 🤖 AI Features (Powered by MegaLLM)

All AI features are powered by the hosted backend and maintain grounded context
via the local `.ph-cache/`. No API keys or authentication required.

1. **`ph ask` (Natural Language Interrogation)** Ask plain-English questions
   about the codebase. Replaces generic advice with specific `file:line`
   citations.
2. **`ph review` (PR Review Co-pilot)** Senior-level review of a branch or PR.
   Highlights bugs, security gaps, untested paths, and complexity spikes based
   on actual test coverage.
3. **`ph brief` (Onboarding Briefing Generator)** Automatically creates an
   `ONBOARDING.md` containing architecture summaries, ownership maps, entry
   points, etc.
4. **`ph chat` (Conversational Codebase REPL)** A persistent terminal chat
   session.
5. **`ph fix` (Self-Healing Codebase Engine)** Automatically remediate findings
   from your last scan using MegaLLM patch generation. It triages, fixes, and
   validates findings, supporting auto-generated fixes (complexity refactoring,
   dead exports, secret leaks, etc.). Modes: `--auto` (fully automated fix
   loop), `--interactive`, `--dry-run`, `--ai`.
6. **Git Hook (Commit Doc Updater)** A surgical `post-commit` hook that
   automatically amends (or opens a PR to update) documentation sections that
   reference code you just changed.

---

## 🛠 Tech Stack

**Strictly TypeScript & Node.js ecosystem (Zero Java)**

- **CLI**: `commander`, `chalk`, `ora`, `execa`, `pkg`
- **AI Integration**: `openai` (configured to point to hosted backend)
- **Security Checkers**: `license-checker`, `js-yaml`, `dotenv`
- **Code Analyzers**: `@typescript-eslint/typescript-estree`,
  `complexity-report-es`, `ts-prune`, `jscpd`
- **APIs & Data Gathering**: `@octokit/rest`, `simple-git`, `fast-xml-parser`

---

## 🚀 Getting Started

### Installation (NPM)

**Zero configuration needed!** Just install from NPM and start using:

```bash
npm install -g project-healthy
cd your-project-folder
ph init
```

The CLI automatically uses our hosted backend
(`https://project-healthy.vercel.app/v1`) for AI features. No API keys, no auth
tokens, no environment variables to set.

### 1. Initialization / Interactive Shell

```bash
cd your-project-folder
ph init
```

`ph init` acts as your interactive CLI shell! It activates an interactive,
continuous command loop. You can input commands straight from the prompt,
remaining active until you press `Ctrl+C` or close the terminal. Additionally,
it generates the `.ph-cache/` context folder, builds your
`project-health.config.ts`, and installs the smart git hooks.

### 2. Running a Scan

```bash
ph scan --format terminal
```

Runs the 8 parallel modules and logs the score to stdout. Use `--format html`
for an interactive report, `--format sarif` for security tool integration, or
`--fail-under 80` in CI/CD pipelines.

### 3. Web Dashboard Integration

```bash
ph dashboard --port 8080
```

Launches a robust data integration Web Dashboard with responsive design updates
via flexible wrapping utilities, ensuring metrics won't overlap.

### 4. Interactive Repository Explorer

```bash
ph explore
```

Launches a local web UI at `http://localhost:7878` with a file tree with
activity heat maps, commit history for each file, click-to-expand diffs inline,
and module health impact visualization.

### 5. Self-Healing Auto-Fix Engine Pipeline

```bash
# Auto-fix all fixable findings automatically (Full pipeline)
ph fix --auto

# Interactive selection of findings to fix
ph fix --interactive

# Preview AI-powered fix patches without applying
ph fix --dry-run

# AI-powered fixes (uses hosted backend, no API key needed)
ph fix --ai
```

### 6. Additional Commands

```bash
# General AI assistance
ph ask "What are the main entry points?"

# Fast CI check with 30s timeout (exits 1 if below threshold)
ph ci-check --fail-under 80

# Compare current branch against base
ph diff --base main

# Print latest health score from cache
ph score

# Historical score trend analysis
ph trend

# AI Codebase Chat
ph chat
```

---

## 💻 Running the CLI Locally (From Source)

If you'd like to extend `project-health` or run the uncompiled source code
yourself:

### Step 1. Clone & Build

```bash
git clone https://github.com/Sanjay-Shahyml/Project-health.git
cd Project-health
npm install
npm run build
```

_(Optional) Create a global link for the local binary:_

```bash
npm link
```

### Step 2. Optional Environment Variables

The CLI works out of the box with the hosted backend. You only need `.env` for
optional integrations like GitHub/GitLab:

```env
# Optional: Override the hosted backend URL (e.g., for local development)
# PROJECT_HEALTH_BACKEND_URL="https://project-healthy.vercel.app/v1"

# Optional: GitHub/GitLab tokens for M-01 (CI/CD) and M-06 (PR Complexity)
GITHUB_TOKEN=ghp_your_github_token_here
GITLAB_TOKEN=glpat_your_gitlab_token_here

# Optional: Snyk token for M-05 (Dependency Security)
SNYK_TOKEN=your_snyk_token_here
```

---

## 🖥️ Self-Hosting the AI Backend

The AI backend is deployed at `https://project-healthy.vercel.app/v1` and works
for all users. If you want to self-host your own instance:

### Step 1: Deploy the `ai-proxy`

```bash
cd ai-proxy
npm install
npm run build
```

Deploy to Vercel, Railway, or any Node.js hosting provider.

### Step 2: Configure Environment Variables

Set these on your hosting platform:

```env
MEGALLM_API_KEY=sk-your-megallm-api-key
MEGALLM_BASE_URL=https://ai.megallm.io/v1
MEGALLM_MODEL=openai-gpt-oss-120b
MEGALLM_MAX_TOKENS=120000
MEGALLM_TEMPERATURE=0.7
PORT=3000
RATE_LIMIT_RPM=60
```

### Step 3: Point CLI to Your Instance

```bash
ph chat "hello" --proxy https://your-deployed-backend.com/v1
```

Or set in `.env`:

```env
PROJECT_HEALTH_BACKEND_URL="https://your-deployed-backend.com/v1"
```