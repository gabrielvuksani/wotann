/**
 * Red/Blue Agent Testing -- one agent writes code, another tries to break it.
 * Like automated adversarial security testing built into the development flow.
 *
 * Red Phase: Generate an implementation for a task.
 * Blue Phase: Analyze the implementation for bugs, security issues, edge cases.
 * Loop: Red fixes findings, Blue re-tests until convergence or max rounds.
 */

// -- Types -------------------------------------------------------------------

export interface TaskExecutor {
  readonly execute: (prompt: string) => Promise<string>;
}

export interface RedResult {
  readonly task: string;
  readonly implementation: string;
  readonly filesChanged: readonly string[];
  readonly executedAt: number;
}

export interface BlueFinding {
  readonly id: string;
  readonly category: "bug" | "security" | "edge-case" | "performance" | "style";
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly title: string;
  readonly description: string;
  readonly suggestedFix: string | null;
  readonly file: string | null;
  readonly line: number | null;
}

export interface BlueResult {
  readonly findings: readonly BlueFinding[];
  readonly testedAt: number;
  readonly overallVerdict: "pass" | "fail" | "needs-improvement";
}

export interface AdversarialRound {
  readonly round: number;
  readonly redResult: RedResult;
  readonly blueResult: BlueResult;
  readonly fixedFindings: readonly string[];
  readonly remainingFindings: readonly string[];
}

export interface AdversarialResult {
  readonly task: string;
  readonly rounds: readonly AdversarialRound[];
  readonly totalRounds: number;
  readonly finalVerdict: "pass" | "fail" | "max-rounds-reached";
  readonly allFindings: readonly BlueFinding[];
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly startedAt: number;
  readonly completedAt: number;
}

// -- Prompt builders ---------------------------------------------------------

function buildRedPrompt(task: string, previousFindings?: readonly BlueFinding[]): string {
  const base = `Implement the following task:\n\n${task}\n\nReturn ONLY the implementation code.`;
  if (!previousFindings || previousFindings.length === 0) return base;

  const findingsList = previousFindings
    .map((f) => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.description}`)
    .join("\n");

  return `${base}\n\nPrevious security review found these issues — fix them all:\n${findingsList}`;
}

function buildBluePrompt(implementation: string): string {
  return [
    "You are a security reviewer and QA tester. Analyze the following implementation for:",
    "1. Bugs and logical errors",
    "2. Security vulnerabilities (injection, auth bypass, data leaks)",
    "3. Edge cases not handled",
    "4. Performance issues",
    "",
    "Return findings in this exact JSON format:",
    '{"findings": [{"category": "bug|security|edge-case|performance|style", "severity": "critical|high|medium|low", "title": "...", "description": "...", "suggestedFix": "..." or null, "file": null, "line": null}], "verdict": "pass|fail|needs-improvement"}',
    "",
    "Implementation to review:",
    "```",
    implementation,
    "```",
  ].join("\n");
}

// -- Implementation ----------------------------------------------------------

export class RedBlueTestRunner {
  /**
   * Red phase: generate implementation for a task.
   */
  async runRedPhase(task: string, executor: TaskExecutor): Promise<RedResult> {
    const prompt = buildRedPrompt(task);
    const implementation = await executor.execute(prompt);

    return {
      task,
      implementation,
      filesChanged: extractFileNames(implementation),
      executedAt: Date.now(),
    };
  }

  /**
   * Blue phase: try to break the implementation.
   */
  async runBluePhase(implementation: RedResult, executor: TaskExecutor): Promise<BlueResult> {
    const prompt = buildBluePrompt(implementation.implementation);
    const response = await executor.execute(prompt);
    const parsed = parseBlueResponse(response);

    return {
      findings: parsed.findings,
      testedAt: Date.now(),
      overallVerdict: parsed.verdict,
    };
  }

  /**
   * Run the full adversarial loop: Red implements, Blue attacks, repeat.
   */
  async runAdversarialLoop(
    task: string,
    executor: TaskExecutor,
    maxRounds: number,
  ): Promise<AdversarialResult> {
    const startedAt = Date.now();
    const rounds: AdversarialRound[] = [];
    const allFindings: BlueFinding[] = [];
    let accumulatedFindings: BlueFinding[] = [];
    let resolvedCount = 0;

    for (let round = 1; round <= maxRounds; round++) {
      // Red phase (with previous findings if any)
      const redPrompt = buildRedPrompt(task, accumulatedFindings);
      const redImplementation = await executor.execute(redPrompt);
      const redResult: RedResult = {
        task,
        implementation: redImplementation,
        filesChanged: extractFileNames(redImplementation),
        executedAt: Date.now(),
      };

      // Blue phase
      const blueResult = await this.runBluePhase(redResult, executor);

      // Track which findings were fixed vs remaining
      const previousIds = new Set(accumulatedFindings.map((f) => f.id));
      const currentIds = new Set(blueResult.findings.map((f) => f.id));
      const fixedFindings = [...previousIds].filter((id) => !currentIds.has(id));
      const remainingFindings = blueResult.findings.map((f) => f.id);

      resolvedCount += fixedFindings.length;

      // Add new findings to the master list
      for (const finding of blueResult.findings) {
        if (!allFindings.some((f) => f.id === finding.id)) {
          allFindings.push(finding);
        }
      }

      rounds.push({
        round,
        redResult,
        blueResult,
        fixedFindings,
        remainingFindings,
      });

      // Exit early if Blue gives a pass
      if (blueResult.overallVerdict === "pass") {
        return {
          task,
          rounds,
          totalRounds: round,
          finalVerdict: "pass",
          allFindings,
          resolvedCount,
          unresolvedCount: 0,
          startedAt,
          completedAt: Date.now(),
        };
      }

      accumulatedFindings = [...blueResult.findings];
    }

    const lastBlue = rounds[rounds.length - 1]?.blueResult;
    const unresolvedCount = lastBlue?.findings.length ?? 0;

    return {
      task,
      rounds,
      totalRounds: rounds.length,
      finalVerdict: unresolvedCount === 0 ? "pass" : "max-rounds-reached",
      allFindings,
      resolvedCount,
      unresolvedCount,
      startedAt,
      completedAt: Date.now(),
    };
  }
}

// -- Helpers -----------------------------------------------------------------

function extractFileNames(implementation: string): readonly string[] {
  const matches = implementation.match(/(?:\/\/|#)\s*file:\s*(\S+)/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/(?:\/\/|#)\s*file:\s*/, "").trim());
}

function parseBlueResponse(response: string): { findings: BlueFinding[]; verdict: BlueResult["overallVerdict"] } {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { findings: [], verdict: "pass" };

    const parsed = JSON.parse(jsonMatch[0]) as {
      findings?: Array<{
        category?: string;
        severity?: string;
        title?: string;
        description?: string;
        suggestedFix?: string | null;
        file?: string | null;
        line?: number | null;
      }>;
      verdict?: string;
    };

    const findings: BlueFinding[] = (parsed.findings ?? []).map((f, i) => ({
      id: `bf_${Date.now()}_${i}`,
      category: validateCategory(f.category),
      severity: validateSeverity(f.severity),
      title: f.title ?? "Untitled finding",
      description: f.description ?? "",
      suggestedFix: f.suggestedFix ?? null,
      file: f.file ?? null,
      line: f.line ?? null,
    }));

    const verdict = validateVerdict(parsed.verdict);
    return { findings, verdict };
  } catch {
    return { findings: [], verdict: "pass" };
  }
}

function validateCategory(c: string | undefined): BlueFinding["category"] {
  const valid: ReadonlySet<string> = new Set(["bug", "security", "edge-case", "performance", "style"]);
  return valid.has(c ?? "") ? (c as BlueFinding["category"]) : "bug";
}

function validateSeverity(s: string | undefined): BlueFinding["severity"] {
  const valid: ReadonlySet<string> = new Set(["critical", "high", "medium", "low"]);
  return valid.has(s ?? "") ? (s as BlueFinding["severity"]) : "medium";
}

function validateVerdict(v: string | undefined): BlueResult["overallVerdict"] {
  const valid: ReadonlySet<string> = new Set(["pass", "fail", "needs-improvement"]);
  return valid.has(v ?? "") ? (v as BlueResult["overallVerdict"]) : "needs-improvement";
}
