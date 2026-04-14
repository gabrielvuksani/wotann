/**
 * Forced Verification Middleware — the harness intelligence moat.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "Models that self-verify catch 40-60% more bugs than models that don't."
 * ForgeCode (#1 on TerminalBench) uses "mandatory reviewer mode before task
 * completion, generating checklists proving objectives were actually complete."
 *
 * This middleware:
 * 1. After every code-modifying tool call (Write, Edit), queues verification
 * 2. Verification runs typecheck + relevant tests automatically
 * 3. Results are injected back into the conversation as tool results
 * 4. If verification fails, the model is prompted to fix before continuing
 *
 * The middleware is TRANSPARENT to the model — it sees verification results
 * as if it ran the checks itself. This works with ANY model, not just Claude.
 */

export interface VerificationConfig {
  /** Run TypeScript typecheck after code changes */
  readonly typecheck: boolean;
  /** Run tests after code changes */
  readonly tests: boolean;
  /** Run linter after code changes */
  readonly lint: boolean;
  /** Maximum time for verification (ms) */
  readonly timeoutMs: number;
  /** Skip verification for these file patterns */
  readonly skipPatterns: readonly string[];
  /** Minimum lines changed to trigger verification */
  readonly minLinesChanged: number;
}

export interface VerificationResult {
  readonly passed: boolean;
  readonly typecheckOk: boolean;
  readonly testsOk: boolean;
  readonly lintOk: boolean;
  readonly errors: readonly string[];
  readonly durationMs: number;
}

const DEFAULT_CONFIG: VerificationConfig = {
  typecheck: true,
  tests: true,
  lint: false,
  timeoutMs: 60_000,
  skipPatterns: ["*.md", "*.txt", "*.json", "*.yaml", "*.yml", "*.css", "*.html"],
  minLinesChanged: 1,
};

export class ForcedVerificationMiddleware {
  private readonly config: VerificationConfig;
  private pendingVerification = false;
  private lastVerifiedFiles: readonly string[] = [];
  private verificationCount = 0;
  private passCount = 0;

  constructor(config?: Partial<VerificationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a tool call should trigger verification.
   * Write and Edit to code files trigger verification.
   */
  shouldVerify(toolName: string, filePath: string): boolean {
    if (toolName !== "Write" && toolName !== "Edit") return false;

    // Skip non-code files
    for (const pattern of this.config.skipPatterns) {
      const ext = pattern.replace("*", "");
      if (filePath.endsWith(ext)) return false;
    }

    this.pendingVerification = true;
    return true;
  }

  /**
   * Queue a file for verification.
   */
  queueFile(filePath: string): void {
    if (!this.lastVerifiedFiles.includes(filePath)) {
      this.lastVerifiedFiles = [...this.lastVerifiedFiles, filePath];
    }
    this.pendingVerification = true;
  }

  /**
   * Check if verification is pending.
   */
  isPending(): boolean {
    return this.pendingVerification;
  }

  /**
   * Run verification. Returns results and clears the pending flag.
   */
  async verify(
    runner: VerificationRunner,
  ): Promise<VerificationResult> {
    const start = Date.now();
    const errors: string[] = [];

    let typecheckOk = true;
    let testsOk = true;
    let lintOk = true;

    if (this.config.typecheck) {
      try {
        const result = await runner.runTypecheck(this.config.timeoutMs);
        typecheckOk = result.success;
        if (!result.success) {
          errors.push(`Typecheck: ${result.output.slice(0, 500)}`);
        }
      } catch (error) {
        typecheckOk = false;
        errors.push(`Typecheck error: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }

    if (this.config.tests) {
      try {
        const result = await runner.runTests(this.config.timeoutMs, this.lastVerifiedFiles);
        testsOk = result.success;
        if (!result.success) {
          errors.push(`Tests: ${result.output.slice(0, 500)}`);
        }
      } catch (error) {
        testsOk = false;
        errors.push(`Test error: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }

    if (this.config.lint) {
      try {
        const result = await runner.runLint(this.config.timeoutMs, this.lastVerifiedFiles);
        lintOk = result.success;
        if (!result.success) {
          errors.push(`Lint: ${result.output.slice(0, 500)}`);
        }
      } catch (error) {
        lintOk = false;
        errors.push(`Lint error: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }

    const passed = typecheckOk && testsOk && lintOk;
    this.pendingVerification = false;
    this.lastVerifiedFiles = [];
    this.verificationCount++;
    if (passed) this.passCount++;

    return {
      passed,
      typecheckOk,
      testsOk,
      lintOk,
      errors,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Build a prompt injection that shows verification results to the model.
   * This is injected into the conversation so the model sees the results.
   */
  formatResultForModel(result: VerificationResult): string {
    if (result.passed) {
      return `[Verification PASSED] Typecheck: ok | Tests: ok | Duration: ${result.durationMs}ms`;
    }

    const parts = [
      `[Verification FAILED]`,
      `Typecheck: ${result.typecheckOk ? "ok" : "FAIL"}`,
      `Tests: ${result.testsOk ? "ok" : "FAIL"}`,
      result.lintOk ? null : `Lint: FAIL`,
      `Duration: ${result.durationMs}ms`,
    ].filter(Boolean);

    const errorDetails = result.errors.length > 0
      ? `\n\nErrors:\n${result.errors.join("\n\n")}`
      : "";

    return `${parts.join(" | ")}${errorDetails}\n\nFix these issues before continuing.`;
  }

  /**
   * Get verification statistics.
   */
  getStats(): { total: number; passed: number; passRate: number } {
    return {
      total: this.verificationCount,
      passed: this.passCount,
      passRate: this.verificationCount > 0 ? this.passCount / this.verificationCount : 0,
    };
  }
}

/**
 * Interface for the verification runner — decouples from actual shell execution.
 * The runtime provides a concrete implementation that runs tsc, vitest, etc.
 */
export interface VerificationRunner {
  runTypecheck(timeoutMs: number): Promise<{ success: boolean; output: string }>;
  runTests(timeoutMs: number, files: readonly string[]): Promise<{ success: boolean; output: string }>;
  runLint(timeoutMs: number, files: readonly string[]): Promise<{ success: boolean; output: string }>;
}
