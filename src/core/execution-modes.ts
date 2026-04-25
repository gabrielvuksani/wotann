/**
 * T12.19 — Jean Execution Modes (~80 LOC, V9 §T12.19, line 3159).
 *
 * Five first-class execution modes the user can pick at session start
 * or swap mid-session. The mapping from a mode to the underlying
 * permission-mode + edit-policy is centralised here so the runtime,
 * status bar, command palette, onboarding wizard, and plan-mode
 * affordances all share the same source of truth.
 *
 * Why five and not three (plan/build/yolo)? The internal Jean writeup
 * captures three product-marketing labels but the runtime actually
 * needs five distinct permission stances:
 *
 *   - interactive — "approve every action" (current default)
 *   - autopilot   — "let the agent run, but log everything"
 *   - dry-run     — "plan only, no edits, no shell"
 *   - review      — "agent proposes, human merges"
 *   - audit       — "agent observes, no actions, full trace"
 *
 * Each mode carries: a stable string id (used in serialised configs +
 * URL state), a human-readable label, a one-line description, a
 * defaultRiskCap (the highest risk level the mode permits without
 * elevation), and a hint string surfaced in the UI badge.
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: invalid-mode lookups return `{ok:false, …}`,
 *     never throw and never fall back silently.
 *   - QB #7  per-call state: this module exports only frozen constants
 *     and pure helpers. Zero module-global mutable state.
 *   - QB #13 env guard: NEVER reads process.env. Caller threads any
 *     env-derived defaults through a config arg.
 *   - QB #14 commit-claim verification: the test file in
 *     tests/core/execution-modes.test.ts asserts the actual exported
 *     shape, the mapping table, and every helper return value — no
 *     stub-shaped placeholders.
 */

// ── Public Types ──────────────────────────────────────

/** Stable identifier for an execution mode. Used in config files,
 *  URL state, status bar serialization, and CLI flags. Adding a new
 *  mode requires adding to {@link EXECUTION_MODES} and bumping the
 *  exported {@link EXECUTION_MODE_VERSION}. */
export type ExecutionMode = "interactive" | "autopilot" | "dry-run" | "review" | "audit";

/** Risk levels this module references. Mirrors the canonical risk
 *  taxonomy in src/sandbox/execution-environments.ts but kept narrow
 *  here so this module has zero deps on the sandbox layer. */
export type ModeRiskCap = "safe" | "caution" | "dangerous" | "destructive";

export interface ExecutionModeDescriptor {
  /** Stable id — never localized, never user-facing alone. */
  readonly id: ExecutionMode;
  /** Short label for badges, palettes, dropdowns ("Autopilot"). */
  readonly label: string;
  /** One-sentence description for tooltips / wizard explanations. */
  readonly description: string;
  /** Max risk this mode runs without elevation. UI pins/blocks at
   *  this cap — caller can prompt to elevate if user opts in. */
  readonly defaultRiskCap: ModeRiskCap;
  /** Compact hint shown next to the mode badge in the TUI/status bar.
   *  ≤ 32 chars so it fits a 80-col status line. */
  readonly hint: string;
}

// ── Mode Catalog ──────────────────────────────────────

/** Bumped whenever EXECUTION_MODES gains/loses a mode or alters
 *  semantics. Consumers persisting modes (config, session resume)
 *  reference this to migrate stale state. */
export const EXECUTION_MODE_VERSION = 1 as const;

/** Stable catalog. Object.freeze guarantees consumers can't mutate
 *  the descriptor at runtime — every field readonly per QB #6. */
export const EXECUTION_MODES: Readonly<Record<ExecutionMode, ExecutionModeDescriptor>> =
  Object.freeze({
    interactive: Object.freeze({
      id: "interactive",
      label: "Interactive",
      description: "Approve every action — full human-in-the-loop control.",
      defaultRiskCap: "destructive",
      hint: "Approve each step",
    }),
    autopilot: Object.freeze({
      id: "autopilot",
      label: "Autopilot",
      description: "Agent runs to completion; log + journal every step.",
      defaultRiskCap: "dangerous",
      hint: "Run free, log all",
    }),
    "dry-run": Object.freeze({
      id: "dry-run",
      label: "Dry-run",
      description: "Plan only — agent proposes, no edits, no shell.",
      defaultRiskCap: "safe",
      hint: "Plan only",
    }),
    review: Object.freeze({
      id: "review",
      label: "Review",
      description: "Agent proposes diffs; human merges in editor.",
      defaultRiskCap: "caution",
      hint: "Propose, human merges",
    }),
    audit: Object.freeze({
      id: "audit",
      label: "Audit",
      description: "Read-only — agent observes; no actions, full trace.",
      defaultRiskCap: "safe",
      hint: "Read-only trace",
    }),
  });

/** All mode ids, ordered for canonical UI presentation. */
export const EXECUTION_MODE_IDS: readonly ExecutionMode[] = Object.freeze([
  "interactive",
  "autopilot",
  "dry-run",
  "review",
  "audit",
]);

// ── Public Helpers ────────────────────────────────────

/** Type-guard predicate. Use to narrow `unknown` config values to
 *  ExecutionMode without throwing. */
export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === "string" && value in EXECUTION_MODES;
}

/** Result wrapper for lookups — honest stub style (QB #6). Never
 *  throws on bad input; caller branches on `ok`. */
export type ExecutionModeLookup =
  | { readonly ok: true; readonly mode: ExecutionModeDescriptor }
  | { readonly ok: false; readonly error: string };

/** Look up a descriptor by id. Returns `{ok:false, error}` for
 *  unknown ids — caller decides whether to default or surface. */
export function getExecutionMode(id: string): ExecutionModeLookup {
  if (!isExecutionMode(id)) {
    return {
      ok: false,
      error: `Unknown execution mode: "${id}". Valid: ${EXECUTION_MODE_IDS.join(", ")}.`,
    };
  }
  return { ok: true, mode: EXECUTION_MODES[id] };
}

/** Compact human-readable badge text — id, hint, riskCap. Useful for
 *  status bar one-liners. */
export function describeExecutionMode(mode: ExecutionMode): string {
  const m = EXECUTION_MODES[mode];
  return `${m.label} · ${m.hint} (max risk: ${m.defaultRiskCap})`;
}

/** Returns true if the given mode permits the given risk level
 *  without elevation. Risk ordering: safe < caution < dangerous <
 *  destructive. Used by sandbox / approval layers to gate before any
 *  side-effecting tool call. */
export function modePermits(mode: ExecutionMode, risk: ModeRiskCap): boolean {
  const order: Readonly<Record<ModeRiskCap, number>> = Object.freeze({
    safe: 0,
    caution: 1,
    dangerous: 2,
    destructive: 3,
  });
  return order[risk] <= order[EXECUTION_MODES[mode].defaultRiskCap];
}
