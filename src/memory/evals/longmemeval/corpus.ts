/**
 * LongMemEval corpus loader.
 *
 * LongMemEval (Wu et al. ICLR 2025) ships three JSON files, each containing
 * 500 evaluation instances:
 *   - longmemeval_s.json      — ~115k-token history (40 sessions)
 *   - longmemeval_m.json      — ~500-session history (paper's "M" scale)
 *   - longmemeval_oracle.json — evidence-only sessions (oracle retrieval)
 *
 * Each instance has:
 *   question_id           — unique id. Ends in "_abs" for abstention questions.
 *   question_type         — one of: single-session-user, single-session-assistant,
 *                           single-session-preference, multi-session,
 *                           temporal-reasoning, knowledge-update.
 *   question              — prompt
 *   answer                — expected model answer
 *   question_date         — ISO date of the question
 *   haystack_session_ids  — list of session IDs (sorted by timestamp for s/m)
 *   haystack_dates        — list of session timestamps
 *   haystack_sessions     — list of sessions, each a list of {role, content, has_answer?} turns
 *   answer_session_ids    — evidence-session IDs (for turn-level recall metrics)
 *
 * This module loads the corpus from:
 *   1. `.wotann/benchmarks/longmemeval/<variant>.json` (if present)
 *   2. a small built-in smoke corpus (10 questions, 2 per ability) as a
 *      fallback so tests + `--skip-download` do something useful.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────

/**
 * Official LongMemEval question types.
 * `_abs` suffix on question_id marks an abstention variant.
 */
export type LongMemEvalQuestionType =
  | "single-session-user"
  | "single-session-assistant"
  | "single-session-preference"
  | "multi-session"
  | "temporal-reasoning"
  | "knowledge-update";

/**
 * One turn within a chat session.
 */
export interface LongMemEvalTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
  /** Marks turns that contain the required evidence (used for recall metrics). */
  readonly has_answer?: boolean;
}

/**
 * One evaluation instance as shipped by the LongMemEval dataset.
 */
export interface LongMemEvalInstance {
  readonly question_id: string;
  readonly question_type: LongMemEvalQuestionType;
  readonly question: string;
  readonly answer: string;
  readonly question_date: string;
  readonly haystack_session_ids: readonly string[];
  readonly haystack_dates: readonly string[];
  readonly haystack_sessions: readonly (readonly LongMemEvalTurn[])[];
  readonly answer_session_ids: readonly string[];
}

export type LongMemEvalVariant = "s" | "m" | "oracle";

/**
 * The five abilities the LongMemEval paper breaks scores down by. These
 * map from question_type + abstention flag as:
 *   information-extraction = single-session-user, single-session-assistant, single-session-preference
 *   multi-session-reasoning = multi-session
 *   temporal                = temporal-reasoning
 *   knowledge-update        = knowledge-update
 *   abstention              = question_id.endsWith("_abs")
 */
export type LongMemEvalAbility =
  | "information-extraction"
  | "multi-session-reasoning"
  | "temporal"
  | "knowledge-update"
  | "abstention";

// ── Ability classification ─────────────────────────────

/**
 * Map a LongMemEval instance to the 5-ability taxonomy used in the paper.
 * Abstention classification (`_abs` suffix) overrides the type-based mapping.
 */
export function abilityFor(instance: LongMemEvalInstance): LongMemEvalAbility {
  if (instance.question_id.endsWith("_abs")) return "abstention";
  switch (instance.question_type) {
    case "single-session-user":
    case "single-session-assistant":
    case "single-session-preference":
      return "information-extraction";
    case "multi-session":
      return "multi-session-reasoning";
    case "temporal-reasoning":
      return "temporal";
    case "knowledge-update":
      return "knowledge-update";
  }
}

// ── Load / fallback ────────────────────────────────────

export interface LoadCorpusOptions {
  /** Which LongMemEval variant to load. Defaults to "s". */
  readonly variant?: LongMemEvalVariant;
  /** When true, skip disk read and use the built-in smoke corpus. */
  readonly skipDownload?: boolean;
  /** Max instances to return after deterministic shuffle (if seed supplied). */
  readonly limit?: number;
  /** Deterministic shuffle seed (Mulberry32). */
  readonly seed?: number;
  /** Override the search directory (default: workingDir/.wotann/benchmarks/longmemeval). */
  readonly corpusDir?: string;
}

/**
 * Load a LongMemEval corpus from disk, or fall back to the smoke corpus.
 *
 * Corpus file expected at
 *   {corpusDir ?? workingDir/.wotann/benchmarks/longmemeval}/longmemeval_{variant}.json
 * as JSON — an array of LongMemEvalInstance objects.
 *
 * If the file is missing and skipDownload is false, throws with a clear
 * message pointing at the HuggingFace URL. If skipDownload is true, falls
 * back to the built-in smoke corpus silently.
 */
export function loadLongMemEvalCorpus(
  workingDir: string,
  opts: LoadCorpusOptions = {},
): readonly LongMemEvalInstance[] {
  const variant = opts.variant ?? "s";
  const corpusDir = opts.corpusDir ?? join(workingDir, ".wotann", "benchmarks", "longmemeval");
  const file = join(corpusDir, `longmemeval_${variant}.json`);

  let instances: readonly LongMemEvalInstance[];
  if (!opts.skipDownload && existsSync(file)) {
    const raw = readFileSync(file, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `LongMemEval corpus at ${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`LongMemEval corpus at ${file} must be a JSON array of instances`);
    }
    instances = parsed.filter(isInstance);
  } else if (opts.skipDownload) {
    instances = SMOKE_CORPUS;
  } else {
    throw new Error(
      `LongMemEval corpus not found at ${file}.\n` +
        `Download with:\n` +
        `  mkdir -p ${corpusDir}\n` +
        `  wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_${variant === "s" ? "s_cleaned" : variant === "m" ? "m_cleaned" : "oracle"}.json -O ${file}\n` +
        `\nOr pass --skip-download to use the built-in 10-question smoke corpus.`,
    );
  }

  let out = [...instances];
  if (typeof opts.seed === "number") {
    out = seededShuffle(out, opts.seed);
  }
  if (typeof opts.limit === "number" && opts.limit > 0) {
    out = out.slice(0, opts.limit);
  }
  return out;
}

// ── Validation ─────────────────────────────────────────

const VALID_TYPES = new Set<LongMemEvalQuestionType>([
  "single-session-user",
  "single-session-assistant",
  "single-session-preference",
  "multi-session",
  "temporal-reasoning",
  "knowledge-update",
]);

function isInstance(raw: unknown): raw is LongMemEvalInstance {
  if (raw === null || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r["question_id"] !== "string") return false;
  if (typeof r["question"] !== "string") return false;
  if (typeof r["answer"] !== "string") return false;
  if (typeof r["question_type"] !== "string") return false;
  if (!VALID_TYPES.has(r["question_type"] as LongMemEvalQuestionType)) return false;
  if (!Array.isArray(r["haystack_sessions"])) return false;
  return true;
}

// ── Deterministic shuffle ──────────────────────────────

function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  let state = seed | 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// ── Smoke corpus ───────────────────────────────────────

/**
 * Built-in 10-instance smoke corpus — 2 per ability. Purpose: smoke tests,
 * `--skip-download`, CI runs that don't have network access. The real
 * 500-question benchmark must be downloaded.
 *
 * Each instance has a tiny 2-4 session haystack so tests execute quickly.
 * Answers are single-token or short phrases to keep the rule-based scorer
 * deterministic.
 */
const SMOKE_CORPUS: readonly LongMemEvalInstance[] = [
  // ── Information extraction (single-session-user) ──────
  {
    question_id: "smoke-ie-01",
    question_type: "single-session-user",
    question: "What is my dog's name?",
    answer: "Luna",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1", "s2"],
    haystack_dates: ["2026-02-01", "2026-02-15"],
    haystack_sessions: [
      [
        {
          role: "user",
          content: "I just adopted a dog named Luna. She's a golden retriever.",
          has_answer: true,
        },
        { role: "assistant", content: "Congratulations! Luna is a lovely name for a golden." },
      ],
      [
        { role: "user", content: "Luna had her first vet visit today." },
        { role: "assistant", content: "How did it go?" },
      ],
    ],
    answer_session_ids: ["s1"],
  },
  {
    question_id: "smoke-ie-02",
    question_type: "single-session-preference",
    question: "What programming language do I prefer for backend work?",
    answer: "Rust",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1"],
    haystack_dates: ["2026-01-20"],
    haystack_sessions: [
      [
        {
          role: "user",
          content:
            "I strongly prefer Rust for backend services because of the memory safety guarantees.",
          has_answer: true,
        },
        { role: "assistant", content: "Got it — Rust it is for your backend work." },
      ],
    ],
    answer_session_ids: ["s1"],
  },

  // ── Multi-session reasoning ────────────────────────────
  {
    question_id: "smoke-ms-01",
    question_type: "multi-session",
    question: "What city did I move to from Toronto?",
    answer: "Berlin",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1", "s2", "s3"],
    haystack_dates: ["2026-01-05", "2026-02-10", "2026-03-01"],
    haystack_sessions: [
      [
        { role: "user", content: "I've lived in Toronto for 5 years.", has_answer: true },
        { role: "assistant", content: "Toronto's a great city." },
      ],
      [
        { role: "user", content: "I got a job offer in Europe!" },
        { role: "assistant", content: "Congrats! Where?" },
      ],
      [
        {
          role: "user",
          content: "Just landed in Berlin — the job starts next week.",
          has_answer: true,
        },
        { role: "assistant", content: "Welcome to Germany." },
      ],
    ],
    answer_session_ids: ["s1", "s3"],
  },
  {
    question_id: "smoke-ms-02",
    question_type: "multi-session",
    question: "What framework does my current project use?",
    answer: "React",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1", "s2"],
    haystack_dates: ["2026-02-01", "2026-03-01"],
    haystack_sessions: [
      [
        { role: "user", content: "I'm starting a new project this month." },
        { role: "assistant", content: "What's the stack?" },
      ],
      [
        {
          role: "user",
          content: "Finalized the stack: React frontend with a Node backend.",
          has_answer: true,
        },
        { role: "assistant", content: "Solid choice." },
      ],
    ],
    answer_session_ids: ["s2"],
  },

  // ── Temporal reasoning ─────────────────────────────────
  {
    question_id: "smoke-tm-01",
    question_type: "temporal-reasoning",
    question: "How many days ago did I start my new job?",
    answer: "14",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1"],
    haystack_dates: ["2026-03-01"],
    haystack_sessions: [
      [
        { role: "user", content: "Today is my first day at the new job.", has_answer: true },
        { role: "assistant", content: "Good luck! Let me know how it goes." },
      ],
    ],
    answer_session_ids: ["s1"],
  },
  {
    question_id: "smoke-tm-02",
    question_type: "temporal-reasoning",
    question: "In what month did I adopt my dog?",
    answer: "February",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1"],
    haystack_dates: ["2026-02-01"],
    haystack_sessions: [
      [
        { role: "user", content: "I just adopted a dog today.", has_answer: true },
        { role: "assistant", content: "What a great day." },
      ],
    ],
    answer_session_ids: ["s1"],
  },

  // ── Knowledge update ───────────────────────────────────
  {
    question_id: "smoke-ku-01",
    question_type: "knowledge-update",
    question: "What is my current phone model?",
    answer: "iPhone 17",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1", "s2"],
    haystack_dates: ["2026-01-01", "2026-03-05"],
    haystack_sessions: [
      [
        { role: "user", content: "I'm using an iPhone 15." },
        { role: "assistant", content: "Solid phone." },
      ],
      [
        { role: "user", content: "Just upgraded — I'm now on the iPhone 17.", has_answer: true },
        { role: "assistant", content: "Nice upgrade." },
      ],
    ],
    answer_session_ids: ["s2"],
  },
  {
    question_id: "smoke-ku-02",
    question_type: "knowledge-update",
    question: "What editor am I using now?",
    answer: "Zed",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1", "s2"],
    haystack_dates: ["2026-02-01", "2026-03-10"],
    haystack_sessions: [
      [
        { role: "user", content: "I use VSCode for everything." },
        { role: "assistant", content: "It's the standard." },
      ],
      [
        {
          role: "user",
          content: "Switched to Zed this week — much faster for my M-series Mac.",
          has_answer: true,
        },
        { role: "assistant", content: "Zed's impressive." },
      ],
    ],
    answer_session_ids: ["s2"],
  },

  // ── Abstention ──────────────────────────────────────────
  {
    question_id: "smoke-abs-01_abs",
    question_type: "single-session-user",
    question: "What is my favorite restaurant?",
    answer: "The user never mentioned a favorite restaurant.",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1"],
    haystack_dates: ["2026-02-20"],
    haystack_sessions: [
      [
        {
          role: "user",
          content: "I had a great meal yesterday but I can't remember the name of the place.",
        },
        { role: "assistant", content: "That happens sometimes." },
      ],
    ],
    answer_session_ids: [],
  },
  {
    question_id: "smoke-abs-02_abs",
    question_type: "single-session-preference",
    question: "What is my annual salary?",
    answer: "The user never discussed salary information.",
    question_date: "2026-03-15",
    haystack_session_ids: ["s1"],
    haystack_dates: ["2026-02-10"],
    haystack_sessions: [
      [
        { role: "user", content: "I got a promotion!" },
        { role: "assistant", content: "Congratulations." },
      ],
    ],
    answer_session_ids: [],
  },
];

/** Exported for tests; do not modify at runtime. */
export const LONGMEMEVAL_SMOKE_CORPUS: readonly LongMemEvalInstance[] = SMOKE_CORPUS;
