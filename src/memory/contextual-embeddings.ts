/**
 * Contextual embeddings — Phase 6 + Phase H wiring.
 *
 * Before embedding a chunk, prepend ~50 tokens of context that describe
 * where the chunk sits in the larger document. Anthropic's 2024
 * "Contextual Retrieval" paper showed +35% recall improvement on
 * retrieval benchmarks when combined with BM25 — with contextual BM25
 * plus contextual embeddings plus reranking, +67%.
 *
 * Example:
 *   raw chunk:      "The return policy is 30 days."
 *   contextual:     "This is from section 3.1 of TechCo's refund policy
 *                    document covering standard retail returns. The return
 *                    policy is 30 days."
 *
 * With the prepended context, retrieval queries like "how long can I
 * return a TechCo item?" match even though the literal phrase "TechCo"
 * never appeared in the raw chunk.
 *
 * This module ships:
 *   - buildContextualChunk(chunk, doc, generator) — single-chunk async
 *   - buildBatchedContextualChunks(chunks, doc, gen, opts) — batch w/ rate limit
 *   - createLlmContextGenerator(query) — LLM-backed context generator factory
 *   - A cost-aware prompt template that caps the context at ~50 tokens
 *   - clampContextTokens(context, maxTokens) — enforce budget post-hoc
 *   - wireContextualIngest(...) — Phase H: a ready-to-use adapter that
 *     wraps an "insert chunk" callback so every inserted chunk is
 *     prefixed with LLM-generated context before indexing.
 *
 * WIRING STATUS (as of Phase H): this module is NOT yet called on ingest
 * by memory-store.ts or observation-extractor.ts. `wireContextualIngest`
 * is the intended integration point — callers construct it once at
 * startup with a cheap-provider LLM (Haiku / Gemma) and pass their
 * existing insert callback. Every inserted chunk then flows through
 * contextualization before embedding. Extractors / stores that still
 * insert raw chunks SHOULD be migrated to call this wrapper.
 *
 * Callers pass chunks through this BEFORE sending to whatever embedding
 * model / vector store they use.
 */

// ── Types ──────────────────────────────────────────────

export interface ContextualChunk {
  /** The original chunk text (for retrieval display / citation). */
  readonly chunk: string;
  /** LLM-generated context (50-100 tokens). */
  readonly context: string;
  /** chunk + context joined with a separator — ready for embedding. */
  readonly contextualized: string;
  /** Optional chunk index within document (for debugging). */
  readonly index?: number;
}

export interface ContextualChunkGenerator {
  readonly generate: (chunk: string, document: string) => Promise<string>;
}

export type LlmQuery = (
  prompt: string,
  options: { readonly maxTokens: number; readonly temperature?: number },
) => Promise<string>;

export interface BatchOptions {
  /** Max concurrent LLM calls. Default 5. */
  readonly concurrency?: number;
  /** Skip chunks where the context would be generated-empty. Default true. */
  readonly skipEmpty?: boolean;
  /** Called after each chunk for progress reporting. */
  readonly onProgress?: (done: number, total: number) => void;
}

// ── Budget constants ───────────────────────────────────

/**
 * Token budget for the generated context. Anthropic's paper uses 50-100.
 * We target 50 — shorter means fewer embed tokens per chunk, lower
 * cost, and less drift from the chunk's own content. Not enforced by
 * the model (LLMs don't count tokens natively); enforced by
 * `clampContextTokens()` post-hoc.
 */
export const TARGET_CONTEXT_TOKENS = 50;

/**
 * Hard upper bound. We throw `maxTokens: 120` to the LLM (generous
 * slack) then clamp after. This prevents runaway context that could
 * dominate the chunk's own semantic signal in the embedding.
 */
export const MAX_CONTEXT_TOKENS = 80;

/**
 * Rough chars-per-token heuristic for English. Accurate tokenization
 * requires the model's tokenizer; this approximation is "good enough"
 * for budget clamping — errs on the side of keeping MORE context
 * rather than less.
 */
const CHARS_PER_TOKEN = 4;

// ── Prompt ─────────────────────────────────────────────

const MAX_DOC_PREVIEW_CHARS = 8000;

function buildContextPrompt(chunk: string, document: string): string {
  const preview =
    document.length > MAX_DOC_PREVIEW_CHARS
      ? `${document.slice(0, MAX_DOC_PREVIEW_CHARS)}\n...[truncated to fit context window]...`
      : document;
  return `You will be given a CHUNK extracted from a larger DOCUMENT. Write a SHORT context (target ${TARGET_CONTEXT_TOKENS} tokens, hard max ${MAX_CONTEXT_TOKENS}, one sentence) that situates the chunk within the document. The context will be PREPENDED to the chunk during retrieval indexing.

Goals:
- Name the document's topic, domain, or source (e.g. "TechCo retail returns policy")
- Name the section or role of the chunk (e.g. "in the restocking-fees section")
- Do NOT repeat the chunk's content verbatim
- Do NOT add information that isn't implied by the document
- Output ONLY the context sentence(s). No preamble. No quotes.

DOCUMENT:
"""
${preview}
"""

CHUNK:
"""
${chunk}
"""

Context:`;
}

/**
 * Clamp a context string to the token budget. Uses a char-based
 * approximation (~4 chars/token for English); over-generous by design
 * so we don't truncate meaningful context. Called automatically by
 * `createLlmContextGenerator` and `wireContextualIngest`.
 */
export function clampContextTokens(
  context: string,
  maxTokens: number = MAX_CONTEXT_TOKENS,
): string {
  if (!context) return "";
  const maxChars = Math.max(1, maxTokens) * CHARS_PER_TOKEN;
  if (context.length <= maxChars) return context;
  // Cut at the last sentence boundary within budget, falling back to a
  // word boundary, falling back to a hard cut.
  const head = context.slice(0, maxChars);
  const lastSentence = Math.max(
    head.lastIndexOf("."),
    head.lastIndexOf("!"),
    head.lastIndexOf("?"),
  );
  if (lastSentence > maxChars * 0.5) {
    return head.slice(0, lastSentence + 1).trim();
  }
  const lastSpace = head.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.5) {
    return head.slice(0, lastSpace).trim();
  }
  return head.trim();
}

// ── Generator factory ─────────────────────────────────

export function createLlmContextGenerator(query: LlmQuery): ContextualChunkGenerator {
  return {
    generate: async (chunk, document) => {
      const prompt = buildContextPrompt(chunk, document);
      const raw = await query(prompt, { maxTokens: 120, temperature: 0 });
      return cleanContext(raw);
    },
  };
}

/**
 * Normalize an LLM-generated context: trim, strip markdown fences, drop
 * lines starting with "Context:" (the model sometimes echoes the label).
 */
export function cleanContext(raw: string): string {
  if (!raw) return "";
  let out = raw.trim();
  // Strip surrounding quotes
  if (out.startsWith('"') && out.endsWith('"')) {
    out = out.slice(1, -1).trim();
  }
  // Strip "Context:" label if the model re-emitted it
  out = out.replace(/^context\s*:\s*/i, "").trim();
  // Strip trailing whitespace after code fences
  out = out
    .replace(/^```.*?\n/, "")
    .replace(/\n```\s*$/, "")
    .trim();
  return out;
}

// ── Single-chunk contextualization ────────────────────

const DEFAULT_SEPARATOR = "\n\n";

export interface BuildOptions {
  /** Separator between context and chunk. Default two newlines. */
  readonly separator?: string;
  /** If context generation returns empty, return the chunk unchanged. Default true. */
  readonly allowEmptyContext?: boolean;
}

export async function buildContextualChunk(
  chunk: string,
  document: string,
  generator: ContextualChunkGenerator,
  options: BuildOptions = {},
): Promise<ContextualChunk> {
  const separator = options.separator ?? DEFAULT_SEPARATOR;
  const allowEmpty = options.allowEmptyContext ?? true;

  if (!chunk.trim()) {
    return { chunk, context: "", contextualized: chunk };
  }

  const context = await generator.generate(chunk, document);
  if (!context && !allowEmpty) {
    throw new Error("buildContextualChunk: generator returned empty context");
  }
  return {
    chunk,
    context,
    contextualized: context ? `${context}${separator}${chunk}` : chunk,
  };
}

// ── Batched contextualization ─────────────────────────

/**
 * Contextualize many chunks concurrently (bounded by concurrency).
 * Order of output matches input. If a chunk generation throws, the
 * chunk is returned with empty context (rather than aborting the batch).
 */
export async function buildBatchedContextualChunks(
  chunks: readonly string[],
  document: string,
  generator: ContextualChunkGenerator,
  options: BatchOptions & BuildOptions = {},
): Promise<readonly ContextualChunk[]> {
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const skipEmpty = options.skipEmpty ?? true;
  const onProgress = options.onProgress;
  const separator = options.separator ?? DEFAULT_SEPARATOR;

  const results: ContextualChunk[] = new Array(chunks.length);
  let nextIndex = 0;
  let doneCount = 0;

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= chunks.length) return;
      const chunk = chunks[idx] ?? "";
      if (skipEmpty && !chunk.trim()) {
        results[idx] = { chunk, context: "", contextualized: chunk, index: idx };
        doneCount++;
        onProgress?.(doneCount, chunks.length);
        continue;
      }
      try {
        const context = await generator.generate(chunk, document);
        results[idx] = {
          chunk,
          context,
          contextualized: context ? `${context}${separator}${chunk}` : chunk,
          index: idx,
        };
      } catch {
        results[idx] = { chunk, context: "", contextualized: chunk, index: idx };
      }
      doneCount++;
      onProgress?.(doneCount, chunks.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
