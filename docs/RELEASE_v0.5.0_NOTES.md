# WOTANN v0.5.0 — Release Notes

**Version**: `0.5.0-rc.1`
**Release candidate date**: 2026-04-21
**Previous release**: `v0.4.0` (2026-04-20)
**Sprint window**: 2026-04-20 02:10 UTC-4 → 2026-04-21 12:26 UTC-4

---

## Summary

v0.5.0 is the **Moat-Builder** release. Its job is to close the ship-blocker
gaps found in MASTER_PLAN_V8's 6-lane audit, then port the highest-ROI
competitor techniques so WOTANN's memory, session, and provider stacks match
or beat Mastra / Cursor 3 / OMEGA / Zep / Cognee / Hermes Agent / OpenHands on
their respective frontiers.

**Numbers** (all git/test-runner verified, not aspirational):

| Metric | v0.4.0 | v0.5.0-rc.1 | Delta |
|---|---|---|---|
| Commits on `main` | baseline | **89** this sprint | +89 |
| Passing tests | 5860 | **7367** (+1 flake-prone LSP test, sometimes 7366) | +1507 |
| Test files | ~364 | **466** | +102 |
| Skipped tests | 7 | 7 | 0 |
| Source LOC delta | — | **+34,450 / -1,611** (125 files) | net +32,839 |
| Test LOC delta | — | **+27,619 / -343** (110 files) | net +27,276 |
| Docs LOC delta | — | **+12,377** (25 files) | net +12,377 |
| Retrieval surfaces | 2 | **26** | +24 |
| Cross-surface session features | 0 shipped | **12 of 15** landed (F1–F3, F5–F9, F12–F15) | F4, F10–F11 pending |
| `tsc --noEmit` | ✅ 0 | ✅ 0 | — |

Retrieval surfaces math (verified against `src/memory/`):
- v0.4.0: `store.search()` (FTS5 BM25) + `store.hybridRetrieve()` = 2 entry points
- v0.5.0: 2 base + 10 `SearchMode`s in `extended-search-types.ts`
  (insight-synthesis, entity-relationship, temporal-filtered, document-scope,
  cross-document, code-aware, summary-only, metadata-only, graph-hop,
  hybrid-fusion) + 12 retrieval modes in `src/memory/retrieval-modes/`
  (graph-traversal, temporal-window, typed-entity, fuzzy-match,
  semantic-cluster, path-based, time-decay, authority-weight, summary-first,
  ingest-time-travel, fact-time-travel, cross-session-bridge) + 2 baseline
  semantic modes = 26.

---

## What's new by category

### Security (6 commits — ship-blocker closes)

All TIER-0 / P0 security items from MASTER_PLAN_V8 §3–§4 are closed.

- **`security(deps)` `2a40240`** — replace `magika` + drop `@xenova/transformers`
  with `magic-bytes.js`. Drops `onnxruntime-web` 1.17 CVE surface and the 200 MB
  WASM blob tree. `onnxruntime-node` remains as an optional dep, used only by
  the OMEGA/Mastra memory path.
- **`security(ssrf)` `849c51e`** — port stricter private-host rules from
  `ssrf-guard 2.ts` into the canonical `guardedFetch`. Blocks RFC 1918 +
  link-local + metadata endpoints by default.
- **`security(connectors)` `4e8ad73` + `01207ee`** — wire `guardedFetch` into
  6 connector surfaces (previously unguarded).
- **`security(tauri)` `dd4b576`** — enable Tauri 2 capability sandbox;
  apply ad-hoc signing to Sequoia-compliant bundle shape; harden
  `validate_command` / `validate_path` in Rust.
- **`security(command-sanitizer)` `ac8eac7`** — replace naive substring match
  with `shell-quote` AST parse. Closes two known sanitizer bypasses.

**Still pending** (do not block v0.5.0 code, but block public announcement):
- Supabase key rotation (user action — ref `docs/internal/SECURITY_SUPABASE_TRIPLE_CHECK_2026-04-20.md`)
- `git filter-repo` pass to purge key from v0.1.0 and v0.4.0 tag blobs

### Memory (18 feat + 3 fix commits — LongMemEval SOTA candidate)

Memory is the single largest investment of the sprint. From 2 retrieval
surfaces in v0.4.0 to 26 in v0.5.0-rc.1.

**Cognee parity (P1-M6)** — 12 new single-mode retrievers exposed via
`RetrievalRegistry`, dispatched by `store.searchWithMode()`:
- graph-traversal, temporal-window, typed-entity, fuzzy-match (`182be5e`)
- semantic-cluster, path-based, time-decay, authority-weight (`b7d005c`)
- summary-first, ingest-time-travel, fact-time-travel, cross-session-bridge (`32ddc49`)
- `RetrievalRegistry` + dispatcher (`4fe48bc`)

**Mastra Observer / Reflector (P1-M1)** — async per-turn fact extraction +
LLM-judge promotion of captured memories (`c5c5632`, `37c6b30`).

**OMEGA 3-layer architecture (P1-M2)** — port of `omegamax.co` 3-layer SQLite
memory; includes ONNX cross-encoder (MiniLM-L-6-v2) with heuristic fallback
and sqlite-vec backend for vector search (`317d88a`, `dacbfb5`, `f5faa5f`).

**Mem0 v3 single-pass ADD-only (P1-M3)** — `5460013`.

**Zep / Graphiti bi-temporal edges (P1-M5)** — `3458bda`.

**TEMPR 4-channel parallel retrieval (P1-M4)** — port of Hindsight's TEMPR,
with RRF + cross-encoder rerank building blocks (`0dcee03`, `3796a5e`).

**LongMemEval corpus loader + benchmark integration** — `06eedff`.

**Memory orphan wiring** — `acff037`, `faecf78`, `37d49f1` wired
11+ pre-existing memory modules (semantic-cache, memory-benchmark, memory-tools,
hybrid-retrieval, memvid-backend, entity-types, relationship-types, mem-palace,
contextual-embeddings, incremental-indexer) into `MemoryStore` and CLI surfaces.

**Memory promotion fixes**:
- `bdb420a` — active-memory recall reads `.entry.value` (was `.content`),
  unblocking `memory_entries` population in fresh sessions.
- `0a875ec` — `confidence_level` column consistency with insert path.
- `cf7ae7a` — auto_capture → memory_entries chain fix.

**Agent-facts scoping (`df299f5`)** — retrieval takes `agent_id` filter for
multi-agent isolation.

### Session — cross-surface synergy (10 feat commits — 12 of 15 F-features)

Cross-surface session stack is the v0.5.0 moat. Phone ↔ Desktop ↔ Watch ↔
CarPlay ↔ Fleet now runs through a single RPC family with typed subscriptions.

- **`a400c2f feat(rpc)`** — `computer.session` RPC family (F1 keystone —
  cross-surface entry point).
- **`045c059 feat(session)`** — `stream.cursor` events with 30 fps coalescing (F2).
- **`4497502 feat(session)`** — Live Activity `computer.step` handler (F3).
- **`4fb7b39 feat(session)`** — creations file pipeline + iOS sync events (F5).
- **`2321f64 feat(session)`** — approval subscription channel with typed queue (F6).
- **`ac0cae2 feat(session)`** — `file.get` RPC with range-request support (F7).
- **`f0591ff feat(daemon)`** — `RpcSubscriptionManager` shared scaffolding (F8).
- **`13f0734 feat(session)`** — file delivery pipeline (F9).
- **`b3c2199 feat(session)`** — Apple Watch task-dispatch primitive (F12).
- **`8017753 feat(session)`** — CarPlay voice task-dispatch primitive (F13).
- **`149a9e3 feat(session)`** — cross-session resume via handoff (F14).
- **`b0cb76f` + `e2ec6a8`** — multi-agent fleet view + `fleet.list` /
  `fleet.watch` / `fleet.summary` RPC endpoints (F15 — Cursor 3 Agents Window
  parity).

**Not shipped in v0.5.0-rc.1**: F4, F10, F11. See `LAUNCH_READINESS_v0.5.0.md`
for plan.

### Providers (5 feat + 1 test + 1 fix — native tools across the matrix)

- **`329e8f0`** — unified tool serializer (Hermes `convert_tools` pattern).
- **`8e27e99`** — native tools rollout for Bedrock / Vertex / Ollama / Gemini
  via the tool-serializer extension point.
- **`ffa9761`** — regression-lock wire-level tools for Bedrock / Vertex / Ollama.
- **`21f0f1b`** — `CredentialPool` with rotation + exhaustion semantics (P1-C1).
- **`e7477e5`** — peer-tool auth sidecar (refresh + region affinity).
- **`2c8f4c2`** — ForgeCode schema discipline: required before properties, flat
  schema, `additionalProperties: false`.
- **`863171d`** — harden Bedrock / Vertex / Azure / Ollama stream parsers
  (P0-4 closes).

### Orchestration (7 feat + 2 refactor)

- **`8f467d0`** — `PhasedExecutor` base class (P2).
- **`03aa4a6`** — migrate Coordinator to `PhasedExecutor`.
- **`1239d74`** — migrate `AutonomousExecutor` to `PhasedExecutor`.
- **`f7dcdb1`** — critic-model rerank over N rollouts (OpenHands port).
- **`b7a1abd`** — `todo.md` goal-drift protocol (OpenHands port).
- **Jean 4-registry (P1-C9)**: command `6404dac`, process `ae15661`,
  event `f72741f`, result `8073e81`. Full Jean-parity 4-registry orchestrator.

### CLI (5 commits — new slash commands + commands)

- **`c48c0ec`** — `/worktree` slash command + `WorktreeManager` (Cursor 3 P1-C6).
- **`07ac6d0`** — `/best-of-n` slash command (leverages P1-B10 CriticRerank).
- **`0a92fc2`** — `wotann design extract` command (P1-C8 wiring).
- **`1a4538e`** — `wotann design mode` command (P1-C7 4/4).
- **`6118120`** — `wotann acp register` command (P1-C10).

### Design (4 feat — Cursor 3 Design Mode + Claude Design port)

- **`ad29e34`** — Canvas data model + store (P1-C7 part 1/4).
- **`0d28b5c`** — DesignMode orchestrator with op-based edits (P1-C7 part 2/4).
- **`60b23dc`** — canvas-to-code exporter (P1-C7 part 3/4).
- **`1a4538e`** — `wotann design mode` CLI (P1-C7 part 4/4, see CLI section).
- **`c1782ba`** — codebase → design-system extractor (Claude Design port, P1-C8).

### Intelligence (3 feat — verification + reasoning budgets)

- **`744f684`** — ForgeCode 4-perspective pre-completion verification.
- **`1180e2c`** — progressive reasoning budget for verify loops.
- **`74d5fa6`** — reasoning sandwich (high-low-high) budget scheduler.
- **`c7d46d0`** — KG-first-stage builder (Blitzy port, P1-C3).

### Prompt (3 feat — KV-cache stability + stable prefix)

- **`bd188da`** — stable-prefix emission for provider prompt caching.
- **`0050321`** — KV-cache-stable timestamps (date-only granularity in the
  stable prefix so identical prompts hit cache across same-day sessions).
- **`74d5fa6`** — reasoning sandwich budget scheduler (see Intelligence).

### Tools (3 feat — shell exec safety + grep parallelism + edit proliferation)

- **`1f877bf`** — marker-based polling + double-confirmation for shell exec.
- **`8f050a3`** — parallel grep subagent (Morph WarpGrep v2 port).
- **`1e49aaf`** — Hashline Edits parser + applier (`oh-my-pi` port, P1-UI8).

### UI (TUI + palette purge)

- **`035e89f`** — TUI command palette (⌘P) with fuzzy search.
- **`411b02e`** — purple purge + 5-palette consolidation (P1-UI signature).

### Channels (2 feat — UnifiedDispatchPlane fan-out)

- **`072b336`** — multi-surface event fan-out via `UnifiedDispatchPlane`.
- **`b0f5438`** — route session events through `UnifiedDispatchPlane`.

### Daemon / Scheduler / Core (3 feat — foundations)

- **`a070f03`** — Hermes-style cron scheduler with at-most-once semantics (P1-C2).
- **`861c419`** — environment bootstrap snapshot (Droid / Meta-Harness port).
- **`f0591ff`** — `RpcSubscriptionManager` (see Session F8).

### Middleware (1 feat — loop detection)

- **`e58f473`** — loop detection (Crush `loop_detection.go` port).

### Exploit (1 feat — Claude Mythos scaffold)

- **`90206e9`** — 4-step exploit scaffold (Claude Mythos port, P1-C5).

### Wiring (3 feat — orphan modules → runtime)

- **`5758a26`** — wire 6 orphans into runtime (P1-O).
- **`27016fc`** — wire `workflow-runner` + `budget-enforcer` + `raven-state` (P1-O).
- **`2b5c93d`** — wire tools + task-tool into public API (P1-O).

### CI / Docs

- **`a4837de`** — re-enable test gate with `continue-on-error` (visibility, not gate).
- **`e237959`** — 24 audit + research + errata docs for Phase-1 execution.
- **`c98f1c2`** — P0-6 listener-leak claim marked STALE; no action needed.

---

## Breaking changes

**None** in v0.5.0-rc.1. All additions are behind feature flags or new APIs;
no pre-existing import paths or RPC signatures were removed or renamed.

Two notes for integrators:

1. **`MemoryStore.search()` is unchanged** — the new retrieval surfaces
   are opt-in via `store.searchWithMode(mode, query, opts)`. Callers using
   `store.search()` or `store.hybridRetrieve()` see identical behaviour.

2. **Tool serializer is provider-internal** — the unified serializer lives
   behind the provider adapter interface. Downstream callers that pass
   `TOOL_DEFINITIONS` to the runtime do not need to change anything.

---

## Upgrade instructions

### From v0.4.0 → v0.5.0-rc.1

```bash
# npm / yarn
npm install wotann@0.5.0-rc.1

# or from the GitHub Release tarball
curl -L https://github.com/gabrielvuksani/wotann/releases/download/v0.5.0-rc.1/wotann-0.5.0-rc.1-$(uname -s | tr A-Z a-z)-$(uname -m).tar.gz -o wotann.tar.gz
tar xzf wotann.tar.gz

# Verify installation
wotann --version   # should print 0.5.0-rc.1
```

### SEA / desktop

The 8-asset canonical release set is unchanged (see `.github/workflows/release.yml`):

- `wotann-0.5.0-rc.1-macos-arm64.dmg` + `.sha256`
- `wotann-0.5.0-rc.1-macos-arm64.tar.gz` + `.sha256`
- `wotann-0.5.0-rc.1-linux-x64.tar.gz` + `.sha256`
- `wotann-0.5.0-rc.1-windows-x64.exe` + `.sha256`

### Config migration

No config changes. Existing `wotann.yaml` files from v0.4.0 load without
modification.

### Memory DB migration

The OMEGA / bi-temporal / typed-entity additions introduce new tables.
Migrations run automatically on first daemon start. Back up `.wotann/memory.db`
before first v0.5.0 launch (`cp ~/.wotann/memory.db ~/.wotann/memory.db.v0.4.0`).

---

## Known issues

1. **LSP references test (flaky)** — `tests/unit/lsp-symbol-operations.test.ts`
   has one test (`finds references across files`) that times out at 10 s under
   heavy-load test runs. Test-only flake; shipped behaviour unaffected. Will
   be raised to 30 s or moved to `tests/integration/` in v0.5.0 final.
2. **Supabase key rotation pending** — see Security section. User action
   required before public announcement.
3. **F4, F10, F11 cross-surface session features** — not shipped in rc.1.
   See `LAUNCH_READINESS_v0.5.0.md` for the gating criteria and plan.
4. **3 docs/AUTONOMOUS_EXECUTION_PLAN_V*.md historical artifacts** — these
   are internal planning drafts superseded by `MASTER_PLAN_V8.md`. Kept for
   the audit trail; not part of the public doc set.

---

## Acknowledgements

- Competitor research ports: oh-my-pi, Cursor 3, Mastra, OMEGA, Mem0, Zep /
  Graphiti, Cognee, Hindsight, Hermes Agent, OpenHands, Jean, ForgeCode,
  Claude Mythos, Blitzy, Droid / Meta-Harness, Morph WarpGrep, Crush.
- All 7 parallel Opus audit agents whose findings closed 29 gaps across the
  Lane 1-5 audit matrix.
- Sprint operated under MASTER_PLAN_V8 §9.2 Phase 1–3 dispatch rules.

---

*v0.5.0-rc.1 is a release candidate. Gate to v0.5.0 final is in
`docs/LAUNCH_READINESS_v0.5.0.md`.*
