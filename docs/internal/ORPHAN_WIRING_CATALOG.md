# Orphan Wiring Catalog — Gold Mines (not trash)

**Date**: 2026-04-20
**Source**: `docs/WOTANN_ORPHANS.tsv` (89 orphans at 2026-04-19 HEAD `aaf7ec2`)
**Principle**: Per user's explicit direction — "Before you plan to delete anything, ensure that it wouldn't help in any way before removing it."

## Executive Summary

Of 89 orphan source files (21,453 LOC, 13.2% of source), **~60 are high-value modules that match WOTANN's competitor port list 1:1**. These should be **WIRED, not deleted**. Wiring them unlocks ~70% of the P1-C port roadmap with zero new code written.

## Top-Tier Wiring Candidates (match port list directly)

### Memory System (matches P1-C34 Cognee + LongMemEval targets)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/memory/contextual-embeddings.ts` | 212 | Y | `src/memory/store.ts` hybrid search | **+30-50% recall** per MASTER_PLAN_V6 |
| `src/memory/mem-palace.ts` | 267 | Y | `src/memory/store.ts` | MemPalace-style tiered memory |
| `src/memory/hybrid-retrieval.ts` | 255 | Y | `src/memory/store.ts` | 2 of Cognee's 14 retrieval modes |
| `src/memory/dual-timestamp.ts` | 296 | Y | memory insert path | Temporal reasoning for LongMemEval |
| `src/memory/incremental-indexer.ts` | 256 | Y | memory promotion | Fixes the "0 rows in memory_entries" bug |
| `src/memory/entity-types.ts` | 236 | Y | knowledge-graph.json population | Fixes 49-byte empty KG |
| `src/memory/relationship-types.ts` | 281 | Y | knowledge-graph relations | |
| `src/memory/semantic-cache.ts` | 195 | Y | retrieval cache | Cost reduction |
| `src/memory/memvid-backend.ts` | 393 | N | `wotann memory export` | Portable memory sharing |
| `src/memory/memory-benchmark.ts` | 530 | Y | benchmark runner | LongMemEval integration |
| `src/memory/memory-tools.ts` | 580 | N | agent tools | Agent memory ops |

**Wiring effort**: ~1 week total to chain all 11 through MemoryStore.

### Intelligence (matches P1-2 TerminalBench techniques + P1-C37 Guardrails)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/intelligence/strict-schema.ts` | 360 | Y | Tool schema linter | **ForgeCode #1 discipline** |
| `src/intelligence/chain-of-verification.ts` | 139 | Y | pre-completion checklist | CoV gate for 75%+ TB2 |
| `src/intelligence/confidence-calibrator.ts` | 220 | Y | response validator | Quality gating |
| `src/intelligence/tool-pattern-detector.ts` | 161 | Y | middleware pipeline | Loop detection |
| `src/intelligence/multi-patch-voter.ts` | 222 | Y | critic rerank | **Critic-model +5.8pp (OpenHands)** |
| `src/intelligence/adversarial-test-generator.ts` | 338 | Y | test generator | Test quality |
| `src/intelligence/answer-normalizer.ts` | 269 | Y | response cleanup | GAIA -3-5% gap closer |
| `src/intelligence/budget-enforcer.ts` | 191 | Y | cost tracker | Real budget enforcement |
| `src/intelligence/policy-injector.ts` | 248 | Y | τ-bench policy | τ-bench readiness |
| `src/intelligence/search-providers.ts` | 257 | Y | web search routing | Deep research |

**Wiring effort**: ~1.5 weeks. Single highest value: `strict-schema.ts` (ForgeCode lifter).

### Providers (matches P1-C1 CredentialPool + P1-C5 Prompt Caching)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/providers/prompt-cache-warmup.ts` | 315 | Y | anthropic-adapter | **75-90% cost savings (Hermes pattern)** |
| `src/providers/harness-profiles.ts` | 242 | N | `wotann profile` CLI | Named presets (fast-cheap/max-quality/offline) |
| `src/providers/circuit-breaker.ts` | 186 | Y | provider-service | Fault tolerance |
| `src/providers/budget-downgrader.ts` | 162 | Y | provider-service | Cost-aware degradation |
| `src/providers/retry-strategies.ts` | 227 | Y | provider-service | Smart retry |
| `src/providers/usage-intelligence.ts` | 174 | N | telemetry | Usage analytics |

**Wiring effort**: ~1 week. Single highest value: `prompt-cache-warmup.ts` (direct cost savings).

### Orchestration (matches P1-C7 Agents Window + P1-C8 CIV triad)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/orchestration/parallel-coordinator.ts` | 148 | Y | autonomous | **Multi-agent triad foundation** |
| `src/orchestration/speculative-execution.ts` | 137 | Y | autonomous | Speculation for TB2 |
| `src/orchestration/code-mode.ts` | 281 | Y | mode-cycler | Code-specific mode |

### Learning (matches P1-C40 DSPy+GEPA audit)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/learning/darwinian-evolver.ts` | 197 | Y | dream pipeline | Evolutionary optimization |
| `src/learning/miprov2-optimizer.ts` | 183 | Y | skill-forge | MIPROv2 prompt optim |
| `src/learning/reflection-buffer.ts` | 200 | Y | dream pipeline | Reflection loop |

### Autopilot (matches P1-C15 Checkpoints)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/autopilot/checkpoint.ts` | 290 | Y | runtime | **Opcode-style checkpoints** |
| `src/autopilot/trajectory-recorder.ts` | 270 | Y | autonomous | Replay + training |

### LSP (matches P1-C16 full surface)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/lsp/lsp-tools.ts` | 333 | Y | runtime-tools | LSP agent tool layer |

### Sandbox (matches P1-C19 6 Terminal Backends)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/sandbox/extended-backends.ts` | 237 | Y | sandbox executor | Docker + SSH backends |
| `src/sandbox/approval-rules.ts` | 228 | Y | sandbox | Fine-grained approval |
| `src/sandbox/output-isolator.ts` | 284 | Y | executor | Output security |
| `src/sandbox/unified-exec.ts` | 318 | Y | execution interface | Unified exec layer |

### Workflows (matches P1-C29 Conductor DO_WHILE)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/workflows/workflow-runner.ts` | 447 | Y | orchestration | **JSON workflow execution (Conductor pattern)** |

### Skills (matches P1-C20 SKILL.md frontmatter)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/skills/skill-compositor.ts` | 192 | Y | skill registry | Skill composition |
| `src/skills/skill-optimizer.ts` | 198 | Y | skill registry | Skill optimization |

### Meeting (unique WOTANN feature)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/meet/meeting-runtime.ts` | 222 | Y | daemon | Meeting recording |

### Connectors (CRITICAL — 5 orphans with SSRF vuln)

| Orphan | LOC | Tests | Wire target | Unlocks |
|---|---|---|---|---|
| `src/connectors/confluence.ts` | 158 | N | connector-registry | Confluence integration |
| `src/connectors/google-drive.ts` | 278 | N | connector-registry | GDrive integration |
| `src/connectors/jira.ts` | 291 | N | connector-registry | Jira integration |
| `src/connectors/linear.ts` | 342 | N | connector-registry | Linear integration |
| `src/connectors/notion.ts` | 323 | N | connector-registry | Notion integration |

**IMPORTANT**: All 5 are both ORPHAN (unwired) AND have raw `fetch()` SSRF vulnerabilities. Don't wire until guardedFetch is applied (P0-4).

### CLI (mixed — some dead, some useful)

| Orphan | LOC | Tests | Verdict |
|---|---|---|---|
| `src/cli/debug-share.ts` | 321 | N | **WIRE** — bug-report UX valuable |
| `src/cli/onboarding.ts` | 185 | N | **WIRE or consolidate** — 7-step wizard vs `ProjectOnboarder` |
| `src/cli/history-picker.ts` | 215 | N | **DELETE** — UI has React equivalent |
| `src/cli/incognito.ts` | 131 | N | **DELETE** — App.tsx has inline incognito |
| `src/cli/pipeline-mode.ts` | 165 | N | **DELETE** — index.ts has inline `--pipe` |
| `src/cli/test-provider.ts` | 104 | N | Keep — dev-only npm script |

### Core (mixed — experiments + load-bearing refactors)

| Orphan | LOC | Tests | Verdict |
|---|---|---|---|
| `src/core/runtime-tool-dispatch.ts` | 454 | N | **VERIFY** — may actually be wired via different name |
| `src/core/runtime-tools.ts` | 257 | N | **VERIFY** — same |
| `src/core/agent-profiles.ts` | 147 | N | Experiment — park or wire |
| `src/core/claude-sdk-bridge.ts` | 178 | N | Experiment — park |
| `src/core/content-cid.ts` | 165 | N | **WIRE** — CID for content addressing |
| `src/core/deep-link.ts` | 273 | N | **WIRE** — `wotann://` URL scheme handler |
| `src/core/prompt-override.ts` | 230 | N | Experiment — park |
| `src/core/schema-migration.ts` | 346 | N | **WIRE** — database migrations |
| `src/core/wotann-yml.ts` | 330 | N | **WIRE** — YAML config parser |

### UI (verify wiring claims)

| Orphan | LOC | Tests | Verdict |
|---|---|---|---|
| `src/ui/themes.ts` | 234 | N | **VERIFY** — per Lane 3, has purple hex; IS used via lib.ts |
| `src/ui/context-references.ts` | 660 | N | **WIRE** — @-file references (large, valuable) |
| `src/ui/context-meter.ts` | 159 | Y | **WIRE** — context usage meter |
| `src/ui/helpers.ts` | 141 | N | **VERIFY** — 7 imports_out but 0 in? lib.ts re-export |
| `src/ui/keybindings.ts` | 79 | N | **WIRE** — keybindings infrastructure |
| `src/ui/raven/raven-state.ts` | 229 | N | **WIRE** — Raven's Flight animation state |
| `src/ui/voice-controller.ts` | 101 | N | **WIRE** — voice UI control |

### Other

| Orphan | LOC | Tests | Verdict |
|---|---|---|---|
| `src/tools/monitor.ts` | 240 | N | **WIRE** — bg process monitor |
| `src/tools/pdf-processor.ts` | 269 | N | **WIRE** — PDF reading tool |
| `src/tools/post-callback.ts` | 192 | N | **WIRE** — webhook delivery |
| `src/tools/task-tool.ts` | 366 | Y | **WIRE** — task spawning |
| `src/tools/tool-timing.ts` | 126 | N | **WIRE** — timing telemetry |
| `src/telemetry/token-estimator.ts` | 158 | Y | **WIRE** — token estimation |
| `src/runtime-hooks/dead-code-hooks.ts` | 186 | Y | Verify — resurrection layer |
| `src/middleware/file-type-gate.ts` | 357 | Y | **VERIFY** — per pipeline.ts line 54, IS wired |
| `src/middleware/forced-verification.ts` | 209 | N | Consolidate or delete |
| `src/prompt/template-compiler.ts` | 276 | Y | **WIRE** — template compilation |
| `src/prompt/think-in-code.ts` | 177 | Y | **VERIFY** — per runtime.ts:1743 IS wired via env |
| `src/desktop/desktop-store.ts` | 214 | N | **DELETE** — duplicate of desktop-app Zustand |
| `src/channels/terminal-mention.ts` | 116 | Y | **WIRE** — @mention routing |
| `src/daemon/auto-update.ts` | 193 | N | **WIRE** — registry auto-update |
| `src/acp/thread-handlers.ts` | 138 | Y | **WIRE** — ACP threads |
| `src/context/importance-compactor.ts` | 182 | Y | **WIRE** — context compaction |

### Definitely DELETE (truly dead)

| Orphan | LOC | Reason |
|---|---|---|
| `src/utils/logger.ts` | 98 | 0 callers, telemetry/audit-trail.ts is the real one |
| `src/utils/platform.ts` | 83 | computer-use/platform-bindings.ts is the real one |
| `src/cli/history-picker.ts` | 215 | ui/components/HistoryPicker.tsx is real |
| `src/cli/incognito.ts` | 131 | App.tsx has inline incognito |
| `src/cli/pipeline-mode.ts` | 165 | index.ts has inline --pipe |
| `src/desktop/desktop-store.ts` | 214 | desktop-app/src/store/ is real |

**Delete subtotal**: 906 LOC (6 files) genuinely dead.

## Summary Math

- **Total orphans**: 89 files, 21,453 LOC
- **Wire candidates**: ~60 files, ~15,000 LOC — unlock ~70% of P1-C roadmap
- **Verify first**: ~10 files — may actually be wired via dynamic import
- **Delete outright**: 6 files, 906 LOC
- **Remaining**: ~13 experiments / parked ideas — keep in tree for future

## Action for Master Plan

Add to P1 Wiring Batch (alongside P1-1..P1-10):
- **P1-W1**: Wire 11 memory orphans → P1-1 (memory runtime fix)
- **P1-W2**: Wire 10 intelligence orphans → P1-2 (TerminalBench techniques)
- **P1-W3**: Wire 6 provider orphans → P1-C1/C5 (credential pool + prompt caching)
- **P1-W4**: Wire 3 orchestration orphans → P1-C7/C8 (Agents Window + CIV triad)
- **P1-W5**: Wire 3 learning orphans → P1-C40 (DSPy + GEPA)
- **P1-W6**: Wire 2 autopilot orphans → P1-C15 (checkpoints)
- **P1-W7**: Wire 4 sandbox orphans → P1-C19 (6 Terminal Backends)
- **P1-W8**: Wire 1 workflow orphan → P1-C29 (Conductor DO_WHILE)
- **P1-W9**: Wire skill-compositor + skill-optimizer → P1-C20 (SKILL frontmatter)
- **P1-W10**: Wire 7 UI orphans → cross-surface synergy
- **P1-W11**: Wire tools/monitor, pdf-processor, post-callback, task-tool, tool-timing → agent tool surface
- **P1-W12**: Wire deep-link, schema-migration, wotann-yml, content-cid → platform maturity
- **P1-D1**: Delete 6 truly-dead modules (906 LOC)

**Total wiring effort**: ~6-8 weeks sequential. Parallel agents: ~2 weeks.

**Net result**: 15,000 LOC of currently-unused code becomes active; 70% of port roadmap delivered by wiring, not writing.

---

*Per user directive 2026-04-20: delete only after confirming zero value. This catalog operationalizes that principle.*
