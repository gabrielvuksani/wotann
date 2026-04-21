/**
 * LLM-as-judge critic helper for CriticRerank (OpenHands-style).
 *
 * The critic evaluates a candidate solution against the task spec and
 * returns a structured score (0..100) with reasoning. We accept the
 * same `LlmQuery` shape used by chain-of-verification (B4 verifier)
 * so critic + verifier + CoVe all share one injection seam.
 *
 * This module is intentionally injection-only — no runtime wiring.
 * The caller passes an LlmQuery; the caller controls model selection,
 * temperature, and cost budget.
 */

import type { LlmQuery } from "./chain-of-verification.js";

// ── Types ──────────────────────────────────────────────

/**
 * Minimal task shape the critic sees. The rerank driver passes the
 * whole task object through so domain-specific context (tests,
 * constraints, etc.) can flow into the critic prompt unmodified.
 */
export interface CriticTask {
  readonly task: string;
  readonly [key: string]: unknown;
}

export interface CriticCandidate {
  readonly output: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CriticScore {
  readonly score: number;
  readonly reasoning: string;
}

export type CriticJudge = (task: CriticTask, candidate: CriticCandidate) => Promise<CriticScore>;

// ── LLM-backed critic factory ──────────────────────────

/**
 * Build a critic that dispatches a single LLM call per candidate,
 * prompting the judge for a JSON `{score, reasoning}` verdict on
 * correctness, code quality, test pass, and security.
 *
 * Parse strategy: strip code fences, find first `{...}` block, JSON.parse,
 * validate shape, clamp score to [0,100]. On malformed output, throw —
 * CriticRerank will honestly mark the rollout as critic-errored rather
 * than silently picking a 0 or a default value.
 */
export function llmQueryCritic(llmQuery: LlmQuery): CriticJudge {
  return async (task, candidate) => {
    const prompt = buildCriticPrompt(task, candidate);
    const raw = await llmQuery(prompt, { temperature: 0 });
    return parseCriticResponse(raw);
  };
}

// ── Prompt construction ────────────────────────────────

export function buildCriticPrompt(task: CriticTask, candidate: CriticCandidate): string {
  const taskDescription = typeof task.task === "string" ? task.task : JSON.stringify(task);
  return [
    "You are a strict code-review critic evaluating a candidate solution.",
    "",
    "Task:",
    taskDescription,
    "",
    "Candidate output:",
    candidate.output,
    "",
    "Rate the candidate on a score from 0 to 100 where:",
    "- 0-30: incorrect, unsafe, or non-functional",
    "- 31-60: partially correct, notable gaps",
    "- 61-85: correct with minor issues",
    "- 86-100: excellent — correct, clean, secure, tested",
    "",
    "Consider: correctness, code quality, likely test pass, security, conciseness.",
    "",
    'Respond ONLY with JSON: {"score": <int 0-100>, "reasoning": "<one sentence>"}',
  ].join("\n");
}

// ── Response parsing ───────────────────────────────────

/**
 * Parse critic response. Tolerates:
 *  - fenced code blocks (```json ... ```)
 *  - leading/trailing whitespace and prose
 *  - extra fields (ignored)
 *
 * Rejects:
 *  - any output without a `{score}` JSON block
 *  - non-numeric score
 *  - missing reasoning (defaults to empty string but keeps scoring)
 */
export function parseCriticResponse(raw: string): CriticScore {
  const trimmed = stripFences(raw).trim();
  const jsonBlock = extractFirstJsonObject(trimmed);
  if (!jsonBlock) {
    throw new Error(`critic returned no parseable JSON object; raw=${truncate(raw, 160)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch (err) {
    throw new Error(
      `critic JSON.parse failed: ${err instanceof Error ? err.message : String(err)}; block=${truncate(jsonBlock, 160)}`,
    );
  }
  if (!isObject(parsed)) {
    throw new Error("critic response was not an object");
  }
  const rawScore = parsed["score"];
  const scoreNum =
    typeof rawScore === "number"
      ? rawScore
      : typeof rawScore === "string"
        ? Number.parseFloat(rawScore)
        : Number.NaN;
  if (!Number.isFinite(scoreNum)) {
    throw new Error(`critic score field missing or non-numeric; got=${JSON.stringify(rawScore)}`);
  }
  const clamped = Math.max(0, Math.min(100, Math.round(scoreNum)));
  const reasoningRaw = parsed["reasoning"];
  const reasoning = typeof reasoningRaw === "string" ? reasoningRaw : "";
  return { score: clamped, reasoning };
}

// ── Helpers ────────────────────────────────────────────

function stripFences(text: string): string {
  // Remove ```json ... ``` or ``` ... ``` fencing.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1];
  return text;
}

function extractFirstJsonObject(text: string): string | null {
  // Scan for first '{', then walk matching braces respecting string literals.
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}
