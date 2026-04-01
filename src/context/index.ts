import {
  createReadStream,
  existsSync,
  promises as fs,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, join, resolve } from "node:path";
import { simpleGit } from "simple-git";
import {
  DOC_EXTENSIONS,
  NON_SOURCE_EXTENSIONS,
  getRelativePath,
  isConfigFile,
  isDocFile,
  isSourceFile,
  shouldIgnorePath,
} from "../utils/ignore.js";
import {
  analyzeProject,
  formatProjectOverview,
  type ProjectDescriptor,
} from "../utils/project-analyzer.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ph:context");

const DEFAULT_MAX_FILE_SIZE_BYTES = 128 * 1024;
const DEFAULT_GIT_LOG_LIMIT = 20;
const DEFAULT_DIFF_CHAR_LIMIT = 20_000;

export interface ContextGenerationOptions {
  outputPath?: string;
  includeFileContents?: boolean;
  includeDiffs?: boolean;
  includeGitLog?: boolean;
  maxFileSizeBytes?: number;
  maxFiles?: number;
  splitOutputChars?: number;
  sortBy?: "path" | "changes";
  headerText?: string;
  headerFile?: string;
  gitLogLimit?: number;
  diffCharLimit?: number;
}

export interface ContextWriteResult {
  outputFiles: string[];
  totalFiles: number;
  packedFiles: number;
  omittedFiles: number;
  totalBytes: number;
  estimatedTokens: number;
}

interface ResolvedContextOptions {
  outputPath: string;
  includeFileContents: boolean;
  includeDiffs: boolean;
  includeGitLog: boolean;
  maxFileSizeBytes: number;
  maxFiles?: number;
  splitOutputChars?: number;
  sortBy: "path" | "changes";
  headerText: string;
  gitLogLimit: number;
  diffCharLimit: number;
}

interface GitInfo {
  isRepo: boolean;
  branch?: string;
  remotes: Array<{ name: string; fetch?: string; push?: string }>;
  statusSummary?: {
    modified: number;
    staged: number;
    created: number;
    deleted: number;
    renamed: number;
    conflicted: number;
    untracked: number;
  };
  recentLog?: string;
  worktreeDiff?: string;
  stagedDiff?: string;
  changeCounts: Map<string, number>;
}

interface PackageSummary {
  name: string;
  version?: string;
  packageManager?: string;
  scripts: Array<{ name: string; command: string }>;
  dependencies: Array<{ name: string; version: string; scope: "prod" | "dev" }>;
}

type FileCategory = "source" | "documentation" | "config" | "other";

interface ContextFileEntry {
  path: string;
  absolutePath: string;
  language: string;
  category: FileCategory;
  sizeBytes: number;
  lineCount: number;
  sha256: string;
  lastModified: string;
  gitChanges: number;
  binary: boolean;
  truncated: boolean;
  omittedReason?: string;
  estimatedTokens: number;
  content?: string;
}

interface ContextStats {
  totalFiles: number;
  packedFiles: number;
  omittedFiles: number;
  directoryCount: number;
  totalBytes: number;
  totalLines: number;
  estimatedTokens: number;
  languages: Array<{ language: string; files: number }>;
  categories: Array<{ category: FileCategory; files: number }>;
}

interface ContextDocumentModel {
  generatedAt: string;
  projectRoot: string;
  repositoryName: string;
  overview: string;
  descriptor: ProjectDescriptor;
  packageSummary: PackageSummary;
  gitInfo: GitInfo;
  headerText: string;
  directoryStructure: string;
  files: ContextFileEntry[];
  stats: ContextStats;
}

interface RenderedDocument {
  content: string;
  packedFiles: number;
}

export async function writeContextFile(
  projectRoot: string,
  options: ContextGenerationOptions = {},
): Promise<ContextWriteResult> {
  const context = await collectContext(projectRoot, options);
  const documents = renderContextDocuments(context, context.options);

  const outputFiles: string[] = [];
  if (documents.length === 1) {
    await fs.writeFile(
      context.options.outputPath,
      documents[0].content,
      "utf-8",
    );
    outputFiles.push(context.options.outputPath);
  } else {
    const parsed = splitOutputPath(context.options.outputPath);
    for (const [index, document] of documents.entries()) {
      const filePath = `${parsed.base}.${index + 1}${parsed.ext}`;
      await fs.writeFile(filePath, document.content, "utf-8");
      outputFiles.push(filePath);
    }
  }

  return {
    outputFiles,
    totalFiles: context.stats.totalFiles,
    packedFiles: context.stats.packedFiles,
    omittedFiles: context.stats.omittedFiles,
    totalBytes: context.stats.totalBytes,
    estimatedTokens: context.stats.estimatedTokens,
  };
}

export async function buildContextDocument(
  projectRoot: string,
  options: ContextGenerationOptions = {},
): Promise<string> {
  const context = await collectContext(projectRoot, options);
  return renderContextDocuments(context, context.options)[0].content;
}

async function collectContext(
  projectRoot: string,
  options: ContextGenerationOptions,
): Promise<ContextDocumentModel & { options: ResolvedContextOptions }> {
  const resolvedOptions = await resolveOptions(projectRoot, options);
  const packageSummary = readPackageSummary(projectRoot);
  const descriptor = analyzeProject(projectRoot);
  const overview = formatProjectOverview(descriptor);
  const gitInfo = await collectGitInfo(projectRoot, resolvedOptions);
  const filePaths = await collectRepositoryFiles(
    projectRoot,
    resolvedOptions.outputPath,
    gitInfo.isRepo,
  );
  const files = await collectFileEntries(
    projectRoot,
    filePaths,
    gitInfo.changeCounts,
    resolvedOptions,
  );
  const orderedFiles = sortFiles(files, resolvedOptions.sortBy);
  const directoryStructure = renderDirectoryStructure(
    orderedFiles.map((file) => file.path),
  );
  const stats = buildStats(orderedFiles, directoryStructure);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    repositoryName:
      packageSummary.name && packageSummary.name !== "unknown"
        ? packageSummary.name
        : basename(projectRoot),
    overview,
    descriptor,
    packageSummary,
    gitInfo,
    headerText: resolvedOptions.headerText,
    directoryStructure,
    files: orderedFiles,
    stats,
    options: resolvedOptions,
  };
}

async function resolveOptions(
  projectRoot: string,
  options: ContextGenerationOptions,
): Promise<ResolvedContextOptions> {
  const outputPath = resolve(
    projectRoot,
    options.outputPath || `project-context-${basename(projectRoot)}.xml`,
  );

  let headerText = options.headerText?.trim() || "";
  if (!headerText && options.headerFile) {
    const headerFilePath = resolve(projectRoot, options.headerFile);
    if (existsSync(headerFilePath)) {
      headerText = await fs.readFile(headerFilePath, "utf-8");
    }
  }

  return {
    outputPath,
    includeFileContents: options.includeFileContents ?? true,
    includeDiffs: options.includeDiffs ?? true,
    includeGitLog: options.includeGitLog ?? true,
    maxFileSizeBytes: options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
    maxFiles: options.maxFiles,
    splitOutputChars: options.splitOutputChars,
    sortBy: options.sortBy ?? "path",
    headerText,
    gitLogLimit: options.gitLogLimit ?? DEFAULT_GIT_LOG_LIMIT,
    diffCharLimit: options.diffCharLimit ?? DEFAULT_DIFF_CHAR_LIMIT,
  };
}

async function collectGitInfo(
  projectRoot: string,
  options: ResolvedContextOptions,
): Promise<GitInfo> {
  const git = simpleGit(projectRoot);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        isRepo: false,
        remotes: [],
        changeCounts: new Map<string, number>(),
      };
    }

    const [
      status,
      remotes,
      branchRaw,
      changeCounts,
      recentLog,
      worktreeDiff,
      stagedDiff,
    ] = await Promise.all([
      git.status(),
      git.getRemotes(true),
      git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
      collectGitChangeCounts(git),
      options.includeGitLog
        ? collectGitLog(git, options.gitLogLimit)
        : Promise.resolve(""),
      options.includeDiffs
        ? collectDiff(git, ["--patch", "--minimal"], options.diffCharLimit)
        : Promise.resolve(""),
      options.includeDiffs
        ? collectDiff(
            git,
            ["--cached", "--patch", "--minimal"],
            options.diffCharLimit,
          )
        : Promise.resolve(""),
    ]);

    return {
      isRepo: true,
      branch: branchRaw.trim(),
      remotes: remotes.map((remote) => ({
        name: remote.name,
        fetch: remote.refs.fetch,
        push: remote.refs.push,
      })),
      statusSummary: {
        modified: status.modified.length,
        staged: status.staged.length,
        created: status.created.length,
        deleted: status.deleted.length,
        renamed: status.renamed.length,
        conflicted: status.conflicted.length,
        untracked: status.not_added.length,
      },
      recentLog: recentLog || undefined,
      worktreeDiff: worktreeDiff || undefined,
      stagedDiff: stagedDiff || undefined,
      changeCounts,
    };
  } catch (error) {
    log("Error collecting git info: %O", error);
    return {
      isRepo: false,
      remotes: [],
      changeCounts: new Map<string, number>(),
    };
  }
}

async function collectGitChangeCounts(
  git: ReturnType<typeof simpleGit>,
): Promise<Map<string, number>> {
  try {
    const raw = await git.raw(["log", "--pretty=format:", "--name-only", "--"]);
    const counts = new Map<string, number>();

    for (const line of raw.split(/\r?\n/)) {
      const file = line.trim().replace(/\\/g, "/");
      if (!file) continue;
      counts.set(file, (counts.get(file) || 0) + 1);
    }

    return counts;
  } catch (error) {
    log("Error collecting git change counts: %O", error);
    return new Map<string, number>();
  }
}

async function collectGitLog(
  git: ReturnType<typeof simpleGit>,
  limit: number,
): Promise<string> {
  try {
    const raw = await git.raw([
      "log",
      `--max-count=${limit}`,
      "--date=iso-strict",
      "--pretty=format:%H%x09%ad%x09%an%x09%s",
    ]);

    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, date, author, ...subjectParts] = line.split("\t");
        return `${hash} | ${date} | ${author} | ${subjectParts.join("\t")}`;
      })
      .join("\n");
  } catch (error) {
    log("Error collecting git log: %O", error);
    return "";
  }
}

async function collectDiff(
  git: ReturnType<typeof simpleGit>,
  args: string[],
  limit: number,
): Promise<string> {
  try {
    const diff = await git.diff(args);
    if (!diff.trim()) return "";
    return truncateWithNotice(diff, limit, "diff");
  } catch (error) {
    log("Error collecting git diff: %O", error);
    return "";
  }
}

async function collectRepositoryFiles(
  projectRoot: string,
  outputPath: string,
  isGitRepo: boolean,
): Promise<string[]> {
  const outputRelativePath = getRelativePath(projectRoot, outputPath);

  if (isGitRepo) {
    try {
      const git = simpleGit(projectRoot);
      const raw = await git.raw([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
      ]);

      return raw
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/\\/g, "/"))
        .filter(Boolean)
        .filter((file) => file !== outputRelativePath)
        .filter((file) => !shouldIgnorePath(file))
        .filter((file) => existsSync(join(projectRoot, file)));
    } catch (error) {
      log("Error using git ls-files: %O", error);
    }
  }

  const files: string[] = [];
  await walkFiles(projectRoot, projectRoot, files, outputRelativePath);
  return files;
}

async function walkFiles(
  projectRoot: string,
  currentDir: string,
  files: string[],
  outputRelativePath: string,
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const relPath = getRelativePath(projectRoot, fullPath);

    if (relPath === outputRelativePath || shouldIgnorePath(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkFiles(projectRoot, fullPath, files, outputRelativePath);
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
}

async function collectFileEntries(
  projectRoot: string,
  filePaths: string[],
  changeCounts: Map<string, number>,
  options: ResolvedContextOptions,
): Promise<ContextFileEntry[]> {
  const limitedPaths =
    typeof options.maxFiles === "number"
      ? filePaths.slice(0, Math.max(0, options.maxFiles))
      : filePaths;

  const files: ContextFileEntry[] = [];
  for (const relPath of limitedPaths) {
    const absolutePath = join(projectRoot, relPath);
    const stat = await fs.stat(absolutePath);
    const category = detectCategory(relPath);
    const binary =
      NON_SOURCE_EXTENSIONS.has(extname(relPath).toLowerCase()) ||
      (await isBinaryFile(absolutePath));
    const shouldReadContent = options.includeFileContents && !binary;
    const fileEntry: ContextFileEntry = {
      path: relPath,
      absolutePath,
      language: detectLanguage(relPath),
      category,
      sizeBytes: stat.size,
      lineCount: 0,
      sha256: await hashFile(absolutePath),
      lastModified: stat.mtime.toISOString(),
      gitChanges: changeCounts.get(relPath) || 0,
      binary,
      truncated: false,
      estimatedTokens: 0,
    };

    if (!shouldReadContent) {
      fileEntry.omittedReason = binary
        ? "binary_or_non_text"
        : "file_contents_disabled";
      files.push(fileEntry);
      continue;
    }

    try {
      const content = await fs.readFile(absolutePath, "utf-8");
      fileEntry.lineCount = countLines(content);

      if (Buffer.byteLength(content, "utf-8") > options.maxFileSizeBytes) {
        fileEntry.truncated = true;
        fileEntry.content = truncateUtf8Content(
          content,
          options.maxFileSizeBytes,
        );
      } else {
        fileEntry.content = content;
      }

      fileEntry.estimatedTokens = estimateTokens(fileEntry.content || "");
    } catch (error) {
      log("Error reading file %s: %O", absolutePath, error);
      fileEntry.omittedReason = "read_error";
    }

    files.push(fileEntry);
  }

  return files;
}

function sortFiles(
  files: ContextFileEntry[],
  sortBy: "path" | "changes",
): ContextFileEntry[] {
  return [...files].sort((left, right) => {
    if (sortBy === "changes") {
      if (left.gitChanges !== right.gitChanges) {
        return left.gitChanges - right.gitChanges;
      }
      return left.path.localeCompare(right.path);
    }

    return left.path.localeCompare(right.path);
  });
}

function buildStats(
  files: ContextFileEntry[],
  directoryStructure: string,
): ContextStats {
  const languages = new Map<string, number>();
  const categories = new Map<FileCategory, number>();
  let packedFiles = 0;
  let omittedFiles = 0;
  let totalBytes = 0;
  let totalLines = 0;
  let estimatedTokens = estimateTokens(directoryStructure);

  for (const file of files) {
    totalBytes += file.sizeBytes;
    totalLines += file.lineCount;
    estimatedTokens += file.estimatedTokens;
    languages.set(file.language, (languages.get(file.language) || 0) + 1);
    categories.set(file.category, (categories.get(file.category) || 0) + 1);

    if (file.content !== undefined) packedFiles++;
    else omittedFiles++;
  }

  return {
    totalFiles: files.length,
    packedFiles,
    omittedFiles,
    directoryCount: countDirectories(directoryStructure),
    totalBytes,
    totalLines,
    estimatedTokens,
    languages: [...languages.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([language, count]) => ({ language, files: count })),
    categories: [...categories.entries()].map(([category, count]) => ({
      category,
      files: count,
    })),
  };
}

function renderContextDocuments(
  context: ContextDocumentModel,
  options: ResolvedContextOptions,
): RenderedDocument[] {
  if (!options.splitOutputChars || options.splitOutputChars <= 0) {
    return [
      {
        content: renderSingleDocument(
          context,
          context.files,
          options,
          undefined,
        ),
        packedFiles: context.files.filter((file) => file.content !== undefined)
          .length,
      },
    ];
  }

  const chunks: ContextFileEntry[][] = [];
  let currentChunk: ContextFileEntry[] = [];
  let currentSize = 0;

  for (const file of context.files) {
    const renderedFile = renderFileEntry(file);
    if (
      currentChunk.length > 0 &&
      currentSize + renderedFile.length > options.splitOutputChars
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(file);
    currentSize += renderedFile.length;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  if (chunks.length === 0) {
    return [
      {
        content: renderSingleDocument(context, [], options, undefined),
        packedFiles: 0,
      },
    ];
  }

  return chunks.map((chunk, index) => ({
    content: renderSingleDocument(context, chunk, options, {
      number: index + 1,
      total: chunks.length,
    }),
    packedFiles: chunk.filter((file) => file.content !== undefined).length,
  }));
}

function renderSingleDocument(
  context: ContextDocumentModel,
  files: ContextFileEntry[],
  options: ResolvedContextOptions,
  part?: { number: number; total: number },
): string {
  const packageScripts = context.packageSummary.scripts
    .map(
      (script) =>
        `      <script name="${escapeAttribute(script.name)}">${escapeXml(script.command)}</script>`,
    )
    .join("\n");

  const packageDependencies = context.packageSummary.dependencies
    .slice(0, 100)
    .map(
      (dependency) =>
        `      <dependency scope="${dependency.scope}" name="${escapeAttribute(dependency.name)}" version="${escapeAttribute(dependency.version)}" />`,
    )
    .join("\n");

  const entryPoints = context.descriptor.entryPoints
    .map(
      (entryPoint) => `      <entry path="${escapeAttribute(entryPoint)}" />`,
    )
    .join("\n");

  const topDirectories = context.descriptor.topDirs
    .map(
      (directory) =>
        `      <directory name="${escapeAttribute(directory.name)}" files="${directory.files}" />`,
    )
    .join("\n");

  const languageStats = context.stats.languages
    .map(
      (language) =>
        `      <language name="${escapeAttribute(language.language)}" files="${language.files}" />`,
    )
    .join("\n");

  const categoryStats = context.stats.categories
    .map(
      (category) =>
        `      <category name="${category.category}" files="${category.files}" />`,
    )
    .join("\n");

  const remotes = context.gitInfo.remotes
    .map(
      (remote) =>
        `      <remote name="${escapeAttribute(remote.name)}"${remote.fetch ? ` fetch="${escapeAttribute(remote.fetch)}"` : ""}${remote.push ? ` push="${escapeAttribute(remote.push)}"` : ""} />`,
    )
    .join("\n");

  const notes = [
    "Repository files are filtered using git tracked/untracked files when available.",
    "Paths ignored by project-health defaults are excluded.",
    "Binary files are represented in metadata but their content is omitted.",
    "Large text files are truncated to keep the output LLM-friendly.",
    options.sortBy === "changes"
      ? "Files are sorted by git change frequency, with hotter files later in the document."
      : "Files are sorted by path for deterministic output.",
    context.gitInfo.recentLog
      ? `Git log is included (${options.gitLogLimit} commits).`
      : "Git log is omitted or unavailable.",
    context.gitInfo.worktreeDiff || context.gitInfo.stagedDiff
      ? "Current unstaged/staged diffs are included."
      : "No git diff content is included.",
  ]
    .map((note) => `      <note>${escapeXml(note)}</note>`)
    .join("\n");

  const filesXml = files.map((file) => renderFileEntry(file)).join("\n");
  const packedFileCount = files.filter(
    (file) => file.content !== undefined,
  ).length;

  return `<?xml version="1.0" encoding="UTF-8"?>
<project_context tool="project-health" version="3.0.0" generated_at="${escapeAttribute(context.generatedAt)}"${part ? ` part="${part.number}" total_parts="${part.total}"` : ""}>
  <file_summary>
    <purpose>This file contains an LLM-ready representation of the repository, including structure, repository metadata, and selected file contents.</purpose>
    <file_format>
      <item>Summary and usage guidance</item>
      <item>Repository metadata and project overview</item>
      <item>Directory structure snapshot</item>
      <item>Git context including recent commits and active diffs when available</item>
      <item>Repository files with path-scoped content blocks</item>
    </file_format>
    <usage_guidelines>
      <item>Treat this file as generated output and update source files instead of editing this document.</item>
      <item>Use file paths and metadata attributes to reason about repository layout and hotspots.</item>
      <item>Check omitted or truncated markers before assuming a file was fully included.</item>
      <item>Use repository and git sections for higher-level context before diving into file bodies.</item>
    </usage_guidelines>
    <notes>
${notes}
    </notes>
  </file_summary>
${context.headerText.trim() ? `  <user_provided_header><![CDATA[${escapeCdata(context.headerText)}]]></user_provided_header>\n` : ""}  <repository_info>
    <name>${escapeXml(context.repositoryName)}</name>
    <root>${escapeXml(context.projectRoot)}</root>
    <overview>${escapeXml(context.overview)}</overview>
    <project_descriptor
      type="${escapeAttribute(context.descriptor.type)}"
      language="${escapeAttribute(context.descriptor.language)}"
      framework="${escapeAttribute(context.descriptor.framework)}"
      has_tests="${String(context.descriptor.hasTests)}"
      has_ci="${String(context.descriptor.hasCI)}"
      has_docs="${String(context.descriptor.hasDocs)}"
      has_docker="${String(context.descriptor.hasDocker)}"
    />
    <package
      name="${escapeAttribute(context.packageSummary.name)}"${context.packageSummary.version ? ` version="${escapeAttribute(context.packageSummary.version)}"` : ""}${context.packageSummary.packageManager ? ` package_manager="${escapeAttribute(context.packageSummary.packageManager)}"` : ""}
    >
      <scripts>
${packageScripts || '        <script name="none">none</script>'}
      </scripts>
      <dependencies total="${context.packageSummary.dependencies.length}">
${packageDependencies || '        <dependency scope="prod" name="none" version="n/a" />'}
      </dependencies>
    </package>
    <stats
      total_files="${context.stats.totalFiles}"
      packed_files="${packedFileCount}"
      omitted_files="${files.length - packedFileCount}"
      directories="${context.stats.directoryCount}"
      total_lines="${context.stats.totalLines}"
      total_bytes="${context.stats.totalBytes}"
      estimated_tokens="${context.stats.estimatedTokens}"
    />
    <languages>
${languageStats || '      <language name="unknown" files="0" />'}
    </languages>
    <categories>
${categoryStats || '      <category name="other" files="0" />'}
    </categories>
    <entry_points>
${entryPoints || '      <entry path="none" />'}
    </entry_points>
    <top_directories>
${topDirectories || '      <directory name="root" files="0" />'}
    </top_directories>
  </repository_info>
  <git_context available="${String(context.gitInfo.isRepo)}">
${context.gitInfo.branch ? `    <branch>${escapeXml(context.gitInfo.branch)}</branch>\n` : ""}${context.gitInfo.statusSummary ? `    <status modified="${context.gitInfo.statusSummary.modified}" staged="${context.gitInfo.statusSummary.staged}" created="${context.gitInfo.statusSummary.created}" deleted="${context.gitInfo.statusSummary.deleted}" renamed="${context.gitInfo.statusSummary.renamed}" conflicted="${context.gitInfo.statusSummary.conflicted}" untracked="${context.gitInfo.statusSummary.untracked}" />\n` : ""}    <remotes>
${remotes || '      <remote name="none" />'}
    </remotes>
${context.gitInfo.recentLog ? `    <git_log><![CDATA[${escapeCdata(context.gitInfo.recentLog)}]]></git_log>\n` : ""}${context.gitInfo.worktreeDiff ? `    <worktree_diff><![CDATA[${escapeCdata(context.gitInfo.worktreeDiff)}]]></worktree_diff>\n` : ""}${context.gitInfo.stagedDiff ? `    <staged_diff><![CDATA[${escapeCdata(context.gitInfo.stagedDiff)}]]></staged_diff>\n` : ""}  </git_context>
  <directory_structure><![CDATA[${escapeCdata(context.directoryStructure)}]]></directory_structure>
  <files>
${filesXml}
  </files>
</project_context>
`;
}

function renderFileEntry(file: ContextFileEntry): string {
  const attrs = [
    `path="${escapeAttribute(file.path)}"`,
    `language="${escapeAttribute(file.language)}"`,
    `category="${escapeAttribute(file.category)}"`,
    `size_bytes="${file.sizeBytes}"`,
    `lines="${file.lineCount}"`,
    `sha256="${file.sha256}"`,
    `last_modified="${escapeAttribute(file.lastModified)}"`,
    `git_changes="${file.gitChanges}"`,
    `binary="${String(file.binary)}"`,
    `truncated="${String(file.truncated)}"`,
    `estimated_tokens="${file.estimatedTokens}"`,
  ];

  if (file.omittedReason) {
    attrs.push(`omitted_reason="${escapeAttribute(file.omittedReason)}"`);
  }

  if (file.content === undefined) {
    return `    <file ${attrs.join(" ")} />`;
  }

  return `    <file ${attrs.join(" ")}><![CDATA[${escapeCdata(file.content)}]]></file>`;
}

function readPackageSummary(projectRoot: string): PackageSummary {
  const packagePath = join(projectRoot, "package.json");
  if (!existsSync(packagePath)) {
    return {
      name: basename(projectRoot),
      scripts: [],
      dependencies: [],
    };
  }

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
      name?: string;
      version?: string;
      packageManager?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    return {
      name: packageJson.name || basename(projectRoot),
      version: packageJson.version,
      packageManager: packageJson.packageManager,
      scripts: Object.entries(packageJson.scripts || {}).map(
        ([name, command]) => ({
          name,
          command,
        }),
      ),
      dependencies: [
        ...Object.entries(packageJson.dependencies || {}).map(
          ([name, version]) => ({
            name,
            version,
            scope: "prod" as const,
          }),
        ),
        ...Object.entries(packageJson.devDependencies || {}).map(
          ([name, version]) => ({
            name,
            version,
            scope: "dev" as const,
          }),
        ),
      ],
    };
  } catch (error) {
    log("Error reading package.json: %O", error);
    return {
      name: basename(projectRoot),
      scripts: [],
      dependencies: [],
    };
  }
}

function renderDirectoryStructure(filePaths: string[]): string {
  const root = new Map<string, Map<string, unknown>>();

  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    let node = root;

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const isFile = index === parts.length - 1;

      if (!node.has(part)) {
        node.set(part, isFile ? null : new Map<string, unknown>());
      }

      if (!isFile) {
        node = node.get(part) as Map<string, Map<string, unknown>>;
      }
    }
  }

  const lines: string[] = [];

  const walk = (node: Map<string, unknown>, depth: number) => {
    const entries = [...node.entries()].sort(
      ([leftName, leftValue], [rightName, rightValue]) => {
        const leftDir = leftValue instanceof Map;
        const rightDir = rightValue instanceof Map;
        if (leftDir !== rightDir) return leftDir ? -1 : 1;
        return leftName.localeCompare(rightName);
      },
    );

    for (const [name, value] of entries) {
      const indent = "  ".repeat(depth);
      if (value instanceof Map) {
        lines.push(`${indent}${name}/`);
        walk(value, depth + 1);
      } else {
        lines.push(`${indent}${name}`);
      }
    }
  };

  walk(root, 0);
  return lines.join("\n");
}

function countDirectories(directoryStructure: string): number {
  return directoryStructure
    .split("\n")
    .filter((line) => line.trim().endsWith("/")).length;
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath).toLowerCase();

  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".md": "markdown",
    ".html": "html",
    ".css": "css",
    ".sh": "shell",
    ".ps1": "powershell",
    ".xml": "xml",
    ".txt": "text",
  };

  if (fileName === "dockerfile") return "dockerfile";
  return map[ext] || ext.replace(/^\./, "") || "text";
}

function detectCategory(filePath: string): FileCategory {
  if (isSourceFile(filePath)) return "source";
  if (
    isDocFile(filePath) ||
    DOC_EXTENSIONS.has(extname(filePath).toLowerCase())
  ) {
    return "documentation";
  }
  if (isConfigFile(filePath)) return "config";
  return "other";
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function isBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (let index = 0; index < bytesRead; index++) {
      if (buffer[index] === 0) {
        return true;
      }
    }
    return false;
  } finally {
    await handle.close();
  }
}

function truncateUtf8Content(content: string, maxBytes: number): string {
  const buffer = Buffer.from(content, "utf-8");
  const truncated = buffer.subarray(0, maxBytes).toString("utf-8");
  return `${truncated}\n\n[... truncated after ${maxBytes} bytes for context output ...]`;
}

function truncateWithNotice(
  content: string,
  maxChars: number,
  label: string,
): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[... ${label} truncated after ${maxChars} characters ...]`;
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function splitOutputPath(outputPath: string): { base: string; ext: string } {
  const ext = extname(outputPath) || ".xml";
  return {
    base: outputPath.slice(0, outputPath.length - ext.length),
    ext,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeAttribute(value: string): string {
  return escapeXml(value);
}

function escapeCdata(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>");
}
