# Phase 6 Memory → LongMemEval SOTA — Progress

**Target scope**: ~15 days. Shipped 2 highest-ROI modules this session.

## Shipped

| Item | Status | Commit |
|---|---|---|
| Contextual embeddings (Anthropic 2024 paper) | ✅ | `81c7a48` |
| Typed relationships (updates/extends/derives) | ✅ | next |

## Remaining

| Item | Est | Notes |
|---|---|---|
| Dual-layer timestamps (documentDate + eventDate) | 1d | Extend `temporal-memory.ts:TemporalEntry` — it currently has ONE timestamp. Breaking change; requires migration. |
| MemPalace wing/room/hall hierarchy | 2d | Already partially present (`store.ts` has `domain/topic`). Needs formal 3-level hierarchy. |
| Cognee 14 search types | 3d | Existing `semantic-search.ts` supports 4 types. Port remaining 10 (insight-from-chunks, entity-relationship, temporal-filtered, etc). |
| Tree-sitter AST chunking via WASM | 2d | Prereq: `web-tree-sitter` dep + grammar bundles. Replace line-based chunker in `conversation-miner.ts`. |
| sqlite-vec virtual tables | 2d | `better-sqlite3` is in deps; need `sqlite-vec` extension. 10-100× faster KNN than current cosine. |
| Typed EntityType schemas (Zod + LLM structured output) | 1d | `observation-extractor.ts` currently emits free-text; move to typed emission. |
| Incremental index by file-SHA | 1d | Currently re-indexes every file on every start. Add sha-map cache. |

## Quality bar check

- **Immutable patterns**: both modules return new objects; no `push`+mutate.
- **Many small files**: contextual-embeddings.ts 215 LOC, relationship-types.ts 280 LOC — both under 400 target.
- **TDD**: 19 tests for contextual-embeddings, 23 for relationship-types — red-before-green.
- **No module-global state**: classifiers are factory-created; resolveLatest is pure.
- **LLM fallback always available**: both modules ship heuristic AND LLM-backed paths.

## Integration notes

**Contextual embeddings** is not yet wired into the conversation-miner or vector-store. Wiring: in `conversation-miner.ts:chunkAndStore()`, pass each chunk through `buildContextualChunk(chunk, docContent, generator)` before the vector embed. Generator comes from `runtime.query()`. Deferred to avoid breaking the miner's existing contract.

**Relationship types** has no storage wrapper yet. Wiring: `graph-rag.ts:addEdge()` should accept a `MemoryRelationshipKind` param and persist it. Alternatively, new `typed-graph-rag.ts` module. Deferred for follow-up.

## Ship target

Full Phase 6 parity ships in v0.5.0. Current v0.4.0 release carries contextual embeddings + typed relationships as checked boxes.
