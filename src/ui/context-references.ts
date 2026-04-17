/**
 * @-reference context injection for the TUI prompt input.
 *
 * Parses, resolves, and expands @-references embedded in user prompts:
 *   @file:path/to/file   — reads file content and injects it
 *   @path/to/file        — shorthand for @file:path/to/file
 *   @url:https://...     — fetches URL content
 *   @git:diff            — injects current git diff
 *   @git:log             — injects recent git log
 *   @memory:query         — searches memory and injects results
 *   @skill:name           — loads and injects a skill's instructions
 *   @context              — injects current context window summary
 *
 * Inspired by Hermes v0.4.0 tab-completable context injection.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join, extname } from "node:path";
import { execFileSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────

export type ReferenceType = "file" | "folder" | "url" | "git" | "memory" | "skill" | "context";

export interface ResolvedReference {
  readonly type: ReferenceType;
  readonly reference: string;
  readonly content: string;
  readonly tokenEstimate: number;
  readonly error?: string;
}

// ── Constants ────────────────────────────────────────────

const REFERENCE_PATTERN =
  /(?:^|\s)@((?:file|folder|url|git|memory|skill|context)(?::[^\s]+)?|[./][^\s]+)/g;

const TYPED_PREFIX_PATTERN = /^(file|folder|url|git|memory|skill|context):(.+)$/;

const REFERENCE_TYPES: readonly ReferenceType[] = [
  "file",
  "url",
  "git",
  "memory",
  "skill",
  "context",
];

const GIT_SUBCOMMANDS: readonly string[] = ["diff", "log", "status", "branch"];

const CHARS_PER_TOKEN = 4;
const MAX_FILE_CHARS = 50_000;
const GIT_LOG_COUNT = 20;

// ── Reference Parsing ────────────────────────────────────

/**
 * Extract all @-references from a prompt string.
 * Returns the raw reference strings (without the leading @).
 */
export function parseReferences(input: string): readonly string[] {
  const matches = [...input.matchAll(REFERENCE_PATTERN)];
  const seen = new Set<string>();
  const refs: string[] = [];

  for (const match of matches) {
    const ref = match[1];
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }

  return refs;
}

// ── Reference Resolution ─────────────────────────────────

/**
 * Classify a raw reference string into its type and argument.
 */
function classifyReference(ref: string): { readonly type: ReferenceType; readonly arg: string } {
  const typedMatch = ref.match(TYPED_PREFIX_PATTERN);
  if (typedMatch) {
    const type = typedMatch[1] as ReferenceType;
    const arg = typedMatch[2] ?? "";
    return { type, arg };
  }

  // Bare @context with no colon
  if (ref === "context") {
    return { type: "context", arg: "" };
  }

  // Bare path starting with . or /
  if (ref.startsWith(".") || ref.startsWith("/")) {
    return { type: "file", arg: ref };
  }

  // Fallback: treat as file
  return { type: "file", arg: ref };
}

/**
 * Resolve a file reference to its content.
 */
function resolveFile(arg: string, workingDir: string): ResolvedReference {
  const absolutePath = resolve(workingDir, arg);

  if (!existsSync(absolutePath)) {
    return {
      type: "file",
      reference: `file:${arg}`,
      content: "",
      tokenEstimate: 0,
      error: `File not found: ${arg}`,
    };
  }

  try {
    const raw = readFileSync(absolutePath, "utf-8");
    const truncated = raw.length > MAX_FILE_CHARS;
    const content = truncated
      ? `${raw.slice(0, MAX_FILE_CHARS)}\n...[truncated at ${MAX_FILE_CHARS} chars]`
      : raw;

    return {
      type: "file",
      reference: `file:${arg}`,
      content,
      tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
    };
  } catch (err) {
    return {
      type: "file",
      reference: `file:${arg}`,
      content: "",
      tokenEstimate: 0,
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Resolve a @folder: reference by reading all files in a directory recursively.
 * Reads up to 20 files, each up to 200 lines, to prevent context explosion.
 */
function resolveFolder(arg: string, workingDir: string): ResolvedReference {
  const folderPath = resolve(workingDir, arg);

  if (!existsSync(folderPath)) {
    return {
      type: "folder",
      reference: `@folder:${arg}`,
      content: "",
      tokenEstimate: 0,
      error: `Folder not found: ${arg}`,
    };
  }

  try {
    const MAX_FILES = 20;
    const MAX_LINES_PER_FILE = 200;
    const files: string[] = [];

    function collectFiles(dir: string): void {
      if (files.length >= MAX_FILES) return;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break;
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          collectFiles(fullPath);
        } else if (stat.isFile()) {
          const ext = extname(entry);
          if (
            [
              ".ts",
              ".tsx",
              ".js",
              ".jsx",
              ".py",
              ".rs",
              ".go",
              ".java",
              ".md",
              ".json",
              ".yaml",
              ".yml",
              ".toml",
            ].includes(ext)
          ) {
            files.push(fullPath);
          }
        }
      }
    }

    collectFiles(folderPath);

    const parts: string[] = [`# @folder:${arg} (${files.length} files)\n`];
    for (const file of files) {
      const relPath = relative(workingDir, file);
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n").slice(0, MAX_LINES_PER_FILE);
      const truncated =
        lines.length < content.split("\n").length
          ? `\n... (truncated at ${MAX_LINES_PER_FILE} lines)`
          : "";
      parts.push(`## ${relPath}\n\`\`\`\n${lines.join("\n")}${truncated}\n\`\`\`\n`);
    }

    const fullContent = parts.join("\n");
    return {
      type: "folder",
      reference: `@folder:${arg}`,
      content: fullContent,
      tokenEstimate: Math.ceil(fullContent.length / 4),
    };
  } catch (err) {
    return {
      type: "folder",
      reference: `@folder:${arg}`,
      content: "",
      tokenEstimate: 0,
      error: `Failed to read folder: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Resolve a URL reference by fetching the URL and extracting a title/preview.
 * Falls back to using the URL itself as the reference text on failure.
 */
async function resolveUrl(arg: string): Promise<ResolvedReference> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(arg, {
      signal: controller.signal,
      headers: { "User-Agent": "WOTANN/1.0" },
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const content = `[URL ${arg} returned status ${response.status}]`;
      return {
        type: "url",
        reference: `url:${arg}`,
        content,
        tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/json")
    ) {
      const content = `[URL ${arg}: binary content (${contentType})]`;
      return {
        type: "url",
        reference: `url:${arg}`,
        content,
        tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
      };
    }

    const body = await response.text();
    const truncatedBody =
      body.length > MAX_FILE_CHARS
        ? `${body.slice(0, MAX_FILE_CHARS)}\n...[truncated at ${MAX_FILE_CHARS} chars]`
        : body;

    // Extract <title> if HTML
    const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? arg;

    const content = `# ${title}\nSource: ${arg}\n\n${truncatedBody}`;
    return {
      type: "url",
      reference: `url:${arg}`,
      content,
      tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
    };
  } catch (err) {
    // Fall back to the URL itself as reference text
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isAbort = errorMsg.includes("abort");
    const content = `[URL: ${arg}]${isAbort ? " (request timed out)" : ""}`;
    return {
      type: "url",
      reference: `url:${arg}`,
      content,
      tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
      error: isAbort ? "Request timed out after 10s" : `Fetch failed: ${errorMsg}`,
    };
  }
}

/**
 * Resolve a git reference (diff, log, status, branch).
 */
function resolveGit(arg: string, workingDir: string): ResolvedReference {
  const subcommand = arg.toLowerCase();

  const gitArgs: Record<string, readonly string[]> = {
    diff: ["diff", "--no-color", "--unified=3"],
    log: ["log", "--oneline", `-${GIT_LOG_COUNT}`],
    status: ["status", "--porcelain"],
    branch: ["branch", "--no-color"],
  };

  const args = gitArgs[subcommand];
  if (!args) {
    return {
      type: "git",
      reference: `git:${arg}`,
      content: "",
      tokenEstimate: 0,
      error: `Unknown git subcommand: ${arg}. Available: ${GIT_SUBCOMMANDS.join(", ")}`,
    };
  }

  try {
    const output = execFileSync("git", [...args], {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });

    const content = output.trim() || `(no output from git ${subcommand})`;
    return {
      type: "git",
      reference: `git:${arg}`,
      content,
      tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
    };
  } catch (err) {
    return {
      type: "git",
      reference: `git:${arg}`,
      content: "",
      tokenEstimate: 0,
      error: `git ${subcommand} failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Memory search resolver options — the runtime's searchMemory is injected
 * via resolveReferences' optional runtime parameter.
 */
export interface MemorySearchFn {
  (query: string): readonly {
    readonly id: string;
    readonly score: number;
    readonly text: string;
    readonly type: string;
  }[];
}

/**
 * Resolve a memory search reference using the runtime's searchMemory function.
 * Falls back to an informational message when no runtime is available.
 */
function resolveMemory(query: string, searchMemory?: MemorySearchFn): ResolvedReference {
  if (!searchMemory) {
    const content = `[Memory search unavailable — WotannRuntime required for @memory queries]`;
    return {
      type: "memory",
      reference: `memory:${query}`,
      content,
      tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
      error: "No runtime searchMemory function provided",
    };
  }

  try {
    const results = searchMemory(query);
    if (results.length === 0) {
      const content = `[Memory search: no results for "${query}"]`;
      return {
        type: "memory",
        reference: `memory:${query}`,
        content,
        tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
      };
    }

    const formatted = results
      .slice(0, 10)
      .map(
        (r, i) =>
          `${i + 1}. [${r.type}] (score: ${r.score.toFixed(3)})\n   ${r.text.slice(0, 200)}${r.text.length > 200 ? "..." : ""}`,
      )
      .join("\n\n");

    const content = `Memory search results for "${query}" (${results.length} found):\n\n${formatted}`;
    return {
      type: "memory",
      reference: `memory:${query}`,
      content,
      tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
    };
  } catch (err) {
    const content = `[Memory search error for "${query}"]`;
    return {
      type: "memory",
      reference: `memory:${query}`,
      content,
      tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
      error: `Memory search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Resolve a skill reference by looking for SKILL.md files in the
 * project skills/ directory and common skill locations.
 */
function resolveSkill(name: string, workingDir: string): ResolvedReference {
  const candidates = [
    join(workingDir, "skills", name, "SKILL.md"),
    join(workingDir, "skills", `${name}.md`),
    join(workingDir, ".claude", "skills", name, "SKILL.md"),
    join(workingDir, ".claude", "skills", `${name}.md`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, "utf-8");
        return {
          type: "skill",
          reference: `skill:${name}`,
          content,
          tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
        };
      } catch {
        // Try next candidate
      }
    }
  }

  return {
    type: "skill",
    reference: `skill:${name}`,
    content: "",
    tokenEstimate: 0,
    error: `Skill not found: ${name}`,
  };
}

/**
 * Resolve @context — injects a summary of the current context window.
 * Stubbed since the actual context state is managed by the runtime.
 */
function resolveContext(): ResolvedReference {
  const content = "[Current context window summary would be injected]";
  return {
    type: "context",
    reference: "context",
    content,
    tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
  };
}

/**
 * Resolve an array of raw reference strings into their content.
 * Accepts an optional searchMemory function for @memory: resolution.
 */
export async function resolveReferences(
  references: readonly string[],
  workingDir: string,
  searchMemory?: MemorySearchFn,
): Promise<readonly ResolvedReference[]> {
  const promises = references.map((ref) => {
    const { type, arg } = classifyReference(ref);

    switch (type) {
      case "file":
        return Promise.resolve(resolveFile(arg, workingDir));
      case "folder":
        return Promise.resolve(resolveFolder(arg, workingDir));
      case "url":
        return resolveUrl(arg);
      case "git":
        return Promise.resolve(resolveGit(arg, workingDir));
      case "memory":
        return Promise.resolve(resolveMemory(arg, searchMemory));
      case "skill":
        return Promise.resolve(resolveSkill(arg, workingDir));
      case "context":
        return Promise.resolve(resolveContext());
    }
  });

  return Promise.all(promises);
}

// ── Prompt Expansion ─────────────────────────────────────

/**
 * Expand a user prompt by appending resolved reference content.
 * Inline references are kept in the prompt text; resolved content
 * is appended as labeled blocks at the end.
 */
export function expandPromptWithReferences(
  input: string,
  resolved: readonly ResolvedReference[],
): string {
  if (resolved.length === 0) return input;

  const blocks: string[] = [];

  for (const ref of resolved) {
    if (ref.error) {
      blocks.push(`[Error resolving @${ref.reference}: ${ref.error}]`);
      continue;
    }

    const header = `--- @${ref.reference} (~${ref.tokenEstimate} tokens) ---`;
    blocks.push(`${header}\n${ref.content}`);
  }

  return [input, "", ...blocks].join("\n");
}

// ── Tab Completions ──────────────────────────────────────

/**
 * List files in a directory, returning paths relative to workingDir.
 * Non-recursive; returns only direct children.
 */
function listDirectoryEntries(dir: string, workingDir: string): readonly string[] {
  try {
    if (!existsSync(dir)) return [];

    const entries = readdirSync(dir, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => {
        const full = join(dir, entry.name);
        const rel = relative(workingDir, full);
        return entry.isDirectory() ? `${rel}/` : rel;
      })
      .sort();
  } catch {
    return [];
  }
}

/**
 * List available skills by scanning skill directories.
 */
function listSkills(workingDir: string): readonly string[] {
  const skillDirs = [join(workingDir, "skills"), join(workingDir, ".claude", "skills")];

  const skills = new Set<string>();

  for (const dir of skillDirs) {
    try {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          skills.add(entry.name);
        } else if (entry.isFile() && extname(entry.name) === ".md") {
          skills.add(entry.name.replace(/\.md$/, ""));
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return [...skills].sort();
}

/**
 * Return tab-completion suggestions for a partial @-reference.
 *
 * - `@`       → show all reference types
 * - `@file:`  → list files in working dir
 * - `@file:src/` → list files in src/
 * - `@skill:` → list available skills
 * - `@git:`   → show git subcommands
 */
export function getCompletions(partial: string, workingDir: string): readonly string[] {
  // Must start with @
  if (!partial.startsWith("@")) return [];

  const afterAt = partial.slice(1);

  // Just "@" — show all types
  if (afterAt === "") {
    return REFERENCE_TYPES.map((t) => `@${t}:`);
  }

  // Check if we have a typed prefix
  const colonIndex = afterAt.indexOf(":");
  if (colonIndex === -1) {
    // Partial type name — filter matching types
    return REFERENCE_TYPES.filter((t) => t.startsWith(afterAt)).map((t) => `@${t}:`);
  }

  const type = afterAt.slice(0, colonIndex);
  const arg = afterAt.slice(colonIndex + 1);

  switch (type) {
    case "file": {
      // Resolve the directory part of the partial path
      const dir = arg.includes("/")
        ? resolve(workingDir, arg.slice(0, arg.lastIndexOf("/") + 1))
        : workingDir;

      // `listDirectoryEntries` already returns paths relative to the
      // working directory (e.g. `src/main.ts`, not just `main.ts`), so
      // filtering entries by `arg` as the startsWith pattern correctly
      // narrows to completions that match the already-typed prefix.
      // A prior version computed a separate `prefix` local and dropped
      // it — session-5 audit caught the dead assignment. The simplest
      // fix is to trust the helper's already-prefixed contract.
      const entries = listDirectoryEntries(dir, workingDir);

      return entries.filter((entry) => entry.startsWith(arg)).map((entry) => `@file:${entry}`);
    }

    case "git":
      return GIT_SUBCOMMANDS.filter((cmd) => cmd.startsWith(arg)).map((cmd) => `@git:${cmd}`);

    case "skill": {
      const skills = listSkills(workingDir);
      return skills.filter((s) => s.startsWith(arg)).map((s) => `@skill:${s}`);
    }

    case "memory":
      // Memory completions need runtime context; return empty
      return [];

    case "url":
      // URL completions aren't practical
      return [];

    case "context":
      // No sub-completions for context
      return [];

    default:
      return [];
  }
}
