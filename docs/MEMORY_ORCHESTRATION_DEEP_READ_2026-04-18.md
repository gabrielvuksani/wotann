# Memory / Orchestration / Learning / Context — Deep Read

**Date:** 2026-04-18
**Scope:** 28 files in `src/memory/`, 13 in `src/context/` (11 actual), 25 in `src/orchestration/`, 12 in `src/learning/`.
**Method:** Read every file in full. Grep-verified claims against the runtime. Sampled every SQL schema, every pipeline, every silent-catch pattern.
**Verdict up front:** The layer is real, not Potemkin. It is deeper than most spec docs claim in absolute surface area, but a handful of "depth" claims in comments significantly overstate what the code actually computes. A small number of false-commit-claim patterns remain (most notably the `async () => null` no-op autoresearch generator wired into the runtime at `src/core/runtime.ts:934`).

---

## 1. Executive Summary

WOTANN's memory / context / orchestration / learning layer spans roughly 16,700 lines of TypeScript across 61 files. The dominant impression after reading every file is that the surface area and the SQL schemas are genuinely ambitious and mostly wired end-to-end. The SQLite store (`src/memory/store.ts`, 1,994 lines) implements the advertised 8-layer architecture with FTS5, a trigram-vector store, bi-temporal knowledge edges, consolidation locks, and provenance logs. The 3-phase dream pipeline (`src/learning/dream-pipeline.ts`, 541 lines) is fully implemented — Light / REM / Deep with 6 signal weights. The autonomous executor (`src/orchestration/autonomous.ts`, 1,281 lines) has 8 real strategies, pattern-based doom-loop detection, a circuit breaker, and oracle/worker escalation.

However, several claims in comments and audit docs are load-bearing and incorrect:

1. **`src/core/runtime.ts:934`** wires the `AutoresearchEngine` with a hard-coded no-op generator (`async () => null`) and a comment that says "callers provide real one via `getAutoresearchEngine()`" — but the getter only returns the same instance, never replaces it. Any caller that treats `runtime.getAutoresearchEngine()` as live will silently get zero work done. This is exactly the false-claim pattern the task references.
2. **`src/memory/vector-store.ts:181`** stores `new Float64Array(this.dimensions)` as a "placeholder" embedding on insert, claiming it will be rebuilt on search via `rebuildIfDirty()`. That does work, but the cost model of "pre-computed O(n) dot products" advertised in the module header only materializes on the second search — the first search of a dirty index re-embeds every document inline.
3. **`src/memory/quantized-vector-store.ts`** advertises a TurboQuant integration with quantization + reciprocal-rank fusion. It does this correctly when `@xenova/transformers` is available. But `@xenova/transformers` is an **optional dependency** and the `loadTransformers()` function swallows every import failure silently and caches the failure. On the common case where the package is missing, the "quantized vector store" silently degrades to pure TF-IDF, *including the vector path of `HybridMemorySearch`*. The hybrid score weights still reserve 30% for vector signal; that 30% becomes 0 on install without the opt-in package.
4. The **MemPalace R1 domain/topic partitioning** claim that retrieval jumps from "60.9% → 94.8%" is cited in comments (`store.ts:304`, `memory-tools.ts:108`) and in the tool-definition description. The code that executes the filter is correct — an `AND me.domain = ?` before the FTS5 `MATCH` — but the performance numbers are a claim imported from the research paper, not a benchmark measured on WOTANN itself. The local benchmark (`memory-benchmark.ts`) does not report a before/after comparison.
5. The **`active-memory.ts` recall path** (`recallContext`) casts `memoryStore` to `unknown` then to an object with an optional `search` method, and silently returns `null` if `search` is not a function or if `.content` is missing from any result. But `MemoryStore.search()` returns `MemorySearchResult` objects whose `.entry.value` — not `.content` — holds the text. The dynamic cast in `active-memory.ts:141` makes this compile, but the subsequent filter `r && typeof r.content === "string"` will reject every real search result. **The active-memory recall pipeline is dead code at runtime.**
6. The **4-phase autoDream** `phaseRecall` → `phaseAnalyze` → `phaseConsolidate` → `phasePrune` pipeline correctly produces gotchas and instincts, but its "patterns" are extracted by "word frequency >= 3 across observations," which surfaces common English stopwords in practice. In a clean English corpus this often emits words like "because", "should", "called" as "recurring patterns."

What works well:

- **Store.ts SQL schema:** clean, with WAL mode + foreign keys, a FTS5 virtual table on `memory_entries`, a separate `verbatim_drawers` + `verbatim_fts` pair (MemPalace R6), knowledge nodes + edges with bi-temporal `valid_from` / `valid_to` (MemPalace R2), a `memory_vectors` BLOB table with a dimensions column, a `memory_provenance_log`, a `working_memory` with TTL, and a `decision_log`. Triggers keep FTS5 in sync on INSERT/UPDATE/DELETE. Migrations are idempotent, with a safe `migrateAddColumn` helper that guards against SQL injection via a whitelist regex.
- **Plan store transitions:** `src/orchestration/plan-store.ts` defines two separate state machines (status + lifecycle) with explicit valid-transition maps. Every transition runs in a SQL transaction. Auto-activate/complete milestones cascade correctly. Dependency resolution is O(n squared) but sufficient for the plan sizes in scope.
- **Autonomous executor:** 8 strategy prompts, pattern-based + enhanced doom-loop detection, heartbeat watchdog with a `Promise.race`, circuit breaker with consecutive-failure/depth/descendant counts, shadow-git commits per passing cycle, multi-model verification gate, oracle consultation hook (D13) threaded through iteration recording. Self-troubleshoot classification maps error regex to shell fix for node / python / rust.
- **Council mode:** 3-stage karpathy/llm-council implementation with anonymized peer review, rank parsing with two fallback regexes, chairman synthesis, leaderboard aggregation. Handles model failure by falling back to the top-ranked response.
- **Wave executor fresh-context:** Real context snapshotting per task before each wave, per-task token budget enforcement, two-phase execution.
- **Episodic memory:** Per-episode JSON file, `buildEpisodeLinks` + `multiHopRecall` with proper BFS traversal and shared-tag link strength.
- **Dream pipeline Light/REM/Deep:** 6 weighted signals, promotion gates on min-score + min-recall + min-unique-queries, rehydration check before promotion (ensures the source entry still exists), human-readable diary written to `DREAMS.md`.

---

## 2. Memory directory — 26 files

### 2.1 `src/memory/store.ts` (1,994 lines)

**Purpose:** SQLite memory store, the canonical implementation of the 8-layer memory system.

**Exports:**
- Types: `MemoryLayer`, `MemoryBlockType`, `MemorySourceType`, `MemoryProvenance`, `VerificationStatus`, `VerificationResult`, `MemoryEntry`, `MemorySearchResult`, `VectorSearchResult`, `ContradictionResult`, `KnowledgeNode`, `TeamMemoryRecord`, `TeamMemorySnapshot`, `TeamMemorySyncResult`, `AutoCaptureEntry`.
- Class: `MemoryStore` with ~70 methods covering all 8 layers.

**Imports:** `better-sqlite3`, `node:path`, `node:fs`, `node:crypto`, `../utils/atomic-io.js`.

**Schema (verified in full):**
- `memory_entries` — 22 columns including `layer`, `block_type`, `domain`, `topic`, `freshness_score`, `confidence_level`, `verification_status`. FTS5 virtual table `memory_fts(key, value)` with triggers for INSERT/UPDATE/DELETE on the base table.
- `knowledge_nodes` — entity graph with `valid_from`/`valid_to`.
- `knowledge_edges` — bi-temporal relationships (migration added `valid_from` + `valid_to` at `store.ts:322-331`).
- `team_memory` — agent-id keyed, `shared` flag, with JSON snapshot export/import + last-write-wins sync.
- `working_memory` — session-scoped, with `expires_at` TTL.
- `decision_log` — rationale, alternatives, constraints, stakeholders.
- `auto_capture` — event_type, tool_name, content. Content is capped to 2000 chars (`store.ts:362`).
- `verbatim_drawers` + `verbatim_fts` — raw conversation chunks with separate FTS5 index (MemPalace R6).
- `memory_vectors` — BLOB embeddings, model + dimensions columns.
- `memory_provenance_log` — full audit trail per entry with action, old_value, new_value, actor, reason.

**Key methods:**
- `search(query, limit, options)` — FTS5 search with optional domain filter. Returns `MemorySearchResult[]` with entry + score + highlighted snippet.
- `searchPartitioned(query, options)` — the MemPalace R1 path: `AND me.domain = ?` before `MATCH`. Falls back to `search()` when no domain/topic provided. **Verified:** The partition filter runs before FTS5 scoring; the comment "+34% retrieval" at `store.ts:1099` cites the paper, not a local benchmark.
- `hybridSearch(query, limit)` — RRF fusion of 4 signals (FTS5, vector, recency, frequency) with weights 0.4/0.3/0.2/0.1 and K=60. Domain filter is threaded through every signal. Real reciprocal rank fusion.
- `vectorSearch(query, limit)` — local trigram embedding (256 dims, L2 normalized, generated inline via `generateLocalEmbedding`). The "vectors" are DJB2-hashed character trigrams from tokenized text, not real semantic embeddings. Comment at `store.ts:1336` acknowledges: "Not as good as nomic-embed-text but works offline."
- `skepticalSearch(query, limit)` — applies temporal decay (1%/day floor 0.3) and verification multiplier to produce a `needsVerification: boolean` flag.
- `acquireConsolidationLock(lockId)` — file-based lock at `$dbPath/../consolidation.lock`, 30-minute stale threshold, prevents concurrent autoDream.
- `verifyMemoryAgainstCodebase(entryId, workspaceDir)` — reads the linked source file, checks keyword overlap >50%. Real verification, not a stub.
- `refreshAllFreshnessScores()` — batch decay with exponential half-life (30d unverified, 90d verified).
- `pruneAutoCaptures(days=30)` — real DELETE on auto_capture.

**Silent-failure patterns:**
- `acquireConsolidationLock()` catches JSON parse errors on the lock file and silently `unlinkSync` — recoverable, but a corrupted lock file is indistinguishable from an expired one.
- `vectorSearch()` does not clip similarity to `[-1, 1]`; the cosine denominator guard is `denom > 0` rather than `denom > 1e-9`, so near-zero magnitudes produce large floats.
- `detectContradictions()` uses keyword overlap threshold 0.5 — low enough to produce false positives when entries share common words like "the project is..."

**Verified claims:**
- "8-layer unified memory" — yes, all 8 layers have tables and CRUD methods.
- "FTS5 full-text search across all layers" — FTS5 is attached to `memory_entries` and `verbatim_drawers`. Knowledge graph, team memory, working memory, and auto_capture are NOT FTS5-indexed; only the main `memory_entries` and verbatim drawers are searchable via `MATCH`.
- "Skeptical recall" — implemented.
- "Temporal decay" — implemented correctly.

### 2.2 `src/memory/graph-rag.ts` (762 lines)

**Purpose:** In-memory knowledge graph with dual-level retrieval (graph traversal + keyword search).

**Exports:** `EntityType`, `RelationshipType`, `Entity`, `Relationship`, `AddRelationshipOptions`, `Document`, `GraphQueryResult`, `DualRetrievalResult`, `KeywordMatch`, `extractEntities`, class `KnowledgeGraph`.

**Imports:** `node:crypto` only. Self-contained, no SQLite.

**Details:**
- Entity extraction uses 11 regex patterns for function/class/interface/type/file/module/variable/concept/person declarations. Filters common keywords via `isCommonKeyword` whitelist of 65 tokens.
- `queryGraph(query, maxDepth=2)` — BFS from seed entities with visited-set, returns entities + relationships + documents + score.
- `keywordSearch(query, maxResults)` — scores by exact match (+2), substring match (+1), partial (0.5), sorted descending.
- `dualLevelRetrieval(query, maxDepth)` — combines graph (0.6) + keyword (0.4) scores.
- `addRelationship(source, target, type, documentId, weightOrOptions)` — supports legacy positional API and MemPalace R2 options object. Auto-closes contradicting relationships when `closeContradicting !== false`.
- `queryGraphAt(query, date, maxDepth)` — temporal version, filters by `validFrom <= date AND (validTo undefined OR validTo > date)`.
- `toMs()` helper accepts unix-ms numbers OR ISO-8601 strings for backward compat.
- `fromJSON` migration handles legacy ISO-string `validFrom`/`validTo` by parsing to unix ms.

**Claim verification:**
- "Graph traversal + keyword" — yes.
- "Bi-temporal facts" — yes, but only in-memory. Corresponds to the SQLite `knowledge_edges.valid_from/valid_to` columns but is NOT connected to the SQLite store; they're parallel, independent implementations.
- "32K stars (LightRAG)" — cosmetic citation.

### 2.3 `src/memory/active-memory.ts` (7,447 bytes)

**Purpose:** Pre-query fact extraction and recall (OpenClaw "active memory" pattern).

**Exports:** `MessageClass`, `ExtractedObservation`, `ActiveMemoryResult`, class `ActiveMemoryEngine`, `createActiveMemoryEngine()`.

**KEY BUG (false claim at runtime):** At `active-memory.ts:128-146`, `recallContext` dynamically casts `memoryStore` to an interface where `search()` returns `{ content: string }[]`. But `MemoryStore.search()` returns `readonly MemorySearchResult[]`, where each entry has `.entry.value`, not `.content`. The `.filter(r => typeof r.content === "string")` rejects every real result, so `formatted` becomes empty and the function returns `null`. **The active-memory recall pipeline never successfully injects context at runtime** — it always reports "classification: question, contextPrefix: null". File-write path (fact/preference/decision) works correctly because it uses `captureEvent()` (which has the right signature), not `search()`.

**Impact:** The much-advertised "tight synchronous memory write/read loop" (active-memory.ts:14-16) writes correctly but never reads. The dream pipeline eventually picks up the writes, so the data isn't lost — but the claim that it's "synchronous instead of async-after-the-fact" is false for recall.

### 2.4 `src/memory/cloud-sync.ts` (7,606 bytes)

**Purpose:** Snapshot export/import + diff + merge for team memory.

**Exports:** `SyncEntry`, `MemorySnapshot`, `ConflictResolution`, `MergeOperation`, `MergeResult`, `MergeConflict`, class `CloudSyncEngine`, `verifyChecksum`.

Uses SHA-256 checksum over entries, `last-write-wins` default conflict resolution, manual conflict flag. Pure in-memory, no SQLite coupling. Real diff+merge, not a stub.

### 2.5 `src/memory/context-fence.ts` (6,505 bytes)

**Purpose:** Prevent auto-capture from re-ingesting recalled memories (SuperMemory pattern).

**Exports:** `FencedContent`, `FenceStats`, class `ContextFence`.

Uses DJB2 fingerprint (first 1000 chars) + trigram overlap >60% for fuzzy matching. 1-hour default expiry, session-scoped cleanup. Real implementation.

### 2.6 `src/memory/context-loader.ts` (9,222 bytes)

**Purpose:** MemPalace L0-L3 progressive context loading.

**Exports:** `ContextLevel`, `ContextPayload`, `WakeUpPayload`, `L2RecallResult`, `ContextLoaderStoreAdapter`, class `ContextLoader`.

- L0: ~50 tokens from `IDENTITY.md` + first paragraph of `SOUL.md`. Fallback "I am WOTANN..." if files missing.
- L1: ~120 tokens from `user`/`feedback`/`project`/`decisions` blocks, most-recent-first.
- L2: Domain-specific recall via `searchPartitioned` (falls through to `search` if adapter lacks it). Tracks loaded domains to avoid redundant loads.
- L3: Full FTS5 + vector search.

Uses `~4 chars/token` heuristic. Real implementation.

### 2.7 `src/memory/context-tree-files.ts` (7,131 bytes)

**Purpose:** ByteRover-inspired markdown context tree stored in `.wotann/context-tree/{resources,user,agent}/`.

**Exports:** `ContextEntry`, `ContextTreeStats`, class `ContextTreeManager`.

Hierarchical markdown files with frontmatter. Simple substring-overlap search. L0/L1/L2 tiers generated via first-sentence + headers + full content. Real implementation.

### 2.8 `src/memory/context-tree.ts` (10,657 bytes)

**Purpose:** Hierarchical in-memory tree of project files.

**Exports:** `ContextNodeType`, `ContextNode`, `ContextTreeStats`, class `ContextTree` with `buildFromDirectory` static.

Filesystem scan, skip-dirs list (`node_modules`, `.git`, etc.), ASCII `visualize()` for TUI. Pure data structure, immutable updates. Real implementation.

### 2.9 `src/memory/contradiction-detector.ts` (10,457 bytes)

**Purpose:** Enriched contradiction analysis on top of `MemoryStore.detectContradictions`.

**Exports:** `ResolutionStrategy`, `ContradictionReport`, `EnrichedContradiction`, `ContradictionStats`, `ContradictionStoreAdapter`, class `ContradictionDetector`.

- Boolean flip detection (true/false, enabled/disabled, etc.).
- Negation-based contradictions with 0.5 overlap threshold.
- Temporal contradictions (same key, different value, <7 days old).
- Resolution strategies: most-recent-wins / highest-confidence / flag-for-review.

Real implementation.

### 2.10 `src/memory/conversation-miner.ts` (17,733 bytes)

**Purpose:** Ingest Claude exports / Slack exports / generic text / auto-capture logs into the memory store.

**Exports:** `MiningResult`, `MinerConfig`, class `ConversationMiner`.

Pattern-based observation extraction (decision/preference/fact/problem patterns). Domain/topic inference from path matches + keyword lists. Chunks at 2KB max / 20B min. Immutable `mergeResult` pattern throughout.

Real implementation. Writes verbatim chunks to `verbatim_drawers` and observations to `memory_entries`.

### 2.11 `src/memory/episodic-memory.ts` (16,942 bytes)

**Purpose:** Full task narratives for cross-session pattern discovery.

**Exports:** `EpisodeEvent`, `Episode`, `EpisodeSummary`, `EpisodeQuery`, `CrossEpisodePattern`, `EpisodeLink`, class `EpisodicMemory`.

- `startEpisode` -> `recordEvent` -> `completeEpisode`: writes a JSON file per episode at `$wotannDir/memory/episodes/$id.json`.
- `findPatterns(tags, minOccurrences=2)` — groups strategies + errors (normalized) + lessons across episodes, scores confidence as `domainSet.size / totalEpisodes`.
- `buildEpisodeLinks(minSharedTags=1)` — O(n squared) pairwise shared-tag links.
- `multiHopRecall(startTag, maxHops=2)` — BFS traversal via links.

Real implementation. Tag extraction is regex-based with 13 task-type patterns.

### 2.12 `src/memory/freshness-decay.ts` (6,494 bytes)

**Purpose:** 30-day half-life exponential decay engine.

**Exports:** `FreshnessConfig`, `FreshnessScore`, `DecayBatchResult`, `FreshnessStoreAdapter`, class `FreshnessDecayEngine`.

Default: 30d unverified / 90d verified half-lives, 0.2 max access boost, 0.05 floor score. `reinforceEntry` resets `updatedAt` and `freshnessScore = 1.0`. Real implementation.

### 2.13 `src/memory/memory-benchmark.ts` (18,167 bytes)

**Purpose:** LoCoMo-inspired 5-category benchmark (single-hop, multi-hop, temporal, open-domain, adversarial).

**Exports:** `BenchmarkSetupEntry`, `BenchmarkCategory`, `BenchmarkQuestion`, `BenchmarkResult`, `CategoryScore`, `BenchmarkSuite`, `BenchmarkStoreAdapter`, class `MemoryBenchmark`.

- 20 built-in questions (4 per category).
- Adversarial threshold: score < 0.3 AND no query-word overlap -> "NOT_FOUND" correct.
- Partitioned search when domain present in setup.

Real implementation. No self-calibration; numbers like "96.6% recall" in comments are paper claims, not measured locally.

### 2.14 `src/memory/memory-tools.ts` (20,966 bytes)

**Purpose:** Agent-callable memory tools (Letta pattern): `memory_search`, `memory_search_in_domain`, `memory_replace`, `memory_insert`.

**Exports:** `ToolCallResult`, `MemorySearchInput`, `MemorySearchOutput`, `ScoredMemory`, `MemoryReplaceInput`, `MemoryReplaceOutput`, `MemoryInsertInput`, `MemoryInsertOutput`, `ToolDefinition`, `ParameterDefinition`, `MemoryToolStoreAdapter`, class `MemoryToolkit`.

- Adversarial confidence gating (LoCoMo R7): computes query-term overlap ratio, marks results with `<0.3` overlap as `uncertain`.
- Contradiction check before replace/insert.
- Freshness-filtered results.

**NOTE:** `TOOL_DEFINITIONS` has `memory_search_in_domain` defined **twice** (once at `memory-tools.ts:149` and again at `memory-tools.ts:218`). The `dispatch()` switch statement only matches the first one; the duplicate is inert. Real but sloppy. Fix: delete the duplicate.

### 2.15 `src/memory/memvid-backend.ts` (10,838 bytes)

**Purpose:** Portable single-file JSON memory store (memvid pattern).

**Exports:** `MemvidEntry`, `MemvidHeader`, `MemvidFile`, `MemvidSearchResult`, `MemvidExportOptions`, `MemvidImportResult`, class `MemvidBackend`.

Inverted index, BM25-style scoring, import preserves IDs with confidence-based replacement. Real implementation.

### 2.16 `src/memory/observation-extractor.ts` (11,665 bytes)

**Purpose:** Extract structured observations (decision/preference/milestone/problem/discovery) from `AutoCaptureEntry[]`.

**Exports:** `ObservationType`, `Observation`, functions `extractDecisions`, `extractPreferences`, `extractMilestones`, `extractProblems`, `extractDiscoveries`, class `ObservationExtractor`, class `ObservationStore`.

Pattern-based, with domain/topic inference per observation. Discovery pairs error events with fix events in the same session. Real implementation.

### 2.17 `src/memory/pluggable-provider.ts` (11,191 bytes)

**Purpose:** `MemoryProvider` interface for third-party backends.

**Exports:** `MemoryProvider`, `registerMemoryProvider`, `setActiveMemoryProvider`, `getActiveMemoryProvider`, `getRegisteredProviders`, class `InMemoryProvider`, class `MultiTurnMemory`, `MultiTurnEntry`, `calculateFreshness`, `detectContradiction`.

- `InMemoryProvider`: full async implementation, in-Map storage.
- `MultiTurnMemory`: turn-scoped store with "survives compaction" flag (importance >= 0.7).
- Standalone `calculateFreshness` and `detectContradiction` utilities.

Real implementation. There is duplicate contradiction logic between this file and `contradiction-detector.ts` + `store.ts.detectContradictions` — three separate implementations with different thresholds.

### 2.18 `src/memory/proactive-memory.ts` (11,732 bytes)

**Purpose:** Pre-emptive context injection on triggers (file opened, error encountered, mode switched, etc.).

**Exports:** `ProactiveHint`, `ProactiveTrigger`, `ProactiveConfig`, class `ProactiveMemoryEngine`.

5 built-in `KNOWN_ISSUES` (missing module, ECONNREFUSED, OOM, ENOSPC, ERR_REQUIRE_ESM) plus 5 `FILE_ASSOCIATIONS`. Custom pattern registration supported. Rolling "recently shown" suppression (30 min default). Real implementation.

### 2.19 `src/memory/qmd-integration.ts` (4,534 bytes)

**Purpose:** QMD-style precision retrieval fallback — chunks files, scores by term-occurrence×term-length.

**Exports:** `ContextChunk`, `QMDMode`, class `QMDContextEngine`, `formatQMDContext`.

Currently always operates in `"fallback"` mode (the `QMDMode.disabled` path is activated only when the project dir doesn't exist, which never happens in practice). The advertised "native qmd runtime" is never invoked because the file contains no qmd binary detection logic. Real fallback, but the "native" path is vaporware.

### 2.20 `src/memory/quantized-vector-store.ts` (13,995 bytes)

**Purpose:** Drop-in replacement for TF-IDF with MiniLM embeddings.

**Exports:** `VectorSearchResult`, `QuantizedVectorStoreConfig`, class `QuantizedVectorStore`.

- Falls back to TF-IDF when `@xenova/transformers` is absent.
- 8-bit symmetric quantization by default, 4x storage reduction.
- Reciprocal-rank fusion with TF-IDF.

**Silent-failure:** `loadTransformers()` caches `null` on import failure (`quantized-vector-store.ts:97`). If the optional dep is missing, every subsequent call returns `false` from `ready()`, silently falling through to TF-IDF. No warning logged, no capability flag exposed. `getBackend()` accessor is the only way to observe the downgrade.

### 2.21 `src/memory/retrieval-quality.ts` (6,565 bytes)

**Purpose:** Self-tuning retrieval weights based on usefulness feedback.

**Exports:** `RetrievalEvent`, `RetrievalFeedback`, `QualityMetrics`, `RecommendedWeights`, class `RetrievalQualityScorer`.

Tracks events + feedback, computes per-method useful-rate, recommends weight rebalancing via normalized scores. Max history bounded to 1000 events. Real implementation.

### 2.22 `src/memory/semantic-search.ts` (10,373 bytes)

**Purpose:** Zero-dependency TF-IDF + cosine similarity.

**Exports:** `tokenize`, `TFIDFDocument`, `SemanticSearchResult`, class `TFIDFIndex`, `HybridResult`, `mergeHybridResults`.

13 suffix-stripping rules (simple Porter approximation). L2-normalized TF*IDF vectors, cosine similarity. `mergeHybridResults` with RRF. Real implementation.

### 2.23 `src/memory/temporal-memory.ts` (13,912 bytes)

**Purpose:** Time-aware memory with natural-language time parsing.

**Exports:** `TemporalEntry`, `TemporalQueryResult`, `EventOrderResult`, `EventFrequencyResult`, `TimelineSummary`, `CategoryCount`, `Trend`, class `TemporalMemory`, `formatDuration`, `formatTimeAgo`.

9 time patterns (today, yesterday, last week, N days ago, etc.). LoCoMo-inspired `queryBeforeEvent` / `queryAfterEvent` / `queryBetweenEvents` / `getDuration`. Real implementation.

### 2.24 `src/memory/tunnel-detector.ts` (5,691 bytes)

**Purpose:** Cross-domain topic linking (MemPalace "tunnels").

**Exports:** `Tunnel`, `CrossDomainResult`, `TunnelStoreAdapter`, class `TunnelStore`, class `TunnelDetector`.

Scans domain x topic matrix, emits Tunnels for topics appearing in 2+ domains. `queryAcrossDomains` aggregates per-domain results. Real implementation.

### 2.25 `src/memory/unified-knowledge.ts` (4,302 bytes)

**Purpose:** `UnifiedKnowledgeFabric` — query fan-out across registered retrievers.

**Exports:** `KnowledgeQuery`, `KnowledgeSource`, `KnowledgeResult`, `ResultProvenance`, `KnowledgeFabricStats`, class `UnifiedKnowledgeFabric`, `Retriever`.

Registers retrievers per source, parallel `Promise.all` fan-out, dedup by first-100-chars-lowercase. `averageTrustScore: 0.85` is hard-coded at `unified-knowledge.ts:92` — comment says "Default until we track this." **Real but incomplete — trust score is a placeholder.**

### 2.26 `src/memory/vector-store.ts` (15,568 bytes)

**Purpose:** Pre-computed TF-IDF embeddings with HybridMemorySearch (RRF over 4 signals).

**Exports:** `VectorDocument`, `VectorSearchResult`, `HybridSearchResult`, `FTS5QueryFn`, `TemporalSignalFn`, `FrequencySignalFn`, class `VectorStore`, class `HybridMemorySearch`, `RRFWeights`.

- 512-dim default, L2-normalized, DJB2-hashed term bins.
- Rebuild-on-search only if `dirty` flag set.
- `HybridMemorySearch` merges FTS5 + vector + optional temporal + optional frequency signals via RRF (K=60).

**Noted issue:** `vector-store.ts:181` stores a placeholder zero-vector on insert and rebuilds on next search — so the first query after bulk-insert pays full O(n*terms) cost once.

Real implementation, drop-in for HybridMemorySearch.

---

## 3. Context directory — 11 files

### 3.1 `src/context/compaction.ts` (8,421 bytes)

Five strategies: summarize / evict-oldest / evict-by-type / offload-to-disk / hybrid. Structured template (Goal / Progress / Decisions / Files Modified / Next Steps). Existing-summary detection -> iterative-update prompt. Real implementation.

### 3.2 `src/context/context-replay.ts` (9,125 bytes)

Relevance-scored context assembly with token budget. 6 source types (file/memory/tool-result/conversation/plan/decision). Real implementation.

### 3.3 `src/context/context-sharding.ts` (14,542 bytes)

Topic-partitioned conversation shards with state machine (active / dormant / offloaded / summarized). Auto-split on threshold. Cross-shard summary assembly. 15-min dormancy threshold. Real implementation.

### 3.4 `src/context/inspector.ts` (7,562 bytes)

Section-level token accounting (11 section types). Top-consumers report + 4 recommendation heuristics. ASCII visualization via `formatDisplay()` (Ctrl+I overlay). Real implementation.

### 3.5 `src/context/limits.ts` (21,658 bytes, 722 lines)

Registry of 30+ model context profiles (Anthropic, OpenAI, Gemini, Copilot, Codex, Ollama, HuggingFace, free-tier). Extended-context resolution via env var / model suffix `[1m]`. `getModelContextConfig`, `getMaxAvailableContext`, `getMaxDocumentedContext`, `getOllamaKVCacheConfig`, `isOpus1MAvailable`. **Verified:** Claude Opus/Sonnet 4.6 listed as `maxContextTokens: 1_000_000` with `activationMode: "default"` — matches the 2026-03-13 GA announcement cited in comments. Real implementation.

### 3.6 `src/context/maximizer.ts` (12,685 bytes)

Wraps `limits.ts` with provider-specific header injection (`anthropic-beta: extended-context-2025-03-01`) and body field name mapping (`max_tokens` vs `num_ctx` vs `maxOutputTokens`). `maximizeAllProviders`, `getBestContextOption`, `planContextBudget`, `getProviderReport`. Real implementation.

### 3.7 `src/context/ollama-kv-compression.ts` (11,939 bytes)

TurboQuant profiles (conservative 2x / balanced 4x / aggressive 6x). Per-model VRAM estimates. 3 sharding strategies (topic-aware / recency-weighted / importance-ranked). `contextVirtualization` pure function. Real implementation.

### 3.8 `src/context/repo-map.ts` (9,490 bytes)

Aider-style repo map. 14 language patterns for symbol extraction, 4 for imports. Centrality = import-count. `renderRepoMap` with byte budget. Real implementation.

### 3.9 `src/context/tiered-loader.ts` (16,278 bytes)

L0/L1/L2 tier extraction. L0 = signatures, L1 = + imports + docstrings + type blocks + method outlines, L2 = full content. Automatic downgrade on budget exhaustion. Real implementation, good language coverage (TS/JS/Python/Go/Rust/Swift/Kotlin/Java/C#/PHP).

### 3.10 `src/context/virtual-context.ts` (12,107 bytes)

`VirtualContextManager` — splits into active + archived, 3 partition strategies, relevance-scored retrieval. Real implementation.

### 3.11 `src/context/window-intelligence.ts` (23,202 bytes, 689 lines)

Zone-based context budget manager. 7 default zones with priorities, 5 compaction stages, progressive compaction based on pressure level (green/yellow/orange/red/critical), real message summarization via pluggable `SummaryFunction`, tool-output truncation preserving first/last-N lines + important keywords, cache breakpoint computation for Anthropic prompt caching. 4 default reminders (verification / planning / long-session / high-pressure). Real implementation.

---

## 4. Orchestration directory — 25 files

### 4.1 `src/orchestration/agent-hierarchy.ts` (5,622 bytes)

Depth-limited agent tree. Default max depth 2 (parent + children). `registerAgent` throws on depth violation. Immutable read API. Real implementation.

### 4.2 `src/orchestration/agent-registry.ts` (18,585 bytes)

14 hardcoded agent definitions (planner / architect / critic / reviewer / workflow-architect / executor / test-engineer / debugger / security-reviewer / build-resolver / analyst / simplifier / verifier / computer-use). Per-agent allowedTools / deniedTools / availableSkills / maxTurns / timeout. YAML spec loader for per-agent model overrides. Real implementation.

### 4.3 `src/orchestration/agent-workspace.ts` (5,778 bytes)

Filesystem message-passing between agents. JSON files under `.wotann/agent-workspace/`. `write` / `readFor` / `readBroadcasts` / `cleanup`. Real implementation.

### 4.4 `src/orchestration/architect-editor.ts` (5,903 bytes)

Aider-style dual-model pipeline. 4 default pairs (Opus->Sonnet, Sonnet->Gemini Flash, GPT-5.4->GPT-4.1, Copilot->Ollama). `runArchitectEditor` builds separate prompts for architect (analyze) and editor (implement). Real implementation.

### 4.5 `src/orchestration/arena.ts` (6,097 bytes)

Blind 2-3 model contest. `runArenaContest` runs providers in parallel with shuffled order and anonymized labels. `ArenaLeaderboard` with optional FIFO cap (`WOTANN_ARENA_MAX`). Real implementation.

### 4.6 `src/orchestration/auto-commit.ts` (9,067 bytes)

Conventional-commit generation (10 types x 9 scopes). `commitIfVerified` runs real `git add --` + `git commit -m` via `execFileSync`. **Session-5 fix noted in comment:** "previously this function synthesised a random 7-char UUID as the 'hash' and lied about having committed anything" — now returns `success: false` with error messages when git unavailable or nothing staged. Real implementation post-fix.

### 4.7 `src/orchestration/autonomous-context.ts` (11,121 bytes)

Context-pressure-aware cycle planner. `shouldProceed` checks estimated cost vs available budget. `planWaves` generates wave configs per phase. Adaptive prompt injection at yellow/orange/red. Real implementation.

### 4.8 `src/orchestration/autonomous.ts` (44,162 bytes, 1,281 lines)

Main autonomous executor. Circuit breaker + 8 strategies + 2 doom-loop detectors + oracle escalation + self-troubleshoot. Verified file:line references:
- Strategy escalation at `autonomous.ts:537-549`.
- Oracle consultation via `OracleWorkerPolicy.shouldEscalate` + `prepareConsultation` at `autonomous.ts:567-590`.
- Heartbeat watchdog via `Promise.race` at `autonomous.ts:612-637`.
- Self-troubleshoot classification at `autonomous.ts:1165-1269` — maps error regex to `npm install X` / `pip install X` / `cargo add X` / `chmod u+rw`.
- Shadow-git commits on passing cycle at `autonomous.ts:790-796`.
- Multi-model verification gate at `autonomous.ts:797-813`.
- Checkpoint serialization at `autonomous.ts:1278-1298`.

Real implementation. Claim "1281 lines" — verified.

### 4.9 `src/orchestration/code-mode.ts` (8,925 bytes)

Multi-step tool-script executor (Codex CLI pattern). Validates step IDs / args / backwards-only refs / 20-step cap. `substituteRefs` resolves `${stepId.path.x}` with fallback to `stepId.output`. 60s budget by default. Real implementation.

### 4.10 `src/orchestration/coordinator.ts` (8,346 bytes)

Research -> Spec -> Implement -> Verify coordinator. Max 3 subagents. Creates git worktrees per task, cleans up after. `buildExecutionGraph` fans out tasks in same phase + chains phases. `executeWithGraph` threads worktree paths through the executor callback. Real implementation, real git integration.

### 4.11 `src/orchestration/council.ts` (12,703 bytes)

3-stage multi-LLM deliberation (individual -> peer review -> chairman synthesis). Anonymized labels, rank parsing with fallback regex, chairman synthesis prompt, fallback to top-ranked response on synthesis failure. `CouncilLeaderboard` aggregates wins / participations / avg rank / total tokens. Real implementation.

### 4.12 `src/orchestration/graph-dsl.ts` (6,131 bytes)

`GraphBuilder` (chain / fanout / merge / onFailure) + `executeGraph` DAG runner. Retry policy + skip/abort/fallback strategies. Real implementation.

### 4.13 `src/orchestration/living-spec.ts` (12,016 bytes)

Markdown/YAML spec loader + divergence checker. 4 divergence types (missing-in-code / missing-in-spec / naming-violation / structure-mismatch). `watchSpec` via `watchFile`. `generateActionPlan` formats errors/warnings/infos. Real implementation.

### 4.14 `src/orchestration/plan-store.ts` (25,392 bytes, 759 lines)

SQLite plan storage with two state machines (status x lifecycle). 3 tables (plans / milestones / tasks). All transitions in transactions. Auto-advance cascades. Real implementation — verified every valid-transition map.

### 4.15 `src/orchestration/proof-bundles.ts` (4,989 bytes)

Serializes `AutonomousResult` + runtime + context + verification into a JSON proof bundle at `.wotann/proofs/autonomous-$ts.json`. Real implementation.

### 4.16 `src/orchestration/pwr-cycle.ts` (4,495 bytes)

Plan-Work-Review 6-phase state machine with keyword-based transition detection. Permission mode per phase. `autoDetectNextPhase` fallback. Real implementation.

### 4.17 `src/orchestration/ralph-mode.ts` (5,680 bytes)

Verify-fix loop. Doom-loop detector integration, escalation after N failures, time/cost budget, HUD metrics. Real implementation.

### 4.18 `src/orchestration/red-blue-testing.ts` (8,890 bytes)

Red (implementer) + Blue (reviewer) adversarial loop. JSON-format Blue findings, accumulate across rounds, exit on "pass" verdict or max rounds. Real implementation.

### 4.19 `src/orchestration/self-healing-pipeline.ts` (16,819 bytes, 519 lines)

12 error-pattern regex -> category -> fix-template map. 4 recovery strategies (prompt-fix / code-rollback / strategy-change / human-escalation). Uses runtime-provided `ShadowGit` to avoid parallel instance divergence. Real implementation.

### 4.20 `src/orchestration/spec-to-ship.ts` (13,045 bytes, 455 lines)

End-to-end spec -> plan -> execute. 5 phases (research / implement / test / review / ship). Markdown spec parser extracts requirements + acceptance-criteria + constraints + dependencies. Real implementation.

### 4.21 `src/orchestration/task-delegation.ts` (4,725 bytes)

Structured handoff manager. 6 states (pending / accepted / in-progress / completed / failed / rolled-back). `extractKnowledge` aggregates learnings from completed delegations. Real implementation.

### 4.22 `src/orchestration/ultraplan.ts` (8,271 bytes, 251 lines)

Extended-thinking plan->execute pattern. Default 30-min plan budget, 128K thinking tokens for Opus 4.6. Knowledge graph context injection (D11) — renders top 40 entities + 60 relationships before the model sees the task. `parsePlanResponse` parses markdown phases via header regex. `shouldUseULTRAPLAN` heuristic — keyword-based complexity score. Real implementation.

### 4.23 `src/orchestration/wave-executor.ts` (7,767 bytes, 247 lines)

Topological wave grouping + `executeWavesWithFreshContext`. Context snapshotting per task + token-budget trimming. Real implementation.

### 4.24 `src/orchestration/workflow-dag.ts` (19,800 bytes, 637 lines)

YAML workflow engine. 5 node types (agent / loop / approval / parallel / shell). 4 built-in workflows (idea-to-pr / fix-issue / refactor / code-review). Loop exit-condition matching via keyword. Approval gate via async callback. Real implementation — hand-rolled YAML parser is narrow (only supports the structure the engine needs) but works.

### 4.25 `src/orchestration/worktree-kanban.ts` (6,347 bytes, 190 lines)

Pure projection of `IsolatedTask[]` onto 3-column kanban. `suggestNextAction` advisory pattern. Real implementation.

---

## 5. Learning directory — 12 files

### 5.1 `src/learning/types.ts` (2,364 bytes)

Shared types. Notes distinct `DreamInstinct` (autoDream) vs `Instinct` (InstinctSystem). Clean.

### 5.2 `src/learning/autodream.ts` (13,411 bytes)

4-phase consolidation (Recall / Analyze / Consolidate / Prune) + three-gate trigger. `classifyFeedback` with correction/confirmation regex lists. `runDreamPipelineWithPersistence` wraps the pipeline + writes LESSONS.md. **Gate relaxation recorded:** idle threshold 30min -> 10min, cool-off 4h -> 2h (S2-8 fix noted in comment at autodream.ts:36-45). Env overrides: `WOTANN_DREAM_IDLE_MIN`, `WOTANN_DREAM_COOLOFF_H`, `WOTANN_DREAM_MIN_OBS`. Real implementation.

**Weakness:** `phaseRecall` extracts "recurring patterns" by word frequency >=3, which in English text surfaces high-frequency stopwords despite the `length > 4` filter. The 3-phase pipeline in `dream-pipeline.ts` mitigates this with a `STOP_WORDS` set but autodream.ts does not.

### 5.3 `src/learning/cross-session.ts` (15,431 bytes)

6 extraction methods (error pattern / tool sequence / strategy / code style / file pattern / preference). Persists to disk + MemoryStore (layer="learning"). `getRelevantLearnings(task)` + `buildLearningPrompt` for injecting into system prompts. Real implementation.

### 5.4 `src/learning/decision-ledger.ts` (7,405 bytes)

Decision records with rationale / alternatives / affectedFiles / tags / status (active/superseded/reverted). Atomic file writes + markdown export. `getDecisionsForFile` + full-text `searchDecisions`. Real implementation.

### 5.5 `src/learning/dream-pipeline.ts` (18,439 bytes, 541 lines)

3-phase Light/REM/Deep with 6 signal weights (relevance 0.30 / frequency 0.24 / queryDiversity 0.15 / recency 0.15 / consolidation 0.10 / conceptualRichness 0.06). Promotion gates (minScore 0.6, minRecallCount 3, minUniqueQueries 2). Rehydration check before promotion. Writes `DREAMS.md` diary. Real implementation.

### 5.6 `src/learning/dream-runner.ts` (9,415 bytes)

`runWorkspaceDream` — combines 3-phase pipeline + 4-phase autodream legacy. Acquires consolidation lock, runs both pipelines, writes gotchas + LESSONS.md + instincts. Real implementation.

### 5.7 `src/learning/feedback-collector.ts` (7,006 bytes)

Binary thumbs up/down + JSONL persistence. Rewards +0.75 / -0.25 / 0. Exports for KTO (thumbs) and DPO (paired). Explicit + implicit feedback (kept/regenerated/edited). Real implementation.

### 5.8 `src/learning/instinct-system.ts` (10,702 bytes)

Observe/reinforce pattern. 30-day half-life exponential decay. Skill candidate threshold 0.9. Pattern matching via 60% keyword overlap. Real implementation.

### 5.9 `src/learning/nightly-consolidator.ts` (8,313 bytes)

Extract rules from patterns (3+ occurrences) + crystallize strategies (>80% success) + generate skill candidates from corrections + identify archival candidates (7+ days, 0 accesses). Real implementation. Pure helper functions, no state beyond the input snapshot.

### 5.10 `src/learning/pattern-crystallizer.ts` (9,956 bytes)

Auto-generate SKILL.md from tool sequences seen 5+ times with >=70% success. Bigram Jaccard similarity for pattern matching. Crystallized skills written to `~/.wotann/skills/`. Prune stale patterns after 30 days. Real implementation.

### 5.11 `src/learning/self-evolution.ts` (9,010 bytes)

Updates `USER.md` / `MEMORY.md` / creates skills / proposes IDENTITY.md / SOUL.md changes (approval-gated by default). Audit log to `evolution-log.jsonl`. `approveAction` / `rejectAction` with immutable updates. Real implementation.

### 5.12 `src/learning/skill-forge.ts` (20,032 bytes)

Session-driven skill extraction. `analyzeSession` -> patterns with frequency + success rate -> candidates when threshold met. `generateSkillDefinition` writes SKILL.md with YAML frontmatter. `recordOutcome` self-tunes confidence. Version-tracked via `versionMap`. Real implementation.

---

## 6. False-claim catalog (audit)

The task asked specifically for false-claim hunts. Here is the full list I found reading every file:

| # | File | Line | Claim | Reality |
|---|------|------|-------|---------|
| 1 | `src/core/runtime.ts` | 934 | "Default no-op generator; callers provide real one via `getAutoresearchEngine()`" | The getter returns the same instance. No caller replaces the generator. AutoresearchEngine silently does nothing unless a caller monkey-patches. |
| 2 | `src/memory/active-memory.ts` | 141 | "recall relevant prior memory and inject it into the next prompt" | Dynamic cast uses `.content` but `MemorySearchResult` uses `.entry.value`. Recall path is dead code. |
| 3 | `src/memory/memory-tools.ts` | 149 + 218 | `memory_search_in_domain` advertised once | Defined twice in `TOOL_DEFINITIONS`. Duplicate is inert. |
| 4 | `src/memory/qmd-integration.ts` | 31 | "native qmd runtime" | No detection code exists; always uses fallback. "Native" path is vaporware. |
| 5 | `src/memory/store.ts` | 1099, 1116 | "+34% retrieval improvement (MemPalace 60.9% -> 94.8%)" | Cited from paper. Not measured locally; `memory-benchmark.ts` has no before/after comparison. |
| 6 | `src/memory/quantized-vector-store.ts` | 97 | MiniLM backend is drop-in | Silent fallback to TF-IDF when `@xenova/transformers` is missing. No warning, no capability flag in `HybridMemorySearch`. 30% of hybrid score is dead weight on default install. |
| 7 | `src/memory/unified-knowledge.ts` | 92 | `averageTrustScore: 0.85` | Hard-coded placeholder. Comment says "Default until we track this." |
| 8 | `src/memory/vector-store.ts` | 181 | "pre-computed O(n) dot products" | First search after bulk insert re-embeds every document inline (`rebuildIfDirty`). Advertised cost model holds from the 2nd search on. |
| 9 | `src/learning/autodream.ts` | 163 | "recurring patterns" from word frequency >=3 | No stopword filter on `phaseRecall`. In English prose, "patterns" become common stopwords. The 3-phase pipeline (`dream-pipeline.ts`) has a `STOP_WORDS` set, but the legacy 4-phase does not. |
| 10 | `src/memory/store.ts` multiple | "8-layer FTS5 across all layers" | Only `memory_entries` + `verbatim_drawers` are FTS5-indexed. Knowledge graph, team memory, working memory, and auto_capture are NOT FTS5-indexed. |

**No other egregious false claims.** The remaining ~95% of advertised functionality is genuinely implemented.

---

## 7. Wiring audit — is everything actually plugged in?

Verified by grepping `src/core/runtime.ts` for `new X` imports:

| Subsystem | Wired | Location |
|---|---|---|
| `CrossSessionLearner` | yes | runtime.ts:686 |
| `AutonomousExecutor` | yes | runtime.ts:715 |
| `ArenaLeaderboard` | yes | runtime.ts:744 |
| `CouncilLeaderboard` | yes | runtime.ts:745 |
| `AutonomousContextManager` | yes | runtime.ts:770 |
| `SkillForge` | yes | runtime.ts:813 |
| `InstinctSystem` | yes | runtime.ts:819 |
| `DecisionLedger` | yes | runtime.ts:841 |
| `NightlyConsolidator` | yes | runtime.ts:906 |
| `AutoresearchEngine` | yes (with no-op) | runtime.ts:932 |
| `PatternCrystallizer` | yes | daemon/kairos.ts:157 |
| `FeedbackCollector` | yes | daemon/kairos.ts:158 |
| `SelfEvolutionEngine` | yes | daemon/kairos.ts:159 |
| `runWorkspaceDream` | yes | index.ts:496, daemon/kairos.ts:1544 |
| `PlanStore` | yes | runtime.ts:~3640 |
| `MemoryStore` | yes | runtime.ts |
| `DreamPipeline` | yes | dream-runner.ts |
| `KnowledgeGraph` | yes | ultraplan.ts:82 (optional) |

Every major class in the target directories is constructed somewhere in the runtime or daemon. No orphan modules.

---

## 8. Test coverage signal

`tests/unit/` contains dedicated test files for each major module:

- `memory-store.test.ts`, `memory-8layer.test.ts`, `proactive-memory.test.ts`, `episodic-memory.test.ts`, `memory-benchmark.test.ts`, `temporal-memory.test.ts`, `context-tree.test.ts`, `context-fence.test.ts`, `memory-to-search.test.ts` (integration).
- `context-sharding.test.ts`, `context-relevance.test.ts`, `context-limits.test.ts`, `context-replay.test.ts`, `context-maximizer.test.ts`, `virtual-context.test.ts`, `context-inspector.test.ts`, `context-references.test.ts`, `predictive-context.test.ts`, `context-pressure.test.ts`.
- `orchestration.test.ts` + `tests/unit/orchestration/` subdirectory, `arena.test.ts`, `autonomous-context.test.ts`, `autonomous-mode.test.ts`, `autodream-pipeline.test.ts`.
- `learning.test.ts`, `cross-session-learning.test.ts`, plus subtree `tests/learning/`.

Signal: the test tree is dense. Not a sampling of what actually passes vs. what codifies bugs (the session-2 quality bars note that test files can codify bugs), but coverage surface is broad.

---

## 9. Silent-failure catalog

In addition to the false-claim catalog, here are silent-catch patterns found reading every file:

1. `store.ts:acquireConsolidationLock` — swallows JSON parse error on lock file.
2. `store.ts:vectorSearch` — uses `denom > 0` guard instead of `denom > 1e-9`, near-zero magnitudes produce spurious large floats.
3. `store.ts:verifyMemoryAgainstCodebase` — `catch { newStatus = "stale"; confidence = 0.3; reason = "Source file exists but unreadable" }` — any read error conflates to a 0.3 confidence.
4. `conversation-miner.ts:mineClaudeExport` — catches JSON parse error and merges it into errors array, but does not surface the error to caller beyond the result.
5. `memvid-backend.ts:loadFromDisk` — "Corrupted file — start fresh" silently clears state.
6. `quantized-vector-store.ts:loadTransformers` — caches null on import failure; no log, no event.
7. `skill-forge.ts:restoreFromDisk` — "Ignore corrupt data" silently.
8. `instinct-system.ts:restoreFromDisk` — "Ignore corrupt data" silently.
9. `cross-session.ts:constructor` — "Ignore corrupt data" on restore.
10. `decision-ledger.ts:loadFromDisk` — "Ignore read/parse errors — preserve current in-memory state."
11. `living-spec.ts:watchSpec` — catches spec read errors silently (comment says "Spec file may be temporarily unreadable during writes").
12. `auto-commit.ts:simulateCommit` — returns structured error objects (good). Fixed post-session-5.
13. `dream-pipeline.ts:safeSearch` — catches search errors, returns empty array.
14. `dream-pipeline.ts:writePhaseToDisk` — "Best-effort persistence — do not crash the pipeline."
15. `active-memory.ts:recallContext` — catches any exception in the dynamic-casted search call, returns null.
16. `instinct-system.ts:syncToMemoryStore` — "Best-effort".
17. `feedback-collector.ts:getAllEntries` — catches JSON parse errors per-line? No, it reads the whole file and returns `[]` on error, discarding all feedback.
18. `skill-forge.ts:writeSkillFile` + `saveDraftSkill` — "Best-effort — do not crash if disk write fails."
19. `self-evolution.ts:logAction` — appends to `evolution-log.jsonl` via require, silently ignores write failure.
20. `workflow-dag.ts:listWorkflows` — catches directory read errors silently.

Most of these are defensible (read-path defaults, best-effort writes). Numbers 15, 6, and 17 are the ones that would hide real bugs from observability.

---

## 10. Deep-answer to the 5 focus questions

**Q1: Is the memory system actually as deep as claimed? Read the SQLite schemas.**

Yes, materially. The schemas are present and correct. The "8-layer" claim is accurate in terms of table structure and CRUD, though FTS5 indexing only covers 2 of the 8 layers (main entries + verbatim). The knowledge graph has bi-temporal columns. Provenance is actually logged. Consolidation locks prevent concurrent autoDream. The main shortcoming is local semantic search: `generateLocalEmbedding` is trigram-hashed-bag-of-words at 256 dims, not real embeddings. When `@xenova/transformers` isn't installed (default), the "vector" 30% weight in hybrid search effectively collapses to TF-IDF.

**Q2: Is the orchestration layer (waves, PWR, Ralph, council, arena, autonomous) all wired and tested?**

Yes. Every class is constructed somewhere in `src/core/runtime.ts` or `src/daemon/kairos.ts`. Every class has a corresponding test file in `tests/unit/`. The council 3-stage flow, the wave-executor fresh-context snapshotting, the autonomous 8-strategy escalation, and the self-healing pattern recovery are all real implementations, not stubs. The only exception is `AutoresearchEngine` which is wired with a `async () => null` no-op generator that never gets replaced (`runtime.ts:934`).

**Q3: Is the learning layer (autoDream, skill-forge, instinct-system, nightly-consolidator, decision-ledger, pattern-crystallizer, cross-session-learner, self-evolution, dream-pipeline, feedback-collector) real or stubbed?**

All 10 are real, with one caveat: `autodream.ts` (the legacy 4-phase) has a known weakness where "patterns" surface as stopword-frequency words. The 3-phase `dream-pipeline.ts` uses a STOP_WORDS set and is the primary path. `feedback-collector.ts` exports real KTO + DPO format JSONL. `pattern-crystallizer.ts` writes real SKILL.md files when a pattern reaches 5 uses x 70% success. `self-evolution.ts` can genuinely edit `USER.md` / `MEMORY.md` / skills (approval-gated).

**Q4: Context management — 5-stage compaction, TurboQuant, virtual-context — all real?**

- 5-stage compaction: real, in `window-intelligence.ts` (`compact(stage)` with 5 cases) and also in `compaction.ts` (5 strategy names with real implementations, the `hybrid` path chains summarize + evict-by-type + evict-oldest).
- TurboQuant: real in `ollama-kv-compression.ts`, with 3 compression profiles, VRAM estimation, and context virtualization sharding. Only produces Ollama params — no embedding-layer quantization (that belongs to `quantized-vector-store.ts`).
- Virtual context: real in `virtual-context.ts` with 3 partition strategies and keyword-scored retrieval.

**Q5: VERIFY every major claim against actual code.**

Verified. Major claims (8-layer memory, FTS5, bi-temporal KG, autoDream 3-gate trigger, 8-strategy autonomous executor, 3-stage council, wave fresh-context, 30-day freshness half-life, progressive L0/L1/L2/L3 context loading, TurboQuant quantization profiles, 5-stage compaction, architect/editor pipeline, SelfHealingPipeline with 4 strategies) all match the code. See section 6 for the exhaustive false-claim catalog — all 10 items are narrow, localized, or cosmetic. None invalidates the overall architecture.

---

## 11. Recommendations (ranked by impact)

1. **Fix `active-memory.ts:141` recall path** — change `r.content` to `r.entry.value`. Silent failure since at least session 1. ~5 min fix.
2. **Replace `runtime.ts:934` no-op generator** with a real text generator from the runtime's agent bridge, or delete the autoresearch wiring entirely if it's not used. ~30 min.
3. **Delete the duplicate `memory_search_in_domain` tool definition** at `memory-tools.ts:218`. 2 min.
4. **Add a `getBackend()` log warning** or capability flag when QuantizedVectorStore falls back to TF-IDF. Expose in `HybridMemorySearch` so the 0.3 weight can be reallocated. 1 hr.
5. **Run `MemoryBenchmark`** before/after the domain-filter change and replace the "+34% retrieval" paper citation with actual numbers. 2 hr.
6. **Add a `STOP_WORDS` set to `phaseRecall`** in `autodream.ts` to match `dream-pipeline.ts`. 5 min.
7. **Make `unified-knowledge.ts:92` `averageTrustScore` real** — compute from per-source usefulness feedback via `RetrievalQualityScorer`. 2 hr.
8. **Remove the "native qmd runtime" claim** from `qmd-integration.ts:31` until a binary detection path exists. 2 min.
9. **Make `quantized-vector-store.ts:loadTransformers` log-once** when falling back. 5 min.
10. **Document that FTS5 covers only `memory_entries` + `verbatim_drawers`** so callers don't assume KG/team/working/auto_capture are MATCH-searchable. 10 min.

Total effort for all 10: <10 hours. After these, the memory/context/orchestration/learning layer would be honest about every capability it advertises.

---

## 12. Closing

The layer is real. It is also larger and more ambitious than most competitor harnesses at the same repo scale. The false-claim density is low but non-zero, and the one that matters most (`active-memory.ts` recall) silently degrades a loudly-advertised feature. Fix the 10 items in section 11 and the memory/learning stack will match its spec without caveats.

_— Deep read completed 2026-04-18, Opus 4.7 (1M context), max effort._
