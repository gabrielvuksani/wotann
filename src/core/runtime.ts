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

import type { ProviderName, WotannQueryOptions, AgentMessage, ToolDefinition } from "./types.js";
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
import { DoomLoopDetector } from "../hooks/doom-loop-detector.js";
import { createDefaultPipeline, type MiddlewarePipeline } from "../middleware/pipeline.js";
import { assembleSystemPromptParts } from "../prompt/engine.js";
import { canBypass, executeBypass } from "../utils/wasm-bypass.js";
import { CostTracker } from "../telemetry/cost-tracker.js";
import { MemoryStore } from "../memory/store.js";
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
import { join } from "node:path";
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
import {
  applyHashEdit,
  type HashEditOperation,
  type HashEditResult,
} from "../tools/hashline-edit.js";
import { HASH_ANCHORED_EDIT_TOOL_SCHEMA } from "../tools/hash-anchored-edit.js";
import { ImageGenRouter } from "../tools/image-gen-router.js";
import { compileAmbientContext, type AmbientContext } from "../intelligence/ambient-awareness.js";
import { generateFakeTools } from "../security/anti-distillation.js";
import { UnifiedDispatchPlane } from "../channels/unified-dispatch.js";
import { writeAutonomousProofBundle } from "../orchestration/proof-bundles.js";
import type { AutonomousResult } from "../orchestration/autonomous.js";
import { runArenaContest, ArenaLeaderboard } from "../orchestration/arena.js";
import type { ArenaContestant } from "../orchestration/arena.js";
import { runCouncil, CouncilLeaderboard } from "../orchestration/council.js";
import type { CouncilResult, CouncilQueryExecutor } from "../orchestration/council.js";
import { PIIRedactor } from "../security/pii-redactor.js";
import { VectorStore, HybridMemorySearch } from "../memory/vector-store.js";
import { RulesOfEngagement } from "../security/rules-of-engagement.js";
import { TrainingPipeline } from "../training/pipeline.js";
import { AutoresearchEngine } from "../training/autoresearch.js";
import { createLlmModificationGenerator } from "../training/llm-modification-generator.js";
import { evaluateCompletion, getDefaultCriteria } from "../autopilot/completion-oracle.js";
import type { CompletionCriterion, VerificationEvidence } from "../autopilot/types.js";
import { TaskDelegationManager } from "../orchestration/task-delegation.js";

// Phase E: Auto-features
import { AutoClassifier } from "../security/auto-classifier.js";
import { IntentVerifier } from "../security/intent-verifier.js";
import { PrivacyRouter } from "../security/privacy-router.js";
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
import {
  detectTruncatedThinking,
  buildContinuationPrompt,
} from "../intelligence/prefill-continuation.js";
import { agentRegistry, type AgentRegistry } from "../orchestration/agent-registry.js";

// ── Tier 2B: LLM-invokable tools ──
import { WebFetchTool } from "../tools/web-fetch.js";
import { PlanStore } from "../orchestration/plan-store.js";

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

// ── Types ──────────────────────────────────────────────────

export type ThinkingEffort = "low" | "medium" | "high" | "max";

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
  private hookEngine: HookEngine;
  private doomLoop: DoomLoopDetector;
  private pipeline: MiddlewarePipeline;
  private costTracker: CostTracker;
  private amplifier: IntelligenceAmplifier;
  private reasoningSandwich: ReasoningSandwich;
  private traceAnalyzer: TraceAnalyzer;
  private modeCycler: ModeCycler;
  private accountPool: AccountPool;
  private semanticIndex: TFIDFIndex;
  // Session-6 (GAP-11 fix): QuantizedVectorStore was ADDED in session-2
  // and RUNTIME-TEST-SCAFFOLDED in session-4 but the session-4 audit
  // agent missed that runtime.ts never instantiated it — zero consumers.
  // Session-6 now wires it as an OPT-IN companion index: when
  // `WOTANN_ENABLE_ONNX_EMBEDDINGS=1` is set + @xenova/transformers is
  // installed, every addDocument to semanticIndex is mirrored here, and
  // searchEnhanced() runs RRF-merge between TF-IDF and MiniLM. The
  // async search path is exposed via a new runtime method rather than
  // replacing the sync semanticIndex.search (which still has 2 legacy
  // callsites at runtime.ts:2818, :817 and memory/store.ts:817).
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
  private privacyRouter: PrivacyRouter;
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

  constructor(config: RuntimeConfig) {
    this.config = config;

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
    // Session-6 (GAP-11): opt-in MiniLM semantic search via
    // @xenova/transformers. Runs as a COMPANION index to semanticIndex
    // when WOTANN_ENABLE_ONNX_EMBEDDINGS=1 is set. Falls back to
    // TF-IDF silently if the optional dep isn't installed. See
    // src/memory/quantized-vector-store.ts for the implementation.
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
    this.autonomousExecutor = new AutonomousExecutor({
      enableShadowGit: true,
      enableCheckpoints: true,
      checkpointDir: join(config.workingDir, ".wotann", "autonomous-checkpoints"),
    });

    // Notification manager: surface task-complete / error / budget-alert
    // / channel-message / companion-paired events to desktop + iOS.
    this.notificationManager = new NotificationManager();

    // Context source inspector: shows exactly what's in the context window (Ctrl+I)
    this.contextInspector = new ContextSourceInspector();

    // Persona manager: 8-file bootstrap, dynamic persona stacking
    this.personaManager = new PersonaManager(join(config.workingDir, ".wotann", "identity"));

    // Self-healing pipeline: graduated error recovery (prompt-fix → rollback → strategy-change → escalation)
    this.selfHealingPipeline = new SelfHealingPipeline();

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
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path, content, "utf-8");
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
    this.privacyRouter = new PrivacyRouter();
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
  }

  /** Get the image generation router for multi-provider image routing. */
  getImageGenRouter(): ImageGenRouter {
    return this.imageGenRouter;
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
    const pluginManager = new PluginManager(join(this.config.workingDir, ".wotann", "plugins"));
    const plugins = await pluginManager.loadInstalled();
    for (const plugin of plugins) {
      for (const hook of plugin.hooks) {
        this.hookEngine.register(hook);
      }
    }
    this.pluginPanels = plugins.flatMap((plugin) => plugin.panels);

    // Discover providers
    const providers = await discoverProviders();
    if (providers.length > 0) {
      this.infra = createProviderInfrastructure(providers, this.accountPool);
      this.infra.router.hydrateRepoPerformance(this.modelPerformanceStore.load());
      const firstProvider = providers[0];
      if (firstProvider) {
        this.session = createSession(firstProvider.provider, firstProvider.models[0] ?? "auto");
        this.contextIntelligence.adaptToProvider(this.session.provider, this.session.model);
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

    // Assemble system prompt from 8-file bootstrap + mode instructions + local context
    const basePrompt = assembleSystemPromptParts({
      workspaceRoot: this.config.workingDir,
      mode: "careful",
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

    this.systemPrompt = [
      basePrompt.cachedPrefix,
      basePrompt.dynamicSuffix,
      modeInstructions,
      this.localContextPrompt,
      userModelContext ? `[User Profile]\n${userModelContext}` : "",
      crossDevicePrompt ? `[Cross-Device Context]\n${crossDevicePrompt}` : "",
      wakeUpPayload.combinedPrompt ? `[Memory Context]\n${wakeUpPayload.combinedPrompt}` : "",
      adaptiveSection,
    ]
      .filter(Boolean)
      .join("\n\n");

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
    try {
      const activeResult = this.activeMemory.preprocess(options.prompt, this.session.id);
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
          // No dedicated search adapter yet — when a Gemini provider is
          // active and `google_search` grounding is wired (roadmap v0.3),
          // this is the hook point. For now we leave search optional so
          // callers (iOS, desktop) can inject their own.
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
          "Fetch a URL and return its text content (HTML stripped). Use for documentation, APIs, or web research.",
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
        const compacted = compactConversationHistory(
          this.session.messages,
          compactionPlan.stage ?? "old-messages",
        );
        if (compacted) {
          await this.hookEngine.fire({
            event: "PreCompact",
            content: `${compactionPlan.stage}:${compacted.removedMessages}`,
            sessionId: this.session.id,
          });

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

      // Build the full system prompt with mode instructions + reasoning guidance
      const fullSystemPrompt = [
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
      if (this.config.enableAntiDistillation) {
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

            // ── Tier 2B: Runtime-handled tool execution ──
            // TODO(god-object-extraction): Replace individual tool dispatch cases below with:
            // if (isRuntimeTool(toolName) && chunk.toolInput) {
            //   const dispatchResult = await dispatchRuntimeTool(toolName, chunk.toolInput as Record<string, unknown>, {
            //     webFetch: this.webFetchTool,
            //     planStore: this.planStore,
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
      const inputTokens = Math.floor(totalTokens / 2);
      const outputTokens = totalTokens - inputTokens;
      const costEntry = this.costTracker.record(
        responseProvider,
        responseModel,
        inputTokens,
        outputTokens,
      );
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
    this.systemPrompt = [
      basePrompt.cachedPrefix,
      basePrompt.dynamicSuffix,
      modeInstructions,
      this.localContextPrompt,
    ]
      .filter(Boolean)
      .join("\n\n");
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
   * Search memory using hybrid search (RRF fusion of FTS5 keyword + vector similarity).
   */
  searchMemory(
    query: string,
  ): readonly { id: string; score: number; text: string; type: string }[] {
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

    return results.sort((a, b) => b.score - a.score).slice(0, 10);
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

  /**
   * Get the privacy router for PII-based provider routing.
   */
  getPrivacyRouter(): PrivacyRouter {
    return this.privacyRouter;
  }

  /**
   * Get the auto-verifier for post-edit verification.
   */
  getAutoVerifier(): AutoVerifier {
    return this.autoVerifier;
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
    if (this.config.enableHooks === false) {
      return { content: rawContent, blocked: false };
    }
    const result = await this.hookEngine.fire({
      event: "ToolResultReceived",
      toolName,
      content: rawContent,
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
    return { content: rawContent, blocked: false };
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
    // Late-require node:path to avoid a top-level import churn.
    // Safe inside WotannRuntime methods (always runs in Node).
    const path = require("node:path") as typeof import("node:path");
    return path.join(this.config.workingDir, ".wotann", "knowledge-graph.json");
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
   */
  async persistKnowledgeGraph(): Promise<void> {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const target = this.knowledgeGraphPath();
      const dir = path.dirname(target);
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
      await fs.writeFile(tmp, this.knowledgeGraph.toJSON(), "utf-8");
      await fs.rename(tmp, target);
    } catch {
      /* persistence is best-effort — a disk error during shutdown should
         not propagate and kill the rest of runtime.close(). */
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
    } = {},
  ): Promise<{
    completed: boolean;
    score: number;
    evidence: readonly VerificationEvidence[];
  }> {
    const criteria = options.criteria ?? getDefaultCriteria(options.taskType ?? "code");
    const threshold = options.threshold ?? 0.75;

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
   * Get a spawn configuration for an agent by ID, using the centralized registry.
   * Returns undefined if the agent ID is not registered.
   */
  getAgentSpawnConfig(agentId: string, task: string) {
    return this.agentRegistryInstance.spawn(agentId, task);
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

    // C7: Dream pipeline seed — feed the full conversation into the
    // ObservationExtractor so downstream dream / instinct / self-evolution
    // stages have structured observations to consolidate at night.
    try {
      const now = new Date().toISOString();
      const captures = this.session.messages
        .filter((m) => typeof m.content === "string" && m.content.length > 0)
        .map((m, idx) => ({
          id: idx,
          eventType: m.role === "user" ? "user_message" : "assistant_response",
          content: (m.content as string).slice(0, 4000),
          createdAt: now,
        }));
      if (captures.length > 0) {
        const observations = this.observationExtractor.extractFromCaptures(captures);
        for (const obs of observations.slice(0, 50)) {
          // Promote observations to structured memory_entries (not auto_capture again).
          // Map ObservationType → MemoryBlockType: decision→decisions, preference→feedback,
          // milestone→project, problem→issues, discovery→cases.
          const blockType =
            obs.type === "decision"
              ? "decisions"
              : obs.type === "preference"
                ? "feedback"
                : obs.type === "milestone"
                  ? "project"
                  : obs.type === "problem"
                    ? "issues"
                    : "cases";
          this.memoryStore?.insert({
            id: obs.id,
            layer: "working",
            blockType,
            key: `${obs.type}:${obs.assertion.slice(0, 80)}`,
            value: obs.assertion,
            sessionId: this.session.id,
            verified: false,
            freshnessScore: 1.0,
            confidenceLevel: obs.confidence,
            verificationStatus: "unverified",
            tags: obs.type,
            domain: obs.domain ?? "",
            topic: obs.topic ?? "",
          });
        }
      }
    } catch {
      // Best-effort — observation extraction must never block shutdown.
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

    this.memoryStore?.close();
    runWorkspaceDreamIfDue(this.config.workingDir, { quiet: true });
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
