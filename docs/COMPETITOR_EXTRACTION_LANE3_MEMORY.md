# Competitor Deep-Extraction Lane 3 — Memory Systems

**Audit agent**: 3 of 8 · Opus 4.7 max-effort
**Scope**: cognee · claude-context · context-mode · LongMemEval + 7 memory-system competitors
**Date**: 2026-04-19
**Target**: WOTANN `src/memory/` (27 modules listed, ~13,258 LOC; 14 orphaned per caller audit)

---

## 1. Executive Summary

### Headline findings

1. **WOTANN's memory stack already ships most SOTA primitives but in isolated modules** — typed entities (`entity-types.ts`), bi-temporal edges (`graph-rag.ts`), dual timestamps (`dual-timestamp.ts`), `updates/extends/derives` relationships (`relationship-types.ts`), contradiction detection, hybrid retrieval with LLM rerank (`hybrid-retrieval.ts`), SHA-based incremental indexing (`incremental-indexer.ts`), and a QMD-style precision retriever (`qmd-integration.ts`). The raw building blocks are ≥ parity with Supermemory, Zep, MemPalace. **The gap is composition, not components.**
2. **No module composes these into a LongMemEval-able pipeline.** There is no `memory/longmemeval-runner.ts`, no ability to ingest a `longmemeval_*.json` file, run retrieval, feed a reader LLM, and emit the `{question_id, hypothesis}` JSONL that `evaluate_qa.py` requires. Without this, "WOTANN memory" has no defensible score — it cannot even be compared to EverMemOS (83.0%), Supermemory (81.6%), MemPalace (96.6% raw / 84.2% compressed), or Observational Memory (94.87% with GPT-5-mini).
3. **Cognee's EntityType schema is NOT what WOTANN's `entity-types.ts` ships.** Cognee uses Pydantic `DataPoint` subclasses — `Entity`, `EntityType`, `Event`, `Triplet`, `Interval`, `Timestamp`, `TableRow`, `ColumnValue`, `node_set` — with an LLM-based extractor pipeline (`cognee/tasks/graph/extract_graph_from_data.py`) that produces graph DB writes via Instructor structured output. WOTANN's version is a Zod discriminated union of 8 types (person, project, file, concept, event, goal, skill, tool) with a simpler LLM extractor. **Cognee's approach is richer (TableRow, ColumnValue, Triplet as first-class), but WOTANN's is more TypeScript-native.**
4. **Claude-context's Merkle DAG is meaningfully stronger than WOTANN's single-SHA cache.** Claude-context builds a per-commit DAG where comparing two DAGs produces `{added, removed, modified}` in O(delta). WOTANN's `IncrementalIndexer` stores one SHA per path — equivalent to claude-context's file-hash map, but missing the DAG root which gives an instant "repo changed at all?" short-circuit.
5. **The phrase "QMD precision retrieval" in WOTANN is a local fallback, not a real QMD integration.** `src/memory/qmd-integration.ts` runs simple term-frequency scoring on project files — it does NOT use tobi/qmd's BM25 + vector + Qwen3-Reranker-0.6B stack. Comments in the file confirm: `"When the native qmd runtime is not available, this falls back to lightweight paragraph/chunk scoring"`. There is no path that invokes native qmd.
6. **Three LongMemEval abilities are currently unreachable by WOTANN's memory:**
   - **Abstention** (detecting un-answerable questions) — no abstention policy in any module. `contradiction-detector.ts` detects conflicting facts, not missing ones.
   - **Temporal reasoning** (dates, durations, relative-time) — `dual-timestamp.ts` has `parseDateHints` and `recordedIn/eventIn` filters, but no "days between X and Y" arithmetic; the `TemporalMemory.eventFrequency` exists but isn't wired into retrieval.
   - **Knowledge updates** (policy v1 → v2 → v3) — `resolveLatest` in `relationship-types.ts` walks `updates` chains correctly, but only if classifier wrote the edges. No pipeline builds these edges at ingestion.

### LongMemEval runnability assessment

| Question | Answer | Evidence |
|---|---|---|
| Is LongMemEval repo cloned? | **Yes** (just cloned, `longmemeval/` at `research/__new_clones/longmemeval`) | `git clone --depth=1 https://github.com/xiaowu0162/LongMemEval.git` exit 0 |
| Is the dataset available? | **No locally.** HuggingFace download required (`longmemeval_oracle.json`, `_s_cleaned.json`, `_m_cleaned.json`) | `longmemeval/data/` is empty, README shows `wget` steps |
| Can `evaluate_qa.py` run against WOTANN hypotheses? | **Yes, after** WOTANN emits JSONL with `{question_id, hypothesis}` | `evaluate_qa.py` takes `hyp_file` arg; pip-lite is 5 pkgs |
| Does WOTANN have a runner to produce hypotheses? | **No.** This is the single biggest gap | No `longmemeval*.ts` anywhere in `src/` |
| How many LOC to wire up a runner? | **~250-400 LOC** — reader wrapper + hypothesis emitter + dataset loader | See §4 wire-up plan |

### Top 5 ports (ranked by LongMemEval-score impact)

| Rank | Port | Source | Est. LMe delta | Effort |
|---|---|---|---|---|
| 1 | **LongMemEval runner** (hypothesis emitter + score harness) | LongMemEval repo | +0 → baseline only (but enables all other deltas) | 1 day |
| 2 | **EverMemOS three-phase pipeline** (MemCell → MemScene → Reconstructive) | EverMemOS repo, arXiv 2601.02163 | +8-15 pts on multi-session + temporal | 3-5 days |
| 3 | **Observational Memory's stable-context trick** (append-only observation log with triple dates) | Mastra research | +5-8 pts on temporal-reasoning, plus 4-10× cache cost reduction | 2 days |
| 4 | **Cognee's Triplet-as-DataPoint + graph-completion retriever** (wire WOTANN's typed entities into a Triplet subgraph for structured queries) | `cognee/modules/engine/models/Triplet.py` + `TripletSearchContextProvider.py` | +4-6 pts on single-session-assistant + knowledge-update | 3 days |
| 5 | **Claude-context's Merkle DAG** replacing WOTANN's flat SHA cache | `claude-context/packages/core/src/sync/merkle.ts` | 0 LMe delta (it's a code-index feature) but 3-8× faster reindex on large repos | 1 day |

---

## 2. Per-System Architecture Breakdown

### 2.1 cognee (topoteretes/cognee)

**What it is**: Open-source ECL (Extract → Cognify → Load) memory platform. Replaces RAG with knowledge graphs + vector + relational. Python 3.9-3.12.

**Core pipeline**: `add() → cognify() → search()` (async functions in `cognee/__init__.py`).

**Entity model** (`cognee/modules/engine/models/`):

| File | Class | Purpose |
|---|---|---|
| `Entity.py` | `Entity(DataPoint)` | Node with `name`, `is_a: EntityType`, `description`, `relations: List[tuple]` |
| `EntityType.py` | `EntityType(DataPoint)` | Type metadata — `name`, `description`, `relations` |
| `Event.py` | `Event(DataPoint)` | `name`, `at: Timestamp`, `during: Interval`, `location`, `attributes: Any` |
| `Triplet.py` | `Triplet(DataPoint)` | `text`, `from_node_id`, `to_node_id` — a first-class (S,P,O) |
| `Interval.py` | `Interval(DataPoint)` | `time_from: Timestamp`, `time_to: Timestamp` |
| `Timestamp.py` | `Timestamp(DataPoint)` | Decomposed: `year/month/day/hour/minute/second/time_at/timestamp_str` |
| `TableRow.py` / `ColumnValue.py` / `TableType.py` | table-aware types | Enable structured-data ingestion |
| `node_set.py` | Grouping primitive | Bulk operations |

**Key differentiator vs WOTANN entity-types.ts**:
- Cognee extends `DataPoint` (versioned, metadata-indexed, vector-embeddable). WOTANN's Zod types are plain data, not embeddable without extra plumbing.
- Cognee has `Triplet` as a DataPoint — this is the atomic unit for graph-completion retrieval. WOTANN has no equivalent — `graph-rag.ts` stores Entity/Relationship but never materializes triplets as indexed+embedded chunks.
- Cognee has `Event.at` and `Event.during`, supporting both point and interval time. WOTANN's `EventSchema` only has `whenMs` (a point).
- Cognee has `TableRow` and `ColumnValue` — spreadsheet/DB ingestion. WOTANN has none of this.

**Graph structure** (`cognee/modules/graph/cognee_graph/CogneeGraphElements.py`): Pydantic `Node` and `Edge` with `numpy` status arrays for multi-dimensional dead/alive state, skeleton-neighbours/edges for graph traversal, and per-query vector distances cached on the node itself. Much richer than WOTANN's flat `Map<string, Entity>`.

**Retrieval types** (`cognee/modules/search/types/SearchType.py`): `GRAPH_COMPLETION`, `GRAPH_SUMMARY_COMPLETION`, `GRAPH_COMPLETION_COT`, `GRAPH_COMPLETION_CONTEXT_EXTENSION`, `TRIPLET_COMPLETION`, `RAG_COMPLETION`, `CHUNKS`, `CHUNKS_LEXICAL`, `SUMMARIES`, `CYPHER`, `NATURAL_LANGUAGE`, `TEMPORAL`, `FEELING_LUCKY`, `CODING_RULES` — 14 first-class retrievers. WOTANN's `hybrid-retrieval.ts` has 2 (lexical + vector).

**Parity vs WOTANN's `relationship-types.ts`**:
- WOTANN has `updates | extends | derives | unknown` + classifier + `resolveLatest`. **Cognee has no direct equivalent of this kind-taxonomy.** Its edges carry free-text `relationship_name` instead. **WOTANN is actually ahead here.** But WOTANN lacks a pipeline that invokes the classifier on every ingestion — it's a library, not a reflex.

**What to port from cognee**:
1. **`Triplet` as a DataPoint** — make WOTANN triplets indexed+embedded so graph-completion works.
2. **`Event.at` + `Event.during`** — widen `EventSchema` in `entity-types.ts` to accept an interval.
3. **`TableRow` + `ColumnValue`** — enable CSV/spreadsheet ingestion. Zero LMe impact but expands TAM.
4. **14 search types** — most important: `GRAPH_COMPLETION_COT` (chain-of-thought over graph), `TEMPORAL` (time-aware), `FEELING_LUCKY` (auto-select retrieval strategy).
5. **Multi-tenant access control** (`ENABLE_BACKEND_ACCESS_CONTROL`) — per-user+dataset isolated DBs. Useful when WOTANN hosts multiple projects.

---

### 2.2 claude-context (zilliztech/claude-context)

**What it is**: TypeScript + Python semantic code-search library. Splits code via tree-sitter AST, embeds chunks, stores in Milvus/Zilliz, syncs via Merkle DAG.

**Core components** (`packages/core/src/`):

| Module | Class | Purpose |
|---|---|---|
| `splitter/ast-splitter.ts` | `AstCodeSplitter` | Tree-sitter AST chunking for 9 languages (JS/TS/Python/Java/C++/Go/Rust/C#/Scala) |
| `splitter/langchain-splitter.ts` | LangChainCodeSplitter | Fallback for unsupported languages |
| `embedding/` | OpenAI, Gemini, Ollama, VoyageAI | Pluggable providers |
| `vectordb/milvus-*.ts` | Milvus adapters | Hybrid (dense+sparse) collections |
| `sync/merkle.ts` | `MerkleDAG` | DAG of file hashes for incremental sync |
| `sync/synchronizer.ts` | `FileSynchronizer` | Uses MerkleDAG to compute `{added, removed, modified}` |
| `context.ts` | `Context` | Top-level: `indexCodebase`, `reindexByChange`, `semanticSearch` (hybrid with RRF rerank) |

**Algorithm — hybrid search** (from `context.ts:460`):
```
const searchRequests = [
  { data: queryVec,   anns_field: "vector",        limit: topK },
  { data: queryText,  anns_field: "sparse_vector", limit: topK }
];
await vectorDB.hybridSearch(collection, searchRequests,
  { rerank: { strategy: 'rrf', params: { k: 100 } }, limit: topK }
);
```
This is the Milvus RRF pattern — dense + sparse vectors merged via Reciprocal Rank Fusion. Present in WOTANN's `hybrid-retrieval.ts` but there the "vector retriever" is a factory, not a Milvus call — so WOTANN won't scale to 100k+ chunks the way claude-context does.

**AST splitter node types**:
- TypeScript: `function_declaration, arrow_function, class_declaration, method_definition, export_statement, interface_declaration, type_alias_declaration`
- Python: `function_definition, class_definition, decorated_definition, async_function_definition`
- Rust: `function_item, impl_item, struct_item, enum_item, trait_item, mod_item`

WOTANN's `graph-rag.ts` does entity extraction with regex (`ENTITY_PATTERNS`) — claude-context does it with real ASTs. **Regex will miss class bodies that span closures, arrow functions inside object literals, TS generics, etc. AST doesn't.**

**Merkle DAG parity audit vs WOTANN's `incremental-indexer.ts`**:

| Feature | WOTANN incremental-indexer.ts | claude-context merkle.ts + synchronizer.ts |
|---|---|---|
| SHA per file | `Map<path, {sha, indexedAt, chunksCount}>` | `Map<path, sha>` + `MerkleDAG` of nodes |
| Root short-circuit | **Missing** — must scan all files every time | **Present** — root node hashes all file hashes; if root unchanged, no traversal |
| Delta compute | `shouldReindexFromDisk(path)` per path | `MerkleDAG.compare(old, new) → {added, removed, modified}` O(n) |
| Snapshot atomic write | Temp file + rename ✓ | JSON write — not atomic by default |
| Case-insensitive FS support | ✓ (`caseInsensitive` flag) | Not handled |
| Prune deleted files | ✓ (`prune(existingPaths)`) | Handled via `compareStates` returning `removed` |
| Persistent snapshot path | `~/.wotann/index-cache.json` | `~/.context/merkle/{hashOfCodebasePath}.json` |

**Verdict**: WOTANN has similar surface but **missing the DAG root short-circuit** — the single biggest speedup for "no changes since last run." Root comparison is O(1); currently WOTANN re-hashes every file. Fix: `buildMerkleDAG` analog in `incremental-indexer.ts` that rolls file SHAs into a root SHA and stores it.

**What to port**:
1. **MerkleDAG root** — O(1) "nothing changed" path.
2. **AST splitter** — replace regex entity extraction in `graph-rag.ts`. tree-sitter packages are already NPM-available.
3. **Milvus adapter interface** — WOTANN's `vector-store.ts` (528 LOC) is in-process; claude-context shows the Milvus pattern for scale.

---

### 2.3 context-mode (mksglu/context-mode)

**What it is**: MCP server + hooks for context-window protection. Runs raw tool output in sandboxed subprocesses, indexes markdown into SQLite FTS5, restores state after compaction. Not a memory system in the LongMemEval sense — it's a session-continuity + sandbox layer.

**Core architecture**:
- **SQLite FTS5** with dual tokenizers: porter-stemming + trigram, merged via **RRF**.
- **Smart snippets**: finds windows around query-term matches, not truncates first-N.
- **Fuzzy correction**: Levenshtein distance on typos pre-search.
- **Proximity reranking**: multi-term queries boost passages with adjacent terms.
- **TTL cache**: 24h URL cache, 14-day cleanup.
- **Progressive throttling**: calls 1-3 normal, 4-8 reduced, 9+ blocked.
- **Session DB** (`src/session/db.ts`): priority-tiered event log with FIFO eviction at 1000 events, dedup on recent 5, worktree-suffix isolation for monorepos.
- **WorkspaceRouter** (`src/openclaw/workspace-router.ts`): maps tool-call params to per-workspace sessionIds.

**Key technique — compaction recovery flow**:
```
PreCompact → read session events → build priority-tiered XML snapshot ≤2 KB
  → store in session_resume table
SessionStart (source: compact) → retrieve snapshot → write to FTS5 → inject
  <session_knowledge> → model continues from last prompt
```

**What WOTANN could port**:
1. **RRF of porter + trigram tokenizers** in `semantic-search.ts` — currently WOTANN's lexical path is basic substring scoring (see `qmd-integration.ts:scoreChunk` — just term count × term length).
2. **Priority-tiered event log with FIFO eviction** — good pattern for WOTANN's session state if it adopts a similar resume-after-compact flow. But this overlaps heavily with WOTANN's existing `store.ts` (1994 LOC).
3. **Fuzzy correction (Levenshtein)** — one-shot upgrade for retrieval quality on typo-heavy queries.
4. **WorkspaceRouter** — useful if WOTANN hosts multiple projects under one daemon.
5. **Progressive throttling** — prevent agents from spam-searching during loops.

**What NOT to port**: the whole "sandbox subprocess" model. That's context-mode's core value prop and WOTANN doesn't compete there — WOTANN is a runtime, not an MCP server.

---

### 2.4 LongMemEval (xiaowu0162/LongMemEval, ICLR 2025)

**What it is**: Benchmark — 500 questions across 5 abilities, tests chat-assistant long-term memory over 40-500 sessions of history.

**Five abilities** (directly from README):
1. **Information extraction** — recall facts stated in history
2. **Multi-session reasoning** — compose facts across sessions
3. **Temporal reasoning** — answer time/date/duration questions
4. **Knowledge updates** — prefer the most recent fact when state changes
5. **Abstention** — correctly say "I don't know" when info is missing (30 instances, marked by `_abs` suffix on question_id)

**Three dataset sizes**:
- `longmemeval_oracle.json` — only evidence sessions (bypass retrieval, tests reader)
- `longmemeval_s.json` — ~40 sessions, ~115k tokens total (fits 128k context)
- `longmemeval_m.json` — ~500 sessions (retrieval required)

**Question record format**:
```json
{
  "question_id": "...",
  "question_type": "single-session-user|single-session-assistant|single-session-preference|temporal-reasoning|knowledge-update|multi-session",
  "question": "...",
  "answer": "...",
  "question_date": "...",
  "haystack_session_ids": [...],
  "haystack_dates": [...],
  "haystack_sessions": [[{role,content,has_answer?}, ...], ...],
  "answer_session_ids": [...]
}
```

**Scoring pipeline** (`src/evaluation/evaluate_qa.py`):
1. Load `hyp_file` — JSONL of `{question_id, hypothesis}`
2. Load `ref_file` — the dataset JSON
3. For each question: generate GPT-4o-judge prompt per question_type (different prompts for temporal-reasoning, knowledge-update, single-session-preference, abstention)
4. Metric model (`gpt-4o`) returns yes/no; aggregate accuracy by question_type

**Reference retrieval baselines** (`src/retrieval/run_retrieval.py`):
- `flat-bm25`, `flat-contriever`, `flat-stella` (Stella 1.5B), `flat-gte` (gte-Qwen2-7B-instruct), `oracle`
- Index granularity: `turn` or `session`
- Optional index-expansion: session/turn summaries, keyphrases, userfacts

**Reader pipeline** (`src/generation/run_generation.sh`):
```
bash run_generation.sh DATA_FILE MODEL full-history-session TOPK
  [HISTORY_FORMAT: json|nl] [USERONLY: true|false]
  [READING_METHOD: direct|con|con-separate]
```
Recommended: `HISTORY_FORMAT=json, USERONLY=false, READING_METHOD=con` (extract-then-reason).

**Can WOTANN's memory answer all 5 abilities today?** Per-ability assessment:

| Ability | WOTANN module that could answer | Gap |
|---|---|---|
| **Information extraction** | `hybrid-retrieval.ts` + `semantic-search.ts` | Needs runner; shape of retrieval is right. **Weak**: BM25-path in `semantic-search.ts` is crude substring; fix: real tokenizer or port context-mode's FTS5 |
| **Multi-session reasoning** | `graph-rag.ts` (`dualLevelRetrieval`) | Good primitive but no pipeline composes session-spanning evidence into the prompt |
| **Temporal reasoning** | `dual-timestamp.ts` + `temporal-memory.ts` | Date parsing exists (`parseDateHints`, 10 regex patterns). Arithmetic (days-between, "X days ago") **missing**. `TemporalMemory.eventFrequency` exists but isn't invoked by retrieval |
| **Knowledge updates** | `relationship-types.ts` (`updates` kind + `resolveLatest`) | Library correct. **No pipeline writes these edges at ingestion.** `HeuristicClassifier` is defined but I find zero production callers |
| **Abstention** | **Nothing** | Zero abstention primitive. `contradiction-detector.ts` detects conflicting facts, not missing ones. This is the weakest ability |

**Weakest ability**: **Abstention**, then **Temporal reasoning** (arithmetic), then **Knowledge updates** (pipeline integration).

---

### 2.5 EverMemOS (EverMind-AI/EverMemOS)

**Three-phase pipeline** (from arXiv 2601.02163 + labnotes.tech breakdown):

1. **Episodic Trace Formation** — ingest dialogue stream, emit **MemCells**. Each MemCell contains:
   - Episodic trace (what was said)
   - Atomic facts (extracted claims)
   - Time-bounded foresight (predicted future relevance window)
2. **Semantic Consolidation** — group MemCells into **MemScenes** (themed clusters); distill stable semantic structure; update persistent user profile
3. **Reconstructive Recollection** — agentic retrieval: compose "necessary and sufficient context" per query, not just top-k

**Scores**: 93.05% LoCoMo, **83.00% LongMemEval**. Particularly strong on multi-hop reasoning (+12.1 pts vs baselines) and temporal questions (+16.1 pts). Language: Python (94.4%).

**Port viability for WOTANN**:

| EverMemOS concept | Nearest WOTANN equivalent | Port effort |
|---|---|---|
| MemCell | `observation-extractor.ts` `Observation` interface | Extend with `atomicFacts: string[]` and `foresightWindowMs` |
| MemScene | `episodic-memory.ts` `EpisodeSummary` | Rename/extend to cluster by theme, not just time |
| Reconstructive Recollection | `hybrid-retrieval.ts` | Wrap with an "iteratively fetch until coverage threshold" loop; this is the +6-12 pts unlock |
| Time-bounded foresight | **Missing entirely** | New field on Observation; set by LLM at ingestion; decay factor in retrieval score |
| Persistent user profile | `user_gabriel.md` in MEMORY.md | Add a structured `user-profile.ts` module that EverMemOS-style consolidates preferences |

**Recommended port order**: MemCell extension → Reconstructive Recollection loop → MemScene theming.

---

### 2.6 Supermemory.ai

**Five-layer stack** (from supermemory.ai/research):

1. Chunk-based ingestion — semantic blocks + atomic memory units
2. Relational versioning + knowledge chains — maps fact evolution via semantic relationships
3. Temporal grounding — dual-layer timestamping (`documentDate` + `eventDate`)
4. Hybrid search — semantic on memories with original-chunk injection
5. Session-based ingestion — per-session, not per-turn

**Three relationship types** (THIS IS THE SAME TAXONOMY AS WOTANN's `relationship-types.ts`):
- `updates` — contradictions/corrections
- `extends` — new details without contradiction
- `derives` — inferred logic combining distinct memories

**LongMemEval score**: 81.6% overall. Per-ability: single-session-user 97.14%, single-session-assistant 96.43%, single-session-preference 70.00%, knowledge-update 88.46%, temporal-reasoning 76.69%, multi-session 71.43%.

**WOTANN parity check**:
- Layer 1 (chunk ingestion): ✓ in `semantic-search.ts` + `vector-store.ts`
- Layer 2 (relational versioning): ✓ in `relationship-types.ts` (exact same taxonomy)
- Layer 3 (dual timestamping): ✓ in `dual-timestamp.ts` (`DualTimestampEntry` has `recordedAt` + `eventDate`)
- Layer 4 (hybrid search): ✓ in `hybrid-retrieval.ts`
- Layer 5 (session-based ingestion): **Partial** — `episodic-memory.ts` has `Episode` but no "process a whole session as a unit" entry point

**Verdict**: WOTANN is at ~90% of Supermemory's architecture on paper. **The last 10% + composition layer is what gets the score.**

---

### 2.7 Letta / MemGPT

**Two-tier model** (docs.letta.com):
- **Core memory** — in-context editable blocks (managed via `core_memory_append`, `core_memory_replace`)
- **Archival memory** — vector-DB table for long-running memories + external data sources (managed via `archival_memory_insert`, `archival_memory_search`)

**Analogy**: core = RAM, archival = disk; agent reads/writes both via tools.

**WOTANN mapping**:
- Core memory ≈ `context-fence.ts` + `context-loader.ts` (what enters the prompt)
- Archival memory ≈ `vector-store.ts` + `semantic-search.ts`
- **Missing**: the agent-managed tool surface. WOTANN doesn't expose `core_memory_append` as a tool the model calls. It implicitly manages the context.

**Port**: a lightweight `memory-tools.ts` slash-command/function that lets the model explicitly write to a pinned context block.

---

### 2.8 Zep / Graphiti (getzep/graphiti)

**Architecture** (arXiv 2501.13956):

A temporally-aware knowledge graph `G = (N, E, ϕ)` with **three hierarchical subgraphs**:
1. **Episode subgraph** — episodic nodes contain raw input (messages/text/JSON); non-lossy store
2. **Semantic entity subgraph** — entity nodes extracted from episodes, resolved against existing graph entities
3. **Community subgraph** — entity clusters

**Temporal management**: bi-temporal — facts have validity windows (`valid_from`, `valid_to`); contradictions invalidate old facts (set `valid_to`), never delete.

**Score**: DMR benchmark 94.8% (vs MemGPT 93.4%); ~90% latency reduction.

**WOTANN parity**:
- Episode subgraph ≈ `episodic-memory.ts`
- Semantic entity subgraph ≈ `graph-rag.ts` + `entity-types.ts`
- **Community subgraph — MISSING** (no Leiden clustering anywhere)
- Bi-temporal edges ✓ in `graph-rag.ts` (`validFrom`/`validTo`, `invalidateRelationship`, `getActiveRelationshipsAt`). Excellent — WOTANN already has this.

**Port**: **Leiden / Louvain community detection** on the entity graph. Zep's clustering is what enables "community-level summaries" — much better than chunk-level for abstract questions. Libraries: `graphology-communities-louvain` (NPM).

---

### 2.9 Mem0

**Hybrid architecture** (mem0.ai/blog/ai-memory-layer-guide):
- **Vector store** (default) — semantic search
- **Graph store** (optional) — extracts entity relationships: `works_with`, `reports_to`, `member_of`
- **Key-value store** — audit log

**Memory Consolidation algorithm**: compares new facts against existing memories via vector similarity; LLM decides `ADD|UPDATE|DELETE|NOOP` per fact. Mitigates continuous extraction.

**WOTANN parity**:
- Vector store ✓ (`vector-store.ts`, `semantic-search.ts`)
- Graph store ✓ (`graph-rag.ts`)
- KV audit log — partial (`store.ts` is the SQLite layer, but not structured as audit)
- **Memory Consolidation ADD/UPDATE/DELETE loop — MISSING**. This is the part that prevents memory bloat. Fix: extend `observation-extractor.ts` with a post-extract consolidation step.

---

### 2.10 MemPalace (milla-jovovich/mempalace)

**Claimed**: 96.6% LongMemEval raw, 84.2% with AAAK compression, 170-token startup, fully offline, MCP integration.

**Reality check** (from GitHub issue #214 + medium.com review):
- The 96.6% is **ChromaDB vector search on uncompressed text** — the "palace structure" is metadata filtering on top.
- AAAK compression drops the score to 84.2% — so the compression claim is real but comes with 12-pt accuracy loss.
- Bi-temporal knowledge graph in local SQLite (every fact has validity window).

**WOTANN parity**: WOTANN's `mem-palace.ts` (267 LOC) implements the "Hall / Wing / Room" path-indexing pattern. It's a path-based filter on top of the store, not a retrieval system. The real performance comes from whatever backs it (ChromaDB for MemPalace; in WOTANN, it's the in-memory store).

**Port**: **memory-palace path-indexing + ChromaDB backend** would let WOTANN hit the same number on the same test, minus the compression step. But the 96.6% is largely a dataset-size artifact (longmemeval_s fits in vector search trivially) — a 500-session `longmemeval_m` is where real systems differentiate.

---

### 2.11 QMD (tobi/qmd)

**NOT a memory system — it's a local search engine for markdown.**

**Three-layer pipeline** (from deepwiki.com/tobi/qmd):
1. **Parallel retrieval** — BM25 (FTS5) + vector (cosine) on original query + 1-2 LLM-generated variations
2. **Fusion & ranking** — RRF with position bonuses; top-30 candidates
3. **Reranking** — Qwen3-Reranker-0.6B-Q8 scores each; blended with retrieval scores (75% retrieval for ranks 1-3, declining to 40% for rank 11+)

**Stack**:
- EmbeddingGemma-300M-Q8 (vectors) — 300 MB
- Qwen3-Reranker-0.6B-Q8 (reranking) — 640 MB
- QMD-Query-Expansion-1.7B-Q4_K_M (query expansion) — 1.1 GB
- node-llama-cpp for inference, all offline after first download
- MCP server: `query`, `get`, `multi_get`; stdio or HTTP on :8181

**"QMD precision retrieval" in WOTANN**: this term appears in `qmd-integration.ts` and in `monitor-config.yaml`. Reading the file (`src/memory/qmd-integration.ts`), it is **a local fallback that does not invoke tobi/qmd**:

```ts
export class QMDContextEngine {
  private projectDir: string | null = null;
  private mode: QMDMode = "disabled";  // only "fallback" | "disabled"

  // scoreChunk uses term occurrence * term length — NOT BM25, NOT vector, NOT rerank
  function scoreChunk(chunk: string, terms: readonly string[]): number {
    for (const term of terms) {
      const occurrences = haystack.split(term).length - 1;
      score += occurrences * Math.max(term.length, 1);
    }
  }
}
```

**This is misleading naming.** The module comments admit: `"When the native qmd runtime is not available, this falls back to lightweight paragraph/chunk scoring so the runtime still injects only the most relevant snippets instead of full files."` But there is no path in the code that uses tobi/qmd. The `"fallback"` mode IS the only mode.

**Port options**:
1. **Honest stub**: rename to `LocalRelevanceScorer` and drop the "QMD precision retrieval" branding; it's just term-frequency scoring.
2. **Real QMD integration**: spawn `qmd` as a subprocess (it runs as an MCP server on stdio or HTTP :8181), query its tools. ~80 LOC.
3. **Port the QMD algorithm** to pure TS (BM25 + vector + local rerank). Requires loading GGUF models via node-llama-cpp. ~500 LOC.

---

### 2.12 Observational Memory (Mastra)

**Three-tier system** (mastra.ai/research/observational-memory):
1. **Message history** — raw recent conversation
2. **Observations** — dense dated notes, created when message history exceeds threshold
3. **Reflections** — restructured observations, created when observations accumulate

**Two background agents** — Observer + Reflector, invisible to main agent.

**Key innovation — stable context window**:
- Observations are append-only; context window has memory (observations) at start, messages at end
- No per-turn prompt changes → high prompt-cache hit rate → **4-10× cost reduction**

**Temporal anchoring**: each observation carries THREE dates:
- Observation date
- Referenced date
- Relative date

**Result**: 94.87% with GPT-5-mini (highest recorded), 84.23% with GPT-4o. Temporal reasoning specifically: 95.5%.

**WOTANN parity**:
- Message history ✓ (whatever the bridge pipes in)
- Observations ✓ in `observation-extractor.ts` (`Observation` interface, `ObservationStore`)
- Reflections — `proactive-memory.ts` has `ProactiveHint` but no reflection structure
- **Three-date temporal anchoring — MISSING**. WOTANN's `dual-timestamp.ts` has two dates (`recordedAt`, `eventDate`). Adding a third (`referencedDate`) is a small change but unlocks the temporal-reasoning delta.
- **Append-only / stable context** — MISSING. WOTANN's retrieval is per-turn dynamic; this is a philosophical shift, not a module.

**Highest-value port**: triple timestamps + append-only observation log. Both small; the "stable context" property needs the retrieval layer to NOT rewrite the prompt each turn.

---

## 3. Port-Priority List for WOTANN

Ranked by (impact on LongMemEval score) ÷ (engineering effort), descending. Effort in engineer-days, 1 FTE.

| # | Port | Source | LMe delta est. | Effort | ROI |
|---|---|---|---|---|---|
| 1 | **LongMemEval runner** (hypothesis emitter + score harness) | LongMemEval repo | prerequisite | 1d | **critical** — can't measure anything else without this |
| 2 | **Triple timestamps + append-only observations** | Observational Memory | +5-8 temporal, +2-4 multi-session | 2d | 3.5/d |
| 3 | **Reconstructive Recollection loop** (iterate retrieval until coverage) | EverMemOS | +4-8 multi-hop | 3d | 2/d |
| 4 | **Abstention policy** (detect un-answerable questions) | novel, LongMemEval-specific | +30% on 30 abstention instances = +1.8 overall | 1d | 1.8/d |
| 5 | **Wire Heuristic+LLM classifier into ingestion** (populate `updates/extends/derives` edges) | Supermemory-pattern, WOTANN has code | +3-5 knowledge-update | 2d | 2/d |
| 6 | **Temporal arithmetic** (days-between, "X days ago", interval reasoning) | novel | +3-6 temporal | 2d | 2.5/d |
| 7 | **Triplet DataPoint + graph-completion retriever** | Cognee `Triplet.py` + `TripletSearchContextProvider.py` | +2-4 single-session-assistant | 3d | 1/d |
| 8 | **Merkle DAG root short-circuit** | claude-context `merkle.ts` | 0 LMe — 3-8× reindex speedup | 1d | infra win |
| 9 | **AST splitter to replace regex entity extraction** in graph-rag.ts | claude-context `ast-splitter.ts` | +1-3 on code-heavy LMe (if wired) | 2d | 1/d |
| 10 | **Leiden community detection** on entity graph | Zep/Graphiti | +2-3 multi-session on abstract questions | 2d | 1.25/d |
| 11 | **Honest QMD integration** — either real subprocess or rename | tobi/qmd | 0 LMe — credibility win | 1d | debt removal |
| 12 | **Memory Consolidation loop** (ADD/UPDATE/DELETE/NOOP) | Mem0 | +1-3 across all abilities | 2d | 1/d |
| 13 | **MemScene clustering** (EverMemOS Phase 2) | EverMemOS | +1-3 long-horizon | 3d | 0.5/d |
| 14 | **Archival/core tool surface** (Letta `core_memory_append`) | Letta | small; model-dependent | 2d | 0.5/d |
| 15 | **Event.during interval + Table/ColumnValue DataPoints** | Cognee | TAM expansion, 0 LMe | 2d | future |

---

## 4. Specific Wire-Up Plan for LongMemEval Runner

### Goal

Enable: `wotann memory eval longmemeval --dataset oracle|s|m --model gemma4|sonnet|opus --output results.jsonl`

Output: JSONL with `{question_id, hypothesis}` per line, consumable by `src/evaluation/evaluate_qa.py`.

### Component list

```
src/memory/evals/
├── longmemeval-runner.ts       (new, ~250 LOC)   — top-level: load dataset, run pipeline per question, emit JSONL
├── longmemeval-loader.ts       (new, ~80 LOC)    — load + validate longmemeval_*.json, yield LongMemQuestion
├── longmemeval-types.ts        (new, ~60 LOC)    — LongMemQuestion, LongMemSession, LongMemTurn, QuestionType enum
├── longmemeval-ingest.ts       (new, ~120 LOC)   — ingest a single question's haystack_sessions into WOTANN's memory
│                                                   uses entity-types + observation-extractor + relationship-types
├── longmemeval-retrieve.ts     (new, ~100 LOC)   — retrieve top-K sessions/turns for a query
│                                                   uses hybrid-retrieval + graph-rag.ts dualLevelRetrieval
├── longmemeval-reader.ts       (new, ~80 LOC)    — prompt-builder: format retrieved + question, call LLM, return hypothesis
└── longmemeval-metrics.ts      (new, ~60 LOC)    — optional local scoring wrapper around evaluate_qa.py
```

CLI command: `wotann memory eval longmemeval`. Plumbed through `src/cli.ts` (need to verify exact entry point) and added to `wotann memory` subcommand group per CLAUDE.md naming.

### Step-by-step

**Step 1 — Dataset download** (one-time, pre-eval):
```bash
mkdir -p ./eval-data
cd ./eval-data
wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json
wget https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
# longmemeval_m_cleaned.json — optional, large
```

**Step 2 — Implement `longmemeval-types.ts`**:
```ts
export type QuestionType =
  | "single-session-user"
  | "single-session-assistant"
  | "single-session-preference"
  | "temporal-reasoning"
  | "knowledge-update"
  | "multi-session";

export interface LongMemTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly has_answer?: boolean;
}

export interface LongMemQuestion {
  readonly question_id: string;
  readonly question_type: QuestionType;
  readonly question: string;
  readonly answer: string;
  readonly question_date: string;
  readonly haystack_session_ids: readonly string[];
  readonly haystack_dates: readonly string[];
  readonly haystack_sessions: readonly (readonly LongMemTurn[])[];
  readonly answer_session_ids: readonly string[];
}

export interface LongMemHypothesis {
  readonly question_id: string;
  readonly hypothesis: string;
}

export function isAbstention(q: LongMemQuestion): boolean {
  return q.question_id.endsWith("_abs");
}
```

**Step 3 — `longmemeval-loader.ts`**: Zod schema + JSON load + streaming iterator for large `_m` file.

**Step 4 — `longmemeval-ingest.ts`**: for each question, build a FRESH WOTANN `KnowledgeGraph` + `VectorStore` + `ObservationStore`. For each session:
- Emit an `Event` entity with `whenMs` from `haystack_dates[i]`
- For each turn: extract entities (call `extractEntities` from entity-types.ts) + observations (call `ObservationExtractor.extract`)
- Run `HeuristicClassifier` on consecutive turns to populate `updates/extends/derives` edges
- Persist to WOTANN's store.ts SQLite (fresh per question)

**Step 5 — `longmemeval-retrieve.ts`**: For each question's query:
- Call `hybridRetrieval` with `maxDepth: 2` → graph results + keyword results
- Filter by `question_date` for temporal-reasoning questions (use `getActiveRelationshipsAt`)
- For `knowledge-update` type: call `resolveLatest` on candidates to prefer successors
- Return top-10 sessions (or top-30 turns)

**Step 6 — `longmemeval-reader.ts`**: Build prompt following LongMemEval's recommended format (`HISTORY_FORMAT=json, READING_METHOD=con`):
```
You are a helpful chat assistant. Answer the user's question based on
the provided chat history. First, extract the relevant information
from the history. Then, reason over it to answer the question.

History:
[JSON array of retrieved sessions, with dates]

Question date: {question_date}
Question: {question}

Extracted information: ...
Answer:
```
Call LLM via WOTANN's existing provider interface. Return the final answer text as hypothesis.

**Step 7 — `longmemeval-runner.ts`**: Main loop:
```ts
export async function runLongMemEval(opts: RunOpts): Promise<void> {
  const dataset = await loadLongMemEval(opts.datasetPath);
  const outStream = createWriteStream(opts.outputPath);

  let correct = 0, total = 0;
  const perType: Record<QuestionType, { correct: number; total: number }> = { ... };

  for await (const question of dataset) {
    const memory = await createFreshMemory(question);
    await ingestSessions(memory, question);
    const retrieved = await retrieveForQuery(memory, question);
    const hypothesis = await readAndAnswer(opts.reader, question, retrieved);

    outStream.write(JSON.stringify({ question_id: question.question_id, hypothesis }) + "\n");
    total++;
    if (total % 25 === 0) console.log(`[LMe] ${total}/500 questions complete`);
  }

  outStream.end();
  console.log(`[LMe] Wrote ${total} hypotheses to ${opts.outputPath}`);
  console.log(`[LMe] Next: run evaluate_qa.py gpt-4o ${opts.outputPath} ${opts.datasetPath}`);
}
```

**Step 8 — Scoring**: either
- (a) shell out to `python3 src/evaluation/evaluate_qa.py gpt-4o results.jsonl data/longmemeval_oracle.json` from WOTANN, OR
- (b) port `evaluate_qa.py` to TypeScript — it's ~130 LOC of GPT-4o judge prompts. Port would let WOTANN's `wotann memory eval longmemeval --judge=gpt-4o` be self-contained.

Option (b) is preferred for `wotann` brand cleanliness. Option (a) is faster to ship.

**Step 9 — Reporting**: after evaluation, emit a markdown summary:
```
## LongMemEval Results — 2026-04-DD

Dataset: longmemeval_s (500 questions)
Reader: claude-sonnet-4.6
Memory: WOTANN (commit <sha>)

| Ability | Score | N |
|---|---|---|
| single-session-user | 0.94 | 100 |
| single-session-assistant | 0.88 | 100 |
| single-session-preference | 0.72 | 80 |
| knowledge-update | 0.81 | 80 |
| temporal-reasoning | 0.76 | 80 |
| multi-session | 0.68 | 60 |
| abstention | 0.67 | 30 |
| **OVERALL** | **0.798** | 500 |
```

### Total effort

~610 LOC across 7 files, plus optional port of `evaluate_qa.py` (~150 LOC). **Single-engineer-day estimate: 1-1.5 days** if WOTANN's existing memory modules compose cleanly (they should; the primitives are all there).

**Blocker check**: `store.ts` at 1994 LOC likely owns the SQLite schema. Need to confirm that spinning up a fresh per-question in-memory graph doesn't require persisting to disk. If it does, add an `in_memory: true` path — another ~50 LOC.

### First baseline expected

With WOTANN's current memory primitives and no additional ports:
- Naive retrieval (flat BM25 from `hybrid-retrieval.ts` lexical retriever): **~62-70%** overall (similar to the paper's `flat-bm25` baseline)
- With graph-rag dual retrieval: **~68-74%**
- With relationship-types classifier populated + temporal filtering: **~72-78%**

**Realistic target after 2 weeks of porting (items 1-6 from priority list): 80-84%.**

**Stretch target after 4 weeks (items 1-10): 86-90%.**

**Ceiling**: ~92-94% without a full three-phase EverMemOS rewrite or observational-memory's stable-context trick. Hitting MemPalace's 96.6% raw score requires training/tuning on the dataset and is a benchmark-gaming exercise of limited value.

---

## 5. Audit Gaps Found in WOTANN Memory Modules

Discovered while reviewing for this audit — separate from port list:

1. **`qmd-integration.ts` misnamed** — see §2.11. Either integrate tobi/qmd for real or rename to something honest.
2. **`HeuristicClassifier` + `LlmClassifier` in `relationship-types.ts` have zero production callers** — library ships correct, but no pipeline writes `updates/extends/derives` edges. Grep confirms: only `relationship-types.test.ts` and `tests/` mention them.
3. **`TemporalMemory.eventFrequency()` in `temporal-memory.ts` not wired to retrieval.** Exists in `temporal-memory.ts` but retrieval paths (`hybrid-retrieval.ts`, `graph-rag.ts`, `semantic-search.ts`) don't call it.
4. **`memory-benchmark.ts` (530 LOC) predates LongMemEval** — it benchmarks write/read latency, not QA accuracy. Rename to `memory-latency-benchmark.ts` and add `longmemeval-accuracy-benchmark.ts` (the runner).
5. **`memvid-backend.ts` (393 LOC)** — suspicious. No callers in `src/` except its own test. Candidate for Tier 2 dead-code removal if still orphaned.
6. **`store.ts` at 1994 LOC** breaks the CLAUDE.md 800-max rule. Needs extraction into `store-sqlite.ts` / `store-fts.ts` / `store-graph.ts`.
7. **`graph-rag.ts` entity extraction is pure regex** — misses TS generics, arrow functions in object literals, computed property names. `claude-context`'s AST splitter fixes this.
8. **No abstention primitive** — `contradiction-detector.ts` does conflict detection, but LongMemEval abstention is "I don't have this info," not "two facts disagree." New module needed: `abstention-policy.ts` with threshold-based "low-confidence → abstain" logic.

---

## Sources

- [LongMemEval (xiaowu0162)](https://github.com/xiaowu0162/LongMemEval) — ICLR 2025 benchmark, 500 questions, 5 abilities
- [LongMemEval paper (arXiv 2410.10813)](https://arxiv.org/pdf/2410.10813.pdf)
- [EverMemOS (EverMind-AI)](https://github.com/EverMind-AI/EverMemOS) — three-phase, 83% LongMemEval, 93.05% LoCoMo
- [EverMemOS paper (arXiv 2601.02163)](https://arxiv.org/abs/2601.02163)
- [Agent Memory Fragmentation Solved: EverMemOS — LabNotes](https://labnotes.tech/blog/agent-memory-fragmentation-solved-evermemos-achieves-93-on-locomo)
- [Observational Memory (Mastra)](https://mastra.ai/research/observational-memory) — 94.87% with GPT-5-mini
- [Supermemory Research](https://supermemory.ai/research/) — 5-layer, 81.6% LongMemEval
- [Letta (MemGPT)](https://docs.letta.com/concepts/memgpt/) — core + archival two-tier
- [Zep: A Temporal Knowledge Graph Architecture for Agent Memory (arXiv 2501.13956)](https://arxiv.org/abs/2501.13956)
- [Graphiti (getzep)](https://github.com/getzep/graphiti) — open-source Zep core
- [Mem0 docs](https://docs.mem0.ai/cookbooks/essentials/choosing-memory-architecture-vector-vs-graph)
- [Mem0 architecture breakdown — Dwarves Memo](https://memo.d.foundation/breakdown/mem0)
- [MemPalace benchmark fact-check — MemPalace.tech](https://www.mempalace.tech/benchmarks)
- [MemPalace analysis (lhl/agentic-memory)](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md)
- [QMD (tobi/qmd)](https://github.com/tobi/qmd) — BM25 + vector + Qwen3-Reranker local search
- [QMD Overview — DeepWiki](https://deepwiki.com/tobi/qmd/7.1-overview)
- [Cognee (topoteretes)](https://github.com/topoteretes/cognee) — ECL pipeline, 14 search types
- [Cognee research paper (arXiv 2505.24478)](https://arxiv.org/abs/2505.24478)
- [claude-context (zilliztech)](https://github.com/zilliztech/claude-context) — AST + Merkle DAG + hybrid Milvus
- [context-mode (mksglu)](https://github.com/mksglu/context-mode) — MCP session-continuity + FTS5 RRF
- [OMEGA leaderboard](https://omegamax.co/benchmarks) — live LongMemEval comparison
- [Backboard LongMemEval results](https://github.com/Backboard-io/Backboard-longmemEval-results)
