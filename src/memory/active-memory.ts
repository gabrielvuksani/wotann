/**
 * Active Memory engine (S3-5).
 *
 * Ports the OpenClaw "active memory" pattern: a fast blocking sub-agent
 * that runs BEFORE the main reply and decides whether to (a) extract
 * memory-worthy facts from the user message and write them to memory,
 * or (b) recall relevant prior memory and inject it into the next
 * prompt's context. The whole point is to keep the memory write/read
 * loop tight and synchronous instead of relying on the dream pipeline
 * to catch up async overnight.
 *
 * Architecture:
 *
 *   user prompt
 *      │
 *      ▼
 *   classifyMessage → "fact" | "preference" | "decision" | "question" | "other"
 *      │
 *      ├─ fact|preference|decision → extractObservations + memoryStore.write
 *      │
 *      └─ question → memoryStore.search(prompt) + return context for injection
 *      │
 *      ▼
 *   main runtime.query() runs with memory now warm
 *
 * Classifier is intentionally pattern-based (not LLM) for speed —
 * pre-query extraction MUST stay synchronous + cheap or the whole
 * pipeline slows down. Pattern hits are high-precision (only fire on
 * very confident signals); recall on borderline cases falls to the
 * existing dream pipeline which has the time budget for LLM extraction.
 */

import type { MemoryStore } from "./store.js";

export type MessageClass = "fact" | "preference" | "decision" | "question" | "other";

export interface ExtractedObservation {
  readonly type: MessageClass;
  readonly content: string;
  readonly confidence: number;
  readonly source: "active-memory";
}

export interface ActiveMemoryResult {
  /** Classification of the user message. */
  readonly classification: MessageClass;
  /** Observations extracted from the message (zero or more). */
  readonly observations: readonly ExtractedObservation[];
  /** Relevant prior memory to inject into the next prompt's context. */
  readonly contextPrefix: string | null;
  /** Total time spent in active-memory pre-processing. */
  readonly durationMs: number;
}

// ── Pattern-based classifier ────────────────────────────────

const PREFERENCE_PATTERNS: readonly RegExp[] = [
  /\bI (prefer|like|love|hate|dislike|always|never)\b/i,
  /\bdon'?t (do|use|like|want)\b/i,
  /\bplease (always|never|stop|don'?t|do)\b/i,
  /\bmy preference is\b/i,
  /\bI want you to\b/i,
];

const DECISION_PATTERNS: readonly RegExp[] = [
  /\bwe (decided|chose|picked|went with|are using)\b/i,
  /\blet'?s (use|go with|pick|choose)\b/i,
  /\bwe'?ll (use|go with|stick with)\b/i,
  /\bdecision: /i,
  /\bI'?m (going|gonna) (to )?use\b/i,
];

const FACT_PATTERNS: readonly RegExp[] = [
  /\bmy (name|email|phone|address|company|role|team) is\b/i,
  /\bthe (project|repo|database|server|api) is\b/i,
  /\bI work (at|for|on|with)\b/i,
  /\b(my|our) (deadline|target|goal|priority) is\b/i,
];

const QUESTION_PATTERNS: readonly RegExp[] = [
  /\b(what|which|where|when|who|why|how) (is|are|do|did|can|should|would|could)\b/i,
  /\?\s*$/, // ends with question mark
  /\bremember\b/i,
  /\brecall\b/i,
  /\b(do|did) you (know|remember)\b/i,
];

function classifyMessage(message: string): MessageClass {
  // Order matters — more-specific patterns first.
  if (DECISION_PATTERNS.some((p) => p.test(message))) return "decision";
  if (PREFERENCE_PATTERNS.some((p) => p.test(message))) return "preference";
  if (FACT_PATTERNS.some((p) => p.test(message))) return "fact";
  if (QUESTION_PATTERNS.some((p) => p.test(message))) return "question";
  return "other";
}

/**
 * Extract structured observations from a classified message. Stays
 * pattern-based — no LLM call — to keep the pre-query path under
 * 50ms even on slow systems.
 */
function extractObservations(
  message: string,
  classification: MessageClass,
): readonly ExtractedObservation[] {
  if (classification === "other" || classification === "question") return [];
  // Trim to a sensible length for storage; the full message is in
  // session history anyway.
  const content = message.length > 500 ? message.slice(0, 500) + "…" : message;
  return [
    {
      type: classification,
      content,
      confidence: 0.85, // pattern-based: high confidence by construction
      source: "active-memory",
    },
  ];
}

// ── Memory recall for question messages ─────────────────────

/**
 * Minimum length for a recall token. One-char tokens produce FTS5
 * noise and very short stopwords (e.g., "do", "is") explode the
 * match set with no signal.
 */
const MIN_RECALL_TOKEN_LEN = 3;

/**
 * Stopwords dropped before building the FTS5 query. Pattern-based
 * classification has already fired, so we're safe to aggressively
 * strip function words here.
 */
const RECALL_STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "what",
  "which",
  "where",
  "when",
  "who",
  "why",
  "how",
  "did",
  "does",
  "was",
  "are",
  "you",
  "your",
  "have",
  "has",
  "had",
  "can",
  "should",
  "would",
  "could",
  "about",
  "from",
  "into",
  "onto",
  "some",
  "any",
  "all",
  "not",
]);

/**
 * MemoryStore.search() passes its `query` argument directly to FTS5's
 * MATCH clause, which has a strict operator syntax. Natural-language
 * questions like `"What did we decide about OAuth?"` contain operator
 * characters (`?`, `"`, `.`, `:`, `-`) and throw
 * `fts5: syntax error near "?"`. Sanitizing the query here keeps the
 * fix contained to active-memory (out-of-scope files are not touched).
 *
 * Strategy: tokenize on non-alphanumeric characters, drop stopwords
 * and tokens shorter than `MIN_RECALL_TOKEN_LEN`, de-duplicate, and
 * join with " OR " so FTS5 treats the list as a Boolean union.
 */
function toFtsQuery(message: string): string | null {
  const tokens = message
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= MIN_RECALL_TOKEN_LEN && !RECALL_STOPWORDS.has(t));
  const unique = Array.from(new Set(tokens));
  if (unique.length === 0) return null;
  // Cap token count — very long prompts otherwise generate huge MATCH
  // expressions that hurt perf without improving recall.
  return unique.slice(0, 12).join(" OR ");
}

/**
 * For question messages, search memory for relevant prior facts /
 * preferences / decisions and format them as a context prefix the
 * runtime can prepend to the user prompt. Capped at 3 results to
 * avoid context-window pressure.
 */
function recallContext(message: string, memoryStore: MemoryStore | null): string | null {
  if (!memoryStore) return null;
  const query = toFtsQuery(message);
  if (!query) return null;
  try {
    // MemoryStore.search() returns `readonly MemorySearchResult[]` where
    // each row is `{entry: MemoryEntry, score, snippet}` and the content
    // string lives at `entry.value`. Earlier versions of this recall
    // filter read `r.content` which silently rejected every row (Master
    // Plan V8 P0-5 — active recall always returned null). The guard
    // below is defensive: treat each row as possibly-unshaped, extract
    // entry.value honestly, and skip anything that doesn't provide a
    // string value.
    const search = (
      memoryStore as unknown as {
        search?: (q: string, limit: number) => ReadonlyArray<{ entry?: { value?: unknown } }>;
      }
    ).search;
    if (typeof search !== "function") return null;
    const results = search.call(memoryStore, query, 3) ?? [];
    if (results.length === 0) return null;
    const values: string[] = [];
    for (const r of results) {
      const value = r?.entry?.value;
      if (typeof value === "string" && value.length > 0) {
        values.push(value);
      }
    }
    if (values.length === 0) return null;
    const formatted = values.map((v) => `- ${v.slice(0, 200)}`).join("\n");
    return `[Active Memory recall — ${values.length} relevant entries from prior sessions]\n${formatted}\n\n---\n\n`;
  } catch {
    return null;
  }
}

// ── Engine ──────────────────────────────────────────────────

/**
 * Active Memory engine. Constructed once per runtime; preprocess()
 * runs before each user prompt to extract / recall in one synchronous
 * pass. Returns the classification + extracted observations + context
 * prefix the runtime should prepend to the next query.
 */
export class ActiveMemoryEngine {
  constructor(private readonly memoryStore: MemoryStore | null) {}

  preprocess(userMessage: string, sessionId?: string): ActiveMemoryResult {
    const start = Date.now();
    const classification = classifyMessage(userMessage);
    const observations = extractObservations(userMessage, classification);

    // Write extracted observations to memory store synchronously. Done
    // before recall so a self-referential question can pick up its own
    // immediate context (rare but useful: "I prefer X. What did I just
    // say I prefer?").
    if (observations.length > 0 && this.memoryStore) {
      try {
        for (const obs of observations) {
          this.memoryStore.captureEvent(
            `active-memory-${obs.type}`,
            obs.content,
            "active-memory",
            sessionId ?? "active-memory",
          );
        }
      } catch {
        // Memory write failures must never block the main query.
      }
    }

    // Recall is question-only.
    const contextPrefix =
      classification === "question" ? recallContext(userMessage, this.memoryStore) : null;

    return {
      classification,
      observations,
      contextPrefix,
      durationMs: Date.now() - start,
    };
  }
}

/** Convenience factory for callers that want a default engine. */
export function createActiveMemoryEngine(memoryStore: MemoryStore | null): ActiveMemoryEngine {
  return new ActiveMemoryEngine(memoryStore);
}
