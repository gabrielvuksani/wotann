/**
 * TextGrad — critic prompt construction + response parsing.
 *
 * The critic's job: given a prompt + a task + the failing output, produce
 * a structured `TextGradFeedback` describing what went wrong and how to
 * fix it.
 *
 * The critic is itself an LLM. We inject the LLM via a config arg
 * (`TextGradLlm`) so callers can use any provider.
 *
 * Design notes:
 *  - Prompt is asked to return JSON. We parse defensively: if JSON is
 *    malformed we fall back to a heuristic regex extractor and still return
 *    a `TextGradFeedback` with reduced confidence.
 *  - Confidence is forced into [0, 1].
 *  - We never throw on a parse failure — we return a "low-confidence"
 *    feedback so the optimizer can abstain gracefully.
 */

import {
  type TextGradLlm,
  type TaskInstance,
  type TaskFailure,
  type TextGradFeedback,
  type GradientComputeResult,
  validateFeedback,
} from "./textgrad-types.js";

// ── Critic prompt template ─────────────────────────────

const CRITIC_INSTRUCTION = `You are a critic evaluating a prompt that was used to instruct an AI agent.
Your job is to identify why the prompt produced a failing output and suggest a concrete edit.

Respond with a JSON object containing exactly these fields:
- "failure_description": one sentence explaining what went wrong
- "suggested_edit": one sentence describing what to change in the prompt
- "confidence": a number in [0, 1] representing how confident you are in your diagnosis

Do NOT rewrite the entire prompt. Only describe the change.
Do NOT include markdown fences. Output raw JSON only.`;

/**
 * Format the critic prompt. Includes:
 *  - the prompt being evaluated
 *  - the task input
 *  - the actual output (what the prompt produced)
 *  - the expected output (if available) and/or the failure score
 */
export function formatCriticPrompt(
  prompt: string,
  task: TaskInstance,
  failure: TaskFailure,
): string {
  const parts: string[] = [
    CRITIC_INSTRUCTION,
    "",
    "PROMPT BEING EVALUATED:",
    prompt,
    "",
    "TASK INPUT:",
    task.input,
  ];

  if (task.description) {
    parts.push("", "TASK DESCRIPTION:", task.description);
  }

  if (task.expected !== undefined) {
    parts.push("", "EXPECTED OUTPUT:", task.expected);
  }

  parts.push("", "ACTUAL OUTPUT:", failure.actualOutput);

  if (failure.errorMessage) {
    parts.push("", "ERROR MESSAGE:", failure.errorMessage);
  }

  parts.push("", `FAILURE SCORE: ${failure.score.toFixed(2)} (0 = total failure, 1 = perfect)`);
  parts.push("", "Return JSON only:");

  return parts.join("\n");
}

// ── Response parsing ───────────────────────────────────

/**
 * Try to extract a JSON object from a critic response. Critics sometimes
 * wrap the JSON in markdown fences or prose — this strips that.
 */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();

  // Strip markdown fences
  const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const fenced = fencePattern.exec(trimmed);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }

  // Find the first {...} block
  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  const end = trimmed.lastIndexOf("}");
  if (end <= start) return null;

  return trimmed.slice(start, end + 1);
}

/**
 * Defensive parse: try JSON first, fall back to regex extraction with
 * reduced confidence if JSON is malformed.
 */
export function parseGradientResponse(raw: string): GradientComputeResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "empty critic response" };
  }

  const jsonText = extractJson(raw);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const failureDescription =
        typeof parsed["failure_description"] === "string"
          ? (parsed["failure_description"] as string)
          : "";
      const suggestedEdit =
        typeof parsed["suggested_edit"] === "string" ? (parsed["suggested_edit"] as string) : "";
      const confidenceRaw = parsed["confidence"];
      const confidence =
        typeof confidenceRaw === "number" && !Number.isNaN(confidenceRaw)
          ? Math.max(0, Math.min(1, confidenceRaw))
          : 0;

      const feedback: TextGradFeedback = {
        failureDescription,
        suggestedEdit,
        confidence,
        rawCriticResponse: raw,
      };

      const validationError = validateFeedback(feedback);
      if (!validationError) {
        return { ok: true, gradient: feedback };
      }
      // Else fall through to heuristic
    } catch {
      // Fall through to heuristic
    }
  }

  // Heuristic fallback: extract sentences via regex; cap confidence at 0.3.
  return heuristicParse(raw);
}

function heuristicParse(raw: string): GradientComputeResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { ok: false, reason: "no extractable content from critic response" };
  }

  // Take first non-empty line as failure description, second (or repeat first)
  // as suggested edit. Confidence is conservative because parse was lossy.
  const failureDescription = lines[0] ?? "Unable to parse critic response";
  const suggestedEdit = lines[1] ?? lines[0] ?? "Refine the prompt to be more specific";

  const feedback: TextGradFeedback = {
    failureDescription,
    suggestedEdit,
    confidence: 0.2,
    rawCriticResponse: raw,
  };

  const validationError = validateFeedback(feedback);
  if (validationError) {
    return { ok: false, reason: `heuristic parse failed: ${validationError}` };
  }

  return { ok: true, gradient: feedback };
}

// ── Critic invocation ──────────────────────────────────

export interface CriticOptions {
  /**
   * Maximum time the critic LLM is allowed to take (in ms). Caller-provided
   * LLM is responsible for honoring this; we just fail open if it exceeds.
   */
  readonly timeoutMs?: number;
}

/**
 * Ask the critic LLM for a textual gradient. Returns:
 *  - `{ok: true, gradient}` if the critic produced a parseable response
 *  - `{ok: false, reason}` if the critic failed (timeout, empty response, etc.)
 */
export async function runCritic(
  prompt: string,
  task: TaskInstance,
  failure: TaskFailure,
  llm: TextGradLlm,
  options: CriticOptions = {},
): Promise<GradientComputeResult> {
  const criticPrompt = formatCriticPrompt(prompt, task, failure);
  const timeoutMs = options.timeoutMs;

  let response: string;
  try {
    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      response = await withTimeout(llm.query(criticPrompt), timeoutMs);
    } else {
      response = await llm.query(criticPrompt);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `critic model error: ${message}` };
  }

  if (typeof response !== "string" || response.length === 0) {
    return { ok: false, reason: "critic returned empty response" };
  }

  return parseGradientResponse(response);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`critic timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
