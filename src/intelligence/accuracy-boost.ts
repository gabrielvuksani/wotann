/**
 * Accuracy Boost — harness engineering techniques for maximum agent accuracy.
 * Based on TerminalBench and SWE-bench top-performer analysis.
 *
 * Research sources:
 * - ForgeCode (81.8% TermBench 2.0): Schema optimization, doom loop detection,
 *   model-specific harness adaptation, per-file edit tracking
 * - LangChain (+13.7% harness-only): PreCompletionChecklist, LocalContext,
 *   LoopDetection, ReasoningSandwich middleware pipeline
 * - Cursor: Dynamic context discovery, L0/L1/L2 tiered loading, tool output
 *   to files, MCP tool optimization (46.9% token reduction)
 * - arxiv 2603.05344 (OpenDev): Dual-agent architecture, lazy tool discovery,
 *   adaptive context compaction, workload-specialized model routing
 * - SWE-bench Pro: Search subagents (28% time reduction), fresh context per
 *   subagent, scaffolding impact (5% variance from harness alone)
 *
 * Techniques:
 * 1. Structured output enforcement (XML tags for tool calls)
 * 2. Multi-pass verification (verify before marking done)
 * 3. Context relevance scoring (only include relevant context)
 * 4. Error-aware retry (analyze error -> modify approach -> retry)
 * 5. Confidence calibration (ask model to rate its confidence)
 * 6. Step-by-step decomposition (break complex tasks into subtasks)
 * 7. Self-reflection prompts (check own work before submitting)
 * 8. Example-guided execution (include relevant examples in context)
 * 9. Diff validation (verify edits are syntactically valid)
 * 10. Test-driven feedback (run tests after each change, feed results back)
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { basename, dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────

export interface AccuracyContext {
  readonly taskType: TaskType;
  readonly previousErrors: readonly string[];
  readonly previousAttempts: number;
  readonly availableFiles: readonly string[];
  readonly recentToolResults: readonly string[];
  readonly projectRoot?: string;
  readonly testFramework?: string;
  readonly language?: string;
}

export type TaskType =
  | "code-generation"
  | "bug-fix"
  | "refactor"
  | "test-writing"
  | "documentation"
  | "configuration"
  | "investigation"
  | "general";

export interface BoostedQuery {
  readonly original: string;
  readonly boosted: string;
  readonly techniques: readonly AppliedTechnique[];
  readonly decomposedSteps: readonly string[];
  readonly confidencePrompt: string;
  readonly verificationPlan: readonly string[];
}

export interface AppliedTechnique {
  readonly name: string;
  readonly description: string;
  readonly injectedText: string;
}

export interface DiffValidation {
  readonly valid: boolean;
  readonly errors: readonly DiffError[];
  readonly warnings: readonly string[];
}

export interface DiffError {
  readonly line: number;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export interface ScoredContext {
  readonly content: string;
  readonly score: number;
  readonly reason: string;
}

export interface TestDrivenFeedbackResult {
  readonly testsFound: boolean;
  readonly testsRan: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly feedback: string;
}

// ── Technique 1: Structured Output Enforcement ───────────────

const STRUCTURED_OUTPUT_PREAMBLE = `When making tool calls, follow this exact structure:
1. State what you will do and why (one sentence)
2. Make the tool call with all required parameters
3. Verify the result before proceeding

For code edits, always use this format:
- Show the EXACT old text you are replacing (copy from the file)
- Show the EXACT new text (complete, no placeholders)
- Verify the edit is syntactically valid before submitting`;

// ── Technique 5: Confidence Calibration ──────────────────────

const CONFIDENCE_CALIBRATION = `After completing your work, rate your confidence:
- HIGH (>90%): All changes verified, tests pass, types check
- MEDIUM (60-90%): Core logic correct but edge cases may exist
- LOW (<60%): Uncertain about approach or missing context

If your confidence is LOW, explain what additional information you need.
If MEDIUM, list the specific edge cases you are uncertain about.`;

// ── Technique 7: Self-Reflection ───��─────────────────────────

const SELF_REFLECTION_PROMPT = `Before presenting your final answer, verify:
1. Does the solution address the EXACT problem stated?
2. Are ALL edge cases handled (null, empty, boundary values)?
3. Is error handling comprehensive (no silent failures)?
4. Are types correct and consistent throughout?
5. Did you introduce any regressions in existing functionality?
6. Would a senior engineer approve this in code review?

If any answer is "no", fix it before responding.`;

// ── AccuracyBooster ───────────────��──────────────────────────

export class AccuracyBooster {
  /**
   * Apply all applicable accuracy techniques to a query.
   * The techniques selected depend on the task type and context.
   */
  boost(prompt: string, context: AccuracyContext): BoostedQuery {
    const techniques: AppliedTechnique[] = [];
    const sections: string[] = [];

    // Technique 1: Structured output enforcement (always)
    const structuredOutput = this.enforceStructuredOutput(prompt);
    if (structuredOutput !== prompt) {
      techniques.push({
        name: "structured-output",
        description: "Enforce structured tool-call format",
        injectedText: STRUCTURED_OUTPUT_PREAMBLE,
      });
      sections.push(structuredOutput);
    }

    // Technique 4: Error-aware retry
    if (context.previousErrors.length > 0) {
      const errorGuidance = this.buildErrorAwareRetry(context.previousErrors, context.previousAttempts);
      techniques.push({
        name: "error-aware-retry",
        description: "Analyze previous errors and modify approach",
        injectedText: errorGuidance,
      });
      sections.push(errorGuidance);
    }

    // Technique 6: Step-by-step decomposition
    const steps = this.decomposeTask(prompt, context.taskType);
    if (steps.length > 1) {
      const decomposition = this.formatDecomposition(steps);
      techniques.push({
        name: "task-decomposition",
        description: `Break task into ${steps.length} subtasks`,
        injectedText: decomposition,
      });
      sections.push(decomposition);
    }

    // Technique 7: Self-reflection (always for code tasks)
    if (isCodeTask(context.taskType)) {
      const reflection = this.addSelfReflection(prompt);
      if (reflection !== prompt) {
        techniques.push({
          name: "self-reflection",
          description: "Self-check work before submitting",
          injectedText: SELF_REFLECTION_PROMPT,
        });
        sections.push(SELF_REFLECTION_PROMPT);
      }
    }

    // Technique 8: Example-guided execution
    const examples = this.selectRelevantExamples(context.taskType, context.language);
    if (examples.length > 0) {
      const exampleText = this.formatExamples(examples);
      techniques.push({
        name: "example-guided",
        description: "Include relevant execution examples",
        injectedText: exampleText,
      });
      sections.push(exampleText);
    }

    // Technique 5: Confidence calibration
    const confidencePrompt = this.addConfidenceCalibration(prompt);

    // Technique 2: Multi-pass verification plan
    const verificationPlan = this.buildVerificationPlan(context);

    // Build the final boosted query
    const preamble = sections.length > 0 ? sections.join("\n\n") + "\n\n" : "";
    const boosted = preamble + prompt;

    return {
      original: prompt,
      boosted,
      techniques,
      decomposedSteps: steps,
      confidencePrompt: CONFIDENCE_CALIBRATION,
      verificationPlan,
    };
  }

  // ── Individual Techniques ────────────────────────────────

  /**
   * Technique 1: Enforce structured output format.
   * Returns the prompt with structured output instructions prepended.
   */
  enforceStructuredOutput(prompt: string): string {
    if (prompt.length < 30) return prompt;
    return `${STRUCTURED_OUTPUT_PREAMBLE}\n\n${prompt}`;
  }

  /**
   * Technique 7: Add self-reflection instructions.
   * Appended after the main prompt so the model reflects before responding.
   */
  addSelfReflection(prompt: string): string {
    if (prompt.length < 30) return prompt;
    return `${prompt}\n\n${SELF_REFLECTION_PROMPT}`;
  }

  /**
   * Technique 5: Add confidence calibration request.
   * Returns the prompt with confidence rating instructions.
   */
  addConfidenceCalibration(prompt: string): string {
    if (prompt.length < 30) return prompt;
    return `${prompt}\n\n${CONFIDENCE_CALIBRATION}`;
  }

  /**
   * Technique 6: Decompose a complex task into subtasks.
   * Uses task-type-specific decomposition strategies.
   */
  decomposeTask(prompt: string, taskType?: TaskType): readonly string[] {
    const type = taskType ?? classifyTaskType(prompt);
    const decomposer = DECOMPOSITION_STRATEGIES[type];
    if (!decomposer) return [prompt];

    const steps = decomposer(prompt);
    return steps.length > 1 ? steps : [prompt];
  }

  /**
   * Technique 9: Validate a diff for syntactic correctness.
   * Checks for common diff errors before applying.
   */
  validateDiff(diff: string, filePath: string): DiffValidation {
    const errors: DiffError[] = [];
    const warnings: string[] = [];
    const lines = diff.split("\n");
    const ext = extractExtension(filePath);

    // Check for empty diff
    if (diff.trim().length === 0) {
      errors.push({ line: 0, message: "Diff is empty", severity: "error" });
      return { valid: false, errors, warnings };
    }

    // Check for unbalanced braces/brackets/parens in code files
    if (isCodeExtension(ext)) {
      const braceBalance = countBalance(diff, "{", "}");
      const bracketBalance = countBalance(diff, "[", "]");
      const parenBalance = countBalance(diff, "(", ")");

      if (braceBalance !== 0) {
        errors.push({
          line: 0,
          message: `Unbalanced braces: ${braceBalance > 0 ? "missing" : "extra"} ${Math.abs(braceBalance)} closing brace(s)`,
          severity: "error",
        });
      }
      if (bracketBalance !== 0) {
        warnings.push(
          `Unbalanced brackets: ${bracketBalance > 0 ? "missing" : "extra"} ${Math.abs(bracketBalance)} closing bracket(s)`,
        );
      }
      if (parenBalance !== 0) {
        warnings.push(
          `Unbalanced parentheses: ${parenBalance > 0 ? "missing" : "extra"} ${Math.abs(parenBalance)} closing paren(s)`,
        );
      }
    }

    // Check for common TypeScript/JavaScript errors
    if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";

        // Unclosed string literals
        if (hasUnclosedString(line)) {
          warnings.push(`Line ${i + 1}: Possible unclosed string literal`);
        }

        // Trailing comma before closing brace (not always error, but worth flagging)
        if (/,\s*$/.test(line) && i + 1 < lines.length) {
          const nextLine = (lines[i + 1] ?? "").trim();
          if (nextLine === "}" || nextLine === "];") {
            // This is actually valid in JS/TS, so just a style warning
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Technique 10: Test-driven feedback — post-edit verification step.
   *
   * After code changes, detects if test files exist for modified files,
   * runs them, parses output for pass/fail, and returns feedback for the
   * next iteration.
   */
  async applyTestDrivenFeedback(
    modifiedFiles: readonly string[],
    workingDir: string,
  ): Promise<TestDrivenFeedbackResult> {
    if (modifiedFiles.length === 0) {
      return { testsFound: false, testsRan: false, passed: 0, failed: 0, feedback: "No modified files provided." };
    }

    const testFiles = findTestFiles(modifiedFiles);

    if (testFiles.length === 0) {
      return {
        testsFound: false,
        testsRan: false,
        passed: 0,
        failed: 0,
        feedback: `No test files found for modified files: ${modifiedFiles.map((f) => basename(f)).join(", ")}. Consider writing tests.`,
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        "npx",
        ["vitest", "run", ...testFiles],
        { cwd: workingDir, timeout: 30_000 },
      );

      const output = stdout + stderr;
      const { passed, failed } = parseTestOutput(output);

      const feedback = failed > 0
        ? `TEST FAILURE: ${failed} test(s) failed, ${passed} passed.\n\nTest output:\n${output.slice(0, 2000)}\n\nFix the failing tests before proceeding.`
        : `All ${passed} test(s) passed for modified files.`;

      return { testsFound: true, testsRan: true, passed, failed, feedback };
    } catch (error: unknown) {
      // execFile rejects on non-zero exit codes (test failures) or timeout
      const errorObj = error as { stdout?: string; stderr?: string; killed?: boolean; message?: string };
      if (errorObj.killed) {
        return {
          testsFound: true,
          testsRan: false,
          passed: 0,
          failed: 0,
          feedback: "Test execution timed out after 30 seconds.",
        };
      }

      const output = (errorObj.stdout ?? "") + (errorObj.stderr ?? "");
      const { passed, failed } = parseTestOutput(output);

      if (passed > 0 || failed > 0) {
        return {
          testsFound: true,
          testsRan: true,
          passed,
          failed,
          feedback: `TEST FAILURE: ${failed} test(s) failed, ${passed} passed.\n\nTest output:\n${output.slice(0, 2000)}\n\nFix the failing tests before proceeding.`,
        };
      }

      return {
        testsFound: true,
        testsRan: false,
        passed: 0,
        failed: 0,
        feedback: `Test execution failed: ${errorObj.message ?? "unknown error"}`,
      };
    }
  }

  /**
   * Technique 3: Score context items by relevance to the current query.
   * Returns scored items sorted by relevance (highest first).
   */
  scoreContextRelevance(contextItems: readonly string[], query: string): readonly ScoredContext[] {
    const queryTokens = tokenize(query);

    return contextItems
      .map((content) => {
        const contentTokens = tokenize(content);
        const score = computeRelevanceScore(queryTokens, contentTokens);
        const reason = explainScore(queryTokens, contentTokens, score);
        return { content, score, reason };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ── Private Helpers ──────────���───────────────────────────

  private buildErrorAwareRetry(errors: readonly string[], attempts: number): string {
    const errorSummary = errors
      .slice(0, 5)
      .map((e, i) => `  ${i + 1}. ${e.slice(0, 200)}`)
      .join("\n");

    const strategy = attempts >= 3
      ? "CRITICAL: 3+ attempts failed. Take a completely different approach."
      : attempts >= 2
        ? "Two attempts have failed. Carefully analyze what went wrong before trying again."
        : "Previous attempt failed. Review the error and adjust your approach.";

    return [
      `ERROR-AWARE RETRY (attempt ${attempts + 1}):`,
      strategy,
      "",
      "Previous errors:",
      errorSummary,
      "",
      "Before retrying:",
      "1. Identify the root cause of each error (not just the symptom)",
      "2. Verify your assumptions about the codebase by reading relevant files",
      "3. Use a different approach if the same technique failed twice",
    ].join("\n");
  }

  private formatDecomposition(steps: readonly string[]): string {
    const numbered = steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
    return [
      "TASK DECOMPOSITION — Complete each step in order:",
      numbered,
      "",
      "Verify each step succeeds before moving to the next.",
    ].join("\n");
  }

  private selectRelevantExamples(
    taskType: TaskType,
    language?: string,
  ): readonly ExampleSnippet[] {
    const examples: ExampleSnippet[] = [];
    const lang = language ?? "typescript";

    if (taskType === "bug-fix") {
      examples.push({
        label: "Bug fix pattern",
        content: `1. Reproduce the bug (read error, run failing test)
2. Identify root cause (trace from error to source)
3. Write a failing test that captures the bug
4. Fix the minimal code to pass the test
5. Run full test suite to verify no regressions`,
      });
    }

    if (taskType === "refactor") {
      examples.push({
        label: "Safe refactor pattern",
        content: `1. Verify existing tests pass
2. Search for ALL references to the code being changed
3. Make changes in small increments, verifying after each
4. Run tests after every change
5. Check that no callers were missed (grep for function/type names)`,
      });
    }

    if (taskType === "test-writing" && lang === "typescript") {
      examples.push({
        label: "TypeScript test structure",
        content: `describe("ModuleName", () => {
  describe("methodName", () => {
    it("handles the happy path", () => { ... });
    it("handles edge case: empty input", () => { ... });
    it("handles edge case: null/undefined", () => { ... });
    it("handles error conditions", () => { ... });
  });
});`,
      });
    }

    return examples;
  }

  private formatExamples(examples: readonly ExampleSnippet[]): string {
    if (examples.length === 0) return "";
    const formatted = examples
      .map((e) => `[${e.label}]\n${e.content}`)
      .join("\n\n");
    return `REFERENCE EXAMPLES:\n${formatted}`;
  }

  private buildVerificationPlan(context: AccuracyContext): readonly string[] {
    const plan: string[] = [];

    // Always verify syntax
    plan.push("Verify all modified files have valid syntax");

    // TypeScript-specific
    if (context.language === "typescript" || context.language === "ts") {
      plan.push("Run `tsc --noEmit` to check types");
    }

    // Test framework
    if (context.testFramework) {
      plan.push(`Run \`${context.testFramework}\` to verify tests pass`);
    } else {
      plan.push("Run available tests to verify no regressions");
    }

    // If previous errors exist, verify they are fixed
    if (context.previousErrors.length > 0) {
      plan.push("Verify that ALL previous errors are resolved");
    }

    // For refactors, verify all references updated
    if (context.taskType === "refactor") {
      plan.push("Search for all references to changed APIs and verify they are updated");
    }

    // Final check
    plan.push("Review changes holistically before marking complete");

    return plan;
  }
}

// ── Task Classification ─────────��────────────────────────────

export function classifyTaskType(prompt: string): TaskType {
  const lower = prompt.toLowerCase();

  // Bug-fix checked first — "test is failing" is a bug report, not test-writing.
  if (/\b(fix|bug|error|broken|failing|crash|issue|wrong|incorrect)\b/.test(lower)) {
    return "bug-fix";
  }
  if (/\b(refactor|rename|restructure|reorganize|extract|migrate|modernize)\b/.test(lower)) {
    return "refactor";
  }
  // Test-writing: must be about writing/adding tests, not a failing test.
  // Use compound patterns to distinguish "write tests" from "test is broken".
  if (/\b(write\s+tests?|add\s+tests?|test\s+coverage|spec\s+for|assert|expect|describe\s*\(|it\s*\()\b/.test(lower)) {
    return "test-writing";
  }
  if (/\b(document|readme|jsdoc|comment|explain)\b/.test(lower)) {
    return "documentation";
  }
  if (/\b(config|configure|setup|install|deploy|env)\b/.test(lower)) {
    return "configuration";
  }
  if (/\b(investigate|analyze|why|understand|trace|debug)\b/.test(lower)) {
    return "investigation";
  }
  if (/\b(create|build|implement|add|write|generate|new)\b/.test(lower)) {
    return "code-generation";
  }

  return "general";
}

// ── Decomposition Strategies ─────────────────────────────────

interface ExampleSnippet {
  readonly label: string;
  readonly content: string;
}

type DecompositionFn = (prompt: string) => readonly string[];

const DECOMPOSITION_STRATEGIES: Record<TaskType, DecompositionFn> = {
  "code-generation": (prompt) => [
    "Read existing related files to understand patterns and conventions",
    "Plan the implementation (interfaces, types, function signatures)",
    "Implement the core logic",
    "Add error handling and edge cases",
    "Write tests for the new code",
    "Run typecheck and tests to verify",
  ],
  "bug-fix": (prompt) => [
    "Reproduce the bug (read the error, find the failing test or steps)",
    "Trace the error to its root cause",
    "Write a test that captures the bug (should fail now)",
    "Fix the minimal code to resolve the bug",
    "Verify the fix (test should pass, no regressions)",
  ],
  "refactor": (prompt) => [
    "Verify existing tests pass before changes",
    "Search for ALL references to the code being changed",
    "Make incremental changes, verifying after each",
    "Update all callers and references",
    "Run full test suite to verify no regressions",
  ],
  "test-writing": (prompt) => [
    "Read the source code to understand behavior and edge cases",
    "Identify happy path, error cases, and boundary conditions",
    "Write tests for the happy path first",
    "Add edge case and error condition tests",
    "Run tests and verify coverage",
  ],
  "documentation": (_prompt) => [
    "Read the current code to understand what it does",
    "Identify the target audience and purpose",
    "Write the documentation",
  ],
  "configuration": (_prompt) => [
    "Read existing configuration for context",
    "Make the configuration changes",
    "Verify the configuration is valid",
  ],
  "investigation": (prompt) => [
    "Gather information (read files, logs, error messages)",
    "Form hypotheses about the cause",
    "Test each hypothesis systematically",
    "Report findings with evidence",
  ],
  "general": (_prompt) => [],
};

// ── Utility Functions ────────────────────────────────────────

function isCodeTask(taskType: TaskType): boolean {
  return taskType === "code-generation"
    || taskType === "bug-fix"
    || taskType === "refactor"
    || taskType === "test-writing";
}

function extractExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot + 1) : "";
}

function isCodeExtension(ext: string): boolean {
  const codeExtensions = new Set([
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h",
    "cs", "rb", "php", "swift", "kt", "scala", "zig", "dart",
  ]);
  return codeExtensions.has(ext);
}

function countBalance(text: string, open: string, close: string): number {
  let balance = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const prev = i > 0 ? text[i - 1] : "";

    if (inString) {
      if (ch === stringChar && prev !== "\\") {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === open) balance++;
    if (ch === close) balance--;
  }

  return balance;
}

function hasUnclosedString(line: string): boolean {
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const prev = i > 0 ? line[i - 1] : "";

    if (ch === "/" && !inString && i + 1 < line.length && line[i + 1] === "/") {
      return false; // Rest of line is a comment
    }

    if (inString) {
      if (ch === stringChar && prev !== "\\") {
        inString = false;
      }
    } else if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
    } else if (ch === "`") {
      // Template literals can span lines — not an error
      return false;
    }
  }

  return inString;
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function computeRelevanceScore(
  queryTokens: readonly string[],
  contentTokens: readonly string[],
): number {
  if (queryTokens.length === 0) return 0;

  const contentSet = new Set(contentTokens);
  let matches = 0;
  for (const token of queryTokens) {
    if (contentSet.has(token)) matches++;
  }

  // Jaccard-like score: matches / union
  const union = new Set([...queryTokens, ...contentTokens]).size;
  if (union === 0) return 0;

  return matches / union;
}

function explainScore(
  queryTokens: readonly string[],
  contentTokens: readonly string[],
  score: number,
): string {
  if (score === 0) return "No matching terms found";

  const contentSet = new Set(contentTokens);
  const matched = queryTokens.filter((t) => contentSet.has(t));

  if (score > 0.5) return `High relevance: matched [${matched.join(", ")}]`;
  if (score > 0.2) return `Moderate relevance: matched [${matched.join(", ")}]`;
  return `Low relevance: matched [${matched.join(", ")}]`;
}

// ── Technique 10 Helpers ────────────────────────────────────

/**
 * Find test files corresponding to modified source files.
 * Checks for `.test.ts`, `.spec.ts`, and `__tests__/` patterns.
 */
function findTestFiles(modifiedFiles: readonly string[]): readonly string[] {
  const testFiles: string[] = [];
  const seen = new Set<string>();

  for (const filePath of modifiedFiles) {
    const dir = dirname(filePath);
    const base = basename(filePath);
    const nameWithoutExt = base.replace(/\.(ts|tsx|js|jsx)$/, "");

    // Skip if the file itself is already a test file
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(base)) {
      if (!seen.has(filePath) && existsSync(filePath)) {
        seen.add(filePath);
        testFiles.push(filePath);
      }
      continue;
    }

    // Check for co-located test files: foo.test.ts, foo.spec.ts
    const candidates = [
      join(dir, `${nameWithoutExt}.test.ts`),
      join(dir, `${nameWithoutExt}.spec.ts`),
      join(dir, `${nameWithoutExt}.test.tsx`),
      join(dir, `${nameWithoutExt}.spec.tsx`),
      join(dir, "__tests__", `${nameWithoutExt}.test.ts`),
      join(dir, "__tests__", `${nameWithoutExt}.spec.ts`),
    ];

    for (const candidate of candidates) {
      if (!seen.has(candidate) && existsSync(candidate)) {
        seen.add(candidate);
        testFiles.push(candidate);
      }
    }
  }

  return testFiles;
}

/**
 * Parse vitest output for pass/fail counts.
 * Matches patterns like "Tests  42 passed (42)" and "Tests  3 failed | 39 passed (42)".
 */
function parseTestOutput(output: string): { readonly passed: number; readonly failed: number } {
  let passed = 0;
  let failed = 0;

  // Vitest summary line: "Tests  3 passed (3)" or "Tests  1 failed | 2 passed (3)"
  const passedMatch = output.match(/(\d+)\s+passed/);
  const failedMatch = output.match(/(\d+)\s+failed/);

  if (passedMatch?.[1]) passed = parseInt(passedMatch[1], 10);
  if (failedMatch?.[1]) failed = parseInt(failedMatch[1], 10);

  return { passed, failed };
}

export { findTestFiles, parseTestOutput };
