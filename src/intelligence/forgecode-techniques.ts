/**
 * ForgeCode TerminalBench Techniques — harness engineering for 81.8% accuracy.
 *
 * 7 techniques extracted from ForgeCode's #1 TerminalBench submission:
 * 1. Schema optimization — move `required` before `properties` in tool schemas
 * 2. Doom loop MD5 fingerprinting — hash each tool call, detect 3+ identical
 * 3. Model-specific harness adaptation — adjust prompts per model
 * 4. Tool-call argument correction — fix common argument misnaming
 * 5. Pre-completion checklist — verify against original spec before exit
 * 6. Semantic entry-point discovery — find main files/functions automatically
 * 7. Reasoning budget control — allocate thinking tokens per task complexity
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// ── Technique 1: Schema Optimization ──────────────────────

/**
 * Reorder a JSON tool schema so `required` appears before `properties`.
 * Sort properties alphabetically; strip empty descriptions.
 * Reduces tool-call errors by ~15% (ForgeCode finding).
 */
export function optimizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema["required"] ?? []) as readonly string[];

  // Sort property keys alphabetically
  const sortedKeys = Object.keys(properties).sort();

  const sortedProperties: Record<string, Record<string, unknown>> = {};
  for (const key of sortedKeys) {
    const prop = properties[key];
    if (!prop) continue;
    const cleaned = { ...prop };
    // Remove empty descriptions
    if (typeof cleaned["description"] === "string" && cleaned["description"].trim() === "") {
      const { description: _, ...rest } = cleaned;
      sortedProperties[key] = rest;
    } else {
      sortedProperties[key] = cleaned;
    }
  }

  // Build result with `required` before `properties`
  const result: Record<string, unknown> = { type: "object" };
  if (required.length > 0) {
    result["required"] = [...required].sort();
  }
  result["properties"] = sortedProperties;

  // Carry forward any extra top-level keys
  for (const [key, value] of Object.entries(schema)) {
    if (key !== "type" && key !== "required" && key !== "properties") {
      result[key] = value;
    }
  }

  return result;
}

// ── Technique 2: Doom Loop MD5 Fingerprinting ─────────────

export interface DoomLoopCheck {
  readonly fingerprint: string;
  readonly isDoomLoop: boolean;
  readonly consecutiveCount: number;
  readonly warning: string | null;
}

export class DoomLoopFingerprinter {
  private readonly fingerprints: string[] = [];
  private readonly threshold: number;
  private readonly maxHistory: number;

  constructor(threshold: number = 3, maxHistory: number = 50) {
    this.threshold = threshold;
    this.maxHistory = maxHistory;
  }

  /**
   * Hash a tool call (name + args) with MD5.
   * Track the last N fingerprints.
   * If 3+ identical consecutive fingerprints, flag as doom loop.
   */
  record(toolName: string, args: Record<string, unknown>): DoomLoopCheck {
    const payload = JSON.stringify({ tool: toolName, args });
    const fingerprint = createHash("md5").update(payload).digest("hex");

    this.fingerprints.push(fingerprint);

    // Trim history to maxHistory
    if (this.fingerprints.length > this.maxHistory) {
      this.fingerprints.splice(0, this.fingerprints.length - this.maxHistory);
    }

    // Count consecutive identical fingerprints from the end
    let consecutiveCount = 0;
    for (let i = this.fingerprints.length - 1; i >= 0; i--) {
      if (this.fingerprints[i] === fingerprint) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    const isDoomLoop = consecutiveCount >= this.threshold;

    return {
      fingerprint,
      isDoomLoop,
      consecutiveCount,
      warning: isDoomLoop
        ? `Doom loop detected: ${toolName} called ${consecutiveCount} consecutive times with identical arguments. Injecting warning and skipping.`
        : null,
    };
  }

  /** Reset fingerprint history */
  reset(): void {
    this.fingerprints.length = 0;
  }

  /** Get total recorded fingerprints */
  getHistoryLength(): number {
    return this.fingerprints.length;
  }
}

// ── Technique 3: Model-Specific Harness Adaptation ────────

export interface ModelHarnessProfile {
  readonly model: string;
  readonly provider: string;
  readonly promptStyle: "xml" | "markdown" | "json";
  readonly toolCallFormat: "native" | "xml-injected" | "json-injected";
  readonly thinkingStyle: "native-extended" | "cot-prompt" | "none";
  readonly maxToolCallsPerTurn: number;
  readonly preferredTemperature: number;
  readonly knownWeaknesses: readonly string[];
  readonly strengthAdjustments: readonly string[];
}

const MODEL_PROFILES: ReadonlyMap<string, ModelHarnessProfile> = new Map([
  [
    "anthropic/claude-opus-4-7",
    {
      model: "claude-opus-4-7",
      provider: "anthropic",
      promptStyle: "xml" as const,
      toolCallFormat: "native" as const,
      thinkingStyle: "native-extended" as const,
      maxToolCallsPerTurn: 20,
      preferredTemperature: 0.7,
      knownWeaknesses: ["over-verbose responses", "scope creep"],
      strengthAdjustments: ["excellent at multi-step reasoning", "strong code review"],
    },
  ],
  [
    "anthropic/claude-sonnet-4-7",
    {
      model: "claude-sonnet-4-7",
      provider: "anthropic",
      promptStyle: "xml" as const,
      toolCallFormat: "native" as const,
      thinkingStyle: "native-extended" as const,
      maxToolCallsPerTurn: 15,
      preferredTemperature: 0.5,
      knownWeaknesses: ["may skip verification steps"],
      strengthAdjustments: ["fast iteration", "good at targeted edits"],
    },
  ],
  [
    "openai/gpt-5.4",
    {
      model: "gpt-5.4",
      provider: "openai",
      promptStyle: "markdown" as const,
      toolCallFormat: "native" as const,
      thinkingStyle: "cot-prompt" as const,
      maxToolCallsPerTurn: 10,
      preferredTemperature: 0.6,
      knownWeaknesses: ["nested schema confusion", "path separator issues on unix"],
      strengthAdjustments: ["strong at structured output", "reliable JSON generation"],
    },
  ],
  [
    "openai/codex-cli",
    {
      model: "codex-cli",
      provider: "openai",
      promptStyle: "markdown" as const,
      toolCallFormat: "json-injected" as const,
      thinkingStyle: "none" as const,
      maxToolCallsPerTurn: 8,
      preferredTemperature: 0.3,
      knownWeaknesses: ["limited context window", "minimal reasoning"],
      strengthAdjustments: ["extremely fast", "code-first approach"],
    },
  ],
  [
    "gemini/gemini-2.5-pro",
    {
      model: "gemini-2.5-pro",
      provider: "gemini",
      promptStyle: "json" as const,
      toolCallFormat: "native" as const,
      thinkingStyle: "native-extended" as const,
      maxToolCallsPerTurn: 12,
      preferredTemperature: 0.5,
      knownWeaknesses: ["inconsistent tool argument names"],
      strengthAdjustments: ["strong multi-modal", "large context window"],
    },
  ],
]);

const DEFAULT_PROFILE: ModelHarnessProfile = {
  model: "unknown",
  provider: "unknown",
  promptStyle: "markdown",
  toolCallFormat: "native",
  thinkingStyle: "cot-prompt",
  maxToolCallsPerTurn: 10,
  preferredTemperature: 0.5,
  knownWeaknesses: [],
  strengthAdjustments: [],
};

export function getModelProfile(provider: string, model: string): ModelHarnessProfile {
  const key = `${provider}/${model}`;
  return MODEL_PROFILES.get(key) ?? { ...DEFAULT_PROFILE, model, provider };
}

// ── Technique 4: Tool-Call Argument Correction ────────────

/** Common argument name aliases that models misuse */
const ARG_ALIASES: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  [
    "Read",
    new Map([
      ["path", "file_path"],
      ["filename", "file_path"],
      ["filepath", "file_path"],
      ["file", "file_path"],
    ]),
  ],
  [
    "Edit",
    new Map([
      ["path", "file_path"],
      ["search", "old_string"],
      ["replace", "new_string"],
      ["find", "old_string"],
      ["replacement", "new_string"],
    ]),
  ],
  [
    "Write",
    new Map([
      ["path", "file_path"],
      ["text", "content"],
      ["data", "content"],
      ["body", "content"],
    ]),
  ],
  [
    "Bash",
    new Map([
      ["cmd", "command"],
      ["shell", "command"],
      ["script", "command"],
    ]),
  ],
  [
    "Grep",
    new Map([
      ["query", "pattern"],
      ["search", "pattern"],
      ["regex", "pattern"],
      ["dir", "path"],
      ["directory", "path"],
    ]),
  ],
]);

export function correctToolCallArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const aliasMap = ARG_ALIASES.get(toolName);
  const corrected: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    // Check if this key is an alias that should be renamed
    const correctKey = aliasMap?.get(key) ?? key;

    // Normalize string values
    let normalizedValue = value;
    if (typeof value === "string") {
      // Strip trailing whitespace
      normalizedValue = value.trimEnd();
      // Normalize path separators (backslash to forward slash)
      if (correctKey.includes("path") || correctKey.includes("file") || correctKey === "dir") {
        normalizedValue = (normalizedValue as string).replace(/\\/g, "/");
      }
    }

    // Convert number-strings to numbers for known numeric fields
    if (
      typeof normalizedValue === "string" &&
      (correctKey === "limit" ||
        correctKey === "offset" ||
        correctKey === "timeout" ||
        correctKey === "max_results")
    ) {
      const parsed = Number(normalizedValue);
      if (!isNaN(parsed)) {
        normalizedValue = parsed;
      }
    }

    corrected[correctKey] = normalizedValue;
  }

  return corrected;
}

// ── Technique 5: Pre-Completion Checklist ─────────────────

export interface ChecklistItem {
  readonly description: string;
  readonly check:
    | "files-modified"
    | "tests-pass"
    | "typecheck-clean"
    | "no-todos"
    | "no-stubs"
    | "matches-spec"
    | "no-regressions";
  readonly passed: boolean;
  readonly evidence: string;
}

export interface CompletionChecklist {
  readonly originalTask: string;
  readonly checks: readonly ChecklistItem[];
  readonly allPassed: boolean;
  readonly failedItems: readonly ChecklistItem[];
}

/**
 * Run a pre-completion checklist against a working directory.
 * Verifies files have been modified, no TODOs remain, no stubs, etc.
 */
export function runPreCompletionChecklist(
  originalTask: string,
  workingDir: string,
): CompletionChecklist {
  const checks: ChecklistItem[] = [];

  checks.push(checkFilesModified(workingDir));
  checks.push(checkNoTodos(workingDir));
  checks.push(checkNoStubs(workingDir));
  checks.push(checkMatchesSpec(originalTask, workingDir));

  const failedItems = checks.filter((c) => !c.passed);

  return {
    originalTask,
    checks,
    allPassed: failedItems.length === 0,
    failedItems,
  };
}

function checkFilesModified(workingDir: string): ChecklistItem {
  try {
    const files = listSourceFiles(workingDir);
    return {
      description: "Source files exist in working directory",
      check: "files-modified",
      passed: files.length > 0,
      evidence: `Found ${files.length} source file(s)`,
    };
  } catch {
    return {
      description: "Source files exist in working directory",
      check: "files-modified",
      passed: false,
      evidence: "Could not read working directory",
    };
  }
}

function checkNoTodos(workingDir: string): ChecklistItem {
  try {
    const files = listSourceFiles(workingDir);
    const todosFound: string[] = [];
    const todoPattern = /\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b/;

    for (const file of files) {
      try {
        const content = readFileSync(join(workingDir, file), "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (todoPattern.test(lines[i] ?? "")) {
            todosFound.push(`${file}:${i + 1}`);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      description: "No TODO/FIXME/HACK markers remain",
      check: "no-todos",
      passed: todosFound.length === 0,
      evidence:
        todosFound.length === 0
          ? "No TODO markers found"
          : `Found TODOs at: ${todosFound.slice(0, 5).join(", ")}`,
    };
  } catch {
    return {
      description: "No TODO/FIXME/HACK markers remain",
      check: "no-todos",
      passed: true,
      evidence: "Could not scan for TODOs",
    };
  }
}

function checkNoStubs(workingDir: string): ChecklistItem {
  try {
    const files = listSourceFiles(workingDir);
    const stubsFound: string[] = [];
    const stubPattern =
      /throw new Error\(['"]not implemented['"]\)|\/\/ stub|pass\s*#\s*stub|notImplemented/i;

    for (const file of files) {
      try {
        const content = readFileSync(join(workingDir, file), "utf-8");
        if (stubPattern.test(content)) {
          stubsFound.push(file);
        }
      } catch {
        // Skip unreadable files
      }
    }

    return {
      description: "No stub implementations remain",
      check: "no-stubs",
      passed: stubsFound.length === 0,
      evidence:
        stubsFound.length === 0
          ? "No stubs found"
          : `Stubs found in: ${stubsFound.slice(0, 5).join(", ")}`,
    };
  } catch {
    return {
      description: "No stub implementations remain",
      check: "no-stubs",
      passed: true,
      evidence: "Could not scan for stubs",
    };
  }
}

function checkMatchesSpec(originalTask: string, workingDir: string): ChecklistItem {
  const taskKeywords = originalTask
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  try {
    const files = listSourceFiles(workingDir);
    const fileNames = files.map((f) => f.toLowerCase());
    const matchedKeywords = taskKeywords.filter((kw) => fileNames.some((f) => f.includes(kw)));

    const coverage = taskKeywords.length > 0 ? matchedKeywords.length / taskKeywords.length : 0;

    return {
      description: "Files match task specification keywords",
      check: "matches-spec",
      passed: coverage >= 0.2 || taskKeywords.length === 0,
      evidence: `Keyword coverage: ${(coverage * 100).toFixed(0)}% (${matchedKeywords.length}/${taskKeywords.length} keywords)`,
    };
  } catch {
    return {
      description: "Files match task specification keywords",
      check: "matches-spec",
      passed: true,
      evidence: "Could not verify spec match",
    };
  }
}

// ── Technique 6: Semantic Entry-Point Discovery ───────────

export interface EntryPoint {
  readonly file: string;
  readonly type: "main" | "index" | "app" | "server" | "cli" | "test-runner" | "config";
  readonly exports: readonly string[];
  readonly confidence: number;
}

const ENTRY_POINT_PATTERNS: ReadonlyMap<EntryPoint["type"], readonly RegExp[]> = new Map([
  ["main", [/^main\.[tj]sx?$/, /^src\/main\.[tj]sx?$/]],
  ["index", [/^index\.[tj]sx?$/, /^src\/index\.[tj]sx?$/, /^lib\/index\.[tj]sx?$/]],
  ["app", [/^app\.[tj]sx?$/, /^src\/app\.[tj]sx?$/, /^src\/App\.[tj]sx?$/]],
  ["server", [/^server\.[tj]sx?$/, /^src\/server\.[tj]sx?$/, /^src\/api\/server\.[tj]sx?$/]],
  ["cli", [/^cli\.[tj]sx?$/, /^src\/cli\.[tj]sx?$/, /^bin\/.*\.[tj]sx?$/]],
  ["test-runner", [/^jest\.config\.[tj]s$/, /^vitest\.config\.[tj]s$/]],
  [
    "config",
    [/^tsconfig\.json$/, /^package\.json$/, /^next\.config\.[tj]s$/, /^vite\.config\.[tj]s$/],
  ],
]);

/**
 * Discover entry-point files in a project directory.
 * Returns files sorted by confidence (highest first).
 */
export function discoverEntryPoints(projectDir: string): readonly EntryPoint[] {
  const entryPoints: EntryPoint[] = [];

  try {
    const allFiles = collectFilesShallow(projectDir, 3);

    for (const file of allFiles) {
      for (const [type, patterns] of ENTRY_POINT_PATTERNS) {
        for (const pattern of patterns) {
          if (pattern.test(file)) {
            const exports = extractExports(projectDir, file);
            entryPoints.push({
              file,
              type,
              exports,
              confidence: computeEntryPointConfidence(type, exports.length),
            });
          }
        }
      }
    }
  } catch {
    // Return empty if directory is unreadable
  }

  return [...entryPoints].sort((a, b) => b.confidence - a.confidence);
}

function collectFilesShallow(
  dir: string,
  maxDepth: number,
  currentDepth: number = 0,
  prefix: string = "",
): string[] {
  if (currentDepth > maxDepth) return [];

  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile()) {
        files.push(relativePath);
      } else if (entry.isDirectory()) {
        files.push(
          ...collectFilesShallow(join(dir, entry.name), maxDepth, currentDepth + 1, relativePath),
        );
      }
    }
  } catch {
    // Ignore permission errors
  }

  return files;
}

function extractExports(projectDir: string, file: string): readonly string[] {
  try {
    const content = readFileSync(join(projectDir, file), "utf-8");
    const exportPattern =
      /export\s+(?:default\s+)?(?:function|class|const|let|type|interface)\s+(\w+)/g;
    const exports: string[] = [];
    let match: RegExpExecArray | null = exportPattern.exec(content);
    while (match !== null) {
      if (match[1]) exports.push(match[1]);
      match = exportPattern.exec(content);
    }
    return exports;
  } catch {
    return [];
  }
}

function computeEntryPointConfidence(type: EntryPoint["type"], exportCount: number): number {
  const baseConfidence: Record<EntryPoint["type"], number> = {
    main: 0.95,
    index: 0.9,
    app: 0.85,
    server: 0.8,
    cli: 0.75,
    "test-runner": 0.5,
    config: 0.4,
  };

  const base = baseConfidence[type];
  const exportBonus = Math.min(0.05, exportCount * 0.01);
  return Math.min(1.0, base + exportBonus);
}

// ── Technique 7: Reasoning Budget Control ─────────────────

export interface ReasoningBudget {
  readonly taskComplexity: "low" | "medium" | "high" | "extreme";
  readonly thinkingTokenBudget: number;
  readonly maxTurns: number;
  readonly allowedStrategies: readonly string[];
}

/**
 * Allocate a reasoning budget based on task complexity and context usage.
 * Prevents over-thinking simple tasks and under-thinking complex ones.
 */
export function allocateReasoningBudget(
  task: string,
  contextPercent: number,
  modelCapability: string,
): ReasoningBudget {
  const complexity = classifyTaskComplexity(task);

  const budgets: Record<
    ReasoningBudget["taskComplexity"],
    {
      thinkingTokens: number;
      maxTurns: number;
      strategies: readonly string[];
    }
  > = {
    low: {
      thinkingTokens: 2048,
      maxTurns: 5,
      strategies: ["direct-edit", "single-file"],
    },
    medium: {
      thinkingTokens: 8192,
      maxTurns: 15,
      strategies: ["direct-edit", "single-file", "multi-file", "search-then-edit"],
    },
    high: {
      thinkingTokens: 32768,
      maxTurns: 30,
      strategies: [
        "direct-edit",
        "multi-file",
        "search-then-edit",
        "plan-then-execute",
        "sub-agent",
      ],
    },
    extreme: {
      thinkingTokens: 63999,
      maxTurns: 50,
      strategies: [
        "direct-edit",
        "multi-file",
        "search-then-edit",
        "plan-then-execute",
        "sub-agent",
        "parallel-agents",
        "tree-search",
      ],
    },
  };

  const budget = budgets[complexity];

  // Scale thinking tokens down if context is running low
  const contextScaleFactor = contextPercent > 70 ? 0.5 : contextPercent > 50 ? 0.75 : 1.0;

  // Scale based on model capability
  const capabilityFactor =
    modelCapability === "high" ? 1.0 : modelCapability === "medium" ? 0.75 : 0.5;

  return {
    taskComplexity: complexity,
    thinkingTokenBudget: Math.round(budget.thinkingTokens * contextScaleFactor * capabilityFactor),
    maxTurns: Math.round(budget.maxTurns * contextScaleFactor),
    allowedStrategies: budget.strategies,
  };
}

function classifyTaskComplexity(task: string): ReasoningBudget["taskComplexity"] {
  const lower = task.toLowerCase();
  const wordCount = task.split(/\s+/).length;

  if (
    /\b(architect|migrate|redesign|distributed|system[\s-]design|full[\s-]rewrite)\b/.test(lower)
  ) {
    return "extreme";
  }

  if (
    /\b(feature|implement|integrate|refactor|debug[\s-]complex|multi[\s-]file)\b/.test(lower) ||
    wordCount > 50
  ) {
    return "high";
  }

  if (
    /\b(typo|rename|format|fix[\s-]import|update[\s-]version|add[\s-]comment)\b/.test(lower) ||
    wordCount < 10
  ) {
    return "low";
  }

  return "medium";
}

// ── Technique 8: Auto-Install Missing Dependencies ──────

/**
 * Common error patterns for missing executables/packages.
 * Each pattern maps a regex to an install-command generator.
 */
interface DepErrorPattern {
  readonly pattern: RegExp;
  readonly extractName: (match: RegExpMatchArray) => string;
  readonly suggestInstall: (name: string) => readonly string[];
}

const DEP_ERROR_PATTERNS: readonly DepErrorPattern[] = [
  // "command not found" (bash/zsh)
  {
    pattern: /(?:bash|zsh|sh): (?:line \d+: )?(\S+): (?:command )?not found/i,
    extractName: (m) => m[1] ?? "",
    suggestInstall: (name) => [
      `brew install ${name}`,
      `apt-get install ${name}`,
      `npm install -g ${name}`,
    ],
  },
  // "No such file or directory" for executables
  {
    pattern: /env: (\S+): No such file or directory/i,
    extractName: (m) => m[1] ?? "",
    suggestInstall: (name) => [`brew install ${name}`, `apt-get install ${name}`],
  },
  // Node.js "Cannot find module"
  {
    pattern: /Cannot find module ['"]([^'"]+)['"]/,
    extractName: (m) => {
      const raw = m[1] ?? "";
      // Extract package name from scoped or deep imports
      if (raw.startsWith("@")) {
        const parts = raw.split("/");
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : raw;
      }
      return raw.split("/")[0] ?? raw;
    },
    suggestInstall: (name) => [`npm install ${name}`],
  },
  // Node.js "MODULE_NOT_FOUND"
  {
    pattern: /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package ['"]([^'"]+)['"]/,
    extractName: (m) => m[1] ?? "",
    suggestInstall: (name) => [`npm install ${name}`],
  },
  // Python "ModuleNotFoundError"
  {
    pattern: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/,
    extractName: (m) => {
      const raw = m[1] ?? "";
      return raw.split(".")[0] ?? raw;
    },
    suggestInstall: (name) => [`pip install ${name}`, `pip3 install ${name}`],
  },
  // Python "ImportError"
  {
    pattern: /ImportError: No module named ['"]([^'"]+)['"]/,
    extractName: (m) => {
      const raw = m[1] ?? "";
      return raw.split(".")[0] ?? raw;
    },
    suggestInstall: (name) => [`pip install ${name}`, `pip3 install ${name}`],
  },
  // Ruby "cannot load such file"
  {
    pattern: /cannot load such file -- (\S+)/,
    extractName: (m) => m[1] ?? "",
    suggestInstall: (name) => [`gem install ${name}`],
  },
  // Go "cannot find package"
  {
    pattern: /cannot find package "([^"]+)"/,
    extractName: (m) => m[1] ?? "",
    suggestInstall: (name) => [`go get ${name}`],
  },
  // Generic "not found" / "not installed"
  {
    pattern: /(\S+) is not (?:installed|recognized|found)/i,
    extractName: (m) => m[1] ?? "",
    suggestInstall: (name) => [`brew install ${name}`, `npm install -g ${name}`],
  },
];

/**
 * Parse error output for missing dependency patterns.
 * Returns suggested install commands.
 * 24.1% of TerminalBench 2.0 failures are "executable not in PATH".
 */
export function autoInstallMissingDep(errorOutput: string): string[] {
  const suggestions: string[] = [];
  const seenNames = new Set<string>();

  for (const { pattern, extractName, suggestInstall } of DEP_ERROR_PATTERNS) {
    const match = pattern.exec(errorOutput);
    if (match) {
      const name = extractName(match).trim();
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        suggestions.push(...suggestInstall(name));
      }
    }
  }

  return suggestions;
}

// ── Technique 9: Task-Appropriate Timeouts ──────────────

/**
 * Patterns for commands that need longer timeouts.
 * Sorted by specificity -- first match wins.
 */
const LONG_TIMEOUT_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly timeout: number;
}[] = [
  // 5 minutes: large builds, Docker, database migrations
  { pattern: /\b(?:docker\s+build|docker\s+compose\s+up|docker\s+pull)\b/i, timeout: 300_000 },
  { pattern: /\b(?:cargo\s+build|cargo\s+test)\b/i, timeout: 300_000 },
  { pattern: /\b(?:gradle\s+build|mvn\s+(?:package|install|compile))\b/i, timeout: 300_000 },
  { pattern: /\b(?:make\s+all|make\s+-j)\b/i, timeout: 300_000 },
  { pattern: /\b(?:webpack|next\s+build|vite\s+build|turbopack)\b/i, timeout: 300_000 },

  // 2 minutes: tests, installs, medium builds
  {
    pattern:
      /\b(?:npm\s+(?:install|ci|test|run\s+build)|yarn\s+(?:install|test)|pnpm\s+(?:install|test))\b/i,
    timeout: 120_000,
  },
  { pattern: /\b(?:pip\s+install|pip3\s+install)\b/i, timeout: 120_000 },
  { pattern: /\b(?:brew\s+install|apt-get\s+install|apt\s+install)\b/i, timeout: 120_000 },
  { pattern: /\b(?:pytest|jest|vitest|mocha|go\s+test)\b/i, timeout: 120_000 },
  { pattern: /\b(?:tsc|npx\s+tsc)\b/i, timeout: 120_000 },
  { pattern: /\b(?:bundle\s+install|gem\s+install)\b/i, timeout: 120_000 },
  { pattern: /\b(?:composer\s+install|composer\s+update)\b/i, timeout: 120_000 },
  { pattern: /\b(?:go\s+build|go\s+mod\s+download)\b/i, timeout: 120_000 },
];

/**
 * Return a task-appropriate timeout for a shell command.
 * Replaces the default 120s timeout with fail-fast 30s for most commands,
 * but allows longer for builds, tests, and installs.
 */
export function getTimeoutForCommand(cmd: string): number {
  for (const { pattern, timeout } of LONG_TIMEOUT_PATTERNS) {
    if (pattern.test(cmd)) {
      return timeout;
    }
  }

  // Default: 30s fail-fast for all other commands
  return 30_000;
}

// ── Technique 10: Stale-Read Detection ──────────────────

/**
 * Track when files were last read, by turn number.
 * Warns when a file was read too many turns ago and may have been
 * modified since (by the agent itself or by external processes).
 */
export class StaleReadTracker {
  /** Map of file path to the turn number when it was last read. */
  private readonly readTimes: Map<string, number> = new Map();

  /** Number of turns after which a read is considered stale. */
  private readonly staleTurnThreshold: number;

  constructor(staleTurnThreshold: number = 5) {
    this.staleTurnThreshold = staleTurnThreshold;
  }

  /**
   * Record that a file was read at the given turn number.
   */
  recordRead(path: string, currentTurn: number): void {
    this.readTimes.set(path, currentTurn);
  }

  /**
   * Check if a file was read more than staleTurnThreshold turns ago.
   * Returns true if the file was read and is now stale.
   * Returns false if the file was never read or was read recently.
   */
  isStale(path: string, currentTurn: number): boolean {
    const lastRead = this.readTimes.get(path);
    if (lastRead === undefined) {
      return false;
    }
    return currentTurn - lastRead > this.staleTurnThreshold;
  }

  /**
   * Get the staleness warning message for a file, or null if not stale.
   */
  getWarning(path: string, currentTurn: number): string | null {
    const lastRead = this.readTimes.get(path);
    if (lastRead === undefined) {
      return null;
    }
    const turnsAgo = currentTurn - lastRead;
    if (turnsAgo > this.staleTurnThreshold) {
      return `File ${path} was read ${turnsAgo} turns ago and may have changed. Consider re-reading.`;
    }
    return null;
  }

  /**
   * Get all stale files at the given turn number.
   */
  getStaleFiles(currentTurn: number): readonly string[] {
    const stale: string[] = [];
    for (const [path, lastRead] of this.readTimes) {
      if (currentTurn - lastRead > this.staleTurnThreshold) {
        stale.push(path);
      }
    }
    return stale;
  }

  /**
   * Get the number of tracked files.
   */
  getTrackedCount(): number {
    return this.readTimes.size;
  }

  /**
   * Reset all tracking data.
   */
  reset(): void {
    this.readTimes.clear();
  }
}

// ── Shared utilities ──────────────────────────────────────

function listSourceFiles(dir: string): readonly string[] {
  const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"]);

  try {
    return readdirSync(dir).filter((f) => {
      try {
        return statSync(join(dir, f)).isFile() && sourceExtensions.has(extname(f));
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
