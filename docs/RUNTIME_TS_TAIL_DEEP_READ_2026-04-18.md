# Runtime.ts Tail Deep Read (Lines 3700–4724)

**Date**: 2026-04-18
**File**: `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/core/runtime.ts`
**Range**: Lines 3700–4724 (1025 lines)
**Scope**: Class-tail accessors, active-integration wrappers, close() lifecycle, dream consolidation, helpers, `createRuntime`, trailing comment on deleted module.

Note: the requested tail begins inside the accessor block that precedes the "Phase 2: Competitive Parity Accessors" section. There is NO `query()` method in this range (it sits earlier in the file); the range covers everything from getAwaySummary forward through the module's final line. This report documents only what appears in the specified lines; references to `query()` tail appear because it is mentioned in cross-file consumers (`kairos-rpc.ts`), not in this range.

---

## 1. Symbol Inventory (by block)

### 1.1 Late accessors (3700 → 3755)
- `getAwaySummary()` — idle check passthrough to `idleDetector.checkIdle()`.
- Phase 2 accessors: `getTaskRouter`, `getParallelSearch`, `getConfirmAction`, `getAgentHierarchy`, `getAgentWorkspace`.
- Phase 3 accessors: `getContextFence`, `getRetrievalQuality`, `getContextLoader`, `getObservationExtractor`, `getTunnelDetector`, `getConversationMiner` (nullable — only non-null accessor in block).
- Phase 4 accessors: `getAdaptivePrompts`, `getNightlyConsolidator`, `getBenchmarkHarness`.

All are straight field returns with no side effects — pure getters.

### 1.2 Active-integration wrappers (3755 → 4046)
- `classifyAndRoute(prompt)` — previously hardcoded `["claude-sonnet-4-6"]` (documented inline). Now derives `available` from `infra.providers`, falls back to empty array so the router returns general-best (commented as a bias fix).
- `searchAll(query)` — delegates to `parallelSearch.search`, strips internal shape to `{results, durationMs}`.
- `checkActionApproval(toolName, args)` — `confirmAction.classify` + `isPreApproved` short-circuit. Returns `{requiresApproval, risk, category}`.
- `generateAdaptivePromptSection(modelId, basePrompt)` — direct passthrough.
- `getWakeUpPayload()` — returns `{content, tokens}` from `contextLoader.generateWakeUpPayload()`.
- `getAgentSpawnConfig(agentId, task)` — registry lookup; returns undefined if unregistered.
- `loadAgentOverrides(directory?)` — async dynamic import of `agent-registry.js`, reads YAML from `<workingDir>/.wotann/agents` by default. Reassigns `this.agentRegistryInstance`. Unknown agent IDs are silently skipped (documented behavior).
- `runWaveExecution(tasks, executor)` — builds waves via `buildWaves`, pre-registers every task in `taskDelegationManager` with fixed budget `{maxTimeMs: 300_000, maxCostUsd: 1.0}` and empty allow/forbid/mustPass lists. Inside `executeWaves`, each task is matched by description via `getByParent + find`; accept/markInProgress/complete are fired with a truncated 500-char output snapshot and all-zero metrics (`testsRun/testsPassed/costUsd/tokensUsed = 0`, empty `filesModified`, empty `knowledgeExtracted`, empty `errors`).
- `generatePlan(task, context?)` — returns `{prompt, parse}` where `parse` is exported `parsePlanResponse`. No persistence.
- `getMaximizerContextBudget(...)` — direct passthrough to `planContextBudget`.
- `replayContext(task, budget)` — direct passthrough.
- `optimizeToolSchema(schema)` — direct passthrough.
- `validateToolArgs(args, schema)` — direct passthrough.
- `runPromptRegressionTests(testCases?)` — factory-style; defaults to `getCoreTestSuite()`. Returns `{suite, runTest, buildReport}` — never actually runs the test cases; caller must iterate.
- `checkSourceRepos()` / `syncSourceRepos()` — both paths hardcoded to `.wotann/monitor-config.yaml`, `.wotann/research`, `.wotann/monitor-state.json`.
- `generateProofBundle(task, result)` — proxies into `writeAutonomousProofBundle` with current runtime status, context budget, and capability profile.

### 1.3 Orchestration wrappers (4048 → 4203)
- `runArena(prompt, providers)` — early returns `[]` when `!this.infra`. Builds local `executor` that calls `bridge.querySync` per provider and returns `{response, tokensUsed, durationMs, model}`. Contains a documented Session-5 fix: if `queryResult.durationMs <= 0`, falls back to `Date.now() - startTime` (the comment explicitly calls out that the prior code "assigned startTime but threw it away").
- `runCouncil(query, providers)` — early returns a sentinel CouncilResult with `synthesis: "[No providers available]"`, `chairmanModel: "none"`, all numeric fields zero when no infra. Builds `CouncilQueryExecutor` that threads `model` through to `bridge.querySync` (fix documented: prior code dropped the `model` arg so council members queried provider defaults). Feeds `{provider, model: "auto"}` pairs. Calls `councilLeaderboard.recordResult(result)` after. Same durationMs fallback logic as `runArena`.
- `getCouncilLeaderboard()` — accessor.
- `applyHashEdit(filePath, operation)` — direct passthrough.
- `getAmbientContext(currentFile?, completedTask?)` — direct passthrough to `compileAmbientContext` with workingDir.
- `runPreCommitAnalysis()` — returns null if `editTracker.getTotalEdits() === 0`. Fires the verification cascade via `void this.verificationCascade.run()` fire-and-forget; failure only captures a `verification_cascade_failed` event — no propagation. Returns `runPreCommitAnalysis(workingDir)`.
- `enhancePrompt(prompt)` — throws `"No providers configured. Run `wotann init` first."` when `!this.infra`. Uses hardcoded 4-sentence system prompt. Returns `{enhancedPrompt, model}` with `model ?? this.session.model` fallback.
- `runCouncilDeliberation(query, providerNames)` — duplicate of `runCouncil` but (a) throws instead of sentinel-returning when `!this.infra`, (b) derives `defaultModel` from `bridge.getAvailableProviders()` using a no-op ternary (`status.includes(provider) ? "auto" : "auto"` — always resolves to `"auto"` either way).

### 1.4 `close()` (4223 → 4399)
See detailed analysis in §2.

### 1.5 `runDreamConsolidation()` (4405 → 4589)
See §3.

### 1.6 Private helpers (4591 → 4696)
- `getHoursSinceLastDream(lastDreamPath)` — returns `999` sentinel when missing / parse fails.
- `buildFileInfoFromTree(directoryTree)` — parses a newline-delimited string. Skips lines ending `/` OR lines with no `.`. Extension→language map for 16 types (ts/tsx/js/jsx/py/rs/go/java/cs/rb/php/md/json/yaml/yml/toml/css/html/sql). All FileInfo records get `size: 0` and `lastModified: now` — flat defaults not real metadata.
- `captureLearningFeedback(message)` — early-returns on no memoryStore. Calls `classifyFeedback`. Skips if type is `"neutral"` or `confidence < 0.5`. Inserts into `memoryInsert("feedback", ...)` and `captureEvent`.
- `resolveSecurityResearchProvider()` — returns `undefined` when `!modeCycler.shouldClearSafetyFlags() || !infra`. Iterates a hardcoded provider preference order of 11 entries starting with `ollama`, `huggingface`, `free`.

### 1.7 Module tail (4704 → 4724)
- `createRuntime(workingDir?, initialMode?)` — async factory. `workingDir` defaults to `process.cwd()`. Calls `loadConfig`, constructs runtime, awaits `initialize()`. 
- Trailing comment (lines 4719–4724) documents Session-5's deletion of a drifted duplicate runtime module.

---

## 2. close() Lifecycle — Detailed Findings

`close()` is a single long synchronous method (~175 lines). Order of operations:

1. `formatSessionStats(session)` → `summary`.
2. Fire sync `Stop` hook. If `action === "block"`, logs to stderr but **intentionally continues**. Documented: "close() can't refuse (the user already decided to terminate), but the strict-profile CompletionVerifier's 'no evidence' block now surfaces visibly instead of being silently discarded as the Opus audit found." Warnings array also printed.
3. Fire sync `SessionEnd` hook — no result handling at all (return value discarded).
4. `clearReadTrackingForSession(session.id)` — frees per-session Map entries.
5. `sessionRecorder.stop()`, `crossSessionLearner.extractLearnings("success")`. If learnings non-empty, `memoryStore?.captureEvent("cross_session_learnings", ... .slice(0, 10))` — **only first 10 learnings ever persisted**, remainder silently dropped.
6. C7 Dream-pipeline seed (lines 4285–4340) — wrapped in one large `try {} catch {}` that silently swallows all errors. Filters `session.messages` for non-empty string content. Slices each to 4000 chars. Passes through `observationExtractor.extractFromCaptures`. Caps at `slice(0, 50)` observations — **observations #51+ are silently dropped**. Translates `ObservationType → MemoryBlockType` via nested ternary: decision→decisions, preference→feedback, milestone→project, problem→issues, otherwise→cases (note: "discovery" maps to the default "cases" — the JSDoc on line 592 claims that mapping, but other types like "gotcha" or any future addition would silently drop into "cases" too). **Silent-failure risk**: on any exception (schema mismatch, DB lock, overflow) the entire observation seed is lost with zero logging.
7. Plugin lifecycle `on_session_end` fired with `.catch(() => {})` — silent failures by design.
8. Skill candidate analysis: threshold `sessionActions.length > 5`. Captures `skill_candidates` event only if `candidatesCreated > 0 || candidatesPromotable > 0`.
9. `memoryStore?.captureEvent("session_end", ...)`, then `runPreCommitAnalysis()` (note: fires cascade AGAIN even if close() was reached without edits — returns null harmlessly but still walks editTracker).
10. `saveCurrentSession()`.
11. Builds SessionSnapshot v2 with **several hardcoded empty fields**: `activeTasks: []`, `trackedFiles: []`, `memoryContext: ""`, `doomLoopHistory: []`, `customData: {}`. These are declared but never populated from live state — **dead fields at snapshot-time that risk resume fidelity drift**. `conversation[].timestamp` uses `Date.now()` for every message, so message ordering is preserved but per-message timing is lost.
12. `sessionStore.save(snapshot)`.
13. `runDreamConsolidation()` — see §3.
14. `instinctSystem.applyDecay()` then `instinctSystem.persist()`.
15. `void persistKnowledgeGraph()` — fire-and-forget, documented as "can't await inside a sync close()". **Silent race**: memoryStore closes on next line; if the async persist resolves after memoryStore is closed and tries to touch it, no error handler exists.
16. `memoryStore?.close()`.
17. `runWorkspaceDreamIfDue(workingDir, {quiet: true})` — last call, no await, sync function.

**No `destroy()` method exists in this range.** `close()` is the sole shutdown path.

---

## 3. runDreamConsolidation() — Detailed Findings

Private method on runtime, ~180 lines. Fires from `close()`.

1. Reads `.wotann/last-dream.json`, computes `lastDreamHoursAgo` (sentinel `999` when missing/corrupt — see helper at line 4591).
2. Assembles gates with **hardcoded `idleMinutes: 30`** and comment "Assume idle since we are at session close" — **false claim**: the function is called unconditionally at session close regardless of actual idle time. If shouldDream() trusts that field, every close() qualifies as "idle".
3. `shouldDream(gates)` — early return; no logging of skip reason.
4. Maps `sessionTrace` into `observations` (successful, last 50, `input ?? type`) and `corrections` (failed, last 20, `{message: output!, context: type}`). The `output!` non-null assertion is **unchecked** — prior filter guarantees `output` exists, but type-narrowing depends on the `a.output` truthiness check, which allows empty strings through (`!` only suppresses compiler, not runtime).
5. Maps existing instincts to a Dream-pipeline shape. **Hardcoded `decayRate: 0.99`** for all instincts regardless of their actual internal decay setting.
6. `runDreamPipelineWithPersistence(observations, corrections, [], existingInstincts, wotannDir)` — note the **empty-array third argument** (positional). Without its signature in this range the semantic meaning isn't declared here, but it's a fixed empty at every call.
7. Phase-4 nightly consolidation: builds `consolidationInput` with **hardcoded magic numbers**:
   - `successRate: 0.85` on every observation — **false metric**; no actual success rate tracked.
   - `count: 1` on every error pattern — **false metric**; duplicates are not aggregated.
   - `successfulStrategies` reuses `observations` verbatim.
   - `userCorrections` uses `corrections` but with `reason: "session correction"` hardcoded — **generic placeholder, no actual reasoning captured**.
8. `nightlyConsolidator.consolidate(...)` inside a try/catch that silently swallows. Success path loops `consolidation.newRules` into `memoryStore?.memoryInsert("patterns", auto-rule-${Date.now()}, ...)`.
9. **SkillForge persistence is a stub** (lines 4522–4555): builds a markdown frontmatter skill file manually with `context: fork`, writes to `.wotann/skills/`. **Filename sanitization bug**: `${candidate.name}.md.toLowerCase().replace(/[^a-z0-9.-]/g, "-")` calls `toLowerCase` on the **concatenated full string including `.md`**, so Unicode / uppercase names collapse but the `.md` is technically also subject to the sanitization (safe since it's lowercase, but reveals intent drift). Wrapped in try/catch with `/* skill forge persistence is non-fatal */` — **silent failure**.
10. **Dead-call-site risk**: the inner SkillForge block constructs a `skillDef` object with `name/description/category/trigger/content` fields but **only writes `skillDef.content`** to disk. The `name/description/category/trigger` fields are never consumed — the object literal is effectively dead except for content.
11. LESSONS.md append block (lines 4566–4580): wrapped in try/catch with silent failure comment. Uses `appendFileSync` without locking. Concurrent session closes could interleave sections. Only writes if `lessonLines.length > 0`.
12. Writes `last-dream.json` with `dreamedAt: new Date().toISOString()` — overwritten on every qualifying close.

**No-op generator already found at line 934** (outside this range, but referenced in the task): `async () => null` passed to `AutoresearchEngine` constructor. The comment "Default no-op generator; callers provide real one via getAutoresearchEngine()" is a **false claim** — `getAutoresearchEngine()` at line 3605 returns the engine instance with the baked-in no-op generator; there is no setter to replace the generator at runtime. Callers receive the engine but cannot inject a real generator without surgery. This is the only way to reach the engine, so the no-op is always live.

---

## 4. RPC-Exposed Surface (verified via kairos-rpc.ts)

From 80+ call sites in `src/daemon/kairos-rpc.ts`, the RPC layer exposes (directly or through accessors whose objects it then calls) at least:
- `runtime.query(...)` — most-called; 11+ call sites (lines 736, 1064, 1917, 2198, 2233, 2721, 2916, 3040, 3893, 5056, 5356).
- `runtime.runCouncil(query, providerNames)` — line 3057.
- `runtime.classifyAndRoute(prompt)` — line 4621.
- `runtime.searchAll(query)` — line 4629.
- `runtime.checkActionApproval(tool, args)` — line 4639.
- `runtime.getConfirmAction().getPendingApprovals()` — line 4645.
- `runtime.getAgentHierarchy()` — line 4651.
- `runtime.getAgentWorkspace().getStats()` — line 4661.
- `runtime.getContextFence().getStats()` — line 4667.
- `runtime.getRetrievalQuality().computeMetrics()` — line 4673.
- `runtime.getConversationMiner()` — line 4681 (null-guarded on the RPC side).
- `runtime.getAdaptivePrompts()` — line 4691.
- `runtime.getBenchmarkHarness().getHistory/getBestScore` — lines 4704, 4712.
- `runtime.getWakeUpPayload()` — line 4718.
- `runtime.runPreCommitAnalysis()` — line 3481.
- `runtime.analyzeHealth()` — line 4464.
- `runtime.getDecisionLedger()` / `recordDecision(...)` — lines 4473, 4490.
- `runtime.getStatus/getCostTracker/getSession/getHybridSearch/getPromptEnhancerEngine/getTaskDelegationManager/getDispatchPlane/getSkillRegistry/setMode/getModeName/getPluginLifecycle/getMemoryStore/getWorkingDir/getVibeVoiceBackend/getNotificationManager/getAutonomousExecutor/getVerificationCascade/getTrainingPipeline` — each called by at least one RPC handler.

**Methods in the tail range that are NOT reachable from kairos-rpc.ts** (unused over the RPC boundary — potentially dead from the daemon perspective):
- `runArena` (no match — `runCouncil` is used instead).
- `runWaveExecution` — no direct RPC call site.
- `getAgentSpawnConfig` — no direct RPC call site.
- `loadAgentOverrides` — no direct RPC call site.
- `generatePlan` — no direct RPC call site.
- `getMaximizerContextBudget` — no direct RPC call site.
- `replayContext` — no direct RPC call site.
- `optimizeToolSchema` / `validateToolArgs` — no direct RPC call site.
- `runPromptRegressionTests` — no direct RPC call site.
- `checkSourceRepos` / `syncSourceRepos` — no direct RPC call site (may be CLI-only via `wotann repos`).
- `generateProofBundle` — no direct RPC call site.
- `applyHashEdit` — no direct RPC call site.
- `getAmbientContext` — no direct RPC call site.
- `getCouncilLeaderboard` — no direct RPC call site.
- `enhancePrompt` — no direct RPC call site (note: line 1911 uses `getPromptEnhancerEngine()` instead — the engine and the wrapper appear to be two parallel implementations, one of which may be dead over the RPC channel).
- `runCouncilDeliberation` — no direct RPC call site (line 3057 uses `runCouncil`, not `runCouncilDeliberation`); this is the **duplicate wrapper** identified above.
- `getAwaySummary` — no direct RPC call site.

These are reachable via the class but the daemon never wires them. The CLI and/or TUI may still use them; without scanning those layers we cannot call them dead, but they are **dead-relative-to-RPC**.

---

## 5. Bugs, Stubs, Silent Failures, False Claims

### 5.1 Bugs / drift
- `runCouncilDeliberation` has a vacuous ternary `status.includes(provider) ? "auto" : "auto"` (line 4188-ish). Both branches equal. The lookup is done for nothing; either remove or make the branches meaningful (e.g., fall back to a different model when the provider isn't available).
- `runCouncilDeliberation` duplicates `runCouncil` with slight semantic divergence (throw vs sentinel) — two methods with near-identical bodies, increasing drift risk.
- `close()` uses `Date.now()` for per-message timestamps in the snapshot; real per-message timestamps are lost.
- `runDreamConsolidation` uses `output!` non-null assertion; empty-string output would pass the truthiness filter but still register as a correction. Minor.

### 5.2 Stubs / placeholders
- `runWaveExecution` reports `{testsRun: 0, testsPassed: 0, costUsd: 0, tokensUsed: 0, filesModified: [], knowledgeExtracted: [], errors: []}` — all metrics are **hardcoded zero/empty**. The delegation ledger shows every wave execution as a zero-cost no-op regardless of real cost.
- `runDreamConsolidation` hardcodes `successRate: 0.85`, `count: 1`, `reason: "session correction"`, `decayRate: 0.99`, `idleMinutes: 30` — multiple placeholder metrics feeding the consolidation.
- `buildFileInfoFromTree` fabricates `size: 0` and `lastModified: now` for every file. Downstream scorers receive fake metadata.
- SkillForge writes in `runDreamConsolidation` — only `content` is used from a 5-field object; the rest is constructed-then-abandoned.
- The Autoresearch no-op generator (line 934) is the default and only path.

### 5.3 Silent failures
- C7 Dream-pipeline seed in `close()`: bare `catch {}` — any observation schema change silently drops all observations.
- Plugin lifecycle `on_session_end` — `.catch(() => {})`.
- `verificationCascade` in `runPreCommitAnalysis` — fire-and-forget, only captures failure event; never propagates.
- `persistKnowledgeGraph` — `void` call with no error handler; also races with `memoryStore.close()` on the next line.
- `nightlyConsolidator.consolidate` — try/catch with silent fallthrough.
- Skill forge persistence — try/catch with silent fallthrough comment "non-fatal".
- LESSONS.md append — try/catch with silent fallthrough.
- `last-dream.json` write — try/catch with bare `catch {}`.
- `captureLearningFeedback` — skips `neutral` AND `confidence < 0.5` silently; the threshold-missed case is indistinguishable from no signal.
- `loadAgentOverrides` — unknown-agent-ID specs are "silently skipped so a stale spec never blocks startup" (documented).

### 5.4 False claims (documented in code or implicit)
- **Autoresearch no-op default**: comment claims "callers provide real one via getAutoresearchEngine()" — the accessor returns the pre-constructed engine with the baked-in no-op. There is no runtime way to inject a real generator. This is a false-claim stub.
- **close() idle assumption**: `idleMinutes: 30` hardcoded with comment "Assume idle since we are at session close" — factually the session could have closed after a second of activity. Dream pipeline trusts a fabricated idle gate.
- `runWaveExecution` completes every delegation with `success: true` regardless of actual result content — if the executor threw, the exception propagates (no try wrap), so the ledger only ever logs happy paths; failed runs crash without a ledger entry. The claim that the ledger tracks "ownership and results per task" is partial — results are always synthetic.
- `runCouncil`'s comment correctly notes the prior dropped-`model` bug is now fixed, which is accurate.

### 5.5 Dead-call-site risks
- `runCouncilDeliberation` (unreachable via RPC; `runCouncil` is the only one called by kairos-rpc.ts line 3057).
- `runArena` (no RPC caller detected).
- `runWaveExecution` (no RPC caller detected).
- `enhancePrompt` (no RPC caller; RPC uses `getPromptEnhancerEngine()` at line 1911 with a different implementation path).
- All Phase-3/Phase-4 accessors except the handful explicitly wired.
- `resolveSecurityResearchProvider` — private; no internal callers visible in this range. It is defined but only reachable if some other method (outside this range) calls it; if none do, it's dead.

---

## 6. Key Observations

- **Most wrappers are pure delegation**; the runtime acts as an IoC surface for a very large dependency graph. This is legitimate. The risk is that the accessor-and-wrapper pattern makes it easy for a wrapper to drift from its delegate while the getter keeps working.
- **close() is doing too much**: hooks, recorder stop, learning extraction, observation seeding, plugin lifecycle, skill analysis, snapshot, dream consolidation, instinct decay, graph persistence, memory close, workspace dream. A failure at any layer (with most being try/catch-silent) means close() always returns but may drop data. Consider splitting into prepareClose → finalizeClose.
- **Placeholders in the consolidation pipeline** feed fabricated metrics into downstream learning; anything built on top of `successRate: 0.85` or `count: 1` has a misleading signal floor.
- **Duplicate wrappers** (`runCouncil` vs `runCouncilDeliberation`) suggest incomplete deprecation — one should be removed.
- **Autoresearch no-op generator** is the single largest silent-stub in the tail region: a full engine construction with a lambda that always returns null, no setter, and a misleading comment. Any autoresearch feature exposed through the engine is effectively bypassed.
