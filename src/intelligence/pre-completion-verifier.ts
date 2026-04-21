/**
 * Pre-Completion Verifier — ForgeCode 4-perspective self-review.
 *
 * FROM FORGECODE (TerminalBench #1, 81.8%):
 *   Before the agent declares a task complete, run a 4-perspective review
 *   checklist. Catches ~3-5pp of silent-success exits on TB2.
 *
 * PERSPECTIVES (all four run in PARALLEL):
 *   1. Implementer — "Does the code do what the user asked? Trace
 *      requirements → implementation."
 *   2. Reviewer    — "Are there bugs, edge cases, security issues, broken
 *      invariants?"
 *   3. Tester      — "What tests would fail? Are all paths tested?"
 *   4. User        — "Would a user hitting this flow get what they expected?
 *      Any UX issues?"
 *
 * DESIGN:
 *   - Provider-agnostic via injected LlmQuery (same shape as CoVe).
 *   - No module-global state — every `verify()` owns its own report.
 *   - Honest failures bubble up per-perspective (QB #6).
 *   - Bypass mode: `skipPreCompletionVerify: true` skips entirely for
 *     benchmark runs where LLM budget matters.
 *   - Overall `status` is "fail" if ANY perspective fails, "error" if all
 *     perspectives errored, "pass" only when all passed.
 *
 * RELATIONSHIP TO EXISTING CODE:
 *   - pre-completion-checklist.ts runs SHELL checks (tsc/tests/stubs/diff).
 *   - forgecode-techniques.ts Technique 5 scans the filesystem.
 *   - THIS FILE runs LLM REVIEWS — four personas scoring the completed work.
 *     Layered, not redundant.
 */

// ── Types ──────────────────────────────────────────────

/**
 * Provider-agnostic LLM call shape. Matches chain-of-verification.ts so
 * callers can reuse the same binding.
 */
export type LlmQuery = (
  prompt: string,
  options?: { readonly maxTokens?: number; readonly temperature?: number },
) => Promise<string>;

/** The four perspectives, in a fixed order for deterministic reports. */
export const PERSPECTIVES = ["implementer", "reviewer", "tester", "user"] as const;
export type Perspective = (typeof PERSPECTIVES)[number];

/** A single persona's verdict on the completed work. */
export interface PerspectiveReport {
  readonly perspective: Perspective;
  /** "pass" | "fail" | "error" — error means the provider call threw. */
  readonly status: "pass" | "fail" | "error";
  /** Short reasons / concerns from the persona. Empty for pass, may be
   * populated on fail even if status is "pass". */
  readonly concerns: readonly string[];
  /** Raw provider response (trimmed). Present on "pass" and "fail". */
  readonly raw: string;
  /** Populated when status === "error" — the provider call failed. */
  readonly error?: string;
  /** Elapsed ms for this perspective call. */
  readonly durationMs: number;
}

/** The full 4-perspective report. */
export interface VerificationReport {
  /** Overall verdict. "pass" only when all 4 perspectives pass. */
  readonly status: "pass" | "fail" | "error";
  /** Four per-perspective reports. Always length 4. */
  readonly perspectives: readonly PerspectiveReport[];
  /** Convenience: quick access by name. */
  readonly implementer: PerspectiveReport;
  readonly reviewer: PerspectiveReport;
  readonly tester: PerspectiveReport;
  readonly user: PerspectiveReport;
  /** Was the verifier bypassed via config? */
  readonly bypassed: boolean;
  /** Total wall-clock ms for the verification (parallel dispatch). */
  readonly totalDurationMs: number;
  /** Aggregate concerns across all perspectives (flattened). */
  readonly allConcerns: readonly string[];
}

/** Input to the verifier — describes the task and its claimed completion. */
export interface VerificationInput {
  /** The original user task / requirement. */
  readonly task: string;
  /**
   * The agent's completion artifact. This is what the personas review.
   * Typical content: summary of changes, diff, test results, final message.
   */
  readonly result: string;
  /**
   * Optional context snippets the personas can reference (e.g., spec
   * excerpts, modified file paths, test output). All perspectives see this.
   */
  readonly context?: string;
}

/** Per-session configuration for the verifier. */
export interface PreCompletionVerifierConfig {
  /** The LLM query function — injected by the runtime. */
  readonly llmQuery: LlmQuery;
  /** When true, `verify()` short-circuits and returns a bypass report. */
  readonly skipPreCompletionVerify?: boolean;
  /**
   * Temperature for the review calls. Lower = more deterministic. Default 0.
   */
  readonly temperature?: number;
  /** Max tokens per perspective response. Default 1024. */
  readonly maxTokens?: number;
}

// ── Persona prompts ────────────────────────────────────

/**
 * System persona prompt for each perspective. The response MUST be a JSON
 * object with shape `{"verdict":"pass"|"fail","concerns":[...]}`. We parse
 * defensively so minor formatting drift does not kill the whole verify.
 */
const PERSPECTIVE_PROMPTS: Readonly<Record<Perspective, string>> = {
  implementer: [
    "You are the IMPLEMENTER perspective in a 4-perspective pre-completion review.",
    "",
    "Your role: verify that the code/changes actually do what the user asked.",
    "Trace each requirement in the task to a concrete piece of the implementation.",
    "If any requirement is unaddressed or only partially addressed, that is a fail.",
    "",
    "Output a SINGLE JSON object and nothing else:",
    `  {"verdict": "pass" | "fail", "concerns": ["short phrase", ...]}`,
    "",
    '- verdict="pass" only when every requirement is clearly implemented.',
    "- concerns MUST be empty on pass.",
    "- concerns MUST list each unaddressed requirement on fail.",
  ].join("\n"),
  reviewer: [
    "You are the REVIEWER perspective in a 4-perspective pre-completion review.",
    "",
    "Your role: hunt for bugs, edge cases, security holes, and broken invariants.",
    "Look for: null/undefined handling, off-by-one, race conditions, unchecked errors,",
    "unvalidated input, leaked secrets, privilege escalation, data races, missing",
    "transactions, stale reads, broken type contracts, unreachable error paths.",
    "",
    "Output a SINGLE JSON object and nothing else:",
    `  {"verdict": "pass" | "fail", "concerns": ["short phrase", ...]}`,
    "",
    '- verdict="pass" only when you find no defects.',
    '- verdict="fail" when any real defect is visible.',
  ].join("\n"),
  tester: [
    "You are the TESTER perspective in a 4-perspective pre-completion review.",
    "",
    "Your role: identify what tests would fail and what paths are untested.",
    "Enumerate the behaviours introduced, the branches, and the failure modes.",
    "For each, state whether a test covers it. Missing coverage on a critical",
    "path is a fail. Verify tests exist AND pass when claimed.",
    "",
    "Output a SINGLE JSON object and nothing else:",
    `  {"verdict": "pass" | "fail", "concerns": ["short phrase", ...]}`,
    "",
    '- verdict="pass" only when critical paths are tested and tests pass.',
    '- verdict="fail" when coverage is missing or tests would fail.',
  ].join("\n"),
  user: [
    "You are the USER perspective in a 4-perspective pre-completion review.",
    "",
    "Your role: imagine hitting this feature as a user. Would you get what you",
    "expected? Are error messages clear? Is the flow surprising? Are there",
    "empty states, loading states, failure states? Does the UX match the",
    "stated requirement?",
    "",
    "Output a SINGLE JSON object and nothing else:",
    `  {"verdict": "pass" | "fail", "concerns": ["short phrase", ...]}`,
    "",
    '- verdict="pass" only when a user would be satisfied.',
    '- verdict="fail" when UX, messaging, or outcome is off.',
  ].join("\n"),
};

// ── Prompt assembly ────────────────────────────────────

function buildPerspectivePrompt(perspective: Perspective, input: VerificationInput): string {
  const persona = PERSPECTIVE_PROMPTS[perspective];
  const lines: string[] = [
    persona,
    "",
    "USER TASK:",
    input.task,
    "",
    "AGENT RESULT:",
    input.result,
  ];
  if (input.context && input.context.trim().length > 0) {
    lines.push("", "ADDITIONAL CONTEXT:", input.context);
  }
  lines.push("", "Respond with the JSON object described above.");
  return lines.join("\n");
}

// ── Response parsing ───────────────────────────────────

interface ParsedVerdict {
  readonly verdict: "pass" | "fail";
  readonly concerns: readonly string[];
}

/**
 * Parse a persona response into a structured verdict.
 *
 * Strategy:
 *   1. Try JSON.parse on the first {...} substring.
 *   2. Fall back to regex extraction of "verdict" and "concerns".
 *   3. If nothing matches, throw — the caller converts that to a perspective
 *      error, which is the honest thing to do.
 *
 * Exported for tests — the parser is the fragile surface area.
 */
export function parsePerspectiveResponse(raw: string): ParsedVerdict {
  if (!raw || raw.trim().length === 0) {
    throw new Error("empty response");
  }

  // Strategy 1: extract first JSON object.
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const slice = raw.slice(jsonStart, jsonEnd + 1);
    try {
      const obj = JSON.parse(slice) as unknown;
      if (obj && typeof obj === "object") {
        const verdictRaw = (obj as Record<string, unknown>)["verdict"];
        const concernsRaw = (obj as Record<string, unknown>)["concerns"];
        const verdict = normalizeVerdict(verdictRaw);
        if (verdict !== null) {
          const concerns = normalizeConcerns(concernsRaw);
          return { verdict, concerns };
        }
      }
    } catch {
      // Fall through to regex strategy.
    }
  }

  // Strategy 2: regex fallback.
  const verdictMatch = /["']?verdict["']?\s*[:=]\s*["']?(pass|fail)["']?/i.exec(raw);
  if (verdictMatch && verdictMatch[1]) {
    const verdict = verdictMatch[1].toLowerCase() as "pass" | "fail";
    // Try to pull a concerns array if present.
    const concernsMatch = /["']?concerns["']?\s*[:=]\s*\[([^\]]*)\]/i.exec(raw);
    let concerns: readonly string[] = [];
    if (concernsMatch && concernsMatch[1]) {
      concerns = concernsMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
    }
    return { verdict, concerns };
  }

  throw new Error(`could not parse verdict from response: ${raw.slice(0, 120)}`);
}

function normalizeVerdict(raw: unknown): "pass" | "fail" | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (lower === "pass") return "pass";
  if (lower === "fail") return "fail";
  return null;
}

function normalizeConcerns(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Verifier class ─────────────────────────────────────

/**
 * PreCompletionVerifier — runs a 4-perspective review before task-done.
 *
 * Per-session state only. Construct a new instance per task / session; the
 * instance carries no cross-session accumulation.
 */
export class PreCompletionVerifier {
  private readonly llmQuery: LlmQuery;
  private readonly bypass: boolean;
  private readonly temperature: number;
  private readonly maxTokens: number;
  /** Per-instance counter, useful for diagnostics. No module-global leaks. */
  private runCount = 0;

  constructor(config: PreCompletionVerifierConfig) {
    if (typeof config.llmQuery !== "function") {
      throw new Error("PreCompletionVerifier requires an llmQuery function");
    }
    this.llmQuery = config.llmQuery;
    this.bypass = config.skipPreCompletionVerify === true;
    this.temperature = config.temperature ?? 0;
    this.maxTokens = config.maxTokens ?? 1024;
  }

  /**
   * Run the 4-perspective review in parallel and return the aggregated
   * report. Never throws — provider errors are captured per-perspective in
   * the report.
   */
  async verify(input: VerificationInput): Promise<VerificationReport> {
    if (this.bypass) {
      return this.buildBypassReport();
    }

    this.runCount += 1;
    const start = Date.now();

    const settled = await Promise.allSettled(
      PERSPECTIVES.map((persp) => this.runPerspective(persp, input)),
    );

    const reports: PerspectiveReport[] = settled.map((res, i) => {
      const persp = PERSPECTIVES[i]!;
      if (res.status === "fulfilled") return res.value;
      // Promise rejection is treated as an error perspective, not a fail.
      const err = res.reason instanceof Error ? res.reason.message : String(res.reason);
      return {
        perspective: persp,
        status: "error",
        concerns: [],
        raw: "",
        error: err,
        durationMs: 0,
      };
    });

    return this.aggregateReport(reports, Date.now() - start, false);
  }

  /** Diagnostic: how many verifications this instance has run. */
  getRunCount(): number {
    return this.runCount;
  }

  /** Whether this instance was constructed with bypass mode. */
  isBypassed(): boolean {
    return this.bypass;
  }

  // ── Private ──────────────────────────────────────────

  private async runPerspective(
    perspective: Perspective,
    input: VerificationInput,
  ): Promise<PerspectiveReport> {
    const start = Date.now();
    const prompt = buildPerspectivePrompt(perspective, input);

    let raw: string;
    try {
      raw = await this.llmQuery(prompt, {
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        perspective,
        status: "error",
        concerns: [],
        raw: "",
        error: msg,
        durationMs: Date.now() - start,
      };
    }

    try {
      const parsed = parsePerspectiveResponse(raw);
      return {
        perspective,
        status: parsed.verdict,
        concerns: parsed.concerns,
        raw: raw.trim(),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Parse failure is honest: treat as error, not silent pass.
      return {
        perspective,
        status: "error",
        concerns: [],
        raw: raw.trim(),
        error: `parse failure: ${msg}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private aggregateReport(
    perspectives: readonly PerspectiveReport[],
    totalDurationMs: number,
    bypassed: boolean,
  ): VerificationReport {
    const anyFail = perspectives.some((p) => p.status === "fail");
    const allError = perspectives.every((p) => p.status === "error");
    let overall: "pass" | "fail" | "error";
    if (bypassed) {
      overall = "pass";
    } else if (anyFail) {
      overall = "fail";
    } else if (allError) {
      overall = "error";
    } else {
      overall = "pass";
    }

    const byName = Object.fromEntries(perspectives.map((p) => [p.perspective, p])) as Record<
      Perspective,
      PerspectiveReport
    >;

    const allConcerns = perspectives.flatMap((p) =>
      p.concerns.map((c) => `${p.perspective}: ${c}`),
    );

    return {
      status: overall,
      perspectives,
      implementer: byName.implementer,
      reviewer: byName.reviewer,
      tester: byName.tester,
      user: byName.user,
      bypassed,
      totalDurationMs,
      allConcerns,
    };
  }

  private buildBypassReport(): VerificationReport {
    const empty = (persp: Perspective): PerspectiveReport => ({
      perspective: persp,
      status: "pass",
      concerns: [],
      raw: "",
      durationMs: 0,
    });
    const perspectives = PERSPECTIVES.map(empty);
    return this.aggregateReport(perspectives, 0, true);
  }
}

// ── Formatting helpers (for runtime prompt-injection) ──

/**
 * Format a verification report as a compact agent-readable message. The
 * runtime can inject this into the conversation when a fail is detected so
 * the model gets a fair revision opportunity (ForgeCode pattern).
 */
export function formatVerificationReport(report: VerificationReport): string {
  if (report.bypassed) {
    return "[Pre-Completion Verification: BYPASSED via config.skipPreCompletionVerify]";
  }

  const lines: string[] = [];
  if (report.status === "pass") {
    lines.push("[Pre-Completion Verification: PASS — all 4 perspectives agree]");
    return lines.join("\n");
  }

  if (report.status === "error") {
    lines.push("[Pre-Completion Verification: ERROR — no perspective returned a usable verdict]");
    for (const p of report.perspectives) {
      if (p.error) lines.push(`  [error] ${p.perspective}: ${p.error}`);
    }
    return lines.join("\n");
  }

  lines.push("[Pre-Completion Verification: BLOCKED — at least one perspective flagged a fail]");
  lines.push("");
  for (const p of report.perspectives) {
    const tag = p.status === "pass" ? "PASS" : p.status === "fail" ? "FAIL" : "ERROR";
    lines.push(`  [${tag}] ${p.perspective}:`);
    if (p.status === "error" && p.error) {
      lines.push(`    error: ${p.error}`);
    }
    for (const c of p.concerns) {
      lines.push(`    - ${c}`);
    }
  }
  lines.push("");
  lines.push("Address the FAIL concerns above before declaring the task complete.");
  return lines.join("\n");
}
