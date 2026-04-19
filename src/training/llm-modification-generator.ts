/**
 * LLM-backed ModificationGenerator for the AutoresearchEngine.
 *
 * Replaces the constructor-site no-op generator (`async () => null`) with
 * a real generator that asks the runtime's LLM to propose single-file
 * modifications, parses the structured response, and returns a
 * ModificationProposal the engine can apply + evaluate.
 *
 * Design notes:
 *
 * 1. This module NEVER imports runtime directly — it receives a `query`
 *    callback that returns an async stream of StreamChunks. This keeps the
 *    dependency tree acyclic: runtime constructs the engine, then hands
 *    the engine a closure that wraps `this.query.bind(this)`.
 *
 * 2. The LLM is asked to produce a JSON block containing
 *    `{description, reasoning, modifiedContent}` inside a fenced code
 *    block (```json ... ```). A tolerant extractor locates that block,
 *    strips the fences, and parses. On parse failure the generator
 *    increments an "empty retries" counter, up to a cap, after which it
 *    returns `null` — signalling the engine to stop cycling.
 *
 * 3. History is summarised (not raw-dumped) to keep the prompt bounded.
 *    The last 5 kept modifications + last 5 discarded modifications are
 *    included with their improvement deltas so the LLM can learn from
 *    what worked and avoid repeating what didn't.
 */

import type {
  ModificationGenerator,
  ModificationProposal,
  JournalEntry,
} from "./autoresearch.js";
import type { StreamChunk } from "../providers/types.js";
import type { WotannQueryOptions } from "../core/types.js";

export type QueryStream = (opts: WotannQueryOptions) => AsyncGenerator<StreamChunk>;

export interface LlmGeneratorOptions {
  /** Max empty / unparseable responses in a row before returning null. */
  readonly maxEmptyRetries?: number;
  /** Max tokens the LLM may emit per proposal. Tuned for ~800 LOC files. */
  readonly maxTokens?: number;
  /** Optional model name override (defaults to runtime's active model). */
  readonly model?: string;
  /** Optional system-prompt override (defaults to the built-in). */
  readonly systemPrompt?: string;
  /** Temperature (defaults to 0.4 — low enough for discipline, high enough for exploration). */
  readonly temperature?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are an autonomous code-optimization agent. You propose small,
focused, semantically-preserving modifications to a single TypeScript file
that are likely to improve a given metric (e.g. reduce bundle size, lower
lint count, reduce token count, increase test pass rate).

RULES:
1. Output ONE JSON object inside a fenced \`\`\`json code block.
2. The JSON object MUST have exactly these keys: "description", "reasoning", "modifiedContent".
3. "modifiedContent" is the COMPLETE new file contents — not a patch.
4. Never remove a test, guard, export, or side-effecting call unless you can prove it's safe.
5. Never introduce imports of packages not already in the file.
6. Never exceed +/- 25% of the original file's line count in one proposal.
7. If you cannot find a useful modification, respond with a JSON object
   whose description is "no-op" and whose modifiedContent equals the
   original unchanged — the engine will drop it and try again.

Return ONLY the \`\`\`json ... \`\`\` block. No extra commentary.`;

export function createLlmModificationGenerator(
  query: QueryStream,
  opts: LlmGeneratorOptions = {},
): ModificationGenerator {
  const maxEmpty = opts.maxEmptyRetries ?? 3;
  const maxTokens = opts.maxTokens ?? 8192;
  const temperature = opts.temperature ?? 0.4;
  const systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  let consecutiveEmpty = 0;

  return async (
    targetFile: string,
    currentContent: string,
    history: readonly JournalEntry[],
  ): Promise<ModificationProposal | null> => {
    const prompt = buildPrompt(targetFile, currentContent, history);

    let rawOutput = "";
    try {
      const options: WotannQueryOptions = {
        prompt,
        systemPrompt,
        maxTokens,
        temperature,
        ...(opts.model ? { model: opts.model } : {}),
      };
      for await (const chunk of query(options)) {
        if (chunk.type === "text") rawOutput += chunk.content;
        // Stop early if we've obviously overshot — prevents runaway
        // generations that would still be truncated server-side.
        if (rawOutput.length > maxTokens * 6) break;
      }
    } catch {
      // Treat transport failures as "empty" so we don't loop forever on
      // provider outages.
      consecutiveEmpty++;
      if (consecutiveEmpty >= maxEmpty) return null;
      return null;
    }

    const proposal = parseProposal(rawOutput, currentContent);
    if (!proposal) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= maxEmpty) return null;
      return null;
    }

    // Guard: reject "no-op" proposals that don't actually change the
    // file — they'd consume a cycle with no signal for the engine.
    if (proposal.newContent === currentContent) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= maxEmpty) return null;
      return null;
    }

    // Reset the empty counter on any real proposal; the engine will
    // decide via the metric whether to keep it.
    consecutiveEmpty = 0;
    return proposal;
  };
}

function buildPrompt(
  targetFile: string,
  currentContent: string,
  history: readonly JournalEntry[],
): string {
  const kept = history.filter((h) => h.kept).slice(-5);
  const discarded = history.filter((h) => !h.kept).slice(-5);

  const keptBlock = kept.length
    ? kept
        .map(
          (h, i) =>
            `${i + 1}. [kept, +${h.improvement.toFixed(3)}] ${h.modification.description}\n   reasoning: ${h.modification.reasoning}`,
        )
        .join("\n")
    : "(none yet)";

  const discardedBlock = discarded.length
    ? discarded
        .map(
          (h, i) =>
            `${i + 1}. [discarded, ${h.improvement.toFixed(3)}] ${h.modification.description}`,
        )
        .join("\n")
    : "(none yet)";

  return [
    `TARGET FILE: ${targetFile}`,
    ``,
    `RECENT KEPT MODIFICATIONS (already improved the metric):`,
    keptBlock,
    ``,
    `RECENT DISCARDED MODIFICATIONS (did NOT improve the metric — do not repeat):`,
    discardedBlock,
    ``,
    `CURRENT FILE CONTENTS:`,
    `\`\`\``,
    currentContent,
    `\`\`\``,
    ``,
    `Propose ONE focused modification as a JSON object inside a fenced`,
    `\`\`\`json code block, per the system rules.`,
  ].join("\n");
}

/**
 * Best-effort extractor + parser. Looks for a fenced ```json ... ```
 * block first; falls back to the first {...} brace-balanced span.
 * Returns null when the extracted JSON is missing required fields or
 * the modifiedContent is suspicious (empty / equal to raw output /
 * wildly off from original size).
 */
function parseProposal(rawOutput: string, currentContent: string): ModificationProposal | null {
  if (!rawOutput.trim()) return null;

  const fenced = rawOutput.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const jsonText = fenced?.[1]?.trim() ?? extractFirstBraceBalanced(rawOutput);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const description = typeof obj["description"] === "string" ? obj["description"] : null;
  const reasoning = typeof obj["reasoning"] === "string" ? obj["reasoning"] : null;
  const modifiedContent =
    typeof obj["modifiedContent"] === "string" ? obj["modifiedContent"] : null;

  if (!description || !reasoning || modifiedContent === null) return null;
  if (!modifiedContent.trim()) return null;

  const originalLines = currentContent.split("\n").length;
  const modifiedLines = modifiedContent.split("\n").length;
  // Reject proposals that radically resize the file (>±50% — generous
  // but catches "delete everything" / "duplicate the whole file").
  if (originalLines > 4) {
    const ratio = modifiedLines / originalLines;
    if (ratio < 0.5 || ratio > 2.0) return null;
  }

  return { newContent: modifiedContent, description, reasoning };
}

/** Find the first top-level brace-balanced JSON span in `raw`. */
function extractFirstBraceBalanced(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}
