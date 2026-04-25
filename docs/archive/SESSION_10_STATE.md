# Session 10 State Snapshot (pre-compaction)

**Run**: WOTANN autonomous execution from the 8-Opus-agent adversarial
audit. Continue with Wave 5 + Wave 6 autonomously.

## Commits delivered (24 total against session start)

```
b49ce09 feat(runtime): Serena-style symbol tools — find/references/rename
bk7ldftqh feat(wave-4): content-CID + Blocks UI primitive
9fe4252 feat(desktop): Workshop+Exploit top-pill + ⌘3/⌘4
ef0ab14 feat(desktop): SealedScroll in TrustView + Well scrubber in EditorPanel
4d41702 docs(hooks): 10 dead-letter HookEvent variants → advisory
85015cf feat(prompt): wire instruction-provenance into engine
aae86b8 fix(wave-3): persistence-lie docstrings + CI lint
7848427 test(providers): wire-level tools tests every adapter family
25e4829 fix: purge vendor-biased hardcodes
1bbb47d feat(providers): real Bedrock SigV4 + Vertex OAuth2
6ca693d feat(wave-2): fallback 18 / AccountPool / memMw / Gemini translator
31521da fix(companion-server): wire TaskMonitorHandler.executeTask
8e3a3fe feat(wave-1): FocusView + CapabilityChips + 11 orphan views
f9647c9 feat(wave-1): SOUL + Council + Runering + Monaco + iOS + ghost-delete
4bb7341 docs(session-10): triple-check addendum + empirical iOS verify
b794933 docs(session-10): MASTER_PLAN
…
```

## Verified state at snapshot

- `npm run typecheck` clean (root + desktop)
- `npm test` — **252 files, 3,942 pass, 0 fail, 6 skipped** (up from
  3,922 at session start)
- `npm run lint` clean
- `vite build` green

## User directives (load-bearing)

1. **Full autonomy** — no permission prompts, no signing (no Apple
   Developer ID), decide tradeoffs myself
2. **DONT HARDCODE NOTHING** — no vendor-biased fallbacks, no
   fabricated model lists, no magic numbers. Verified clean across
   Bedrock / Vertex / MessageBubble / memoryMiddleware.
3. **Triple-check before execution** — every audit finding
   source-verified before fixing

## Still-open work (Wave 5/6, tier-ordered by leverage/LOC)

### Wave 5 — Moat deepening
- [ ] Wire Serena LSP tools into WotannRuntime's ToolDispatchDeps
  (last-mile step for the just-committed `find_symbol` /
  `find_references` / `rename_symbol` tools — wiring into
  runtime.ts/`buildToolDispatchDeps` so the model can actually call
  them)
- [ ] ACP host compliance — ~600 LOC stdio JSONRPC shim so WOTANN is
  hostable from Zed / Air / Kiro
- [ ] superpowers dispatcher master skill — ~350 LOC skill file
- [ ] agentskills.io compliance — ~350 LOC
- [ ] Monitor tool — ~150 LOC (may already exist as
  src/tools/monitor.ts per earlier grep)
- [ ] TTSR stream rules — ~250 LOC middleware
- [ ] MiniLM runtime wiring — already instantiated at runtime.ts:601
  when `WOTANN_ENABLE_ONNX_EMBEDDINGS=1`; need runtime `.addDocument`
  path audit (verified already at line 2627)
- [ ] Native Gemini per-query enablement for
  google_search / code_execution / url_context (already in adapter
  options; needs UnifiedQueryOptions passthrough)

### Wave 6 — Refactors + release
- [ ] Per-command Tauri capability allowlist (~200 LOC YAML +
  capabilities/)
- [ ] `runtime.ts` split 4,553 LOC → 4 files
- [ ] `kairos-rpc.ts` split 5,375 LOC → 5 domain files
- [ ] TUI `App.tsx` split 2,979 LOC → 4 files
- [ ] WOTANNIntents ECDH wiring (physical-device blocker)

## Key file:line hotspots for resumption

- `src/core/runtime-tool-dispatch.ts` — Serena dispatch functions added;
  `runtime.ts` needs to pass `{ lsp: this.lspManager }` into
  `ToolDispatchDeps` at the single call site that invokes
  `dispatchRuntimeTool`.
- `src/core/runtime.ts:116` — LSPManager already imported
- `src/core/runtime.ts:601` — QuantizedVectorStore already instantiated
- `src/core/runtime.ts:4224` — persistKnowledgeGraph() called
- `src/providers/bedrock-signer.ts` — real SigV4 signing, no hardcoded
  default model (audit-clean)
- `src/providers/vertex-oauth.ts` — real OAuth2 JWT exchange
- `src/providers/fallback-chain.ts:27-58` — 18-provider chain
- `desktop-app/src/components/wotann/Block.tsx` — Warp Blocks primitive
- `desktop-app/src/components/editor/EditorPanel.tsx` — Well mounted
- `desktop-app/src/components/trust/ProofBundleDetail.tsx` — SealedScroll
- `docs/MASTER_PLAN_SESSION_10.md` — full plan
- `docs/MASTER_PLAN_SESSION_10_ADDENDUM.md` — triple-check additions

## Next autonomous step after compaction

Finish the Serena wiring: one-edit change in `runtime.ts` to pass
`this.lspManager` into `ToolDispatchDeps` at the dispatchRuntimeTool
call site, so the model can actually invoke the three tools that
just got defined. Then continue to ACP host compliance.

## Engram save

Saved as topic_key `wotann/session-10`. After compaction, recall via
`mem_search("wotann session 10")` to reload context in O(seconds).
