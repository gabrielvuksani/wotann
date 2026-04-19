# WOTANN Phase 1 Progress — 2026-04-18 (post-compaction session)

**Author**: resumed Claude Code session after /compact. **Scope**: V4 plan Phase 0 (HEAD verification) + Phase 1 (11 verified bug fixes) + Phase 2 (duplicate consolidation).

---

## Status Summary

| Phase | V4 estimate | Actual | Status |
|-------|-------------|--------|--------|
| 0. HEAD verification sweep | 1 day | in-session | ✅ done |
| 1. Fix 11 verified bugs | 3-5 days | 8 of 11 done in-session + 3 dispatched | 🟡 in progress |
| 2. Consolidate duplicates | 2 days | 3 items resolved in-session | 🟡 partial |
| 3. Wire learning-stack chain | 3 days | **already wired per HEAD read** — STALE in handoff | ✅ done |

---

## Phase 0 — HEAD Verification Results

All 11 bugs from MASTER_SYNTHESIS §2 were grep-verified against tip of `main` (59 commits past session 5). Result: **11 of 11 still open at HEAD**. No stale claims in the synthesis's bug table.

### Priority-A false alarm (post-handoff correction)

The handoff's Task A ("Fix active-memory.ts:141 field-name cast — 5 min") is NOT a distinct bug:

- `src/memory/active-memory.ts:141` is a plain `.filter()` predicate with proper null guards.
- The synthesis's §3 clarification is correct: the "active-memory field bug" label was shorthand for bug #1 (AutoresearchEngine no-op generator). No separate fix is required at that line.
- Priority-A therefore dedups into Priority-B (AutoresearchEngine wiring), which IS a real bug and was fixed this session.

### Priority-C obsolete (per Wave-4 correction)

The handoff's Task C ("Wire conversation→observation→memory persistence chain — 3h") is **already wired at HEAD**:

- `src/core/runtime.ts` ~line 4280 extracts observations from session captures
- Observations are promoted to `memory_entries` under block types (decisions/feedback/project/issues/cases)
- `runDreamConsolidation()` at line 4418 invokes `runDreamPipelineWithPersistence`
- InstinctSystem decay + persist run
- SkillForge analyzes session trace at line 4352

The handoff's "12 files in src/learning/ produce ZERO output" is **stale** — session-10 or later completed the wiring. Verification via direct source read shows full conversation → observation → dream → instinct → skill chain operational.

This is the 6th Wave-4 correction of the prior-audit claims (alongside: 8-file bootstrap IS wired, memoryMiddleware IS consumed, KnowledgeGraph IS persisted, decisionLedger IS dual-persisted, Karpathy preamble IS injected, Bedrock/Vertex auth IS real).

---

## Phase 1 — Bug Fixes

### Closed in-session (8 of 11)

| # | File:Line | Fix | Verified |
|---|-----------|-----|----------|
| 1 | `src/core/runtime.ts:934` → `:1157` | Swapped `async () => null` for real LLM generator via new `createLlmModificationGenerator()` in `src/training/llm-modification-generator.ts` (~230 LOC). Added public `setModificationGenerator()` setter to AutoresearchEngine. Wired at end of `initialize()`. | `npm run typecheck` exit 0 |
| 4 | `src/providers/openai-compat-adapter.ts` | Added `appendPath()` helper that preserves `?query` and `#hash` across path concatenation. Replaced `${baseUrl}/chat/completions` and `${baseUrl}/models`. Fixes Azure whose baseUrl ends with `?api-version=…`. | typecheck pass |
| 5 | `src/providers/ollama-adapter.ts:331-342` | Added `hadToolCalls` flag. Emit `stopReason:"tool_calls"` in done chunk when tool-uses were yielded. | typecheck pass |
| 6 | `src/providers/copilot-adapter.ts:346-355` | Replaced false-honest "Retrying…" stub with actual `forceRefresh` token + single-retry fetch. | typecheck pass |
| 7 | `src/providers/copilot-adapter.ts:88-90` | Replaced module-global `cachedCopilotToken`/`cachedModelList` with per-adapter `CopilotCache` closure. Threaded through `getCopilotToken(ghToken, cache, opts)` and `fetchCopilotModels(auth, cache)`. | typecheck pass |
| 8 | `src/providers/gemini-native-adapter.ts:162-174` | Added `ALLOWED_INLINE_MIME_TYPES` whitelist (images/pdf/audio/video). Reject unlisted MIMEs by falling back to `text` part. | typecheck pass |
| 9 | `src/providers/tool-parsers/parsers.ts:35-53` | Rewrote `tolerantJSONParse` to split on pre-existing double-quoted spans, only transform outside-string segments. Preserves apostrophes inside legitimate strings. Also reordered fallbacks — strip trailing commas first (lossless) before quote conversion (lossy). | typecheck pass |
| 11 | `tests/integration/fallback-e2e.test.ts:76-96` | Replaced tautological `expect(userRequestedModel).toBe("claude-opus-4-6")` self-equality with real invariants: fallback resolves to `openai`, anthropic still present in chain, chain has no duplicates, chain = providers set. | awaiting test run |

### Dispatched to parallel Opus agents (3 of 11)

| # | File | Agent ID | Expected | ETA |
|---|------|----------|----------|-----|
| 2 | `src/providers/bedrock-signer.ts` | running | toolConfig body + binary-event decoder w/ toolUse accumulator | 1-2h |
| 3 | `src/providers/vertex-oauth.ts` | running | full Anthropic messages body + full stream event parser | 1-2h |
| 10 | `src/browser/camoufox-backend.ts` | running | persistent Python subprocess w/ JSON-RPC stdin/stdout | 2-3h |

### "Bug #11 Test Tautologies 40+" claim — partially false

Audit claimed "40+ tautological `.toBeTruthy()`" in `tests/mobile/ios-app.test.ts`. Direct grep finds:
- 10 `.toBeTruthy()` in `tests/mobile/ios-app.test.ts`
- 258 across the whole tests/ tree

Nearly all are **weak but not tautological** — they validate values *generated by the handler* (UUIDs, timestamps, tokens), not values the test itself constructed. The original audit conflated "weak" with "tautological."

The genuine self-equality in `fallback-e2e.test.ts:95` has been fixed (see bug #11 row). Mass tightening of the 258 weak assertions is deferred to a dedicated quality-pass session — not a production blocker.

---

## Phase 2 — Consolidation

### Closed this session

1. **Duplicate `memory_search_in_domain` tool definition** — was defined twice in `src/memory/memory-tools.ts` (lines 201-229 AND 271-298). Removed the second copy.
2. **`turboquant.ts` rename** — already done in session 10. File is `src/context/ollama-kv-compression.ts`. No action required.
3. **Azure URL path/query bug** — fixed as bug #4 above via `appendPath()` helper.

### Still open

1. **`persona.ts loadBootstrapFiles / buildIdentityPrompt`** — parallel implementation of `prompt/engine.ts:assembleSystemPromptParts`. Has zero non-barrel consumers (only `src/lib.ts:109-110` re-exports). Per Gabriel's "zero deletions" mandate, consolidate by having engine.ts delegate to `loadBootstrapFiles` OR add deprecation comment + keep. Deferred to Phase 14.

---

## Type-Check State

`npm run typecheck` exits 0 after every Phase 1 fix. No new compile errors introduced. Each fix independently verified via tsc before moving to the next.

---

## Next Session Priorities

1. Merge the 3 in-flight Opus agents' bug fixes (Bedrock #2 + Vertex #3 + Camoufox #10) — expected completion within this session's active budget.
2. After all 11 bugs closed: begin Phase 4 (benchmark harness) — V4 plan's critical path next step. Target Top-3 on TerminalBench + SWE-bench Verified + Aider Polyglot at `WOTANN-Free` and `WOTANN-Sonnet` tiers.
3. Update `docs/AUTONOMOUS_EXECUTION_PLAN_V4_2026-04-18.md` with Wave-4 corrections: Priority A false-alarm dedup, Priority C already-wired, 258 weak-assertion reclassification. Subsume into a V5 plan when Phase 4 starts.
4. Phase 14 (zero-deletion audit of 13 DEAD modules) — wire `completion-oracle.ts`, `pr-artifacts.ts`, `perception-adapter.ts`, `self-crystallization.ts`, `required-reading.ts`, `visual-diff-theater.ts`, `route-policies.ts`, `auto-detect.ts`, `terminal-mention.ts`, `meet/*` trilogy, `getMeetingStore` callback. Aggregate ~3,600 LOC recoverable in 30-45h.

---

## Memory Anchor

Engram topic_key: `wotann/execution/phase-1-bug-fixes` (saved this session).

All fixes committable to a single "fix: Phase 1 Tier 0 provider + autoresearch + consolidation" commit, or split per-bug for cleaner git blame.
