/**
 * `wotann intent` — spec management + BYOA status/test (P1-C4).
 *
 * Pure handler — returns structured result lines; the `src/index.ts`
 * entrypoint decides exit codes and how to print. No side effects on
 * the shell beyond SPEC.md reads/writes.
 *
 * Actions:
 *   spec-init             Initialize SPEC.md in the workspace
 *   spec-show             Print the current spec
 *   decision-add          Append a decision with rationale
 *   byoa-status           Detect BYOA key, print masked form
 *   byoa-test             Validate BYOA key against Anthropic
 *
 * The caller passes `envOverride` in tests; in production the CLI
 * shell wires it to `{ envVars: process.env, homeDir: homedir() }`.
 * Similarly the validator is injected so tests never hit the network.
 *
 * WOTANN quality bars:
 *  - QB #6 honest failures: `byoa-test` surfaces the distinct
 *    invalid-key vs unreachable errors verbatim.
 *  - QB #7 per-call state: a fresh environment snapshot per call.
 *  - QB #11 scope-bounded: writes only SPEC.md in the workspace.
 */

import {
  addDecision,
  initSpec,
  readSpec,
  SpecNotFoundError,
  specPath,
  type LivingSpecDoc,
} from "../../intent/living-spec.js";
import {
  detectByoa,
  validateByoaKey,
  ByoaKeyInvalidError,
  ByoaValidationUnreachableError,
  type ByoaEnv,
  type ByoaValidator,
} from "../../intent/byoa-detector.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type IntentAction = "spec-init" | "spec-show" | "decision-add" | "byoa-status" | "byoa-test";

export interface IntentCommandOptions {
  readonly action: IntentAction;
  readonly workspaceRoot: string;

  // decision-add
  readonly decision?: string;
  readonly rationale?: string;
  readonly decisionTimestamp?: string;

  // byoa — caller supplies a snapshot of environment so the handler
  // is pure and test-injectable.
  readonly envOverride?: ByoaEnv;

  // byoa-test — validator is injected so tests don't hit the net
  readonly validator?: ByoaValidator;
}

export interface IntentCommandResult {
  readonly success: boolean;
  readonly action: IntentAction;
  readonly lines: readonly string[];
  readonly error?: string;
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function runIntentCommand(
  options: IntentCommandOptions,
): Promise<IntentCommandResult> {
  switch (options.action) {
    case "spec-init":
      return handleSpecInit(options);
    case "spec-show":
      return handleSpecShow(options);
    case "decision-add":
      return handleDecisionAdd(options);
    case "byoa-status":
      return handleByoaStatus(options);
    case "byoa-test":
      return handleByoaTest(options);
    default: {
      const exhaustive: never = options.action;
      return {
        success: false,
        action: options.action,
        lines: [],
        error: `unknown action: ${String(exhaustive)}`,
      };
    }
  }
}

// ── spec handlers ─────────────────────────────────────────────────────────

function handleSpecInit(opts: IntentCommandOptions): IntentCommandResult {
  try {
    initSpec(opts.workspaceRoot);
    return {
      success: true,
      action: "spec-init",
      lines: [`✓ Initialized SPEC.md at ${specPath(opts.workspaceRoot)}`],
    };
  } catch (err) {
    return {
      success: false,
      action: "spec-init",
      lines: [],
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

function handleSpecShow(opts: IntentCommandOptions): IntentCommandResult {
  try {
    const doc = readSpec(opts.workspaceRoot);
    return {
      success: true,
      action: "spec-show",
      lines: formatSpec(doc),
    };
  } catch (err) {
    if (err instanceof SpecNotFoundError) {
      return {
        success: false,
        action: "spec-show",
        lines: [],
        error: `SpecNotFound: SPEC.md not found in ${opts.workspaceRoot}`,
      };
    }
    return {
      success: false,
      action: "spec-show",
      lines: [],
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

function handleDecisionAdd(opts: IntentCommandOptions): IntentCommandResult {
  if (!opts.decision || !opts.rationale) {
    return {
      success: false,
      action: "decision-add",
      lines: [],
      error: "decision-add requires --decision and --rationale",
    };
  }
  try {
    const doc = addDecision(opts.workspaceRoot, {
      decision: opts.decision,
      rationale: opts.rationale,
      ...(opts.decisionTimestamp ? { timestamp: opts.decisionTimestamp } : {}),
    });
    const last = doc.decisionsLog[doc.decisionsLog.length - 1];
    return {
      success: true,
      action: "decision-add",
      lines: [
        `✓ Appended decision (${doc.decisionsLog.length} total)`,
        `  [${last?.timestamp ?? "?"}] ${last?.decision ?? ""}`,
        `  rationale: ${last?.rationale ?? ""}`,
      ],
    };
  } catch (err) {
    return {
      success: false,
      action: "decision-add",
      lines: [],
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

// ── BYOA handlers ─────────────────────────────────────────────────────────

function requireEnv(opts: IntentCommandOptions): ByoaEnv {
  if (opts.envOverride) return opts.envOverride;
  // Fallback to process env — kept narrow so we don't leak globals.
  return {
    envVars: process.env as Readonly<Record<string, string | undefined>>,
    homeDir: process.env["HOME"] ?? process.env["USERPROFILE"] ?? "",
  };
}

function handleByoaStatus(opts: IntentCommandOptions): IntentCommandResult {
  const env = requireEnv(opts);
  const result = detectByoa(env);
  if (!result.detected) {
    return {
      success: true,
      action: "byoa-status",
      lines: ["BYOA: not detected (no ANTHROPIC_API_KEY or ~/.claude.json key found)"],
    };
  }
  return {
    success: true,
    action: "byoa-status",
    lines: [
      `BYOA: detected`,
      `  source: ${result.source}`,
      `  key:    ${result.masked ?? "<unknown>"}`,
    ],
  };
}

async function handleByoaTest(opts: IntentCommandOptions): Promise<IntentCommandResult> {
  const env = requireEnv(opts);
  const detection = detectByoa(env);
  if (!detection.detected || !detection.apiKey) {
    return {
      success: false,
      action: "byoa-test",
      lines: [],
      error: "BYOA key not detected (ANTHROPIC_API_KEY is not set)",
    };
  }
  const validator: ByoaValidator = opts.validator ?? defaultValidator;
  try {
    const res = await validateByoaKey(detection.apiKey, validator);
    return {
      success: true,
      action: "byoa-test",
      lines: [
        `✓ BYOA key validated`,
        `  source: ${detection.source}`,
        `  key:    ${res.maskedKey}`,
      ],
    };
  } catch (err) {
    // Both ByoaKeyInvalidError and ByoaValidationUnreachableError
    // carry only masked text in their messages, so it's safe to
    // surface them directly.
    if (err instanceof ByoaKeyInvalidError) {
      return {
        success: false,
        action: "byoa-test",
        lines: [`✗ BYOA key invalid`, `  key: ${err.maskedKey}`, `  reason: ${err.message}`],
        error: err.message,
      };
    }
    if (err instanceof ByoaValidationUnreachableError) {
      return {
        success: false,
        action: "byoa-test",
        lines: [
          `✗ BYOA validator unreachable`,
          `  key: ${err.maskedKey}`,
          `  reason: ${err.message}`,
        ],
        error: err.message,
      };
    }
    return {
      success: false,
      action: "byoa-test",
      lines: [],
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

/**
 * Production validator: hits Anthropic's `/v1/models` endpoint with
 * the x-api-key header. Cheap (models list is small, cacheable) and
 * the 401 response is the canonical "key is bad" signal.
 *
 * Mocked in tests via `opts.validator`. This function is separated
 * so it stays exactly one fetch call — any change to the real
 * endpoint is a one-line edit.
 */
async function defaultValidator(apiKey: string): Promise<{
  status: number;
  body: unknown;
}> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ── Format helpers ────────────────────────────────────────────────────────

function formatSpec(doc: LivingSpecDoc): readonly string[] {
  const lines: string[] = [];
  lines.push("## Goal");
  lines.push(doc.goal);
  lines.push("");
  lines.push("## Scope");
  if (doc.scope.length === 0) lines.push("  (none)");
  else for (const s of doc.scope) lines.push(`  - ${s}`);
  lines.push("");
  lines.push("## Constraints");
  if (doc.constraints.length === 0) lines.push("  (none)");
  else for (const c of doc.constraints) lines.push(`  - ${c}`);
  lines.push("");
  lines.push("## Decisions Log");
  if (doc.decisionsLog.length === 0) lines.push("  (no decisions)");
  else
    for (const d of doc.decisionsLog) {
      lines.push(`  - [${d.timestamp}] ${d.decision}`);
      lines.push(`    rationale: ${d.rationale}`);
    }
  lines.push("");
  lines.push("## Glossary");
  const terms = Object.keys(doc.glossary);
  if (terms.length === 0) lines.push("  (no terms)");
  else for (const t of terms) lines.push(`  ${t}: ${doc.glossary[t]}`);
  return lines;
}
