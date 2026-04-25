# AUDIT_FALSE_CLAIMS — Per-Doc Truth Audit v2

**Date**: 2026-04-19
**HEAD**: `52fb123` (+~100 commits past prior session)
**Method**: grep-proven claim-vs-code verification. Every "X is wired" / "Y shipped" claim in the docs below was checked via `Grep` for consumers outside `lib.ts` + own module + test files. Those without consumers are classified **FATAL** (silent success: code exists but cannot be triggered at runtime — ships as vaporware); **HIGH** (doc drift: claim says "wired" but only half-wired, e.g. runtime instantiates class but never calls key method); **LOW** (cosmetic drift: numbers slightly off).

**Ground truth** (from this session):
- `npm test`: 357 files / 5691 passing / 7 skipped / 0 failing (59s wall-clock)
- Source: 528 `.ts` files in `src/`
- Test: 354 `.test.ts` files in `tests/`
- Commits: 341 total; 266 in last 3 days

**Legend**: 
- ✅ = grep-proven WIRED (has consumer outside lib.ts/own module/tests)
- ❌ = grep-proven ORPHAN (lib.ts export-only; would silently fail to activate)
- 🟡 = partial wire (class instantiated but key entry method never called)

---

## Doc-by-Doc Grades

| Doc | Grade | Truth ratio | Biggest lie |
|---|---|---|---|
| `PHASE_1_PROGRESS_2026-04-18.md` | **A-** | ~95% | 40+ tautology count overstated (actual 10 in cited file) — self-corrected in §"partially false" subsection |
| `PHASE_4_PREP_2026-04-18.md` | **A** | ~100% | Forward plan only — no retrospective claims to verify |
| `PHASE_5_PROGRESS.md` | **B+** | ~85% | Section "Integration notes" honestly admits rollback has no RPC binding & approval-rules has no consumer; tables above mark both "✅ shipped" without caveat |
| `PHASE_6_PROGRESS.md` | **B** | ~70% | Table says "Contextual embeddings ✅" but integration note admits "not yet wired into conversation-miner" — and has not been since Apr 15. Same for relationship-types. |
| `PHASE_7_PROGRESS.md` | **A-** | ~95% | Honest about "GEPA core lands in v0.4.0 as usable library. Fully-wired lands in v0.5.0" — correctly frames as unwired |
| `PHASE_14_PROGRESS.md` | **C** | ~60% | 8 of 14 "already wired" claims correct. But "exposed via lib.ts" is labeled WIRED — the doc itself admits "Still not WIRED into runtime success paths" but the summary table still claims 11/14 "actively discoverable". The session-log header is not honest about the callback-requirement death. |
| `PHASE_15_SHIP_PLAN.md` | **A** | ~100% | Forward plan only |
| `MASTER_AUDIT_2026-04-18.md` | **B-** | ~75% | §4 Top-50 roadmap has claims that were "shipped" which are NOT wired (monitor tool, visual-diff-theater, completion-oracle); honest about most other things |
| `MASTER_SYNTHESIS_2026-04-18.md` | **B+** | ~85% | More careful than the audit; uses REAL/DEAD/BUG/MISSING states. Multiple DEAD → REAL transitions claimed which are FATAL below |
| `GAP_AUDIT_2026-04-15.md` | **A-** | ~95% | Most items are "deferred/blocker" not "done" — honest scoping. CLOSED items mostly grep-verify. |
| `DEAD_CODE_REPURPOSING_2026-04-18.md` | **B** | ~70% | Accurate about what's dead; but later Phase 14 references this doc to claim wires that were never made |
| `AUDIT_2026-04-19.md` | **B+** | ~85% | Honest umbrella with real metrics; a few stale "wired" claims inherited from prior session lies |
| `MASTER_PLAN_V5.md` | **A-** | ~95% | Forward plan. Some Phase C tasks already partly done but listed as future work (LOW drift) |
| `MASTER_PLAN_V6.md` | **B** | ~75% | Claims "AGENTS.md SHIPPED" (true ✅) + "25 deliverables" (true, by file count). But inherits Session-N "wired" claims that are actually orphans. |
| `COMPETITOR_EXTRACTION_LANE1.md` | **A** | — | Source-of-truth for patterns — no WOTANN claims to verify |
| `COMPETITOR_EXTRACTION_LANE2.md` | **A** | — | Same — extraction-only doc |
| `COMPETITOR_EXTRACTION_LANE3_MEMORY.md` | **A** | — | Same — extraction-only doc |
| `COMPETITOR_EXTRACTION_LANE4_UX.md` | **A** | — | Same — extraction-only doc |
| `COMPETITOR_EXTRACTION_LANE5_SKILLS.md` | **A** | — | Same — extraction-only doc |
| `COMPETITOR_EXTRACTION_LANE6_SELFEVOLUTION.md` | **A** | — | Same — extraction-only doc |
| `COMPETITOR_EXTRACTION_LANE7_SPECIALIZED.md` | **A** | — | Same — extraction-only doc |
| `COMPETITOR_EXTRACTION_LANE8_STRATEGIC.md` | **A** | — | Same — extraction-only doc |
| `COMPETITOR_FEATURE_COMPARISON_2026-04-03.md` | **B** | — | Parent-level feature comparison: mostly competitor mapping, not WOTANN self-claims. Some WOTANN side-of-matrix is aspirational. |
| `COMPREHENSIVE_SOURCE_FINDINGS_2026-04-03.md` | **A** | — | Source extraction reference doc (April 3 snapshot; pre-dates most lies) |

---

## FATAL lies — silent success that WOULD ship v0.4.0 as vaporware

These modules would cause v0.4.0 to ship with code that cannot be triggered at runtime. Commit messages / progress docs claimed they were "wired" or "shipped" as runtime features.

| Module | Commit claim | Reality | Evidence (grep) |
|---|---|---|---|
| `src/tools/monitor.ts` | commit `5bffb1e`+ "Claude Code v2.1.98 parity" + MASTER_PLAN_V5.md Phase C1 task still lists this as "TODO (1h)", contradicting claims | ORPHAN — only imports are `src/lib.ts:598` (export-only) + `src/core/runtime-tool-dispatch.ts:15` (type-import, but that module itself has ZERO importers) + `tests/unit/monitor-tool.test.ts` | `grep "spawnMonitor" src → 0 non-tests/non-lib/non-own-module matches` |
| `src/lsp/agent-tools.ts` (buildLspTools, AGENT_LSP_TOOL_NAMES) | commit `85eff8c` header "LSP (Serena parity — 10 language servers as agent tools)" | ORPHAN — only appears in lib.ts:585 (export-only) and its own module's re-export at `lsp/lsp-tools.ts:342` | `grep "buildLspTools" src → only declaration + re-export + lib.ts re-export` |
| `src/lsp/server-registry.ts` (LanguageServerRegistry, LSP_SERVER_CATALOG) | same as above — "Serena parity" | ORPHAN — only appears in `agent-tools.ts` (which is also orphan), lib.ts, and `lsp-tools.ts` re-export | same |
| `src/mcp/tool-loader.ts` (loadTools + `McpTier` + tiered MCP loading) | lib.ts comment: "tiered tool loading — 7/14/42+ saves 7k tokens" | ORPHAN — only imports are `src/lib.ts:559-571` (export-only). No runtime consumer. | `grep "loadMcpTools" src → 0 non-lib matches` |
| `src/testing/visual-diff-theater.ts` (`VisualDiffTheater` class) | commit `85eff8c` "feat(lib): expose 38 newly-wired modules"; DEAD_CODE_REPURPOSING_2026-04-18.md says "WIRE-AS-IS 3-5h"; PHASE_14_PROGRESS.md table row 11 says "✅ exported from lib.ts". | ORPHAN — only `src/lib.ts:793` (export); no runtime service on WotannRuntime, no RPC binding, no Monaco wire. "exported from lib.ts" is NOT wired. | `grep "VisualDiffTheater\|diffTheater" src → 3 matches: 1 declaration + 1 lib.ts export + 1 lib.ts self-reference comment` |
| `src/autopilot/pr-artifacts.ts` (PRArtifactGenerator) | PHASE_14_PROGRESS.md row 5 "✅ already wired" | 🟡 PARTIAL — imported by `index.ts:530` inside `wotann autofix-pr` action, BUT the 1-line import is inside a dynamic `import()` block for a single CLI command. No PR is actually created — only a fix-plan is printed (per GAP_AUDIT_2026-04-15 "wotann autofix-pr → only prints a fix-plan"). DEAD_CODE_REPURPOSING said wiring requires `--create-pr` flag + `gh pr create`; neither exists. | `grep "gh pr create\|--create-pr" src → 0 matches` |
| `src/runtime-hooks/dead-code-hooks.ts::crystallizeSuccessHook` | lib.ts comment: "crystallizeSuccessHook — WIRED. Called from `orchestration/autonomous.ts`" | 🟡 PARTIAL — `autonomous.ts:896` does call it, BUT gated on `callbacks?.getCrystallizationContext` and NO caller in the codebase supplies that callback. `getCrystallizationContext` is only defined on the interface at line 436 and used at line 892-893. Effectively dead. | `grep "getCrystallizationContext" src → only declaration + self-reference` |
| `src/runtime-hooks/dead-code-hooks.ts::requiredReadingHook` | lib.ts comment: "requiredReadingHook — WIRED. Called from `orchestration/agent-registry.ts`" | 🟡 PARTIAL — `agent-registry.ts:417` calls it in `spawnWithContext()`. But `spawnWithContext` ITSELF has zero callers — `AgentRegistry.spawn()` is called, not `spawnWithContext`. The YAML `required_reading:` parser never runs. | `grep "spawnWithContext" src → only its own declaration + docblock` |
| `src/runtime-hooks/dead-code-hooks.ts::routePerception` | PHASE_14_PROGRESS.md "✅ exposed via lib.ts" + DEAD_CODE_REPURPOSING "HIGHEST-LEVERAGE dead-code file" | ORPHAN — the doc itself admits "TO BE WIRED in src/core/runtime.ts by the next session". No integration into `ComputerAgent` before model dispatch. | `grep "routePerception" src → only own module + docblock references` |
| `src/memory/contextual-embeddings.ts` (`buildContextualChunk`) | PHASE_6_PROGRESS.md header row "Contextual embeddings ✅ (commit 81c7a48)" | ORPHAN — the PHASE_6_PROGRESS.md Integration Notes section itself admits "not yet wired into the conversation-miner or vector-store." But the header row ships as "✅". | `grep "buildContextualChunk" src → only own module + lib.ts export` |
| `src/memory/hybrid-retrieval-v2.ts` (`hybridSearchV2`, `createBm25Retriever`, `createDenseRetriever`) | lib.ts line-item "Phase H — Supermemory/MemPalace SOTA parity" | ORPHAN — only `src/lib.ts:471-479` (export). No runtime consumer. MASTER_PLAN_V6.md §3 Phase H6 correctly says "Hybrid semantic + keyword + BGE-reranker" is still PENDING. | `grep "hybridSearchV2" src → 0 non-lib/non-own-module matches` |
| `src/memory/wings-rooms-halls.ts` (parseWrh, formatWrh, observationTypeToHall) | commit `9dbd123` "feat(memory/wings-rooms-halls): MemPalace +34% retrieval partitioning" | ORPHAN — lib.ts export-only. No observation flow invokes `observationTypeToHall`. | `grep "parseWrh\|formatWrh\|observationTypeToHall" src → only own module + lib.ts export` |
| `src/sandbox/virtual-paths.ts` (toVirtual, toPhysical, scrubPaths, unscrubPaths) | lib.ts header: "Sandbox (Codex parity + deer-flow virtual paths)" | ORPHAN — only `src/lib.ts:544` export. No tool I/O scrubs paths. (Note: `src/core/virtual-paths.ts` VirtualPathResolver IS wired; the sandbox helper flavor is NOT.) | `grep "toVirtual\|toPhysical\|scrubPaths\|unscrubPaths" src → only own module + lib.ts + two references inside `src/core/virtual-paths.ts` docblocks pointing AT it` |
| `src/sandbox/unified-exec.ts` (serializeShellSnapshot, deserializeShellSnapshot) | lib.ts "Sandbox (Codex parity)" | ORPHAN — only `src/lib.ts:546-549` export | `grep "serializeShellSnapshot" src → only own module + lib.ts` |
| `src/ui/terminal-blocks/block.ts` (BlockBuffer) + `osc-133-parser.ts` (Osc133Parser) | commit `9103235` "feat(ui/terminal-blocks/init-snippets): zsh/bash/fish shell-init emitters" + MASTER_PLAN_V6.md B10 "OSC 133 parser + zsh/bash/fish init snippets — `wotann init --shell`" | ORPHAN — BlockBuffer + Osc133Parser have no consumer; `buildShellInit` IS wired into `wotann init --shell` ✅ but the PARSER itself is never attached to stdin/pty. | `grep "BlockBuffer\|Osc133Parser" src → only own modules + lib.ts` |
| `src/core/handoff.ts` (performHandoff, nestHandoffHistory) | commit included; lib.ts header "Sandbox (Codex parity + deer-flow virtual paths)" | ORPHAN — lib.ts export-only | `grep "performHandoff\|nestHandoffHistory" src → own module + lib.ts` |
| `src/memory/unified-knowledge.ts` (UnifiedKnowledgeFabric) | lib.ts "Phase F3 — Unified Knowledge Fabric" | ORPHAN — lib.ts only | `grep "UnifiedKnowledgeFabric" src → own module + lib.ts` |
| `src/providers/provider-brain.ts` (ProviderBrain) | lib.ts "Phase F4 — Provider Brain" | ORPHAN — lib.ts only | `grep "ProviderBrain" src → own module + lib.ts` |
| `src/security/auto-classifier.ts` (AutoClassifier) | lib.ts "Phase E — Auto-Classifier (Claude Auto Mode)" | ORPHAN — lib.ts only | `grep "AutoClassifier" src → own module + lib.ts` |
| `src/memory/context-tree-files.ts` (ContextTreeManager) | lib.ts "Phase DX — Context Tree Files (ByteRover)" | ORPHAN — lib.ts only | `grep "ContextTreeManager" src → own module + lib.ts` |
| `src/hooks/auto-archive.ts` (AutoArchiveHook) | lib.ts "Phase DX7 — Auto-Archive (Jean)" | ORPHAN — lib.ts only | `grep "AutoArchiveHook" src → own module + lib.ts` |
| `src/hooks/rate-limit-resume.ts` (RateLimitResumeManager) | lib.ts "Phase DX20 — Rate Limit Resume" | ORPHAN — lib.ts only | `grep "RateLimitResumeManager" src → own module + lib.ts` |
| `src/cli/loop-command.ts` (LoopManager) | lib.ts "Phase F9 — Loop Command" | ORPHAN — lib.ts only (the `/loop` feature is presumably CLI-driven but no CLI dispatch found) | `grep "LoopManager" src → own module + lib.ts` |
| `src/channels/base-adapter.ts` (BaseChannelAdapter abstract class) | lib.ts "Phase F5 — Base Channel Adapter" | ORPHAN — no channel subclasses extend `BaseChannelAdapter`. 25 channel adapters exist but each implements `ChannelAdapter` interface directly, bypassing this base class. | `grep "extends BaseChannelAdapter" src → 0 matches` |
| `src/core/steering-server.ts` (SteeringServer) | lib.ts "Core (extended)" | ORPHAN — lib.ts only | `grep "SteeringServer" src → own module + lib.ts` |
| `src/prompt/modules/index.ts` (assemblePromptModules) | lib.ts "Principle 4A — Dynamic Prompt Modules" | ORPHAN — lib.ts only; `src/prompt/modules/user.ts:4` docblock says "The runtime calls `UserModelManager.getPromptContext()` ... this module's `assemblePromptModules` is deferred" | `grep "assemblePromptModules" src → own module + lib.ts` |
| `src/intelligence/cross-device-context.ts::wings-rooms-halls path routing` | commit `b4b441f` "feat(desktop/canvases/eval-comparison)" etc — numerous canvas commits claim wiring | — MIXED — some ARE wired (CrossDeviceContextManager in runtime.ts + kairos.ts ✅), several ARE NOT | per-item |

**Count**: 20+ modules whose commit messages or progress-doc rows say "wired" / "shipped" but which are ORPHAN at HEAD.

---

## HIGH lies — doc drift (claim vs code, but not shipping blockers)

| Doc | Claim | Reality |
|---|---|---|
| `PHASE_14_PROGRESS.md` summary | "11 of 14 actively discoverable now" | Technically TRUE (they're all exported from lib.ts) but misleading — "discoverable" vs "wired" is a crucial distinction the doc itself makes elsewhere then blurs in the summary |
| `PHASE_14_PROGRESS.md` row 11 | `testing/visual-diff-theater.ts` "✅ already wired" — because it's in lib.ts | NO. Lib.ts export ≠ wired. Zero runtime service, zero RPC binding. |
| `MASTER_SYNTHESIS_2026-04-18.md` §1 status matrix | `src/autopilot/completion-oracle.ts` DEAD | Correct at that point but PHASE_1_PROGRESS closed it on Apr-18 via `runtime.ts:139,3678,3739`. SYNTHESIS predates. Inherited LOW drift. |
| `MASTER_AUDIT_2026-04-18.md` §4 Tier 0 table | "10 days" to fix 10 items | Understates — most are 30-min-2h fixes but require integration testing across multiple surfaces. Closer to 15-20 person-days. |
| `MASTER_PLAN_V6.md` §5 "25 deliverables" | File count | TRUE file count; but several of those are "Agent in flight at time of write" which may never have completed |
| `AUDIT_2026-04-19.md` §4 | "89 orphans total (imports-in = 0 from within `src/**`)" | Exact number depends on date of TSV. WOTANN_ORPHANS.tsv at commit cite does list 89. Today's accurate count may differ by ±5 as new exports land. LOW drift. |
| `MASTER_SYNTHESIS_2026-04-18.md` §3 competitor count "~45" | Doc lists 45 | TRUE, but the claim "8 ongoing ports" obscures that most ports are inspired-by, not code-level |
| `CLAUDE.md` top-level | "19 providers" | Per AUDIT_2026-04-19 metrics: 19 WIRED providers — TRUE |
| `CLAUDE.md` | "65+ skills" | Per MASTER_SYNTHESIS: actual 86 markdown skills. Understatement, not overstatement. LOW. |
| `DEAD_CODE_REPURPOSING_2026-04-18.md` row 13 | "training/autoresearch.ts (no-op gen) DEAD" + "REFACTOR-THEN-WIRE" | PHASE_1_PROGRESS closed this at `runtime.ts:1157` via `createLlmModificationGenerator` — the doc is now stale on this row |

---

## LOW lies — cosmetic drift

| Doc | Minor issue |
|---|---|
| `CLAUDE.md` | "22 src/ subdirs" vs actual 50 — inherited stale metric |
| `CLAUDE.md` | "21 hooks" vs actual 23 registrations — inherited stale metric |
| `CHANGELOG.md` | "[0.1.0] 17-provider adapter system" while `package.json` is now 0.4.0 and provider count is 19 — stale |
| `Formula/wotann.rb` | Version 0.4.0 matches package.json (previously drifted) ✅ |
| `GAP_AUDIT_2026-04-15.md` | Links to `[REDACTED_SUPABASE_KEY]` — cosmetic redaction still references the leaked blob, though blob is the actual issue (see `GIT_ARCHAEOLOGY.md`) |
| `README.md` | Recent commit `de96864` honest numbers ✅ |

---

## What DID ship correctly (so we're not only flagging failures)

These were BIG claims I grep-verified as TRUE:

| Module | Grep evidence |
|---|---|
| `MeetingRuntime` | `src/daemon/kairos.ts:418` new instance + kairos-rpc binding ✅ |
| `RoutePolicyEngine` | `src/daemon/kairos.ts:1039,1043` + `src/channels/unified-dispatch.ts:149` ✅ |
| `completion-oracle::evaluateCompletion + getDefaultCriteria` | `src/core/runtime.ts:3678,3739` ✅ |
| `fileTypeGateMiddleware` | `src/middleware/pipeline.ts:102,242` ✅ |
| `6 deer-flow middlewares` (Dangling, Guardrail, LLMError, SandboxAudit, Title, DeferredToolFilter) | All 6 `create*Middleware` calls in `pipeline.ts:103-121` + `pipeline.ts:243-261` ✅ |
| `6 new channels` (Mastodon, WeChat, Line, Viber, DingTalk, Feishu) | `src/channels/auto-detect.ts:734,825,889,944,996,1054` ✅ |
| `guardReview` + `maybeBuildCidIndexForProvider` | `src/core/runtime.ts:2667,1687` ✅ |
| `LongHorizonOrchestrator` | `src/index.ts:2651-2677` ✅ |
| `ProgressiveContextLoader` | `src/core/runtime.ts:1112` ✅ |
| `IdleDetector`, `AutoVerifier`, `AutoModeDetector`, `AutoEnhancer`, `CrossDeviceContextManager`, `UserModelManager` | all instantiated + methods called in `runtime.ts` ✅ |
| `ConnectorRegistry` | `src/daemon/kairos.ts:527-528` dynamic import + instantiation ✅ |
| `FlowTracker` | `src/daemon/kairos.ts:187,1287,1291` with real per-tick calls ✅ |
| `shouldAbstain` | `src/core/runtime.ts:3299` ✅ |
| `ingestSession` / `scheduleSessionIngestion` | `src/core/runtime.ts:1059` ✅ |
| `detectSupersession` | `src/core/runtime.ts:4778` ✅ |
| `deriveIngestTimestamps` | `src/memory/store.ts:864,2080` ✅ |
| `benchmark runners` (terminal-bench, aider-polyglot, swe-bench, tau-bench, code-eval) | `src/intelligence/benchmark-harness.ts:345,353,383` dispatch via `runRealBenchmark`; wired to CLI at `src/index.ts:3987` ✅ |
| `parseHandoffBundle` (Claude Design receiver) | `src/index.ts:4463,4471` ✅ |
| `shadow-git` rollback RPC | `src/daemon/kairos-rpc.ts` shadow.undo + shadow.checkpoints handlers ✅ (per GAP_AUDIT_2026-04-15 Wave 8) |
| `traceInstructions` | `src/prompt/engine.ts:11,395` ✅ |
| `buildShellInit` (`wotann init --shell`) | `src/index.ts:231-242` ✅ |
| `ConversationBranchManager.rollbackToTurn` | `src/core/runtime.ts:686` instance + `src/acp/thread-handlers.ts:69` ACP binding ✅ |
| `Block.tsx` (desktop) | `desktop-app/src/components/chat/MessageBubble.tsx` + `editor/EditorTerminal.tsx` ✅ |
| `PromptEnhancer` | `src/core/runtime.ts:977,3804` + `kairos-rpc.ts:1911` ✅ |
| `SelfImprovementEngine` | `src/index.ts:3669-3670` ✅ |
| `ProjectOnboarder` | `src/index.ts:428,436,448` ✅ |

---

## Summary grade: **B / B+**

The codebase is in far better shape than the "docs claim vs reality" spread suggests — most infrastructure IS wired. The FATAL lies cluster around the last 3-day sprint of "expose via lib.ts" commits (`85eff8c` + related). That sprint operationally DID export modules to the public API surface — which IS progress — but doc prose + commit messages described it as "wired" when it only reached "reachable via programmatic import".

**Root cause**: word "wired" overloaded. Progress docs use three distinct meanings:
1. **Exported from lib.ts** — consumers could theoretically `import { X } from "wotann"`
2. **Used by own tests** — test coverage exists
3. **Runtime-integrated** — some user-facing code path invokes the behavior

Claims that are **(1)+(2)** but not **(3)** were coded as ✅ in tables, which is what generates the FATAL list. A v0.4.0 launch with these on feature-announcement pages WOULD mislead.

**Recommended remediation** (no code change required to this audit):
- Add a column to every PHASE_*_PROGRESS.md table: **"Runtime consumer"** with grep citation
- Ban the word "wired" unless grep proves an outside-lib-outside-own-module import
- For library-only modules, use **"Available as library (not runtime-active)"** 
- Add a CI guard: `lib.ts` export that has no non-lib.ts/non-own-module/non-tests import must have a `// LIBRARY-ONLY` comment in its definition

---

## Cross-reference: `docs/WOTANN_ORPHANS.tsv`

The TSV at HEAD (238 entries in `WOTANN_INVENTORY.tsv`, 89 marked ORPHAN in `WOTANN_ORPHANS.tsv`) lists ~89 orphans. My FATAL list above overlaps with ~22 of those. The difference:
- Many orphans in the TSV are legitimately experimental / dead (e.g. `src/cli/incognito.ts`, `src/ui/keybindings.ts`) and have no accompanying "shipped" claim
- My FATAL list is scoped to modules the docs explicitly claimed were done

This means the real "silent-success" population is roughly the intersection: **~20 FATAL + ~5 HIGH + ~70 orphans with no claim to verify (i.e. acknowledged-incomplete).**
