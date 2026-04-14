/**
 * Local Context Middleware — environment awareness bootstrap.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Executables not installed/in PATH account for 24.1% of all command
 *  failures. LocalContextMiddleware maps the working directory, discovers
 *  installed tools, and injects this as context. Reduces discovery errors."
 *
 * This middleware gathers environment context BEFORE the agent's first action:
 * - Working directory contents (tree structure)
 * - Package manager and dependencies (package.json, Cargo.toml, etc.)
 * - Available CLI tools (node, python, git, docker, etc.)
 * - Git status and recent commits
 * - Language runtimes and versions
 * - Project type detection
 *
 * The context is injected into the system prompt so the agent starts
 * with full awareness of its environment. This is provider-agnostic.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface LocalContext {
  readonly workingDir: string;
  readonly projectType: ProjectType;
  readonly packageManager: string | null;
  readonly languages: readonly string[];
  readonly tools: readonly ToolInfo[];
  readonly gitStatus: string | null;
  readonly recentCommits: readonly string[];
  readonly directoryTree: string;
  readonly dependencies: readonly string[];
}

export type ProjectType =
  | "typescript" | "javascript" | "python" | "rust"
  | "go" | "java" | "csharp" | "ruby" | "php"
  | "mixed" | "unknown";

export interface ToolInfo {
  readonly name: string;
  readonly version: string;
  readonly available: boolean;
}

/**
 * Gather comprehensive local context about the working environment.
 * Call this once at session start or when the working directory changes.
 */
export function gatherLocalContext(workingDir: string): LocalContext {
  const projectType = detectProjectType(workingDir);
  const packageManager = detectPackageManager(workingDir);
  const languages = detectLanguages(workingDir);
  const tools = detectTools();
  const gitStatus = getGitStatus(workingDir);
  const recentCommits = getRecentCommits(workingDir);
  const directoryTree = getDirectoryTree(workingDir);
  const dependencies = getDependencies(workingDir);

  return {
    workingDir,
    projectType,
    packageManager,
    languages,
    tools,
    gitStatus,
    recentCommits,
    directoryTree,
    dependencies,
  };
}

/**
 * Format local context as a concise string for system prompt injection.
 * Kept under 2000 tokens to avoid context bloat.
 */
export function formatContextForPrompt(ctx: LocalContext): string {
  const sections: string[] = [];

  sections.push(`Working directory: ${ctx.workingDir}`);
  sections.push(`Project: ${ctx.projectType} | Package manager: ${ctx.packageManager ?? "none"}`);

  if (ctx.languages.length > 0) {
    sections.push(`Languages: ${ctx.languages.join(", ")}`);
  }

  const availableTools = ctx.tools.filter((t) => t.available);
  if (availableTools.length > 0) {
    sections.push(`Available tools: ${availableTools.map((t) => `${t.name} (${t.version})`).join(", ")}`);
  }

  if (ctx.gitStatus) {
    sections.push(`Git status: ${ctx.gitStatus.slice(0, 300)}`);
  }

  if (ctx.recentCommits.length > 0) {
    sections.push(`Recent commits:\n${ctx.recentCommits.slice(0, 5).join("\n")}`);
  }

  if (ctx.directoryTree) {
    sections.push(`Directory structure:\n${ctx.directoryTree.slice(0, 1000)}`);
  }

  return sections.join("\n\n");
}

// ── Detection Helpers ──────────────────────────────────────

function detectProjectType(dir: string): ProjectType {
  if (existsSync(join(dir, "tsconfig.json"))) return "typescript";
  if (existsSync(join(dir, "package.json"))) return "javascript";
  if (existsSync(join(dir, "Cargo.toml"))) return "rust";
  if (existsSync(join(dir, "go.mod"))) return "go";
  if (existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, "setup.py"))) return "python";
  if (existsSync(join(dir, "pom.xml")) || existsSync(join(dir, "build.gradle"))) return "java";
  if (existsSync(join(dir, "Gemfile"))) return "ruby";
  if (existsSync(join(dir, "composer.json"))) return "php";

  // Check for mixed project
  const files = safeReaddir(dir);
  const exts = new Set(files.map((f) => f.split(".").pop()).filter(Boolean));
  if (exts.has("ts") && exts.has("py")) return "mixed";
  if (exts.has("ts") || exts.has("tsx")) return "typescript";
  if (exts.has("js") || exts.has("jsx")) return "javascript";
  if (exts.has("py")) return "python";
  if (exts.has("rs")) return "rust";
  if (exts.has("go")) return "go";

  return "unknown";
}

function detectPackageManager(dir: string): string | null {
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "package-lock.json"))) return "npm";
  if (existsSync(join(dir, "Cargo.lock"))) return "cargo";
  if (existsSync(join(dir, "poetry.lock"))) return "poetry";
  if (existsSync(join(dir, "uv.lock"))) return "uv";
  if (existsSync(join(dir, "go.sum"))) return "go";
  if (existsSync(join(dir, "Gemfile.lock"))) return "bundler";
  return null;
}

function detectLanguages(dir: string): readonly string[] {
  const langs: string[] = [];
  if (existsSync(join(dir, "tsconfig.json"))) langs.push("TypeScript");
  if (existsSync(join(dir, "package.json"))) langs.push("JavaScript");
  if (existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, "requirements.txt"))) langs.push("Python");
  if (existsSync(join(dir, "Cargo.toml"))) langs.push("Rust");
  if (existsSync(join(dir, "go.mod"))) langs.push("Go");
  return langs;
}

function detectTools(): readonly ToolInfo[] {
  const tools: ToolInfo[] = [];

  const checks: readonly [string, string[]][] = [
    ["node", ["--version"]],
    ["npm", ["--version"]],
    ["git", ["--version"]],
    ["python3", ["--version"]],
    ["docker", ["--version"]],
    ["gh", ["--version"]],
    ["tsc", ["--version"]],
  ];

  for (const [name, args] of checks) {
    try {
      const version = execFileSync(name, args, {
        stdio: "pipe", timeout: 3000, encoding: "utf-8",
      }).trim().split("\n")[0] ?? "";
      tools.push({ name, version, available: true });
    } catch {
      tools.push({ name, version: "", available: false });
    }
  }

  return tools;
}

function getGitStatus(dir: string): string | null {
  try {
    return execFileSync("git", ["status", "--short"], {
      cwd: dir, stdio: "pipe", timeout: 5000, encoding: "utf-8",
    }).trim() || "Clean";
  } catch {
    return null;
  }
}

function getRecentCommits(dir: string): readonly string[] {
  try {
    const log = execFileSync("git", ["log", "--oneline", "-5"], {
      cwd: dir, stdio: "pipe", timeout: 5000, encoding: "utf-8",
    }).trim();
    return log ? log.split("\n") : [];
  } catch {
    return [];
  }
}

function getDirectoryTree(dir: string, maxDepth: number = 2, prefix: string = ""): string {
  const lines: string[] = [];
  const entries = safeReaddir(dir)
    .filter((name) => !name.startsWith(".") && name !== "node_modules" && name !== "dist" && name !== "__pycache__")
    .slice(0, 30); // Limit to prevent context bloat

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = safeStat(fullPath);
    if (!stat) continue;

    if (stat.isDirectory() && maxDepth > 0) {
      lines.push(`${prefix}${entry}/`);
      lines.push(getDirectoryTree(fullPath, maxDepth - 1, prefix + "  "));
    } else if (stat.isFile()) {
      lines.push(`${prefix}${entry}`);
    }
  }

  return lines.join("\n");
}

function getDependencies(dir: string): readonly string[] {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies ?? {}).slice(0, 20);
  } catch {
    return [];
  }
}

function safeReaddir(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
