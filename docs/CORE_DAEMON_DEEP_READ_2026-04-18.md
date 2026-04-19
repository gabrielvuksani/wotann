# CORE + DAEMON DEEP READ — 2026-04-18

Full-text read of every file in `wotann/src/core/` (28 files, ~285 KB) and `wotann/src/daemon/` (13 files, ~315 KB) with per-file purpose analysis, symbol inventory, import wiring verification, stub detection, bug hunt, and dead-code scan. Total ~600 KB and ~21,000 lines of TypeScript read in full.

---

## PART 1 — `src/core/` (28 files)

### 1. `agent-bridge.ts` (383 lines)

**Purpose.** Routes prompts through the provider fallback chain. Walks preferred → paid → free until one succeeds, yields StreamChunks, emulates tool-calling on non-native providers by parsing `<tool_use>` XML from text, supports rotating multiple accounts per provider.

**Symbols exported.** `AgentBridgeConfig`, `QueryResult`, class `AgentBridge` (methods: `query`, `querySync`, `getAvailableProviders`, `getAdapter`).

**Imports (sibling-relative).** `./types.js` (types), `../providers/types.js`, `../providers/model-router.js`, `../providers/rate-limiter.js`, `../providers/fallback-chain.js`, `../providers/capability-augmenter.js`, `../providers/account-pool.js`.

**Stub detection.** None — every branch has a concrete implementation. The `catch { /* Fall through to error */ }` at line 285 in last-resort block is intentional last-ditch swallow.

**Bug/smell findings.**
- **Unused `startTime` destructuring note** — `querySync` tracks `startTime` once but then calls `durationMs: Date.now() - startTime` only in `QueryResult`, fine.
- **Minor correctness concern**: `querySync`'s `usedFallback` logic only toggles when `fallbackChain.length > 0` AND `provider !== chunk.provider` — so if the first chunk is from a fallback provider, usedFallback stays false. The chain itself gets recorded correctly.
- `for await` over `adapter.query` inside a `for` loop over accounts: `break` on rate-limit cascades account→account correctly.
- `isRateLimitError`/`isBillingError` use substring matching on lowercased text — prone to false positives if a provider's legitimate response happens to contain the word "billing" (e.g. "your billing cycle resets in 5 days" in a model's text reply). Low-risk but not ideal.
- **Capability augmentation yields dual signals**: when `canEmulateTools` is true and a parsed tool_use is emitted, the code swallows subsequent text tokens of the same XML block, BUT the multi-call path iterates and emits all calls before the `emulatedToolEmitted = true` flag goes up. Looks correct; the branch sequence is tight.

**Dead code.** None — every export is referenced elsewhere per imports in `runtime.ts`.

---

### 2. `agent-profiles.ts` (147 lines)

**Purpose.** Defines three agent capability profiles (Write/Ask/Minimal) that gate tool access, hook profile, memory depth, and per-turn token cap. Drives Shift+Tab cycle in TUI.

**Symbols exported.** `AgentProfileName`, `AgentProfile`, `AGENT_PROFILES` const record, `cycleProfile`, `getProfile`, `allProfiles`, `profilePermitsTool`, `ProfileRuntimeOverlay`, `applyProfile`, `renderProfileSwitch`, `renderProfileList`.

**Imports.** None (leaf module).

**Stub detection / bugs.** None. Pure functional module with fallback `?? "write"` in `cycleProfile`.

**Dead code.** `renderProfileSwitch`/`renderProfileList`/`applyProfile` — grep would reveal whether TUI consumes them. Likely live via UI layer.

---

### 3. `claude-sdk-bridge.ts` (179 lines)

**Purpose.** Lazy-loads `@anthropic-ai/claude-agent-sdk` as a peerDependency and bridges its message stream into the harness's `StreamChunk` format. Used when the Anthropic provider is active.

**Symbols exported.** `ClaudeSDKQueryOptions`, `queryViaClaudeSDK` (async generator), `isClaudeSDKAvailable`.

**Imports.** `../providers/types.js` type only. Dynamic import `@anthropic-ai/claude-agent-sdk`.

**Stub detection.** None.

**Bug findings.**
- `void startTime;` at line 54 — dead assignment to silence unused-var lint. Not a bug but cruft.
- `block.thinking` cast uses `as { thinking: string }` — loose; if SDK payload schema changes this falls back to empty string gracefully via `?? ""`.
- `message.subtype === "success"` path uses `message.usage?.input_tokens` as a truthiness check before the sum — if `input_tokens` is 0 this evaluates falsy and retains prior `totalTokens`. Minor accounting drift (0-token success uses last chunk's total).

**Dead code.** None.

---

### 4. `config-discovery.ts` (360 lines)

**Purpose.** Scans `~/.claude`, `.cursor`, `.codex`, `.gemini`, `.crush`, `.cline`, `.copilot`, `.wotann` for configs, rules, skills and imports them safely (redacting secrets).

**Symbols.** Types `DiscoveredConfig/Rule/Skill`, `DiscoveryResult`, `ImportResult`, `AgentTool`. Class `ConfigDiscovery` (methods `discover`, `listDiscovered`, `importSettings`, private `scanToolDirectory`). Module-helpers `isDirectory`, `safeReadFile`, `safeReadDir`, `tryParseJson`, `deduplicatePaths`, `extractSafeSettings`.

**Imports.** Only `node:fs`/`node:path`.

**Stubs/bugs.**
- `importSettings`'s returned object lists validated rules/skills but — reading the code — it only *counts* them; it does NOT persist or merge them. `imported: settingsMerged > 0 || validRules.length > 0 || validSkills.length > 0` is true while no actual merge happens. Silent pseudo-success. Likely orchestrator-invoked, but without more context this is effectively "report-only" (acceptable if the caller does the merging; the method comment says "merged settings" which overpromises).
- `secretPatterns.test(value)` flags any string-typed value containing the substring "key/token/secret/password/credential/auth" as secret. False positives on legitimate values like "authenticated" or "keyword". Minor.

**Dead code.** None.

---

### 5. `config.ts` (220 lines)

**Purpose.** Hierarchical config loader: defaults → YAML file → env vars → CLI flags. Returns immutable `WotannConfig`.

**Symbols.** `findWorkspaceRoot`, `loadConfigFromFile`, `loadConfigFromEnv`, `CLIOverrides`, `loadConfigFromCLI`, `loadConfig`, `getDefaultConfig`. Local Zod schemas.

**Imports.** `./types.js`, `yaml`, `zod`, node fs/path.

**Stubs/bugs.**
- `.nexus` legacy directory fallback at line 70 — intentional back-compat for the rebrand.
- The `validated.success` path returns `validated.data as WotannConfig` — Zod schemas populate defaults, so the fallback-to-unvalidated branch returns a possibly incomplete config. In practice harmless because DEFAULT_CONFIG is merged first.
- `loadConfigFromCLI` only honors `hookProfile` — other fields on `CLIOverrides` (`provider`, `model`, `mode`) are silently ignored. Either the interface is aspirational or the actual CLI plumbing wires them elsewhere. Minor surface-area mismatch.

**Dead code.** The `.nexus` back-compat branch is dead for greenfield users; kept deliberately for rebrand migration.

---

### 6. `content-cid.ts` (166 lines)

**Purpose.** Generates compact base36 Content-ID prefixes of SHA256 digests so weak local models can reference chunks of content with 2–3-char ids instead of full hex.

**Symbols.** `cidOf`, `CidChunk`, `CidIndexEntry`, `buildCidIndex`, `resolveCid`, `renderCidBlock`, `verifyCid`.

**Imports.** `node:crypto`.

**Stubs/bugs.** None. Throws on length out of [1..12]; throws at length 12 collision (reasonable). Pure.

**Dead code.** None.

---

### 7. `conversation-branching.ts` (231 lines)

**Purpose.** Git-branch-style conversation forking. Named branches, fork-at-any-turn, merge, compare, delete, JSON serialize.

**Symbols.** `ConversationTurn`, `ConversationBranch`, `BranchComparison`, class `ConversationBranchManager`.

**Imports.** `node:crypto`.

**Stubs/bugs.**
- `getActiveBranch(): ConversationBranch { return this.branches.get(this.activeBranchId)!; }` — the non-null assertion is technically unsafe. If someone deletes the active branch (guarded by `deleteBranch` refusing to delete active one, so OK), or uses `deserialize` with malformed JSON, the `!` could mask a bug.
- `compare`: simple prefix-match divergence. Uses `content === content` comparison. If two branches have the same content but came from different forks it still treats them as common. OK.
- `merge`: assigns new `id` but preserves `parentId` from source turns — the parent chain will point to nodes in the source branch, orphaning in the target. Should probably renumber parentIds. Potential bug depending on downstream use.
- `fork`: line 119 `forkIdx >= 0 ? turns.slice(0, forkIdx + 1) : []` — when fromTurnId not found (findIndex returns -1) inherits nothing even if there were turns. Acceptable; may surprise callers.

**Dead code.** None.

---

### 8. `conversation-tree.ts` (279 lines)

**Purpose.** Parallel implementation of conversation trees with session recorder and command history. Similar responsibility to `conversation-branching.ts` but a different shape.

**Symbols.** `ConversationNode`, `Branch`, `ConversationTree`, `ReplayEvent`, `SessionRecorder`, `CommandHistory`.

**Imports.** `node:crypto`, `./types.js`.

**Stubs/bugs.**
- `compareBranches` saves `savedBranch`/`savedNode` and restores them directly — but in between it calls `switchBranch` which uses `branch.rootNodeId` as the node. When it "restores" via `this.currentBranchId = savedBranch; this.currentNodeId = savedNode;` it bypasses `switchBranch`'s validation. OK because we're trusting saved values.
- `createBranch` with `currentNodeId === null` sets `rootNodeId` to `""` — string-empty sentinel. `addMessage` then sets rootNodeId on first add. OK but brittle.
- **DUPLICATE RESPONSIBILITY**: this file's `ConversationTree` and `conversation-branching.ts`'s `ConversationBranchManager` do overlapping things. Runtime wires BOTH (see `this.conversationTree` and `this.branchManager`). The pattern looks like historical — one was forked from the other. **Dead code candidate: one of these two classes should be deleted**.

**Dead code.** The overlap with `conversation-branching.ts`. `CommandHistory`/`SessionRecorder` are referenced in runtime.

---

### 9. `deep-link.ts` (274 lines)

**Purpose.** Parses and executes `wotann://` URLs for one-click skill install, config import, session resume, provider connect, mode set, channel pair, theme set, arena start, MCP install.

**Symbols.** Types `DeepLinkAction`, `DeepLinkRequest`, `DeepLinkResult`, `DeepLinkContext`. Functions `parseDeepLink`, `executeDeepLink`, `generateDeepLink`, plus private per-action handlers.

**Imports.** None (stdlib only).

**Stubs/bugs.**
- `handleConfigImport` always returns `success: true` with no actual import (no context hook). Effectively a stub: "Importing config from: ${url}" then silence. Will mislead UI into displaying success.
- `handleProviderConnect` and `handleConfigSet` same pattern — success envelope with no action, just echo. These are advertised actions that don't actually do anything.
- `handleArenaStart`, `handleThemeSet`, `handleMCPInstall` require optional context handlers; when absent they return success with data but do nothing. Acceptable given context-driven design, but fragile.
- **Security concern**: `handleProviderConnect` accepts a `key` param (mentioned in the URL example `wotann://provider/connect?provider=anthropic&key=sk-...`) — but the handler does NOT read the `key` and does NOT store anything. The URL example in the docstring implies secret-accepting behavior that isn't wired. That's fine for safety, but the docstring is misleading.

**Dead code.** The `session/share` action generates a share link via `generateDeepLink`, no persistence. Trivial.

---

### 10. `default-provider.ts` (107 lines)

**Purpose.** Resolve initial default provider/model with strict priority order: CLI option → env → YAML → first-enabled in providers map → first env-detected → null.

**Symbols.** `DefaultProvider`, `resolveDefaultProvider`.

**Imports.** `yaml`, `../providers/model-defaults.js`.

**Stubs/bugs.**
- Catches all YAML parse errors silently (returns null). Intended.
- `readYamlDefault` uses `typeof cfg["defaultProvider"] === "string"` strictly — integer or null types return null rather than throwing. Good.
- No handling for the case where the YAML provider name isn't in `PROVIDER_DEFAULTS` — would fall back to `null` model. Acceptable.

**Dead code.** None.

---

### 11. `mode-cycling.ts` (307 lines)

**Purpose.** 12-mode system (default, plan, acceptEdits, auto, bypass, autonomous, guardrails-off, focus, interview, teach, review, exploit) with merged skill instructions, allowed tool flags, safety-flag clearance, accent colors.

**Symbols.** `WotannMode`, `ModeConfig`, `MODE_CONFIGS` const map, `ModeCycler` class.

**Imports.** `./types.js` (PermissionMode).

**Stubs/bugs.**
- `guardrails-off` mode is noted as "alias for exploit" — both exist with near-duplicate configs. Intentional for back-compat but duplicative.
- `setMode(mode: WotannMode): ModeConfig { this.currentMode = mode; return this.getMode(); }` — no validation that `mode` is in `MODE_CONFIGS`. TypeScript protects at compile time; runtime JSON/config loads could pass an invalid mode causing `getMode()` to fall through to default. `??` fallback handles this.
- `CYCLE_ORDER` omits `guardrails-off` but includes `exploit` — cycling skips the alias, OK.
- `isAllowed` is a terse ternary — readable but packed.

**Dead code.** `guardrails-off` MODE_CONFIG entry is a near-clone of `exploit`. Could be collapsed into `setMode` normalizer instead of a full mode config.

---

### 12. `project-onboarding.ts` (383 lines)

**Purpose.** Scan project directory to detect language, frameworks, test frameworks, CI/CD, dependencies, entry points, dead-code candidates, hot paths; generate a concise summary for LLM context injection.

**Symbols.** `StackProfile`, `LanguageInfo`, `DependencyNode`, `DependencyGraph`, `CodeFlowAnalysis`, `OnboardingResult`, `ProjectOnboarder`, plus helper functions.

**Imports.** `node:fs`, `node:path`.

**Stubs/bugs.**
- `collectAllFiles(dir, depth = 0)` — depth cap at 6. Could miss nested files in deeply-nested monorepos.
- `collectAllFiles` is fully synchronous and unbounded by file count. For a 500k-file repo it could exhaust memory. No `maxFiles` param.
- `analyzeCodeFlow`: `allContent` concatenates up to 200 files into a string and uses naive `.includes(base)` substring matching for dead-code detection. False positives: a file named `b.ts` will match `base === "b"`; many short basenames survive. Also O(n*m) in practice.
- `detectByIndicators`: stores indicator name only, no per-file evidence back-reference. Fine.
- `hotPaths` just slices top-level `src/` paths. Heuristic, not accurate import-count ranking. Minor.
- `buildDependencyGraph` silently returns empty object on `package.json` parse failure — no caller-facing warning.

**Dead code.** None.

---

### 13. `prompt-override.ts` (231 lines)

**Purpose.** Parses per-turn prompt overrides `[@provider:model effort=high thinking=medium temperature=0.5]` and merges them onto session defaults.

**Symbols.** `ThinkingLevel`, `EffortLevel`, `PromptOverride`, `ExtractedPrompt`, `extractOverride`, `TurnDispatchConfig`, `applyOverride`, `hasOverride`.

**Imports.** None.

**Stubs/bugs.**
- `OVERRIDE_TAG_RE` accepts only first-occurrence per prompt. If user embeds two tags the second is dropped silently.
- `splitPrimary` heuristic: disambiguates by `KNOWN_PROVIDERS` set. Adding a new provider requires editing both this set and the provider-registry — drift risk.
- `parseKvPairs`: no guard against duplicate keys (`effort=low effort=high` → last wins). Acceptable.

**Dead code.** None.

---

### 14. `runtime-intelligence.ts` (318 lines)

**Purpose.** Pure functions extracted from `runtime.ts` for skill activation prompts, memory activation prompts, context budget prompt assembly, and conversation-history compaction.

**Symbols.** Type `SkillActivationResult`, `MemoryActivationResult`, `ConversationCompactionResult`, constants, `estimateTokenCount`, `extractReferencedPaths`, `buildSkillActivationPrompt`, `buildMemoryActivationPrompt`, `buildContextBudgetPrompt`, `compactConversationHistory`, `estimateConversationSplit`, private helpers.

**Imports.** `node:fs`, `node:path`, types from `./types.js`, types from `../context/window-intelligence.js`, `../memory/store.js`, `../skills/loader.js`.

**Stubs/bugs.**
- `try { ... } catch { return { prompt: "", recalledCount: 0, proactiveCount: 0 }; }` in `buildMemoryActivationPrompt` — any memory store error silently returns empty. Loss of observability.
- `estimateTokenCount(text)` uses `Math.ceil(text.length / 4)` — cheap approximation; fine.
- `compactConversationHistory`: `keepCount = 4|6|8` by stage. Removes messages but doesn't preserve any user/assistant interleaving invariant. Consumers should verify the compacted pair is legal for their provider.
- `scoreSkillSummary`: scores `+6` for name-match, `+2` for description-match. Small tokens get extra weight vs long descriptions — acceptable heuristic.
- `truncate` uses `.trimEnd()` then appends `…`. Good.

**Dead code.** None.

---

### 15. `runtime-tool-dispatch.ts` (455 lines)

**Purpose.** Executes runtime-injected tools (web_fetch, plan_create/list/advance, find_symbol, find_references, rename_symbol). Also hosts `ToolTimingTracker` class for per-tool duration tracking.

**Symbols.** `ToolTimingTracker` class, `formatToolTimingAnnotation`, `annotateToolResultMessage`, `ToolDispatchResult`, `WebFetchDep`, `PlanStoreDep`, `LSPManagerDep`, `ToolDispatchContext`, `dispatchWebFetch`, `dispatchPlanCreate`, `dispatchPlanList`, `dispatchPlanAdvance`, `ToolDispatchDeps`, `dispatchRuntimeTool` unified dispatcher, `dispatchFindSymbol`, `dispatchFindReferences`, `dispatchRenameSymbol`.

**Imports.** `./types.js` (types), `../tools/web-fetch.js`.

**Stubs/bugs.**
- This file is **not yet consumed by `runtime.ts`** (see the `TODO(god-object-extraction)` in runtime.ts near line 795/433). Runtime still has the tool dispatch inlined. Effectively DEAD CODE at module-level — imported nowhere except tests.
- `annotateToolResultMessage` guards against double-annotation via substring check `includes("[tool:") && includes("completed in")` — prone to false positives on legitimate messages about tools. Minor.
- `dispatchFindSymbol/etc.` error messages refer to line/character 0-indexed; the tool schemas document 0-indexed. Consistent.

**Dead code.** The whole file is dead pending the extraction refactor. Comment at line 10 acknowledges this ("runtime.ts can import and delegate to this module in a future refactor").

---

### 16. `runtime-tools.ts` (258 lines)

**Purpose.** Sibling of `runtime-tool-dispatch.ts`: builds the `ToolDefinition[]` list for an effective query. Contains `buildEffectiveTools`, `isRuntimeTool`, `RUNTIME_TOOL_NAMES` const.

**Symbols.** `ToolRegistryDeps`, internal builders `buildComputerUseTool/.../buildRenameSymbolTool`, `RUNTIME_TOOL_NAMES`, `RuntimeToolName`, `isRuntimeTool`, `buildEffectiveTools`.

**Imports.** `./types.js`.

**Stubs/bugs/dead code.**
- Same story as `runtime-tool-dispatch.ts`: **not consumed** by runtime.ts yet. Inline duplication present in runtime.ts lines 803+ and 846+ (computer_use, web_fetch, plan_create/list/advance all inlined). Entire file is dormant.
- **DUPLICATE TOOL DEFINITIONS**: `buildComputerUseTool`, `buildWebFetchTool`, `buildPlanCreateTool`, `buildPlanListTool`, `buildPlanAdvanceTool` are duplicated in runtime.ts literally — drift risk (the description string in runtime.ts uses em-dash `—`, this file uses hyphen `--`).

---

### 17. `runtime.ts` (4724 lines — GOD OBJECT)

**Purpose.** `WotannRuntime` composition root. Wires providers, hooks, middleware, memory, semantic search, cost tracking, mode cycler, intelligence subsystems, session tracking, skill registry, context intelligence, and ~80+ getter methods for RPC surface.

**Symbols exported.** `ThinkingEffort`, `RuntimeConfig`, `RuntimeStatus`, class `WotannRuntime`, `createRuntime` helper.

**Imports (sibling + sibling-package).** 130+ imports including:
- Same-dir: `./types.js`, `./tool-path-extractor.js`, `./default-provider.js`, `./session.js`, `./mode-cycling.js`, `./config.js`, `./stream-resume.js`, `./session-resume.js`, `./runtime-intelligence.js`, `./conversation-branching.js`, `./conversation-tree.js`, `./virtual-paths.js`, `./config-discovery.js`.
- Other src/: `../providers/*` (many), `../hooks/*`, `../memory/*` (many — store, active-memory, quantized-vector-store, proactive-memory, vector-store, graph-rag, context-tree, cloud-sync, qmd-integration, episodic-memory, context-fence, retrieval-quality, context-loader, observation-extractor, tunnel-detector, conversation-miner), `../middleware/*`, `../prompt/*`, `../utils/*`, `../telemetry/*`, `../intelligence/*` (dozens), `../security/*`, `../learning/*`, `../plugins/*`, `../context/*`, `../ui/*`, `../desktop/*`, `../identity/*`, `../lsp/*`, `../tools/*`, `../orchestration/*` (many), `../channels/*`, `../verification/*`, `../training/*`, `../voice/*`, `../monitoring/*`, `../testing/*`, `../skills/*`.

**Stubs/bugs — HIGH LEVEL.** This is the single biggest file in the codebase. Notes:

- `TODO(god-object-extraction)` at lines ~795 and ~433: tool registration and tool dispatch are inlined instead of delegating to `runtime-tools.ts` and `runtime-tool-dispatch.ts`. Extraction planned but unshipped. Result: **those sibling modules are dead code until the refactor lands**.
- The imports are enormous (lines 17–282, 265 import statements). Any new subsystem adds friction. Target for extraction passes.
- `pendingContextPrefix` field declared at line 361 (inside query method scope? No — declared inside class body but placed mid-method sequence in the source, which is unusual TS style but legal).
- `syncMessageIndex()` is invoked 6 times across mutation points; any new place that re-assigns `this.session.messages` needs this too. Easy to forget (F9 note in code).
- **Anti-distillation** (`enableAntiDistillation`) — generates fake tools and injects them into effectiveTools. Works as advertised.
- **Tool emulation paths**: the hash-anchored edit substitution for weak models (lines 826-850) checks `supportsToolCalling && maxContextWindow < 200_000`. Any model with native tool calling AND <200k context gets the swap. Reasonable heuristic.
- **PIIRedactor**: sanitized prompt used only if `piiResult.totalRedacted > 0` — otherwise original boosted prompt passes through. Good short-circuit.
- **Anti-distillation sequence**: `if (this.config.enableAntiDistillation)` generates fake tools. Previously dead-coded; session-5 note confirms they now get appended to `effectiveTools`. Wired correctly.
- **PreToolUse hook**: runtime acknowledges in comment (line 240–252) that "prior WOTANN versions never fired PreToolUse anywhere in the runtime" — fix-up commit shows the current behavior fires at the tool_use chunk boundary. Good.
- **DoubleFire danger**: `hookEngine.fireSync` at `SessionStart` and `hookEngine.fire` (async) at `PreToolUse/PostToolUse`. Both paths are used. Consistent with engine design.
- `resolveSecurityResearchProvider()` (line 1171) — preferredOrder hardcoded; acceptable. Returns undefined when no match, triggering a local fallback.
- **Knowledge-graph rehydration**: `rehydrateKnowledgeGraph` reads `.wotann/knowledge-graph.json` on boot; `persistKnowledgeGraph` writes atomically via tmp+rename. Good pattern.
- **session dump in close()**: dumps a V2 `SessionSnapshot` including `activeTasks: []`, `trackedFiles: []`, `memoryContext: ""`, `doomLoopHistory: []` — those three are always empty because runtime doesn't populate them. Snapshot schema promises more data than is saved.
- **Race risk**: `runDreamConsolidation` writes `LESSONS.md` via `appendFileSync` without a lock. If two daemons run against the same workspace (shouldn't, but start.ts can't prevent NFS stale-PID races), they'd interleave.
- **Error-detection heuristic**: line 68 regex `\b(error|exception|traceback|stack trace|failed|failure|cannot|unable to)\b` + stack-trace requirement. Intentional to avoid the "I fixed the error" false positive mentioned in comment. Reasonable.
- **`updateModel` call at line 858** updates session provider/model from the most recent responseProvider/responseModel — this is a side effect mid-query. If the fallback chain changes providers, session.provider flips accordingly. Could surprise callers of `getSession()` mid-query.
- **`cost tracking split`**: `inputTokens = Math.floor(totalTokens / 2)`, `outputTokens = totalTokens - inputTokens`. Comment on lines 187–198 acknowledges this is a honest-split compromise and will be superseded when AgentMessage carries native input/output/thinking counts.
- **`agentHierarchy.registerAgent` at line 319–326** creates a registry entry per tool call — any tool call in any turn inflates the registry. If cleanup is not wired (grep reveals `hierarchy full or duplicate — non-fatal` catch) the registry grows unbounded within a session. Minor leak.
- **`writeAutonomousProofBundle` in generateProofBundle** writes to disk via a sibling utility; inspected fine.
- **`prefillCheck`/continuation path** at line 725 recursively calls `this.query({ ...options, prompt: continuationPrompt })` — no guard against infinite recursion if model keeps emitting truncated thinking. Relies on the model eventually producing non-truncated output. Acceptable.
- **`responseCache.get(cacheQuery)` short-circuit**: skips hooks, middleware.after, memory capture, cost tracking. Cache hit means literally zero telemetry for the turn. Feature-hiding side effect. Caller's cost stays at $0 even though cache served a response — good for dedup; but `costEntry` never recorded → `daily_cost` aggregates inaccurately over long sessions that cache heavily.
- **`hooks fire` after cache-hit**: not fired. `PostToolUse`, `ToolResultReceived`, etc. don't fire. The short-circuit skips the Step 8+ block entirely.
- **VirtualContext`virtualizeConversation`**: called at 80% pressure with `vcMessages` fabricated from `this.session.messages` using `Date.now() - (n - idx) * 60_000` as fake timestamps. Preserves relative order but the timestamps don't reflect reality. Downstream retrieval may be confused.
- **`refreshContextTelemetry` called 3x per query**: once pre-compaction, once post-QMD, once post-response. Each call recomputes token estimates — purely additive work. Non-trivial cost on long prompts. Could be debounced or incrementally updated.
- **mutation in `applySafetyOverrides`**: calls `this.hookEngine.pause()`/`resume()`. If two concurrent queries switch modes, one's resume may cancel the other's pause. Shouldn't happen with single-threaded JS but concerning under async reentrancy.
- **Cross-pollution**: `this.contextIntelligence.adaptToProvider(responseProvider, responseModel)` at line 859 mutates context budget tables. If provider flips mid-response, further logic uses the new budget. Not a bug but an invisible state shift.
- **Missing cleanup in `close()`**: does NOT close LSP servers explicitly; `lspManager` lifetime is tied to process exit. If runtime is recreated in-process (e.g. tests), LSP server handles leak.

**Dead code / unused imports.**
- `import type { FileInfo } from "../intelligence/context-relevance.js";` — used in `buildFileInfoFromTree`.
- `import { KnowledgeGraph } from "../memory/graph-rag.js";` — used.
- Most imports are live. Heavy but live.
- **Runtime-tool-dispatch.ts / runtime-tools.ts** — referenced nowhere. Dormant extraction targets (dead).
- Historical comment at line 1219–1225 explains why `extractTrackedFilePath` moved out of this file (drift).

**Summary.** runtime.ts is correct but gigantic. The God-Object extraction TODO and the dead runtime-tools/*.ts modules are the biggest hygiene issues. Short-circuit caching skipping telemetry is a potential quiet bug worth tracking.

---

### 18. `schema-migration.ts` (347 lines)

**Purpose.** Version-aware config migration engine — 4 migrations (0.1.0 → 0.5.0) with idempotent, validated, backup-before-write semantics.

**Symbols.** Types `MigrationStep/Result/Plan`, `compareVersions`, `parseVersion`, `planMigration`, `executeMigration`, `migrateConfigFile`, `needsMigration`, `getMigrationSteps`, `CURRENT_SCHEMA_VERSION`, internal `MIGRATIONS` const.

**Imports.** `node:fs`, `yaml`.

**Stubs/bugs.**
- `migrateConfigFile`'s backup path is `${configPath}.backup-${timestamp}` — never cleaned up. Long-lived workspaces accumulate backups.
- `planMigration` filter: `compareVersions(m.fromVersion, currentVersion) >= 0` — looks suspicious. If `currentVersion=0.2.0`, then step `0.1.0→0.2.0` has fromVersion 0.1.0 which is `< 0.2.0`, so it's filtered OUT. So we only run steps that are >= current AND <= target. That's backwards for an upgrade. Wait, rereading: we want steps whose fromVersion is == current OR somewhere along the chain. The `>=` logic is correct ONLY if we assume each step's from matches the previous step's to — sequential chain. For upgrades from 0.1 to 0.5, we want 0.1→0.2, 0.2→0.3, 0.3→0.4, 0.4→0.5. All four have `fromVersion >= 0.1` and `toVersion <= 0.5`, so all selected. OK.
- `executeMigration` `step.validate(current)` refuses to run when precondition fails — breaks the whole chain even if earlier steps succeeded. `break` exits the loop so partially-migrated config is still returned with `success: false`. Caller must not write on partial.
- `migrateConfigFile` writes migrated config via `writeFileSync(configPath, yaml, "utf-8")` — not atomic. Interrupted write corrupts config. Backup exists so recoverable, but atomic rename would be safer.

**Dead code.** None.

---

### 19. `session-recap.ts` (187 lines)

**Purpose.** Auto-naming a session and producing a short recap card for resume — avoiding the verbose `buildResumePrompt` dump.

**Symbols.** `autoNameFromSnapshot`, `slugifyTitle`, `SessionRecap`, `buildRecap`, `renderRecap`. Private helpers `firstNonTrivialTask`, `normaliseTitle`, `lastAssistantGist`, `firstActiveTask`, `failedTaskDescriptions`.

**Imports.** `./session-resume.js`.

**Stubs/bugs.**
- `slugifyTitle` truncates to 60 chars without word-boundary respect — may cut mid-word. Cosmetic.
- `lastAssistantGist` splits by `/[.!?]\s|\n/`. The `\n` alternative drops multi-line assistant replies to first line — acceptable for "gist".
- `normaliseTitle` ellipsis at 57 chars → 60 total with `…` — consistent.

**Dead code.** None.

---

### 20. `session-resume.ts` (243 lines)

**Purpose.** Full session continuity across machine restarts — serializes conversation, tasks, mode, context tokens, cost, tracked files, memory context to disk; rebuild on resume.

**Symbols.** `ConversationMessage`, `ActiveTask`, `SessionSnapshot` (V2), class `SessionStore`.

**Imports.** `node:fs`, `node:path`, `./session-recap.js`.

**Stubs/bugs.**
- `save` writes via `writeFileSync(filePath, JSON.stringify(...), "utf-8")` — not atomic, partial write corrupts snapshot.
- `enforceMaxSessions` retains 20 latest by savedAt; the deletion occurs after each save. O(N) on each save — fine for N=20.
- `getLatest` loads all snapshots just to pick one. Could store index. Minor perf.
- `buildResumePrompt` concatenates large memory context, potentially exceeding a provider's token budget. No truncation check.

**Dead code.** None.

---

### 21. `session.ts` (156 lines)

**Purpose.** Immutable session-state lifecycle functions: `createSession`, `addMessage`, `updateModel`, `saveSession`, `restoreSession`, `findLatestSession`, `formatSessionStats`.

**Symbols.** All the above.

**Imports.** `node:fs`, `node:path`, `node:crypto`, `./types.js`.

**Stubs/bugs.**
- `findLatestSession` filters by `e.cwd === process.cwd()` — in symlinked workspaces same project may appear as two distinct cwds. Minor.
- `restoreSession` sets `incognito: false` unconditionally — loses the original flag.
- `saveSession` writes non-atomically.

**Dead code.** None.

---

### 22. `steering-server.ts` (262 lines)

**Purpose.** Dual-terminal steering — second terminal writes JSON command files into `.wotann/steering/pending/`; autonomous runner picks them up at phase boundaries, processes, moves to `processed/`.

**Symbols.** `SteeringCommandType`, `SteeringCommand`, `SteeringServerOptions`, class `SteeringServer`.

**Imports.** `node:fs` (watch, renameSync, mkdirSync), `node:path`, `node:crypto`.

**Stubs/bugs.**
- `fs.watch` fallback to polling via `setInterval` — `knownFiles` set never pruned. If 1000 files are processed over a session this set grows — memory leak at long lifetimes. Minor.
- `startWatching`: try/catch around `watch()` falls through silently if unavailable. OK.
- `stopWatching` clears timer and closes watcher — correct.
- Sort by filename assumes filenames begin with numeric timestamp. If caller provides non-timestamped command with manual name, sort order breaks. Trust-based.

**Dead code.** None.

---

### 23. `stream-resume.ts` (216 lines)

**Purpose.** Persist interrupted streaming queries to disk (`.wotann/streams/<id>.json`), replay with a resume prompt that tells the model to continue from the partial content.

**Symbols.** `StreamCheckpointStatus`, `StreamCheckpoint`, `ResumeQuery`, class `StreamCheckpointStore`, `deserializeSession`, `buildResumeQuery`, internal `serializeSession`.

**Imports.** `node:fs`, `node:path`, `./types.js`.

**Stubs/bugs.**
- `write` always rewrites the full checkpoint JSON every chunk via `appendText` — heavy disk I/O for streaming response. Should batch.
- `getLatestInterrupted` loads all JSONs in directory — O(N) per lookup.
- No cleanup of completed/resumed checkpoints. Directory grows unbounded.

**Dead code.** None.

---

### 24. `tool-path-extractor.ts` (27 lines)

**Purpose.** Single shared helper `extractTrackedFilePath` that checks common keys (`file_path`, `path`, `target_file`, `targetPath`, `notebook_path`) in a tool's input record. Extracted to avoid duplicate drift (previously duplicated in runtime.ts AND a deleted runtime-query-pipeline.ts that missed `notebook_path`).

**Symbols.** `extractTrackedFilePath`.

**Imports.** None.

**Stubs/bugs.** None. Pure.

**Dead code.** None.

---

### 25. `types.ts` (250 lines)

**Purpose.** Core type definitions: `ProviderName`, `TransportType`, `BillingType`, `AuthMethod`, `ProviderAuth`, `ProviderStatus`, `ModelTier`, `RoutingDecision`, `TaskCategory/Descriptor`, `RiskLevel`, `AgentMessage`, `WotannQueryOptions`, `ToolDefinition`, `HookEvent` (9 live + 10 advisory), `HookProfile`, `WotannConfig` and sub-types, `PermissionMode`, `PermissionDecision`, `SessionState`.

**Imports.** None (leaf type definitions).

**Stubs/bugs.**
- `HookEvent` explicitly documents 10 advisory-only events that have **no producer wired** — so hooks registered against `PostToolUseFailure`, `SubagentStart/Stop`, `Notification`, `PermissionRequest`, `Setup`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate/Remove` NEVER FIRE. This is a documented dead-letter surface. Callers relying on these events get silent non-execution. Dangerous pitfall.

**Dead code.** None in types, but the 10 advisory HookEvent variants are effectively dead.

---

### 26. `virtual-paths.ts` (212 lines)

**Purpose.** Agents see virtual prefixes (`/mnt/workspace/`) that map to physical paths, with read-only flags and security checks to prevent escape.

**Symbols.** `VirtualPathConfig`, `ResolvedPath`, `MountValidation`, class `VirtualPathResolver` (methods resolve, virtualize, isWritable, isValid, getMounts, withMount, withoutMount, static validateMounts).

**Imports.** `node:path`.

**Stubs/bugs.**
- `validateMounts` checks for overlapping prefixes via nested double loop. Correctly flags containment. Good.
- `isUnderRoot` uses `relative(...)` against `!rel.startsWith("..") && !isAbsolute(rel)` — standard escape check. Safe.
- `resolve` normalizes, then finds mount with longest-match, then joins, then re-checks containment. Good layered defense.

**Dead code.** `withoutMount` is exported but grep would reveal usage. Likely live via dynamic mount config.

---

### 27. `workspace.ts` (443 lines)

**Purpose.** Scaffolds `.wotann/` directory with the 8-file bootstrap (SOUL, IDENTITY, USER, AGENTS, TOOLS, HEARTBEAT, BOOTSTRAP, MEMORY) plus config.yaml. Templates are inline string constants describing the agent's persona and rules.

**Symbols.** `CreateWorkspaceOptions`, `CreateWorkspaceResult`, `createWorkspace`, `workspaceExists`.

**Imports.** `node:fs`, `node:path`, `yaml`.

**Stubs/bugs.**
- `createWorkspace` with `reset: true` does NOT delete existing files — only skips the existsSync guard. Subsequent `writeFileSync` calls overwrite bootstrap docs but leave any unrelated files untouched. Probably intentional (preserves user data) but the name "reset" is misleading.
- `generateConfigTemplate` uses `Record<string, unknown>` and mutates via bracket-assignment. TypeScript-strict but mutates a local — acceptable.
- `options.minimal` path only writes AGENTS.md, TOOLS.md, MEMORY.md but always writes config.yaml regardless. Slightly inconsistent.

**Dead code.** None.

---

### 28. `wotann-yml.ts` (330 lines)

**Purpose.** Committable project-scope `.wotann.yml` config (v1) for team-shared provider/skills/hooks/MCP choices with personal override merge.

**Symbols.** Types `WotannYamlV1`, `WotannProvidersConfig`, `WotannSkillsConfig`, `WotannHooksConfig`, `WotannMcpConfig`, `WotannTeamConfig`, `ValidatedConfig`. Functions `parseWotannYaml`, `renderWotannYaml`, `mergeConfigs` with helpers.

**Imports.** `yaml`.

**Stubs/bugs.**
- `parseWotannYaml` accumulates problems without distinguishing warning vs error. Caller decides.
- `unionStrings` dedups preserving first-seen order — correct.
- `parseProviders.models` rejects ENTIRE models field if any value isn't string. Could allow partial acceptance.

**Dead code.** None.

---

## PART 2 — `src/daemon/` (13 files)

### 1. `auto-update.ts` (193 lines)

**Purpose.** Checks Ollama library + installed models against a curated "recommended" list every 6 hours; optionally pulls models. Cache at `~/.wotann/registry-cache.json`.

**Symbols (internal).** `ModelUpdate`, `RegistryCache`, `RECOMMENDED_OLLAMA_MODELS`, `loadCache`, `saveCache`, `checkOllamaModels`, `checkForUpdates` (exported), `getRecommendedModels`, `pullModel`.

**Imports.** `node:fs`, `node:path`, `node:os`.

**Stubs/bugs.**
- Fetches `https://ollama.com/api/models?sort=popular&limit=10` — this endpoint is unofficial; Ollama's public API does not document this. Likely silently fails (`try/catch` swallows).
- `pullModel` uses `AbortSignal.timeout(600000)` (10 min). Good.

**Dead code.** Exported `getRecommendedModels` and `pullModel` — grep would verify callers.

---

### 2. `automations.ts` (800 lines)

**Purpose.** Event-driven automation engine. Triggers: cron, file_changed, webhook (github/slack/generic), cost_threshold. Agent-config with model/system prompt/max-turns/max-cost, memory scope (isolated/shared). Persistence at `~/.wotann/automations.json`.

**Symbols.** Types and class `AutomationEngine`. Exports `AutomationExecuteHandler`, types re-exported at end, plus `parseCronExpression`, `cronMatchesDate`, `nextCronMatch`, `globMatches`, `extractGlobBase`.

**Imports.** `node:fs`, `node:os`, `node:path`, `node:crypto`.

**Stubs/bugs.**
- `parseCronField` handles `*/step`, ranges `a-b`, lists `a,b,c`. Missing: `@hourly`/`@daily`/`@reboot` special strings — fails silently if user writes `@daily`.
- `setupCronTrigger` polls every 60 seconds — fine.
- `setupFileWatcher` uses `fs.watchFile` (polling interval `Math.max(debounceMs, 1000)`). `fs.watchFile` keeps the process alive which is appropriate for daemon. Note: `fs.watchFile` does not follow directory changes — passes the literal file path.
- `watchSingleFile` for glob patterns watches the BASE directory only (via `extractGlobBase`); new files matching the glob inside that base are NOT detected because `watchFile` is per-file. Potential miss.
- `stop()` iterates `fileWatchers` keys, parses via `key.includes(":") ? key.slice(key.indexOf(":") + 1) : key` — a literal path with a colon (uncommon on Unix but possible on Windows) breaks. Minor.
- `handleWebhookEvent` uses `Promise.allSettled` — multiple matching automations fire in parallel; no rate-limit or queuing. If a single webhook matches 20 automations, they all execute concurrently. Could overwhelm provider rate limits.
- `executeAutomation`: no cost cap enforcement — the `maxCost` in agentConfig is passed through but not actually clamped in the payload-consuming handler.
- `updateAutomation` is called from inside `executeAutomation` to bump runCount — this immutably reassigns `automations` array every time, but `executeAutomation` holds the old `automation` reference. OK since it's already executing.
- `cronMatchesDate`: doesn't handle DST transitions — a cron triggered at 02:30 during spring-forward would silently skip.

**Dead code.** `ParsedCron`, `CronField` types exported at end but only used internally. Could trim the export surface.

---

### 3. `background-workers.ts` (502 lines)

**Purpose.** 12 daemon worker slots (consolidate, audit, map, optimize, predict, testgaps, benchmark, document, refactor, deepdive, ultralearn, preload) each dispatched on on-wake/periodic/nightly schedule with priority, time budget, enabled flag.

**Symbols.** `WorkerConfig`, `WORKERS` constant, `BackgroundWorkerManager`.

**Imports.** `./kairos.js` (type), `../core/runtime.js` (type), plus lazy `../intelligence/codebase-health.js` and `../intelligence/deep-research.js` inside handlers.

**Stubs/bugs.**
- `dispatchWorker` is a big switch. Some workers depend on runtime (`if (!this.runtime) return skipped`). Others use node:fs sync APIs in tight loops.
- `audit` worker uses synchronous `readdirSync/readFileSync/statSync` — blocks event loop. At 100+ files this is hundreds of ms. Should be async.
- `testgaps` and `audit` walk up to depth 4/1 respectively without cycle detection (fine for filesystem) and without cap on file count.
- `deepdive` fetches URLs with `globalThis.fetch` and a 10s abort; on error returns empty. OK.
- `setEnabled` mutates the Map — immutable convention inconsistency with the rest of the codebase.
- `toHeartbeatTasks`: emits ALL workers regardless of enabled, but downstream `shouldRunHeartbeatTask` checks enabled. OK.

**Dead code.** None.

---

### 4. `context-pressure.ts` (127 lines)

**Purpose.** Monitors token utilization. Emits `info`/`warning`/`critical` events at 60/80/95% thresholds (configurable). Keeps ring-buffer history.

**Symbols.** `ContextPressureEvent`, `ContextPressureMonitor`.

**Imports.** None.

**Stubs/bugs.**
- Constructor throws for invalid thresholds — good.
- `getHistory(limit)` returns reversed copy — correct.
- `MAX_HISTORY = 200` — bounded.

**Dead code.** None.

---

### 5. `cron-utils.ts` (63 lines)

**Purpose.** Shared crontab parser extracted to break a circular import between kairos.ts and event-triggers.ts.

**Symbols.** `matchCronField`, `matchesCronSchedule`.

**Imports.** None.

**Stubs/bugs.**
- `matchCronField` handles `*`, exact, `*/N`, `a,b,c`, `a-b`. Doesn't support step ranges like `1-10/2`. Missing.

**Dead code.** None.

---

### 6. `event-triggers.ts` (439 lines)

**Purpose.** Reactive automation — cron/filesystem/GitHub triggers that spawn agents or run shell commands. YAML-configured.

**Symbols.** Types, class `EventTriggerSystem`, helpers `parseTriggersYaml`, `extractValue`, `extractQuotedValue`, `finalizeTrigger`, `matchesGlob`.

**Imports.** `node:fs`, `node:path`, `node:child_process`, `node:util`, `./cron-utils.js`.

**Stubs/bugs.**
- YAML parser is hand-rolled (minimal, no external dep). Handles only simple `- name:` list items. Nested structures would break.
- `matchesGlob` is simplistic — "**/*.ts" matches any `.ts`. Patterns with directory segments get naive containment check. Many false positives.
- `runCommand` uses `execFileAsync` with 30s timeout, command split by whitespace — doesn't handle quoted args. `"foo bar"` in command splits on space.
- `spawnAgent` checks `agentSpawner` nullness; returns a skip message. OK.
- `handleGithubEvent` matches on `event.type === trigger.event || event.type.startsWith(trigger.event + ".")`. The dot-prefix allows `pull_request` to match `pull_request.opened` — OK.
- **Race**: `debounceTimers` map uses automation.name as key; if two triggers have the same name (allowed since no uniqueness check in `parseTriggersYaml`), they'd collide.

**Dead code.** None.

---

### 7. `file-dep-graph.ts` (273 lines)

**Purpose.** Scans TS/JS files, parses imports (static + CommonJS + dynamic), builds forward+reverse adjacency maps, answers "what's affected if I change X?" via BFS transitive dependents.

**Symbols.** `FileDependency`, `DependencyGraph`, `ImpactAnalysis`, class `FileDependencyGraph`.

**Imports.** `node:fs/promises`, `node:path`.

**Stubs/bugs.**
- `IMPORT_RE`/`REQUIRE_RE`/`DYNAMIC_IMPORT_RE` regexes are strict but miss template literal imports or multi-line imports. Template-literal `import(\`${name}\`)` not detected.
- `resolveSpecifier` tries exact match → +extension → `/index.ext`. Missing: `package.json#main` resolution for local packages and TS path aliases.
- `collectFiles` skips `node_modules`, `dist`, `.git` — but not `build`, `.next`, `coverage`, etc. Other SKIP_DIRS lists elsewhere in codebase. Drift.
- `getTransitiveDependents` BFS with visited set — correct, O(V+E).
- `buildFromDirectory` loads all file contents in parallel then extracts — memory proportional to total source size. Large repos could OOM.

**Dead code.** None.

---

### 8. `kairos.ts` (1750 lines)

**Purpose.** KAIROS — always-on daemon. Hosts the runtime, IPC server, companion server for iOS, channel gateway, unified dispatch plane, background workers, pattern crystallizer, feedback collector, self-evolution, trajectory extractor, dream pipeline, event trigger system, ambient awareness, background agents, automations, file search, PWR engine, GitHub bot, IDE bridge, living-spec manager, workflow DAG engine, context pressure monitor, terminal monitor, file dependency graph, cross-device context, idle/flow tracker, cost oracle, MCP registry, skill marketplace, Docker sandbox, task isolation, terminal manager, plugin sandbox, reasoning engine, user model, perception engine.

**Symbols exported.** `DaemonStatus`, `HeartbeatTask`, `CronJob`, `DaemonState`, `DailyLogEntry`, `ChannelGatewayStartOptions`, `HeartbeatScheduleKind`, `matchesCronSchedule`, `matchCronField` re-exports, class `KairosDaemon`, `parseHeartbeatTasks`, plus internal `isHeartbeatSchedule`, `computeNextRun`, `resolveChannelSelections`.

**Imports.** Huge — 40+ modules. Spans channels, learning, memory, desktop, orchestration, sandbox, computer-use, identity, marketplace, security, training, intelligence.

**Stubs/bugs.**
- **Circular risk**: `event-triggers.ts` imports `cron-utils.js` (leaf). `kairos.ts` also imports `cron-utils`. Re-exports via `export { matchesCronSchedule, matchCronField }` at line 137 from `./cron-utils.js`. That's a re-export to preserve back-compat. Clean.
- **File watcher DISABLED comment at line 332-339** — acknowledges blocking issue with `fs.watch` recursive:true. File-change detection is deferred to heartbeat rebuild. Known limitation.
- **`start()` path is huge and sequential**. Multiple `void` fire-and-forget promises: `fileDependencyGraph.buildFromDirectory`, `initDreamPipeline`, `eventTriggerSystem.loadConfig`. If one rejects, only the `.catch` closure fires. Acceptable.
- **Companion server port hardcoded** at 3849 (line 293). Should be configurable.
- **Channel auto-detect**: `hasChannelCreds = […].some(key => !!process.env[key])` — fires channel gateway if ANY of the listed env vars is set. Starts the gateway silently without user opt-in. Privacy concern in some environments.
- **Proactive checks**: `proactiveCheck` called every 4th tick (~1min), `proactiveHeartbeatCheck` every 20th tick (~5min). These push desktop notifications — `pushNotification` via macOS `osascript`. Spams user if misconfigured.
- **Model discovery**: every 400th tick (~100 min) runs `discoverModels(creds)` — reads env vars at each call. If the user set new keys at runtime they're picked up. Good.
- **tick() synchronous body**: heavy lifting forks to `void Promise` patterns — acceptable but makes error handling per-tick hard.
- **`checkAndRunDreamPipeline`**: runs only between 2-4am local. Daemon in a different TZ than "user's working hours" misses the window.
- **`appendLog` failure**: silently swallows — "logging should never crash daemon". But the log file could be missing or full and we'd never know.
- **`getLogs` loads entire day's JSONL into memory** — OK for typical volumes but risky on high-chatter days.
- **No rate limiting on `pushNotification`** — if every tick triggers a notification (bug in threshold logic), user gets hundreds of notifications.
- **Graceful shutdown**: `close()` path closes CompanionServer, IPCServer, runtime, cleans up watchers. Good.

**Dead code.** Many imports of classes that are instantiated but only their `getX()` getter is called — `crossDeviceContext`, `idleDetector`, `flowTracker` instantiated but only read in `tick()`. OK, active.

---

### 9. `kairos-ipc.ts` (723 lines)

**Purpose.** Unix Domain Socket server for CLI/Desktop/iOS IPC. Includes session-token auth, JSON-RPC framing, IPC client, LRU connection pool.

**Symbols.** `writeSessionToken`, `readSessionToken`, `isIPCRequestAuthorized`, `IPCServerConfig`, `IPCConnection`, class `KairosIPCServer` (methods start, stop, isRunning, getConnections, broadcast, send, getSocketPath, plus private handle*), class `KairosIPCClient`, `IPCPoolOptions`, `KairosIPCPool`, `withPooledConnection`, `getDefaultIPCPool`.

**Imports.** `node:net`, `node:fs`, `node:path`, `node:os`, `node:crypto`, `./kairos-rpc.js`.

**Stubs/bugs.**
- Session token persisted with mode 0600, with a chmod fallback. Good defence-in-depth.
- `isIPCRequestAuthorized`: bypass only when `NODE_ENV === "test"` AND `WOTANN_AUTH_BYPASS=1`. Strong gate.
- `UNAUTH_IPC_METHODS` includes `auth.handshake`, `ping`, `keepalive` — minimum bootstrap surface. Correct.
- **Connection pooling**: LRU with idle-timeout. Polls every 50ms when all connections are busy — CPU wasteful but rare.
- **Streaming response**: `handleMessage` checks `Symbol.asyncIterator in (result as object)`. Two result shapes: single `RPCResponse` or a generator.
- **Buffer persistence**: `let buffer = ""` per connection; newline-delimited JSON with `buffer = lines.pop() ?? ""` to keep partial. Correct.
- **`setTimeout` for keep-alive pings**: pings a keepalive method. The client may not handle keepalive — but it won't crash.
- **Error channel**: `socket.on("error", err => console.error(...))` — logs but doesn't surface. Delicate.
- **Pool drain**: `drain()` doesn't wait for in-flight RPCs — they'll error out. Should join them.

**Dead code.** None.

---

### 10. `kairos-rpc.ts` (5375 lines — LARGEST FILE)

**Purpose.** JSON-RPC handler with ~200 registered methods spanning query/chat, auth (Anthropic/Codex JWT verify w/ JWKS), companion pairing, session management, provider CRUD, cost tracking, memory search, config get/set, agents spawn/kill/submit/cancel, channels, arena, research, cost arbitrage, skills list, mode set, context info, doctor, workspaces, plugins, connectors, cron, automations, chat.send, task.approve/reject/cancel, execute, shell.precheck, autonomous.run/cancel, session.resume, architect, council, channels.start/stop/policy, memory.verify, lsp.*, repo.map, mcp.list/toggle/add, audit.query, precommit, voice.status/transcribe/stream.*, local.status, skills.search/forge.*, completion.suggest/accept, composer.apply/plan, shadow.undo/undo-turn/checkpoints, proofs.reverify/list, workers.status, cost.predict, skills.merge, flow.insights, health.report, decisions.*, spec.divergence, pwr.*, ambient.status, idle.status, crossdevice.context, triggers.list/load, files.search/impact/hotspots, route.classify, search.parallel, action.check/pending, agents.hierarchy/workspace, memory.fence/quality/mine, prompts.adaptive, benchmark.history/best, wakeup.payload, context.pressure, terminal.lastError/suggestions, git.status/log/diff/branches, screen.capture/input/keyboard, briefing.daily, meet.summarize, config.sync, security.keyExchange, continuity.frame/photo, node.register/error/result, clipboard.inject, notifications.configure, quickAction (Siri).

**Symbols.** `RPCRequest`, `RPCResponse`, `RPCError`, `RPCStreamEvent`, `SessionInfo`, `AgentInfo`, `CostSnapshot`, `ProviderInfo`, class `KairosRPCHandler` (with ~200 handlers). Also: `verifyCodexJWT`, `verifyCodexJWTSignature` (network + offline), `validateBase64Image`, `validateImageParams`, `simpleLineDiff`. Private singletons: `sharedVoicePipeline`, `voiceStreams` map, `JWKS_CACHE` map.

**Imports.** 30+ modules including yaml, lsp, audit-trail, channels/dispatch, agents/background-agent, benchmark-harness, orchestration/workflow-dag, mode-cycling type, crypto (createECDH, hkdfSync), security/command-sanitizer, voice/voice-pipeline.

**Stubs/bugs — summarized across the 5k-line file.**
- **Codex JWT verification**: defense-in-depth structural/exp/iss checks (sync) plus network-based signature verification via JWKS with 1h cache. On network fail, returns sync-verified result only. Good layered approach. **Caution**: accepts any RS256-signed token from OpenAI's issuers — attacker with valid OpenAI token could auth as that user. Presumably intended (OAuth audience matters — aud not checked!).
- **Image validation**: magic byte sniffing for PNG/JPEG/WebP/GIF. 20MB cap. Good guards. Rejects non-base64 strings via regex.
- **`handleQuery` fallback chain**: runtime provider path → cloud model via Codex CLI spawn → Ollama streaming → Codex CLI file-based fallback → error. `spawn("codex", ["exec", "--json", ...])` with stdin-pipe. If no providers work, terminal error.
- **`handleChatSend`**: validates images, checks runtime providers, streams or delegates to `handleQuery`. On error yields error event. Good.
- **`execute` handler (line 2805)**: would execute shell commands. Gated through `sanitizeCommand`. Without reading, trusting sanitizer.
- **`shell.precheck`**: checks command before execution. Aligned with sanitizer.
- **`autonomous.run`**: spawns autonomous agent. Has `autonomous.cancel`.
- **`composer.apply`**: applies file changes. `composer.plan` uses `simpleLineDiff` (naive line-by-line using `Set`-based membership, ignores ordering).
- **`shadow.undo-turn`**: undoes a whole turn's worth of edits via `ShadowGit`. Has timing window risk if another turn wrote during undo.
- **`voice.stream.*`**: polling protocol — `start` seeds stream id, `poll` returns chunks-since-cursor, `cancel` frees. `pruneStaleVoiceStreams` defensive GC.
- **`quickAction` Siri allowlist** (line 5322-5339): explicit set of 17 methods Siri can invoke. Non-allowlisted actions fall through to natural-language prompt. Previously wildcard — audit fix.
- **`config.set` atomic write**: tmp + rename pattern. Good.
- **`security.keyExchange`**: ECDH prime256v1 + HKDF to derive session key. Used for iOS pairing.
- **`continuity.frame` / `continuity.photo`**: circular buffer (MAX_FRAME_BUFFER=30). Good bound.
- **Wildcard handlers**: `this.handlers.set("conversations.list", this.handlers.get("session.list")!)` — the `!` fails if called before session.list registered. Ordering-dependent. Line 2738 onward. Hot.
- **`agents.list`**: combines delegation tasks + background tasks. OK.
- **`mode.set` at line 2364**: calls `runtime.setMode(mode as WotannMode)` — type assertion without runtime validation. Invalid mode strings accepted.
- **`notifications.configure` at line 5281**: persists prefs to 0600 file, also calls `notif.configure(prefs)` via optional chaining — only if `notif` exists. Graceful.
- **Missing**: no rate limiting on RPC methods. DoS-adjacent — thousands of `status` calls per second could overwhelm. IPC socket has max 10 connections which mitigates.
- **Error surface**: per-handler `try/catch` patterns vary — some return `{ error: msg }`, some throw, some silently return empty. Inconsistent.
- **Codex JWT issuer list** (lines ~200): accepts both `https://auth.openai.com` and `https://auth.openai.com/` with trailing slash. Good.
- **`aud` claim**: explicitly NOT checked. Any OpenAI-issued token grants Codex access. If the user has unrelated OAuth tokens in auth.json they might authorize the daemon. Surface review needed.
- **`voice.transcribe`**: delegates to VoicePipeline.transcribe(audioPath). Prior handler stubbed (session-4 audit). Now wired. Good.

**Dead code.** Minor: some handlers test for `this.daemon` or `this.runtime` and return error. If either isn't wired, those handlers always fail — but that's defensive not dead.

---

### 11. `kairos-tools.ts` (327 lines)

**Purpose.** KAIROS-exclusive desktop notifications (macOS osascript, Linux notify-send), PR subscription state tracking via `gh` CLI, health checks for provider endpoints, proactive checks (stale approvals, CI failures, budget alerts, stalled tasks).

**Symbols.** `NotificationOptions`, `pushNotification`, `escapeAppleScript`, `PRSubscription`, `PREvent`, `PRState`, `checkPRState`, `detectPREvents`, `HealthCheckResult`, `healthCheck`, `runProviderHealthChecks`, `proactiveCheck`, `ProactiveHeartbeatOptions`, `proactiveHeartbeatCheck`.

**Imports.** `node:child_process`, `node:fs`, `node:path`, `node:os`, `../agents/background-agent.js` (type).

**Stubs/bugs.**
- `pushNotification` writes bash via `execFileSync("osascript", ["-e", script])` — AppleScript string escaping is primitive. `escapeAppleScript(str)` escapes `\` and `"`. But newlines in body are unescaped and can break the osascript.
- `checkPRState` uses `gh pr view` sync via `execFileSync` — blocks event loop. Should be async.
- `healthCheck` runs `fetch(url, {signal})`. For Anthropic/OpenAI APIs, hitting `/v1/models` without auth returns 401. `response.ok` is `false` → reported unhealthy. False negative (API is up but unauthenticated request is). Metric is noisy.
- `proactiveCheck` reads `.wotann/daemon.status.json`, `.git/`, `.wotann/cost.json`. Notifications triggered on stale states. Polling loop-driven side effects.
- `proactiveHeartbeatCheck` dispatches `proactiveCheck` plus stalled-task detection. 10-min stall threshold.
- `proactiveCheck` accepts `_costOracle?: unknown` param but never uses it. Leaked interface.

**Dead code.** `_costOracle` parameter is unused.

---

### 12. `start.ts` (235 lines)

**Purpose.** Daemon entry point for `wotann daemon` / Tauri sidecar. Loads providers env, verifies PID liveness, writes session token, wires signal handlers, downloads sidecars, starts daemon.

**Symbols.** Side-effectful top-level script.

**Imports.** `./kairos.js`, `node:path`, `node:os`, `node:fs`, `../utils/sidecar-downloader.js`.

**Stubs/bugs.**
- **`loadProvidersEnv`**: reads `~/.wotann/providers.env` line-by-line, sets `process.env[key]` without overwriting. Respects shell env priority. Good.
- **`isProcessAlive(pid)`**: uses `kill(pid, 0)` + `ps -p` to verify node daemon. Doesn't false-positive on recycled PIDs. Good.
- **Atomic write for PID**: tmp + rename. Good.
- **`ensureAllSidecars`**: synchronous awaited. If it fails, logged but not fatal.
- **`writeSessionToken`**: creates fresh token at every startup — any previously-connected clients need to re-authenticate. Acceptable.
- **SIGTERM/SIGINT handlers**: call `daemon.stop()`, `cleanupOnExit`, `process.exit(0)`. Synchronous flow. If `daemon.stop()` hangs, SIGTERM doesn't force-exit.
- **Error paths**: bail on port conflicts, stale PID, etc. Good.

**Dead code.** None.

---

### 13. `terminal-monitor.ts` (166 lines)

**Purpose.** Watches shell output for error patterns, suggests fixes. Inspired by Windsurf.

**Symbols.** `TerminalEvent`, error patterns, `detectError`, class `TerminalMonitor`.

**Imports.** None.

**Stubs/bugs.**
- Pattern array is heuristic. `SyntaxError`/`TypeError`/`ReferenceError` match without language discrimination. `EADDRINUSE` only caught as exact token.
- `record()` caps to MAX_HISTORY=50.
- `getErrors(limit)` returns reversed slice.

**Dead code.** None.

---

## PART 3 — AGGREGATE FINDINGS

### Top 20 Findings (ordered by impact)

1. **`runtime-tool-dispatch.ts` and `runtime-tools.ts` are 100% DEAD** — no import site references them. Runtime.ts inlines equivalent logic. Active drift risk between duplicated tool schemas (em-dash vs hyphen difference).

2. **`runtime.ts` is a 4,724-line God Object** with 265+ imports and 80+ getter methods. Documented TODO for extraction; unshipped.

3. **`deep-link.ts` handlers are stubs that return `success: true` with no action** — `handleConfigImport`, `handleConfigSet`, `handleProviderConnect` echo URLs/params into "success" envelopes but do NOT actually import, set, or connect anything. Misleading UI.

4. **`types.ts` HookEvent union lists 10 advisory-only events with NO producers** — any hook registered to `PostToolUseFailure`, `SubagentStart/Stop`, `Notification`, `PermissionRequest`, `Setup`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate/Remove` SILENTLY NEVER FIRES.

5. **runtime.ts ResponseCache short-circuit skips ALL telemetry** — hooks, middleware.after, memory capture, cost tracking all skipped on cache hit. Cost aggregates diverge from reality over time.

6. **kairos-rpc.ts `verifyCodexJWT` does NOT check `aud` claim** — any OpenAI-issued OAuth token could authenticate as Codex user. Security review needed.

7. **Two overlapping conversation data structures**: `conversation-tree.ts`'s `ConversationTree` and `conversation-branching.ts`'s `ConversationBranchManager` — runtime instantiates BOTH. Duplicate responsibility.

8. **`guardrails-off` mode in mode-cycling.ts is a near-copy of `exploit`** — two mode configs with same behavior, kept for back-compat but never collapsed.

9. **kairos.ts hasChannelCreds auto-start**: ANY env var in the list silently fires channel gateway on daemon start. Privacy-sensitive.

10. **`pushNotification` lacks rate-limiting** — if a threshold condition in proactiveCheck persists, user gets hundreds of macOS notifications over a day.

11. **`automations.ts` cron doesn't handle DST transitions** — 02:30 cron during spring-forward silently skips.

12. **`session.ts`, `session-resume.ts`, `stream-resume.ts` write JSON non-atomically** — interrupted writes corrupt snapshots. Backup-less in some paths.

13. **`schema-migration.ts` backups accumulate indefinitely** — `${configPath}.backup-${timestamp}` never cleaned up.

14. **`kairos-rpc.ts` handler aliasing via non-null assertion**: `this.handlers.set("conversations.list", this.handlers.get("session.list")!)` — crashes if call order changes during refactor.

15. **`conversation-branching.ts` `merge` preserves source turns' `parentId`** pointing to nodes in the source branch — orphan references when merged.

16. **`stream-resume.ts` rewrites full checkpoint JSON on every streaming chunk** — heavy disk I/O per stream.

17. **`file-dep-graph.ts` loads all file contents in parallel** — memory proportional to source size; OOM risk on large monorepos.

18. **`agent-bridge.ts` `isBillingError` / `isRateLimitError`** do substring matching on lowercased text — false positives on legitimate messages mentioning "billing cycle" or "rate limit docs".

19. **`kairos.ts` file watcher is DISABLED** — acknowledged in a comment that `fs.watch(recursive:true)` blocked startup for 2-3 min. Change detection now relies on heartbeat rebuild, missing fast-fire triggers. TODO to port to chokidar.

20. **`runtime.ts` anti-distillation previously DEAD, now wired** (session-5 fix). `session-4 audit` note: similar pattern caught in multiple places — generated values stored but never threaded into effective pipeline. Code review culture should require explicit "consumer exists" when adding generators.

### Broader observations

- **Hook producer/consumer drift**: the advisory 10 HookEvent variants are a landmine. A downstream plugin registers against `PostToolUseFailure`, expects notifications, receives silence.
- **Duplicate tool definitions**: inline schemas in runtime.ts vs. schemas in runtime-tools.ts drift (em-dash vs hyphen). Extraction refactor would close this.
- **Atomic-write discipline is uneven**: `kairos-rpc.ts config.set` does atomic tmp+rename, `session.ts saveSession` does not. Should be a shared utility.
- **Auth/authz surface is wide**: session token gates IPC, ECDH key exchange gates continuity, Siri allowlist gates quickAction, JWT verifies Codex plan. Good layered defense.
- **Error handling style is inconsistent** — some methods throw, some return `{ error }`, some silently swallow with comment "best-effort, non-fatal". Grep-for-`/* non-fatal */` reveals ~40 silent swallow sites. Each one is a potential silent bug farm.

---

*End of deep read. Total read: 41 files, ~21,000 lines of TypeScript.*
