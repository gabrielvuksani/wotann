/**
 * Code Mode (C25) — multi-tool-call-in-one-turn executor.
 *
 * From Codex CLI: instead of N model round-trips for a chain of
 * tool calls, the model emits one short JSON script describing the
 * entire sequence, the harness runs it locally, and returns the
 * combined result as a single tool output. Saves 70-90% of context
 * on multi-step workflows.
 *
 * The script is intentionally constrained: sequential steps only,
 * variable references are backwards-only (step B can see step A's
 * output, not vice-versa), no loops, no branches. Keeps the
 * execution trace auditable and bounds the worst-case latency.
 */

// ── Script types ─────────────────────────────────────────────

export interface CodeModeStep {
  readonly id: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  /** If true, failure of this step aborts the whole script. Default true. */
  readonly required?: boolean;
}

export interface CodeModeScript {
  readonly version: 1;
  readonly steps: readonly CodeModeStep[];
}

export interface StepResult {
  readonly id: string;
  readonly tool: string;
  readonly ok: boolean;
  readonly output: unknown;
  readonly error?: string;
  readonly durationMs: number;
}

export interface CodeModeExecution {
  readonly script: CodeModeScript;
  readonly results: readonly StepResult[];
  readonly ok: boolean;
  readonly totalDurationMs: number;
}

// ── Validation ───────────────────────────────────────────────

export interface ValidationProblem {
  readonly stepId: string;
  readonly problem: string;
}

const STEP_ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,47}$/;
const REF_PATTERN = /\$\{([a-zA-Z_][a-zA-Z0-9_]{0,47})(?:\.([a-zA-Z0-9_.]+))?\}/g;

export function validateScript(script: CodeModeScript): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (script.version !== 1) {
    problems.push({ stepId: "-", problem: `unknown version: ${script.version}` });
    return problems;
  }
  if (script.steps.length === 0) {
    problems.push({ stepId: "-", problem: "script has no steps" });
    return problems;
  }
  if (script.steps.length > 20) {
    problems.push({ stepId: "-", problem: "script exceeds 20-step cap" });
    return problems;
  }

  const seenIds = new Set<string>();
  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i]!;
    if (!STEP_ID_PATTERN.test(step.id)) {
      problems.push({ stepId: step.id, problem: `invalid step id: "${step.id}"` });
      continue;
    }
    if (seenIds.has(step.id)) {
      problems.push({ stepId: step.id, problem: `duplicate step id: "${step.id}"` });
      continue;
    }
    seenIds.add(step.id);
    if (typeof step.tool !== "string" || step.tool.length === 0) {
      problems.push({ stepId: step.id, problem: "step missing tool" });
    }
    if (step.args === null || typeof step.args !== "object" || Array.isArray(step.args)) {
      problems.push({ stepId: step.id, problem: "step args must be a plain object" });
    } else {
      // Validate that every ${ref} in args points backwards.
      const refs = extractRefs(step.args);
      for (const ref of refs) {
        if (!seenIds.has(ref)) {
          problems.push({
            stepId: step.id,
            problem: `forward reference to "${ref}" (only backwards refs allowed)`,
          });
        }
      }
    }
  }
  return problems;
}

function extractRefs(args: Record<string, unknown>): readonly string[] {
  const refs: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      for (const m of v.matchAll(REF_PATTERN)) {
        if (m[1]) refs.push(m[1]);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    if (v && typeof v === "object") {
      for (const item of Object.values(v)) walk(item);
    }
  };
  walk(args);
  return refs;
}

// ── Variable substitution ────────────────────────────────────

export function substituteRefs(
  args: Record<string, unknown>,
  context: Record<string, StepResult>,
): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return substituteString(v, context);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(args) as Record<string, unknown>;
}

function substituteString(s: string, context: Record<string, StepResult>): string {
  return s.replace(REF_PATTERN, (_match, id: string, pathStr: string | undefined) => {
    const step = context[id];
    if (!step) return `\${${id}${pathStr ? "." + pathStr : ""}}`;
    // Semantics:
    //   `${s1}`          → step.output (intuitive "value of s1")
    //   `${s1.output}`   → step.output (explicit synonym)
    //   `${s1.X...}`     → step.output.X... (reach into output)
    // This keeps the common case ("give me s1's value") trivial while
    // letting structured output paths work. Metadata fields
    // (tool/error/durationMs) are reached via dedicated helpers, not
    // via path refs, to keep the grammar orthogonal.
    if (!pathStr) {
      return formatResolved(step.output);
    }
    const segments = pathStr.split(".");
    if (segments[0] === "output") segments.shift();
    const resolved = segments.length === 0 ? step.output : resolvePath(step.output, segments);
    return formatResolved(resolved);
  });
}

function formatResolved(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

function resolvePath(root: unknown, segments: readonly string[]): unknown {
  let current: unknown = root;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

// ── Executor ─────────────────────────────────────────────────

/**
 * ToolRunner is the caller-supplied adapter that actually invokes
 * each tool. The executor itself is transport-agnostic — tests can
 * pass a deterministic stub, production wires this to the runtime's
 * tool dispatch.
 */
export type ToolRunner = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<{ readonly ok: boolean; readonly output: unknown; readonly error?: string }>;

export interface ExecuteOptions {
  readonly runner: ToolRunner;
  /** Hard cap on cumulative duration (ms). Default 60_000. */
  readonly budgetMs?: number;
}

export async function executeScript(
  script: CodeModeScript,
  options: ExecuteOptions,
): Promise<CodeModeExecution> {
  const problems = validateScript(script);
  if (problems.length > 0) {
    return {
      script,
      results: problems.map((p) => ({
        id: p.stepId,
        tool: "-",
        ok: false,
        output: null,
        error: p.problem,
        durationMs: 0,
      })),
      ok: false,
      totalDurationMs: 0,
    };
  }

  const budgetMs = options.budgetMs ?? 60_000;
  const start = Date.now();
  const results: StepResult[] = [];
  const context: Record<string, StepResult> = {};

  for (const step of script.steps) {
    const elapsed = Date.now() - start;
    if (elapsed > budgetMs) {
      results.push({
        id: step.id,
        tool: step.tool,
        ok: false,
        output: null,
        error: `budget exceeded (${elapsed}ms > ${budgetMs}ms)`,
        durationMs: 0,
      });
      break;
    }
    const stepStart = Date.now();
    const resolvedArgs = substituteRefs(step.args, context);
    let result: StepResult;
    try {
      const outcome = await options.runner(step.tool, resolvedArgs);
      result = {
        id: step.id,
        tool: step.tool,
        ok: outcome.ok,
        output: outcome.output,
        error: outcome.error,
        durationMs: Date.now() - stepStart,
      };
    } catch (err) {
      result = {
        id: step.id,
        tool: step.tool,
        ok: false,
        output: null,
        error: err instanceof Error ? err.message : "unknown error",
        durationMs: Date.now() - stepStart,
      };
    }
    results.push(result);
    context[step.id] = result;

    if (!result.ok && step.required !== false) {
      break;
    }
  }

  const ok = results.every((r) => r.ok);
  return {
    script,
    results,
    ok,
    totalDurationMs: Date.now() - start,
  };
}
