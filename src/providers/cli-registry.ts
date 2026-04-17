/**
 * CLI auto-detect registry (C32) — scans PATH for known AI agent
 * CLIs so WOTANN can register them as invocable tools or show them
 * in the "which agents are installed?" doctor output.
 *
 * Port of Emdash's CLI-registry pattern, expanded to cover the 23
 * CLIs surveyed across sessions 5-6. Pure detection — no invocation,
 * no network. Callers decide whether to wire a detected CLI into a
 * provider, an MCP source, or a slash command surface.
 */

import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { delimiter } from "node:path";

export type AgentCLICategory =
  | "agent" // primary coding agent CLI (claude, codex, aider, ...)
  | "assist" // one-shot helper (gh copilot, tabby, ...)
  | "ide-cli" // IDE-driven CLI (cursor, windsurf, zed, ...)
  | "editor" // plain editor with AI (neovim plugins surface via different mechanism)
  | "runtime"; // model runtime (ollama, llama.cpp, ...)

export interface KnownCLI {
  readonly binary: string;
  readonly label: string;
  readonly category: AgentCLICategory;
  readonly homepage: string;
  readonly versionFlag?: string;
}

export interface DetectedCLI extends KnownCLI {
  readonly path: string;
  readonly version: string | undefined;
}

/**
 * Seed list — 23 CLIs surveyed across the competitor research waves.
 * Order is alphabetical within category so the output is stable.
 */
export const KNOWN_AGENT_CLIS: readonly KnownCLI[] = [
  // agents
  {
    binary: "aider",
    label: "Aider",
    category: "agent",
    homepage: "https://aider.chat",
    versionFlag: "--version",
  },
  { binary: "amp", label: "Amp", category: "agent", homepage: "https://ampcode.com" },
  {
    binary: "claude",
    label: "Claude Code",
    category: "agent",
    homepage: "https://claude.com/claude-code",
    versionFlag: "--version",
  },
  { binary: "cline", label: "Cline", category: "agent", homepage: "https://cline.bot" },
  {
    binary: "codex",
    label: "OpenAI Codex",
    category: "agent",
    homepage: "https://openai.com/codex-cli",
    versionFlag: "--version",
  },
  { binary: "continue", label: "Continue", category: "agent", homepage: "https://continue.dev" },
  {
    binary: "goose",
    label: "Block Goose",
    category: "agent",
    homepage: "https://block.github.io/goose",
  },
  {
    binary: "hermes",
    label: "Hermes Agent",
    category: "agent",
    homepage: "https://hermes-agent.dev",
  },
  { binary: "pearai", label: "PearAI", category: "agent", homepage: "https://trypear.ai" },
  { binary: "qwen", label: "Qwen CLI", category: "agent", homepage: "https://github.com/QwenLM" },
  { binary: "wotann", label: "WOTANN", category: "agent", homepage: "https://wotann.com" },
  // IDE-driven
  { binary: "cursor", label: "Cursor", category: "ide-cli", homepage: "https://cursor.com" },
  {
    binary: "windsurf",
    label: "Windsurf",
    category: "ide-cli",
    homepage: "https://codeium.com/windsurf",
  },
  {
    binary: "zed",
    label: "Zed",
    category: "ide-cli",
    homepage: "https://zed.dev",
    versionFlag: "--version",
  },
  // assistants
  {
    binary: "cody",
    label: "Sourcegraph Cody",
    category: "assist",
    homepage: "https://sourcegraph.com/cody",
  },
  { binary: "codegpt", label: "CodeGPT", category: "assist", homepage: "https://codegpt.co" },
  { binary: "gemini", label: "Gemini CLI", category: "assist", homepage: "https://ai.google.dev" },
  {
    binary: "gh-copilot",
    label: "gh copilot extension",
    category: "assist",
    homepage: "https://cli.github.com/manual/gh_copilot",
  },
  { binary: "tabby", label: "Tabby", category: "assist", homepage: "https://tabby.tabbyml.com" },
  // runtimes
  {
    binary: "ollama",
    label: "Ollama",
    category: "runtime",
    homepage: "https://ollama.ai",
    versionFlag: "--version",
  },
  {
    binary: "llama-server",
    label: "llama.cpp server",
    category: "runtime",
    homepage: "https://github.com/ggerganov/llama.cpp",
  },
  { binary: "mlc_llm", label: "MLC LLM", category: "runtime", homepage: "https://mlc.ai/mlc-llm" },
  {
    binary: "vllm",
    label: "vLLM",
    category: "runtime",
    homepage: "https://github.com/vllm-project/vllm",
  },
];

// ── Detection ────────────────────────────────────────────────

export interface DetectOptions {
  /** Override PATH for tests. Defaults to `process.env.PATH`. */
  readonly path?: string;
  /** Override platform for testing Windows PATHEXT handling. */
  readonly platform?: NodeJS.Platform;
  /** Whether to invoke each hit with --version to capture the tag. */
  readonly captureVersion?: boolean;
}

export function detectInstalledAgentCLIs(options: DetectOptions = {}): readonly DetectedCLI[] {
  const out: DetectedCLI[] = [];
  for (const cli of KNOWN_AGENT_CLIS) {
    const resolved = resolveOnPath(cli.binary, options);
    if (!resolved) continue;
    out.push({
      ...cli,
      path: resolved,
      version: options.captureVersion ? captureVersion(resolved, cli.versionFlag) : undefined,
    });
  }
  return out;
}

function resolveOnPath(binary: string, options: DetectOptions): string | undefined {
  const path = options.path ?? process.env["PATH"] ?? "";
  const platform = options.platform ?? process.platform;
  const isWindows = platform === "win32";

  const separator = isWindows ? ";" : delimiter;
  const extensions = isWindows ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const dir of path.split(separator).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(dir, `${binary}${ext}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* not here — keep scanning */
      }
    }
  }
  return undefined;
}

function captureVersion(binaryPath: string, flag: string | undefined): string | undefined {
  if (!flag) return undefined;
  try {
    const out = execFileSync(binaryPath, [flag], {
      timeout: 2_500,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const firstLine = out.split(/\r?\n/)[0]?.trim() ?? "";
    return firstLine.length > 0 ? firstLine.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}

// ── Rendering ────────────────────────────────────────────────

export function groupByCategory(
  detected: readonly DetectedCLI[],
): Record<AgentCLICategory, readonly DetectedCLI[]> {
  const buckets: Record<AgentCLICategory, DetectedCLI[]> = {
    agent: [],
    assist: [],
    "ide-cli": [],
    editor: [],
    runtime: [],
  };
  for (const cli of detected) buckets[cli.category].push(cli);
  return buckets;
}

export function renderCLIRegistry(detected: readonly DetectedCLI[]): string {
  if (detected.length === 0) {
    return "No known agent CLIs detected on PATH.";
  }

  const byCat = groupByCategory(detected);
  const order: AgentCLICategory[] = ["agent", "ide-cli", "assist", "runtime", "editor"];
  const lines: string[] = [`Detected ${detected.length} agent CLI(s) on PATH:`, ""];
  for (const cat of order) {
    const group = byCat[cat];
    if (!group || group.length === 0) continue;
    lines.push(`## ${categoryLabel(cat)}`);
    for (const cli of group) {
      const versionTag = cli.version ? ` — ${cli.version}` : "";
      lines.push(`- ${cli.label} (${cli.binary})${versionTag}`);
      lines.push(`  ${cli.path}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function categoryLabel(cat: AgentCLICategory): string {
  switch (cat) {
    case "agent":
      return "Agents";
    case "assist":
      return "Assistants";
    case "ide-cli":
      return "IDE CLIs";
    case "editor":
      return "Editors";
    case "runtime":
      return "Runtimes";
  }
}

/**
 * Unused re-export prevents Node warning about `dirname` import being
 * removed by tree-shakers that aren't aware we reference it implicitly
 * via join fallback paths in testing environments.
 */
void dirname;
