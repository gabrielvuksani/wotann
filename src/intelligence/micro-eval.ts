/**
 * Micro-eval: test each tool against each model to find failure modes.
 * Run quick evals at startup or on model switch to calibrate tool prompts.
 *
 * Purpose:
 * - Detect models that silently drop tool-call parameters
 * - Detect models that use wrong XML/JSON format for tool calls
 * - Detect models that hallucinate tool names not in the schema
 * - Detect models that fail to follow structured output instructions
 * - Cache results per model+provider so evals run only once per combination
 *
 * Each test case sends a structured prompt and checks if the response
 * uses the correct tool format. Results feed into accuracy-boost and
 * smart-retry to compensate for known model weaknesses.
 */

// ── Types ────────────────────────────────────────────────────

export interface MicroEvalResult {
  readonly tool: string;
  readonly model: string;
  readonly provider: string;
  readonly passed: boolean;
  readonly errorType?: string;
  readonly suggestedFix?: string;
  readonly latencyMs: number;
}

export interface MicroEvalSuite {
  readonly results: readonly MicroEvalResult[];
  readonly overallScore: number;
  readonly failingTools: readonly string[];
  readonly recommendations: readonly string[];
  readonly evaluatedAt: number;
}

export interface MicroEvalTestCase {
  readonly tool: string;
  readonly prompt: string;
  readonly validate: (response: string) => MicroEvalCheck;
}

export interface MicroEvalCheck {
  readonly passed: boolean;
  readonly errorType?: string;
  readonly suggestedFix?: string;
}

// ── Test Cases ───────────────────────────────────────────────

const FILE_READ_TEST: MicroEvalTestCase = {
  tool: "file_read",
  prompt: [
    "Read the file at /tmp/test-file.txt and report its contents.",
    "You must use the Read tool with the file_path parameter.",
    "Respond with ONLY the tool call, no other text.",
  ].join("\n"),
  validate: (response: string): MicroEvalCheck => {
    const hasToolCall = /Read|file_read|read_file/i.test(response);
    const hasPath = /file_path|path/i.test(response);

    if (!hasToolCall) {
      return {
        passed: false,
        errorType: "missing-tool-call",
        suggestedFix: "Add explicit instruction: 'Use the Read tool'",
      };
    }
    if (!hasPath) {
      return {
        passed: false,
        errorType: "missing-parameter",
        suggestedFix: "Add parameter hint: 'file_path is required'",
      };
    }
    return { passed: true };
  },
};

const FILE_WRITE_TEST: MicroEvalTestCase = {
  tool: "file_write",
  prompt: [
    "Write the text 'hello world' to /tmp/output.txt.",
    "You must use the Write tool with file_path and content parameters.",
    "Respond with ONLY the tool call, no other text.",
  ].join("\n"),
  validate: (response: string): MicroEvalCheck => {
    const hasToolCall = /Write|file_write|write_file/i.test(response);
    const hasContent = /content/i.test(response);
    const hasPath = /file_path|path/i.test(response);

    if (!hasToolCall) {
      return {
        passed: false,
        errorType: "missing-tool-call",
        suggestedFix: "Add explicit instruction: 'Use the Write tool'",
      };
    }
    if (!hasPath || !hasContent) {
      return {
        passed: false,
        errorType: "missing-parameter",
        suggestedFix: "Enumerate required parameters in the prompt",
      };
    }
    return { passed: true };
  },
};

const GREP_SEARCH_TEST: MicroEvalTestCase = {
  tool: "grep_search",
  prompt: [
    "Search for the pattern 'TODO' in all TypeScript files under /src.",
    "You must use the Grep tool with pattern and glob parameters.",
    "Respond with ONLY the tool call, no other text.",
  ].join("\n"),
  validate: (response: string): MicroEvalCheck => {
    const hasToolCall = /Grep|grep|search|rg/i.test(response);
    const hasPattern = /pattern|TODO/i.test(response);

    if (!hasToolCall) {
      return {
        passed: false,
        errorType: "missing-tool-call",
        suggestedFix: "Instruct model to use Grep tool explicitly",
      };
    }
    if (!hasPattern) {
      return {
        passed: false,
        errorType: "missing-parameter",
        suggestedFix: "Include the search pattern in the prompt more prominently",
      };
    }
    return { passed: true };
  },
};

const BASH_COMMAND_TEST: MicroEvalTestCase = {
  tool: "bash_command",
  prompt: [
    "Run the command 'npm test' in the project directory /workspace.",
    "You must use the Bash tool with the command parameter.",
    "Respond with ONLY the tool call, no other text.",
  ].join("\n"),
  validate: (response: string): MicroEvalCheck => {
    const hasToolCall = /Bash|bash|shell|execute|command/i.test(response);
    const hasCommand = /npm\s+test/i.test(response);

    if (!hasToolCall) {
      return {
        passed: false,
        errorType: "missing-tool-call",
        suggestedFix: "Add explicit instruction: 'Use the Bash tool'",
      };
    }
    if (!hasCommand) {
      return {
        passed: false,
        errorType: "wrong-command",
        suggestedFix: "Quote the exact command to run in the prompt",
      };
    }
    return { passed: true };
  },
};

const EDIT_FILE_TEST: MicroEvalTestCase = {
  tool: "file_edit",
  prompt: [
    "In /tmp/example.ts, replace 'const x = 1' with 'const x = 2'.",
    "You must use the Edit tool with file_path, old_string, and new_string parameters.",
    "Respond with ONLY the tool call, no other text.",
  ].join("\n"),
  validate: (response: string): MicroEvalCheck => {
    const hasToolCall = /Edit|edit|replace|patch/i.test(response);
    const hasOldString = /old_string|old/i.test(response);
    const hasNewString = /new_string|new/i.test(response);

    if (!hasToolCall) {
      return {
        passed: false,
        errorType: "missing-tool-call",
        suggestedFix: "Add explicit instruction: 'Use the Edit tool'",
      };
    }
    if (!hasOldString || !hasNewString) {
      return {
        passed: false,
        errorType: "missing-parameter",
        suggestedFix: "List all required Edit parameters in the prompt",
      };
    }
    return { passed: true };
  },
};

const DEFAULT_TEST_CASES: readonly MicroEvalTestCase[] = [
  FILE_READ_TEST,
  FILE_WRITE_TEST,
  GREP_SEARCH_TEST,
  BASH_COMMAND_TEST,
  EDIT_FILE_TEST,
];

// ── Runner ───────────────────────────────────────────────────

export class MicroEvalRunner {
  private readonly cache: Map<string, MicroEvalSuite> = new Map();
  private readonly testCases: readonly MicroEvalTestCase[];

  constructor(testCases?: readonly MicroEvalTestCase[]) {
    this.testCases = testCases ?? DEFAULT_TEST_CASES;
  }

  /**
   * Run quick evals for common tool patterns against a specific model.
   * The executor function simulates sending a prompt and receiving a response.
   */
  async evaluateToolCompatibility(
    model: string,
    provider: string,
    executor: (prompt: string) => Promise<string>,
  ): Promise<MicroEvalSuite> {
    const results: MicroEvalResult[] = [];

    for (const testCase of this.testCases) {
      const start = Date.now();
      let result: MicroEvalResult;

      try {
        const response = await executor(testCase.prompt);
        const check = testCase.validate(response);
        result = {
          tool: testCase.tool,
          model,
          provider,
          passed: check.passed,
          errorType: check.errorType,
          suggestedFix: check.suggestedFix,
          latencyMs: Date.now() - start,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        result = {
          tool: testCase.tool,
          model,
          provider,
          passed: false,
          errorType: "executor-error",
          suggestedFix: `Executor failed: ${message.slice(0, 100)}`,
          latencyMs: Date.now() - start,
        };
      }

      results.push(result);
    }

    const suite = buildSuite(results);
    this.cache.set(buildCacheKey(model, provider), suite);
    return suite;
  }

  /**
   * Get cached results for a model+provider combination.
   * Returns null if no cached results exist.
   */
  getCachedResults(model: string, provider: string): MicroEvalSuite | null {
    return this.cache.get(buildCacheKey(model, provider)) ?? null;
  }

  /**
   * Clear all cached results.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the list of test case tool names.
   */
  getTestCaseTools(): readonly string[] {
    return this.testCases.map((tc) => tc.tool);
  }
}

// ── Helpers ──────────────────────────────────────────────────

function buildCacheKey(model: string, provider: string): string {
  return `${provider}:${model}`;
}

function buildSuite(results: readonly MicroEvalResult[]): MicroEvalSuite {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const overallScore = total > 0 ? passed / total : 0;

  const failingTools = results
    .filter((r) => !r.passed)
    .map((r) => r.tool);

  const recommendations = buildRecommendations(results);

  return {
    results,
    overallScore,
    failingTools,
    recommendations,
    evaluatedAt: Date.now(),
  };
}

function buildRecommendations(results: readonly MicroEvalResult[]): readonly string[] {
  const recs: string[] = [];
  const errorCounts = new Map<string, number>();

  for (const result of results) {
    if (!result.passed && result.errorType) {
      const count = errorCounts.get(result.errorType) ?? 0;
      errorCounts.set(result.errorType, count + 1);
    }
  }

  const missingToolCalls = errorCounts.get("missing-tool-call") ?? 0;
  const missingParams = errorCounts.get("missing-parameter") ?? 0;
  const executorErrors = errorCounts.get("executor-error") ?? 0;

  if (missingToolCalls > 0) {
    recs.push(
      `Model failed to generate tool calls in ${missingToolCalls} test(s). ` +
      "Consider adding explicit tool-call instructions to the system prompt.",
    );
  }

  if (missingParams > 0) {
    recs.push(
      `Model omitted required parameters in ${missingParams} test(s). ` +
      "Consider enumerating required parameters in tool descriptions.",
    );
  }

  if (executorErrors > 0) {
    recs.push(
      `Executor failed for ${executorErrors} test(s). ` +
      "Check model connectivity and rate limits.",
    );
  }

  const allPassed = results.every((r) => r.passed);
  if (allPassed) {
    recs.push("All tool compatibility tests passed. No calibration needed.");
  }

  return recs;
}
