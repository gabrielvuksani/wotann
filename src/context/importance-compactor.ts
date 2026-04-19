/**
 * Importance-scored conversation compaction.
 *
 * Default compaction drops the OLDEST turns first (FIFO). That loses
 * critical early context — the user's initial goal, key decisions
 * from mid-conversation, the tool call that produced the current
 * file state. Importance-scored compaction instead keeps the
 * TOP-N-by-signal and drops the rest, regardless of age.
 *
 * Signals (weighted sum):
 *   - length: longer turns carry more context (weight 0.2)
 *   - has_tool_call: tool results are often load-bearing (weight 0.3)
 *   - has_question: user questions anchor the task (weight 0.25)
 *   - has_decision_marker: words like "decided", "chose", "picked" (weight 0.15)
 *   - is_first_or_last: bookends anchor intent (weight 0.1)
 *
 * Weights tunable via options. Score ∈ [0, 1].
 */

// ── Types ──────────────────────────────────────────────

export interface Turn {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly timestamp: number;
  readonly metadata?: Record<string, unknown>;
}

export interface ImportanceSignal {
  readonly length: number;
  readonly hasToolCall: number;
  readonly hasQuestion: number;
  readonly hasDecisionMarker: number;
  readonly isFirstOrLast: number;
}

export interface ImportanceScore {
  readonly turn: Turn;
  readonly score: number; // 0-1
  readonly signals: ImportanceSignal;
}

export interface CompactOptions {
  /** Max turns to keep after compaction. Default 20. */
  readonly maxTurns?: number;
  /** Always keep the first N turns (preserves initial goal). Default 2. */
  readonly keepHead?: number;
  /** Always keep the last N turns (preserves current context). Default 3. */
  readonly keepTail?: number;
  /** Signal weights (override defaults). */
  readonly weights?: Partial<{
    readonly length: number;
    readonly hasToolCall: number;
    readonly hasQuestion: number;
    readonly hasDecisionMarker: number;
    readonly isFirstOrLast: number;
  }>;
}

export interface CompactResult {
  readonly kept: readonly Turn[];
  readonly dropped: readonly Turn[];
  readonly scoresByTurnId: ReadonlyMap<string, ImportanceScore>;
}

// ── Scoring ────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  length: 0.2,
  hasToolCall: 0.3,
  hasQuestion: 0.25,
  hasDecisionMarker: 0.15,
  isFirstOrLast: 0.1,
};

const DECISION_RE = /\b(decided|chose|picked|selected|agreed|settled on|will use|going with)\b/i;
const TOOL_CALL_RE = /\b(tool_call|tool_result|<tool_use>|<tool_result>)\b/i;

export function scoreTurn(
  turn: Turn,
  index: number,
  totalTurns: number,
  weights: typeof DEFAULT_WEIGHTS = DEFAULT_WEIGHTS,
): ImportanceScore {
  // Length signal: normalize by longest expected turn (~2000 chars = 1.0)
  const lengthScore = Math.min(1, turn.content.length / 2000);

  const hasToolCall = TOOL_CALL_RE.test(turn.content) ? 1 : 0;
  const hasQuestion = turn.content.includes("?") ? 1 : 0;
  const hasDecisionMarker = DECISION_RE.test(turn.content) ? 1 : 0;
  const isFirstOrLast = index === 0 || index === totalTurns - 1 ? 1 : 0;

  const signals: ImportanceSignal = {
    length: lengthScore,
    hasToolCall,
    hasQuestion,
    hasDecisionMarker,
    isFirstOrLast,
  };

  const score =
    signals.length * weights.length +
    signals.hasToolCall * weights.hasToolCall +
    signals.hasQuestion * weights.hasQuestion +
    signals.hasDecisionMarker * weights.hasDecisionMarker +
    signals.isFirstOrLast * weights.isFirstOrLast;

  const totalWeight =
    weights.length +
    weights.hasToolCall +
    weights.hasQuestion +
    weights.hasDecisionMarker +
    weights.isFirstOrLast;
  const normalized = totalWeight > 0 ? score / totalWeight : 0;

  return { turn, score: normalized, signals };
}

// ── Compactor ──────────────────────────────────────────

export function compactByImportance(
  turns: readonly Turn[],
  options: CompactOptions = {},
): CompactResult {
  const maxTurns = options.maxTurns ?? 20;
  const keepHead = options.keepHead ?? 2;
  const keepTail = options.keepTail ?? 3;
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };

  if (turns.length <= maxTurns) {
    return {
      kept: turns,
      dropped: [],
      scoresByTurnId: new Map(),
    };
  }

  // Score all turns
  const scores = turns.map((turn, idx) => scoreTurn(turn, idx, turns.length, weights));
  const scoresByTurnId = new Map(scores.map((s) => [s.turn.id, s]));

  // Mandatory head + tail
  const headTurns = turns.slice(0, keepHead);
  const tailTurns = turns.slice(-keepTail);
  const mandatoryIds = new Set<string>();
  for (const t of headTurns) mandatoryIds.add(t.id);
  for (const t of tailTurns) mandatoryIds.add(t.id);

  // Remaining budget after mandatory
  const budget = Math.max(0, maxTurns - mandatoryIds.size);

  // Rank non-mandatory turns by score desc
  const middle = scores.filter((s) => !mandatoryIds.has(s.turn.id));
  middle.sort((a, b) => b.score - a.score);
  const keepFromMiddle = new Set(middle.slice(0, budget).map((s) => s.turn.id));

  // Reconstruct in original order
  const kept: Turn[] = [];
  const dropped: Turn[] = [];
  for (const turn of turns) {
    if (mandatoryIds.has(turn.id) || keepFromMiddle.has(turn.id)) {
      kept.push(turn);
    } else {
      dropped.push(turn);
    }
  }

  return { kept, dropped, scoresByTurnId };
}

/**
 * Produce a short summary string of what was dropped — for the
 * model to know "N turns were compacted here".
 */
export function summarizeDropped(result: CompactResult): string {
  if (result.dropped.length === 0) return "";
  const count = result.dropped.length;
  const firstId = result.dropped[0]?.id ?? "?";
  const lastId = result.dropped[result.dropped.length - 1]?.id ?? "?";
  return `[${count} turns compacted: ${firstId}...${lastId}]`;
}
