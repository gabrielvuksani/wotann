/**
 * T12.2 — Terminus-KIRA completion-checklist trick (~60 LOC, V9 §T12.2,
 * line 1685, line 1723–1731).
 *
 * Build a structured task-completion checklist that the
 * pre-completion-verifier agent prepends to its system prompt before
 * declaring a task done. The 6 questions below come verbatim from the
 * V9 spec; this module exposes both the canonical default list and a
 * builder that callers can extend with task-specific items (e.g., "did
 * you regenerate the OpenAPI client?", "did the migration apply
 * cleanly?").
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: invalid input returns `{ok:false, error}`,
 *     never silently drops bad items or returns a stub-shaped success.
 *   - QB #7  per-call state: zero module globals; the canonical list
 *     is a frozen constant, every helper is pure.
 *   - QB #13 env guard: never reads process.env; caller threads any
 *     env-conditioned items via the extras arg.
 *   - QB #14 commit-claim verification: tests assert the canonical
 *     list shape AND the renderer output AND the builder rejection
 *     of malformed extras.
 */

// ── Public Types ──────────────────────────────────────

export interface ChecklistItem {
  /** Stable id for selective skipping / reporting. Lowercased,
   *  hyphen-separated. */
  readonly id: string;
  /** The question the verifier asks itself, ending in "?". */
  readonly question: string;
  /** Categorical tag — informational only. */
  readonly category: "tests" | "types" | "lint" | "docs" | "hygiene" | "custom";
  /** When true (default), the item BLOCKS completion until satisfied.
   *  When false, the verifier may surface a soft warning and continue. */
  readonly required: boolean;
}

export interface ChecklistBuildResult {
  readonly ok: true;
  readonly items: readonly ChecklistItem[];
}

export interface ChecklistBuildError {
  readonly ok: false;
  readonly error: string;
}

export type ChecklistResult = ChecklistBuildResult | ChecklistBuildError;

// ── Canonical 6-item checklist (V9 §T12.2 line 1723–1731) ──

export const COMPLETION_CHECKLIST_ITEMS: readonly ChecklistItem[] = Object.freeze([
  Object.freeze({
    id: "tsc-noemit",
    question: "Did you run `npx tsc --noEmit` and get rc=0?",
    category: "types",
    required: true,
  }),
  Object.freeze({
    id: "vitest-run",
    question: "Did you run `npx vitest run` and no new failures?",
    category: "tests",
    required: true,
  }),
  Object.freeze({
    id: "lint",
    question: "Did you run lint (`npm run lint` or eslint)?",
    category: "lint",
    required: true,
  }),
  Object.freeze({
    id: "pr-message",
    question: "Is the PR description / commit message filled out?",
    category: "docs",
    required: true,
  }),
  Object.freeze({
    id: "no-todos",
    question: "Did you scrub TODO/FIXME/XXX added to changed files?",
    category: "hygiene",
    required: true,
  }),
  Object.freeze({
    id: "doc-sync",
    question: "Did you update docs (README / CHANGELOG / inline JSDoc) for public API changes?",
    category: "docs",
    required: true,
  }),
]);

// ── Public API ────────────────────────────────────────

/**
 * Build a checklist by combining the canonical 6 with optional
 * caller-supplied extras. Returns honest-stub error result on
 * malformed extras. Item ids must be unique across the merged list.
 */
export function buildCompletionChecklist(
  extras: readonly Partial<ChecklistItem>[] = [],
): ChecklistResult {
  if (!Array.isArray(extras)) {
    return { ok: false, error: "completion-checklist: extras must be an array" };
  }
  const items: ChecklistItem[] = [...COMPLETION_CHECKLIST_ITEMS];
  const seen = new Set(items.map((i) => i.id));
  for (const e of extras) {
    if (!e || typeof e !== "object") {
      return { ok: false, error: "completion-checklist: each extra must be an object" };
    }
    if (typeof e.id !== "string" || e.id.length === 0) {
      return { ok: false, error: "completion-checklist: each extra needs a non-empty id" };
    }
    if (typeof e.question !== "string" || e.question.length === 0) {
      return {
        ok: false,
        error: `completion-checklist: extra "${e.id}" needs a non-empty question`,
      };
    }
    if (seen.has(e.id)) {
      return {
        ok: false,
        error: `completion-checklist: duplicate id "${e.id}"`,
      };
    }
    seen.add(e.id);
    items.push({
      id: e.id,
      question: e.question,
      category: e.category ?? "custom",
      required: e.required ?? true,
    });
  }
  return { ok: true, items };
}

/**
 * Render a checklist as a Markdown numbered list suitable for
 * prepending to a verifier system prompt. Required items get a `[ ]`
 * checkbox; optional items get `[?]` so the verifier can distinguish.
 */
export function renderChecklistMarkdown(items: readonly ChecklistItem[]): string {
  if (items.length === 0) return "";
  const lines: string[] = ["## Completion Checklist", ""];
  let i = 1;
  for (const item of items) {
    const box = item.required ? "[ ]" : "[?]";
    lines.push(`${String(i)}. ${box} ${item.question}`);
    i++;
  }
  return lines.join("\n");
}
