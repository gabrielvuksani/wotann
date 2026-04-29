/**
 * Asymmetric embedding prefixes — model-aware query/document text shaping.
 *
 * Inspired by LightRAG's `embedding-prefixes` branch (HKUDS, merged
 * 2026-04-26). Modern instruction-tuned embedding models (BGE,
 * Qwen3-Embedding, intfloat/e5, multilingual-e5) score significantly
 * higher on retrieval benchmarks when queries and documents are
 * embedded with DIFFERENT prefixes — typically "query: " for queries
 * and "passage: " for indexed text. Symmetric encoders (OpenAI's
 * text-embedding-3 family, Cohere embed, Voyage's input_type-driven
 * models) leave the prefixes empty.
 *
 * Why a registry: WOTANN's memory store does not own the embedding
 * model — callers (provider adapters, ingestion scripts) generate the
 * vectors and push them into `MemoryStore.upsertEmbedding` /
 * `temprSearch`'s `embed` callback. To wire prefixes correctly we either
 *   (a) require every caller to apply prefixes themselves, OR
 *   (b) ship a registry that callers can look up by model name.
 * Option (b) keeps the policy in ONE place and lets callers opt in by
 * passing the resolved profile (or just the model name) to the embed
 * call. The registry below is the policy table.
 *
 * Adding a new model: append a `[RegExp, EmbeddingProfile]` tuple to
 * `EMBEDDING_PROFILES`. The first matching pattern wins — order entries
 * from most-specific to least-specific.
 *
 * IMPORTANT — index versioning: applying prefixes to an index that was
 * built WITHOUT prefixes will corrupt similarity scores (the query
 * embedding lives in a slightly different region of vector space than
 * the un-prefixed docs). WOTANN defaults to OFF; callers opt in via the
 * `WOTANN_ASYMMETRIC_EMBEDDINGS=1` environment variable. After enabling,
 * users SHOULD rebuild the vector index — the recommended flow is to
 * delete the existing `vec_embeddings` table and re-ingest. See
 * `MemoryStore.attachVectorBackend` for the table lifecycle.
 */

// ── Types ──────────────────────────────────────────────

export interface EmbeddingProfile {
  readonly queryPrefix: string;
  readonly docPrefix: string;
  /** Human-readable note (cited in logs / docs). Optional. */
  readonly note?: string;
}

// ── Registry ───────────────────────────────────────────

/**
 * Modern instruction-tuned embedding models score better with prefixes.
 * Each entry maps a substring matched against the model name to the
 * recommended prefix pair.
 *
 * Patterns are matched case-insensitively against the model name. The
 * FIRST match wins, so order from most-specific to least-specific.
 */
export const EMBEDDING_PROFILES: ReadonlyArray<readonly [RegExp, EmbeddingProfile]> = [
  // ── BGE family ─────────────────────────────────────
  // BGE small/base/large EN v1.5 use a "Represent this sentence …"
  // prefix on the QUERY side and no prefix on docs. The prefix was
  // baked into the BGE training instruction template, so omitting it
  // costs ~3-5 points of NDCG@10 on MS MARCO.
  [
    /bge-(small|base|large)-en-v1\.5/i,
    {
      queryPrefix: "Represent this sentence for searching relevant passages: ",
      docPrefix: "",
      note: "BGE EN v1.5 — query-side instruction prefix only.",
    },
  ],
  // BGE-M3 is multilingual + multi-functional and was trained without a
  // prefix instruction; leave both sides empty.
  [
    /bge-m3/i,
    {
      queryPrefix: "",
      docPrefix: "",
      note: "BGE-M3 — symmetric, no prefix needed.",
    },
  ],

  // ── Qwen3-Embedding ────────────────────────────────
  // Qwen3-Embedding (and its predecessor) are instruction-tuned with
  // an explicit "Instruct: …\nQuery: " template on the query side.
  // Docs go in raw.
  [
    /qwen3?-embedding/i,
    {
      queryPrefix: "Instruct: Given a query, retrieve documents that semantically match.\nQuery: ",
      docPrefix: "",
      note: "Qwen3-Embedding — instruction template on queries only.",
    },
  ],

  // ── Voyage ─────────────────────────────────────────
  // Voyage's models accept an `input_type` parameter at the API layer
  // (input_type="query" vs input_type="document") rather than a text
  // prefix. The CLIENT must pass the parameter — not us. We leave the
  // prefixes empty here so the registry doesn't double-encode the
  // distinction. Documented for parity / future wiring.
  [
    /voyage-(2|large-2|3|code-2)/i,
    {
      queryPrefix: "",
      docPrefix: "",
      note: "Voyage — uses input_type API parameter (not text prefix). No-op here.",
    },
  ],

  // ── E5 family (intfloat) ───────────────────────────
  // The classic asymmetric pair — "query: " vs "passage: ". The E5
  // README is explicit that the prefix is REQUIRED, not optional;
  // a missing prefix degrades MS MARCO MRR by >10 points.
  [
    /(intfloat\/)?e5-(small|base|large)/i,
    {
      queryPrefix: "query: ",
      docPrefix: "passage: ",
      note: "E5 — classic query:/passage: pair, required by training.",
    },
  ],
  // multilingual-e5 uses the same pair across all language variants.
  [
    /multilingual-e5-/i,
    {
      queryPrefix: "query: ",
      docPrefix: "passage: ",
      note: "multilingual-e5 — same pair as E5 across languages.",
    },
  ],

  // ── Symmetric encoders (no prefix) ─────────────────
  // OpenAI text-embedding-3 (-small / -large), text-embedding-ada-002,
  // and Cohere embed-* are symmetric — no prefix tuning improves recall.
  // Not listed because absent-from-registry returns null (no-op).
];

// ── Lookup ─────────────────────────────────────────────

/**
 * Resolve a model name to the recommended `EmbeddingProfile`. Returns
 * `null` when the model is not in the registry — callers should treat
 * `null` as "embed text raw, no prefixes" (safe default for symmetric
 * encoders like OpenAI text-embedding-3 / Cohere embed).
 *
 * Lookup order: registry entries are checked in declaration order,
 * first match wins. Add new models above existing patterns when you
 * want them to take precedence.
 */
export function getEmbeddingProfile(modelName: string): EmbeddingProfile | null {
  if (!modelName || typeof modelName !== "string") return null;
  for (const [pattern, profile] of EMBEDDING_PROFILES) {
    if (pattern.test(modelName)) return profile;
  }
  return null;
}

// ── Apply helpers ──────────────────────────────────────

/**
 * Prepend the query prefix to a search-time query string.
 *
 * Conservative semantics:
 *   - `null` profile → returns the input unchanged.
 *   - empty `queryPrefix` → returns the input unchanged (avoids
 *     allocating a needless string).
 *
 * @param profile Resolved profile, or `null` for symmetric models.
 * @param query   The raw user query text.
 */
export function applyQueryPrefix(profile: EmbeddingProfile | null, query: string): string {
  if (!profile || profile.queryPrefix.length === 0) return query;
  return profile.queryPrefix + query;
}

/**
 * Prepend the document prefix to an index-time document chunk.
 *
 * Same conservative semantics as `applyQueryPrefix`.
 *
 * @param profile Resolved profile, or `null` for symmetric models.
 * @param doc     The raw document/chunk text.
 */
export function applyDocPrefix(profile: EmbeddingProfile | null, doc: string): string {
  if (!profile || profile.docPrefix.length === 0) return doc;
  return profile.docPrefix + doc;
}

// ── Opt-in gate ────────────────────────────────────────

/**
 * Asymmetric prefixes are gated behind an env-var opt-in. Existing
 * indexes were built without prefixes; turning this on for a populated
 * index will skew similarity scores (mismatch between prefixed query
 * and un-prefixed stored doc vectors). Users opt in by setting
 * `WOTANN_ASYMMETRIC_EMBEDDINGS=1` AND rebuilding their vector index.
 *
 * Returns `true` only when the env var is set to a truthy literal
 * ("1", "true", "yes", "on" — case-insensitive). Anything else,
 * including unset, returns `false`.
 *
 * Callers should use this gate to decide whether to call
 * `applyQueryPrefix` / `applyDocPrefix` at all.
 */
export function isAsymmetricEmbeddingsEnabled(): boolean {
  const v = process.env.WOTANN_ASYMMETRIC_EMBEDDINGS;
  if (!v) return false;
  const normalized = v.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
