/**
 * Benchmark Engineering Hooks — techniques that boost model scores on
 * TerminalBench, SWE-bench, and real-world coding tasks.
 *
 * RESEARCH BASIS:
 * - LangChain: +13.7% on Terminal Bench 2.0 (52.8% → 66.5%) from harness alone
 * - SWE-bench: 22-point swing between basic and optimized scaffolds
 * - arxiv 2603.05344: "Building Effective AI Coding Agents for the Terminal"
 * - WarpGrep: +4% SWE-bench via agentic code search
 *
 * These hooks are deterministic guarantees, not prompt suggestions.
 * They fire automatically based on tool use patterns and session state.
 *
 * HOOKS IMPLEMENTED:
 * 1. PreCompletionChecklist — verify before claiming done
 * 2. PerFileEditTracker — detect excessive edits to the same file
 * 3. MandatoryPlanningEnforcement — force planning for complex tasks
 * 4. ToolCallCorrectionHook — auto-fix common tool parameter mistakes
 * 5. EnvironmentBootstrapHook — inject environment context at session start
 * 6. SystemReminderInjector — counteract instruction fade-out
 * 7. FileReadBeforeEditHook — force reading files before editing
 * 8. TruncationDetectionHook — catch truncated tool results
 * 9. MandatoryPlanningGate — BLOCK tool calls until plan exists (hook-enforced)
 * 10. NonInteractiveSuppressor — suppress clarification in non-interactive mode
 */

export interface BenchmarkHookEvent {
  readonly type: "pre-tool" | "post-tool" | "pre-completion" | "session-start" | "turn-start";
  readonly toolName?: string;
  readonly toolArgs?: Record<string, unknown>;
  readonly toolResult?: string;
  readonly prompt?: string;
  readonly turnNumber: number;
  readonly filesEdited: ReadonlySet<string>;
  readonly filesRead: ReadonlySet<string>;
  readonly sessionStarted: number;
}

export interface HookAction {
  readonly action: "allow" | "warn" | "block" | "inject";
  readonly message?: string;
  readonly injection?: string;
}

// ── 1. Pre-Completion Checklist ──────────────────────────────

/**
 * Before claiming work is "done", verify:
 * - All files saved? (no pending edits)
 * - Types correct? (typecheck passed)
 * - Tests pass? (relevant tests ran)
 * - Imports added? (no unresolved imports)
 * - No TODO/FIXME markers in new code
 *
 * This alone contributed +5-8% on LangChain's Terminal Bench improvement.
 */
export function preCompletionChecklist(
  response: string,
  context: { testsRun: boolean; typecheckRun: boolean; filesChanged: readonly string[] },
): HookAction {
  const issues: string[] = [];

  if (context.filesChanged.length > 0 && !context.typecheckRun) {
    issues.push("Typecheck not run after code changes");
  }
  if (context.filesChanged.length > 0 && !context.testsRun) {
    issues.push("Tests not run after code changes");
  }
  if (response.includes("TODO") || response.includes("FIXME")) {
    issues.push("Response contains TODO/FIXME markers");
  }
  if (response.includes("throw new Error(\"Not implemented\")") || response.includes("// stub")) {
    issues.push("Response contains stub implementations");
  }

  if (issues.length > 0) {
    return {
      action: "warn",
      message: `Pre-completion checklist failed:\n${issues.map((i) => `- ${i}`).join("\n")}`,
      injection: `BEFORE responding, verify:\n${issues.map((i) => `- Fix: ${i}`).join("\n")}`,
    };
  }

  return { action: "allow" };
}

// ── 2. Per-File Edit Tracker ─────────────────────────────────

/**
 * Track how many times each file has been edited in this session.
 * If a file is edited 4+ times, it's likely the agent is stuck.
 * Inject a reminder to reconsider the approach.
 *
 * This is the "loop detection with per-file tracking" from LangChain.
 */
export class PerFileEditTracker {
  private editCounts: Map<string, number> = new Map();
  private readonly warnThreshold: number;
  private readonly blockThreshold: number;

  constructor(warnThreshold: number = 4, blockThreshold: number = 8) {
    this.warnThreshold = warnThreshold;
    this.blockThreshold = blockThreshold;
  }

  recordEdit(filePath: string): HookAction {
    const count = (this.editCounts.get(filePath) ?? 0) + 1;
    this.editCounts.set(filePath, count);

    if (count >= this.blockThreshold) {
      return {
        action: "block",
        message: `File ${filePath} edited ${count} times. You're likely stuck. Try a completely different approach or ask for help.`,
      };
    }

    if (count >= this.warnThreshold) {
      return {
        action: "warn",
        message: `File ${filePath} edited ${count} times. Consider reconsidering your approach.`,
        injection: `WARNING: You've edited ${filePath} ${count} times. This suggests your current approach may not be working. Consider:\n1. Reading the file from scratch to understand the full context\n2. Trying a completely different approach\n3. Checking if there's an upstream dependency causing the issue`,
      };
    }

    return { action: "allow" };
  }

  getEditCount(filePath: string): number {
    return this.editCounts.get(filePath) ?? 0;
  }

  getMostEdited(): readonly { file: string; count: number }[] {
    return [...this.editCounts.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count);
  }

  reset(): void {
    this.editCounts.clear();
  }

  getTotalEdits(): number {
    let total = 0;
    for (const count of this.editCounts.values()) total += count;
    return total;
  }
}

// ── 3. Mandatory Planning Enforcement ────────────────────────

/**
 * For complex tasks (multi-file, refactoring, new features), force the model
 * to create a plan before executing. Models that plan score 15-30% higher.
 *
 * Triggers when:
 * - Task mentions multiple files
 * - Task is a refactoring/migration
 * - Task involves architecture decisions
 * - Task is > 100 tokens
 */
export function enforcePlanning(
  prompt: string,
  context: { hasPlan: boolean; turnNumber: number },
): HookAction {
  if (context.hasPlan) return { action: "allow" };
  if (context.turnNumber > 1) return { action: "allow" }; // Only enforce on first turn

  const complexity = assessTaskComplexity(prompt);
  if (complexity < 3) return { action: "allow" };

  return {
    action: "inject",
    injection: [
      "MANDATORY PLANNING STEP:",
      "Before writing any code, create a brief plan:",
      "1. List all files that need to be read first",
      "2. List all files that need to be created or modified",
      "3. Identify the order of changes (dependencies)",
      "4. Note potential risks or edge cases",
      "5. Then execute the plan step by step",
      "",
      "This planning step is REQUIRED for tasks of this complexity.",
    ].join("\n"),
  };
}

// ── 4. Tool Call Correction ──────────────────────────────────

/**
 * Auto-correct common tool call parameter mistakes.
 * Models often misname parameters or use wrong types.
 *
 * Common corrections:
 * - path → file_path
 * - text → content
 * - cmd → command
 * - relative paths → absolute paths
 * - missing required parameters → inject defaults
 */
export function correctToolCall(
  toolName: string,
  args: Record<string, unknown>,
  workingDir: string,
): { corrected: Record<string, unknown>; corrections: readonly string[] } {
  const corrected = { ...args };
  const corrections: string[] = [];

  // Path normalization
  if (corrected["path"] && !corrected["file_path"]) {
    corrected["file_path"] = corrected["path"];
    delete corrected["path"];
    corrections.push("Renamed 'path' to 'file_path'");
  }
  if (corrected["filename"] && !corrected["file_path"]) {
    corrected["file_path"] = corrected["filename"];
    delete corrected["filename"];
    corrections.push("Renamed 'filename' to 'file_path'");
  }

  // Relative to absolute path
  if (typeof corrected["file_path"] === "string" && !corrected["file_path"].startsWith("/")) {
    corrected["file_path"] = `${workingDir}/${corrected["file_path"]}`;
    corrections.push("Converted relative path to absolute");
  }

  // Content normalization
  if (toolName === "Write" || toolName === "Edit") {
    if (corrected["text"] && !corrected["content"]) {
      corrected["content"] = corrected["text"];
      delete corrected["text"];
      corrections.push("Renamed 'text' to 'content'");
    }
    if (corrected["code"] && !corrected["content"]) {
      corrected["content"] = corrected["code"];
      delete corrected["code"];
      corrections.push("Renamed 'code' to 'content'");
    }
  }

  // Command normalization
  if (toolName === "Bash") {
    if (corrected["cmd"] && !corrected["command"]) {
      corrected["command"] = corrected["cmd"];
      delete corrected["cmd"];
      corrections.push("Renamed 'cmd' to 'command'");
    }
  }

  // Grep normalization
  if (toolName === "Grep") {
    if (corrected["regex"] && !corrected["pattern"]) {
      corrected["pattern"] = corrected["regex"];
      delete corrected["regex"];
      corrections.push("Renamed 'regex' to 'pattern'");
    }
  }

  return { corrected, corrections };
}

// ── 5. Environment Bootstrap ─────────────────────────────────

/**
 * At session start, inject environment context so the model starts
 * with full awareness of the working environment.
 *
 * This prevents the #1 cause of wasted turns: the model not knowing
 * what tools/languages/frameworks are available.
 */
export function generateEnvironmentBootstrap(env: {
  workingDir: string;
  nodeVersion?: string;
  pythonVersion?: string;
  gitBranch?: string;
  packageManager?: string;
  testFramework?: string;
  hasTypeScript?: boolean;
  framework?: string;
}): string {
  const lines: string[] = ["## Environment Context"];

  lines.push(`Working directory: ${env.workingDir}`);
  if (env.nodeVersion) lines.push(`Node.js: ${env.nodeVersion}`);
  if (env.pythonVersion) lines.push(`Python: ${env.pythonVersion}`);
  if (env.gitBranch) lines.push(`Git branch: ${env.gitBranch}`);
  if (env.packageManager) lines.push(`Package manager: ${env.packageManager}`);
  if (env.testFramework) lines.push(`Test framework: ${env.testFramework}`);
  if (env.hasTypeScript) lines.push("TypeScript: enabled (strict mode)");
  if (env.framework) lines.push(`Framework: ${env.framework}`);

  return lines.join("\n");
}

// ── 6. File Read Before Edit Enforcement ─────────────────────

/**
 * Enforce that files must be read before they are edited.
 * The #1 error in AI coding: editing a file without reading it first,
 * leading to wrong assumptions about the current state.
 */
export function enforceReadBeforeEdit(
  toolName: string,
  filePath: string,
  filesRead: ReadonlySet<string>,
): HookAction {
  if (toolName !== "Edit" && toolName !== "Write") return { action: "allow" };
  if (toolName === "Write") return { action: "allow" }; // Write creates new files

  if (!filesRead.has(filePath)) {
    return {
      action: "warn",
      message: `Attempting to edit ${filePath} without reading it first. Read the file before editing to avoid wrong assumptions.`,
      injection: `IMPORTANT: You're about to edit ${filePath} but haven't read it yet. Read the full file first to understand its current state before making changes.`,
    };
  }

  return { action: "allow" };
}

// ── 7. Truncation Detection ──────────────────────────────────

/**
 * Detect when tool results appear to be truncated.
 * Common patterns:
 * - Results end with "..." or "[truncated]"
 * - Search results seem suspiciously few
 * - File read is much shorter than expected
 *
 * When detected, suggest re-running with narrower scope.
 */
export function detectTruncation(
  toolName: string,
  result: string,
  expectedScope?: { expectedLines?: number; searchPattern?: string },
): HookAction {
  const truncationPatterns = [
    /\.\.\.$/,
    /\[truncated\]/i,
    /\[output truncated\]/i,
    /results? truncated/i,
    /showing first \d+ of \d+/i,
  ];

  const isTruncated = truncationPatterns.some((p) => p.test(result));

  if (isTruncated) {
    return {
      action: "warn",
      message: `Tool result from ${toolName} appears truncated.`,
      injection: `The result from ${toolName} was truncated. Consider:\n1. Narrowing the search scope\n2. Reading a specific section of the file\n3. Using more specific search patterns`,
    };
  }

  // Check for suspiciously short results from search
  if (toolName === "Grep" && expectedScope?.searchPattern) {
    const lineCount = result.split("\n").length;
    if (lineCount <= 1 && result.length > 0) {
      return {
        action: "warn",
        message: "Search returned very few results. Consider broadening the pattern.",
      };
    }
  }

  return { action: "allow" };
}

// ── 9. Mandatory Planning Gate (Hook-Enforced) ──────────────

/**
 * BLOCK all Write/Edit/Bash tool calls until a plan has been created.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Models that plan before coding score 15-30% higher."
 *
 * Unlike enforcePlanning() (which suggests), this is a HARD GATE:
 * - The agent CANNOT write, edit, or run commands until it creates a plan
 * - Plans are detected via planning tool calls (TaskCreate, todo_write, etc.)
 * - Read/Grep/Glob are always allowed (research before planning is fine)
 *
 * This prevents the #1 benchmark failure mode: jumping straight to
 * implementation without understanding the problem.
 */

/** Tools that are always allowed even without a plan (read-only / research). */
const ALWAYS_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "Read", "Glob", "Grep", "LSP", "WebSearch", "WebFetch",
  "TaskCreate", "TodoWrite", "todo_write",
]);

/** Tools that indicate a plan has been created. */
const PLANNING_TOOLS: ReadonlySet<string> = new Set([
  "TaskCreate", "TodoWrite", "todo_write",
]);

/**
 * Patterns in tool output/content that indicate planning activity.
 * Also detects inline plans created via assistant messages.
 */
const PLAN_CONTENT_PATTERNS: readonly RegExp[] = [
  /^#+\s*(?:Plan|Implementation Plan|Steps|Approach|Strategy)\b/im,
  /^\s*(?:\d+\.|[-*])\s+.+\n\s*(?:\d+\.|[-*])\s+.+/m, // Numbered or bulleted list (2+ items)
  /\bstep\s+\d+\b.*\bstep\s+\d+\b/is, // "Step 1 ... Step 2"
];

export class MandatoryPlanningGate {
  private planCreated = false;
  private blockedAttempts = 0;

  /**
   * Check if a tool call should be allowed.
   * Returns a HookAction with "block" if no plan exists and the tool requires one.
   */
  checkToolCall(toolName: string, _toolArgs?: Record<string, unknown>): HookAction {
    // Planning tools always allowed and mark the plan as created
    if (PLANNING_TOOLS.has(toolName)) {
      this.planCreated = true;
      return { action: "allow" };
    }

    // Read-only tools always allowed
    if (ALWAYS_ALLOWED_TOOLS.has(toolName)) {
      return { action: "allow" };
    }

    // If plan exists, allow everything
    if (this.planCreated) {
      return { action: "allow" };
    }

    // Block: no plan yet and this is a modifying tool
    this.blockedAttempts++;
    return {
      action: "block",
      message: [
        `BLOCKED: Cannot use ${toolName} before creating a plan.`,
        "You MUST create a plan first using a planning tool (TaskCreate/todo_write).",
        "Steps allowed before planning: Read, Glob, Grep (research the codebase).",
        `This is attempt #${this.blockedAttempts} to bypass planning.`,
        "",
        "Create a plan that covers:",
        "1. Files to read and understand first",
        "2. Files to create or modify",
        "3. Order of changes (dependencies)",
        "4. Verification steps (tests, typecheck)",
      ].join("\n"),
    };
  }

  /**
   * Detect planning activity from assistant message content.
   * Call this when the agent produces a response to check for inline plans.
   */
  detectPlanInContent(content: string): boolean {
    if (this.planCreated) return true;

    const hasInlinePlan = PLAN_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
    if (hasInlinePlan) {
      this.planCreated = true;
    }
    return hasInlinePlan;
  }

  /**
   * Mark the plan as created externally (e.g., from a different hook).
   */
  markPlanCreated(): void {
    this.planCreated = true;
  }

  hasPlan(): boolean {
    return this.planCreated;
  }

  getBlockedAttempts(): number {
    return this.blockedAttempts;
  }

  reset(): void {
    this.planCreated = false;
    this.blockedAttempts = 0;
  }
}

// ── 10. Non-Interactive Suppressor ──────────────────────────

/**
 * Suppress clarification questions in non-interactive mode.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Agents that ask clarification questions during benchmarks waste
 *  turns and score 5-10% lower. Force commitment to best interpretation."
 *
 * When --non-interactive is active (or CI=true, no TTY):
 * - Inject a directive telling the agent NOT to ask questions
 * - Force the agent to commit to its best interpretation
 * - Override clarification middleware results
 *
 * This integrates with the existing non-interactive module at
 * src/intelligence/non-interactive.ts for detection logic.
 */

/**
 * Patterns that indicate the agent is asking a clarification question
 * instead of proceeding with its best interpretation.
 */
const CLARIFICATION_PATTERNS: readonly RegExp[] = [
  /\b(?:would you like|do you want|shall I|should I|did you mean|could you (?:clarify|specify|confirm))\b/i,
  /\b(?:which (?:one|approach|option)|what (?:do you|would you))\b/i,
  /\b(?:before I (?:proceed|continue|start)|I (?:have|need) (?:a |some )?(?:question|clarification))\b/i,
  /\b(?:can you (?:provide|specify|confirm|clarify))\b/i,
  /\b(?:I'm not sure (?:if|whether|what))\b/i,
  /\?.*\b(?:or|alternatively|prefer)\b.*\?/i, // "X or Y?" pattern
];

/**
 * The system directive injected when non-interactive mode is active.
 * Placed at the tail of context for recency bias.
 */
const NON_INTERACTIVE_DIRECTIVE = [
  "",
  "--- NON-INTERACTIVE MODE ACTIVE ---",
  "You are running in non-interactive mode. There is NO human to answer questions.",
  "DO NOT ask clarification questions. DO NOT present options and ask which to choose.",
  "Instead: commit to your BEST interpretation and proceed with implementation.",
  "If multiple approaches are viable, choose the most common/standard one.",
  "If information is missing, make reasonable assumptions and document them.",
  "Every turn spent asking questions is a turn wasted.",
  "--- END NON-INTERACTIVE DIRECTIVE ---",
].join("\n");

/**
 * Check if the agent's response contains clarification questions.
 * Returns the suppression injection if questions are detected.
 */
export function suppressClarificationQuestions(
  responseText: string,
  isNonInteractive: boolean,
): HookAction {
  if (!isNonInteractive) {
    return { action: "allow" };
  }

  const askingClarification = CLARIFICATION_PATTERNS.some((p) => p.test(responseText));

  if (askingClarification) {
    return {
      action: "inject",
      injection: [
        "STOP: You are asking clarification questions in non-interactive mode.",
        "There is no human to answer. Commit to your best interpretation NOW.",
        "Re-read the task, make reasonable assumptions, and proceed.",
      ].join("\n"),
      message: "Clarification question detected in non-interactive mode. Forcing commitment.",
    };
  }

  return { action: "allow" };
}

/**
 * Get the non-interactive directive for injection at context tail.
 * Returns null if not in non-interactive mode.
 */
export function getNonInteractiveDirective(isNonInteractive: boolean): string | null {
  return isNonInteractive ? NON_INTERACTIVE_DIRECTIVE : null;
}

// ── Helpers ──────────────────────────────────────────────────

function assessTaskComplexity(prompt: string): number {
  let score = 0;

  if (prompt.length > 200) score += 1;
  if (prompt.length > 500) score += 1;
  if (/multiple files|across files|several files/i.test(prompt)) score += 2;
  if (/refactor|redesign|architect|migrate/i.test(prompt)) score += 2;
  if (/new feature|implement|build|create/i.test(prompt)) score += 1;
  if (/test|testing|TDD/i.test(prompt)) score += 1;

  return score;
}
