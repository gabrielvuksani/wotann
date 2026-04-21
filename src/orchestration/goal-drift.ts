/**
 * GoalDriftDetector — warns when agent actions don't match pending todos.
 * OpenHands port (P1-B7, part 2).
 *
 * Pattern: every N turns (configurable, default 5) the harness snapshots
 * the last N actions and asks this detector "did the agent drift from
 * the todo.md checklist?" If so, emits a warning with the reason and
 * lets the caller either (a) extend the todo with the new scope or
 * (b) return the agent to the original scope.
 *
 * Heuristic relevance (substring / token-overlap) is the cheap default.
 * An injectable `LlmQuery` can be supplied for semantic relevance when
 * keyword match is too shallow — this follows the same pattern as B4
 * (pre-completion verifier) and B10 (critic rerank): the detector is
 * provider-agnostic and test-friendly.
 *
 * Design notes (WOTANN quality bars):
 * - QB #6 honest failures: LLM errors surface as a fallback to
 *   heuristic with an explicit `method: "heuristic"` label. Heuristic
 *   never silently returns "no drift" — every return has a reason.
 * - QB #7 per-session state: the detector is effectively pure;
 *   `checkAction` never mutates instance state.
 * - QB #14 real wiring: the only place that decides "drift" is
 *   `evaluate()`; `checkAction` and `checkActions` both delegate to it.
 */

import type { TodoState } from "./todo-tracker.js";

// Public types ---------------------------------------------

export interface AgentAction {
  /** Short machine label (e.g., `edit_file`, `run_shell`). */
  readonly kind: string;
  /** Human-readable description. What the agent is about to do. */
  readonly description: string;
  /** Optional target (filename, url, etc.) used for relevance scoring. */
  readonly target?: string;
  /** Optional freeform rationale the agent gave. */
  readonly rationale?: string;
}

export interface DriftAssessment {
  /** True if the action doesn't match any pending todo. */
  readonly drift: boolean;
  /** Human-readable reason for the conclusion. */
  readonly reason: string;
  /** Relevance score 0..1 against the most-relevant pending todo. */
  readonly bestRelevance: number;
  /** Id of the most-relevant pending todo, or null if there are none. */
  readonly bestMatchSubgoalId: string | null;
  /** Which check fired: heuristic or llm. */
  readonly method: "heuristic" | "llm";
}

/**
 * Minimal LLM interface the detector needs. Callers pass any adapter
 * (real provider, mock, router) that matches this shape.
 */
export type LlmQuery = (prompt: string) => Promise<string>;

export interface GoalDriftConfig {
  /** Heuristic relevance floor under which drift is reported. Default 0.18. */
  readonly driftThreshold?: number;
  /** When provided, the detector can route hard cases through this LLM. */
  readonly llm?: LlmQuery;
  /**
   * If true and `llm` is set, every check goes through the LLM. If
   * false, the LLM is only consulted when the heuristic is uncertain
   * (relevance in [floor, floor + ambiguityBand]). Default false.
   */
  readonly alwaysUseLlm?: boolean;
  /** Heuristic ambiguity band above the floor where LLM assists. Default 0.1. */
  readonly ambiguityBand?: number;
  /** Per-LLM-call timeout ms. Default 10_000. */
  readonly llmTimeoutMs?: number;
}

// Errors ---------------------------------------------------

export class GoalDriftLlmError extends Error {
  constructor(reason: string) {
    super(`goal-drift llm check failed: ${reason}`);
    this.name = "GoalDriftLlmError";
  }
}

// Detector -------------------------------------------------

export class GoalDriftDetector {
  private readonly driftThreshold: number;
  private readonly llm?: LlmQuery;
  private readonly alwaysUseLlm: boolean;
  private readonly ambiguityBand: number;
  private readonly llmTimeoutMs: number;

  constructor(config: GoalDriftConfig = {}) {
    const threshold = config.driftThreshold ?? 0.18;
    if (threshold < 0 || threshold > 1) {
      throw new Error(`driftThreshold must be in [0, 1], got ${threshold}`);
    }
    this.driftThreshold = threshold;
    if (config.llm) this.llm = config.llm;
    this.alwaysUseLlm = config.alwaysUseLlm ?? false;
    const band = config.ambiguityBand ?? 0.1;
    if (band < 0) throw new Error(`ambiguityBand must be non-negative, got ${band}`);
    this.ambiguityBand = band;
    this.llmTimeoutMs = config.llmTimeoutMs ?? 10_000;
  }

  /** Check one action. No state is mutated. */
  async checkAction(state: TodoState, action: AgentAction): Promise<DriftAssessment> {
    return this.evaluate(state, action);
  }

  /** Check a batch of recent actions; drift if ANY of them drifts. */
  async checkActions(state: TodoState, actions: readonly AgentAction[]): Promise<DriftAssessment> {
    if (actions.length === 0) {
      return {
        drift: false,
        reason: "no actions to evaluate",
        bestRelevance: 0,
        bestMatchSubgoalId: null,
        method: "heuristic",
      };
    }
    let worst: DriftAssessment | null = null;
    for (const action of actions) {
      const assessment = await this.evaluate(state, action);
      if (assessment.drift) {
        return assessment;
      }
      if (!worst || assessment.bestRelevance < worst.bestRelevance) {
        worst = assessment;
      }
    }
    if (!worst) {
      // unreachable — loop ran at least once
      throw new Error("checkActions: internal — no assessment produced");
    }
    return worst;
  }

  // Internals -----------------------------------------------

  private async evaluate(state: TodoState, action: AgentAction): Promise<DriftAssessment> {
    if (state.pending.length === 0) {
      return {
        drift: false,
        reason: "no pending todos — nothing to drift from",
        bestRelevance: 0,
        bestMatchSubgoalId: null,
        method: "heuristic",
      };
    }

    // Heuristic pass first. Always runs — LLM only ever adjusts it.
    const scored = state.pending.map((sg) => ({
      id: sg.id,
      description: sg.description,
      score: scoreRelevance(action, sg.description),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top) {
      // Defensive — pending.length>0 guaranteed above.
      return {
        drift: false,
        reason: "no pending todos",
        bestRelevance: 0,
        bestMatchSubgoalId: null,
        method: "heuristic",
      };
    }

    // When do we use the LLM?
    const inAmbiguityBand =
      top.score >= this.driftThreshold && top.score < this.driftThreshold + this.ambiguityBand;
    const hasLlm = this.llm !== undefined;
    const useLlm =
      hasLlm && (this.alwaysUseLlm || inAmbiguityBand || top.score < this.driftThreshold);

    if (useLlm) {
      const llmResult = await this.runLlm(state, action);
      if (llmResult) {
        return {
          ...llmResult,
          bestMatchSubgoalId: llmResult.bestMatchSubgoalId ?? top.id,
          method: "llm",
        };
      }
      // LLM failed — fall through to heuristic rather than silently assume "no drift".
    }

    const drift = top.score < this.driftThreshold;
    const reason = drift
      ? `no pending todo matched action '${action.description}' (best relevance ${top.score.toFixed(2)} < threshold ${this.driftThreshold.toFixed(2)})`
      : `action '${action.description}' matches subgoal '${top.description}' (relevance ${top.score.toFixed(2)})`;
    return {
      drift,
      reason,
      bestRelevance: top.score,
      bestMatchSubgoalId: top.id,
      method: "heuristic",
    };
  }

  private async runLlm(
    state: TodoState,
    action: AgentAction,
  ): Promise<Omit<DriftAssessment, "method"> | null> {
    if (!this.llm) return null;
    const prompt = buildLlmPrompt(state, action);
    try {
      const raw = await withTimeout(this.llm(prompt), this.llmTimeoutMs, "goal-drift llm timeout");
      return parseLlmVerdict(raw);
    } catch (_err) {
      // Surface failure but don't throw — caller sees `method: heuristic` fallback.
      return null;
    }
  }
}

// Helpers --------------------------------------------------

function scoreRelevance(action: AgentAction, subgoal: string): number {
  const actionText = [action.description, action.target ?? "", action.rationale ?? "", action.kind]
    .filter((s) => s.length > 0)
    .join(" ");
  const actionTokens = tokenize(actionText);
  const subgoalTokens = tokenize(subgoal);
  if (actionTokens.size === 0 || subgoalTokens.size === 0) return 0;

  // Jaccard over normalized token sets — cheap and deterministic.
  let intersection = 0;
  for (const tok of actionTokens) {
    if (subgoalTokens.has(tok)) intersection++;
  }
  const union = actionTokens.size + subgoalTokens.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  // Boost when any subgoal token is also a substring of the action
  // description (catches "add X" vs "adding X").
  let substringHits = 0;
  const descLower = action.description.toLowerCase();
  for (const tok of subgoalTokens) {
    if (tok.length >= 4 && descLower.includes(tok)) substringHits++;
  }
  const substringBoost = Math.min(0.3, substringHits * 0.08);

  return Math.min(1, jaccard + substringBoost);
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of s.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (!tok) continue;
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

function buildLlmPrompt(state: TodoState, action: AgentAction): string {
  const subgoals = state.pending.map((s, i) => `${i + 1}. ${s.description}`).join("\n");
  const lines: string[] = [
    "You are judging whether an agent's next action drifts from its todo list.",
    "",
    "Pending todos:",
    subgoals,
    "",
    "Agent action:",
    `  kind: ${action.kind}`,
    `  description: ${action.description}`,
  ];
  if (action.target) lines.push(`  target: ${action.target}`);
  if (action.rationale) lines.push(`  rationale: ${action.rationale}`);
  lines.push("");
  lines.push("Respond with one line in the form:");
  lines.push("  DRIFT=<yes|no> REASON=<short reason>");
  lines.push("Nothing else.");
  return lines.join("\n");
}

function parseLlmVerdict(raw: string): Omit<DriftAssessment, "method"> | null {
  const line = raw.trim().split(/\r?\n/)[0] ?? "";
  const driftMatch = /DRIFT=(yes|no)/i.exec(line);
  const reasonMatch = /REASON=(.+)$/i.exec(line);
  if (!driftMatch || !driftMatch[1]) return null;
  const drift = driftMatch[1].toLowerCase() === "yes";
  const reason = reasonMatch?.[1]?.trim() ?? (drift ? "llm flagged drift" : "llm saw no drift");
  return {
    drift,
    reason,
    bestRelevance: drift ? 0 : 1,
    bestMatchSubgoalId: null,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new GoalDriftLlmError(label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
