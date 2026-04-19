/**
 * WOTANN module exports — public API for programmatic access.
 *
 * Import from "wotann" or "wotann/lib" instead of deep paths.
 */

// ── Core ─────────────────────────────────────────────────
export { type WotannMode, type ModeConfig, ModeCycler } from "./core/mode-cycling.js";
export { type ContextActivationMode, type ModelContextConfig } from "./context/limits.js";
export {
  getModelContextConfig,
  isExtendedContextEnabled,
  getMaxAvailableContext,
} from "./context/limits.js";
export {
  ConversationBranchManager,
  type ConversationBranch,
  type ConversationTurn,
} from "./core/conversation-branching.js";

// ── Context ──────────────────────────────────────────────
export {
  ContextSourceInspector,
  estimateTokens,
  type ContextSection,
  type ContextInspectorSnapshot,
} from "./context/inspector.js";

// ── Providers ────────────────────────────────────────────
export {
  CapabilityFingerprinter,
  type CapabilityId,
  type ProviderFingerprint,
} from "./providers/capability-fingerprint.js";
export { getProviderHeaders, buildProviderUrl } from "./providers/header-injection.js";
export {
  AccountPool,
  type AccountCredential,
  type AccountHealth,
} from "./providers/account-pool.js";
export {
  CredentialPool,
  type CredentialPoolConfig,
  type RotationStrategy,
} from "./providers/credential-pool.js";
export {
  buildFallbackChain,
  resolveNextProvider,
  describeFallbackChain,
  type FallbackEntry,
} from "./providers/fallback-chain.js";
export {
  anthropicToOpenAI,
  openAIToAnthropic,
  toAgentMessages,
} from "./providers/format-translator.js";
export { ThinkingPreserver, type ThinkingBlock } from "./providers/thinking-preserver.js";
export {
  CapabilityEqualizer,
  type ModelCapabilityProfile,
  type CapabilityGap,
  type CapabilityName,
} from "./providers/capability-equalizer.js";
export {
  getThinkingMethod,
  buildThinkingParams,
  extractThinking,
  type ThinkingConfig,
  type ThinkingResult,
  type ThinkingMethod,
} from "./providers/extended-thinking.js";

// ── Memory ───────────────────────────────────────────────
export {
  MemoryStore,
  type MemoryEntry,
  type MemorySearchResult,
  type VectorSearchResult,
  type ContradictionResult,
  type MemoryProvenance,
  type MemorySourceType,
} from "./memory/store.js";
export {
  type MemoryProvider,
  InMemoryProvider,
  MultiTurnMemory,
  registerMemoryProvider,
  setActiveMemoryProvider,
  getActiveMemoryProvider,
  calculateFreshness,
  detectContradiction as detectMemoryContradiction,
  type MultiTurnEntry,
} from "./memory/pluggable-provider.js";

// ── Channels ─────────────────────────────────────────────
export { ChannelGateway, type ChannelMessage, type ChannelType } from "./channels/gateway.js";
export {
  UnifiedDispatchPlane,
  type TaskPriority,
  type TaskStatus,
  type ChannelHealth,
  type DispatchTask,
} from "./channels/unified-dispatch.js";

// ── Identity ─────────────────────────────────────────────
export {
  PersonaManager,
  loadIdentity,
  loadBootstrapFiles,
  buildIdentityPrompt,
  type BootstrapResult,
} from "./identity/persona.js";

// ── Security ─────────────────────────────────────────────
export {
  getSafetyOverrides,
  getExtendedSafetyOverrides,
  GuardrailsAuditTrail,
} from "./security/guardrails-off.js";
export {
  SecretScanner,
  PIIRedactor,
  type SecretPattern,
  type ScanResult,
  type SecretFinding,
} from "./security/secret-scanner.js";

// ── Intelligence ─────────────────────────────────────────
export {
  compileAmbientContext,
  fileProximity,
  taskTrajectory,
  AmbientAwareness,
  type AmbientContext,
  type AmbientSignal,
  type AmbientSignalType,
} from "./intelligence/ambient-awareness.js";
export {
  DeepResearchEngine,
  decomposeQuery,
  extractKeywords,
  scoreRelevance,
  identifyGaps,
  deduplicateCitations,
  extractKeyPassages,
  type ResearchConfig,
  type ResearchResult,
  type Citation,
  type ResearchStep,
  type SearchHit,
} from "./intelligence/deep-research.js";

// ── UI ───────────────────────────────────────────────────
export {
  CanvasEditor,
  type CanvasSession,
  type CanvasHunk,
  type CanvasStats,
} from "./ui/canvas.js";

// ── Marketplace ──────────────────────────────────────────
// S5-3: MCPMarketplace removed — vaporware (hardcoded 5 entries, fake
// registry URL). The real MCP integration is MCPRegistry (below) which
// imports MCP servers from the user's Claude Code / Cursor / Windsurf
// configs instead of making up a registry.

// ── Orchestration ────────────────────────────────────────
export {
  TaskDelegationManager,
  type DelegationTask,
  type DelegationResult,
} from "./orchestration/task-delegation.js";
export {
  GraphBuilder,
  executeGraph,
  type ExecutionGraph,
  type GraphNode,
  type GraphEdge,
} from "./orchestration/graph-dsl.js";
export {
  AutonomousExecutor,
  type AutonomousConfig,
  type AutonomousCycleResult,
  type AutonomousResult,
  type ExitReason,
  type Strategy,
} from "./orchestration/autonomous.js";
export {
  Coordinator,
  type CoordinatorTask,
  type CoordinatorWorktree,
} from "./orchestration/coordinator.js";

// ── Tools ────────────────────────────────────────────────
export {
  applyHashEdit,
  hashLine,
  hashBlock,
  hashFile,
  buildLineIndex,
  findByHash,
  type HashEditOperation,
  type HashEditResult,
} from "./tools/hashline-edit.js";
export { ShadowGit } from "./utils/shadow-git.js";

// ── Plugins ──────────────────────────────────────────────
export {
  PluginLifecycle,
  PromptQueue,
  type LifecycleEvent,
  type LifecycleHandler,
  type QueuedPrompt,
} from "./plugins/lifecycle.js";

// ── API Server ───────────────────────────────────────────
export {
  WotannAPIServer,
  WotannMCPServer,
  type APIServerConfig,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
} from "./api/server.js";

// ── Telemetry ────────────────────────────────────────────
export { CostTracker, type CostPrediction } from "./telemetry/cost-tracker.js";
export {
  SessionRecorder,
  SessionPlayer,
  type ReplaySession,
  type ReplayEvent,
} from "./telemetry/session-replay.js";
export {
  createDefaultBenchmarks,
  runBenchmarks,
  type ProofBundle,
  type BenchmarkResult,
} from "./telemetry/benchmarks.js";

// ── Learning ─────────────────────────────────────────────
export { CrossSessionLearner, type Learning, type LearningType } from "./learning/cross-session.js";

// ── Self-Healing ─────────────────────────────────────────
export {
  SelfHealingPipeline,
  classifyError,
  detectErrorRepetition,
  type ClassifiedError,
  type RecoveryResult,
  type PipelineResult,
  type ErrorCategory,
} from "./orchestration/self-healing-pipeline.js";

// ── Voice ────────────────────────────────────────────────
export {
  VoicePipeline,
  type VoiceConfig,
  type TranscriptionResult,
  type VoicePipelineStats,
  type STTBackend,
  type TTSBackend,
} from "./voice/voice-pipeline.js";

// ── Browser ──────────────────────────────────────────────
export {
  ChromeBridge,
  createChromeBridge,
  type BrowserAction,
  type BrowserActionResult,
  type DOMElement,
  type ChromeTab,
} from "./browser/chrome-bridge.js";

// ── LSP ──────────────────────────────────────────────────
export {
  LSPManager,
  SymbolOperations,
  applyRenameResult,
  type SymbolInfo,
  type TextEdit,
  type RenameResult,
  type LSPLocation,
} from "./lsp/symbol-operations.js";

// ── Arena ────────────────────────────────────────────────
export {
  runArenaContest,
  ArenaLeaderboard,
  type ArenaResult,
  type ArenaContestant,
  type ArenaLeaderboardEntry,
} from "./orchestration/arena.js";

// ── Wave Executor ────────────────────────────────────────
export {
  buildWaves,
  buildFreshContextWaves,
  executeWaves,
  executeWavesWithFreshContext,
  type Wave,
  type WaveTask,
  type FreshContextTask,
  type FreshContextWave,
  type WaveExecutionResult,
  type ContextResolver,
} from "./orchestration/wave-executor.js";

// ── Visual Verification ──────────────────────────────────
export {
  verifyVisual,
  captureScreenshot,
  extractTextFromImage,
  detectVerificationMode,
  type VisualVerificationResult,
} from "./testing/visual-verifier.js";

// ── Context Advanced ─────────────────────────────────────
export {
  compactHybrid,
  evictOldest,
  evictByType,
  summarizeOlder,
  type CompactionStrategy,
  type CompactionResult,
} from "./context/compaction.js";
export {
  TieredContextLoader,
  type ContextTier,
  type TieredFile,
  type TieredLoaderConfig,
  type FileInput,
} from "./context/tiered-loader.js";

// ── Episodic Memory ──────────────────────────────────────
export { EpisodicMemory, type Episode, type EpisodeEvent } from "./memory/episodic-memory.js";

// ── Proactive Memory ─────────────────────────────────────
export {
  ProactiveMemoryEngine,
  type ProactiveHint,
  type ProactiveConfig,
  type ProactiveTrigger,
} from "./memory/proactive-memory.js";

// ── Knowledge Fabric ────────────────────────────────────
export {
  KnowledgeGraph,
  type Entity,
  type Relationship,
  type DualRetrievalResult,
} from "./memory/graph-rag.js";
export { ContextTree, type ContextNode } from "./memory/context-tree.js";
export {
  CloudSyncEngine,
  type MemorySnapshot as SyncSnapshot,
  type MergeResult,
} from "./memory/cloud-sync.js";

// ── Self-Improving Agent ────────────────────────────────
export {
  AutoresearchEngine,
  type ExperimentConfig,
  type ExperimentResult,
} from "./training/autoresearch.js";
export { SkillForge, type SkillPattern, type SkillCandidate } from "./learning/skill-forge.js";
export { InstinctSystem } from "./learning/instinct-system.js";
export type { Instinct, DreamInstinct } from "./learning/types.js";

// ── Infinite Context ────────────────────────────────────
export { TurboQuantEngine, type TurboQuantConfig } from "./context/ollama-kv-compression.js";
export {
  VirtualContextManager,
  type ActiveContext,
  type ArchivedSegment,
} from "./context/virtual-context.js";

// ── Autopilot ───────────────────────────────────────────
// S2-9: NeverStopExecutor removed — strategies are now in
// AutonomousExecutor (src/orchestration/autonomous.ts).
export { PRArtifactGenerator, type PRTemplate } from "./autopilot/pr-artifacts.js";

// ── Phase 14: DEAD-code resurrection — public API exposure ────
// Makes previously-orphaned modules reachable to consumers without
// requiring imports from src/. Each is fully implemented; wiring into
// runtime/daemon tracked in docs/PHASE_14_PROGRESS.md.
export {
  crystallizeSuccess,
  slugifyPrompt,
  redactPrompt,
  type CrystallizationInput,
  type CrystallizationResult,
} from "./skills/self-crystallization.js";
export {
  loadRequiredReading,
  renderRequiredReadingBlock,
  hasMandatoryFailures,
  type ResolvedRequiredReading,
  type RequiredReadingOptions,
} from "./agents/required-reading.js";
// Note: VisualDiffTheater is already exported earlier in this file —
// not re-exporting here.
export {
  PerceptionAdapter,
  type ModelCapabilities,
  type PerceptionOutput,
} from "./computer-use/perception-adapter.js";

// ── Security (extended) ─────────────────────────────────
export { SkillsGuard, type SkillScanResult } from "./security/skills-guard.js";
export { HashAuditChain, type AuditEntry } from "./security/hash-audit-chain.js";

// ── Training Pipeline ───────────────────────────────────
export { TrainingPipeline, type TrainingPair, type TrainingConfig } from "./training/pipeline.js";
export {
  RLEnvironment,
  type Episode as RLEpisode,
  type RewardComponents,
} from "./training/rl-environment.js";
export { SessionExtractor } from "./training/session-extractor.js";

// ── Workspace ───────────────────────────────────────────
export { VirtualPathResolver } from "./core/virtual-paths.js";
export { ConfigDiscovery, type DiscoveredConfig } from "./core/config-discovery.js";

// ── Voice (extended) ────────────────────────────────────
export {
  VibeVoiceBackend,
  type VibeVoiceConfig,
  type VibeVoiceStatus,
} from "./voice/vibevoice-backend.js";

// ── Desktop ─────────────────────────────────────────────
export { PromptEnhancer } from "./desktop/prompt-enhancer.js";
export { type PromptEnhancerResult } from "./desktop/types.js";
export { CompanionServer, PairingManager } from "./desktop/companion-server.js";

// ── Council ─────────────────────────────────────────────
export {
  runCouncil,
  type CouncilResult,
  type CouncilMember,
  type CouncilConfig,
} from "./orchestration/council.js";

// ── Intelligence (extended) ─────────────────────────────
export {
  optimizeToolSchema,
  DoomLoopFingerprinter,
  getModelProfile,
  correctToolCallArgs,
  runPreCompletionChecklist,
  discoverEntryPoints,
  allocateReasoningBudget,
  type DoomLoopCheck,
  type ModelHarnessProfile,
  type ChecklistItem,
  type CompletionChecklist,
  type EntryPoint,
  type ReasoningBudget,
} from "./intelligence/forgecode-techniques.js";
export {
  ProviderArbitrageEngine,
  type ArbitrageRoute,
  type CostArbitrageReport,
  type ProviderCostSummary,
} from "./intelligence/provider-arbitrage.js";
export {
  PredictiveContextLoader,
  type PredictedFile,
  type PreloadResult,
  type PredictionAccuracy,
} from "./intelligence/predictive-context.js";
export {
  analyzeCodebaseHealth,
  type FileMetric,
  type CodebaseHealthReport,
} from "./intelligence/codebase-health.js";
export {
  AITimeMachine,
  type ForkPoint,
  type Timeline,
  type TimelineComparison,
  type TimelineRanking,
  type MergeResult as TimelineMergeResult,
  type TimelineTreeNode,
  type TimelineTree,
} from "./intelligence/ai-time-machine.js";
export {
  SmartRetryEngine,
  type RetryStrategyType,
  type Attempt,
  type RetryStrategy,
  type SmartRetryResult,
} from "./intelligence/smart-retry.js";

// ── Orchestration (extended) ────────────────────────────
export {
  SpecToShipPipeline,
  type ParsedSpec,
  type SpecRequirement,
  type PipelinePhase,
  type PipelineTask,
  type ImplementationPlan,
  type PhasePlan,
  type TaskExecutor as SpecTaskExecutor,
  type TaskResult,
  type PipelineProgress,
} from "./orchestration/spec-to-ship.js";
// Session-6: orchestration/agent-messaging removed — zero external consumers.
export {
  PlanStore,
  type Plan,
  type PlanMilestone,
  type PlanTask,
  type PlanSummary,
  type MilestoneStatus,
  type TaskStatus as PlanTaskStatus,
  type TaskPhase,
} from "./orchestration/plan-store.js";
// Session-6: orchestration/consensus-router removed — zero external consumers.
export {
  RedBlueTestRunner,
  type TaskExecutor as RedBlueTaskExecutor,
  type RedResult,
  type BlueFinding,
  type BlueResult,
  type AdversarialRound,
  type AdversarialResult,
} from "./orchestration/red-blue-testing.js";
// Session-6: orchestration/ambient-code-radio removed — zero external consumers.
export {
  AutoCommitter,
  type ConventionalType,
  type ConventionalCommit,
  type CommitResult,
  type CommitRecord,
} from "./orchestration/auto-commit.js";

// ── Memory (extended) ───────────────────────────────────
export {
  TemporalMemory,
  type TemporalEntry,
  type TimelineSummary,
  type CategoryCount,
  type Trend,
} from "./memory/temporal-memory.js";

// ── Testing (extended) ──────────────────────────────────
export {
  VisualDiffTheater,
  type FileChange,
  type DiffHunk,
  type DiffSession,
  type ApplyResult as DiffApplyResult,
} from "./testing/visual-diff-theater.js";

// ── Security (plugin sandbox) ───────────────────────────
export {
  PluginSandbox,
  type SandboxPermissions,
  type SandboxContext,
  type SandboxResult,
  type SandboxLogEntry,
  type ScanResult as SandboxScanResult,
  type ScanFinding,
} from "./security/plugin-sandbox.js";

// ── Telemetry (extended) ────────────────────────────────
export {
  CostOracle,
  type CostEstimate,
  type CostBreakdown,
  type ProviderCostComparison,
} from "./telemetry/cost-oracle.js";
// Session-6: telemetry/provider-cost-dashboard removed — zero external consumers.

// ── Learning (extended) ─────────────────────────────────
export { DecisionLedger, type Decision, type DecisionInput } from "./learning/decision-ledger.js";

// ── Sandbox ─────────────────────────────────────────────
export {
  TaskIsolationManager,
  TaskIsolationError,
  type IsolatedTask,
  type IsolatedTaskStatus,
  type MergeResult as IsolationMergeResult,
  type CleanupResult,
} from "./sandbox/task-isolation.js";
export {
  DockerSandbox,
  DockerSandboxError,
  type DockerSandboxConfig,
  type ExecResult,
  type ContainerInfo,
} from "./sandbox/docker-backend.js";

// ── Providers (extended) ────────────────────────────────
export {
  ModelSwitcher,
  type ModelSwitchResult,
  type SwitchCompatibility,
  type SwitchContext,
} from "./providers/model-switcher.js";

// ── Core (extended) ─────────────────────────────────────
export {
  SteeringServer,
  type SteeringCommand,
  type SteeringCommandType,
  type SteeringServerOptions,
} from "./core/steering-server.js";
export {
  ProjectOnboarder,
  type StackProfile,
  type LanguageInfo,
  type DependencyNode,
  type DependencyGraph,
  type CodeFlowAnalysis,
  type OnboardingResult,
} from "./core/project-onboarding.js";

// ── UI (extended) ───────────────────────────────────────
export {
  AgentFleetDashboard,
  type AgentStatus as FleetAgentStatus,
  type AgentFleetStatus,
} from "./ui/agent-fleet-dashboard.js";

// ── Desktop (extended) ──────────────────────────────────
export {
  MAIN_WINDOW,
  SETTINGS_WINDOW,
  COMPANION_WINDOW,
  TRAY_MENU,
  GLOBAL_HOTKEYS,
  APP_METADATA,
  WOTANN_DARK_THEME,
  WOTANN_LIGHT_THEME,
  generateTauriConfig,
  type TauriWindowConfig,
  type TrayMenuItem,
  type GlobalHotkey,
  type DesktopTheme,
  type ThemeColors,
  type TauriCommand,
} from "./desktop/tauri-config.js";
export {
  FULL_LAYOUT,
  COMPACT_LAYOUT,
  FOCUSED_LAYOUT,
  MINI_LAYOUT,
  SIDEBAR_TABS,
  CONTEXT_SECTIONS,
  DEFAULT_PROMPT_BAR,
  calculateLayout,
  getMainContentWidth,
  DEFAULT_ANIMATIONS,
  type LayoutMode,
  type LayoutConfig,
  type PanelState,
  type SidebarTab,
  type SidebarTabConfig,
  type ContextSection as LayoutContextSection,
  type ContextSectionConfig,
  type PromptBarConfig,
  type AnimationConfig,
} from "./desktop/layout.js";
export {
  CommandPalette,
  fuzzyScore,
  createDefaultPaletteCommands,
  type PaletteCommand,
  type PaletteCategory,
  type PaletteSearchResult,
  type PaletteActionCallbacks,
} from "./desktop/command-palette.js";

// ── Desktop (Phase 1C — previously disconnected modules) ──
export {
  appReducer,
  INITIAL_STATE,
  type DesktopAppState,
  type AppAction,
} from "./desktop/app-state.js";
export {
  createConversation,
  addMessage,
  archiveConversation,
  forkConversation,
  getSortedSummaries,
  searchConversations,
  type Conversation,
  type DesktopMessage,
  type ConversationSummary,
} from "./desktop/conversation-manager.js";
export {
  DEFAULT_SHORTCUTS,
  normalizeShortcut,
  type KeyboardShortcut,
  type ShortcutScope,
} from "./desktop/keyboard-shortcuts.js";
export {
  NotificationManager,
  type NotificationPreferences,
  type NotificationType,
} from "./desktop/notification-manager.js";
export {
  createProject,
  renameProject,
  updateDescription,
  updateCustomInstructions,
  pinProject,
  searchProjects,
  type Project,
} from "./desktop/project-manager.js";
export {
  extractArtifacts,
  computeLineDiff,
  type Artifact,
  type ArtifactType,
  type ArtifactVersion,
} from "./desktop/artifacts.js";

// ── Intelligence (Phase 1A — newly wired) ──
export {
  AccuracyBooster,
  classifyTaskType,
  type AccuracyContext,
  type BoostedQuery,
  type TaskType,
} from "./intelligence/accuracy-boost.js";
export {
  ContextRelevanceScorer,
  type FileInfo,
  type ScoredFile,
  type TieredContext,
} from "./intelligence/context-relevance.js";
export {
  ResponseValidator,
  type ValidationResult,
  type ValidationIssue,
  type ValidationContext,
} from "./intelligence/response-validator.js";

// ── Middleware (Phase 1A — newly wired) ──
export { ResponseCache, type CacheStats } from "./middleware/response-cache.js";

// ── Security (Phase 1A — newly wired) ──
export { generateFakeTools, embedWatermark } from "./security/anti-distillation.js";

// ── Intelligence (Phase 0 — accuracy techniques) ──
export {
  MicroEvalRunner,
  type MicroEvalResult,
  type MicroEvalSuite,
} from "./intelligence/micro-eval.js";
export {
  TrajectoryScorer,
  type TurnScore,
  type TrajectoryAnalysis,
} from "./intelligence/trajectory-scorer.js";
export { ErrorPatternLearner, type ErrorPattern } from "./intelligence/error-pattern-learner.js";

// ── Daemon (Phase 16 — KAIROS unified runtime) ──
export {
  KairosRPCHandler,
  type RPCRequest,
  type RPCResponse,
  type RPCStreamEvent,
  type SessionInfo,
  type AgentInfo,
  type CostSnapshot,
  type ProviderInfo,
} from "./daemon/kairos-rpc.js";
export {
  KairosIPCServer,
  KairosIPCClient,
  type IPCServerConfig,
  type IPCConnection,
} from "./daemon/kairos-ipc.js";

// ── Desktop (Phase 1C — runtime bridge) ──
export { DesktopRuntimeBridge } from "./desktop/desktop-runtime-bridge.js";

// ── Mobile (Phase 1B — connected to companion server) ──
export {
  SecureAuthManager,
  type PairingRequest,
  type PairingResult,
  type SessionToken,
} from "./mobile/secure-auth.js";
export { resolveHaptic, type HapticPattern } from "./mobile/haptic-feedback.js";

// ── Phase D — Terminal Backends ────────────────────────
export {
  LocalBackend,
  DockerTerminalBackend,
  SSHBackend,
  createBackend,
  BackendError,
  type BackendType,
  type TerminalBackend,
  type BackendConfig,
  type ExecResult as BackendExecResult,
} from "./sandbox/terminal-backends.js";

// ── Phase D — BugBot Autofix Pipeline ──────────────────
export {
  BugBot,
  type BugReport,
  type BugSeverity,
  type BugBotConfig,
} from "./intelligence/bugbot.js";

// ── Phase D — Codemaps Visualization ───────────────────
export {
  CodemapBuilder,
  type CodeNode,
  type CodeEdge,
  type CodemapResult,
  type NodeType,
  type EdgeType,
} from "./intelligence/codemaps.js";

// ── Phase D — Image Generation Router ──────────────────
export {
  ImageGenRouter,
  type RouteResult as ImageRouteResult,
  type ProviderCapability,
  type PromptCategory,
} from "./tools/image-gen-router.js";

// ── Phase D — Video Processor ──────────────────────────
// S2-9: VideoProcessor removed — never invoked during any query.

// ── Phase D — Auto-Reviewer ────────────────────────────
export {
  AutoReviewer,
  type ReviewViolation,
  type ViolationSeverity,
  type ReviewRule,
  type FileChange as ReviewFileChange,
  type ReviewReport,
  type ReviewConfig,
} from "./intelligence/auto-reviewer.js";

// ── Phase D — Privacy Router ───────────────────────────
export {
  PrivacyRouter,
  type PrivacyPolicy,
  type PrivacyRouteResult,
  type PIIDetection,
  type PrivacyAuditEntry,
  type PrivacyStats,
} from "./security/privacy-router.js";

// ── Phase DX — Intent Verifier (NemoClaw) ──────────────
export {
  IntentVerifier,
  type IntentContext,
  type PendingAction,
  type VerificationResult,
} from "./security/intent-verifier.js";

// ── Phase DX — Human Approval (HumanLayer) ─────────────
export {
  HumanApprovalManager,
  type ApprovalRequest,
  type ApprovalResponse,
  type ApprovalChannel,
  type ApprovalPolicy,
} from "./security/human-approval.js";

// ── Phase DX — Context Tree Files (ByteRover) ──────────
export {
  ContextTreeManager,
  type ContextEntry,
  type ContextTreeStats,
} from "./memory/context-tree-files.js";

// ── Phase E — Auto-Classifier (Claude Auto Mode) ───────
export {
  AutoClassifier,
  type ClassificationResult,
  type ClassifierConfig,
  type AutoModeState,
} from "./security/auto-classifier.js";

// ── Phase E — Flow Tracker (Windsurf Cascade) ──────────
export {
  FlowTracker,
  type TrackedAction,
  type FlowInsight,
  type FlowState,
  type ActionType,
} from "./intelligence/flow-tracker.js";

// ── Phase D13 — Observability Export (DeerFlow) ─────────
export {
  ObservabilityExporter,
  type TraceEvent,
  type TraceSession,
  type ExportFormat,
  type ExportConfig,
} from "./telemetry/observability-export.js";

// Session-6: orchestration/agent-protocol removed — zero external consumers.
// A fresh ACP (Agent Client Protocol) port per Zed's open-standard spec
// is planned for v0.3 — the stale in-house variant would have blocked it.

// ── Phase DX4 — Data Connectors (Onyx) ─────────────────
export {
  ConnectorRegistry,
  GitHubConnector,
  type Connector,
  type ConnectorConfig,
  type ConnectorType,
  type ConnectorDocument,
  type ConnectorStatus,
} from "./connectors/connector-registry.js";

// ── Phase DX7 — Auto-Archive (Jean) ────────────────────
export {
  AutoArchiveHook,
  type ArchiveResult,
  type AutoArchiveConfig,
} from "./hooks/auto-archive.js";

// S2-9: RDAgent removed — instantiated but never invoked anywhere.

// ── Phase DX20 — Rate Limit Resume ─────────────────────
export {
  RateLimitResumeManager,
  type RateLimitState,
  type ExecutionSnapshot,
  type ResumeResult,
} from "./hooks/rate-limit-resume.js";

// Session-6: orchestration/agent-graph-gen removed — zero external consumers.

// ── Principle 4E — User Model (Hermes Honcho) ──────────
export {
  UserModelManager,
  type UserProfile,
  type Correction,
  type Preference as UserPreference,
  type ExpertiseArea,
  type CommunicationStyle,
} from "./intelligence/user-model.js";

// ── Principle 4A — Dynamic Prompt Modules ──────────────
export {
  assemblePromptModules,
  estimateModuleTokens,
  getModuleNames,
  type PromptModule,
  type ModuleContext,
} from "./prompt/modules/index.js";

// ── E8 — Instruction Provenance Tracing ────────────────
export {
  traceInstructions,
  whichSource,
  findProvenance,
  renderSourceSummary,
  type InstructionSource,
  type TracedPrompt,
  type ProvenanceHit,
} from "./prompt/instruction-provenance.js";

// ── Phase F3 — Unified Knowledge Fabric ────────────────
export {
  UnifiedKnowledgeFabric,
  type KnowledgeQuery,
  type KnowledgeResult,
  type KnowledgeSource,
  type ResultProvenance,
  type Retriever,
} from "./memory/unified-knowledge.js";

// ── Phase F4 — Provider Brain ──────────────────────────
export {
  ProviderBrain,
  type RoutingDecision,
  type AlternativeRoute,
  type TaskClassification,
  type ProviderHealth,
  type BudgetConstraints,
} from "./providers/provider-brain.js";

// ── Phase F9 — Away Summary ────────────────────────────
export { IdleDetector, type AwaySummary } from "./intelligence/away-summary.js";

// ── Phase E3 — Auto-Mode Detector ──────────────────────
export { AutoModeDetector, type ModeDetection } from "./intelligence/auto-mode-detector.js";

// ── Phase E4 — Auto-Enhance ────────────────────────────
export {
  AutoEnhancer,
  type EnhanceResult,
  type AutoEnhanceConfig,
} from "./intelligence/auto-enhance.js";

// ── Phase E6 — Auto-Verify ─────────────────────────────
export {
  AutoVerifier,
  type VerificationStep,
  type VerificationResult as AutoVerifyResult,
  type VerificationReport,
  type AutoVerifyConfig,
} from "./intelligence/auto-verify.js";

// ── Phase F9 — Loop Command ────────────────────────────
export { LoopManager, parseInterval, type LoopConfig, type LoopState } from "./cli/loop-command.js";

// ── Phase F11 — Self-Improvement Engine ────────────────
export {
  SelfImprovementEngine,
  type SelfImprovementSuggestion,
  type SelfImprovementReport,
} from "./cli/self-improve.js";

// ── Phase F5 — Base Channel Adapter ────────────────────
export {
  BaseChannelAdapter,
  type ChannelAdapterConfig,
  type InboundMessage,
  type OutboundMessage,
  type ConnectionState,
  type MessageHandler,
} from "./channels/base-adapter.js";

// ── Phase G5 — Cross-Device Context ────────────────────
export {
  CrossDeviceContextManager,
  type DeviceContext,
  type UnifiedContext,
  type ContextEvent,
} from "./intelligence/cross-device-context.js";
