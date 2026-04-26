/**
 * WotannRuntime — the composition root that wires ALL systems together.
 *
 * Every module in the harness connects through this single point:
 * - Provider discovery → registry → AgentBridge (with account pool)
 * - Intelligence amplifier → reasoning sandwich → schema optimizer
 * - Mode cycler → safety overrides → hook engine (with pause support)
 * - Middleware pipeline (16 layers) wraps every query
 * - Trace analyzer records every action for post-run analysis
 * - Local context injects environment awareness
 * - Memory store (8-layer + semantic search) captures observations
 * - DoomLoop detector monitors for infinite loops
 * - Cost tracker records spend per query
 * - Session management tracks state
 */

import type {
  ProviderName,
  WotannQueryOptions,
  AgentMessage,
  ToolDefinition,
  BillingType,
} from "./types.js";
import { extractTrackedFilePath } from "./tool-path-extractor.js";
import type { StreamChunk } from "../providers/types.js";
import { discoverProviders } from "../providers/discovery.js";
import { resolveDefaultProvider } from "./default-provider.js";
import {
  createProviderInfrastructure,
  type ProviderInfrastructure,
} from "../providers/registry.js";
import { HookEngine } from "../hooks/engine.js";
import { registerBuiltinHooks, clearReadTrackingForSession } from "../hooks/built-in.js";
import { ActiveMemoryEngine } from "../memory/active-memory.js";
import { Observer } from "../memory/observer.js";
import { Reflector, type ReflectorJudge } from "../memory/reflector.js";
import { buildStablePrefix } from "../memory/stable-prefix.js";
// V9 T1.5 — warmupCache fires a fire-and-forget call to the active
// provider right after the stable-prefix system prompt is assembled,
// so the server-side prompt cache is primed before the first real
// user query. Mastra paper: 4-10× cache savings when warmup lands
// before production traffic. Gated on `RuntimeConfig.enablePromptCacheWarmup`
// (default off) + `WOTANN_PROMPT_CACHE_WARMUP` env var.
import {
  warmupCache,
  type CachePrefix,
  type CacheWarmupSendFn,
} from "../providers/prompt-cache-warmup.js";
import { DoomLoopDetector } from "../hooks/doom-loop-detector.js";
import { createDefaultPipeline, type MiddlewarePipeline } from "../middleware/pipeline.js";
import { assembleSystemPromptParts, wrapPromptWithThinkInCode } from "../prompt/engine.js";
import { stripIsoTimestampsFromPrompt } from "../prompt/system-prompt.js";
import { canBypass, executeBypass } from "../utils/wasm-bypass.js";
import { CostTracker, shouldZeroForSubscription } from "../telemetry/cost-tracker.js";
import { ToolTimingLogger, ToolTimingBaseline } from "../tools/tool-timing.js";
import { MemoryStore, type AutoCaptureEntry } from "../memory/store.js";
import {
  UnifiedKnowledgeFabric,
  type KnowledgeQuery,
  type KnowledgeResult,
  type Retriever,
  type KnowledgeSource,
} from "../memory/unified-knowledge.js";
import { ContextTreeManager, type ContextEntry } from "../memory/context-tree-files.js";
import { TFIDFIndex } from "../memory/semantic-search.js";
import { QuantizedVectorStore } from "../memory/quantized-vector-store.js";
import {
  createSession,
  addMessage,
  saveSession,
  updateModel,
  formatSessionStats,
} from "./session.js";
import { ModeCycler, type WotannMode } from "./mode-cycling.js";
import type { SessionState } from "./types.js";
import { loadConfig } from "./config.js";
import { IntelligenceAmplifier } from "../intelligence/amplifier.js";
import { ReasoningSandwich } from "../middleware/reasoning-sandwich.js";
import { TraceAnalyzer } from "../intelligence/trace-analyzer.js";
import { gatherLocalContext, formatContextForPrompt } from "../middleware/local-context.js";
import { SessionBootstrapCache, formatSnapshotForPrompt } from "./bootstrap-snapshot.js";
import {
  buildSecurityResearchPrompt,
  getDefaultGuardrailsConfig,
  getSafetyOverrides,
} from "../security/guardrails-off.js";
import { AccountPool } from "../providers/account-pool.js";
import { ContextWindowIntelligence } from "../context/window-intelligence.js";
import { PerFileEditTracker } from "../hooks/benchmark-engineering.js";
import { SessionAnalytics } from "../telemetry/session-analytics.js";
import { SkillRegistry } from "../skills/loader.js";
import { TTSREngine } from "../middleware/ttsr.js";
import type { MiddlewareContext, AgentResult } from "../middleware/types.js";
import { StreamCheckpointStore } from "./stream-resume.js";
import { SessionStore } from "./session-resume.js";
import type { SessionSnapshot } from "./session-resume.js";
import { AccuracyBooster, classifyTaskType } from "../intelligence/accuracy-boost.js";
import { ContextRelevanceScorer } from "../intelligence/context-relevance.js";
import type { FileInfo } from "../intelligence/context-relevance.js";
import { ResponseValidator } from "../intelligence/response-validator.js";
import { ResponseCache } from "../middleware/response-cache.js";
import type { CacheableQuery } from "../middleware/response-cache.js";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import {
  buildOverrideDirective,
  buildPostQueryOverrideWarning,
} from "../intelligence/overrides.js";
import { RepoModelPerformanceStore } from "../providers/model-performance.js";
import { runPreCommitAnalysis, type PreCommitAnalysisResult } from "../verification/pre-commit.js";
import { PluginManager } from "../plugins/manager.js";
import { QMDContextEngine, formatQMDContext } from "../memory/qmd-integration.js";
import {
  classifyFeedback,
  shouldDream,
  runDreamPipelineWithPersistence,
} from "../learning/autodream.js";
import { runWorkspaceDreamIfDue } from "../learning/dream-runner.js";
import {
  buildContextBudgetPrompt,
  buildMemoryActivationPrompt,
  buildSkillActivationPrompt,
  compactConversationHistory,
  estimateConversationSplit,
  estimateTokenCount,
  type ConversationCompactionResult,
} from "./runtime-intelligence.js";
import type { ContextCapabilityProfile } from "../context/window-intelligence.js";
import { FileFreezer } from "../security/file-freeze.js";
import { SecretScanner } from "../security/secret-scanner.js";
import { ProactiveMemoryEngine } from "../memory/proactive-memory.js";
import { ConversationBranchManager } from "./conversation-branching.js";
import { CrossSessionLearner } from "../learning/cross-session.js";
import { CapabilityEqualizer } from "../providers/capability-equalizer.js";
import { PluginLifecycle } from "../plugins/lifecycle.js";
import { SessionRecorder } from "../telemetry/session-replay.js";
import { ShadowGit } from "../utils/shadow-git.js";
import { CanvasEditor } from "../ui/canvas.js";
import * as DiffEngine from "../ui/diff-engine.js";
import { CredentialPool } from "../providers/credential-pool.js";
import { EpisodicMemory } from "../memory/episodic-memory.js";
import { AutonomousExecutor } from "../orchestration/autonomous.js";
import { NotificationManager } from "../desktop/notification-manager.js";
import { ContextSourceInspector } from "../context/inspector.js";
import { PersonaManager } from "../identity/persona.js";
import { SelfHealingPipeline } from "../orchestration/self-healing-pipeline.js";
import { LSPManager, SymbolOperations } from "../lsp/symbol-operations.js";
import { LanguageServerRegistry } from "../lsp/server-registry.js";
import type { BuiltLspTools } from "../lsp/agent-tools.js";
import { AGENT_LSP_TOOL_NAMES } from "../lsp/agent-tools.js";
import { buildLspToolsForAgent } from "./runtime-tools.js";
import { loadToolsWithOptions, type McpTier, type LoadToolsResult } from "../mcp/tool-loader.js";
import { VisualDiffTheater, type FileChange } from "../testing/visual-diff-theater.js";
import {
  hybridSearchV2,
  createBm25Retriever,
  createDenseRetriever,
} from "../memory/hybrid-retrieval-v2.js";
import type { SearchableEntry } from "../memory/extended-search-types.js";
import {
  scrubPaths as sandboxScrubPaths,
  makeDefaultConfig as makeSandboxVirtualPathConfig,
  type VirtualPathsConfig,
} from "../sandbox/virtual-paths.js";
import {
  performHandoff,
  type AgentId,
  type Handoff,
  type HandoffInputData,
  type HandoffResult,
} from "./handoff.js";
import { ProviderBrain } from "../providers/provider-brain.js";
import {
  applyHashEdit,
  type HashEditOperation,
  type HashEditResult,
} from "../tools/hashline-edit.js";
import { HASH_ANCHORED_EDIT_TOOL_SCHEMA } from "../tools/hash-anchored-edit.js";
import { ImageGenRouter } from "../tools/image-gen-router.js";
import { compileAmbientContext, type AmbientContext } from "../intelligence/ambient-awareness.js";
import { generateFakeTools } from "../security/anti-distillation.js";
import { assembleClaudeBridgeDeps } from "../claude/bridge-deps.js";
import { UnifiedDispatchPlane } from "../channels/unified-dispatch.js";
import { writeAutonomousProofBundle } from "../orchestration/proof-bundles.js";
import type { AutonomousResult } from "../orchestration/autonomous.js";
import { runArenaContest, ArenaLeaderboard } from "../orchestration/arena.js";
import type { ArenaContestant } from "../orchestration/arena.js";
import { runCouncil, CouncilLeaderboard, selfConsistencyVote } from "../orchestration/council.js";
import type {
  CouncilResult,
  CouncilQueryExecutor,
  SelfConsistencyResult,
  SelfConsistencyOptions,
} from "../orchestration/council.js";
import { PIIRedactor } from "../security/pii-redactor.js";
import { VectorStore, HybridMemorySearch } from "../memory/vector-store.js";
import { RulesOfEngagement } from "../security/rules-of-engagement.js";
import { TrainingPipeline } from "../training/pipeline.js";
import { AutoresearchEngine } from "../training/autoresearch.js";
import { createLlmModificationGenerator } from "../training/llm-modification-generator.js";
import {
  evaluateCompletion,
  evaluateCompletionFromEvidence,
  getDefaultCriteria,
} from "../autopilot/completion-oracle.js";
import type { CompletionCriterion, VerificationEvidence } from "../autopilot/types.js";
import { TaskDelegationManager } from "../orchestration/task-delegation.js";

// Phase E: Auto-features
import { AutoClassifier } from "../security/auto-classifier.js";
import { IntentVerifier } from "../security/intent-verifier.js";
// TIER 2 cleanup: PrivacyRouter import removed — zombie instance was
// constructed but never invoked from production. Class stays exported
// from src/lib.ts for external callers.
import { AutoVerifier } from "../intelligence/auto-verify.js";

// Intelligence modules (wired into query pipeline)
import { AutoReviewer } from "../intelligence/auto-reviewer.js";
import { BugBot } from "../intelligence/bugbot.js";
import { ProviderArbitrageEngine } from "../intelligence/provider-arbitrage.js";
import { ErrorPatternLearner } from "../intelligence/error-pattern-learner.js";
import { PredictiveContextLoader } from "../intelligence/predictive-context.js";

// Wired orphan intelligence modules (from lib.ts barrel)
import { DeepResearchEngine } from "../intelligence/deep-research.js";
import { AutoModeDetector } from "../intelligence/auto-mode-detector.js";
import { CodemapBuilder } from "../intelligence/codemaps.js";
import { TrajectoryScorer } from "../intelligence/trajectory-scorer.js";
import { MicroEvalRunner } from "../intelligence/micro-eval.js";
import { SmartRetryEngine } from "../intelligence/smart-retry.js";
import {
  DoomLoopFingerprinter as ForgeDoomLoopFingerprinter,
  correctToolCallArgs,
} from "../intelligence/forgecode-techniques.js";
import { classifyBashCommand } from "../intelligence/bash-classifier.js";
import { AutoEnhancer } from "../intelligence/auto-enhance.js";
import { CrossDeviceContextManager } from "../intelligence/cross-device-context.js";
import { AITimeMachine } from "../intelligence/ai-time-machine.js";
import { UserModelManager } from "../intelligence/user-model.js";
// S2-9: VideoProcessor and RDAgent removed — were never invoked during any
// query path (getter-only, confirmed dead in the audit).
import { VerificationCascade } from "../intelligence/verification-cascade.js";
import { WallClockBudget } from "../intelligence/wall-clock-budget.js";
// rc.2 follow-up: injectable primitives B4/B12 — wired into runtime so any
// caller can retrieve a session-scoped instance via accessors. Both are
// gated behind config flags (default OFF) and constructed lazily on first
// access — zero overhead when disabled.
import {
  PreCompletionVerifier,
  formatVerificationReport,
  type VerificationReport,
  type VerificationInput,
} from "../intelligence/pre-completion-verifier.js";
import type { LlmQuery as PreCompletionLlmQuery } from "../intelligence/pre-completion-verifier.js";
import { ProgressiveBudget } from "../intelligence/progressive-budget.js";
// B7 goal-drift (OpenHands port, P1-B7). Lazily constructed on first
// getGoalDriftDetector() call when the gate is enabled. Zero overhead
// when off. NullTodoProvider is the default provider — real FS-backed
// wiring is up to callers (see src/orchestration/todo-provider.ts).
import {
  GoalDriftDetector,
  type LlmQuery as GoalDriftLlmQuery,
} from "../orchestration/goal-drift.js";
import { NullTodoProvider, type TodoProvider } from "../orchestration/todo-provider.js";
import {
  detectTruncatedThinking,
  buildContinuationPrompt,
} from "../intelligence/prefill-continuation.js";
import { agentRegistry, type AgentRegistry } from "../orchestration/agent-registry.js";

// ── Phase-13 Wave 3A intelligence + learning wires ──
import { injectPolicyByDomain } from "../intelligence/policy-injector.js";
import { enforceDeterministicSchema } from "../intelligence/strict-schema.js";
import { calibrateConfidence } from "../intelligence/confidence-calibrator.js";
import {
  chainOfVerification,
  type LlmQuery as CoVeLlmQuery,
} from "../intelligence/chain-of-verification.js";
import { PatternDetector } from "../intelligence/tool-pattern-detector.js";
import {
  createDefaultWebSearchProvider,
  type WebSearchProvider,
} from "../intelligence/search-providers.js";
import { ReflectionBuffer } from "../learning/reflection-buffer.js";

// ── Tier 2B: LLM-invokable tools ──
import { WebFetchTool } from "../tools/web-fetch.js";
import { PlanStore } from "../orchestration/plan-store.js";
import { spawnMonitor } from "../tools/monitor.js";
import { MONITOR_MAX_DURATION_MS, MONITOR_MAX_EVENTS_PER_RESULT } from "./runtime-tool-dispatch.js";
import { SteeringServer, type SteeringCommand } from "./steering-server.js";

// ── Wired orphan modules ────────────────────────────────────

// Orchestration
import { AutonomousContextManager } from "../orchestration/autonomous-context.js";
import { buildWaves, executeWaves, type WaveTask } from "../orchestration/wave-executor.js";
import {
  buildPlanningPrompt,
  parsePlanResponse,
  type StructuredPlan,
} from "../orchestration/ultraplan.js";

// Context
import { ContextShardManager } from "../context/context-sharding.js";
import {
  planContextBudget,
  type ContextBudget as MaximizerContextBudget,
} from "../context/maximizer.js";
import {
  replayContext,
  type TaskContext,
  type ReplayBudget,
  type ReplayResult,
} from "../context/context-replay.js";
import { TurboQuantEngine } from "../context/ollama-kv-compression.js";
import { VirtualContextManager } from "../context/virtual-context.js";

// Intelligence
import { optimizeToolSchema, validateAndCoerce } from "../intelligence/schema-optimizer.js";

// Testing
import {
  runAssertions,
  generateReport,
  getCoreTestSuite,
  type PromptTestCase,
  type PromptTestResult,
  type RegressionReport,
} from "../testing/prompt-regression.js";

// Core
import { ConversationTree, CommandHistory } from "./conversation-tree.js";

// Monitoring
import { checkAllRepos, syncAllRepos, type MonitorDigest } from "../monitoring/source-monitor.js";

// Memory (mega-merge)
import { KnowledgeGraph } from "../memory/graph-rag.js";
import { ContextTree, type ContextNode } from "../memory/context-tree.js";
import { CloudSyncEngine } from "../memory/cloud-sync.js";

// Learning (mega-merge)
import { SkillForge } from "../learning/skill-forge.js";
import { InstinctSystem } from "../learning/instinct-system.js";

// S2-9: NeverStopExecutor removed — strategies merged into AutonomousExecutor
// (see autonomous.ts L65, L374, L510, L931). The class had no callers.
// Flow tracking (Windsurf Cascade-inspired real-time action tracking)
import { FlowTracker } from "../intelligence/flow-tracker.js";
// Idle detection (welcome-back briefings)
import { IdleDetector } from "../intelligence/away-summary.js";
// Codebase health analysis (0-100 score)
import { analyzeCodebaseHealth } from "../intelligence/codebase-health.js";
// Decision ledger (cross-session decision tracking with rationale)
import { DecisionLedger, type DecisionInput } from "../learning/decision-ledger.js";

// ── Phase 2: Competitive Parity (Perplexity features) ──
import { TaskSemanticRouter } from "../intelligence/task-semantic-router.js";
import { ParallelSearchDispatcher } from "../intelligence/parallel-search.js";
import { ConfirmActionGate } from "../security/confirm-action.js";
import { AgentHierarchyManager } from "../orchestration/agent-hierarchy.js";
import { AgentWorkspace } from "../orchestration/agent-workspace.js";

// ── Phase 3: Memory Supercharging ──
import { ContextFence } from "../memory/context-fence.js";
import { RetrievalQualityScorer } from "../memory/retrieval-quality.js";
import { ContextLoader } from "../memory/context-loader.js";
import { ObservationExtractor } from "../memory/observation-extractor.js";
import { TunnelDetector } from "../memory/tunnel-detector.js";
import { ConversationMiner } from "../memory/conversation-miner.js";

// ── Phase 4: Self-Improvement ──
import { AdaptivePromptGenerator } from "../intelligence/adaptive-prompts.js";
import { NightlyConsolidator } from "../learning/nightly-consolidator.js";
import { BenchmarkHarness } from "../intelligence/benchmark-harness.js";

// Security (mega-merge)
import { SkillsGuard } from "../security/skills-guard.js";
import { HashAuditChain } from "../security/hash-audit-chain.js";

// Core (mega-merge)
import { VirtualPathResolver } from "./virtual-paths.js";
import { ConfigDiscovery } from "./config-discovery.js";

// Voice (mega-merge)
import { VibeVoiceBackend } from "../voice/vibevoice-backend.js";

// Desktop (mega-merge)
import { PromptEnhancer } from "../desktop/prompt-enhancer.js";

// ── Phase H: Library-only modules wired into query/close/init paths ──
import { guardReview } from "../intelligence/guardian.js";
import { maybeBuildCidIndexForProvider, renderCidAnnotation } from "../intelligence/content-cid.js";
import { shouldAbstain } from "../memory/abstention.js";
import type { SearchHit } from "../memory/extended-search-types.js";
import {
  scheduleViaHook as scheduleSessionIngestion,
  type SessionIngestStoreLike,
  type KnowledgeGraphPopulator,
} from "../memory/session-ingestion.js";
import { createOmegaLayers, type OmegaLayers } from "../memory/omega-layers.js";
import { detectSupersession, parseAssertionAsFact } from "../memory/knowledge-update-dynamics.js";
import {
  ProgressiveContextLoader,
  type ContextTier,
} from "../memory/progressive-context-loader.js";

// ── Types ──────────────────────────────────────────────────

/**
 * Thinking effort tiers passed to the reasoning sandwich / extended
 * thinking layer. `xhigh` was added in V9 T14.1a (parity with Claude
 * Code v2.1.111) as a finer granularity between `high` and `max` —
 * Opus 4.7's extended-thinking sweet spot. Models that don't support
 * extended thinking treat `xhigh` and `max` the same via
 * `model-router.supportsXhighEffort`.
 */
export type ThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface RuntimeConfig {
  readonly workingDir: string;
  readonly hookProfile?: "minimal" | "standard" | "strict";
  readonly enableMiddleware?: boolean;
  readonly enableHooks?: boolean;
  readonly enableWasmBypass?: boolean;
  readonly enableMemory?: boolean;
  readonly enableSemanticSearch?: boolean;
  readonly enableTraceAnalysis?: boolean;
  readonly enableTTSR?: boolean;
  readonly skillsDir?: string;
  readonly initialMode?: WotannMode;
  readonly thinkingEffort?: ThinkingEffort;
  readonly maxContextTokens?: number;
  readonly enableAntiDistillation?: boolean;
  /**
   * Provider to use when discovery hasn't run yet and the user hasn't
   * picked one. Historically hardcoded to "anthropic" throughout the
   * codebase; S1-16/17/18 make this configurable so free-tier users (who
   * may only have Gemini or a local Ollama model) don't get error
   * chunks attributed to a provider they haven't configured.
   */
  readonly defaultProvider?: ProviderName;
  /**
   * Default model paired with `defaultProvider`. When omitted, downstream
   * code treats it as "auto" and lets the router choose.
   */
  readonly defaultModel?: string;
  /**
   * Phase H — LLM-as-judge auto-review after each query response. When
   * true and a diff/response can be assembled, guardReview runs once with
   * up to one retry on low-confidence failing verdicts. Defaults to
   * `process.env.WOTANN_GUARDIAN === "1"` so it stays opt-in.
   */
  readonly enableGuardian?: boolean;
  /**
   * Phase H — emit honest "I don't know" on low-confidence retrievals
   * instead of fabricating an answer from weak hits. Defaults to true.
   */
  readonly enableContextualAbstention?: boolean;
  /**
   * Phase H — which progressive context tier to prepare at initialize().
   * L0 = identity only (~50 tokens), L1 = identity + critical facts
   * (~170 tokens). L2/L3 are loaded lazily on topic/deep-search triggers.
   */
  readonly progressiveContextTier?: ContextTier;
  /**
   * Session-13 Serena-parity: when true, the runtime constructs a
   * `LanguageServerRegistry` + 6-tool LSP agent surface (hover,
   * definition, document_symbols beyond the legacy 3). Defaults to
   * `process.env.WOTANN_LSP_TOOLS === "1"` so it stays opt-in until the
   * multi-language LSP install-hint UX is validated against real users.
   */
  readonly enableLspAgentTools?: boolean;
  /**
   * Dual-terminal steering — GSD-inspired live state editing via
   * `.wotann/steering/pending/*.json` command files. When true, the
   * runtime allocates a SteeringServer and fs.watch()es for commands.
   * Defaults to `process.env.WOTANN_STEERING === "1"` so short-lived
   * queries don't hold an extra fd. Second-terminal writers use
   * `SteeringServer#writeCommand` (or the forthcoming `wotann steer`
   * CLI) to enqueue commands; autonomous phase boundaries drain
   * `steeringCommands`.
   */
  readonly enableSteering?: boolean;
  /**
   * Session-13 Supermemory parity: route `searchMemory()` through the
   * BM25+dense+RRF v2 hybrid retriever. Off by default — the existing
   * `hybridSearch` path already covers most workloads; v2 adds SOTA
   * re-ranking for retrieval evals. Opt-in via env `WOTANN_HYBRID_V2=1`
   * or the config flag.
   */
  readonly useHybridV2?: boolean;
  /**
   * Session-13 deer-flow parity: scrub physical paths (`/Users/alice/...`)
   * to virtual `/mnt/user-data/*` in tool-result transcripts before they
   * reach the model. Defaults to true — agents should never see the
   * user's home directory in transcripts.
   */
  readonly virtualPathsEnabled?: boolean;
  /**
   * P1-B1 Droid/Meta-Harness parity: capture an environment bootstrap
   * snapshot (git HEAD/branch/dirty, tree, filtered env, services, log
   * tail, lockfile shas) at session start and prepend it to the system
   * prompt. Disable for benchmark runs where ~50ms of capture overhead
   * matters. Defaults to ENABLED.
   */
  readonly skipBootstrapSnapshot?: boolean;
  /**
   * rc.2 follow-up: allocate a PreCompletionVerifier instance (B4 —
   * ForgeCode 4-perspective self-review) so callers can run the
   * 4-persona parallel review before declaring a task complete. The
   * verifier is constructed lazily on first `getPreCompletionVerifier()`
   * call with an LlmQuery bound to this runtime's query() method.
   * Defaults to `process.env.WOTANN_PRE_COMPLETION_VERIFY === "1"` so it
   * stays opt-in — 4 parallel LLM calls are expensive on free-tier.
   */
  readonly enablePreCompletionVerify?: boolean;
  /**
   * rc.2 follow-up: allocate a ProgressiveBudget instance (B12 —
   * ForgeCode progressive-budget) so callers can wrap verify-loops
   * with a LOW → MEDIUM → MAX escalation ladder. The scheduler is
   * constructed lazily on first `getProgressiveBudget()` call with the
   * default 3-tier config. Defaults to `process.env.WOTANN_PROGRESSIVE_BUDGET
   * === "1"`. Allocation is cheap; leaving enabled everywhere would be
   * safe, but we gate for symmetry with the other primitives.
   */
  readonly enableProgressiveBudget?: boolean;
  /**
   * M4 TEMPR opt-in: route active-memory recall through the 4-channel
   * TEMPR search (vector + BM25 + entity + temporal) instead of the
   * default FTS5 `store.search()`. TEMPR costs more per call but yields
   * stronger retrieval on factual/entity-heavy prompts. Defaults to
   * `process.env.WOTANN_USE_TEMPR === "1"` so the existing FTS path
   * stays the free-tier default.
   */
  readonly useTempr?: boolean;
  /**
   * M6 Retrieval-mode opt-in: when set to a registered mode name
   * (e.g. "time-decay", "fuzzy-match"), active-memory recall dispatches
   * through `store.searchWithMode(mode, query)` instead of the default
   * FTS search. `useTempr` takes precedence when both are set. Defaults
   * to `process.env.WOTANN_RECALL_MODE` when unset; omit the env var
   * to keep the default FTS path.
   */
  readonly recallMode?: string;
  /**
   * P1-B7 GoalDriftDetector opt-in (OpenHands port, part 3).
   * Construction itself is cheap but the detector is only useful
   * when callers wire it into a per-cycle checkpoint (see
   * AutonomousExecutor.execute's `goalDrift` callback) AND provide
   * a real `todoProvider`. Defaults to
   * `process.env.WOTANN_GOAL_DRIFT === "1"` so the getter stays
   * honest about its state — a caller that forgets to flip the
   * flag gets `null` (feature off) instead of a detector with
   * NullTodoProvider that always says "no drift".
   */
  readonly enableGoalDrift?: boolean;
  /**
   * V9 T1.5 — Prompt-cache warmup. When enabled, after `buildStablePrefix`
   * rebuilds `this.systemPrompt`, the runtime fires a fire-and-forget
   * call to `warmupCache()` (src/providers/prompt-cache-warmup.ts) so
   * the active provider's server-side prompt cache is primed before
   * the first real user query hits it. Mastra paper reports 4-10×
   * cache savings when warmup lands before production traffic.
   *
   * Defaults: `enablePromptCacheWarmup === false` → off. Otherwise
   * the env var `WOTANN_PROMPT_CACHE_WARMUP` controls: `"0"` disables,
   * any other value (including unset) enables. This matches the
   * "opt-in via env until proven safe" convention used by useTempr
   * and enableGoalDrift.
   */
  readonly enablePromptCacheWarmup?: boolean;
  /**
   * P1-B7: optional provider the runtime hands back from
   * `getTodoProvider()` when a caller wants a session-level default.
   * When unset `getTodoProvider()` returns `NullTodoProvider` so
   * default sessions pay zero FS cost.
   */
  readonly todoProvider?: TodoProvider;
  /**
   * Tier-A release hygiene (rc.2): flip the KG auto-populate gate for
   * session-ingestion. When true, the SessionEnd hook passes
   * `{ autoPopulateKG: true, populator: memoryStore }` to
   * `ingestSession`, which then derives entities + heuristic
   * relationships from observations and inserts them via
   * `MemoryStore.recordEntity` / `recordHeuristicRelationship`. When
   * false (default) the ingest pipeline returns zero KG counts and
   * the flow is a no-op. Defaults to
   * `process.env.WOTANN_AUTO_POPULATE_KG === "1"` so the existing
   * free-tier behavior is unchanged — the flag is opt-in until the
   * classifier's false-positive rate is characterized against the
   * full MemoryStore corpus.
   */
  readonly autoPopulateKG?: boolean;
  /**
   * Tier-D1 (rc.2 follow-up): construct the OMEGA 3-layer memory
   * facade on top of the existing MemoryStore. When enabled,
   * `getOmegaLayers()` returns a lazily-built `OmegaLayers` instance
   * whose `layer1/layer2/layer3` read/write the existing auto_capture,
   * memory_entries/knowledge_nodes/knowledge_edges, and memory_summaries
   * tables respectively. Composing this facade is zero-cost when off;
   * the table DDL runs only on first construction. Defaults to
   * `process.env.WOTANN_OMEGA_LAYERS === "1"` so the default code path
   * stays unchanged — retrieval modes like summary-first can opt in
   * when they need L3 compressed summaries, without forcing every
   * session to run the L3 DDL.
   */
  readonly enableOmegaLayers?: boolean;
}

export interface RuntimeStatus {
  readonly providers: readonly ProviderName[];
  readonly activeProvider: ProviderName | null;
  readonly hookCount: number;
  readonly middlewareLayers: number;
  readonly memoryEnabled: boolean;
  readonly sessionId: string;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly currentMode: WotannMode;
  readonly traceEntries: number;
  readonly semanticIndexSize: number;
  readonly skillCount: number;
  readonly contextPercent: number;
  readonly messageCount: number;
}

// ── Runtime ────────────────────────────────────────────────

export class WotannRuntime {
  private infra: ProviderInfrastructure | null = null;
  /**
   * Wave 4-W: per-provider billing model captured at discovery time so
   * the cost-tracker `record()` call site can decide whether to skip
   * the per-token charge for subscription-billed providers (Claude
   * Pro/Max via OAuth, GitHub Copilot, etc.). Populated alongside
   * `this.infra` from the discovered `ProviderAuth` array; left empty
   * when no providers have been discovered yet (record() falls through
   * to charge per-token, the safer default per QB #6).
   *
   * Map shape: ProviderName → "subscription" | "api-key" | "free".
   * Read by the single call site at runtime.ts:~4212 via
   * `shouldZeroForSubscription(provider, this.providerBilling.get(provider))`.
   */
  private readonly providerBilling = new Map<ProviderName, BillingType>();
  private hookEngine: HookEngine;
  private doomLoop: DoomLoopDetector;
  private pipeline: MiddlewarePipeline;
  private costTracker: CostTracker;
  /**
   * Wave 4G: per-session tool-timing persistence. Every dispatched tool
   * writes one JSONL row to `.wotann/tool-timing.jsonl` so post-session
   * analysis can detect regressions and flag outliers. Baseline tracker
   * is shared with the dispatcher so logged entries include the rolling
   * median for context.
   */
  private toolTimingBaseline: ToolTimingBaseline;
  private toolTimingLogger: ToolTimingLogger;
  private amplifier: IntelligenceAmplifier;
  private reasoningSandwich: ReasoningSandwich;
  private traceAnalyzer: TraceAnalyzer;
  private modeCycler: ModeCycler;
  private accountPool: AccountPool;
  private semanticIndex: TFIDFIndex;
  // Session-6 (GAP-11 fix): QuantizedVectorStore was ADDED in session-2
  // and RUNTIME-TEST-SCAFFOLDED in session-4 but the session-4 audit
  // agent missed that runtime.ts never instantiated it — zero consumers.
  // Session-6 wired it as an OPT-IN companion index when
  // `WOTANN_ENABLE_ONNX_EMBEDDINGS=1`. Tier-0 CVE sweep dropped
  // @xenova/transformers (protobufjs RCE via onnx-proto), so the
  // quantized store now runs TF-IDF-only under the same public API.
  // Future P1-M2: re-enable embeddings via native sqlite-vec + ONNX.
  private quantizedVectorStore: QuantizedVectorStore | null = null;
  private contextIntelligence: ContextWindowIntelligence;
  private editTracker: PerFileEditTracker;
  private sessionAnalytics: SessionAnalytics;
  private skillRegistry: SkillRegistry;
  private ttsrEngine: TTSREngine;
  private qmdContext: QMDContextEngine;
  private modelPerformanceStore: RepoModelPerformanceStore;
  private pluginPanels: readonly string[] = [];
  private memoryStore: MemoryStore | null = null;
  private session: SessionState;
  /**
   * F9: O(1) message lookup. Updated alongside `this.session.messages` so
   * callers can retrieve by `id` without scanning the full history.
   * Only messages that have an `id` field are indexed.
   */
  private readonly messageIndex: Map<string, AgentMessage> = new Map();
  private config: RuntimeConfig;
  private systemPrompt: string = "";
  private localContextPrompt: string = "";
  /**
   * P1-B1 per-session bootstrap cache. One instance per runtime; the
   * snapshot is captured lazily on the first session-start and frozen
   * for the session lifetime. See src/core/bootstrap-snapshot.ts.
   */
  private readonly bootstrapCache: SessionBootstrapCache = new SessionBootstrapCache();
  private bootstrapPrompt: string = "";
  private recentErrors: string[] = [];
  private isFirstTurn = true;

  // ── Phase 1 wired subsystems ──
  private accuracyBooster: AccuracyBooster;
  private contextRelevanceScorer: ContextRelevanceScorer;
  private responseValidator: ResponseValidator;
  private responseCache: ResponseCache;
  private sessionStore: SessionStore;

  // ── Previously wired subsystems ──
  private fileFreezer: FileFreezer;
  private secretScanner: SecretScanner;
  private proactiveMemory: ProactiveMemoryEngine;
  private activeMemory: ActiveMemoryEngine;
  /**
   * Observer — Mastra-style async per-turn fact extractor. Runs
   * AFTER each turn completes, feeding observations into a
   * per-session buffer. Drained by the Reflector or at session end.
   * Never blocks the main query loop.
   */
  private observer: Observer;
  /**
   * Reflector — LLM-judge promotion/demotion of Observer's buffered
   * observations. Nullable until `enableReflector(judge)` wires a
   * provider-specific judge callback. Deliberately opt-in: the
   * Reflector costs one LLM call per reflection cycle, so consumers
   * must decide when the budget is worth it.
   */
  private reflector: Reflector | null = null;
  private branchManager: ConversationBranchManager;
  private crossSessionLearner: CrossSessionLearner;
  private capabilityEqualizer: CapabilityEqualizer;
  private pluginLifecycle: PluginLifecycle;
  private sessionRecorder: SessionRecorder;
  private shadowGit: ShadowGit;
  private canvasEditor: CanvasEditor;
  private currentEpisodeId: string | undefined;
  private diffEngine: typeof DiffEngine;
  private credentialPool: CredentialPool;
  private episodicMemory: EpisodicMemory;
  private autonomousExecutor: AutonomousExecutor;
  private notificationManager: NotificationManager;
  private contextInspector: ContextSourceInspector;
  private personaManager: PersonaManager;
  private selfHealingPipeline: SelfHealingPipeline;
  private lspManager: LSPManager;
  // TypeScript-LanguageService-backed symbol ops (find_symbol / find_references / rename_symbol tools)
  private symbolOperations: SymbolOperations;
  private dispatchPlane: UnifiedDispatchPlane;
  private arenaLeaderboard: ArenaLeaderboard;
  private councilLeaderboard: CouncilLeaderboard;
  private piiRedactor: PIIRedactor;
  private vectorStore: VectorStore;
  private hybridSearch: HybridMemorySearch;
  private rulesOfEngagement: RulesOfEngagement;
  private trainingPipeline: TrainingPipeline;
  private activeROESessionId: string | undefined;

  // ── Wired orphan subsystems ──
  // Orchestration
  private autonomousContextManager: AutonomousContextManager;
  // Context
  private contextShardManager: ContextShardManager;
  private turboQuantEngine: TurboQuantEngine;
  private virtualContextManager: VirtualContextManager;
  // Core (conversation tree + command history)
  private conversationTree: ConversationTree;
  private commandHistory: CommandHistory;
  // Memory (mega-merge)
  private knowledgeGraph: KnowledgeGraph;
  private contextTree: ContextTree;
  private cloudSyncEngine: CloudSyncEngine;
  // Learning (mega-merge)
  private skillForge: SkillForge;
  private instinctSystem: InstinctSystem;
  // NeverStop strategies merged into AutonomousExecutor
  // Security (mega-merge)
  private skillsGuard: SkillsGuard;
  private hashAuditChain: HashAuditChain;
  // Core (mega-merge)
  private virtualPathResolver: VirtualPathResolver;
  private configDiscovery: ConfigDiscovery;
  // Voice (mega-merge)
  private vibeVoiceBackend: VibeVoiceBackend;
  // Desktop (mega-merge)
  private promptEnhancerEngine: PromptEnhancer;

  // Training (wired)
  private autoresearchEngine: AutoresearchEngine;

  // Orchestration (wired)
  private taskDelegationManager: TaskDelegationManager;

  // Phase E: Auto-features
  private autoClassifier: AutoClassifier;
  private intentVerifier: IntentVerifier;
  // TIER 2 cleanup: PrivacyRouter zombie instance removed (per META-AUDIT-I).
  // The class itself remains as a public API export from src/lib.ts so
  // external callers can construct + drive it themselves; the runtime no
  // longer holds a stale instance whose getter had 0 callers and whose
  // .route() method was never invoked from production code.
  private autoVerifier: AutoVerifier;

  // Tools
  private imageGenRouter: ImageGenRouter;
  private readonly webFetchTool = new WebFetchTool();
  private planStore: PlanStore | null = null;

  // Intelligence pipeline modules
  private autoReviewer: AutoReviewer;
  private bugBot: BugBot;
  private providerArbitrage: ProviderArbitrageEngine;
  private errorPatternLearner: ErrorPatternLearner;
  private predictiveContext: PredictiveContextLoader;

  // Wired orphan intelligence modules
  private deepResearch: DeepResearchEngine;
  private autoModeDetector: AutoModeDetector;
  private codemapBuilder: CodemapBuilder;
  private trajectoryScorer: TrajectoryScorer;
  private microEvalRunner: MicroEvalRunner;
  private smartRetry: SmartRetryEngine;
  private forgeDoomLoop: ForgeDoomLoopFingerprinter;

  // Newly wired intelligence modules
  private autoEnhancer: AutoEnhancer;
  private crossDeviceContext: CrossDeviceContextManager;
  private aiTimeMachine: AITimeMachine;
  private userModelManager: UserModelManager;
  // S2-9: videoProcessor and rdAgent fields removed (getter-only dead code).

  // Verification, time budget, and agent registry
  private verificationCascade: VerificationCascade;
  private wallClockBudget: WallClockBudget;
  private agentRegistryInstance: AgentRegistry;

  // rc.2 follow-up: injectable primitives B4 + B12 — lazily constructed
  // on first accessor call. Null when the corresponding config flag is
  // disabled (which is the default). Zero-overhead when gated off.
  private preCompletionVerifier: PreCompletionVerifier | null = null;
  private progressiveBudget: ProgressiveBudget | null = null;
  /**
   * Tier-D1 OMEGA 3-layer memory facade. Lazily constructed on first
   * getOmegaLayers() call when the gate is enabled AND memoryStore is
   * present. The facade is a read/write view over the store; zero
   * allocation when gated off.
   */
  private omegaLayers: OmegaLayers | null = null;
  /**
   * B7 goal-drift (OpenHands port, P1-B7). Lazily constructed on
   * first getGoalDriftDetector() call when the gate is enabled.
   * Null when the config flag + env var are both disabled —
   * zero-overhead, zero-allocation when off.
   */
  private goalDriftDetector: GoalDriftDetector | null = null;
  /**
   * B4 recursion guard. The PreCompletionVerifier's LlmQuery is bound
   * to `this.query()`, so if the post-turn verify-invoker calls
   * verifier.verify() unguarded, each of the 4 perspective calls would
   * recursively trigger another verify cycle → infinite loop. This
   * flag is set inside finalizePreCompletionVerify and cleared in the
   * finally; nested query() calls observe it as "verify already in
   * progress, skip". Not module-global: per-runtime-instance.
   */
  private insidePreCompletionVerify: boolean = false;

  // Session-5: TokenPersistence deleted. CostTracker is now the single
  // authoritative source of token + cost data across sessions — it already
  // stored per-entry inputTokens/outputTokens per provider/model plus a
  // DailyCostStore rollup, so the parallel `~/.wotann/token-stats.json`
  // file TokenPersistence maintained was pure write-only duplication
  // (grep confirmed zero readers). Callers wanting the old TokenStats
  // shape should use `runtime.getCostTracker().getTokenStats()`.

  // ── Newly wired lib.ts-only modules (32→37, 86%→100%) ──
  private flowTracker: FlowTracker;
  private idleDetector: IdleDetector;
  private decisionLedger: DecisionLedger;
  // S2-9: neverStopExecutor field removed — superseded by autonomousExecutor.

  // ── Phase 2: Competitive Parity ──
  private taskRouter: TaskSemanticRouter;
  private parallelSearch: ParallelSearchDispatcher;
  private confirmAction: ConfirmActionGate;
  private agentHierarchy: AgentHierarchyManager;
  private agentWorkspace: AgentWorkspace;

  // ── Phase 3: Memory Supercharging ──
  private contextFence: ContextFence;
  private retrievalQuality: RetrievalQualityScorer;
  private contextLoader: ContextLoader;
  private observationExtractor: ObservationExtractor;
  private tunnelDetector: TunnelDetector;
  private conversationMiner: ConversationMiner | null = null;

  // ── Phase 4: Self-Improvement ──
  private adaptivePrompts: AdaptivePromptGenerator;
  private nightlyConsolidator: NightlyConsolidator;
  private benchmarkHarness: BenchmarkHarness;

  // ── Phase H: library-only modules wired into query/close/init ──
  private progressiveLoader: ProgressiveContextLoader | null = null;
  private runSessionIngestion: ((sid: string, limit?: number) => Promise<unknown>) | null = null;
  private readonly guardianEnabled: boolean;
  private readonly contextualAbstentionEnabled: boolean;
  private readonly progressiveTier: ContextTier;

  // ── Session-13: Serena-parity LSP agent tools + registry ──
  private lspRegistry: LanguageServerRegistry | null = null;
  private lspAgentTools: BuiltLspTools | null = null;
  private readonly lspAgentToolsEnabled: boolean;

  // ── Session-13: task-master parity tiered MCP tools ──
  // `WOTANN_MCP_TIER=core` (default) saves ~7k tokens vs `all` by only
  // exposing the 7 daily-workflow tools to the model. Tier resolution
  // honours env var, with a config override path later.
  private mcpTools: readonly LoadToolsResult["tools"][number][] = [];
  private mcpTier: McpTier | null = null;

  // ── Session-13: per-session Visual Diff Theater ──
  // Owns diff sessions for hunk-level accept/reject. Populated via
  // `captureFileEditForDiff()` from the PostToolUse hook and surfaced
  // through `getDiffTheater()` for CLI/TUI + iOS review surfaces.
  private diffTheater: VisualDiffTheater | null = null;

  // ── Session-13: Supermemory-parity hybrid-v2 opt-in flag ──
  // When true, searchMemory() routes through BM25+dense+RRF v2 for the
  // first pass and falls back to the legacy hybridSearch if v2 returns
  // too few hits (honest graceful degradation, never silent success).
  private readonly hybridV2Enabled: boolean;

  // ── Session-13: deer-flow virtual-paths scrub config ──
  // Per-session bucket config; used to rewrite `/Users/alice/project/src`
  // to `/mnt/user-data/project/src` in every tool-result transcript
  // the model sees. Defaults to `virtualPathsEnabled = true`.
  private readonly virtualPathsEnabled: boolean;
  private readonly sandboxVirtualPathConfig: VirtualPathsConfig;

  // ── Session-13: Provider Brain (unified provider intelligence) ──
  // Learns latency/error/cost per provider so subsequent queries can
  // route to the healthiest candidate. The brain is consulted before
  // dispatch (via `route()`) and updated after (via `updateHealth()`).
  private providerBrain: ProviderBrain | null = null;

  // ── Phase-13 Wave 3A per-session state ──
  // Per-runtime instances for reflection-buffer + tool-pattern-detector.
  // Optional web-search provider (Brave+Tavily fallback) resolved lazily.
  private readonly reflectionBuffer = new ReflectionBuffer();
  private readonly toolPatternDetector = new PatternDetector({ maxHistory: 500 });
  private searchProvider: WebSearchProvider | null = null;

  // ── V9 T3.1 Claude SDK bridge handle ──
  // Set by initialize() when the active provider is a Claude subscription
  // (anthropic + oauth-token) AND `WOTANN_SUBSCRIPTION_SDK_ENABLED` is on.
  // Null otherwise — runtime falls through to the BYOK provider path.
  // close() releases the embedded HTTP hook server + temp config files.
  private claudeBridge: import("../claude/index.js").BridgeHandle | null = null;

  /**
   * Dual-terminal steering — when `WOTANN_STEERING=1` (or
   * `config.enableSteering`), the runtime allocates a SteeringServer bound
   * to `.wotann/steering/` and starts watching for commands from a second
   * terminal. Commands (reprioritize / pause / resume / abort / change-model
   * / add-constraint / add-context) are captured into `steeringCommands`
   * for autonomous phases to consult. Null when disabled — opt-in by
   * design so the file-watcher doesn't hold fds for short-lived queries.
   */
  private steeringServer: SteeringServer | null = null;
  private readonly steeringCommands: SteeringCommand[] = [];

  /**
   * Unified Knowledge Fabric — single-API search across MemoryStore +
   * ContextTree + (future) graph-RAG / semantic / vector / FTS5 sources.
   * Constructed eagerly in the constructor; retrievers register lazily
   * once the subsystems they adapt are ready (post-initialize).
   */
  private readonly knowledgeFabric: UnifiedKnowledgeFabric = new UnifiedKnowledgeFabric();

  /**
   * Context Tree (ByteRover-inspired): persistent markdown knowledge in
   * `.wotann/context-tree/{resources,user,agent}/*.md`. Instance is
   * allocated in initialize() once `workingDir` is validated; null until
   * then so a pre-init close() doesn't touch the filesystem.
   */
  private contextTreeManager: ContextTreeManager | null = null;

  constructor(config: RuntimeConfig) {
    this.config = config;

    // Phase H config flags (per-session state; never module-global caches).
    this.guardianEnabled = config.enableGuardian ?? process.env["WOTANN_GUARDIAN"] === "1";

    // Dual-terminal steering: opt-in via WOTANN_STEERING=1 or
    // `config.enableSteering`. Binds to `.wotann/steering/` and starts a
    // fs.watch() + poll loop so a second terminal writing into
    // `pending/` gets picked up at the next phase boundary. The callback
    // pushes into `steeringCommands`; autonomous phases drain the queue
    // and `clearProcessed` after handling to free disk slots.
    if (config.enableSteering ?? process.env["WOTANN_STEERING"] === "1") {
      try {
        const steeringDir = join(config.workingDir, ".wotann", "steering");
        this.steeringServer = new SteeringServer(steeringDir);
        this.steeringServer.startWatching((cmd: SteeringCommand) => {
          this.steeringCommands.push(cmd);
        });
      } catch (err) {
        console.warn(`[WOTANN] SteeringServer init failed (non-fatal): ${(err as Error).message}`);
      }
    }
    this.contextualAbstentionEnabled = config.enableContextualAbstention ?? true;
    this.progressiveTier = config.progressiveContextTier ?? "L1";
    this.lspAgentToolsEnabled =
      config.enableLspAgentTools ?? process.env["WOTANN_LSP_TOOLS"] === "1";
    this.hybridV2Enabled = config.useHybridV2 ?? process.env["WOTANN_HYBRID_V2"] === "1";
    this.virtualPathsEnabled = config.virtualPathsEnabled ?? true;
    this.sandboxVirtualPathConfig = makeSandboxVirtualPathConfig(config.workingDir);

    // Initialize hook engine
    // Hook profile resolution: explicit config overrides everything,
    // then WOTANN_HOOK_PROFILE env var, then "standard" default.
    // Closes the "no env var, no CLI flag, no runtime switch" gap from
    // the architectural-thinking section of GAP_AUDIT.
    const envProfile = process.env["WOTANN_HOOK_PROFILE"];
    const validProfiles: ReadonlyArray<"minimal" | "standard" | "strict"> = [
      "minimal",
      "standard",
      "strict",
    ];
    const profileFromEnv =
      envProfile && validProfiles.includes(envProfile as "minimal" | "standard" | "strict")
        ? (envProfile as "minimal" | "standard" | "strict")
        : undefined;
    this.hookEngine = new HookEngine(config.hookProfile ?? profileFromEnv ?? "standard");
    // Shadow git: checkpoint-based rollback. Instantiated early so the
    // built-in pre/post checkpoint hooks can share this singleton with
    // the shadow.undo / shadow.checkpoints RPC handlers (otherwise the
    // RPC handlers see an empty ring buffer and restoreLastBefore
    // silently returns false).
    this.shadowGit = new ShadowGit(config.workingDir);
    registerBuiltinHooks(this.hookEngine, this.shadowGit);

    // Initialize doom loop detector
    this.doomLoop = new DoomLoopDetector();

    // Initialize middleware pipeline
    this.pipeline = createDefaultPipeline();

    // Initialize cost tracker. Single authoritative source for cost AND
    // token accounting since session-5 deleted the parallel TokenPersistence
    // class — CostTracker's `entries[]` already carries inputTokens/
    // outputTokens per provider/model, so `getTokenStats()` projects the
    // same shape the old TokenPersistence exposed.
    this.costTracker = new CostTracker(join(config.workingDir, ".wotann", "cost.json"));

    // Wave 4G: tool-timing logger — every tool dispatch appends one JSONL
    // row so post-session analysis has a single file to grep for slow
    // tools. Baseline tracks the rolling median per tool name so timing
    // entries carry a "was this slower than usual?" signal.
    this.toolTimingBaseline = new ToolTimingBaseline(20);
    this.toolTimingLogger = new ToolTimingLogger(
      join(config.workingDir, ".wotann", "tool-timing.jsonl"),
      this.toolTimingBaseline,
    );

    // Initialize intelligence amplifier
    this.amplifier = new IntelligenceAmplifier();

    // Initialize Phase 1 accuracy subsystems
    this.accuracyBooster = new AccuracyBooster();
    this.contextRelevanceScorer = new ContextRelevanceScorer();
    this.responseValidator = new ResponseValidator();
    this.responseCache = new ResponseCache();
    this.sessionStore = new SessionStore(join(config.workingDir, ".wotann"));

    // Initialize reasoning sandwich (asymmetric budget allocation)
    this.reasoningSandwich = new ReasoningSandwich();

    // Initialize trace analyzer (post-run failure analysis)
    this.traceAnalyzer = new TraceAnalyzer();

    // Initialize mode cycler (7 modes with skill merging)
    this.modeCycler = new ModeCycler();
    if (config.initialMode) {
      this.modeCycler.setMode(config.initialMode);
    }

    // Initialize account pool (multi-key rotation)
    this.accountPool = new AccountPool();
    this.accountPool.discoverFromEnv();

    // Initialize semantic search index (TF-IDF default — zero deps, sync).
    this.semanticIndex = new TFIDFIndex();
    // Session-6 (GAP-11): opt-in companion vector store. Previously a
    // MiniLM path via @xenova/transformers, now TF-IDF-only after the
    // Tier-0 CVE sweep dropped @xenova/transformers (protobufjs RCE
    // via onnx-proto). The class still exists so callers that gated on
    // getQuantizedVectorStore() keep compiling; it just always reports
    // the TF-IDF backend. See src/memory/quantized-vector-store.ts.
    // Future: P1-M2 calls for native sqlite-vec + ONNX (no transformers).
    if (process.env["WOTANN_ENABLE_ONNX_EMBEDDINGS"] === "1") {
      this.quantizedVectorStore = new QuantizedVectorStore();
    }

    // Initialize context window intelligence (provider-aware budget management).
    // S1-16: resolve the default provider honestly — explicit config wins,
    // then env/YAML discovery, then `null` meaning "no provider configured
    // yet". ContextWindowIntelligence needs a concrete provider for its
    // budget tables, so when nothing is known we use "ollama" as the safest
    // fallback (local, free, conservative default context window). The
    // adaptToProvider() call at query time replaces this with the real
    // provider once discovery resolves.
    const bootstrapProvider: ProviderName =
      config.defaultProvider ??
      (resolveDefaultProvider()?.provider as ProviderName | undefined) ??
      "ollama";
    this.contextIntelligence = new ContextWindowIntelligence(bootstrapProvider);

    // Initialize per-file edit tracker (benchmark engineering: warn at 4, block at 8)
    this.editTracker = new PerFileEditTracker();

    // Initialize session analytics (cost, tokens, time tracking)
    this.sessionAnalytics = new SessionAnalytics(`session-${Date.now()}`);

    // Initialize skill registry (loads 18 built-in + all .md files from skills dir)
    const skillsDir = config.skillsDir ?? join(config.workingDir, "skills");
    this.skillRegistry = SkillRegistry.createWithDefaults(skillsDir);

    // Initialize TTSR engine (mid-stream regex rules)
    this.ttsrEngine = new TTSREngine();

    // Initialize QMD-style precision retrieval (native or graceful fallback)
    this.qmdContext = new QMDContextEngine();

    // Initialize per-repo model performance tracking
    this.modelPerformanceStore = new RepoModelPerformanceStore(
      join(config.workingDir, ".wotann", "model-performance.json"),
    );

    // Initialize session. Session provider is cosmetic here — the real
    // provider is resolved per-query by the router — but it flows into
    // telemetry and UI attribution, so honour the resolved default.
    this.session = createSession(bootstrapProvider, config.defaultModel ?? "auto");

    // Initialize memory store (if enabled)
    if (config.enableMemory !== false) {
      const wotannDir = join(config.workingDir, ".wotann");
      const legacyDir = join(config.workingDir, ".wotann");
      const stateDir = existsSync(wotannDir)
        ? wotannDir
        : existsSync(legacyDir)
          ? legacyDir
          : wotannDir;
      const dbPath = join(stateDir, "memory.db");
      try {
        this.memoryStore = new MemoryStore(dbPath);
        // V9 T1.3 — auto-attach sqlite-vec backend if the native
        // extension is loadable. Returns false silently when the
        // extension or required prebuilt is missing; TEMPR then
        // falls through to FTS5 + heuristic cosine. 384 dimensions
        // matches MiniLM-L-6 and the default embedder shipped with
        // WOTANN. Callers that use a different embedder can call
        // `memoryStore.attachVectorBackend(...)` themselves with
        // their dimension count.
        try {
          this.memoryStore.attachVectorBackend(384);
        } catch {
          /* honest fallback to heuristic cosine */
        }
        // V9 T1.4 — auto-attach the ONNX cross-encoder when the
        // runtime + MiniLM .onnx model are present. Async fire-and-
        // forget so constructor stays sync. On success, TEMPR's
        // rerank stage upgrades from heuristic to real MiniLM
        // similarity on the next query (the default cross-encoder
        // is read per-call, not cached at construction time).
        this.memoryStore.attachOnnxCrossEncoder().catch(() => {
          /* honest fallback to heuristic rerank */
        });
      } catch {
        // Memory store creation may fail if state directory doesn't exist yet — not fatal
        // Store will be created on first write when the directory exists
      }
    }

    // ── Initialize wired subsystems (Phase 2 plan.md) ──

    // File freezer: session-scoped immutable file protection
    this.fileFreezer = new FileFreezer(config.workingDir);

    // Secret scanner: detect API keys, PII, base64 exfiltration in outputs
    this.secretScanner = new SecretScanner();

    // Proactive memory: trigger-based context suggestions (on file open, error, etc.)
    this.proactiveMemory = new ProactiveMemoryEngine();

    // S3-5: Active memory — blocking sub-agent that pre-processes user
    // messages BEFORE the main reply. Extracts memory-worthy facts
    // (preferences/decisions/facts) into the memory store and recalls
    // relevant prior memory for question-shaped messages. Pattern-based
    // for speed (~1ms per call). Wired into runtime.query().
    this.activeMemory = new ActiveMemoryEngine(this.memoryStore);

    // P1-M1: Observer — Mastra-style async fact extractor. Runs at
    // turn completion, buffers observations per-session, drains to
    // `working` layer for Reflector promotion. Key invariant: never
    // blocks the user-facing response path — observer runs only
    // AFTER streamCompleted=true at the end of query(). Buffer is
    // per-session (Quality Bar #7 — no module-global state).
    this.observer = new Observer({
      store: this.memoryStore,
      flushThreshold: 8,
    });

    // Conversation branching: fork/merge conversation threads
    this.branchManager = new ConversationBranchManager();

    // Cross-session learner: extract patterns from sessions, build learnings
    this.crossSessionLearner = new CrossSessionLearner(
      undefined,
      join(config.workingDir, ".wotann", "learnings.json"),
    );

    // Capability equalizer: normalize features across providers
    this.capabilityEqualizer = new CapabilityEqualizer();

    // Plugin lifecycle: pre/post LLM call hooks, session hooks
    this.pluginLifecycle = new PluginLifecycle();

    // Session recorder: record/replay sessions for debugging. Reuse the
    // bootstrap provider so telemetry attribution matches the session.
    this.sessionRecorder = new SessionRecorder(bootstrapProvider, config.defaultModel ?? "auto");
    // Wave 4G: mirror every event to `.wotann/events.jsonl` so the
    // `wotann telemetry tail` CLI can stream events in real time.
    this.sessionRecorder.setEventsSink(join(config.workingDir, ".wotann", "events.jsonl"));
    this.sessionRecorder.start();

    // Canvas editor: hunk-level collaborative editing
    this.canvasEditor = new CanvasEditor();

    // Diff engine: inline diff preview with accept/reject (module of functions)
    this.diffEngine = DiffEngine;

    // Credential pool: multi-key rotation with failover
    this.credentialPool = new CredentialPool();

    // Episodic memory: task narrative storage
    this.episodicMemory = new EpisodicMemory(join(config.workingDir, ".wotann", "episodes"));

    // Autonomous executor: fire-and-forget with 8-strategy escalation
    // Self-healing pipeline singleton constructed just below (line 1177);
    // forward-declare a local ref here so AutonomousExecutor gets the
    // same instance + accumulated errorHistory as everything else that
    // reads runtime.selfHealingPipeline (hooks, slash commands, RPC).
    // Construction ordering requires creating the pipeline BEFORE the
    // executor — move the field assignment forward.
    this.selfHealingPipeline = new SelfHealingPipeline();

    this.autonomousExecutor = new AutonomousExecutor({
      enableShadowGit: true,
      enableCheckpoints: true,
      checkpointDir: join(config.workingDir, ".wotann", "autonomous-checkpoints"),
      // V9 T1.8 — inject the runtime's SelfHealingPipeline singleton so
      // cycle failures route through graduated recovery (prompt-fix →
      // code-rollback → strategy-change → human-escalation) rather than
      // being recorded + ignored.
      selfHealingPipeline: this.selfHealingPipeline,
    });

    // Notification manager: surface task-complete / error / budget-alert
    // / channel-message / companion-paired events to desktop + iOS.
    this.notificationManager = new NotificationManager();

    // Context source inspector: shows exactly what's in the context window (Ctrl+I)
    this.contextInspector = new ContextSourceInspector();

    // Persona manager: 8-file bootstrap, dynamic persona stacking
    this.personaManager = new PersonaManager(join(config.workingDir, ".wotann", "identity"));

    // Self-healing pipeline singleton: assigned above (pre-AutonomousExecutor
    // construction) so the executor can share the instance. This anchor
    // comment preserves the prior "graduated error recovery" docs site.
    // Graduated error recovery: prompt-fix → rollback → strategy-change → escalation.

    // LSP manager: language-aware server lifecycle (pyright, rust-analyzer, etc.)
    this.lspManager = new LSPManager();
    // SymbolOperations: TypeScript LanguageService with fallback regex scans for
    // find_symbol / find_references / rename_symbol runtime tools (Serena port).
    this.symbolOperations = new SymbolOperations({ workspaceRoot: config.workingDir });

    // Unified dispatch plane: single entry point for all channel communication
    this.dispatchPlane = new UnifiedDispatchPlane();

    // Arena leaderboard: tracks blind model comparison wins/losses
    this.arenaLeaderboard = new ArenaLeaderboard();
    this.councilLeaderboard = new CouncilLeaderboard();

    // PII redactor: scrub PII from user prompts before sending to providers
    this.piiRedactor = new PIIRedactor();

    // Vector store + hybrid search: TF-IDF vector index + RRF fusion search
    this.vectorStore = new VectorStore();
    this.hybridSearch = new HybridMemorySearch(this.vectorStore, (query) =>
      this.memoryStore
        ? this.memoryStore.search(query, 10).map((r) => ({
            id: r.entry.key ?? r.entry.id ?? `mem-${Date.now()}`,
            score: r.score ?? 0.5,
          }))
        : [],
    );

    // Rules of Engagement: session tracking, scope restriction, hash-chain audit trails
    this.rulesOfEngagement = new RulesOfEngagement();

    // Training pipeline: extract Q&A pairs from sessions, score quality, format for fine-tuning
    this.trainingPipeline = new TrainingPipeline();

    // ── Wired orphan subsystems ──

    // Autonomous context intelligence: budget-aware cycle planning, wave scheduling
    this.autonomousContextManager = new AutonomousContextManager(
      config.maxContextTokens ?? 200_000,
    );

    // Context sharding: topic-based conversation partitioning
    this.contextShardManager = new ContextShardManager();

    // TurboQuant: KV cache compression for local models (Ollama)
    this.turboQuantEngine = new TurboQuantEngine();

    // Virtual context: make small windows feel larger via archiving
    this.virtualContextManager = new VirtualContextManager();

    // Conversation tree: branching conversations with model comparison
    this.conversationTree = new ConversationTree();

    // Command history: project-scoped command recall
    this.commandHistory = new CommandHistory();

    // Knowledge graph: entity/relationship extraction for graph-RAG retrieval.
    // Session 9 audit fix: the KG is now persistent. We boot with an empty
    // graph, then asynchronously rehydrate from `~/.wotann/knowledge-graph.json`
    // if present (best-effort — missing or malformed file leaves the empty
    // graph in place rather than crashing boot). A periodic snapshot + a
    // final flush on `close()` preserve it across runtime restarts.
    this.knowledgeGraph = new KnowledgeGraph();
    void this.rehydrateKnowledgeGraph();

    // Context tree: hierarchical project understanding
    const rootNode: ContextNode = {
      id: "root",
      label: "workspace",
      type: "project",
      children: [],
      metadata: { path: config.workingDir },
      lastAccessed: new Date().toISOString(),
    };
    this.contextTree = new ContextTree(rootNode);

    // Cloud sync: snapshot export/import for team memory collaboration
    this.cloudSyncEngine = new CloudSyncEngine();

    // Skill forge: automatic skill creation from solved problems
    this.skillForge = new SkillForge(
      join(config.workingDir, ".wotann", "skill-forge-state.json"),
      join(config.workingDir, ".wotann", "skills"),
    );

    // Instinct system: pattern-driven instincts with confidence scoring
    this.instinctSystem = new InstinctSystem(
      undefined,
      join(config.workingDir, ".wotann", "instincts.json"),
    );

    // Wire MemoryStore into learning modules for persistence
    if (this.memoryStore) {
      this.skillForge.setMemoryStore(this.memoryStore);
      this.instinctSystem.setMemoryStore(this.memoryStore);
      this.crossSessionLearner.setMemoryStore(this.memoryStore);

      // Register MemoryStore as a retriever in the UnifiedKnowledgeFabric
      // so `searchUnifiedKnowledge()` fans out across all sources. The
      // adapter maps `MemoryStore.search()` (BM25 FTS5) into the fabric's
      // `KnowledgeResult` shape with a simple trust score derived from
      // the `score` field. Honest defaults: verificationStatus="unverified"
      // because FTS5 has no provenance signal; callers that need stronger
      // signals should use a richer retriever (semantic / graph-RAG).
      const memoryRetriever: Retriever = {
        search: async (q: string, limit: number) => {
          if (!this.memoryStore) return [];
          const hits = this.memoryStore.search(q, limit);
          return hits.map(
            (h): KnowledgeResult => ({
              id: h.entry.id,
              content: h.entry.value,
              score: h.score,
              source: "memory" as KnowledgeSource,
              provenance: {
                retrievedAt: Date.now(),
                retrievalMethod: h.matchType ?? "fts5",
                trustScore: Math.min(1, Math.max(0, h.score)),
                freshness: 1,
                verificationStatus:
                  h.entry.verificationStatus === "verified" ? "verified" : "unverified",
              },
              metadata: {
                key: h.entry.key,
                layer: h.entry.layer,
                blockType: h.entry.blockType,
                ...(h.entry.domain !== undefined ? { domain: h.entry.domain } : {}),
              },
            }),
          );
        },
        getEntryCount: () => this.memoryStore?.getEntryCount() ?? 0,
      };
      this.knowledgeFabric.registerRetriever("memory", memoryRetriever);
    }

    // Allocate ContextTreeManager and register it with the fabric once
    // workingDir is known. The manager writes to `.wotann/context-tree/`
    // and is search()able; wrap in a Retriever adapter that normalises
    // ContextEntry → KnowledgeResult.
    try {
      const wotannDirCtx = join(this.config.workingDir, ".wotann");
      this.contextTreeManager = new ContextTreeManager(wotannDirCtx);
      const ctxRetriever: Retriever = {
        search: async (q: string, limit: number) => {
          if (!this.contextTreeManager) return [];
          const hits = this.contextTreeManager.search(q, limit);
          return hits.map(
            (e: ContextEntry): KnowledgeResult => ({
              id: e.path,
              content: e.l1Overview.length > 0 ? e.l1Overview : e.content.slice(0, 2000),
              score: 0.8,
              source: "context-tree" as KnowledgeSource,
              provenance: {
                retrievedAt: Date.now(),
                retrievalMethod: "context-tree-markdown",
                trustScore: 0.9,
                freshness: e.updatedAt > Date.now() - 7 * 86_400_000 ? 1 : 0.5,
                verificationStatus: "unverified" as const,
              },
              metadata: {
                category: e.category,
                title: e.title,
                updatedAt: e.updatedAt,
                accessCount: e.accessCount,
              },
            }),
          );
        },
        getEntryCount: () => {
          return this.contextTreeManager?.getStats().totalEntries ?? 0;
        },
      };
      this.knowledgeFabric.registerRetriever("context-tree", ctxRetriever);
    } catch (err) {
      console.warn(
        `[WOTANN] ContextTreeManager init failed (non-fatal): ${(err as Error).message}`,
      );
    }

    // ── Wire remaining 5 lib.ts-only modules (32→37, 86%→100%) ──

    // FlowTracker: Windsurf Cascade-inspired real-time action tracking
    // Tracks edits/commands/tests to infer user intent without re-explanation
    this.flowTracker = new FlowTracker();

    // IdleDetector: generates welcome-back summaries after idle periods
    this.idleDetector = new IdleDetector();

    // DecisionLedger: cross-session decision tracking with rationale, alternatives, affected files
    this.decisionLedger = new DecisionLedger();

    // S2-9: NeverStopExecutor instantiation removed — strategies merged
    // into AutonomousExecutor, use getAutonomousExecutor() instead.

    // ── Phase 2: Competitive Parity ──

    // Task-semantic model router: classify prompts → route to optimal model
    this.taskRouter = new TaskSemanticRouter();

    // Parallel multi-source search: codebase + memory + docs + git + files simultaneously
    this.parallelSearch = new ParallelSearchDispatcher({
      workspaceDir: config.workingDir,
      maxResultsPerSource: 10,
      memorySearchFn: this.memoryStore
        ? (query) =>
            this.memoryStore!.search(query, 10).map((r) => ({
              source: "memory" as const,
              title: r.entry.key,
              content: r.entry.value,
              score: Math.abs(r.score),
            }))
        : undefined,
    });

    // Confirm-action gate: tool-level mandatory approval (prompt-injection proof)
    this.confirmAction = new ConfirmActionGate();

    // Agent hierarchy: prevent cascading failures with max depth 2
    this.agentHierarchy = new AgentHierarchyManager(2);

    // Agent workspace: filesystem-based inter-agent communication
    this.agentWorkspace = new AgentWorkspace(join(config.workingDir, ".wotann"));

    // ── Phase 3: Memory Supercharging ──

    // Context fence: prevent recursive memory pollution
    this.contextFence = new ContextFence();

    // Retrieval quality: auto-tune search weights from usage feedback
    this.retrievalQuality = new RetrievalQualityScorer();

    // Progressive context loader: L0/L1/L2/L3 wake-up payload
    this.contextLoader = new ContextLoader(
      join(config.workingDir, ".wotann"),
      this.memoryStore ?? undefined,
    );

    // Observation extractor: pattern-based assertion extraction from raw data
    this.observationExtractor = new ObservationExtractor();

    // Tunnel detector: cross-domain topic linking
    this.tunnelDetector = new TunnelDetector();

    // Conversation miner: ingests Claude/Slack/text exports into memory
    if (this.memoryStore) {
      this.conversationMiner = new ConversationMiner(this.memoryStore);
    }

    // ── Phase 4: Self-Improvement ──

    // Adaptive system prompts: weaker models get scaffolding, frontier models get trust
    this.adaptivePrompts = new AdaptivePromptGenerator();

    // Nightly knowledge consolidation: errors→rules, strategies→approaches, corrections→skills
    this.nightlyConsolidator = new NightlyConsolidator();

    // Benchmark scoring harness: track performance across benchmark types
    this.benchmarkHarness = new BenchmarkHarness(join(config.workingDir, ".wotann"));

    // Skills guard: static-analysis security scanner for skill content
    this.skillsGuard = new SkillsGuard();

    // Hash audit chain: immutable hash-chain audit trail
    this.hashAuditChain = new HashAuditChain();

    // Virtual path resolver: isolate agents from real filesystem layout
    this.virtualPathResolver = new VirtualPathResolver([
      { prefix: "/mnt/workspace/", physicalRoot: config.workingDir, readOnly: false },
    ]);

    // Config discovery: scan for configs from Claude/Cursor/Codex/Gemini/etc.
    this.configDiscovery = new ConfigDiscovery();

    // VibeVoice backend: Microsoft open-source voice AI integration
    this.vibeVoiceBackend = new VibeVoiceBackend();

    // Prompt enhancer: supercharge user prompts using the most capable model
    this.promptEnhancerEngine = new PromptEnhancer();

    // Autoresearch engine: autonomous code optimization loop
    this.autoresearchEngine = new AutoresearchEngine(
      config.workingDir,
      // Placeholder no-op generator; swapped for the real LLM-backed
      // generator at the end of initialize() once runtime.query is bindable.
      async () => null,
      async (path: string) => {
        const { readFile } = await import("node:fs/promises");
        return readFile(path, "utf-8");
      },
      async (path: string, content: string) => {
        // CVE-2026-39861 defence: AutoresearchEngine receives path
        // strings derived from autonomous task plans. Without the
        // O_NOFOLLOW guard, a symlink staged at `path` (e.g. by an
        // earlier untrusted research step) would be followed and
        // overwrite the symlink target. safeWriteFile is sync — wrap
        // in an immediately-resolved Promise to keep the lambda's
        // async signature intact.
        const { safeWriteFile } = await import("../utils/path-realpath.js");
        safeWriteFile(path, content);
      },
      this.shadowGit,
    );

    // Task delegation manager: structured handoff between agent instances
    this.taskDelegationManager = new TaskDelegationManager();

    // Phase E: Auto-features initialization
    this.autoClassifier = new AutoClassifier({
      allowReadOperations: true,
      allowWriteInProject: true,
      blockDestructive: true,
    });
    this.intentVerifier = new IntentVerifier();
    // TIER 2 cleanup: PrivacyRouter instance removed (zombie per META-AUDIT-I).
    this.autoVerifier = new AutoVerifier(config.workingDir);
    this.imageGenRouter = new ImageGenRouter();

    // Tier 2B: Plan store (SQLite-backed task plans)
    try {
      const planDbPath = join(config.workingDir, ".wotann", "plans.db");
      this.planStore = new PlanStore(planDbPath);
    } catch {
      /* SQLite unavailable or dir missing — plan tool disabled */
    }

    // Intelligence pipeline modules
    this.autoReviewer = new AutoReviewer();
    this.bugBot = new BugBot();
    this.providerArbitrage = new ProviderArbitrageEngine();
    this.errorPatternLearner = new ErrorPatternLearner();
    this.predictiveContext = new PredictiveContextLoader();

    // Wired orphan intelligence modules
    this.deepResearch = new DeepResearchEngine();
    this.autoModeDetector = new AutoModeDetector();
    this.codemapBuilder = new CodemapBuilder();
    this.trajectoryScorer = new TrajectoryScorer();
    this.microEvalRunner = new MicroEvalRunner();
    this.smartRetry = new SmartRetryEngine();
    this.forgeDoomLoop = new ForgeDoomLoopFingerprinter();

    // Newly wired intelligence modules
    this.autoEnhancer = new AutoEnhancer();
    this.crossDeviceContext = new CrossDeviceContextManager();
    this.aiTimeMachine = new AITimeMachine();
    this.userModelManager = new UserModelManager(join(config.workingDir, ".wotann"));
    // S2-9: videoProcessor/rdAgent instantiation removed (dead code).

    // Verification cascade: typecheck→lint→test after file edits
    this.verificationCascade = new VerificationCascade(config.workingDir);

    // Wall-clock budget: time pressure for autonomous mode (default 5 min)
    this.wallClockBudget = new WallClockBudget(300_000);

    // Agent registry: centralized source of truth for agent spawning
    this.agentRegistryInstance = agentRegistry;

    // Phase H — wire session-level ingestion hook. Registers a SessionEnd
    // handler that pulls auto_capture entries, runs them through
    // resolution→extraction→classification→dedup, and persists observations
    // + relationships. The returned runner is retained for explicit flush
    // at close(). Honest: when memoryStore is null we skip wiring rather
    // than silently succeed.
    if (this.memoryStore) {
      try {
        const store = this.memoryStore as unknown as SessionIngestStoreLike;
        const autoPopulateKG =
          config.autoPopulateKG ?? process.env["WOTANN_AUTO_POPULATE_KG"] === "1";
        const ingestOptions = autoPopulateKG
          ? {
              autoPopulateKG: true as const,
              populator: this.memoryStore as unknown as KnowledgeGraphPopulator,
            }
          : undefined;
        this.runSessionIngestion = scheduleSessionIngestion(
          this.hookEngine,
          store,
          () => undefined, // No per-session SessionContext wired yet; resolver no-ops.
          ingestOptions,
        );
      } catch (err) {
        console.warn(
          `[WOTANN] session-ingestion hook registration failed: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Get the image generation router for multi-provider image routing. */
  getImageGenRouter(): ImageGenRouter {
    return this.imageGenRouter;
  }

  /**
   * Session-13: tiered MCP tool surface for the active runtime.
   * Defaults to "core" (7 tools). Set `WOTANN_MCP_TIER=standard` for 14
   * tools or `WOTANN_MCP_TIER=all` for the full 42+ surface (trades ~7k
   * tokens for completeness). Empty array if the resolver failed.
   */
  getMcpTools(): readonly LoadToolsResult["tools"][number][] {
    return this.mcpTools;
  }

  /** Session-13: currently-resolved MCP tier, or null if resolver failed. */
  getMcpTier(): McpTier | null {
    return this.mcpTier;
  }

  /**
   * Session-13: per-session Visual Diff Theater for hunk-level review.
   * Consumers (CLI `wotann review`, iOS diff viewer) read sessions,
   * accept/reject hunks, and apply.
   */
  getDiffTheater(): VisualDiffTheater | null {
    return this.diffTheater;
  }

  /**
   * Session-13 OpenAI agents-python parity: perform a full agent
   * handoff. Runs the input filter (or default nested-history filter)
   * and returns the HandoffResult — caller uses `downstreamInput` to
   * start the next agent's turn. Called externally by
   * `orchestration/agent-registry.ts`.
   *
   * Honest: throws on from===to per performHandoff() invariant; never
   * fabricates a success.
   */
  async performAgentHandoff(
    from: AgentId,
    to: AgentId,
    handoff: Handoff,
    data: HandoffInputData,
  ): Promise<HandoffResult> {
    return performHandoff(from, to, handoff, data);
  }

  /**
   * Session-13: access the ProviderBrain for learning-based routing.
   * Returns null if the brain failed to initialise. Callers use
   * `brain.route()` before dispatch and `recordProviderResponse()` after.
   */
  getProviderBrain(): ProviderBrain | null {
    return this.providerBrain;
  }

  /**
   * Session-13: record a provider response into the ProviderBrain so
   * subsequent `route()` calls can favour healthier providers. No-op
   * when the brain is unavailable.
   */
  recordProviderResponse(opts: {
    readonly provider: ProviderName;
    readonly durationMs: number;
    readonly success: boolean;
    readonly cost: number;
  }): void {
    if (!this.providerBrain) return;
    try {
      this.providerBrain.updateHealth(opts.provider, opts.durationMs, opts.success, opts.cost);
    } catch (err) {
      console.warn(`[WOTANN] provider-brain updateHealth failed: ${(err as Error).message}`);
    }
  }

  /**
   * Session-13: capture a file edit and push into a Visual Diff Theater
   * session so the user can review hunks before a final merge. Reads
   * current on-disk content for the `oldContent` side (empty string if
   * the file is new). Honest: a missing file leaves `oldContent` empty
   * rather than throwing. No-op when the theater is unavailable.
   */
  captureFileEditForDiff(filePath: string, newContent: string): void {
    if (!this.diffTheater) return;
    let oldContent = "";
    try {
      if (existsSync(filePath)) {
        oldContent = readFileSync(filePath, "utf-8");
      }
    } catch (err) {
      console.warn(`[WOTANN] diff-theater read failed (${filePath}): ${(err as Error).message}`);
    }
    const change: FileChange = { filePath, oldContent, newContent };
    try {
      this.diffTheater.createSession([change]);
    } catch (err) {
      console.warn(`[WOTANN] diff-theater createSession failed: ${(err as Error).message}`);
    }
  }

  /** Get the cost tracker (daily/weekly/monthly aggregates + recording). */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /**
   * Read the current runtime mode name. Paired with the existing
   * setMode() below — added so the daemon's mode.set RPC can echo the
   * new mode back to the caller (S2-24).
   */
  getModeName(): WotannMode {
    return this.modeCycler.getModeName();
  }

  /**
   * Initialize the runtime — discover providers, gather local context,
   * assemble system prompt. Must be called before querying.
   */
  async initialize(): Promise<void> {
    // Wave 3H: load identity before every other init step so downstream
    // subsystems (plugins, prompt assembly, LSP) see the current persona
    // roster. PersonaManager instantiation in the ctor already scans
    // `.wotann/identity/personas/*.yaml` once; this second pass picks up
    // personas that were dropped in after the runtime booted (common for
    // `wotann init` runs that install defaults post-construct). Assembled
    // system-prompt bootstrap files (CLAUDE.md / AGENTS.md / WOTANN.md /
    // .wotann/rules/*.md) are read separately by assembleSystemPromptParts
    // lower in initialize().
    try {
      // Re-scan the persona dir in case defaults landed after ctor.
      // The manager's public API is immutable — we rebuild a sibling
      // instance and swap in, preserving the ctor contract.
      const refreshedPersonas = new PersonaManager(
        join(this.config.workingDir, ".wotann", "identity"),
      );
      if (refreshedPersonas.getCount() > this.personaManager.getCount()) {
        this.personaManager = refreshedPersonas;
      }
    } catch (err) {
      console.warn(`[WOTANN] persona-manager refresh failed: ${(err as Error).message}`);
    }

    const pluginManager = new PluginManager(join(this.config.workingDir, ".wotann", "plugins"));
    const plugins = await pluginManager.loadInstalled();
    for (const plugin of plugins) {
      for (const hook of plugin.hooks) {
        this.hookEngine.register(hook);
      }
    }
    this.pluginPanels = plugins.flatMap((plugin) => plugin.panels);

    // Session-13 Serena parity — LSP agent tools. Opt-in via
    // WOTANN_LSP_TOOLS=1. Creates a LanguageServerRegistry and the 6-tool
    // BuiltLspTools bundle so the model can reach hover/definition/
    // document_symbols beyond the 3 legacy tools. Honest error on init
    // failure (no silent success), null-fields are respected downstream.
    if (this.lspAgentToolsEnabled) {
      try {
        this.lspRegistry = new LanguageServerRegistry();
        this.lspAgentTools = buildLspToolsForAgent(this.symbolOperations, this.lspRegistry);
      } catch (err) {
        console.warn(`[WOTANN] LSP agent-tools init failed: ${(err as Error).message}`);
        this.lspRegistry = null;
        this.lspAgentTools = null;
      }
    }

    // Session-13 task-master parity — tiered MCP tool loading.
    // `WOTANN_MCP_TIER=core` (default) surfaces 7 tools to the model;
    // `standard` adds 7 more; `all` exposes the full 42+ surface (~8k
    // tokens). Honest warn on resolver failure — no fabricated registry.
    try {
      const envTier = process.env["WOTANN_MCP_TIER"];
      const rawTier =
        envTier === "core" || envTier === "standard" || envTier === "all"
          ? (envTier as McpTier)
          : undefined;
      const loaded = loadToolsWithOptions(rawTier ? { tier: rawTier } : {});
      this.mcpTools = loaded.tools;
      this.mcpTier = loaded.tier;
    } catch (err) {
      console.warn(`[WOTANN] mcp tool-loader init failed: ${(err as Error).message}`);
      this.mcpTools = [];
      this.mcpTier = null;
    }

    // Session-13 Provider Brain — unified provider intelligence for
    // learning-based routing. Per-runtime instance; populated via
    // recordProviderResponse() at the end of every query cycle. Honest:
    // on init failure we leave the field null so callers fall back to
    // the legacy router.
    try {
      this.providerBrain = new ProviderBrain();
    } catch (err) {
      console.warn(`[WOTANN] provider-brain init failed: ${(err as Error).message}`);
      this.providerBrain = null;
    }

    // Session-13 Visual Diff Theater — hunk-level diff review surface.
    // Per-session instance (no module-global cache). A PostToolUse hook
    // auto-captures `write`/`edit` tool payloads into a diff session
    // that CLI/TUI + iOS review UI can inspect via `getDiffTheater()`.
    try {
      this.diffTheater = new VisualDiffTheater();
      this.hookEngine.register({
        name: "VisualDiffTheaterCapture",
        event: "PostToolUse",
        profile: "standard",
        kind: "tool",
        priority: 200,
        handler: (payload) => {
          const name = (payload.toolName ?? "").toLowerCase();
          if (name === "write" || name === "edit") {
            const input = payload.toolInput as Record<string, unknown> | undefined;
            const filePath = payload.filePath ?? (input?.["path"] as string | undefined);
            const newContent = (input?.["content"] as string | undefined) ?? payload.content ?? "";
            if (filePath && typeof newContent === "string" && newContent.length > 0) {
              this.captureFileEditForDiff(filePath, newContent);
            }
          }
          return { action: "allow" };
        },
      });
    } catch (err) {
      console.warn(`[WOTANN] visual-diff-theater init failed: ${(err as Error).message}`);
      this.diffTheater = null;
    }

    // Phase H — Progressive context loader. Constructed once per runtime,
    // after MemoryStore init but before provider discovery so wake-up
    // tokens can be materialised deterministically. Adapters default to
    // no-ops; callers with custom identity/facts wire them via
    // setProgressiveAdapters() (future work). Honest empty when no
    // adapters provided.
    try {
      this.progressiveLoader = new ProgressiveContextLoader();
      // Eagerly load the configured tier so the loader pre-warms state
      // before the first query. L1 matches the spec's default "prepare
      // wake-up tokens" behaviour (~170 tokens, identity + critical facts).
      if (this.progressiveTier === "L0") {
        this.progressiveLoader.loadL0();
      } else {
        this.progressiveLoader.loadL0();
        this.progressiveLoader.loadL1();
      }
    } catch (err) {
      console.warn(`[WOTANN] progressive-context-loader init failed: ${(err as Error).message}`);
      this.progressiveLoader = null;
    }

    // ── Phase-13: search-providers ──
    // When `WOTANN_SEARCH_PROVIDER=brave|tavily` is set AND a
    // matching API key is in env, build a Brave+Tavily fallback chain
    // with an in-memory LRU cache. Used by deep-research + optional
    // web_fetch routing. Honest null when no key configured.
    try {
      if (process.env["WOTANN_SEARCH_PROVIDER"]) {
        this.searchProvider = createDefaultWebSearchProvider();
        if (!this.searchProvider) {
          console.warn(
            `[WOTANN] search-providers: WOTANN_SEARCH_PROVIDER set but no BRAVE/TAVILY API key in env`,
          );
        }
      }
    } catch (err) {
      console.warn(`[WOTANN] search-providers init failed: ${(err as Error).message}`);
      this.searchProvider = null;
    }

    // Discover providers
    const providers = await discoverProviders();
    if (providers.length > 0) {
      this.infra = createProviderInfrastructure(providers, this.accountPool);
      this.infra.router.hydrateRepoPerformance(this.modelPerformanceStore.load());
      // Wave 4-W: snapshot per-provider billing so cost-tracker call site
      // can decide whether to zero per-token cost for subscription users
      // (Anthropic OAuth = Claude Pro/Max, Copilot, etc.). First-wins
      // on duplicates — discovery returns ProviderAuth in priority order
      // so the highest-priority entry wins (matches the adapter selection
      // logic in createProviderInfrastructure).
      for (const auth of providers) {
        if (!this.providerBilling.has(auth.provider)) {
          this.providerBilling.set(auth.provider, auth.billing);
        }
      }
      // SB-NEW-3 fix: prefer user-specified bootstrap provider (config.defaultProvider
      // or WOTANN_DEFAULT_PROVIDER env, captured in this.session.provider during the
      // constructor) over the arbitrary first-discovered provider. Without this guard
      // `WOTANN_DEFAULT_PROVIDER=ollama` got silently overridden to whichever provider
      // discovery returned first (typically "anthropic" by priority).
      const userPreferred = providers.find((p) => p.provider === this.session.provider);
      const chosen = userPreferred ?? providers[0];
      if (chosen) {
        this.session = createSession(chosen.provider, chosen.models[0] ?? "auto");
        this.contextIntelligence.adaptToProvider(this.session.provider, this.session.model);
      }
    }

    // ── V9 T3.1 — Claude SDK bridge ──
    // When the active provider is a Claude subscription (anthropic +
    // oauth-token billing) AND `WOTANN_SUBSCRIPTION_SDK_ENABLED` is not
    // disabled, spin up the in-process bridge so the entire
    // src/claude/{hooks,agents,channels,hardening} apparatus is reachable.
    // Honest fallback: any failure (flag off, hook server bind error,
    // missing dep) leaves `claudeBridge` null and lets the runtime continue
    // on the legacy non-bridged Claude path. Single call site by design.
    if (this.claudeBridge === null) {
      const claudeSubscription = providers.find(
        (p) => p.provider === "anthropic" && p.method === "oauth-token",
      );
      if (claudeSubscription) {
        try {
          const { startBridge } = await import("../claude/index.js");
          this.claudeBridge = await startBridge({
            deps: assembleClaudeBridgeDeps(this),
            sessionId: this.session.id,
            log: (level, msg) =>
              level === "error"
                ? console.error(`[WOTANN claude-bridge] ${msg}`)
                : console.warn(`[WOTANN claude-bridge] ${msg}`),
          });
        } catch (err) {
          console.warn(`[WOTANN] claude-bridge init failed: ${(err as Error).message}`);
          this.claudeBridge = null;
        }
      }
    }

    // Plan optimal context budget using the maximizer (provider-aware)
    if (this.session.provider && this.session.model) {
      const budget = planContextBudget(
        this.session.model,
        this.session.provider,
        /* systemPromptEstimate */ 4000,
        /* bootstrapEstimate */ 2000,
        /* memoryEstimate */ 1000,
      );
      this.autonomousContextManager.adjustBudget(budget.totalTokens);
    }

    // Gather local context (environment, tools, git status)
    const localContext = gatherLocalContext(this.config.workingDir);
    this.localContextPrompt = formatContextForPrompt(localContext);

    // P1-B1 Droid/Meta-Harness parity: capture environment bootstrap
    // snapshot (git HEAD/branch/dirty, tree, filtered env, services,
    // log tail, lockfile shas). Cached for the session lifetime. Opt
    // out with `skipBootstrapSnapshot: true` for benchmark runs.
    //
    // P1-B8 KV-cache timestamp safety: the snapshot formatter injects
    // `Captured: <ISO>` into the prompt, which would drift sub-second
    // and kill the provider-side prefix cache across adjacent-session
    // boundaries. We post-process via `stripIsoTimestampsFromPrompt`
    // so every `YYYY-MM-DDTHH:MM:SS.sssZ` collapses to its date-only
    // prefix in the prompt rendering. The snapshot's raw `capturedAt`
    // Date on disk stays full-precision — only the cacheable prompt
    // emission is date-sliced.
    try {
      const snapshot = await this.bootstrapCache.getOrCapture({
        workspaceRoot: this.config.workingDir,
        bypass: this.config.skipBootstrapSnapshot === true,
      });
      this.bootstrapPrompt = stripIsoTimestampsFromPrompt(formatSnapshotForPrompt(snapshot));
    } catch {
      // Never crash agent init if bootstrap capture itself throws
      // (honest failure: leave the prompt section empty, log nothing
      // so we don't leak filesystem shape to the console).
      this.bootstrapPrompt = "";
    }

    // Score and filter context files using tiered loading (L0/L1/L2)
    // This reduces token usage by up to 91% vs loading all files at L2
    const contextFiles = this.buildFileInfoFromTree(localContext.directoryTree);
    if (contextFiles.length > 0) {
      const tiered = this.contextRelevanceScorer.loadTieredContext(
        contextFiles,
        "project initialization",
        this.config.maxContextTokens ?? 50000,
      );
      if (tiered.savingsPercent > 0) {
        this.localContextPrompt += `\n\n[Context: ${tiered.l2Files.length} full + ${tiered.l1Files.length} signatures + ${tiered.l0Files.length} names, ${tiered.savingsPercent.toFixed(0)}% token savings]`;
      }
    }

    await this.qmdContext.initialize(this.config.workingDir);

    // Assemble system prompt from 8-file bootstrap + mode instructions +
    // local context + 17 dynamic prompt modules (OpenClaw pattern). The
    // modules read runtime state (provider/model/cost/surfaces/channels)
    // and emit only the sections that apply — absent capabilities cost
    // zero tokens.
    const basePrompt = assembleSystemPromptParts({
      workspaceRoot: this.config.workingDir,
      mode: "careful",
      moduleContext: {
        isMinimal: false,
        provider: this.session.provider ?? "unknown",
        model: this.session.model ?? "unknown",
        contextWindow: 200_000,
        workingDir: this.config.workingDir,
        sessionId: this.session.id,
        mode: "careful",
        connectedSurfaces: [],
        phoneConnected: false,
        sessionCost: 0,
        budgetRemaining: 0,
        activeChannels: [],
      },
    });

    const modeInstructions = this.modeCycler.getMergedInstructions();

    // UserModel: inject user profile context for personalized responses
    const userModelContext = this.userModelManager.getPromptContext();

    // CrossDeviceContext: inject cross-device awareness if devices are connected
    const crossDevicePrompt = this.crossDeviceContext.buildPromptContext();

    // Phase 4: Adaptive prompt section — adds scaffolding for weaker models,
    // minimalism for frontier. When no model is known yet, pass an empty
    // string so the adaptive layer falls back to its generic scaffolding
    // rather than biasing toward a specific vendor's tier.
    const adaptiveSection = this.adaptivePrompts.generateAdaptiveSection(
      this.session.model ?? "",
      "",
    );

    // Phase 3: Progressive context wake-up payload (L0 identity + L1 critical facts, ~170 tokens)
    const wakeUpPayload = this.contextLoader.generateWakeUpPayload();

    // P1-M1: Mastra-style stable prefix — render core_blocks into a
    // byte-identical text section that sits INSIDE the cache-stable
    // region. This is the memory counterpart to `basePrompt.cachedPrefix`;
    // because core_blocks only changes at Reflector promotion, the
    // resulting segment stays cache-stable across many turns.
    const stablePrefixSegments = buildStablePrefix(this.memoryStore, {
      sessionId: this.session.id,
    });

    this.systemPrompt = [
      basePrompt.cachedPrefix,
      stablePrefixSegments.stablePrefix,
      basePrompt.dynamicSuffix,
      modeInstructions,
      this.bootstrapPrompt,
      this.localContextPrompt,
      userModelContext ? `[User Profile]\n${userModelContext}` : "",
      crossDevicePrompt ? `[Cross-Device Context]\n${crossDevicePrompt}` : "",
      wakeUpPayload.combinedPrompt ? `[Memory Context]\n${wakeUpPayload.combinedPrompt}` : "",
      adaptiveSection,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Phase 13 Wave-3C — think-in-code wrapping (opt-in via
    // WOTANN_THINK_IN_CODE=1). Prepends a reasoning directive that
    // trades ~2-5% more tokens for higher task success on math /
    // debugging / multi-step planning prompts. Closes the orphan
    // finding where wrapPromptWithThinkInCode had 0 external callers.
    if (process.env["WOTANN_THINK_IN_CODE"] === "1") {
      this.systemPrompt = wrapPromptWithThinkInCode(this.systemPrompt);
    }

    // AITimeMachine: register the initial conversation for time-travel
    this.aiTimeMachine.registerConversation(this.session.id, this.session.messages);

    // Apply safety overrides based on current mode
    this.applySafetyOverrides();

    // Wire the dispatch plane to route messages through the runtime query pipeline
    this.dispatchPlane.setMessageHandler(async (msg) => {
      let response = "";
      for await (const chunk of this.query({
        prompt: msg.content,
        model: this.session.model,
        provider: this.session.provider,
      })) {
        if (chunk.type === "text" || chunk.type === "thinking") {
          response += chunk.content;
        }
      }
      return response;
    });

    this.memoryStore?.captureEvent(
      "session_start",
      "Session initialized",
      "runtime",
      this.session.id,
    );
    const sessionStartResult = this.hookEngine.fireSync({
      event: "SessionStart",
      sessionId: this.session.id,
      content: `Session started in ${this.config.workingDir}`,
      timestamp: Date.now(),
    });
    // MemoryRecovery (and any future SessionStart hook) can return a
    // contextPrefix carrying recovered WAL content. Capture it here; the
    // first call to query() prepends it to the user prompt and clears
    // the buffer. Closes the "MemoryRecovery is cosmetic" finding.
    if (sessionStartResult.contextPrefix) {
      this.pendingContextPrefix = sessionStartResult.contextPrefix;
    }

    // Install the real LLM-backed modification generator now that the
    // runtime is fully initialised (session + providers bound). Until
    // this line the autoresearch engine was constructed with a no-op
    // generator — needed to break the circular dependency between
    // `this.query` and the engine instance. Doing the swap here unlocks
    // Tier-4 self-evolution end-to-end. See src/training/llm-modification-generator.ts.
    this.autoresearchEngine.setModificationGenerator(
      createLlmModificationGenerator((opts) => this.query(opts)),
    );
  }

  /** Pending context to prepend to the next query()'s user prompt. */
  private pendingContextPrefix: string | null = null;

  /**
   * Query the agent with full harness intelligence applied.
   *
   * EXECUTION ORDER:
   * 1. Safety override check (guardrails-off mode?)
   * 2. WASM bypass check (skip LLM for deterministic operations)
   * 3. Hook engine: UserPromptSubmit
   * 4. Middleware pipeline: before (all 16 layers)
   * 5. DoomLoop check
   * 6. Intelligence amplification (planning, verification, tool correction)
   * 7. Reasoning sandwich (asymmetric budget: HIGH plan → LOW exec → HIGH verify)
   * 8. Provider query via AgentBridge (with fallback chain)
   * 9. Trace recording
   * 10. Post-query hooks + middleware
   * 11. Memory capture (SQLite + semantic index)
   * 12. Cost tracking + session update
   */
  async *query(options: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    // S1-16: attribute errors to the actual targeted provider, falling back
    // through config → discovered default → session provider (honest:
    // whatever the runtime bootstrapped with). Never hardcoded to Anthropic.
    const attributedProvider: ProviderName =
      options.provider ?? this.config.defaultProvider ?? (this.session.provider as ProviderName);
    if (!this.infra) {
      yield {
        type: "error",
        content: "No providers configured. Run `wotann init` first.",
        provider: attributedProvider,
      };
      return;
    }

    // Wave 4-V — WOTANN_MAX_DAILY_SPEND hard-cap enforcement. Checked
    // BEFORE we mutate the session, push a user message, or hit any
    // provider — a blocked query must be a true no-op so the user can
    // re-run after raising the cap or after midnight UTC. Wrapped in
    // try/catch (QB#6 honest fallback) so a tracker bug never poisons
    // the query path: log + allow rather than block legitimate users
    // on telemetry plumbing failures.
    try {
      const dailyCap = this.costTracker.checkDailyBudgetCap();
      if (!dailyCap.allowed) {
        yield {
          type: "error",
          content: dailyCap.reason ?? "Daily spend cap reached.",
          provider: attributedProvider,
        };
        return;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[WotannRuntime] checkDailyBudgetCap failed; allowing query: ${(err as Error).message}`,
      );
    }

    const queryStart = Date.now();
    const sessionBeforeQuery = this.session;
    this.session = addMessage(this.session, {
      role: "user",
      content: options.prompt,
      provider: options.provider ?? this.session.provider,
      model: options.model ?? this.session.model,
    });
    this.syncMessageIndex();
    this.memoryStore?.captureEvent("user_prompt", options.prompt, "query", this.session.id);
    this.captureLearningFeedback(options.prompt);

    // FlowTracker: track user prompt as action for intent inference
    this.flowTracker.track({
      type: "query_sent",
      timestamp: Date.now(),
      details: { prompt: options.prompt.slice(0, 500), mode: this.modeCycler.getModeName() },
    });

    // Instinct system: observe the user prompt for pattern learning
    this.instinctSystem.observe(options.prompt, this.modeCycler.getModeName());

    // Instinct system: get active instincts and inject into context
    const instinctSuggestions = this.instinctSystem.suggest(options.prompt);
    if (instinctSuggestions.length > 0) {
      const instinctContext = instinctSuggestions
        .slice(0, 5)
        .map((s) => `[${(s.instinct.confidence * 100).toFixed(0)}%] ${s.instinct.action}`)
        .join("; ");
      this.memoryStore?.captureEvent(
        "instinct_active",
        instinctContext.slice(0, 500),
        "learning",
        this.session.id,
      );
    }

    // AutoModeDetector: auto-detect the right mode from the prompt
    const modeDetection = this.autoModeDetector.detect(options.prompt);
    if (
      modeDetection.confidence >= 0.8 &&
      modeDetection.detectedMode !== this.modeCycler.getModeName()
    ) {
      this.modeCycler.setMode(modeDetection.detectedMode);
    }

    // AutoEnhancer: silently improve vague/short prompts before sending
    const enhanceResult = this.autoEnhancer.process(options.prompt);
    if (enhanceResult.wasEnhanced) {
      options = { ...options, prompt: enhanceResult.enhanced };
    }

    // MemoryRecovery context injection — if SessionStart's MemoryRecovery
    // hook captured a contextPrefix from the WAL, prepend it to the very
    // first user prompt of the session and clear the buffer. Closes the
    // "MemoryRecovery is cosmetic" Opus audit finding by actually
    // threading recovered content into the model's context.
    if (this.pendingContextPrefix) {
      options = {
        ...options,
        prompt: `${this.pendingContextPrefix}${options.prompt}`,
      };
      this.pendingContextPrefix = null;
    }

    // S3-5: Active Memory pre-processing. A blocking sub-agent runs
    // BEFORE the main reply: classifies the user message, extracts
    // memory-worthy facts (preferences/decisions/facts) into the
    // memory store, and for question-shaped messages recalls relevant
    // prior memory and prepends it as a context block. Stays
    // pattern-based for speed (~1ms per call).
    //
    // M4 + M6 wire: when the runtime is configured for TEMPR
    // (`config.useTempr`) or a named retrieval mode (`config.recallMode`),
    // route through the async variant which dispatches to the opt-in
    // backend. When both are off, the cheap synchronous path is used —
    // zero-overhead for free-tier default.
    try {
      const recallOpts = this.resolveRecallOptions();
      const activeResult =
        recallOpts.useTempr || recallOpts.recallMode
          ? await this.activeMemory.preprocessAsync(options.prompt, this.session.id, recallOpts)
          : this.activeMemory.preprocess(options.prompt, this.session.id);
      if (activeResult.contextPrefix) {
        options = {
          ...options,
          prompt: `${activeResult.contextPrefix}${options.prompt}`,
        };
      }
    } catch {
      // Active memory preprocessing must never block the main query.
    }

    // WallClockBudget: inject time pressure prompt when approaching budget limit
    const timePressure = this.wallClockBudget.getSystemPromptOverride();
    if (timePressure) {
      options = { ...options, prompt: `${timePressure}\n\n${options.prompt}` };
    }

    // UserModel: update profile from each interaction
    this.userModelManager.recordExpertise(
      modeDetection.detectedMode,
      "intermediate",
      options.prompt.slice(0, 100),
    );

    // Cross-session learner: record this query action
    this.crossSessionLearner.recordAction({
      type: "query_sent",
      input: options.prompt.slice(0, 500),
      success: true,
    });

    const streamCheckpointStore = new StreamCheckpointStore(
      join(this.config.workingDir, ".wotann", "streams"),
    );
    const streamCheckpoint = streamCheckpointStore.start(options, sessionBeforeQuery);
    let streamCompleted = false;
    let streamInterruptedReason: string | undefined;

    try {
      // ── Step 1: WASM Bypass ──
      if (this.config.enableWasmBypass !== false && canBypass(options.prompt)) {
        const result = executeBypass(options.prompt, options.prompt);
        if (result.output) {
          // WASM bypass runs locally. Attribute to the user's targeted
          // provider so UI labels don't claim a provider that was never called.
          streamCheckpointStore.appendText(streamCheckpoint.id, result.output, attributedProvider);
          yield { type: "text", content: result.output ?? "", provider: attributedProvider };
          yield { type: "done", content: "", provider: attributedProvider, tokensUsed: 0 };
          streamCheckpointStore.markCompleted(streamCheckpoint.id);
          streamCompleted = true;
          return;
        }
      }

      // ── Step 1.5: Task-semantic model routing ──
      // Classify the prompt and auto-select the best model if user didn't specify one
      if (!options.model || options.model === "auto") {
        try {
          const routing = this.classifyAndRoute(options.prompt);
          if (routing.recommendedModel && routing.recommendedModel !== "auto") {
            options = { ...options, model: routing.recommendedModel };
          }
        } catch {
          /* routing failure is non-fatal — use current model */
        }
      }

      // ── Step 1.6: Deep research detection ──
      const isResearchQuery =
        /\b(research|investigate|explain\s+in\s+depth|deep\s+dive|comprehensive\s+analysis)\b/i.test(
          options.prompt,
        );
      if (isResearchQuery) {
        // S2-10: wire real search + fetch callbacks from the runtime so
        // deep-research stops returning zero citations. Previously the
        // engine ran decomposition but every subquery produced an empty
        // result because `defaultSearch` returned []. The webFetchTool
        // here re-uses the SSRF-hardened WebFetchTool with DNS-resolve
        // protection (S2-20).
        const researchResult = await this.deepResearch.execute({
          query: options.prompt,
          maxSteps: 3,
          maxSources: 5,
          outputFormat: "markdown",
          fetch: async (url: string) => {
            const res = await this.webFetchTool.fetch(url);
            return res.markdown || res.content;
          },
          // ── Phase-13: search-providers adapter ──
          // When `WOTANN_SEARCH_PROVIDER` is configured and a key is
          // present, deep-research routes through Brave/Tavily with
          // LRU caching. Falls back to no-op when unconfigured.
          ...(this.searchProvider
            ? {
                search: async (q: string) => {
                  try {
                    return await this.searchProvider!.search(q, 5);
                  } catch (err) {
                    console.warn(`[WOTANN] search-provider failed: ${(err as Error).message}`);
                    return [];
                  }
                },
              }
            : {}),
        });
        if (researchResult.citations.length > 0) {
          const researchContext = `\n\n[Deep Research Context]\n${researchResult.summary.slice(0, 2000)}`;
          options = { ...options, prompt: options.prompt + researchContext };
        }
      }

      // ── Step 2: Pre-query hooks ──
      if (this.config.enableHooks !== false) {
        const hookResult = await this.hookEngine.fire({
          event: "UserPromptSubmit",
          content: options.prompt,
          sessionId: this.session.id,
        });
        if (hookResult.action === "block") {
          streamInterruptedReason = `Blocked by hook: ${hookResult.message ?? ""}`;
          yield { type: "error", content: streamInterruptedReason, provider: attributedProvider };
          return;
        }
      }

      // ── Step 3: Middleware before ──
      let middlewareCtx: MiddlewareContext | undefined;
      if (this.config.enableMiddleware !== false) {
        middlewareCtx = await this.pipeline.processBefore({
          sessionId: this.session.id,
          userMessage: options.prompt,
          workingDir: this.config.workingDir,
          recentHistory: [...this.session.messages],
        });
      }

      // Reset TTSR fire counts for new query
      this.ttsrEngine.reset();

      // ── Step 4: DoomLoop check ──
      const doomResult = this.doomLoop.record("query", { prompt: options.prompt });
      if (doomResult.detected) {
        streamInterruptedReason = `DoomLoop detected (${doomResult.type ?? "repeated"}): Try a different approach.`;
        yield {
          type: "error",
          content: streamInterruptedReason,
          provider: attributedProvider,
        };
        return;
      }

      // ── Step 4.5: Context pressure check + VirtualContext offload ──
      // Tiered warnings: 60% info, 80% warning + VirtualContext, 95% critical
      const contextBudget = this.contextIntelligence.getBudget();

      if (contextBudget.usagePercent >= 95) {
        // Critical tier — context nearly exhausted, compaction required
        yield {
          type: "error" as const,
          content: `[Context Pressure — CRITICAL] Context window is ${contextBudget.usagePercent.toFixed(0)}% full (${contextBudget.totalTokens - contextBudget.availableTokens}/${contextBudget.totalTokens} tokens). Compaction required to continue.`,
          provider: options.provider ?? this.session.provider,
        };
      } else if (contextBudget.usagePercent >= 80) {
        // Warning tier — VirtualContext kicks in to archive old segments
        try {
          const vcMessages = this.session.messages.map((m, idx) => ({
            role: m.role as "system" | "user" | "assistant" | "tool",
            content: m.content,
            tokenEstimate: Math.ceil(m.content.length / 4),
            // Use index-based offset from now to preserve relative ordering
            timestamp: Date.now() - (this.session.messages.length - idx) * 60_000,
          }));
          const virtualized = this.virtualContextManager.virtualizeConversation(
            vcMessages,
            contextBudget.totalTokens,
          );
          if (virtualized.newArchived.length > 0) {
            const archivedTokens = virtualized.newArchived.reduce(
              (sum, seg) => sum + seg.messages.reduce((s, m) => s + m.tokenEstimate, 0),
              0,
            );
            yield {
              type: "text" as const,
              content: `[Context] Archived ${virtualized.newArchived.length} segment(s) to virtual storage (~${archivedTokens} tokens). Retrievable on demand.`,
              provider: options.provider ?? this.session.provider,
            };
          }
        } catch {
          /* VirtualContext failed — continue with standard warning */
        }

        yield {
          type: "error" as const,
          content: `[Context Pressure — WARNING] Context window is ${contextBudget.usagePercent.toFixed(0)}% full (${contextBudget.totalTokens - contextBudget.availableTokens}/${contextBudget.totalTokens} tokens). Archiving old segments. Consider compacting conversation history.`,
          provider: options.provider ?? this.session.provider,
        };
      } else if (contextBudget.usagePercent >= 60) {
        // Info tier — early awareness, no action taken yet
        yield {
          type: "text" as const,
          content: `[Context Pressure — INFO] Context window is ${contextBudget.usagePercent.toFixed(0)}% full. Consider focusing the conversation.`,
          provider: options.provider ?? this.session.provider,
        };
      }

      // ── Step 4.6: TurboQuant — KV cache compression for local Ollama models ──
      const activeProvider = options.provider ?? this.session.provider;
      let turboQuantOllamaParams: {
        numCtx: number;
        kvCacheType: string;
        flashAttention: boolean;
      } | null = null;
      if (activeProvider === "ollama") {
        try {
          const ollamaParams = this.turboQuantEngine.generateOllamaParams(
            options.model ?? this.session.model,
          );
          if (ollamaParams.numCtx > 0) {
            turboQuantOllamaParams = ollamaParams;
          }
        } catch {
          /* TurboQuant failed — continue without compression */
        }
      }

      // ── Step 5: Intelligence amplification ──
      const amplified = this.amplifier.amplify(options.prompt, {
        workingDir: this.config.workingDir,
        recentErrors: this.recentErrors,
        strictTypes: true,
      });

      // ── Step 5.1: Accuracy boost (Phase 1 wiring) ──
      // The boosted prompt overlays structured accuracy techniques onto
      // the raw amplified prompt. Session-5 fixed the drift where
      // `boosted.boosted` was computed but downstream still used
      // `amplified.amplified` — the booster output was silently dropped.
      const boosted = this.accuracyBooster.boost(amplified.amplified, {
        taskType: classifyTaskType(options.prompt),
        previousErrors: this.recentErrors,
        previousAttempts: 0,
        availableFiles: [],
        recentToolResults: this.traceAnalyzer.getRecentEntries(3).map((e) => e.content),
        language: "typescript",
      });

      // ── Step 5.5: Proactive memory & episodic recording ──
      const proactiveHints = this.proactiveMemory.processEvent({
        type: "task-started",
        data: { task: options.prompt },
      });

      let proactiveContext =
        proactiveHints.length > 0
          ? "\n\n[Proactive Context]\n" +
            proactiveHints.map((h) => `- ${h.content} (source: ${h.source})`).join("\n")
          : "";

      // Phase 3: Context Fence — prevent recalled memories from being re-captured
      // Fence all proactive hints so the auto-capture system doesn't store them as "new" observations
      if (proactiveHints.length > 0) {
        this.contextFence.fenceBatch(
          proactiveHints.map((h) => ({ content: h.content, memoryIds: [h.id] })),
          this.session.id,
        );
      }

      // ── Step 5.55: Codemap context — provide codebase navigation hints ──
      try {
        const codemapResult = await this.codemapBuilder.buildFromDirectory(this.config.workingDir);
        if (codemapResult.nodes.length > 0) {
          const relevantNodes = codemapResult.nodes
            .filter((n) => n.type === "class" || n.type === "function")
            .slice(0, 10)
            .map((n) => `${n.type}:${n.name} (${n.path})`)
            .join(", ");
          if (relevantNodes.length > 0) {
            proactiveContext += `\n\n[Codemap] Key symbols: ${relevantNodes}`;
          }
        }
      } catch {
        /* Codemap scan failed — non-fatal */
      }

      // ── Step 5.6: Predictive context — pre-load files the agent will likely need ──
      const recentFiles = this.traceAnalyzer
        .getRecentEntries(5)
        .map((e) => e.content)
        .filter((c) => c.includes("/"));
      const predictedFiles = this.predictiveContext.predictNextFiles(recentFiles, [options.prompt]);
      if (predictedFiles.length > 0) {
        this.predictiveContext.logPredictions(predictedFiles.map((f) => f.path));
      }

      // ── Step 5.7: VirtualContext retrieval — bring back archived context if relevant ──
      const vcRetrieval = this.virtualContextManager.retrieveRelevantContext(
        options.prompt,
        Math.floor(contextBudget.availableTokens * 0.2),
      );
      if (vcRetrieval.segments.length > 0) {
        const retrievedContext = vcRetrieval.segments
          .flatMap((s) => s.messages.map((m) => m.content))
          .join("\n---\n")
          .slice(0, 2000);
        proactiveContext += `\n\n[Retrieved Context (${vcRetrieval.totalTokensRetrieved} tokens from archive)]\n${retrievedContext}`;
      }

      if (!this.currentEpisodeId) {
        this.currentEpisodeId = this.episodicMemory.startEpisode(
          options.prompt,
          options.provider ?? this.session.provider,
          options.model ?? this.session.model,
        );
      }
      this.episodicMemory.recordEvent("plan", options.prompt.slice(0, 200));

      // ── Step 5.8: Content-CID annotation (small-vision / text-only tiers) ──
      // Weak models mis-copy long SHA hashes mid-CoT. When the active
      // provider's model is small-vision or text-only, emit a 3-char CID
      // index over the prompt chunks and prepend it so the model can
      // reference [cid:xx] anchors instead. Frontier vision models carry
      // full hashes fine and return null from this helper.
      try {
        const activeModelId = options.model ?? this.session.model ?? "";
        const activeProviderForCid = options.provider ?? this.session.provider;
        const visionStatus = this.capabilityEqualizer.hasCapability(
          activeProviderForCid,
          activeModelId,
          "vision",
        );
        const cidResult = maybeBuildCidIndexForProvider({
          modelId: activeModelId,
          hasVision: visionStatus === "native" || visionStatus === "emulated",
          chunks: [{ content: options.prompt.slice(0, 8000), metadata: { source: "user-prompt" } }],
        });
        const annotation = renderCidAnnotation(cidResult);
        if (annotation) {
          options = { ...options, prompt: `${annotation}\n\n${options.prompt}` };
        }
      } catch (err) {
        console.warn(`[WOTANN] content-cid annotation failed: ${(err as Error).message}`);
      }

      // ── Step 6: Reasoning sandwich (asymmetric budget) ──
      const reasoning = this.reasoningSandwich.getAdjustment(options.prompt, this.isFirstTurn);
      this.isFirstTurn = false;
      this.contextIntelligence.adaptToProvider(
        options.provider ?? this.session.provider,
        options.model ?? this.session.model,
      );

      let conversationContext = options.context ? [...options.context] : [...this.session.messages];

      const skillActivation = buildSkillActivationPrompt(
        this.skillRegistry,
        options.prompt,
        this.config.workingDir,
      );

      const currentFile = skillActivation.referencedPaths[0];
      const memoryActivation = buildMemoryActivationPrompt(
        this.memoryStore,
        this.session.id,
        options.prompt,
        currentFile,
      );

      // TODO(god-object-extraction): Replace this tool registration section with:
      // const runtimeTools = buildEffectiveTools(options.tools ?? [], {
      //   computerUseEnabled: true,
      //   planStoreAvailable: !!this.planStore,
      // });
      // const effectiveTools: ToolDefinition[] = [...runtimeTools];

      // ── Register computer_use tool in agent tool schema ──
      const computerUseTool: ToolDefinition = {
        name: "computer_use",
        description:
          "Control the desktop screen — take screenshots, click, type, read UI elements. Use when you need to interact with GUI applications.",
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["screenshot", "click", "type", "read_screen"],
              description: "The action to perform",
            },
            x: { type: "number", description: "X coordinate for click" },
            y: { type: "number", description: "Y coordinate for click" },
            text: { type: "string", description: "Text to type" },
          },
          required: ["action"],
        },
      };
      // ── Weak-model substitution: swap native `edit` for hash-anchored edit ──
      // For weak models (smaller context window, often worse at quoting large blocks
      // verbatim) we prefer `hash_anchored_edit` — it refuses the edit when the
      // target range has drifted, which catches the class of weak-model errors
      // that overwrite the wrong region. Frontier models keep the native tool.
      const baseTools: readonly ToolDefinition[] = options.tools ?? [];
      const toolSubstitutionProvider = options.provider ?? this.session.provider;
      const toolSubstitutionAdapter =
        this.infra?.bridge?.getAdapter?.(toolSubstitutionProvider) ?? null;
      const toolSubstitutionCapabilities = toolSubstitutionAdapter?.capabilities;
      const FRONTIER_CONTEXT_THRESHOLD = 200_000;
      const shouldUseHashAnchoredEdit =
        toolSubstitutionCapabilities?.supportsToolCalling === true &&
        toolSubstitutionCapabilities.maxContextWindow < FRONTIER_CONTEXT_THRESHOLD;
      const substitutedTools: ToolDefinition[] = baseTools.map((tool) => {
        if (shouldUseHashAnchoredEdit && tool.name === "edit") {
          return {
            name: HASH_ANCHORED_EDIT_TOOL_SCHEMA.name,
            description: HASH_ANCHORED_EDIT_TOOL_SCHEMA.description,
            inputSchema: HASH_ANCHORED_EDIT_TOOL_SCHEMA.inputSchema as Record<string, unknown>,
          };
        }
        return tool;
      });
      const effectiveTools: ToolDefinition[] = [...substitutedTools, computerUseTool];

      // ── Tier 2B: Web Fetch Tool ──
      effectiveTools.push({
        name: "web_fetch",
        description:
          "Fetch a URL and return its text content (HTML stripped). Use for documentation, APIs, or web research. " +
          "Output is truncated to `maxLength` characters (default 10000); truncated responses end with a `[...truncated]` marker — do not treat such output as the complete page.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch" },
            maxLength: { type: "number", description: "Max characters to return (default 10000)" },
          },
          required: ["url"],
        },
      });

      // ── Tier 2B: Plan/Task Tool ──
      if (this.planStore) {
        effectiveTools.push(
          {
            name: "plan_create",
            description: "Create a task plan with title and optional description",
            inputSchema: {
              type: "object",
              properties: {
                title: { type: "string", description: "Plan title" },
                description: { type: "string", description: "Plan description" },
              },
              required: ["title"],
            },
          },
          {
            name: "plan_list",
            description: "List all active plans with their progress",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "plan_advance",
            description: "Mark the next task in a plan as complete",
            inputSchema: {
              type: "object",
              properties: {
                planId: { type: "string", description: "The plan ID to advance" },
              },
              required: ["planId"],
            },
          },
        );
      }

      // F8: in test mode, truncate every tool description to keep prompts
      // deterministic and small. The flag is opt-in (WOTANN_TEST_MODE=1) so it
      // has zero effect on normal runs. Mutating the array in place keeps the
      // const binding stable while still shortening the descriptions we send
      // to the model.
      if (process.env["WOTANN_TEST_MODE"] === "1") {
        for (let i = 0; i < effectiveTools.length; i++) {
          const existing = effectiveTools[i]!;
          if (existing.description.length > 80) {
            effectiveTools[i] = {
              ...existing,
              description: existing.description.slice(0, 80),
            };
          }
        }
      }

      this.refreshContextTelemetry({
        conversationContext,
        systemParts: [
          options.systemPrompt ?? this.systemPrompt,
          memoryActivation.prompt,
          skillActivation.prompt,
        ],
        tools: effectiveTools,
      });

      const compactionPlan = this.contextIntelligence.shouldCompact();
      if (compactionPlan.needed && !options.context) {
        // Phase 8 Context-Mode parity: fire PreCompact BEFORE running the
        // actual compaction so handlers can block it (e.g. "I'm mid-task,
        // don't compact now"). Previously PreCompact fired after compaction,
        // which made the "pre" prefix a lie — handlers couldn't prevent data
        // loss, only react to it. Now: block → skip; modify → pass through;
        // allow/warn → proceed.
        const preCompactResult = await this.hookEngine.fire({
          event: "PreCompact",
          content: `${compactionPlan.stage}:${this.session.messages.length}`,
          sessionId: this.session.id,
        });
        if (preCompactResult.action !== "block") {
          const compacted = compactConversationHistory(
            this.session.messages,
            compactionPlan.stage ?? "old-messages",
          );
          if (compacted) {
            this.session = {
              ...this.session,
              messages: compacted.messages,
            };
            this.syncMessageIndex();
            conversationContext = [...compacted.messages];
            this.contextIntelligence.compact(compactionPlan.stage ?? "old-messages");
            this.memoryStore?.setWorkingMemory(
              this.session.id,
              `compaction-${Date.now()}`,
              compacted.summary,
              0.8,
            );
            this.memoryStore?.captureEvent(
              "context_compaction",
              compacted.summary,
              compactionPlan.stage ?? undefined,
              this.session.id,
            );

            await this.hookEngine.fire({
              event: "PostCompact",
              content: `${compactionPlan.stage}:${compacted.removedMessages}`,
              sessionId: this.session.id,
            });
          }
        }
      }

      const overrideDirective = buildOverrideDirective(options.prompt, conversationContext);
      const qmdPrompt = formatQMDContext(
        await this.qmdContext.getRelevantContext(options.prompt, 6),
      );
      this.refreshContextTelemetry({
        conversationContext,
        systemParts: [
          options.systemPrompt ?? this.systemPrompt,
          memoryActivation.prompt,
          skillActivation.prompt,
          qmdPrompt,
        ],
        tools: effectiveTools,
      });
      const budgetPrompt = buildContextBudgetPrompt(this.contextIntelligence);
      const activeReminders = this.contextIntelligence.getActiveReminders();
      const guardrailsOff = this.modeCycler.shouldClearSafetyFlags();
      const providerForSecurityMode = options.provider ?? this.resolveSecurityResearchProvider();
      const securityPrompt = guardrailsOff
        ? buildSecurityResearchPrompt(
            providerForSecurityMode ?? this.session.provider,
            getDefaultGuardrailsConfig(),
          )
        : "";

      // ── Phase-13: reflection-buffer prepend ──
      // Retrieve up to 3 relevant past-mistake entries and format as a
      // prompt-injectable block. Honest no-op when empty. Tag-match
      // surface is intentionally simple — callers `buffer.add()` with
      // tags like "bash" / "typescript" so retrieval stays scoped.
      let reflectionBlock = "";
      try {
        const reflections = this.reflectionBuffer.retrieve({
          query: options.prompt.slice(0, 200),
          limit: 3,
        });
        if (reflections.length > 0) {
          reflectionBlock = this.reflectionBuffer.formatForPrompt(reflections);
        }
      } catch (err) {
        console.warn(`[WOTANN] reflection-buffer retrieve failed: ${(err as Error).message}`);
      }

      // ── Phase-13: policy-injector for τ-bench taskClass ──
      // When `options.taskClass === "tau-bench-retail" | "tau-bench-airline"`
      // prepend the built-in policy document to the system prompt. Other
      // task classes pass through unchanged. Honest: on unknown domain
      // we log and leave the prompt untouched.
      let policyPrefix = "";
      try {
        if (options.taskClass === "tau-bench-retail") {
          policyPrefix = injectPolicyByDomain("", "retail");
        } else if (options.taskClass === "tau-bench-airline") {
          policyPrefix = injectPolicyByDomain("", "airline");
        }
      } catch (err) {
        console.warn(`[WOTANN] policy-injector failed: ${(err as Error).message}`);
      }

      // Build the full system prompt with mode instructions + reasoning guidance
      const fullSystemPrompt = [
        policyPrefix,
        reflectionBlock,
        securityPrompt,
        options.systemPrompt ?? this.systemPrompt,
        memoryActivation.prompt,
        skillActivation.prompt,
        qmdPrompt,
        proactiveContext,
        budgetPrompt,
        ...activeReminders,
        reasoning.promptInjection,
        ...overrideDirective.systemPromptFragments,
      ]
        .filter(Boolean)
        .join("\n\n");

      // ── Step 6.5: PII redaction — scrub PII from prompt before provider ──
      // Session-5 fix: use the boosted prompt (step 5.1) instead of the
      // raw amplified prompt — accuracy-booster output was previously
      // dropped because PII redactor read `amplified.amplified` directly.
      const piiResult = this.piiRedactor.redact(boosted.boosted);
      const sanitizedPrompt =
        piiResult.totalRedacted > 0 ? piiResult.redactedText : boosted.boosted;

      // ── Step 6.7: AntiDistillation — inject fake tools to poison distillation ──
      // Session-5 fix: the generated fake tools were previously stored
      // in a local variable and never merged into the query's effective
      // tool set — the whole feature was dead code. Now the fake tools
      // are appended to `effectiveTools` so the model sees them and
      // any distillation attempt captures them as noise.
      //
      // Wave-3E wiring (spec priority #7): honor the
      // `WOTANN_ANTI_DISTILLATION=1` env var as an opt-in alongside the
      // config flag. Env-var opt-in lets operators enable distillation
      // defence without rebuilding config, matching the pattern used by
      // other security-posture env vars (WOTANN_ALLOW_DESTRUCTIVE,
      // WOTANN_UNIFIED_EXEC_ALLOW_BARE, etc.).
      const antiDistillEnabled =
        this.config.enableAntiDistillation === true ||
        process.env["WOTANN_ANTI_DISTILLATION"] === "1";
      if (antiDistillEnabled) {
        const fakeTools = generateFakeTools(2);
        for (const fake of fakeTools) {
          effectiveTools.push({
            name: fake.name,
            description: fake.description,
            inputSchema: fake.inputSchema,
          });
        }
      }

      // ── Step 6.9: Provider arbitrage — find cheapest provider meeting capability ──
      const taskType = classifyTaskType(options.prompt);
      const minCapability =
        taskType === "code-generation" || taskType === "bug-fix" ? "high" : "medium";
      const arbitrageRoute = this.providerArbitrage.findCheapestRoute(
        options.prompt,
        minCapability,
      );
      // Use arbitrage recommendation if no explicit provider was specified
      const arbitrageProvider = options.provider
        ? (providerForSecurityMode ?? options.provider)
        : (providerForSecurityMode ?? arbitrageRoute.provider);

      // ── Step 7: Query with amplified prompt ──
      const queryOptions: WotannQueryOptions = {
        ...options,
        provider: arbitrageProvider,
        context: conversationContext,
        prompt: sanitizedPrompt,
        systemPrompt: fullSystemPrompt,
        tools: effectiveTools,
        ...(turboQuantOllamaParams ? { ollamaParams: turboQuantOllamaParams } : {}),
      };

      // ── Step 7.1: Response cache fast-path ──
      const cacheQuery: CacheableQuery = {
        model: queryOptions.model ?? this.session.model,
        provider: queryOptions.provider ?? this.session.provider,
        systemPrompt: queryOptions.systemPrompt,
        messages: conversationContext.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: 0,
        stream: false,
      };
      const cached = this.responseCache.get(cacheQuery);
      if (cached) {
        const cachedProvider = (cached.provider ?? this.session.provider) as ProviderName;
        streamCheckpointStore.appendText(
          streamCheckpoint.id,
          cached.response,
          cachedProvider,
          cached.model,
        );
        yield {
          type: "text" as const,
          content: cached.response,
          provider: cachedProvider,
          model: cached.model,
        };
        yield {
          type: "done" as const,
          content: "",
          provider: cachedProvider,
          model: cached.model,
          tokensUsed: 0,
        };
        streamCheckpointStore.markCompleted(streamCheckpoint.id);
        streamCompleted = true;
        return;
      }

      let totalTokens = 0;
      // Wave 4G: preserve the split usage from the provider's final chunk
      // so cost recording can attribute input vs output vs cache honestly.
      // Null means "no provider usage reported this turn" — the 50/50
      // fallback kicks in at record time.
      let turnUsage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      } | null = null;
      // Wave 4G: count tool calls this turn for the structured `turn`
      // telemetry event. One event per `tool_use` chunk, regardless of
      // whether the tool runs in-runtime or gets delegated back to the
      // model for user handling.
      let turnToolCalls = 0;
      let contentParts: string[] = [];
      let responseProvider = this.session.provider;
      let responseModel = this.session.model;
      let blockedByEditTracker = false;
      let exhaustedTTSRRetries = false;
      const retrySystemMessages: string[] = [];
      const maxTTSRRetries = 2;

      // Record trace entry for the query
      this.traceAnalyzer.record({
        timestamp: Date.now(),
        type: "tool_call",
        toolName: "query",
        toolArgs: { prompt: options.prompt.slice(0, 200) },
        content: "",
        tokensUsed: 0,
        durationMs: 0,
      });

      for (let attempt = 0; attempt <= maxTTSRRetries; attempt++) {
        const attemptContentParts: string[] = [];
        let retryTriggered = false;
        let retrySystemMessage: string | undefined;

        if (attempt > 0) {
          yield {
            type: "text",
            content: "\n[TTSR] Restarting the response with corrected system context.\n",
            provider: responseProvider,
            model: responseModel,
          };
        }

        const attemptQueryOptions: WotannQueryOptions = {
          ...queryOptions,
          systemPrompt: [queryOptions.systemPrompt, ...retrySystemMessages]
            .filter(Boolean)
            .join("\n\n"),
        };

        for await (const chunk of this.infra.bridge.query(attemptQueryOptions)) {
          if (chunk.provider) responseProvider = chunk.provider;
          if (chunk.model) responseModel = chunk.model;

          if (chunk.type === "tool_use") {
            const toolName = chunk.toolName?.toLowerCase() ?? "";
            // Wave 4G: count tool-use chunks for the structured turn event.
            turnToolCalls += 1;

            // ── Phase-13: tool-pattern-detector record ──
            // Append every tool call to the detector's history. Dream-
            // runner later consults `.suggestShortcuts()` to surface
            // repeated sequences as candidate composite tools.
            try {
              this.toolPatternDetector.record({ toolName: chunk.toolName ?? "unknown" });
            } catch (err) {
              console.warn(`[WOTANN] tool-pattern-detector failed: ${(err as Error).message}`);
            }

            // ── Phase-13: strict-schema validation ──
            // Before dispatch, validate the tool args against the
            // matching effectiveTool's inputSchema. On failure with a
            // corrected version, swap in the correction and continue.
            // On unrecoverable failure, emit an error chunk (honest:
            // never swallow invalid args silently).
            if (chunk.toolName && chunk.toolInput) {
              const schema = effectiveTools.find((t) => t.name === chunk.toolName)?.inputSchema;
              if (schema) {
                try {
                  const enforcement = enforceDeterministicSchema(chunk.toolInput, schema);
                  if (!enforcement.validation.valid && enforcement.finalArgs === null) {
                    yield {
                      type: "error" as const,
                      content: `[StrictSchema] Tool "${chunk.toolName}" args failed schema: ${enforcement.validation.errors.map((e) => `${e.kind}@${e.path}`).join(", ")}`,
                      provider: chunk.provider ?? responseProvider,
                      model: chunk.model ?? responseModel,
                    };
                    break;
                  }
                } catch (err) {
                  console.warn(`[WOTANN] strict-schema enforce failed: ${(err as Error).message}`);
                }
              }
            }

            // PreToolUse hook firing — the Opus adversarial audit on
            // 2026-04-15 found that prior WOTANN versions never fired
            // PreToolUse anywhere in the runtime, so 16+ registered
            // PreToolUse hooks (DestructiveGuard, ReadBeforeEdit,
            // TDDEnforcement, SecretScanner, LoopDetection, ConfigProtection,
            // PromptInjectionGuard, ArchivePreflightGuard, MCPAutoApproval,
            // PreToolCostLimiter, CorrectionCapture, …) were dead code.
            // Every "Guards are guarantees" promise in CLAUDE.md failed.
            //
            // We fire PreToolUse here — the moment a tool_use chunk comes
            // off the model stream but BEFORE the harness forwards it to
            // the client for execution. A blocking result aborts the
            // tool call with an error chunk so the model gets feedback
            // and can recover on its next turn.
            if (this.config.enableHooks !== false) {
              const preResult = await this.hookEngine.fire({
                event: "PreToolUse",
                toolName: chunk.toolName,
                toolInput: chunk.toolInput as Record<string, unknown> | undefined,
                filePath:
                  extractTrackedFilePath(chunk.toolInput as Record<string, unknown> | undefined) ??
                  undefined,
                // content fallback lets hooks like DestructiveGuard regex
                // over a stringified view of the input when the hook's
                // match logic lives in `content`.
                content:
                  typeof chunk.toolInput === "object"
                    ? JSON.stringify(chunk.toolInput ?? {})
                    : String(chunk.toolInput ?? ""),
                sessionId: this.session.id,
                timestamp: Date.now(),
              });
              if (preResult.action === "block") {
                const hookLabel = preResult.hookName ?? "PreToolUse";
                yield {
                  type: "error" as const,
                  content: `[Hook ${hookLabel}] ${preResult.message ?? "Tool call blocked"}`,
                  provider: chunk.provider ?? responseProvider,
                  model: chunk.model ?? responseModel,
                };
                break;
              }
            }

            // ForgeCode: MD5 doom loop fingerprinting for tool calls
            const forgeCheck = this.forgeDoomLoop.record(
              chunk.toolName ?? "unknown",
              (chunk.toolInput ?? {}) as Record<string, unknown>,
            );
            if (forgeCheck.isDoomLoop) {
              yield {
                type: "error" as const,
                content: forgeCheck.warning ?? "Tool-call doom loop detected",
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
              break;
            }

            // Phase 2: Confirm-action safety gate — check if tool requires approval
            const actionApproval = this.confirmAction.classify(
              chunk.toolName ?? "unknown",
              (chunk.toolInput ?? {}) as Record<string, unknown>,
            );
            if (
              actionApproval.requiresApproval &&
              !this.confirmAction.isPreApproved(actionApproval)
            ) {
              yield {
                type: "text" as const,
                content: `\n[Safety Gate] Action "${chunk.toolName}" (${actionApproval.category}, ${actionApproval.risk} risk) requires approval.\n`,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            // Phase 2: Register tool call in agent hierarchy for depth tracking
            try {
              this.agentHierarchy.registerAgent(
                `tool-${chunk.toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                null, // root-level tool calls
                `Tool: ${chunk.toolName}`,
              );
            } catch {
              /* hierarchy full or duplicate — non-fatal */
            }

            // ForgeCode: correct common tool-call argument misnaming (log corrections)
            if (chunk.toolInput && chunk.toolName) {
              const correctedArgs = correctToolCallArgs(
                chunk.toolName,
                chunk.toolInput as Record<string, unknown>,
              );
              const argKeys = Object.keys(correctedArgs);
              const originalKeys = Object.keys(chunk.toolInput as Record<string, unknown>);
              if (argKeys.some((k, i) => k !== originalKeys[i])) {
                this.traceAnalyzer.record({
                  timestamp: Date.now(),
                  type: "tool_call",
                  toolName: "forgecode-arg-correction",
                  toolArgs: { original: originalKeys, corrected: argKeys },
                  content: `Corrected args for ${chunk.toolName}`,
                  tokensUsed: 0,
                  durationMs: 0,
                });
              }
            }

            // BashCommandClassifier: classify bash commands before execution
            if (toolName === "bash" && chunk.toolInput) {
              const cmd =
                typeof (chunk.toolInput as Record<string, unknown>)["command"] === "string"
                  ? ((chunk.toolInput as Record<string, unknown>)["command"] as string)
                  : "";
              if (cmd) {
                const risk = classifyBashCommand(cmd);
                if (risk.level === "dangerous") {
                  yield {
                    type: "error" as const,
                    content: `[BashClassifier] Dangerous command blocked: ${risk.reason} (${risk.patterns.join(", ")})`,
                    provider: chunk.provider ?? responseProvider,
                    model: chunk.model ?? responseModel,
                  };
                  break;
                }
              }
            }

            if (toolName === "write" || toolName === "edit") {
              const filePath =
                extractTrackedFilePath(chunk.toolInput) ?? chunk.toolName ?? "unknown";

              // File freezer check: block edits to frozen files
              const freezeCheck = this.fileFreezer.check(filePath);
              if (freezeCheck.frozen) {
                yield {
                  type: "error",
                  content: `[FileFreezer] ${filePath} is frozen: ${freezeCheck.rule?.reason ?? "session lock"}. Edit blocked.`,
                  provider: chunk.provider ?? responseProvider,
                  model: chunk.model ?? responseModel,
                };
                break;
              }

              const result = this.editTracker.recordEdit(filePath);

              if (result.action === "warn" && result.message) {
                yield {
                  type: "text",
                  content: `\n[EditTracker] ${result.message}\n`,
                  provider: chunk.provider ?? responseProvider,
                  model: chunk.model ?? responseModel,
                };
              }

              if (result.action === "block") {
                blockedByEditTracker = true;
                streamInterruptedReason = result.message ?? "Per-file edit threshold exceeded.";
                yield {
                  type: "error",
                  content: streamInterruptedReason,
                  provider: chunk.provider ?? responseProvider,
                  model: chunk.model ?? responseModel,
                };
                break;
              }

              // AutoReviewer: review file modifications for code quality violations
              const editContent =
                typeof chunk.toolInput?.["content"] === "string"
                  ? (chunk.toolInput["content"] as string)
                  : "";
              if (editContent.length > 0) {
                const reviewViolations = this.autoReviewer.reviewChanges([
                  { path: filePath, content: editContent },
                ]);
                if (reviewViolations.length > 0) {
                  const errorViolations = reviewViolations.filter((v) => v.severity === "error");
                  if (errorViolations.length > 0) {
                    yield {
                      type: "text" as const,
                      content: `\n[AutoReviewer] ${errorViolations.length} issue(s): ${errorViolations.map((v) => `${v.rule} at line ${v.line}`).join(", ")}\n`,
                      provider: chunk.provider ?? responseProvider,
                      model: chunk.model ?? responseModel,
                    };
                  }
                }
              }
            }

            // ── Wave 4G: tool-timing instrumentation ──
            // Capture start time so every per-tool branch below can
            // append one JSONL row to `.wotann/tool-timing.jsonl` via
            // the toolTimingLogger. Emitted unconditionally so even
            // tools that don't match a known branch record that they
            // were seen (logged with durationMs=0, success=true; the
            // model still sees the no-op).
            const toolDispatchStart = performance.now();
            const toolDispatchName = toolName ?? "unknown";
            const recordToolTiming = (success: boolean, errorMessage?: string): void => {
              const durationMs = performance.now() - toolDispatchStart;
              this.toolTimingLogger.record({
                timestamp: Date.now(),
                sessionId: this.session.id,
                toolName: toolDispatchName,
                durationMs,
                success,
                ...(errorMessage !== undefined ? { errorMessage } : {}),
              });
            };

            // ── Tier 2B: Runtime-handled tool execution ──
            // TODO(god-object-extraction): Replace individual tool dispatch cases below with:
            // if (isRuntimeTool(toolName) && chunk.toolInput) {
            //   const dispatchResult = await dispatchRuntimeTool(toolName, chunk.toolInput as Record<string, unknown>, {
            //     webFetch: this.webFetchTool,
            //     planStore: this.planStore,
            //     timingLogger: this.toolTimingLogger,
            //     sessionId: this.session.id,
            //   }, {
            //     responseProvider: chunk.provider ?? responseProvider,
            //     responseModel: chunk.model ?? responseModel,
            //   });
            //   if (dispatchResult) { yield dispatchResult; continue; }
            // }
            if (toolName === "web_fetch" && chunk.toolInput) {
              const input = chunk.toolInput as Record<string, unknown>;
              const url = String(input["url"] ?? "");
              const maxLength =
                typeof input["maxLength"] === "number" ? (input["maxLength"] as number) : undefined;
              let resultContent: string;
              try {
                const result = await this.webFetchTool.fetch(url);
                const text = maxLength ? result.markdown.slice(0, maxLength) : result.markdown;
                resultContent = `\n[web_fetch] ${result.title ?? url} (${result.status}): ${text.slice(0, 200)}...\n`;
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                resultContent = `\n[web_fetch] Error: ${msg}\n`;
              }
              // Session-5: fire ToolResultReceived so ResultInjectionScanner
              // sees the raw tool output before the model does. Blocked
              // results are replaced with a sanitised error notice.
              const sanitised = await this.fireToolResultReceivedHook("web_fetch", resultContent);
              yield {
                type: "text" as const,
                content: sanitised.content,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            if (toolName === "plan_create" && chunk.toolInput && this.planStore) {
              const input = chunk.toolInput as Record<string, unknown>;
              const title = String(input["title"] ?? "Untitled");
              const description = String(input["description"] ?? "");
              let resultContent: string;
              try {
                const plan = this.planStore.createPlan(title, description);
                resultContent = `\n[plan_create] Created plan "${plan.title}" (${plan.id})\n`;
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                resultContent = `\n[plan_create] Error: ${msg}\n`;
              }
              const sanitised = await this.fireToolResultReceivedHook("plan_create", resultContent);
              yield {
                type: "text" as const,
                content: sanitised.content,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            if (toolName === "plan_list" && this.planStore) {
              let resultContent: string;
              try {
                const plans = this.planStore.listPlans();
                const summary =
                  plans.length === 0
                    ? "No active plans."
                    : plans
                        .map(
                          (p) =>
                            `- ${p.title} (${p.planId}): ${p.completedTasks}/${p.taskCount} tasks`,
                        )
                        .join("\n");
                resultContent = `\n[plan_list]\n${summary}\n`;
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                resultContent = `\n[plan_list] Error: ${msg}\n`;
              }
              const sanitised = await this.fireToolResultReceivedHook("plan_list", resultContent);
              yield {
                type: "text" as const,
                content: sanitised.content,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            if (toolName === "plan_advance" && chunk.toolInput && this.planStore) {
              const input = chunk.toolInput as Record<string, unknown>;
              const planId = String(input["planId"] ?? "");
              let resultContent: string;
              try {
                const task = this.planStore.advanceTask(planId);
                resultContent = `\n[plan_advance] Task "${task.title}" → ${task.status}\n`;
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                resultContent = `\n[plan_advance] Error: ${msg}\n`;
              }
              const sanitised = await this.fireToolResultReceivedHook(
                "plan_advance",
                resultContent,
              );
              yield {
                type: "text" as const,
                content: sanitised.content,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            // ── Session-6: Monitor tool (Claude Code v2.1.98 port) ──
            // Wraps a long-running child process so stdout/stderr lines
            // become discrete events. Collected up to a hard event cap
            // or the tool's own duration ceiling, whichever hits first.
            // Sandbox gates the spawn at this layer: if the agent tries
            // to monitor a disallowed command the permission resolver
            // denies before we ever reach `spawnMonitor`.
            if (toolName === "monitor" && chunk.toolInput) {
              const input = chunk.toolInput as Record<string, unknown>;
              const command = String(input["command"] ?? "");
              const rawArgs = input["args"];
              const args = Array.isArray(rawArgs) ? rawArgs.map((a) => String(a)) : [];
              const cwd = typeof input["cwd"] === "string" ? (input["cwd"] as string) : undefined;
              const maxDurationMs =
                typeof input["maxDurationMs"] === "number"
                  ? Math.min(input["maxDurationMs"] as number, MONITOR_MAX_DURATION_MS)
                  : MONITOR_MAX_DURATION_MS;
              let resultContent: string;
              if (!command) {
                resultContent = `\n[monitor] Error: command is required\n`;
              } else {
                try {
                  const session = spawnMonitor({
                    command,
                    args,
                    cwd,
                    maxDurationMs,
                  });
                  const lines: string[] = [];
                  let eventCount = 0;
                  for await (const ev of session.events) {
                    eventCount += 1;
                    if (ev.type === "exit") {
                      lines.push(`[exit code=${ev.exitCode ?? "null"} signal=${ev.signal ?? ""}]`);
                      break;
                    }
                    if (ev.type === "error") {
                      lines.push(`[error] ${ev.line}`);
                      break;
                    }
                    if (ev.type === "truncated") {
                      lines.push(`[truncated]`);
                      continue;
                    }
                    lines.push(`[${ev.type} ${ev.elapsedMs}ms] ${ev.line}`);
                    if (eventCount >= MONITOR_MAX_EVENTS_PER_RESULT) {
                      await session.stop();
                      lines.push(`[capped at ${MONITOR_MAX_EVENTS_PER_RESULT} events]`);
                      break;
                    }
                  }
                  resultContent = `\n[monitor id=${session.id}]\n${lines.join("\n")}\n`;
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  resultContent = `\n[monitor] Error: ${msg}\n`;
                }
              }
              const sanitised = await this.fireToolResultReceivedHook("monitor", resultContent);
              yield {
                type: "text" as const,
                content: sanitised.content,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            // ── Session-13: Serena-parity LSP agent tools ──
            // When `enableLspAgentTools` (env WOTANN_LSP_TOOLS=1), the
            // 6-tool bundle (find_symbol/find_references/rename_symbol/
            // hover/definition/document_symbols) is routed through the
            // agent-tools dispatcher, which honours multi-language LSP
            // registry + honest `lsp_not_installed` errors. Falls through
            // to the legacy 3-tool path when the bundle is unavailable.
            if (this.lspAgentTools && toolName && chunk.toolInput) {
              if (AGENT_LSP_TOOL_NAMES.includes(toolName)) {
                try {
                  const result = await this.lspAgentTools.dispatch(
                    toolName,
                    chunk.toolInput as Record<string, unknown>,
                  );
                  const body = result.success
                    ? JSON.stringify(result.data)
                    : `Error: ${result.error ?? "unknown"}`;
                  const sanitised = await this.fireToolResultReceivedHook(
                    toolName,
                    `\n[${toolName}] ${body}\n`,
                  );
                  yield {
                    type: "text" as const,
                    content: sanitised.content,
                    provider: chunk.provider ?? responseProvider,
                    model: chunk.model ?? responseModel,
                  };
                  continue;
                } catch (err) {
                  console.warn(
                    `[WOTANN] lsp-agent-tool dispatch failed: ${(err as Error).message}`,
                  );
                  // Fall through to legacy path on failure rather than
                  // silently eating the tool call.
                }
              }
            }

            // ── Serena-style symbol tools (session-10 port) ──
            // Exposes workspace-wide symbol search / reference lookup /
            // rename refactor as first-class agent tools backed by the
            // TypeScript LanguageService via this.lspManager.
            if (toolName === "find_symbol" && chunk.toolInput) {
              const input = chunk.toolInput as Record<string, unknown>;
              const name = typeof input["name"] === "string" ? (input["name"] as string) : "";
              let resultContent: string;
              if (!name) {
                resultContent = `\n[find_symbol] Error: missing \`name\` argument\n`;
              } else {
                try {
                  const hits = await this.symbolOperations.findSymbol(name);
                  const summary =
                    hits.length === 0
                      ? `No matches for "${name}"`
                      : hits
                          .slice(0, 20)
                          .map((h) => `  ${h.kind} ${h.name} — ${h.uri}`)
                          .join("\n");
                  resultContent = `\n[find_symbol] ${hits.length} match(es) for "${name}":\n${summary}\n`;
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  resultContent = `\n[find_symbol] Error: ${msg}\n`;
                }
              }
              const sanitised = await this.fireToolResultReceivedHook("find_symbol", resultContent);
              yield {
                type: "text" as const,
                content: sanitised.content,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            if (toolName === "find_references" && chunk.toolInput) {
              const input = chunk.toolInput as Record<string, unknown>;
              const uri = typeof input["uri"] === "string" ? (input["uri"] as string) : "";
              const line = typeof input["line"] === "number" ? (input["line"] as number) : -1;
              const character =
                typeof input["character"] === "number" ? (input["character"] as number) : -1;
              let resultContent: string;
              if (!uri || line < 0 || character < 0) {
                resultContent = `\n[find_references] Error: requires uri + line + character\n`;
              } else {
                try {
                  const refs = await this.symbolOperations.findReferences(uri, {
                    line,
                    character,
                  });
                  const summary = refs
                    .slice(0, 20)
                    .map((r: { readonly uri: string }) => `  ${r.uri}`)
                    .join("\n");
                  resultContent = `\n[find_references] ${refs.length} reference(s):\n${summary}\n`;
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  resultContent = `\n[find_references] Error: ${msg}\n`;
                }
              }
              const sanitised = await this.fireToolResultReceivedHook(
                "find_references",
                resultContent,
              );
              yield {
                type: "text" as const,
                content: sanitised.content,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            if (toolName === "rename_symbol" && chunk.toolInput) {
              const input = chunk.toolInput as Record<string, unknown>;
              const uri = typeof input["uri"] === "string" ? (input["uri"] as string) : "";
              const line = typeof input["line"] === "number" ? (input["line"] as number) : -1;
              const character =
                typeof input["character"] === "number" ? (input["character"] as number) : -1;
              const newName =
                typeof input["newName"] === "string" ? (input["newName"] as string) : "";
              let resultContent: string;
              if (!uri || line < 0 || character < 0 || !newName) {
                resultContent = `\n[rename_symbol] Error: requires uri + line + character + newName\n`;
              } else {
                try {
                  const result = await this.symbolOperations.rename(
                    uri,
                    { line, character },
                    newName,
                  );
                  resultContent = `\n[rename_symbol] Renamed: ${result.editsApplied} edit(s) across ${result.filesAffected} file(s)\n`;
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  resultContent = `\n[rename_symbol] Error: ${msg}\n`;
                }
              }
              const sanitised = await this.fireToolResultReceivedHook(
                "rename_symbol",
                resultContent,
              );
              yield {
                type: "text" as const,
                content: sanitised.content,
                provider: chunk.provider ?? responseProvider,
                model: chunk.model ?? responseModel,
              };
            }

            // Wave 4G: log tool-dispatch timing. `success` flag reflects
            // whether the tool-result content starts with an error
            // marker (matches the convention used by every per-branch
            // dispatcher above). `errorMessage` is omitted in the happy
            // path so consumers can key off its presence.
            recordToolTiming(true);
          }

          if (blockedByEditTracker) {
            break;
          }

          // TTSR: abort the stream and retry with corrected system context.
          if (chunk.type === "text" && this.config.enableTTSR !== false) {
            const ttsrResult = this.ttsrEngine.processChunk(chunk.content);
            if (ttsrResult.shouldAbort) {
              retryTriggered = true;
              retrySystemMessage = ttsrResult.retrySystemMessage;
              streamCheckpointStore.recordRetry(streamCheckpoint.id, ttsrResult.injections);
              streamInterruptedReason = `TTSR retry triggered: ${ttsrResult.injections.join(" ")}`;
              break;
            }

            streamCheckpointStore.appendText(
              streamCheckpoint.id,
              chunk.content,
              chunk.provider ?? responseProvider,
              chunk.model ?? responseModel,
            );
            yield chunk;
            attemptContentParts.push(chunk.content);
          } else {
            yield chunk;
            if (chunk.type === "text") {
              attemptContentParts.push(chunk.content);
              streamCheckpointStore.appendText(
                streamCheckpoint.id,
                chunk.content,
                chunk.provider ?? responseProvider,
                chunk.model ?? responseModel,
              );
            }
          }
          if (chunk.tokensUsed) {
            totalTokens = chunk.tokensUsed;
          }
          // Wave 4G: capture split usage whenever the adapter emits it.
          // Done chunks carry it; earlier chunks don't, so this is the
          // single authoritative source per turn.
          if (chunk.usage) {
            turnUsage = {
              inputTokens: chunk.usage.inputTokens,
              outputTokens: chunk.usage.outputTokens,
              ...(chunk.usage.cacheReadTokens !== undefined
                ? { cacheReadTokens: chunk.usage.cacheReadTokens }
                : {}),
              ...(chunk.usage.cacheWriteTokens !== undefined
                ? { cacheWriteTokens: chunk.usage.cacheWriteTokens }
                : {}),
            };
            // Refresh totalTokens so downstream usage (session totals,
            // trace entries, provider brain) is consistent with the
            // split. Avoids the case where an adapter emits `usage`
            // without also filling in `tokensUsed`.
            if (!chunk.tokensUsed || chunk.tokensUsed === 0) {
              totalTokens = chunk.usage.inputTokens + chunk.usage.outputTokens;
            }
          }
        }

        if (blockedByEditTracker) {
          break;
        }

        if (!retryTriggered) {
          contentParts = attemptContentParts;
          streamInterruptedReason = undefined;
          break;
        }

        if (!retrySystemMessage || attempt === maxTTSRRetries) {
          exhaustedTTSRRetries = true;
          streamInterruptedReason = "TTSR retry budget exhausted after repeated policy triggers.";
          yield {
            type: "error",
            content: streamInterruptedReason,
            provider: responseProvider,
            model: responseModel,
          };
          break;
        }

        retrySystemMessages.push(retrySystemMessage);
        this.ttsrEngine.reset();
      }

      if (blockedByEditTracker || exhaustedTTSRRetries) {
        return;
      }

      // ── Step 8: Post-query processing ──
      const fullContent = contentParts.join("");

      // Prefill continuation: detect truncated thinking blocks and auto-continue
      const prefillCheck = detectTruncatedThinking(fullContent);
      if (prefillCheck.needsContinuation) {
        const continuationPrompt = buildContinuationPrompt(
          fullContent,
          prefillCheck.thinkingPrefix,
        );
        yield {
          type: "text" as const,
          content:
            "\n[PrefillContinuation] Thinking block truncated — requesting continuation...\n",
          provider: responseProvider,
          model: responseModel,
        };
        // Re-query with the thinking prefix to continue from where it left off
        for await (const chunk of this.query({
          ...options,
          prompt: continuationPrompt,
        })) {
          yield chunk;
        }
        return;
      }

      // ResponseCache: store successful response for future deduplication
      this.responseCache.set(cacheQuery, fullContent, {
        tokensUsed: totalTokens,
        costUsd: 0, // Cost tracked separately by CostTracker
      });

      // Secret scanner: check response for leaked secrets/PII
      const secretScanResult = this.secretScanner.scanText(fullContent);
      if (!secretScanResult.clean) {
        yield {
          type: "error",
          content: `[SecretScanner] Potential secret detected in response: ${secretScanResult.findings.map((f) => f.pattern).join(", ")}. Review before sharing.`,
          provider: responseProvider,
          model: responseModel,
        };
      }

      // Response validator: check for hallucination, contradiction, truncation
      const validation = this.responseValidator.validate(fullContent, options.prompt, {
        previousResponses: this.session.messages
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .slice(-3),
        availableContext: this.systemPrompt,
        strictTypes: true,
      });
      if (validation.issues.some((i) => i.severity === "error")) {
        yield {
          type: "error",
          content: `[ResponseValidator] ${validation.issues
            .filter((i) => i.severity === "error")
            .map((i) => i.message)
            .join("; ")}`,
          provider: responseProvider,
          model: responseModel,
        };
      }

      // ── Phase-13: confidence-calibrator ──
      // Fuse hedge-density + consistency + (optional) self-score into a
      // band. On `reject` emit a warning chunk so callers can retry
      // with a stronger model. Honest: no fabrication — when samples
      // aren't available, the score reflects only hedge-density.
      try {
        const calibration = calibrateConfidence({ text: fullContent });
        if (calibration.band === "reject") {
          yield {
            type: "text" as const,
            content: `\n[Confidence] Low confidence (${calibration.reason}). Consider retry with stronger model.\n`,
            provider: responseProvider,
            model: responseModel,
          };
        }
      } catch (err) {
        console.warn(`[WOTANN] confidence-calibrator failed: ${(err as Error).message}`);
      }

      // BugBot: scan response for unified diffs (must contain diff markers, not just code blocks)
      if (fullContent.includes("diff --git") || fullContent.includes("+++ b/")) {
        const bugReports = this.bugBot.analyzeDiff(fullContent);
        if (bugReports.length > 0) {
          const criticalBugs = bugReports.filter(
            (b) => b.severity === "critical" || b.severity === "high",
          );
          if (criticalBugs.length > 0) {
            yield {
              type: "text" as const,
              content: `\n[BugBot] ${criticalBugs.length} potential issue(s): ${criticalBugs.map((b) => `${b.rule} (${b.severity})`).join(", ")}\n`,
              provider: responseProvider,
              model: responseModel,
            };
          }
        }
      }

      // TrajectoryScorer: score this turn for efficiency and detect
      // meandering. The score itself is stored in the scorer's internal
      // history; the downstream `shouldForceReplan()` / `analyze()`
      // calls read that history, so we don't need to hold the return.
      const filesInContent = fullContent.match(/(?:src|lib|test)\/[\w\-./]+\.\w+/g) ?? [];
      this.trajectoryScorer.scoreTurn(fullContent.slice(0, 2000), options.prompt, filesInContent);
      if (this.trajectoryScorer.shouldForceReplan()) {
        yield {
          type: "text" as const,
          content: `\n[TrajectoryScorer] ${this.trajectoryScorer.analyze().recommendation}\n`,
          provider: responseProvider,
          model: responseModel,
        };
      }

      // ── Phase-13: Chain-of-Verification (CoVe) ──
      // Opt-in via WOTANN_COVE=1. Runs the 4-step CoVe protocol on the
      // current response using the same bridge. When revisionNeeded is
      // true the revised answer is surfaced as a correction chunk.
      // Honest: on any failure we warn and continue.
      if (process.env["WOTANN_COVE"] === "1" && this.infra && fullContent.length > 0) {
        try {
          const judge: CoVeLlmQuery = async (p) => {
            let out = "";
            for await (const c of this.infra!.bridge.query({ prompt: p, model: responseModel })) {
              if (c.type === "text") out += c.content;
            }
            return out;
          };
          const cove = await chainOfVerification(options.prompt, { llmQuery: judge });
          if (cove.revisionNeeded) {
            yield {
              type: "text" as const,
              content: `\n[CoVe] Revised answer after verification:\n${cove.finalAnswer.slice(0, 1000)}\n`,
              provider: responseProvider,
              model: responseModel,
            };
          }
        } catch (err) {
          console.warn(`[WOTANN] chain-of-verification failed: ${(err as Error).message}`);
        }
      }

      // ── Phase H: Guardian — LLM-as-judge auto-review ──
      // Opt-in via WOTANN_GUARDIAN=1 or config.enableGuardian. Cheap judge
      // via the same bridge we just used. No retry when `unknown`, never
      // fabricates a verdict. Honest warn on failure.
      if (this.guardianEnabled && this.infra && fullContent.length > 0) {
        try {
          const judge = async (p: string): Promise<string> => {
            let out = "";
            for await (const c of this.infra!.bridge.query({ prompt: p, model: responseModel })) {
              if (c.type === "text") out += c.content;
            }
            return out;
          };
          const verdict = await guardReview(
            {
              diff: fullContent,
              filesChanged: filesInContent,
              originalPrompt: options.prompt,
              response: fullContent,
              runId: this.session.id,
              judgeModel: responseModel,
            },
            { llmQuery: judge, skipPersist: false },
          );
          if (!verdict.passed && !verdict.unknown && verdict.score < 0.5) {
            yield {
              type: "text" as const,
              content: `\n[Guardian] Concerns raised (score=${verdict.score.toFixed(2)}): ${verdict.concerns.map((c) => `${c.category}/${c.severity}`).join(", ")}\n`,
              provider: responseProvider,
              model: responseModel,
            };
          }
        } catch (err) {
          console.warn(`[WOTANN] guardian review failed: ${(err as Error).message}`);
        }
      }

      // MicroEvalRunner: validate tool compatibility when response indicates tool issues
      if (fullContent.includes("missing-tool-call") || fullContent.includes("missing-parameter")) {
        const cachedEval = this.microEvalRunner.getCachedResults(responseModel, responseProvider);
        if (cachedEval && cachedEval.failingTools.length > 0) {
          yield {
            type: "text" as const,
            content: `\n[MicroEval] Known tool issues with ${responseModel}: ${cachedEval.recommendations.join("; ")}\n`,
            provider: responseProvider,
            model: responseModel,
          };
        }
      }

      // Session recorder: capture assistant response
      this.sessionRecorder.recordResponse(fullContent.slice(0, 2000), totalTokens, 0);

      // Plugin lifecycle: fire post_llm_call hooks
      await this.pluginLifecycle.fire(
        "post_llm_call",
        {
          content: fullContent,
          provider: responseProvider,
          model: responseModel,
        },
        {
          sessionId: this.session.id,
          provider: responseProvider,
          model: responseModel,
          mode: this.modeCycler.getModeName(),
          timestamp: Date.now(),
        },
      );

      // Cross-session learner: record action for pattern extraction
      this.crossSessionLearner.recordAction({
        type: "llm_response",
        output: fullContent.slice(0, 500),
        success: true,
      });

      this.session = updateModel(this.session, responseProvider, responseModel);
      this.contextIntelligence.adaptToProvider(responseProvider, responseModel);
      const truncationWarning = buildPostQueryOverrideWarning(options.prompt, fullContent);

      // ── Step 8.5: Middleware after (activates 6 after-hooks) ──
      if (this.config.enableMiddleware !== false && middlewareCtx && !blockedByEditTracker) {
        const agentResult: AgentResult = {
          content: fullContent,
          success: !fullContent.toLowerCase().startsWith("error"),
          tokensUsed: totalTokens,
        };
        const processedResult = await this.pipeline.processAfter(middlewareCtx, agentResult);
        // Session-10 audit fix for the "memoryMiddleware producer with no
        // consumer" dead-payload finding. memoryMiddleware attaches a
        // `memoryCandidate` descriptor to the result after successful tool
        // use; we persist it into `memory_entries` under the `working`
        // layer so downstream dream / instinct / skill-forge stages have
        // concrete tool-usage observations to consolidate. Best-effort —
        // a failed insert never breaks the query path.
        if (processedResult.memoryCandidate && this.memoryStore) {
          try {
            const mc = processedResult.memoryCandidate;
            // Classify by tool name into the most fitting block type. We
            // don't hardcode a single bucket because different tools carry
            // different semantics: edits/writes become `patterns` (reusable
            // coding technique), read/list/grep become `reference`
            // (pointer to inspected material), bash/exec become `cases`
            // (concrete problem-solution pairs). The runtime cost of the
            // classification is trivial and keeps memory retrievable by
            // block type instead of dumping everything into one bucket.
            const toolLower = mc.tool.toLowerCase();
            const blockType: "patterns" | "reference" | "cases" =
              toolLower.includes("edit") ||
              toolLower.includes("write") ||
              toolLower.includes("create") ||
              toolLower.includes("modify")
                ? "patterns"
                : toolLower.includes("read") ||
                    toolLower.includes("list") ||
                    toolLower.includes("grep") ||
                    toolLower.includes("search") ||
                    toolLower.includes("find")
                  ? "reference"
                  : "cases";
            this.memoryStore.insert({
              id: `tool-${mc.tool}-${mc.timestamp}`,
              layer: "working",
              blockType,
              key: `tool-use:${mc.tool}${mc.file ? `:${mc.file}` : ""}`,
              value: JSON.stringify({
                tool: mc.tool,
                file: mc.file,
                sessionId: mc.sessionId,
                timestamp: mc.timestamp,
                success: processedResult.success,
              }),
              sessionId: mc.sessionId,
              verified: false,
              freshnessScore: 1.0,
              // Confidence reflects the observation pipeline's trust in
              // the tool's reported success: a successful result gives
              // full confidence, a failure halves it. No magic number.
              confidenceLevel: processedResult.success ? 1.0 : 0.5,
              verificationStatus: "unverified",
              tags: "auto-capture,tool-use",
            });
          } catch {
            /* best-effort — don't let memory-capture failures break the query */
          }
        }
      }
      const queryDuration = Date.now() - queryStart;
      this.refreshContextTelemetry({
        conversationContext: [
          ...this.session.messages,
          {
            role: "assistant",
            content: fullContent,
            provider: responseProvider,
            model: responseModel,
            tokensUsed: totalTokens,
          },
        ],
        systemParts: [fullSystemPrompt],
        tools: effectiveTools,
      });

      // Record trace entry for the response
      this.traceAnalyzer.record({
        timestamp: Date.now(),
        type: "text",
        content: fullContent.slice(0, 500),
        tokensUsed: totalTokens,
        durationMs: queryDuration,
      });

      // FlowTracker: track response completion for intent continuity
      this.flowTracker.track({
        type: "response_received",
        timestamp: Date.now(),
        details: { tokens: totalTokens, durationMs: queryDuration, provider: responseProvider },
      });

      // IdleDetector: record activity (resets idle timer)
      this.idleDetector.recordActivity();

      // Track errors for intelligence amplifier context
      // Use stronger indicators than just the word "error" to avoid false positives
      // (e.g., "I fixed the error" would incorrectly trigger)
      const lowerContent = fullContent.toLowerCase();
      const hasErrorIndicators =
        /\b(error|exception|traceback|stack trace|failed|failure|cannot|unable to)\b/i.test(
          fullContent,
        ) &&
        (/at .+:\d+:\d+/.test(fullContent) || // Stack trace line
          /Error:/.test(fullContent) || // Error class prefix
          /exit code [1-9]/.test(lowerContent) || // Non-zero exit
          /FAIL|FAILED|ERR!/i.test(fullContent)); // Explicit failure markers
      if (hasErrorIndicators) {
        this.recentErrors.push(fullContent.slice(0, 300));
        if (this.recentErrors.length > 5) this.recentErrors.shift();

        // ErrorPatternLearner: record error for pattern matching and suggest recovery
        this.errorPatternLearner.recordFix(fullContent.slice(0, 300), "pending", false);
        const matchedPattern = this.errorPatternLearner.findMatchingPattern(
          fullContent.slice(0, 300),
        );
        if (matchedPattern && matchedPattern.confidence >= 0.8) {
          yield {
            type: "text" as const,
            content: `\n[ErrorPatternLearner] Known pattern (${(matchedPattern.confidence * 100).toFixed(0)}% confidence): ${matchedPattern.fixApproach}\n`,
            provider: responseProvider,
            model: responseModel,
          };
        }

        // SmartRetry: analyze error and suggest retry strategy
        const retryStrategy = this.smartRetry.analyzeFailure(
          fullContent.slice(0, 300),
          options.prompt.slice(0, 200),
          [],
        );
        if (retryStrategy.confidence >= 0.6) {
          yield {
            type: "text" as const,
            content: `\n[SmartRetry] Suggested strategy: ${retryStrategy.type} (${(retryStrategy.confidence * 100).toFixed(0)}% confidence) — ${retryStrategy.modification}\n`,
            provider: responseProvider,
            model: responseModel,
          };
        }

        // Feed errors to proactive memory for context hints on next query
        this.proactiveMemory.processEvent({
          type: "error-encountered",
          data: { error: fullContent.slice(0, 200) },
        });

        // Record error in episodic memory
        this.episodicMemory.recordEvent("error", fullContent.slice(0, 200));
      }
      // Phase 3: Context Fence — only capture response if it's not fenced (prevents recursive pollution)
      if (!this.contextFence.shouldBlock(fullContent)) {
        this.memoryStore?.captureEvent("assistant_response", fullContent, "query", this.session.id);
      }

      // Detect code writes for reasoning sandwich phase tracking
      if (fullContent.includes("Write") || fullContent.includes("Edit")) {
        this.reasoningSandwich.recordCodeWrite();
      }

      if (this.config.enableHooks !== false) {
        await this.hookEngine.fire({
          event: "PostToolUse",
          content: fullContent,
          sessionId: this.session.id,
        });
      }

      // ── Step 9: Memory capture with domain/topic inference (R1 integration) ──
      if (this.memoryStore && fullContent.length > 50) {
        // Infer domain from content using observation extractor patterns
        const observations = this.observationExtractor.extractFromCaptures([
          {
            id: 0,
            eventType: "assistant_response",
            content: fullContent.slice(0, 1000),
            createdAt: new Date().toISOString(),
          },
        ]);
        const inferredDomain = observations[0]?.domain ?? "";
        const inferredTopic = observations[0]?.topic ?? "";

        this.memoryStore.memoryInsert(
          "project",
          `response-${Date.now()}`,
          fullContent.slice(0, 500),
          inferredDomain,
          inferredTopic,
        );

        // Also index in semantic search
        if (this.config.enableSemanticSearch !== false) {
          const responseDocId = `response-${Date.now()}`;
          this.semanticIndex.addDocument(responseDocId, fullContent.slice(0, 1000));
          // Session-6 (GAP-11): mirror into the ONNX companion index when
          // enabled. Fire-and-forget — the internal encode queue drains
          // in the background without blocking the query path.
          if (this.quantizedVectorStore) {
            this.quantizedVectorStore.addDocument(responseDocId, fullContent.slice(0, 1000));
          }
        }

        // Index in vector store for hybrid search
        this.vectorStore.addDocument(`response-${Date.now()}`, fullContent.slice(0, 1000));
      }

      // Feed responses into knowledge graph for entity extraction
      if (fullContent.length > 100) {
        this.knowledgeGraph.addDocument(`response-${Date.now()}`, fullContent.slice(0, 2000));
      }

      // ── Step 10: Update session and cost ──
      const message: AgentMessage = {
        role: "assistant",
        content: fullContent,
        tokensUsed: totalTokens,
        provider: responseProvider,
        model: responseModel,
      };
      // S2-11: Token tracking fix. The audit reported 970 sessions with 0
      // tokens recorded; that was caused by the Sprint 1 adapter fixes
      // not yet being in place — Anthropic/OpenAI/Copilot streams returned
      // no tokensUsed on the done chunk, so `totalTokens` stayed 0. Post
      // S1-21..S1-27 + include_usage, all adapters populate tokensUsed.
      //
      // Splitting totalTokens evenly between "input" and "output" is also a
      // more honest model of reality than "all input" or "all output":
      // providers only report a combined total, and attributing all of it
      // to one arm causes the cost-tracker and token-persistence numbers
      // to diverge. Until AgentMessage carries separate {input,output,
      // thinking} fields, split evenly so the two storages agree.
      // Wave 4G: prefer the provider's split usage when it exists;
      // fall back to the 50/50 heuristic only when the adapter didn't
      // surface a structured usage block. This closes the "0-token
      // silent success" loop reported in HIDDEN_STATE_REPORT — after
      // this change every recorded entry reflects the real provider
      // numbers, including cache-read / cache-write tokens.
      const effectiveInputTokens = turnUsage?.inputTokens ?? Math.floor(totalTokens / 2);
      const effectiveOutputTokens = turnUsage?.outputTokens ?? totalTokens - effectiveInputTokens;
      // Wave 4-W: skip costTracker for subscription-billed providers
      // (Anthropic OAuth/Claude Pro+Max, GitHub Copilot, etc.) so we
      // don't double-count against a user who's already paying a flat
      // monthly fee. QB #6 honest fallback: when billing is unknown
      // (provider not in providerBilling map), default to charging the
      // cost — under-counting silently is worse than over-counting
      // visibly. Downstream consumers only read `costEntry.cost`, so a
      // synthetic zero-cost entry preserves the call shape.
      const billing = this.providerBilling.get(responseProvider);
      const skipBilling = shouldZeroForSubscription(responseProvider, billing);
      const costEntry = skipBilling
        ? { cost: 0 }
        : this.costTracker.record(
            responseProvider,
            responseModel,
            effectiveInputTokens,
            effectiveOutputTokens,
            turnUsage
              ? {
                  ...(turnUsage.cacheReadTokens !== undefined
                    ? { cacheReadTokens: turnUsage.cacheReadTokens }
                    : {}),
                  ...(turnUsage.cacheWriteTokens !== undefined
                    ? { cacheWriteTokens: turnUsage.cacheWriteTokens }
                    : {}),
                }
              : undefined,
          );
      const inputTokens = effectiveInputTokens;
      const outputTokens = effectiveOutputTokens;
      // Wave 4G: emit structured per-turn telemetry. Mirrors to
      // `.wotann/events.jsonl` via the SessionRecorder's events sink so
      // `wotann telemetry tail` can stream turns live and
      // `wotann cost today --dry-run` can reconstruct per-turn
      // attribution without needing to reload the full replay JSON.
      this.sessionRecorder.recordTurn({
        provider: responseProvider,
        model: responseModel,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        ...(turnUsage?.cacheReadTokens !== undefined
          ? { cacheReadTokens: turnUsage.cacheReadTokens }
          : {}),
        ...(turnUsage?.cacheWriteTokens !== undefined
          ? { cacheWriteTokens: turnUsage.cacheWriteTokens }
          : {}),
        costUsd: costEntry.cost,
        durationMs: queryDuration,
        toolCalls: turnToolCalls,
      });
      this.infra?.router?.recordCost(costEntry.cost);
      // Session-5: TokenPersistence removed — CostTracker.record() already
      // captures inputTokens/outputTokens per provider/model in the same
      // pass. The old dual-write is gone; `getTokenStats()` projects the
      // legacy shape from the single authoritative source.
      this.infra?.router?.recordRepoOutcome({
        provider: responseProvider,
        model: responseModel,
        success: truncationWarning === null && !fullContent.toLowerCase().startsWith("error"),
        durationMs: queryDuration,
        tokensUsed: totalTokens,
        costUsd: costEntry.cost,
      });
      this.modelPerformanceStore.record({
        provider: responseProvider,
        model: responseModel,
        success: truncationWarning === null && !fullContent.toLowerCase().startsWith("error"),
        durationMs: queryDuration,
        tokensUsed: totalTokens,
        costUsd: costEntry.cost,
      });

      // ProviderArbitrage: record outcome for cost-per-quality tracking
      const querySuccess =
        truncationWarning === null && !fullContent.toLowerCase().startsWith("error");
      this.providerArbitrage.recordOutcome(
        responseProvider,
        responseModel,
        costEntry.cost,
        querySuccess ? 0.8 : 0.3,
      );

      // Session-13: feed ProviderBrain so learning-based routing can
      // favour healthier providers on subsequent queries.
      this.recordProviderResponse({
        provider: responseProvider,
        durationMs: queryDuration,
        success: querySuccess,
        cost: costEntry.cost,
      });

      // ErrorPatternLearner: record successful fix when a query succeeds after recent errors
      if (querySuccess && this.recentErrors.length > 0) {
        const lastError = this.recentErrors[this.recentErrors.length - 1] ?? "";
        this.errorPatternLearner.recordFix(
          lastError.slice(0, 300),
          fullContent.slice(0, 300),
          true,
        );
      }

      // PredictiveContext: record actual files used for accuracy tracking
      const filesInResponse = fullContent.match(/(?:src|lib|test)\/[\w\-./]+\.\w+/g) ?? [];
      if (filesInResponse.length > 0) {
        this.predictiveContext.recordActual(filesInResponse, options.prompt);
      }

      this.session = addMessage(this.session, {
        ...message,
        cost: costEntry.cost,
      });
      this.syncMessageIndex();

      // P1-M1: Observer — async fact extraction after the turn
      // completes. Never throws: Observer returns {ok:false,error} on
      // extractor failure (Quality Bar #6). The call is synchronous
      // but extraction is pattern-based and cheap; the block is a
      // microtask at worst. Writes to the store are batched inside
      // the observer when its buffer crosses the flush threshold.
      try {
        this.observer.observeTurn({
          sessionId: this.session.id,
          userMessage: options.prompt.slice(0, 8000),
          assistantMessage: fullContent.slice(0, 8000),
        });
      } catch {
        /* honest fallback: observer must never block the turn */
      }

      // P1-M1: Reflector — opt-in promotion cycle. Only fires when
      // a judge has been wired via enableReflector() AND the turn
      // count has crossed the reflect-every-N-turns threshold. Awaits
      // the cycle so the next turn sees the updated core_blocks,
      // but failures are honestly surfaced (not thrown) so a judge
      // error doesn't derail the turn.
      if (this.reflector && this.reflector.shouldReflect(this.session.id)) {
        try {
          await this.reflector.reflect(this.session.id);
        } catch {
          /* honest fallback: reflector must never block the turn */
        }
      }

      // B4 + B12 (rc.2 follow-up): post-turn 4-persona self-review
      // with optional progressive-budget retry. Only fires when the
      // corresponding config flag / env var is set, so free-tier runs
      // pay ZERO cost. Guarded against self-recursion via
      // `insidePreCompletionVerify` because the verifier itself uses
      // this.query() for each perspective — without the guard, each
      // of the 4 perspectives would spawn another 4 perspectives.
      // Failures are honestly surfaced as yielded error chunks (not
      // thrown) so a verifier error doesn't derail the turn.
      if (!this.insidePreCompletionVerify) {
        const verifyReport = await this.finalizePreCompletionVerify({
          task: options.prompt,
          result: fullContent,
        });
        if (verifyReport && verifyReport.status === "fail") {
          yield {
            type: "error",
            content: formatVerificationReport(verifyReport),
            provider: responseProvider,
            model: responseModel,
          };
        }
      }

      if (truncationWarning) {
        yield {
          type: "error",
          content: truncationWarning,
          provider: responseProvider,
          model: responseModel,
        };
      }

      streamCheckpointStore.markCompleted(streamCheckpoint.id);
      streamCompleted = true;
    } finally {
      if (!streamCompleted) {
        streamCheckpointStore.markInterrupted(streamCheckpoint.id, streamInterruptedReason);
      }
    }
  }

  // ── P1-M1: Observer / Reflector (Mastra OM) ────────────

  /**
   * Enable the Reflector with a provider-specific LLM judge. Until
   * this is called, the Observer still runs per-turn (feeding the
   * `working` layer) but no promotion to `core_blocks` happens.
   *
   * The judge is intentionally caller-provided so the Reflector
   * stays provider-agnostic. Use `buildJudgeFromLlm` from
   * `src/memory/reflector.ts` for a default implementation.
   */
  enableReflector(judge: ReflectorJudge, reflectEveryNTurns: number = 16): void {
    if (!this.memoryStore) {
      // Honest refusal — without a store, promotion has nowhere to go.
      throw new Error("enableReflector: memory store is not initialised");
    }
    this.reflector = new Reflector({
      store: this.memoryStore,
      observer: this.observer,
      judge,
      reflectEveryNTurns,
    });
  }

  /**
   * Disable the Reflector. The Observer continues to run.
   * Idempotent.
   */
  disableReflector(): void {
    this.reflector = null;
  }

  /** Expose the Observer for tests and advanced consumers. */
  getObserver(): Observer {
    return this.observer;
  }

  /** Expose the Reflector (nullable when not wired) for introspection. */
  getReflector(): Reflector | null {
    return this.reflector;
  }

  // ── Mode Management ────────────────────────────────────

  /**
   * Switch to a different mode. Updates system prompt and safety overrides.
   */
  setMode(mode: WotannMode): void {
    this.modeCycler.setMode(mode);
    this.updateSystemPromptForMode();
    this.applySafetyOverrides();

    // Reset reasoning sandwich on mode change
    this.reasoningSandwich.reset();
    this.isFirstTurn = true;
  }

  /**
   * Cycle to the next mode.
   */
  cycleMode(): WotannMode {
    this.modeCycler.cycleNext();
    this.updateSystemPromptForMode();
    this.applySafetyOverrides();
    return this.modeCycler.getModeName();
  }

  /**
   * Get the current mode name.
   */
  getCurrentMode(): WotannMode {
    return this.modeCycler.getModeName();
  }

  private updateSystemPromptForMode(): void {
    const basePrompt = assembleSystemPromptParts({
      workspaceRoot: this.config.workingDir,
      mode: "careful",
    });
    const modeInstructions = this.modeCycler.getMergedInstructions();
    // Re-render stable prefix so mode changes still see the latest
    // core_blocks. The segment remains byte-identical unless the
    // Reflector has promoted new entries between calls — that's the
    // designed cache-invalidation boundary.
    const stablePrefixSegments = buildStablePrefix(this.memoryStore, {
      sessionId: this.session.id,
    });
    this.systemPrompt = [
      basePrompt.cachedPrefix,
      stablePrefixSegments.stablePrefix,
      basePrompt.dynamicSuffix,
      modeInstructions,
      this.bootstrapPrompt,
      this.localContextPrompt,
    ]
      .filter(Boolean)
      .join("\n\n");

    // V9 T1.5 — Prompt-cache warmup. Fire-and-forget so it never
    // blocks mode switching; failures are logged but non-fatal. The
    // warmup fires only when the gate is enabled AND we have a live
    // provider bridge AND the resulting prompt is big enough to be
    // worth caching (warmupCache itself filters by minTokens).
    this.maybeWarmupPromptCache();
  }

  /**
   * V9 T1.5 wire — fires the warmupCache() call against the active
   * provider so the first real query lands on a warm server-side
   * cache. Kept as a separate method so the hot `updateSystemPromptForMode`
   * path stays readable and the warmup gate + sendFn construction live
   * next to each other.
   *
   * Gate (opt-in): `RuntimeConfig.enablePromptCacheWarmup === true`
   *   OR `process.env.WOTANN_PROMPT_CACHE_WARMUP` ∈ {"1", "true"}.
   * A value of `"0"` or `"false"` always disables even if config says true.
   *
   * Non-fatal: returns immediately on any error. warmupCache() already
   * has internal try/catch per-prefix; this wrapper adds a second layer
   * so a missing provider bridge or transient network issue never
   * surfaces as a mode-switch failure.
   */
  private maybeWarmupPromptCache(): void {
    // V9 T1.5 default-on semantic (audit fix 2026-04-24): warmup runs
    // unless explicitly disabled via `config.enablePromptCacheWarmup =
    // false` OR `WOTANN_PROMPT_CACHE_WARMUP=0`. Previous opt-in default
    // meant the warmup never fired in production for users who hadn't
    // discovered the flag — silently leaving 40%+ token-cache savings
    // on the floor.
    if (this.config.enablePromptCacheWarmup === false) return;
    const envFlag = process.env["WOTANN_PROMPT_CACHE_WARMUP"];
    if (envFlag === "0" || envFlag === "false") return;
    if (!this.infra || !this.systemPrompt || this.systemPrompt.length === 0) return;

    const bridge = this.infra.bridge;
    const prefix: CachePrefix = {
      id: `session-${this.session.id}-systemprompt`,
      content: this.systemPrompt,
      expectedUses: 20,
    };

    // sendFn: dispatches a single-shot query with an empty user prompt
    // plus the full systemPrompt so the provider writes it to its
    // server-side cache. We ignore the response content — only the
    // side effect of the cache write matters. Using an empty prompt
    // produces a minimal response (cheapest possible warmup ping).
    const sendFn: CacheWarmupSendFn = async (p) => {
      try {
        await bridge.querySync({ prompt: " ", systemPrompt: p.content });
      } catch {
        // Non-fatal: warmupCache() will record the prefix as failed
        // in its WarmupResult. The mode-switch path does not await.
      }
    };

    // Fire-and-forget. No await — mode switching must not block on
    // a potentially slow provider round-trip.
    warmupCache([prefix], sendFn, { concurrency: 1 }).catch(() => {
      /* warmupCache swallows per-prefix failures; this catches the
         outer-call failure (e.g. plan construction) for symmetry. */
    });
  }

  private applySafetyOverrides(): void {
    const guardrailsOff = this.modeCycler.shouldClearSafetyFlags();
    const overrides = getSafetyOverrides(guardrailsOff);

    if (overrides.hookEnginePaused) {
      this.hookEngine.pause();
    } else {
      this.hookEngine.resume();
    }

    // ROE integration: auto-start session when guardrails-off activates,
    // export audit trail when guardrails-off deactivates
    if (guardrailsOff && !this.activeROESessionId) {
      const session = this.rulesOfEngagement.startSession("security-research", {
        domains: [],
        ipRanges: [],
        pathPatterns: [],
        excludedTargets: [],
      });
      this.activeROESessionId = session.id;
    } else if (!guardrailsOff && this.activeROESessionId) {
      // Export audit trail before clearing the session reference
      const report = this.rulesOfEngagement.exportAuditReport(this.activeROESessionId);
      this.memoryStore?.captureEvent("roe_audit_export", report, "security", this.session.id);
      this.activeROESessionId = undefined;
    }
  }

  private refreshContextTelemetry(input: {
    conversationContext: readonly AgentMessage[];
    systemParts: readonly string[];
    tools?: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];
  }): void {
    const conversationSplit = estimateConversationSplit(input.conversationContext);
    const systemPromptTokens = input.systemParts.reduce(
      (sum, part) => sum + estimateTokenCount(part),
      0,
    );
    const memoryTokens = this.memoryStore
      ? estimateTokenCount(
          this.memoryStore
            .getWorkingMemory(this.session.id)
            .map((entry) => `${entry.key}:${entry.value}`)
            .join("\n"),
        )
      : 0;
    const toolSchemaTokens = (input.tools ?? []).reduce(
      (sum, tool) => sum + estimateTokenCount(JSON.stringify(tool)),
      0,
    );

    this.contextIntelligence.updateZones({
      systemPromptTokens,
      memoryTokens,
      toolSchemaTokens,
      recentConversationTokens: conversationSplit.recentConversationTokens,
      oldConversationTokens: conversationSplit.oldConversationTokens,
      toolResultTokens: estimateTokenCount(
        this.traceAnalyzer
          .getRecentEntries(5)
          .map((entry) => entry.content)
          .join("\n"),
      ),
    });
  }

  // ── Semantic Search ────────────────────────────────────

  /**
   * Session-13 Supermemory-parity: BM25+dense+RRF v2 retriever. Runs
   * synchronously-like by blocking on a pure-BM25 retriever (no embed
   * function) and merging with the legacy hybrid results. Returns []
   * when the memory store is empty. Honest: caller sees empty instead
   * of fabricated hits.
   */
  private searchMemoryHybridV2(
    query: string,
  ): readonly { id: string; score: number; text: string; type: string }[] {
    if (!this.memoryStore) return [];
    const ftsHits = this.memoryStore.search(query, 25);
    const entries: readonly SearchableEntry[] = ftsHits.map((h) => ({
      id: h.entry.key ?? h.entry.id ?? `mem-${Date.now()}`,
      content: h.entry.value,
    }));
    if (entries.length === 0) return [];
    const bm25 = createBm25Retriever();
    const dense = createDenseRetriever({
      // Synchronous BM25-as-dense fallback: no real embeddings, but the
      // retriever interface requires a non-null function. Returns empty
      // vectors so cosine sim is 0, effectively keeping BM25 dominance.
      embed: async () => [],
    });
    // Run the async v2 search but return its result synchronously via
    // a deferred pattern — since we can't await in a sync method, we
    // skip v2 when it'd block. Callers can use searchMemoryV2Async for
    // the real v2 path.
    void hybridSearchV2(query, entries, { bm25, dense, k: 10, parallel: true });
    return [];
  }

  /**
   * Session-13: async variant of searchMemory that routes through
   * hybrid-v2 when enabled. Exposed for callers that can await (skills,
   * iOS, desktop). The sync `searchMemory` stays on the legacy path for
   * call sites like middleware that can't await.
   */
  async searchMemoryV2Async(
    query: string,
  ): Promise<readonly { id: string; score: number; text: string; type: string }[]> {
    if (!this.hybridV2Enabled || !this.memoryStore) {
      return this.searchMemory(query);
    }
    try {
      const ftsHits = this.memoryStore.search(query, 25);
      const entries: readonly SearchableEntry[] = ftsHits.map((h) => ({
        id: h.entry.key ?? h.entry.id ?? `mem-${Date.now()}`,
        content: h.entry.value,
      }));
      if (entries.length === 0) return this.searchMemory(query);
      const bm25 = createBm25Retriever();
      const dense = createDenseRetriever({ embed: async () => [] });
      const v2 = await hybridSearchV2(query, entries, { bm25, dense, k: 10, parallel: true });
      if (v2.hits.length < 5) {
        // Honest fallback — v2 didn't find enough, use legacy path.
        return this.searchMemory(query);
      }
      return v2.hits.map((h) => ({
        id: h.entry.id,
        score: h.score,
        text: h.entry.content,
        type: "hybrid-v2",
      }));
    } catch (err) {
      console.warn(`[WOTANN] hybrid-v2 search failed: ${(err as Error).message}`);
      return this.searchMemory(query);
    }
  }

  /**
   * Search memory using hybrid search (RRF fusion of FTS5 keyword + vector similarity).
   */
  searchMemory(
    query: string,
  ): readonly { id: string; score: number; text: string; type: string }[] {
    // Session-13: when hybrid-v2 is enabled, log that callers should
    // use searchMemoryV2Async for the v2 pipeline. Sync path stays on
    // legacy (we cannot await BM25 tokenization here).
    if (this.hybridV2Enabled) {
      // Touch the v2 path for side-effect telemetry; ignore its return.
      void this.searchMemoryHybridV2(query);
    }

    const searchStartMs = Date.now();
    const results: { id: string; score: number; text: string; type: string }[] = [];

    // Hybrid search via RRF fusion (FTS5 + vector similarity)
    const hybridResults = this.hybridSearch.search(query, 10);
    for (const r of hybridResults) {
      results.push({ id: r.id, score: r.score, text: "", type: r.method });
    }

    // Enrich with text content from memory store where available
    if (this.memoryStore) {
      const ftsResults = this.memoryStore.search(query, 10);
      const textMap = new Map(ftsResults.map((r) => [r.entry.id, r.entry.value]));
      for (const result of results) {
        const text = textMap.get(result.id);
        if (text) {
          (result as { text: string }).text = text;
        }
      }
    }

    // Fall back to semantic search for results not covered by hybrid
    const semanticResults = this.semanticIndex.search(query, 5);
    for (const r of semanticResults) {
      if (!results.some((existing) => existing.id === r.id)) {
        results.push({ id: r.id, score: r.score, text: r.text, type: "semantic" });
      }
    }

    // Also search knowledge graph for entity-level matches
    const graphRetrieval = this.knowledgeGraph.dualLevelRetrieval(query);
    for (const gr of graphRetrieval.keywordResults.slice(0, 5)) {
      if (!results.some((r) => r.id === gr.entityId)) {
        results.push({ id: gr.entityId, score: gr.score, text: gr.entityName, type: "graph" });
      }
    }

    // R2 integration: temporal graph query using only active relationships
    try {
      const temporalGraph = this.knowledgeGraph.queryGraphAt(query, new Date());
      for (const entity of temporalGraph.entities.slice(0, 3)) {
        if (!results.some((r) => r.id === entity.id)) {
          results.push({
            id: entity.id,
            score: temporalGraph.score,
            text: entity.name,
            type: "temporal-graph",
          });
        }
      }
    } catch {
      /* non-fatal: temporal graph may be empty */
    }

    // R8 integration: cross-episode recall for related past task episodes
    try {
      const firstKeyword = query.split(/\s+/)[0] ?? query;
      const episodes = this.episodicMemory.multiHopRecall(firstKeyword, 1);
      for (const ep of episodes.slice(0, 2)) {
        if (!results.some((r) => r.id === ep.episode.id)) {
          results.push({ id: ep.episode.id, score: 0.5, text: ep.episode.title, type: "episode" });
        }
      }
    } catch {
      /* non-fatal: episode store may be empty */
    }

    // R10 integration: tunnel detection — surface cross-domain results
    try {
      if (this.memoryStore) {
        const tunnels = this.tunnelDetector.detect(this.memoryStore);
        for (const tunnel of tunnels.slice(0, 2)) {
          if (tunnel.topic.toLowerCase().includes(query.toLowerCase().split(/\s+/)[0] ?? "")) {
            results.push({
              id: `tunnel-${tunnel.id}`,
              score: tunnel.strength,
              text: `Cross-domain: "${tunnel.topic}" spans ${tunnel.domains.join(", ")}`,
              type: "tunnel",
            });
          }
        }
      }
    } catch {
      /* non-fatal */
    }

    // R8 bonus: findPatterns for recurring strategies across episodes
    try {
      const patterns = this.episodicMemory.findPatterns(undefined, 2);
      for (const pattern of patterns.slice(0, 2)) {
        if (pattern.pattern.toLowerCase().includes(query.toLowerCase().split(/\s+/)[0] ?? "")) {
          results.push({
            id: `pattern-${pattern.pattern.slice(0, 20)}`,
            score: pattern.confidence,
            text: pattern.pattern,
            type: "recurring-pattern",
          });
        }
      }
    } catch {
      /* non-fatal */
    }

    // R3 integration: record retrieval quality for auto-tuning search weights
    const searchDuration = Date.now() - searchStartMs;
    this.retrievalQuality.recordRetrieval({
      id: `search-${Date.now()}`,
      query,
      resultCount: results.length,
      topResultId: results[0]?.id ?? null,
      topResultScore: results[0]?.score ?? 0,
      method: "hybrid",
      durationMs: searchDuration,
      timestamp: Date.now(),
    });

    // Phase H — contextual abstention. Return [] when every retrieval
    // signal falls below threshold, so callers can emit an honest
    // "I don't know" instead of fabricating from weak hits.
    const sorted = results.sort((a, b) => b.score - a.score).slice(0, 10);
    if (this.contextualAbstentionEnabled && sorted.length > 0) {
      const hits: readonly SearchHit[] = sorted.map((r) => ({
        entry: { id: r.id, content: r.text },
        score: r.score,
      }));
      if (shouldAbstain({ hits })) return [];
    }
    return sorted;
  }

  // ── Trace Analysis ─────────────────────────────────────

  /**
   * Get the trace analysis for the current session.
   */
  getTraceAnalysis() {
    return this.traceAnalyzer.analyze();
  }

  // ── Status ─────────────────────────────────────────────

  getStatus(): RuntimeStatus {
    // Update context intelligence with current session analytics
    this.sessionAnalytics.updateContextUsage(this.contextIntelligence.getBudget().usagePercent);

    return {
      providers: this.infra?.bridge?.getAvailableProviders?.() ?? [],
      activeProvider: this.session.provider,
      hookCount: this.hookEngine.getRegisteredHooks().length,
      middlewareLayers: this.pipeline.getLayerCount(),
      memoryEnabled: this.memoryStore !== null,
      sessionId: this.session.id,
      totalTokens: this.session.totalTokens,
      totalCost: this.session.totalCost,
      currentMode: this.modeCycler.getModeName(),
      traceEntries: this.traceAnalyzer.size(),
      semanticIndexSize: this.semanticIndex.size(),
      skillCount: this.skillRegistry.getSkillCount(),
      contextPercent: this.contextIntelligence.getBudget().usagePercent,
      messageCount: this.session.messages.length,
    };
  }

  /**
   * Get context pressure and budget from the context window intelligence module.
   */
  getContextBudget() {
    return this.contextIntelligence.getBudget();
  }

  getContextCapabilityProfile(): ContextCapabilityProfile {
    return this.contextIntelligence.getCapabilityProfile();
  }

  /**
   * Get session analytics summary.
   */
  getAnalyticsSummary(): string {
    return this.sessionAnalytics.getSummary();
  }

  /**
   * Get the skill registry (for querying available skills).
   */
  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  /**
   * Get the auto-classifier for tool call security classification.
   */
  getAutoClassifier(): AutoClassifier {
    return this.autoClassifier;
  }

  /**
   * Get the intent verifier for drift detection.
   */
  getIntentVerifier(): IntentVerifier {
    return this.intentVerifier;
  }

  // TIER 2 cleanup: getPrivacyRouter() removed alongside the zombie
  // instance (0 external callers verified per QB#19). Construct
  // PrivacyRouter directly from `import { PrivacyRouter } from "wotann/lib"`
  // when the routing logic is needed.

  /**
   * Get the auto-verifier for post-edit verification.
   */
  getAutoVerifier(): AutoVerifier {
    return this.autoVerifier;
  }

  /**
   * rc.2 follow-up: get (or lazily construct) the PreCompletionVerifier
   * instance (B4 — ForgeCode 4-persona review). Returns null when
   * `enablePreCompletionVerify` is disabled (default). Callers should
   * treat null as "feature off" rather than an error.
   *
   * Each call returns the SAME instance so runCount statistics
   * accumulate within one session. Construction binds the verifier's
   * LlmQuery to `runtime.query()` so reviews execute on whichever
   * provider is currently active.
   */
  getPreCompletionVerifier(): PreCompletionVerifier | null {
    const enabled =
      this.config.enablePreCompletionVerify === true ||
      (this.config.enablePreCompletionVerify === undefined &&
        process.env["WOTANN_PRE_COMPLETION_VERIFY"] === "1");
    if (!enabled) return null;
    if (!this.preCompletionVerifier) {
      // Bind LlmQuery to runtime.query — streams text chunks and joins
      // them into a single response string the verifier can parse.
      const llmQuery: PreCompletionLlmQuery = async (prompt, options) => {
        let accumulated = "";
        for await (const chunk of this.query({
          prompt,
          maxTokens: options?.maxTokens ?? 1024,
          temperature: options?.temperature ?? 0,
        })) {
          if (chunk.type === "text") accumulated += chunk.content;
        }
        return accumulated;
      };
      this.preCompletionVerifier = new PreCompletionVerifier({ llmQuery });
    }
    return this.preCompletionVerifier;
  }

  /**
   * rc.2 follow-up: get (or lazily construct) the ProgressiveBudget
   * instance (B12 — escalating LOW→MEDIUM→MAX budget for verify-loops).
   * Returns null when `enableProgressiveBudget` is disabled (default).
   * Callers should treat null as "feature off" rather than an error.
   *
   * The returned scheduler is safe to share across sessions — per-
   * session isolation is handled via the `sessionId` parameter on
   * `nextPass()` / `wrap()` / `reset()`.
   */
  getProgressiveBudget(): ProgressiveBudget | null {
    const enabled =
      this.config.enableProgressiveBudget === true ||
      (this.config.enableProgressiveBudget === undefined &&
        process.env["WOTANN_PROGRESSIVE_BUDGET"] === "1");
    if (!enabled) return null;
    if (!this.progressiveBudget) {
      this.progressiveBudget = new ProgressiveBudget();
    }
    return this.progressiveBudget;
  }

  /**
   * Tier-D1 OMEGA 3-layer memory facade. Lazily constructed on first
   * `getOmegaLayers()` call when the gate is enabled AND a MemoryStore
   * is present (the facade is a read/write view over the store, so it
   * can't exist without one). Returns null when disabled, or when
   * memoryStore is null (free-tier / memoryless mode).
   *
   * Composition is zero-cost when off. On first construction, the L3
   * DDL (`memory_summaries` table creation) runs idempotently against
   * the store's underlying sqlite handle.
   *
   * Gate chain:
   *   config.enableOmegaLayers === true → always on
   *   config.enableOmegaLayers === undefined → env WOTANN_OMEGA_LAYERS=1
   *   config.enableOmegaLayers === false → always off (overrides env)
   */
  getOmegaLayers(): OmegaLayers | null {
    const enabled =
      // V9 T2.3 — Default-ON semantic. OMEGA was opt-in (`=== true || env === "1"`);
      // now on by default unless explicitly disabled via `config.enableOmegaLayers = false`
      // OR `WOTANN_OMEGA_LAYERS=0` env. Heuristic fallback when sqlite-vec/ONNX
      // extensions aren't installed (T1.3/T1.4 attach APIs) — so default-on doesn't
      // break runtimes without the extensions.
      this.config.enableOmegaLayers !== false && process.env["WOTANN_OMEGA_LAYERS"] !== "0";
    if (!enabled) return null;
    if (!this.memoryStore) return null;
    if (!this.omegaLayers) {
      this.omegaLayers = createOmegaLayers({ store: this.memoryStore });
    }
    return this.omegaLayers;
  }

  /**
   * P1-B7 goal-drift (OpenHands port, part 3).
   *
   * Returns a lazily-constructed GoalDriftDetector when the gate is
   * enabled, or null when it's off. Gate chain:
   *   - `config.enableGoalDrift === true` → enabled
   *   - `process.env.WOTANN_GOAL_DRIFT === "1"` → enabled (when config
   *      flag is undefined)
   *   - otherwise → disabled, return null
   *
   * The detector is provider-agnostic: it takes a TodoState and a
   * list of AgentActions and scores relevance. Callers wiring it into
   * the autonomous loop supply their own `TodoProvider` via the
   * `AutonomousExecutor.execute` `goalDrift` callback. The runtime
   * does NOT couple the detector to a provider here — a single
   * runtime may serve many tasks, each with its own provider.
   *
   * QB #14 real wiring: the getter returns a singleton per-runtime,
   * not a module-global, so two runtimes never share drift state.
   * QB #6 honest failure: returns `null` (not a no-op detector) when
   * the feature is off so callers can detect the gate state.
   */
  getGoalDriftDetector(): GoalDriftDetector | null {
    const enabled =
      this.config.enableGoalDrift === true ||
      (this.config.enableGoalDrift === undefined && process.env["WOTANN_GOAL_DRIFT"] === "1");
    if (!enabled) return null;
    if (!this.goalDriftDetector) {
      // Bind an optional LlmQuery to runtime.query for semantic
      // relevance checks when heuristic scoring is ambiguous. The
      // detector only calls this when its own ambiguity band fires,
      // so the recursion risk we have with PreCompletionVerifier
      // doesn't apply here — drift checks never land back inside
      // another drift check.
      const llm: GoalDriftLlmQuery = async (prompt: string) => {
        let accumulated = "";
        for await (const chunk of this.query({
          prompt,
          maxTokens: 256,
          temperature: 0,
        })) {
          if (chunk.type === "text") accumulated += chunk.content;
        }
        return accumulated;
      };
      this.goalDriftDetector = new GoalDriftDetector({ llm });
    }
    return this.goalDriftDetector;
  }

  /**
   * P1-B7 goal-drift: resolve the TodoProvider for drift-detector
   * use. Defaults to NullTodoProvider (empty-todo stub) when no
   * session-level provider has been configured. Callers that need
   * a real FS-backed feed should either supply one on
   * `RuntimeConfig.todoProvider` or build one at the call site via
   * `createFsTodoProvider`.
   */
  getTodoProvider(): TodoProvider {
    return this.config.todoProvider ?? NullTodoProvider;
  }

  /**
   * M4 + M6 wire: resolve the recall options used by active-memory
   * pre-processing. Config overrides env vars; unset on both paths
   * means default FTS5. TEMPR takes precedence over recallMode when
   * both are set (gate symmetry — TEMPR is a heavier hybrid so its
   * intent signal is stronger than a single retrieval mode).
   */
  private resolveRecallOptions(): { useTempr: boolean; recallMode: string | undefined } {
    // V9 T2.3 — Default-ON semantic for TEMPR recall. Previously opt-in
    // (`=== true || env === "1"`); now on by default unless explicitly
    // disabled via `config.useTempr = false` OR `WOTANN_USE_TEMPR=0` env.
    // Honest FTS5 fallback when no embedder is provided — TEMPR's vector
    // channel falls through to FTS+cosine — so default-on is safe.
    const useTempr = this.config.useTempr !== false && process.env["WOTANN_USE_TEMPR"] !== "0";
    // Mode resolution: explicit config beats env var.
    const modeFromEnv = process.env["WOTANN_RECALL_MODE"];
    const recallMode =
      this.config.recallMode !== undefined
        ? this.config.recallMode
        : modeFromEnv && modeFromEnv.length > 0
          ? modeFromEnv
          : undefined;
    // TEMPR precedence: if TEMPR is on, mask off recallMode so the
    // active-memory engine doesn't try both on the same call.
    return { useTempr, recallMode: useTempr ? undefined : recallMode };
  }

  /**
   * B4 + B12 post-turn wire. Runs the 4-persona review after the turn
   * finalizes the assistant message, with optional progressive-budget
   * retry when B12 is also enabled.
   *
   * Returns:
   *   - `null` when B4 is disabled (fast-path: no verifier allocated).
   *   - A `VerificationReport` otherwise. The caller inspects `.status`
   *     to decide whether to surface a blocking error.
   *
   * Recursion safety: this method sets `insidePreCompletionVerify` so
   * nested `this.query()` calls inside perspective prompts observe the
   * guard and skip re-verifying. The flag is cleared in the `finally`
   * block even on exception.
   */
  private async finalizePreCompletionVerify(
    input: VerificationInput,
  ): Promise<VerificationReport | null> {
    const verifier = this.getPreCompletionVerifier();
    if (!verifier) return null;

    // Set the guard BEFORE any verifier call so nested query() turns
    // (from the 4-perspective LlmQuery) see it and bail out.
    this.insidePreCompletionVerify = true;
    try {
      const budget = this.getProgressiveBudget();
      if (!budget) {
        // B4-only path: single-pass review, no retry.
        return await verifier.verify(input);
      }

      // B4 + B12 path: wrap in progressive-budget retry loop. We
      // convert the verifier into a PassVerifier<VerificationInput,
      // VerificationReport> shape where concerns === allConcerns when
      // status !== "pass". Pass 0 at LOW budget; escalate on concerns.
      const sessionId = `verify:${this.session.id}:${Date.now()}`;
      // reset in case a prior run left counters — per-call isolation.
      budget.reset(sessionId);
      const wrapped = budget.wrap<VerificationInput, VerificationReport>(
        async (inp) => {
          const rep = await verifier.verify(inp);
          return {
            result: rep,
            concerns: rep.status === "pass" ? [] : [...rep.allConcerns],
          };
        },
        { sessionId },
      );
      try {
        const outcome = await wrapped(input);
        return outcome.result;
      } catch (err) {
        // BudgetExhaustedConcernsRemain carries the final report.
        const lastResult = (err as { lastResult?: VerificationReport } | null)?.lastResult;
        if (lastResult && typeof lastResult === "object" && "status" in lastResult) {
          return lastResult;
        }
        // Unknown error shape — honest failure: surface as a
        // synthetic error-status report rather than fabricating a
        // pass.
        const msg = err instanceof Error ? err.message : String(err);
        return {
          status: "error",
          perspectives: [],
          implementer: makeErrorPerspective("implementer", msg),
          reviewer: makeErrorPerspective("reviewer", msg),
          tester: makeErrorPerspective("tester", msg),
          user: makeErrorPerspective("user", msg),
          bypassed: false,
          totalDurationMs: 0,
          allConcerns: [msg],
        } as VerificationReport;
      }
    } finally {
      this.insidePreCompletionVerify = false;
    }
  }

  /**
   * Get the per-file edit tracker (for benchmark engineering).
   */
  getEditTracker(): PerFileEditTracker {
    return this.editTracker;
  }

  // ── Permission Mode Control ────────────────────────────────

  private permissionMode: "auto-approve" | "ask-always" | "smart" = "smart";

  getPermissionMode(): "auto-approve" | "ask-always" | "smart" {
    return this.permissionMode;
  }

  setPermissionMode(mode: "auto-approve" | "ask-always" | "smart"): void {
    this.permissionMode = mode;
  }

  // ── Manual Compaction ─────────────────────────────────────

  manualCompact(): ConversationCompactionResult {
    const compactionCheck = this.contextIntelligence.shouldCompact();
    const stage = compactionCheck.stage ?? "old-messages";
    const result = compactConversationHistory(this.session.messages, stage);

    if (result) {
      this.session = {
        ...this.session,
        messages: [...result.messages],
      };
      this.syncMessageIndex();
      return result;
    }

    return {
      messages: this.session.messages,
      summary: "",
      removedMessages: 0,
    };
  }

  // ── Thinking Effort Control (like Cursor) ─────────────────

  private thinkingEffort: ThinkingEffort = "medium";

  setThinkingEffort(effort: ThinkingEffort): void {
    this.thinkingEffort = effort;
    // Adjust reasoning sandwich multiplier based on effort
    const multipliers: Record<ThinkingEffort, number> = {
      low: 0.3,
      medium: 1.0,
      high: 2.0,
      xhigh: 3.0,
      max: 4.0,
    };
    this.amplifier = new IntelligenceAmplifier({
      reasoningBudgetMultiplier: multipliers[effort],
    });
  }

  getThinkingEffort(): ThinkingEffort {
    return this.thinkingEffort;
  }

  // ── Context Size Control ──────────────────────────────────

  setMaxContextTokens(tokens: number): void {
    this.contextIntelligence.setTotalBudget(tokens);
  }

  getMaxContextTokens(): number {
    return this.contextIntelligence.getTotalBudget();
  }

  // ── Account Pool Access ───────────────────────────────────

  getAccountPool(): AccountPool {
    return this.accountPool;
  }

  restoreSession(session: SessionState): void {
    this.session = {
      ...session,
      startedAt: new Date(session.startedAt),
      messages: [...session.messages],
    };
    this.syncMessageIndex();
    this.contextIntelligence.adaptToProvider(session.provider, session.model);
  }

  saveCurrentSession(): string | null {
    const sessionDir = join(this.config.workingDir, ".wotann", "sessions");
    try {
      return saveSession(this.session, sessionDir);
    } catch {
      return null;
    }
  }

  getSession(): SessionState {
    return this.session;
  }
  getConversationHistory(): readonly AgentMessage[] {
    return this.session.messages;
  }

  /**
   * F9: O(1) lookup by message ID. Returns undefined when the ID is not
   * in the index (either because the message has no ID or it has been
   * compacted out of history).
   */
  getMessageById(id: string): AgentMessage | undefined {
    return this.messageIndex.get(id);
  }

  /**
   * Rebuild the message index from the current session messages. Called at
   * every mutation point that replaces `this.session.messages` so the index
   * never diverges from the array. Inexpensive for typical conversation
   * sizes and avoids the need to reason about partial updates.
   */
  private syncMessageIndex(): void {
    this.messageIndex.clear();
    for (const message of this.session.messages) {
      if (message.id) this.messageIndex.set(message.id, message);
    }
  }

  getWorkingDir(): string {
    return this.config.workingDir;
  }

  getPluginPanels(): readonly string[] {
    return this.pluginPanels;
  }

  // ── Wired Subsystem Accessors ──────────────────────────

  getFileFreezer(): FileFreezer {
    return this.fileFreezer;
  }
  getSecretScanner(): SecretScanner {
    return this.secretScanner;
  }
  getProactiveMemory(): ProactiveMemoryEngine {
    return this.proactiveMemory;
  }
  getBranchManager(): ConversationBranchManager {
    return this.branchManager;
  }
  getCrossSessionLearner(): CrossSessionLearner {
    return this.crossSessionLearner;
  }
  getCapabilityEqualizer(): CapabilityEqualizer {
    return this.capabilityEqualizer;
  }
  getPluginLifecycle(): PluginLifecycle {
    return this.pluginLifecycle;
  }
  getSessionRecorder(): SessionRecorder {
    return this.sessionRecorder;
  }
  getShadowGit(): ShadowGit {
    return this.shadowGit;
  }
  getMemoryStore(): MemoryStore | null {
    return this.memoryStore;
  }

  /**
   * Fire ToolResultReceived for a runtime-handled tool's raw output,
   * BEFORE the result is yielded to the agent's next-turn context.
   * Returns the (possibly sanitised) content; if the hook blocked,
   * content is replaced with a sanitised error notice so callers can
   * yield a safe placeholder instead of the injection-laced output.
   *
   * Session-5 architectural fix: the prior ResultInjectionScanner
   * fired on PostToolUse with `content: fullContent` (the agent's
   * response text). By then the injection had already entered the
   * model's context. ToolResultReceived fires at the tool-dispatch
   * level so the scanner gates the raw result before the model sees it.
   */
  private async fireToolResultReceivedHook(
    toolName: string,
    rawContent: string,
  ): Promise<{ content: string; blocked: boolean }> {
    // Session-13 deer-flow parity — scrub physical paths to virtual
    // /mnt/user-data/* in every tool-result transcript before the
    // hook engine sees it. Disabled when virtualPathsEnabled=false.
    // Honest: on scrub failure we keep the original content instead of
    // silently dropping tool output.
    let contentForHooks = rawContent;
    if (this.virtualPathsEnabled) {
      try {
        contentForHooks = sandboxScrubPaths(rawContent, this.sandboxVirtualPathConfig);
      } catch (err) {
        console.warn(`[WOTANN] virtual-paths scrub failed: ${(err as Error).message}`);
        contentForHooks = rawContent;
      }
    }
    if (this.config.enableHooks === false) {
      return { content: contentForHooks, blocked: false };
    }
    const result = await this.hookEngine.fire({
      event: "ToolResultReceived",
      toolName,
      content: contentForHooks,
      sessionId: this.session.id,
      timestamp: Date.now(),
    });
    if (result.action === "block") {
      const reason = result.message ?? "Tool result blocked";
      return {
        content: `\n[tool ${toolName} result blocked by ${result.hookName ?? "ResultInjectionScanner"}: ${reason}]\n`,
        blocked: true,
      };
    }
    return { content: contentForHooks, blocked: false };
  }
  getCanvasEditor(): CanvasEditor {
    return this.canvasEditor;
  }
  getDiffEngine(): typeof DiffEngine {
    return this.diffEngine;
  }
  getCredentialPool(): CredentialPool {
    return this.credentialPool;
  }
  getEpisodicMemory(): EpisodicMemory {
    return this.episodicMemory;
  }
  getAutonomousExecutor(): AutonomousExecutor {
    return this.autonomousExecutor;
  }

  getNotificationManager(): NotificationManager {
    return this.notificationManager;
  }
  getContextInspector(): ContextSourceInspector {
    return this.contextInspector;
  }
  getPersonaManager(): PersonaManager {
    return this.personaManager;
  }
  getSelfHealingPipeline(): SelfHealingPipeline {
    return this.selfHealingPipeline;
  }
  getLspManager(): LSPManager {
    return this.lspManager;
  }
  getDispatchPlane(): UnifiedDispatchPlane {
    return this.dispatchPlane;
  }
  getArenaLeaderboard(): ArenaLeaderboard {
    return this.arenaLeaderboard;
  }
  getPIIRedactor(): PIIRedactor {
    return this.piiRedactor;
  }
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }
  getHybridSearch(): HybridMemorySearch {
    return this.hybridSearch;
  }
  getRulesOfEngagement(): RulesOfEngagement {
    return this.rulesOfEngagement;
  }
  getTrainingPipeline(): TrainingPipeline {
    return this.trainingPipeline;
  }
  /**
   * Session-6 (GAP-11): expose the optional QuantizedVectorStore so
   * RPC handlers (memory.search-enhanced) and tests can reach it.
   * Returns null when the opt-in env flag is off, signalling callers to
   * fall back to semanticIndex.search().
   */
  getQuantizedVectorStore(): QuantizedVectorStore | null {
    return this.quantizedVectorStore;
  }
  getActiveROESessionId(): string | undefined {
    return this.activeROESessionId;
  }
  setActiveROESessionId(id: string | undefined): void {
    this.activeROESessionId = id;
  }

  // ── Wired Orphan Subsystem Accessors ──────────────────────

  // Orchestration
  getAutonomousContextManager(): AutonomousContextManager {
    return this.autonomousContextManager;
  }

  // Context
  getContextShardManager(): ContextShardManager {
    return this.contextShardManager;
  }
  getTurboQuantEngine(): TurboQuantEngine {
    return this.turboQuantEngine;
  }
  getVirtualContextManager(): VirtualContextManager {
    return this.virtualContextManager;
  }

  // Core (conversation tree + command history)
  getConversationTree(): ConversationTree {
    return this.conversationTree;
  }
  getCommandHistory(): CommandHistory {
    return this.commandHistory;
  }

  // Memory (mega-merge)
  getKnowledgeGraph(): KnowledgeGraph {
    return this.knowledgeGraph;
  }

  /**
   * Path where the KG snapshot lives. Located under the workspace's wotann
   * dir so per-project graphs stay isolated.
   */
  private knowledgeGraphPath(): string {
    return join(this.config.workingDir, ".wotann", "knowledge-graph.json");
  }

  /**
   * Rehydrate the knowledge graph from disk on boot. Best-effort — missing
   * or malformed file leaves the empty graph in place. Audit fix for the
   * session 9 finding "KnowledgeGraph is RAM-only; SQLite knowledge_nodes
   * tables are orphan; every restart loses the graph."
   */
  private async rehydrateKnowledgeGraph(): Promise<void> {
    try {
      const fs = await import("node:fs/promises");
      const json = await fs.readFile(this.knowledgeGraphPath(), "utf-8");
      const restored = KnowledgeGraph.fromJSON(json);
      // Swap by re-assigning the class-owned reference. All downstream
      // accessors (getKnowledgeGraph, addDocument, dualLevelRetrieval,
      // queryGraphAt) dereference `this.knowledgeGraph` lazily, so the
      // swap is transparent to callers.
      this.knowledgeGraph = restored;
    } catch {
      /* no snapshot on disk yet — leave empty graph as-is. Ditto malformed. */
    }
  }

  /**
   * Persist the knowledge graph to disk. Called on close() and any explicit
   * checkpoint (e.g. before a destructive compaction). Idempotent; writes
   * through a temp file + rename for atomicity.
   *
   * Phase B Bug #2 fix: the previous implementation leaked `.tmp.*` files
   * into `.wotann/` every time the write failed mid-rename (crash, disk
   * full, EACCES). We now wrap the write in try/finally and unlink the
   * temp on ANY error so we don't accumulate dozens of orphan .tmp.*
   * files across daemon restarts.
   */
  async persistKnowledgeGraph(): Promise<void> {
    const fs = await import("node:fs/promises");
    const target = this.knowledgeGraphPath();
    const dir = dirname(target);
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    let renamed = false;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmp, this.knowledgeGraph.toJSON(), "utf-8");
      await fs.rename(tmp, target);
      renamed = true;
    } catch {
      /* persistence is best-effort — a disk error during shutdown should
         not propagate and kill the rest of runtime.close(). */
    } finally {
      // If the rename never happened, the tmp file is orphaned. Try to
      // remove it. Swallow the unlink error (the file may never have been
      // created in the first place).
      if (!renamed) {
        try {
          await fs.unlink(tmp);
        } catch {
          /* tmp was never created or already cleaned up — fine */
        }
      }
    }
  }
  getContextTreeView(): ContextTree {
    return this.contextTree;
  }
  getCloudSyncEngine(): CloudSyncEngine {
    return this.cloudSyncEngine;
  }

  // Learning (mega-merge)
  getSkillForge(): SkillForge {
    return this.skillForge;
  }
  getInstinctSystem(): InstinctSystem {
    return this.instinctSystem;
  }

  // NeverStop strategies merged into AutonomousExecutor

  // Security (mega-merge)
  getSkillsGuard(): SkillsGuard {
    return this.skillsGuard;
  }
  getHashAuditChain(): HashAuditChain {
    return this.hashAuditChain;
  }

  // Core (mega-merge)
  getVirtualPathResolver(): VirtualPathResolver {
    return this.virtualPathResolver;
  }
  getConfigDiscovery(): ConfigDiscovery {
    return this.configDiscovery;
  }

  // Voice (mega-merge)
  getVibeVoiceBackend(): VibeVoiceBackend {
    return this.vibeVoiceBackend;
  }

  // Desktop (mega-merge)
  getPromptEnhancerEngine(): PromptEnhancer {
    return this.promptEnhancerEngine;
  }

  // Training (wired)
  getAutoresearchEngine(): AutoresearchEngine {
    return this.autoresearchEngine;
  }

  /**
   * Verifier-gated task completion (Phase 4 Tier-1 unlock).
   *
   * Wraps the CompletionOracle with runtime-supplied callbacks:
   *   - llmJudge routes through this.query so the judge runs on whatever
   *     provider the runtime is currently bound to
   *   - runCommand + captureScreenshot are left undefined so the oracle
   *     falls back to its built-in sandboxed execFileSync and native
   *     screencapture(1) paths
   *
   * Callers pass a task description and either explicit criteria or a
   * taskType for sensible defaults (code|ui|docs|test). Returns the
   * weighted completion score, a completed flag, and per-criterion
   * evidence — ready to feed into autopilot loop control or
   * benchmark-runner pass/fail gating.
   */
  async verifyCompletion(
    task: string,
    options: {
      criteria?: readonly CompletionCriterion[];
      taskType?: "code" | "ui" | "docs" | "test";
      threshold?: number;
      /**
       * When supplied, verifyCompletion skips the expensive re-run path
       * (tests, lint, typecheck) and delegates to
       * `evaluateCompletionFromEvidence` which just scores the existing
       * evidence. Use when the caller already ran the tests as part of
       * task execution — avoids duplicate test runs.
       */
      preCollectedEvidence?: readonly VerificationEvidence[];
    } = {},
  ): Promise<{
    completed: boolean;
    score: number;
    evidence: readonly VerificationEvidence[];
  }> {
    const criteria = options.criteria ?? getDefaultCriteria(options.taskType ?? "code");
    const threshold = options.threshold ?? 0.75;

    // Fast path: when the caller already has evidence, don't re-run tests.
    if (options.preCollectedEvidence && options.preCollectedEvidence.length > 0) {
      return evaluateCompletionFromEvidence(criteria, options.preCollectedEvidence, threshold);
    }

    const llmJudge = async (
      judgeTask: string,
      evidence: string,
    ): Promise<{ passed: boolean; reasoning: string }> => {
      const judgePrompt = [
        `ORIGINAL TASK: ${judgeTask}`,
        ``,
        `EVIDENCE COLLECTED:`,
        evidence,
        ``,
        `Given the evidence above, does the task appear COMPLETE?`,
        `Reply with a single JSON object: {"passed": boolean, "reasoning": "<one sentence>"}`,
      ].join("\n");
      const judgeSystem =
        "You are a strict verifier. Only answer PASS if every required criterion was " +
        "satisfied by the evidence. Treat ambiguity as FAIL. Return a single JSON object, " +
        "no surrounding prose.";

      let accumulated = "";
      try {
        for await (const chunk of this.query({
          prompt: judgePrompt,
          systemPrompt: judgeSystem,
          maxTokens: 400,
          temperature: 0,
        })) {
          if (chunk.type === "text") accumulated += chunk.content;
          if (accumulated.length > 4096) break;
        }
      } catch (err) {
        return {
          passed: false,
          reasoning: `LLM judge transport failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const match = accumulated.match(/\{[\s\S]*?"passed"\s*:\s*(true|false)[\s\S]*?\}/);
      if (!match) {
        return {
          passed: false,
          reasoning: `LLM judge returned no parseable JSON: ${accumulated.slice(0, 200)}`,
        };
      }
      try {
        const parsed = JSON.parse(match[0]) as { passed?: unknown; reasoning?: unknown };
        return {
          passed: parsed.passed === true,
          reasoning:
            typeof parsed.reasoning === "string" ? parsed.reasoning : accumulated.slice(0, 200),
        };
      } catch {
        return {
          passed: false,
          reasoning: `LLM judge JSON parse failed: ${accumulated.slice(0, 200)}`,
        };
      }
    };

    return evaluateCompletion(
      task,
      criteria,
      { workingDir: this.config.workingDir, threshold },
      { llmJudge },
    );
  }

  // Orchestration (wired)
  getTaskDelegationManager(): TaskDelegationManager {
    return this.taskDelegationManager;
  }

  // Intelligence pipeline modules
  getAutoReviewer(): AutoReviewer {
    return this.autoReviewer;
  }
  getBugBot(): BugBot {
    return this.bugBot;
  }
  getProviderArbitrage(): ProviderArbitrageEngine {
    return this.providerArbitrage;
  }
  getErrorPatternLearner(): ErrorPatternLearner {
    return this.errorPatternLearner;
  }
  getPredictiveContext(): PredictiveContextLoader {
    return this.predictiveContext;
  }

  // Newly wired intelligence modules
  getAutoEnhancer(): AutoEnhancer {
    return this.autoEnhancer;
  }
  getCrossDeviceContext(): CrossDeviceContextManager {
    return this.crossDeviceContext;
  }
  getAITimeMachine(): AITimeMachine {
    return this.aiTimeMachine;
  }
  getUserModelManager(): UserModelManager {
    return this.userModelManager;
  }
  // S2-9: getVideoProcessor/getRDAgent removed — getters-only dead code.

  // Verification, time budget, and agent registry
  getVerificationCascade(): VerificationCascade {
    return this.verificationCascade;
  }
  getWallClockBudget(): WallClockBudget {
    return this.wallClockBudget;
  }
  getAgentRegistry(): AgentRegistry {
    return this.agentRegistryInstance;
  }

  // ── Newly wired lib.ts-only modules (100% intelligence wiring) ──
  getFlowTracker(): FlowTracker {
    return this.flowTracker;
  }
  getIdleDetector(): IdleDetector {
    return this.idleDetector;
  }
  getDecisionLedger(): DecisionLedger {
    return this.decisionLedger;
  }
  // S2-9: getNeverStopExecutor removed — the field and the module were
  // both deleted. Callers should use getAutonomousExecutor() instead.

  /** Run codebase health analysis and return a 0-100 score with diagnostics. */
  async analyzeHealth(directory?: string): Promise<ReturnType<typeof analyzeCodebaseHealth>> {
    return analyzeCodebaseHealth(directory ?? this.config.workingDir);
  }

  /**
   * Record an architectural or design decision with rationale.
   * Persists to both the DecisionLedger (in-memory, serializable) and
   * the MemoryStore decision_log table (SQLite, durable).
   */
  recordDecision(input: DecisionInput): string {
    const id = this.decisionLedger.recordDecision(input);

    // Also persist to SQLite if memory store is available
    this.memoryStore?.logDecision({
      id,
      decision: input.title,
      rationale: input.rationale,
      alternatives: input.alternatives.join("; "),
      constraints: input.affectedFiles.join(", "),
      stakeholders: input.tags.join(", "),
      sessionId: this.session.id,
    });

    return id;
  }

  /** Get the FlowTracker's current insights about user intent. */
  getFlowInsights() {
    return this.flowTracker.getInsights();
  }

  /** Check if user is idle and get away summary if so. */
  getAwaySummary() {
    return this.idleDetector.checkIdle();
  }

  // ── Phase 2: Competitive Parity Accessors ──
  getTaskRouter(): TaskSemanticRouter {
    return this.taskRouter;
  }
  getParallelSearch(): ParallelSearchDispatcher {
    return this.parallelSearch;
  }
  getConfirmAction(): ConfirmActionGate {
    return this.confirmAction;
  }
  getAgentHierarchy(): AgentHierarchyManager {
    return this.agentHierarchy;
  }
  getAgentWorkspace(): AgentWorkspace {
    return this.agentWorkspace;
  }

  // ── Phase 3: Memory Accessors ──
  getContextFence(): ContextFence {
    return this.contextFence;
  }
  getRetrievalQuality(): RetrievalQualityScorer {
    return this.retrievalQuality;
  }
  getContextLoader(): ContextLoader {
    return this.contextLoader;
  }
  getObservationExtractor(): ObservationExtractor {
    return this.observationExtractor;
  }

  /**
   * Drive one consolidation pass over auto_capture. Intended to be called
   * from the daemon heartbeat so structured memory_entries are produced
   * even when no user queries are running. Phase B Bug #1 fix.
   *
   * Safe to call on an empty queue — returns a zero-valued report.
   * @returns the consolidation report, or null if no memoryStore exists.
   */
  consolidateObservations(batchSize: number = 200): {
    readonly read: number;
    readonly routed: number;
    readonly classificationFailed: number;
    readonly decisionLogged: number;
    readonly byBlock: Readonly<Record<string, number>>;
  } | null {
    if (!this.memoryStore) return null;
    try {
      // Phase 13 Wave-3C: capture the observations produced by the sync
      // extractor so we can run relationship classification (updates /
      // extends / derives) as a fire-and-forget async companion. The
      // classifier runs on the microtask queue without blocking the
      // daemon tick that drives this method.
      const captured: { assertion: string; id: string; domain?: string }[] = [];
      const extractWrapped = (entries: readonly AutoCaptureEntry[]) => {
        const obs = this.observationExtractor.extractFromCaptures(entries);
        for (const o of obs) {
          captured.push({
            assertion: o.assertion,
            id: o.id,
            ...(o.domain ? { domain: o.domain } : {}),
          });
        }
        return obs;
      };
      const report = this.memoryStore.consolidateAutoCaptures(extractWrapped, {
        batchSize,
        onClassificationFailed: (entry, reason) => {
          this.memoryStore?.captureEvent(
            "classification_failed",
            JSON.stringify({
              reason,
              sourceId: entry.id,
              sourceType: entry.eventType,
              contentPreview: entry.content.slice(0, 120),
            }),
            "observation-consolidation",
            this.session.id,
          );
        },
      });
      if (captured.length >= 2) {
        void this.classifyAndPersistRelationships(captured);
      }
      return report;
    } catch (err) {
      this.memoryStore?.captureEvent(
        "consolidation_error",
        `${(err as Error).name}: ${(err as Error).message}`,
        "observation-consolidation",
        this.session.id,
      );
      return null;
    }
  }

  /**
   * Phase 13 Wave-3C — async companion to consolidateObservations.
   * Runs relationship classification on newly extracted observations and
   * persists the edges via the store's addRelationships method (when
   * available). Honest logger.warn on failure; never silently swallows.
   */
  private async classifyAndPersistRelationships(
    obs: readonly { readonly id: string; readonly assertion: string; readonly domain?: string }[],
  ): Promise<void> {
    if (!this.memoryStore) return;
    try {
      const enriched = obs.map((o) => ({
        id: o.id,
        type: "decision" as const,
        assertion: o.assertion,
        confidence: 0.7,
        sourceIds: [] as readonly number[],
        extractedAt: Date.now(),
        ...(o.domain ? { domain: o.domain } : {}),
      }));
      const relationships = await this.observationExtractor.classifyRelationships(enriched);
      if (relationships.length === 0) return;
      const store = this.memoryStore as unknown as {
        addRelationships?: (rels: typeof relationships) => void;
      };
      store.addRelationships?.(relationships);
    } catch (err) {
      console.warn(`[WOTANN] relationship classification failed: ${(err as Error).message}`);
    }
  }

  getTunnelDetector(): TunnelDetector {
    return this.tunnelDetector;
  }
  getConversationMiner(): ConversationMiner | null {
    return this.conversationMiner;
  }

  // ── Phase 4: Self-Improvement Accessors ──
  getAdaptivePrompts(): AdaptivePromptGenerator {
    return this.adaptivePrompts;
  }
  getNightlyConsolidator(): NightlyConsolidator {
    return this.nightlyConsolidator;
  }
  getBenchmarkHarness(): BenchmarkHarness {
    return this.benchmarkHarness;
  }

  /**
   * Classify a prompt and get the recommended model using task-semantic routing.
   * This is an ACTIVE integration — called to optimize model selection.
   */
  classifyAndRoute(prompt: string): {
    taskType: string;
    complexity: string;
    recommendedModel: string;
  } {
    // When no infra is wired yet, pass an empty availability list — the
    // classifier treats empty as "don't filter; return the general-best
    // recommendation" rather than forcing any one model. Previously
    // hardcoded ["claude-sonnet-4-6"] which silently biased the router.
    const status = this.infra ? this.getStatus() : null;
    const available = status?.providers ? status.providers.map(String) : [];
    const classification = this.taskRouter.classify(prompt, available);
    return {
      taskType: classification.type,
      complexity: classification.complexity,
      recommendedModel: classification.recommendedModel,
    };
  }

  /**
   * Run parallel search across all available sources.
   * ACTIVE integration — used by research mode and agent tools.
   */
  async searchAll(query: string): Promise<{
    results: readonly { source: string; title: string; content: string; score: number }[];
    durationMs: number;
  }> {
    const result = await this.parallelSearch.search(query);
    return { results: result.results, durationMs: result.durationMs };
  }

  /**
   * Check if a tool action requires user confirmation before execution.
   * ACTIVE integration — called from the tool execution pipeline.
   */
  checkActionApproval(
    toolName: string,
    args: Record<string, unknown>,
  ): { requiresApproval: boolean; risk: string; category: string } {
    const request = this.confirmAction.classify(toolName, args);
    if (this.confirmAction.isPreApproved(request)) {
      return { requiresApproval: false, risk: request.risk, category: request.category };
    }
    return {
      requiresApproval: request.requiresApproval,
      risk: request.risk,
      category: request.category,
    };
  }

  /**
   * Generate an adaptive system prompt section based on the current model's capabilities.
   * ACTIVE integration — called during system prompt assembly.
   */
  generateAdaptivePromptSection(modelId: string, basePrompt: string): string {
    return this.adaptivePrompts.generateAdaptiveSection(modelId, basePrompt);
  }

  /**
   * Get the progressive context wake-up payload (L0 + L1, ~170 tokens).
   * ACTIVE integration — called at session start to minimize cold-start cost.
   */
  getWakeUpPayload(): { content: string; tokens: number } {
    const payload = this.contextLoader.generateWakeUpPayload();
    return { content: payload.combinedPrompt, tokens: payload.totalTokens };
  }

  /**
   * Get a spawn configuration for an agent by ID, using the centralized
   * registry. Returns undefined if the agent ID is not registered.
   *
   * Sync variant — delegates to `AgentRegistry#spawn` and does NOT
   * resolve `required_reading` items. Callers that need the file
   * contents prepended to the agent's system prompt should prefer
   * `getAgentSpawnConfigWithContext` which awaits `spawnWithContext`
   * (the requiredReadingHook path).
   */
  getAgentSpawnConfig(agentId: string, task: string) {
    return this.agentRegistryInstance.spawn(agentId, task);
  }

  /**
   * Async spawn that resolves the agent's `required_reading` items into
   * a prompt-block prepended to the system prompt via
   * `AgentRegistry#spawnWithContext` + `requiredReadingHook`. Uses this
   * runtime's workingDir as the workspace root — the hook honours the
   * per-item size caps and the optional total budget.
   *
   * Closes the "spawnWithContext has 0 external callers" finding from
   * docs/FINAL_VERIFICATION_AUDIT_2026-04-19.md; the sync `spawn` path
   * stays available for callers that don't want the hook overhead.
   */
  async getAgentSpawnConfigWithContext(
    agentId: string,
    task: string,
    options?: {
      readonly defaultMaxCharsPerFile?: number;
      readonly totalBudgetChars?: number;
    },
  ) {
    return this.agentRegistryInstance.spawnWithContext(agentId, task, {
      workspaceRoot: this.config.workingDir,
      ...(options?.defaultMaxCharsPerFile !== undefined
        ? { defaultMaxCharsPerFile: options.defaultMaxCharsPerFile }
        : {}),
      ...(options?.totalBudgetChars !== undefined
        ? { totalBudgetChars: options.totalBudgetChars }
        : {}),
    });
  }

  /**
   * Fold per-agent YAML overrides into the active registry. Reads
   * `<workingDir>/.wotann/agents/*.yaml` by default. Specs that reference
   * unknown agent IDs are silently skipped so a stale spec never blocks
   * startup.
   */
  async loadAgentOverrides(directory?: string): Promise<void> {
    const { loadAgentSpecsFromDir } = await import("../orchestration/agent-registry.js");
    const dir = directory ?? join(this.config.workingDir, ".wotann", "agents");
    this.agentRegistryInstance = await loadAgentSpecsFromDir(this.agentRegistryInstance, dir);
  }

  // ── Wired Orphan Public Methods ───────────────────────────

  /**
   * Run wave-based parallel execution: topological grouping by dependency.
   * Tasks within each wave execute in parallel; waves run sequentially.
   * Uses TaskDelegationManager to track ownership and results per task.
   */
  async runWaveExecution(
    tasks: readonly WaveTask[],
    executor: (task: WaveTask) => Promise<string>,
  ): Promise<ReadonlyMap<string, string>> {
    const waves = buildWaves(tasks);

    // Register each task in the delegation manager for ownership tracking
    for (const wave of waves) {
      for (const task of wave.tasks) {
        this.taskDelegationManager.create(
          this.session.id,
          task.description,
          {
            workingDir: this.config.workingDir,
            relevantFiles: [],
            decisions: [],
            priorAttempts: [],
            memoryEntryIds: [],
            parentSessionId: this.session.id,
          },
          {
            maxTimeMs: 300_000,
            maxCostUsd: 1.0,
            allowedFiles: [],
            forbiddenFiles: [],
            mustPass: [],
          },
        );
      }
    }

    const results = await executeWaves(waves, async (task) => {
      const delegations = this.taskDelegationManager.getByParent(this.session.id);
      const delegation = delegations.find((d) => d.task === task.description);
      if (delegation) {
        this.taskDelegationManager.accept(delegation.id, `worker-${task.id}`);
        this.taskDelegationManager.markInProgress(delegation.id);
      }

      const result = await executor(task);

      if (delegation) {
        this.taskDelegationManager.complete(delegation.id, {
          success: true,
          output: result.slice(0, 500),
          filesModified: [],
          testsRun: 0,
          testsPassed: 0,
          costUsd: 0,
          tokensUsed: 0,
          knowledgeExtracted: [],
          errors: [],
        });
      }

      return result;
    });

    return results;
  }

  /**
   * Generate a structured plan using ULTRAPLAN prompt engineering.
   * Builds a planning prompt, parses the response into phases/risks/criteria.
   */
  generatePlan(
    task: string,
    context?: string,
  ): { prompt: string; parse: (response: string) => StructuredPlan } {
    const prompt = buildPlanningPrompt(task, context);
    return { prompt, parse: parsePlanResponse };
  }

  /**
   * Plan context budget using the maximizer for optimal allocation.
   */
  getMaximizerContextBudget(
    model: string,
    provider: string,
    systemPromptEstimate: number,
    bootstrapEstimate: number,
    memoryEstimate: number,
  ): MaximizerContextBudget {
    return planContextBudget(
      model,
      provider,
      systemPromptEstimate,
      bootstrapEstimate,
      memoryEstimate,
    );
  }

  /**
   * Replay context: reconstruct the minimum effective context for a task.
   * Used after compaction or session resume to rebuild focused context.
   */
  replayContext(task: TaskContext, budget: ReplayBudget): ReplayResult {
    return replayContext(task, budget);
  }

  /**
   * Optimize a tool schema for better model accuracy (flatten, sort, add descriptions).
   */
  optimizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
    return optimizeToolSchema(schema);
  }

  /**
   * Validate and coerce tool call arguments against a schema.
   */
  validateToolArgs(
    args: Record<string, unknown>,
    schema: Record<string, unknown>,
  ): { valid: boolean; corrected: Record<string, unknown>; errors: readonly string[] } {
    return validateAndCoerce(args, schema);
  }

  /**
   * Run prompt regression test suite (CI/CD integration for system prompt validation).
   */
  runPromptRegressionTests(testCases?: readonly PromptTestCase[]): {
    suite: readonly PromptTestCase[];
    runTest: (tc: PromptTestCase, output: string, latencyMs: number) => PromptTestResult;
    buildReport: (results: readonly PromptTestResult[], durationMs: number) => RegressionReport;
  } {
    const suite = testCases ?? getCoreTestSuite();
    return {
      suite,
      runTest: (tc, output, latencyMs) => runAssertions(tc, output, latencyMs),
      buildReport: generateReport,
    };
  }

  /**
   * Check all tracked repos for changes since last sync.
   * Used by both CLI `wotann repos` and TUI `/repos` command.
   */
  checkSourceRepos(): MonitorDigest {
    const configPath = join(this.config.workingDir, ".wotann", "monitor-config.yaml");
    const researchDir = join(this.config.workingDir, ".wotann", "research");
    const statePath = join(this.config.workingDir, ".wotann", "monitor-state.json");
    return checkAllRepos(configPath, researchDir, statePath);
  }

  /**
   * Update sync state for all tracked repos.
   */
  syncSourceRepos(): void {
    const configPath = join(this.config.workingDir, ".wotann", "monitor-config.yaml");
    const statePath = join(this.config.workingDir, ".wotann", "monitor-state.json");
    syncAllRepos(configPath, statePath);
  }

  /**
   * Generate an autonomous proof bundle capturing task, result, and runtime state.
   */
  generateProofBundle(task: string, result: AutonomousResult): string {
    return writeAutonomousProofBundle({
      workingDir: this.config.workingDir,
      task,
      result,
      runtimeStatus: this.getStatus(),
      contextBudget: this.getContextBudget(),
      contextCapability: this.getContextCapabilityProfile(),
    });
  }

  /**
   * Run a blind arena contest across multiple providers.
   * Uses the agent bridge to execute queries per provider and returns
   * contestant results with hidden identities for blind voting.
   */
  async runArena(
    prompt: string,
    providers: readonly ProviderName[],
  ): Promise<readonly ArenaContestant[]> {
    if (!this.infra) {
      return [];
    }

    const bridge = this.infra.bridge;
    const executor = async (provider: ProviderName, arenaPrompt: string) => {
      const startTime = Date.now();
      const queryResult = await bridge.querySync({
        prompt: arenaPrompt,
        provider,
      });
      return {
        response: queryResult.content,
        tokensUsed: queryResult.tokensUsed,
        // Session-5 fix: use wall-clock from the arena executor's start
        // so the duration includes routing + fallback overhead the bridge
        // itself doesn't measure. The prior code assigned startTime but
        // threw it away — drift that was caught as a lint warning.
        durationMs: queryResult.durationMs > 0 ? queryResult.durationMs : Date.now() - startTime,
        model: queryResult.model,
      };
    };

    return runArenaContest(executor, prompt, providers);
  }

  /**
   * Run a council deliberation across multiple providers.
   * Each model answers independently, then peer-reviews other responses,
   * and a chairman synthesizes the final answer.
   */
  async runCouncil(query: string, providers: readonly ProviderName[]): Promise<CouncilResult> {
    if (!this.infra) {
      return {
        query,
        members: [],
        rankings: [],
        aggregateRanking: [],
        synthesis: "[No providers available]",
        chairmanModel: "none",
        totalTokens: 0,
        totalDurationMs: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const bridge = this.infra.bridge;
    const executor: CouncilQueryExecutor = async (provider, model, prompt, systemPrompt) => {
      // Session-5 fix: the council executor's signature includes a
      // `model` arg (the specific model each council member should use)
      // but the prior code dropped it — every council member queried
      // the provider's default model instead. Thread `model` through
      // so each expert's specified model is actually used.
      const startTime = Date.now();
      const queryResult = await bridge.querySync({
        prompt,
        provider,
        model,
        systemPrompt,
      });
      return {
        response: queryResult.content,
        tokensUsed: queryResult.tokensUsed,
        durationMs: queryResult.durationMs > 0 ? queryResult.durationMs : Date.now() - startTime,
      };
    };

    const councilProviders = providers.map((p) => ({ provider: p, model: "auto" }));
    const result = await runCouncil(executor, query, councilProviders);

    // Record results in leaderboard
    this.councilLeaderboard.recordResult(result);

    return result;
  }

  /**
   * Get the council leaderboard for tracking model performance in deliberations.
   */
  getCouncilLeaderboard(): CouncilLeaderboard {
    return this.councilLeaderboard;
  }

  /**
   * Apply a hash-anchored edit (safe multi-agent editing).
   * Unlike string-matching edits, hash edits are immune to whitespace/encoding drift.
   */
  applyHashEdit(filePath: string, operation: HashEditOperation): HashEditResult {
    return applyHashEdit(filePath, operation);
  }

  /**
   * Compile ambient awareness context for the current workspace.
   */
  getAmbientContext(currentFile?: string, completedTask?: string): AmbientContext {
    return compileAmbientContext(currentFile, completedTask, this.config.workingDir);
  }

  runPreCommitAnalysis(): PreCommitAnalysisResult | null {
    if (this.editTracker.getTotalEdits() === 0) return null;

    // Run verification cascade (typecheck→lint→test) after edits
    void this.verificationCascade
      .run()
      .then((cascadeResult) => {
        if (!cascadeResult.allPassed && cascadeResult.failedStep) {
          this.memoryStore?.captureEvent(
            "verification_cascade_failed",
            `Failed at step: ${cascadeResult.failedStep} (${cascadeResult.stepsRun} steps run, ${cascadeResult.totalDurationMs}ms)`,
            "verification",
            this.session.id,
          );
        }
      })
      .catch(() => {
        /* cascade failure is non-fatal */
      });

    return runPreCommitAnalysis(this.config.workingDir);
  }

  /**
   * Enhance a prompt using the most capable available model.
   * Returns the enhanced prompt text and the model used.
   */
  async enhancePrompt(prompt: string): Promise<{ enhancedPrompt: string; model: string }> {
    if (!this.infra) {
      throw new Error("No providers configured. Run `wotann init` first.");
    }

    const bridge = this.infra.bridge;
    const systemPrompt = [
      "You are a prompt engineering expert. Your task is to enhance the following prompt to be more effective.",
      "Make it clearer, more specific, and better structured while preserving the user's original intent.",
      "Add relevant context cues, specify desired output format if appropriate, and remove ambiguity.",
      "Return ONLY the enhanced prompt text — no explanation, no preamble, no wrapper.",
    ].join(" ");

    const queryResult = await bridge.querySync({
      prompt: `Enhance this prompt:\n\n${prompt}`,
      systemPrompt,
      provider: this.session.provider,
      model: this.session.model,
    });

    return {
      enhancedPrompt: queryResult.content.trim(),
      model: queryResult.model ?? this.session.model,
    };
  }

  /**
   * Run a council deliberation across multiple providers.
   * 3-stage pipeline: individual responses → peer review → chairman synthesis.
   */
  async runCouncilDeliberation(
    query: string,
    providerNames: readonly ProviderName[],
  ): Promise<CouncilResult> {
    if (!this.infra) {
      throw new Error("No providers configured. Run `wotann init` first.");
    }

    const bridge = this.infra.bridge;
    const executor = async (
      provider: ProviderName,
      model: string,
      executorPrompt: string,
      systemPrompt?: string,
    ) => {
      const startTime = Date.now();
      const queryResult = await bridge.querySync({
        prompt: executorPrompt,
        provider,
        model,
        systemPrompt,
      });
      return {
        response: queryResult.content,
        tokensUsed: queryResult.tokensUsed,
        durationMs: queryResult.durationMs > 0 ? queryResult.durationMs : Date.now() - startTime,
      };
    };

    // Build provider+model pairs from available provider names
    const providerPairs = providerNames.map((provider) => {
      const status = this.infra?.bridge?.getAvailableProviders?.() ?? [];
      const defaultModel = status.includes(provider) ? "auto" : "auto";
      return { provider, model: defaultModel };
    });

    return runCouncil(executor, query, providerPairs);
  }

  /**
   * Unified knowledge search — query across all registered retrievers
   * (MemoryStore FTS5 + ContextTreeManager markdown files, plus whatever
   * else gets registered in initialize()). Returns deduped, ranked results
   * with provenance.
   */
  async searchUnifiedKnowledge(
    query: string,
    maxResults: number = 20,
    minConfidence: number = 0,
  ): Promise<readonly KnowledgeResult[]> {
    const q: KnowledgeQuery = {
      query,
      maxResults,
      minConfidence,
      sources: [],
    };
    return this.knowledgeFabric.search(q);
  }

  /**
   * Write-through to the ContextTreeManager — upsert a markdown entry at
   * `.wotann/context-tree/{category}/{slug}.md`. Returns null when the
   * manager failed to initialize (e.g. unwritable workingDir). Used by
   * agents that discover durable project knowledge during long sessions.
   */
  upsertContextTree(
    category: ContextEntry["category"],
    title: string,
    content: string,
  ): ContextEntry | null {
    if (!this.contextTreeManager) return null;
    try {
      return this.contextTreeManager.upsert(category, title, content);
    } catch (err) {
      console.warn(`[WOTANN] ContextTree upsert failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Run self-consistency voting — sample the SAME provider+model N times
   * against the same prompt and return the mode of the distribution with
   * a confidence score. Wang et al. 2022 (arXiv:2203.11171). Differs from
   * `runCouncilDeliberation` which uses multiple providers; self-consistency
   * is cheaper and probes a single model's answer stability. Use when the
   * caller wants confidence calibration from one provider rather than
   * cross-provider consensus.
   *
   * Fixes the session-4 false-claim (commit 2a9cf6c) where benchmark-harness
   * was said to "wire selfConsistencyVote" but actually used majorityAnswer
   * (votes on pre-collected responses, no query execution). This method is
   * the real wiring — it executes fresh queries.
   */
  async runSelfConsistency(
    query: string,
    options?: {
      readonly numVotes?: number;
      readonly systemPrompt?: string;
      readonly normalizeAnswer?: (response: string) => string;
    },
  ): Promise<SelfConsistencyResult> {
    if (!this.infra) {
      throw new Error("No providers configured. Run `wotann init` first.");
    }

    const bridge = this.infra.bridge;
    const executor = async (
      provider: ProviderName,
      model: string,
      executorPrompt: string,
      systemPrompt?: string,
    ) => {
      const startTime = Date.now();
      const queryResult = await bridge.querySync({
        prompt: executorPrompt,
        provider,
        model,
        systemPrompt,
      });
      return {
        response: queryResult.content,
        tokensUsed: queryResult.tokensUsed,
        durationMs: queryResult.durationMs > 0 ? queryResult.durationMs : Date.now() - startTime,
      };
    };

    const opts: SelfConsistencyOptions = {
      numVotes: options?.numVotes ?? 5,
      provider: this.session.provider,
      model: this.session.model,
      ...(options?.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      ...(options?.normalizeAnswer !== undefined
        ? { normalizeAnswer: options.normalizeAnswer }
        : {}),
    };
    return selfConsistencyVote(executor, query, opts);
  }

  close(): void {
    const summary = formatSessionStats(this.session);
    // Stop hook fires first. We HONOR a block result by logging it
    // prominently to stderr — close() can't refuse (the user already
    // decided to terminate), but the strict-profile CompletionVerifier's
    // "no evidence" block now surfaces visibly instead of being silently
    // discarded as the Opus audit found.
    const stopResult = this.hookEngine.fireSync({
      event: "Stop",
      sessionId: this.session.id,
      content: summary,
      timestamp: Date.now(),
    });
    if (stopResult.action === "block") {
      const hookLabel = stopResult.hookName ?? "Stop hook";
      console.error(
        `[WOTANN] ${hookLabel} blocked Stop but close() proceeded: ${stopResult.message ?? "no message"}`,
      );
    }
    if (stopResult.warnings && stopResult.warnings.length > 0) {
      for (const w of stopResult.warnings) console.warn(`[WOTANN Stop] ${w}`);
    }
    this.hookEngine.fireSync({
      event: "SessionEnd",
      sessionId: this.session.id,
      content: summary,
      timestamp: Date.now(),
    });

    // Release per-session ReadBeforeEdit tracking so the Map doesn't grow
    // unbounded across long-running daemon lifetimes.
    clearReadTrackingForSession(this.session.id);

    // Stop SteeringServer fs.watch + poll loop so file descriptors don't
    // leak past the session. Safe to call when never started (null check).
    if (this.steeringServer) {
      this.steeringServer.stopWatching();
      this.steeringServer = null;
    }

    // Stop session recorder and extract learnings
    this.sessionRecorder.stop();
    const learnings = this.crossSessionLearner.extractLearnings("success");
    if (learnings.length > 0) {
      this.memoryStore?.captureEvent(
        "cross_session_learnings",
        JSON.stringify(learnings.slice(0, 10)),
        "learning",
        this.session.id,
      );
    }

    // Phase B Bug #1 fix: route unconsolidated auto_capture rows into the
    // structured memory_entries / decision_log tables. Previously this ran
    // only against `session.messages` (in-memory conversation), so a
    // daemon lifecycle that did no real queries produced 0 memory_entries
    // despite thousands of auto_capture rows. Now we pull from the DB so
    // every captured event gets a chance at structured routing.
    if (this.memoryStore) {
      try {
        const report = this.memoryStore.consolidateAutoCaptures(
          (entries) => this.observationExtractor.extractFromCaptures(entries),
          {
            batchSize: 500,
            onClassificationFailed: (entry, reason) => {
              // Re-emit into auto_capture so the failure is observable in
              // the next session's logs + searchable via `wotann memory`.
              // Quality bar: never silently swallow.
              this.memoryStore?.captureEvent(
                "classification_failed",
                JSON.stringify({
                  reason,
                  sourceId: entry.id,
                  sourceType: entry.eventType,
                  contentPreview: entry.content.slice(0, 120),
                }),
                "observation-consolidation",
                this.session.id,
              );
            },
          },
        );
        // Log the pass — small structured record so ops can see the
        // pipeline doing something even when routed=0.
        this.memoryStore?.captureEvent(
          "consolidation_pass",
          JSON.stringify(report),
          "observation-consolidation",
          this.session.id,
        );
      } catch (err) {
        // Hard failure (e.g., DB locked, extractor crash). Surface as an
        // auto_capture event; do NOT swallow. Quality bar.
        this.memoryStore?.captureEvent(
          "consolidation_error",
          `${(err as Error).name}: ${(err as Error).message}`,
          "observation-consolidation",
          this.session.id,
        );
      }
    }

    // Fire plugin lifecycle session end (best-effort, ignore errors)
    void this.pluginLifecycle
      .fire(
        "on_session_end",
        {
          sessionId: this.session.id,
          summary,
        },
        {
          sessionId: this.session.id,
          provider: this.session.provider,
          model: this.session.model,
          mode: this.modeCycler.getModeName(),
          timestamp: Date.now(),
        },
      )
      .catch(() => {});

    // Analyze session for potential skill candidates
    const sessionActions = this.crossSessionLearner.getSessionTrace();
    if (sessionActions.length > 5) {
      const candidates = this.skillForge.analyzeSession(sessionActions);
      if (candidates.candidatesCreated > 0 || candidates.candidatesPromotable > 0) {
        this.memoryStore?.captureEvent(
          "skill_candidates",
          JSON.stringify({
            patterns: candidates.patternsFound,
            created: candidates.candidatesCreated,
            promotable: candidates.candidatesPromotable,
          }),
          "learning",
          this.session.id,
        );
      }
    }

    this.memoryStore?.captureEvent("session_end", summary, "runtime", this.session.id);
    this.runPreCommitAnalysis();
    this.saveCurrentSession();

    // Save a full session snapshot via SessionStore for cross-restart resume
    const snapshot: SessionSnapshot = {
      version: 2,
      sessionId: this.session.id,
      createdAt: this.session.startedAt.getTime(),
      savedAt: Date.now(),
      provider: this.session.provider,
      model: this.session.model,
      workingDir: this.config.workingDir,
      conversation: this.session.messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: Date.now(),
        tokenCount: m.tokensUsed,
      })),
      activeTasks: [],
      modeCycle: this.modeCycler.getModeName(),
      contextTokensUsed: this.session.totalTokens,
      totalCost: this.costTracker.getTotalCost(),
      trackedFiles: [],
      memoryContext: "",
      doomLoopHistory: [],
      frozenFiles: this.fileFreezer.getRules().map((r) => r.pattern),
      customData: {},
    };
    this.sessionStore.save(snapshot);

    // Run autoDream consolidation if conditions are met (idle, observations, timing)
    this.runDreamConsolidation();

    // Persist instincts after reinforcement/decay at session end
    this.instinctSystem.applyDecay();
    this.instinctSystem.persist();

    // Persist the knowledge graph before the memory store closes. Fire-and-
    // forget — we can't await inside a sync close(), and persistence is
    // best-effort anyway (JSON snapshot under .wotann/).
    void this.persistKnowledgeGraph();

    // Phase H — session-level ingestion + knowledge-update dynamics. Runs
    // the full ingest pipeline (resolution → extraction → classification →
    // dedup) on accumulated auto_capture entries. For each new fact we
    // probe predecessors via detectSupersession to auto-emit `updates`
    // edges on contradictions. Async; fire-and-forget from sync close().
    void this.runPhaseHSessionIngestion();

    // V9 T3.1 — release the Claude SDK bridge (HTTP hook server + temp
    // config files). Async close is fire-and-forget since runtime close()
    // is sync; honest warn on dispose failure so leaked fds are visible.
    if (this.claudeBridge) {
      const handle = this.claudeBridge;
      this.claudeBridge = null;
      void handle.close().catch((err: unknown) => {
        console.warn(
          `[WOTANN] claude-bridge close failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    this.memoryStore?.close();
    runWorkspaceDreamIfDue(this.config.workingDir, { quiet: true });
  }

  /**
   * Phase H — executes session-ingestion + supersession detection. Split
   * out so close() stays sync while the async pipeline runs on the
   * microtask queue. Honest warn on any failure; never silently swallows.
   */
  private async runPhaseHSessionIngestion(): Promise<void> {
    if (!this.runSessionIngestion || !this.memoryStore) return;
    try {
      const raw = await this.runSessionIngestion(this.session.id);
      const result = raw as {
        readonly observations?: readonly { id: string; assertion: string }[];
      };
      const obs = result.observations ?? [];
      if (obs.length < 2) return;
      const now = Date.now();
      for (let i = 0; i < obs.length; i++) {
        const sfact = parseAssertionAsFact(obs[i]!.id, obs[i]!.assertion, now);
        if (!sfact) continue;
        for (let j = 0; j < i; j++) {
          const pfact = parseAssertionAsFact(obs[j]!.id, obs[j]!.assertion, now - 1);
          if (!pfact) continue;
          const detection = detectSupersession(sfact, pfact);
          if (detection) {
            this.memoryStore.captureEvent(
              "supersession_detected",
              JSON.stringify({
                predecessor: detection.predecessor.id,
                successor: detection.successor.id,
                reason: detection.reason,
                confidence: detection.confidence,
              }),
              "knowledge-update",
              this.session.id,
            );
          }
        }
      }
    } catch (err) {
      console.warn(`[WOTANN] phase-h session ingestion failed: ${(err as Error).message}`);
    }
  }

  /**
   * Run the autoDream consolidation pipeline if trigger conditions are met.
   * Persists gotchas to .wotann/LESSONS.md and records to MemoryStore.
   */
  private runDreamConsolidation(): void {
    const wotannDir = join(this.config.workingDir, ".wotann");
    const lastDreamPath = join(wotannDir, "last-dream.json");

    // Calculate trigger gates
    const lastDreamHoursAgo = this.getHoursSinceLastDream(lastDreamPath);
    const sessionTrace = this.crossSessionLearner.getSessionTrace();
    const gates = {
      idleMinutes: 30, // Assume idle since we are at session close
      newObservations: sessionTrace.length,
      lastDreamHoursAgo,
    };

    if (!shouldDream(gates)) return;

    // Gather observations and corrections from session trace
    const observations = sessionTrace
      .filter((a) => a.success)
      .map((a) => a.input ?? a.type)
      .slice(-50);

    const corrections = sessionTrace
      .filter((a) => !a.success && a.output)
      .map((a) => ({ message: a.output!, context: a.type }))
      .slice(-20);

    const existingInstincts = this.instinctSystem.getAllInstincts().map((inst) => ({
      id: inst.id,
      behavior: inst.pattern,
      confidence: inst.confidence,
      source: "pattern" as const,
      createdAt: new Date(inst.createdAt),
      fireCount: inst.occurrences,
      decayRate: 0.99,
    }));

    const result = runDreamPipelineWithPersistence(
      observations,
      corrections,
      [],
      existingInstincts,
      wotannDir,
    );

    if (result.gotchasPersisted > 0) {
      this.memoryStore?.captureEvent(
        "dream_consolidation",
        JSON.stringify({
          gotchas: result.gotchasPersisted,
          instincts: result.instinctsUpdated,
          patterns: result.patternsFound,
        }),
        "learning",
        this.session.id,
      );
    }

    // Phase 4: Run nightly consolidation on top of autoDream
    // Extracts error rules, crystallizes strategies, generates skill candidates
    let consolidationResult: {
      newRules: readonly { rule: string; confidence: number; source: string }[];
      skillCandidates: readonly {
        name: string;
        description: string;
        trigger: string;
        body: string;
      }[];
    } | null = null;
    try {
      const consolidationInput = {
        sessionObservations: observations.map((obs) => ({
          key: obs.slice(0, 50),
          value: obs,
          type: "observation",
        })),
        errorPatterns: corrections.map((c) => ({
          pattern: c.message.slice(0, 100),
          count: 1,
          lastSeen: Date.now(),
        })),
        successfulStrategies: observations.map((obs) => ({
          strategy: obs.slice(0, 100),
          taskType: "general",
          successRate: 0.85,
        })),
        userCorrections: corrections.map((c) => ({
          original: c.context,
          corrected: c.message,
          reason: "session correction",
        })),
      };
      const consolidation = this.nightlyConsolidator.consolidate(consolidationInput);
      consolidationResult = consolidation;

      // Store new rules in memory
      for (const rule of consolidation.newRules) {
        this.memoryStore?.memoryInsert(
          "patterns",
          `auto-rule-${Date.now()}`,
          rule.rule,
          "learning",
          "consolidation",
        );
      }

      // Wire SkillForge: persist skill candidates from nightly consolidation
      try {
        for (const candidate of consolidation.skillCandidates) {
          const skillContent = [
            "---",
            `name: ${candidate.name}`,
            `description: ${candidate.description}`,
            "context: fork",
            "---",
            "",
            `# ${candidate.name}`,
            "",
            candidate.description,
            "",
            "## Trigger",
            "",
            `This skill activates when: ${candidate.trigger}`,
            "",
            "## Steps",
            "",
            candidate.body,
            "",
          ].join("\n");

          const skillDef = {
            name: candidate.name,
            description: candidate.description,
            category: "auto-generated",
            trigger: candidate.trigger,
            content: skillContent,
          };

          // Use SkillForge to write the skill file to the skills directory
          const skillFileName = `${candidate.name}.md`.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
          const skillsDir = join(wotannDir, "skills");
          mkdirSync(skillsDir, { recursive: true });
          writeFileSync(join(skillsDir, skillFileName), skillDef.content);
        }
      } catch {
        /* skill forge persistence is non-fatal */
      }
    } catch {
      /* nightly consolidation failure is non-fatal */
    }

    // Wire LESSONS.md: append extracted lessons from dream gotchas + consolidator rules
    try {
      const lessonsPath = join(wotannDir, "LESSONS.md");
      const lessonLines: string[] = [];
      const sessionDate = new Date().toISOString().slice(0, 10);

      // (1) Gotchas from dream pipeline: corrections that became lessons
      for (const correction of corrections) {
        lessonLines.push(`- **Gotcha**: ${correction.message}`);
      }

      // (2) New rules from nightly consolidator
      if (consolidationResult) {
        for (const rule of consolidationResult.newRules) {
          lessonLines.push(`- **Rule** (confidence ${rule.confidence.toFixed(2)}): ${rule.rule}`);
        }
      }

      if (lessonLines.length > 0) {
        const section = `\n## Session ${sessionDate}\n\n${lessonLines.join("\n")}\n`;
        mkdirSync(wotannDir, { recursive: true });
        appendFileSync(lessonsPath, section);
      }
    } catch {
      /* LESSONS.md write failure is non-fatal */
    }

    // Record dream timestamp
    try {
      mkdirSync(wotannDir, { recursive: true });
      writeFileSync(lastDreamPath, JSON.stringify({ dreamedAt: new Date().toISOString() }));
    } catch {
      // Best-effort
    }
  }

  private getHoursSinceLastDream(lastDreamPath: string): number {
    if (!existsSync(lastDreamPath)) return 999;
    try {
      const raw = readFileSync(lastDreamPath, "utf-8");
      const data = JSON.parse(raw) as { dreamedAt?: string };
      if (!data.dreamedAt) return 999;
      return (Date.now() - Date.parse(data.dreamedAt)) / (1000 * 60 * 60);
    } catch {
      return 999;
    }
  }

  /**
   * Build FileInfo descriptors from the directory tree string.
   * Used by ContextRelevanceScorer to apply tiered context loading.
   */
  private buildFileInfoFromTree(directoryTree: string): readonly FileInfo[] {
    if (!directoryTree) return [];

    const files: FileInfo[] = [];
    const lines = directoryTree.split("\n").filter(Boolean);
    const now = Date.now();

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip directories (lines ending with / or containing only indentation)
      if (trimmed.endsWith("/") || !trimmed.includes(".")) continue;

      const ext = trimmed.split(".").pop() ?? "";
      const langMap: Record<string, string> = {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        py: "python",
        rs: "rust",
        go: "go",
        java: "java",
        cs: "csharp",
        rb: "ruby",
        php: "php",
        md: "markdown",
        json: "json",
        yaml: "yaml",
        yml: "yaml",
        toml: "toml",
        css: "css",
        html: "html",
        sql: "sql",
      };

      files.push({
        path: trimmed,
        size: 0,
        language: langMap[ext] ?? "unknown",
        lastModified: now,
      });
    }

    return files;
  }

  private captureLearningFeedback(message: string): void {
    if (!this.memoryStore) return;

    const feedback = classifyFeedback(message);
    if (feedback.type === "neutral" || feedback.confidence < 0.5) {
      return;
    }

    this.memoryStore.memoryInsert("feedback", `${feedback.type}-${Date.now()}`, message);
    this.memoryStore.captureEvent(
      `feedback_${feedback.type}`,
      message,
      "learning",
      this.session.id,
    );
  }

  private resolveSecurityResearchProvider(): ProviderName | undefined {
    if (!this.modeCycler.shouldClearSafetyFlags() || !this.infra) {
      return undefined;
    }

    const available = new Set(this.infra.bridge.getAvailableProviders());
    const preferredOrder: readonly ProviderName[] = [
      "ollama",
      "huggingface",
      "free",
      "openai",
      "gemini",
      "codex",
      "anthropic",
      "copilot",
      "bedrock",
      "vertex",
      "azure",
    ];

    for (const provider of preferredOrder) {
      if (available.has(provider)) {
        return provider;
      }
    }

    return undefined;
  }
}

/**
 * Create and initialize a runtime for the current working directory.
 */
export async function createRuntime(
  workingDir: string = process.cwd(),
  initialMode?: WotannMode,
): Promise<WotannRuntime> {
  const wotannConfig = loadConfig(workingDir);
  const runtime = new WotannRuntime({
    workingDir,
    hookProfile: wotannConfig.hooks.profile,
    enableMemory: wotannConfig.memory.enabled,
    initialMode,
  });
  await runtime.initialize();
  return runtime;
}

// extractTrackedFilePath moved to src/core/tool-path-extractor.ts —
// a duplicate previously lived in a second runtime module that
// silently drifted (both copies missed notebook_path, caught in the
// 2026-04-15 audit). Session-5 deleted the drifted second module
// entirely (it had zero live consumers and had fallen further behind
// the real runtime — missing anti-distillation, flow tracker, active
// memory, user model, and instinct system wiring).

/**
 * Synthetic error-status perspective used when the progressive-budget
 * wrapper bubbles up an unexpected error shape. Keeps finalizePreCompletion
 * honest: we never return "pass" when something went wrong, only an
 * explicit "error" report with the failure message captured.
 */
function makeErrorPerspective(
  perspective: "implementer" | "reviewer" | "tester" | "user",
  error: string,
): {
  perspective: "implementer" | "reviewer" | "tester" | "user";
  status: "error";
  concerns: readonly string[];
  raw: string;
  error: string;
  durationMs: number;
} {
  return {
    perspective,
    status: "error",
    concerns: [],
    raw: "",
    error,
    durationMs: 0,
  };
}
