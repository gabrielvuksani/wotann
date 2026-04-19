/**
 * KAIROS — Always-On Daemon.
 * Tick system with 15-second budget, heartbeat runner, cron service.
 * Daily log as append-only JSONL audit trail.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChannelGateway, type ChannelMessage } from "../channels/gateway.js";
import { UnifiedDispatchPlane } from "../channels/unified-dispatch.js";
import { wrapLegacyAdapter } from "../channels/integration.js";
import { RoutePolicyEngine, createDefaultPolicy } from "../channels/route-policies.js";
import { runWorkspaceDreamIfDue } from "../learning/dream-runner.js";
import { KairosRPCHandler } from "./kairos-rpc.js";
import { KairosIPCServer, writeSessionToken } from "./kairos-ipc.js";
import { WotannRuntime } from "../core/runtime.js";
import { loadConfig } from "../core/config.js";
import { CompanionServer } from "../desktop/companion-server.js";
import { SupabaseRelay } from "../desktop/supabase-relay.js";
import { BackgroundWorkerManager } from "./background-workers.js";
import { PatternCrystallizer } from "../learning/pattern-crystallizer.js";
import { FeedbackCollector } from "../learning/feedback-collector.js";
import { SelfEvolutionEngine } from "../learning/self-evolution.js";
import { TrajectoryExtractor } from "../training/trajectory-extractor.js";
import { SkillMerger } from "../skills/skill-merger.js";
import { DreamPipeline } from "../learning/dream-pipeline.js";
import { EventTriggerSystem, type TriggerResult, type GithubEvent } from "./event-triggers.js";
import { AmbientAwareness } from "../intelligence/ambient-awareness.js";
import { pushNotification, proactiveCheck, proactiveHeartbeatCheck } from "./kairos-tools.js";
import { AutomationEngine } from "./automations.js";
import { BackgroundAgentManager } from "../agents/background-agent.js";
import { SmartFileSearch } from "../intelligence/smart-file-search.js";
import { CostOracle } from "../telemetry/cost-oracle.js";
import { IdleDetector } from "../intelligence/away-summary.js";
import { FlowTracker } from "../intelligence/flow-tracker.js";
import { CrossDeviceContextManager } from "../intelligence/cross-device-context.js";
import {
  analyzeCodebaseHealth,
  type CodebaseHealthReport,
} from "../intelligence/codebase-health.js";
import { PWREngine } from "../orchestration/pwr-cycle.js";
import { runRalphMode, type RalphConfig, type RalphResult } from "../orchestration/ralph-mode.js";
import { GitHubBot } from "../channels/github-bot.js";
import { IDEBridge } from "../channels/ide-bridge.js";
import {
  LivingSpecManager,
  type LivingSpec,
  type Divergence,
} from "../orchestration/living-spec.js";
import { WorkflowDAGEngine } from "../orchestration/workflow-dag.js";
import { ContextPressureMonitor } from "./context-pressure.js";
import { TerminalMonitor } from "./terminal-monitor.js";
import { FileDependencyGraph } from "./file-dep-graph.js";
import { discoverModels } from "../providers/dynamic-discovery.js";
import {
  optimizeSkillPrompt,
  createLlmPromptMutator,
  buildBasicEvaluator,
} from "../skills/skill-optimizer.js";
// S5-3: MCPMarketplace removed — hardcoded 5 entries + fake registry URL
// (`registry.wotann.com` never existed). The real integration is
// MCPRegistry in ../marketplace/registry.ts, which actually imports MCP
// servers from the user's Claude Code / Cursor / Windsurf / Codex configs.
import { MCPRegistry, SkillMarketplace } from "../marketplace/registry.js";
import { DockerSandbox } from "../sandbox/docker-backend.js";
import { TaskIsolationManager } from "../sandbox/task-isolation.js";
import { TerminalManager } from "../sandbox/terminal-backends.js";
import { PluginSandbox } from "../security/plugin-sandbox.js";
import { ReasoningEngine } from "../identity/reasoning-engine.js";
import { UserModel } from "../identity/user-model.js";
import { PerceptionEngine } from "../computer-use/perception-engine.js";
import { MeetingRuntime } from "../meet/meeting-runtime.js";
import { AutoArchiveHook } from "../hooks/auto-archive.js";
import { RateLimitResumeManager } from "../hooks/rate-limit-resume.js";

const execFileAsync = promisify(execFile);

export type DaemonStatus = "stopped" | "starting" | "running" | "stopping";

export interface HeartbeatTask {
  readonly name: string;
  readonly schedule: string;
  readonly enabled: boolean;
  readonly lastRun?: Date;
  readonly nextRun?: Date;
}

export interface CronJob {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly command: string;
  readonly enabled: boolean;
  readonly lastRun?: Date;
  readonly lastResult?: "success" | "failure";
}

export interface DaemonState {
  readonly status: DaemonStatus;
  readonly startedAt?: Date;
  readonly tickCount: number;
  readonly heartbeatTasks: readonly HeartbeatTask[];
  readonly cronJobs: readonly CronJob[];
}

export interface DailyLogEntry {
  readonly timestamp: string;
  readonly type: "tick" | "cron" | "heartbeat" | "error" | "start" | "stop";
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export interface ChannelGatewayStartOptions {
  // Core messaging channels
  readonly webchat?: boolean;
  readonly telegram?: boolean;
  readonly slack?: boolean;
  readonly discord?: boolean;
  // Extended channels (new)
  readonly signal?: boolean;
  readonly whatsapp?: boolean;
  readonly email?: boolean;
  readonly webhook?: boolean;
  readonly sms?: boolean;
  readonly matrix?: boolean;
  readonly teams?: boolean;
  // Configuration
  readonly webchatPort?: number;
  readonly webchatHost?: string;
  readonly webhookPort?: number;
  readonly requirePairing?: boolean;
}

export type HeartbeatScheduleKind = "on-wake" | "periodic" | "nightly";

// ── Cron Schedule Matching ──────────────────────────────────
// Implementation now lives in ./cron-utils.ts to break a fragile circular
// value import between this file and ./event-triggers.ts (S0-14).
// The re-export keeps back-compat for existing callers/tests that import
// `matchesCronSchedule` from "./kairos".

import { matchesCronSchedule, matchCronField } from "./cron-utils.js";
export { matchesCronSchedule, matchCronField };

// ── Daemon Implementation ───────────────────────────────────

export class KairosDaemon {
  private state: DaemonState;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly logDir: string;
  private readonly workingDir: string;
  private gateway: ChannelGateway | null = null;
  private dispatchPlane: UnifiedDispatchPlane | null = null;

  // Phase-C wire-up: per-channel auth/rate/escalation policy engine.
  // Lives on the daemon (not inside the gateway) so the same instance
  // can also back RPC handlers that list/mutate policies at runtime.
  private routePolicyEngine: RoutePolicyEngine | null = null;

  // Phase A: Runtime hosting
  private runtime: WotannRuntime | null = null;
  private rpcHandler: KairosRPCHandler | null = null;
  private ipcServer: KairosIPCServer | null = null;
  private companionServer: CompanionServer | null = null;

  // Self-improvement subsystems (wired at start, accessible from all surfaces via RPC)
  private readonly backgroundWorkers = new BackgroundWorkerManager();
  private readonly patternCrystallizer = new PatternCrystallizer();
  private readonly feedbackCollector = new FeedbackCollector();
  private readonly selfEvolution = new SelfEvolutionEngine();
  private readonly trajectoryExtractor = new TrajectoryExtractor();
  private supabaseRelay: SupabaseRelay | null = null;
  private skillMerger: SkillMerger | null = null;

  // Track C additions: dream pipeline, event triggers, ambient awareness
  private dreamPipeline: DreamPipeline | null = null;
  private readonly eventTriggerSystem = new EventTriggerSystem();
  private readonly ambientAwareness = new AmbientAwareness();
  private readonly backgroundAgents = new BackgroundAgentManager();
  private readonly automationEngine = new AutomationEngine();
  private fileSearch: SmartFileSearch | null = null;
  private readonly costOracle = new CostOracle();
  private readonly idleDetector = new IdleDetector();
  private readonly flowTracker = new FlowTracker();
  private readonly crossDeviceContext = new CrossDeviceContextManager();
  private lastHealthCheckDate: string | null = null;
  private lastHealthReport: CodebaseHealthReport | null = null;
  private ambientTickCounter = 0;
  private heartbeatTickCounter = 0;
  private lastDreamDate: string | null = null;
  private lastSkillOptDate: string | null = null;

  // PWR cycle: discuss→plan→implement→review→uat→ship phase transitions
  private readonly pwrEngine = new PWREngine();

  // GitHub Bot: webhook-based @wotann mention handler
  private githubBot: GitHubBot | null = null;

  // IDE Bridge: JSON-RPC server for VS Code/Cursor integration
  private ideBridge: IDEBridge | null = null;

  // Knowledge connectors: external data source registry for RAG
  private connectorRegistry:
    | import("../connectors/connector-registry.js").ConnectorRegistry
    | null = null;

  // Living Spec: tracks divergence between SPEC.md and codebase
  private readonly livingSpecManager = new LivingSpecManager();
  private livingSpec: LivingSpec | null = null;
  private specTickCounter = 0;

  // Workflow DAG Engine: YAML-based workflow execution
  private readonly workflowEngine = new WorkflowDAGEngine();

  // ── Marketplace + Sandbox + Identity (previously unwired) ──────────
  // S5-3: mcpMarketplace field removed (vaporware). Use mcpRegistry instead.
  private readonly mcpRegistry = new MCPRegistry();
  private readonly skillMarketplace = new SkillMarketplace();
  private readonly dockerSandbox = new DockerSandbox();
  private taskIsolation: TaskIsolationManager | null = null;
  private readonly terminalManager = new TerminalManager();
  private readonly pluginSandbox = new PluginSandbox();
  private reasoningEngine: ReasoningEngine | null = null;
  private userModel: UserModel | null = null;
  private readonly perceptionEngine = new PerceptionEngine();

  // Phase C: Meeting runtime composes meeting-pipeline + meeting-store +
  // coaching-engine. Owns the SQLite connection for transcripts; exposed
  // through getMeetingStore() so kairos-rpc `meet.summarize` can resolve
  // transcripts by id instead of silently returning null (4-session bug).
  private meetingRuntime: MeetingRuntime | null = null;

  // Session-13: Auto-archive (Jean-inspired) + Rate-limit-resume
  // (oh-my-claudecode-inspired) service handles. The daemon owns these
  // so PR-merge events (via github-bot) and rate-limit hits (via router)
  // can route into one honest state store instead of being swallowed.
  private readonly autoArchiveHook = new AutoArchiveHook({
    archiveDir: join(homedir(), ".wotann", "archives"),
  });
  private readonly rateLimitResume = new RateLimitResumeManager();

  // ── Tier 2A: Gap Analysis Modules ──────────────
  private readonly contextPressure = new ContextPressureMonitor();
  private readonly terminalMonitor = new TerminalMonitor();
  private readonly fileDependencyGraph = new FileDependencyGraph();
  private fileWatcher: import("node:fs").FSWatcher | null = null;
  private contextPressureTickCounter = 0;
  private modelRefreshTickCounter = 0;

  // Phase B Bug #1 fix: run the auto_capture -> memory_entries
  // consolidation pipeline on a cadence so structured memory_entries exist
  // even when no user queries land. Without this, a daemon that does
  // lifecycle-only work (session_start / session_end) produces 1990+
  // auto_capture rows and 0 memory_entries.
  private consolidationTickCounter = 0;

  // Phase B Bug #2 fix: track shutdown handlers so we install them at most
  // once per daemon instance (tests that spin up multiple daemons would
  // otherwise leak SIGINT/SIGTERM/exit listeners across the process).
  private shutdownHandlersInstalled = false;
  private shutdownHandlers: {
    readonly sigintHandler: () => void;
    readonly sigtermHandler: () => void;
    readonly exitHandler: () => void;
  } | null = null;

  constructor(logDir?: string, workingDir?: string) {
    this.workingDir = workingDir ?? process.cwd();
    this.logDir = logDir ?? join(this.workingDir, ".wotann", "logs");
    this.state = {
      status: "stopped",
      tickCount: 0,
      heartbeatTasks: [],
      cronJobs: [],
    };
  }

  /**
   * Start the daemon with full runtime hosting.
   * Initializes: WotannRuntime → RPC handler → IPC server → CompanionServer.
   * After this, CLI/Desktop/iOS can connect and send real queries.
   */
  start(tickIntervalMs: number = 15_000): void {
    if (this.state.status === "running") return;

    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    this.state = {
      ...this.state,
      status: "starting",
      startedAt: new Date(),
    };

    // Phase B Bug #2 fix: sweep orphan .tmp.* + stranded WAL/SHM from the
    // last crashed run BEFORE opening any new SQLite connections. Running
    // the sweep pre-runtime means the fresh SQLite instance doesn't get
    // confused by leftover WAL files pointing at a different journal.
    const sweepResult = this.sweepOrphanFiles();
    if (sweepResult.tmpRemoved + sweepResult.walRemoved + sweepResult.shmRemoved > 0) {
      this.appendLog({
        type: "start",
        message: `Orphan file sweep: ${sweepResult.tmpRemoved} tmp, ${sweepResult.walRemoved} wal, ${sweepResult.shmRemoved} shm removed`,
        data: { ...sweepResult },
      });
    }

    // Phase B Bug #2 fix (cont'd): install signal + exit handlers so the
    // daemon flushes + cleans up even on SIGINT/SIGTERM. Previously a
    // Ctrl-C mid-write left a stranded .tmp.*; now stop() runs in the
    // handler before the process exits.
    this.installShutdownHandlers();

    // Phase A1: Initialize WotannRuntime with discovered providers
    try {
      const config = loadConfig(this.workingDir);
      this.runtime = new WotannRuntime({ ...config, workingDir: this.workingDir });

      // Phase A2: Create RPC handler wired to daemon and runtime
      this.rpcHandler = new KairosRPCHandler();
      this.rpcHandler.setDaemon(this);
      this.rpcHandler.setRuntime(this.runtime);

      // Wire WorkflowDAGEngine to route agent calls through runtime.query()
      const runtimeRef = this.runtime;
      this.workflowEngine.setAgentExecutor(async (prompt: string, context: string) => {
        const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;
        let output = "";
        for await (const chunk of runtimeRef.query({ prompt: fullPrompt })) {
          if (chunk.type === "text") output += chunk.content;
        }
        return output;
      });

      // Phase A3: Start IPC server on Unix Domain Socket
      const wotannDir = join(homedir(), ".wotann");
      if (!existsSync(wotannDir)) {
        mkdirSync(wotannDir, { recursive: true });
      }

      // SECURITY (B1): mint a fresh session token at daemon startup and
      // persist it to ~/.wotann/session-token.json with mode 0600. The CLI,
      // Desktop shell, and iOS (via the auth.handshake RPC after ECDH pair)
      // read this token and include it on every subsequent request.
      writeSessionToken(join(wotannDir, "session-token.json"));

      this.ipcServer = new KairosIPCServer(this.rpcHandler, {
        socketPath: join(wotannDir, "kairos.sock"),
        maxConnections: 10,
        keepAliveMs: 60_000,
      });
      this.ipcServer.start();

      // Phase A5: Start CompanionServer for iOS connections
      this.companionServer = new CompanionServer({ port: 3849 });
      this.companionServer.setRuntime(this.runtime);
      this.companionServer.setBridgeRPCHandler(this.rpcHandler);
      this.companionServer.start();

      // Phase A6: Start Supabase Relay for remote iOS access
      this.supabaseRelay = new SupabaseRelay();
      if (this.supabaseRelay.loadConfig()) {
        void this.supabaseRelay.connect().catch(() => {
          this.appendLog({ type: "error", message: "Supabase relay connection failed" });
        });
      }

      // Phase A6b: Initialize Background Agents (Codex-style task execution)
      this.backgroundAgents.loadPersistedTasks();
      this.backgroundAgents.onStatusChange((status) => {
        this.appendLog({
          type: "heartbeat",
          message: `Agent ${status.id}: ${status.status} (${status.progress}%)`,
        });
      });

      // Phase A6c: Initialize Automations Engine (event-driven agents)
      this.automationEngine.loadConfig();
      this.automationEngine.start();

      // Phase A6d: Initialize Smart File Search (frecency-based)
      this.fileSearch = new SmartFileSearch(this.workingDir);

      // Phase A6e: Build file dependency graph for workspace
      void this.fileDependencyGraph
        .buildFromDirectory(this.workingDir)
        .then(() => {
          this.appendLog({ type: "heartbeat", message: "File dependency graph built" });
        })
        .catch(() => {
          this.appendLog({ type: "error", message: "File dependency graph build failed" });
        });

      // Phase A6f: File watcher DISABLED — fs.watch with recursive:true blocks
      // daemon startup for 2-3 minutes on large workspaces. File change detection
      // is handled by the FileDependencyGraph rebuild on heartbeat instead.
      // TODO: Re-enable with chokidar (non-blocking) or targeted directory watching.
      this.appendLog({
        type: "heartbeat",
        message: "File watcher disabled (use heartbeat-based detection)",
      });

      // Phase A7: Initialize previously-unwired subsystems
      // Marketplace: MCP plugin discovery + skill marketplace
      this.appendLog({ type: "heartbeat", message: "MCP Marketplace initialized" });

      // Sandbox: Task isolation for parallel agent execution
      this.taskIsolation = new TaskIsolationManager(
        this.workingDir,
        join(homedir(), ".wotann", "isolation"),
      );

      // Identity: User model for preference learning + reasoning engine for thought process
      this.userModel = new UserModel(join(homedir(), ".wotann"));
      this.reasoningEngine = new ReasoningEngine();

      // Phase C: Meeting runtime — owns MeetingStore (SQLite at
      // ~/.wotann/meetings.db by default). Coaching is left disabled
      // here (no llmQuery) so transcripts are captured + persisted
      // without spinning the coaching timer on every daemon. Callers
      // that want coaching construct their own runtime with an
      // llmQuery wired to WotannRuntime.query().
      try {
        this.meetingRuntime = new MeetingRuntime({
          dbPath: join(wotannDir, "meetings.db"),
        });
        this.appendLog({
          type: "heartbeat",
          message: "Phase C: MeetingRuntime initialized (transcripts persisted, coaching off)",
        });
      } catch (err) {
        this.appendLog({
          type: "error",
          message: `MeetingRuntime init failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      this.appendLog({
        type: "heartbeat",
        message: "Phase A7 complete: marketplace, sandbox, identity wired",
      });

      // Phase A8: Auto-start channel gateway if any channel credentials are configured.
      // Check for common channel env vars (Slack, Telegram, Discord, etc.)
      const hasChannelCreds = [
        "SLACK_BOT_TOKEN",
        "TELEGRAM_BOT_TOKEN",
        "DISCORD_BOT_TOKEN",
        "WOTANN_WEBCHAT_PORT",
        "GITHUB_WEBHOOK_SECRET",
      ].some((key) => !!process.env[key]);

      if (hasChannelCreds && this.runtime) {
        const rt = this.runtime;
        this.startChannelGateway(async (msg) => {
          let response = "";
          for await (const chunk of rt.query({ prompt: msg.content })) {
            if (chunk.type === "text") response += chunk.content;
          }
          return response;
        })
          .then(() => {
            this.appendLog({
              type: "heartbeat",
              message: "Channel gateway auto-started (credentials detected)",
            });
          })
          .catch((err) => {
            this.appendLog({ type: "error", message: `Channel gateway auto-start failed: ${err}` });
          });
      }

      // Phase A7: Wire background workers to runtime and register heartbeat tasks
      if (this.runtime) {
        this.backgroundWorkers.setRuntime(this.runtime);
      }
      const workerTasks = this.backgroundWorkers.toHeartbeatTasks();
      for (const task of workerTasks) {
        this.state = {
          ...this.state,
          heartbeatTasks: [...this.state.heartbeatTasks, task],
        };
      }

      // Phase A8: Run nightly pattern pruning
      this.patternCrystallizer.prune();

      // Phase A9: Wire DreamPipeline to MemoryStore (deferred — async init)
      void this.initDreamPipeline(wotannDir).catch(() => {
        this.appendLog({ type: "error", message: "DreamPipeline initialization failed" });
      });

      // Phase A9b: Load Living Spec if .wotann/SPEC.md exists
      const specPath = join(this.workingDir, ".wotann", "SPEC.md");
      if (existsSync(specPath)) {
        try {
          this.livingSpec = this.livingSpecManager.loadSpec(specPath);
          this.appendLog({
            type: "start",
            message: `Living Spec loaded: "${this.livingSpec.title}" v${this.livingSpec.version} (${this.livingSpec.items.length} items)`,
          });
        } catch (err) {
          this.appendLog({
            type: "error",
            message: `Living Spec load failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // Phase A10: Load event triggers from config
      const triggersPath = join(wotannDir, "triggers.yaml");
      void this.eventTriggerSystem.loadConfig(triggersPath).then((count) => {
        if (count > 0) {
          this.eventTriggerSystem.registerFilesystemTriggers(this.workingDir);
          this.appendLog({
            type: "start",
            message: `Event triggers loaded: ${count} triggers registered`,
          });
        }
      });

      // Phase A11: Wire event trigger result listener to daemon log
      this.eventTriggerSystem.onResult((result: TriggerResult) => {
        this.appendLog({
          type: "heartbeat",
          message: `Trigger "${result.triggerName}" ${result.success ? "succeeded" : "failed"}: ${result.message.slice(0, 200)}`,
          data: { source: result.source, durationMs: result.durationMs },
        });
      });

      // Phase A-CONN: Initialize knowledge connector registry (async — deferred)
      void import("../connectors/connector-registry.js")
        .then(({ ConnectorRegistry }) => {
          this.connectorRegistry = new ConnectorRegistry();
          this.appendLog({
            type: "heartbeat",
            message: `Knowledge connectors: registry initialized (${this.connectorRegistry.list().length} registered)`,
          });
        })
        .catch((err) => {
          this.appendLog({
            type: "error",
            message: `Knowledge connectors failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        });

      this.appendLog({
        type: "start",
        message:
          "KAIROS daemon started with full runtime hosting + self-improvement subsystems + Track C",
        data: {
          ipcSocket: join(wotannDir, "kairos.sock"),
          companionPort: 3849,
        },
      });
    } catch (err) {
      // Runtime initialization failed — daemon still runs for cron/heartbeat
      this.appendLog({
        type: "error",
        message: `Runtime initialization failed: ${err instanceof Error ? err.message : String(err)}. Running in daemon-only mode.`,
      });
    }

    this.state = {
      ...this.state,
      status: "running",
    };

    this.runHeartbeatTasks(new Date(), ["on-wake"]);

    this.tickInterval = setInterval(() => {
      this.tick();
    }, tickIntervalMs);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // Disconnect unified dispatch plane channels on shutdown
    if (this.dispatchPlane) {
      void this.dispatchPlane.disconnectAll().catch(() => {});
      this.dispatchPlane = null;
    }

    // Track C: Shut down event triggers and clear ambient signals
    this.eventTriggerSystem.shutdown();
    this.ambientAwareness.clear();

    // Shut down channel servers (GitHub Bot + IDE Bridge)
    if (this.githubBot) {
      this.githubBot.stop();
      this.githubBot = null;
    }
    if (this.ideBridge) {
      this.ideBridge.stop();
      this.ideBridge = null;
    }

    // Phase A6f: Clean up file watcher
    this.fileWatcher?.close();
    this.fileWatcher = null;

    // Phase A: Clean up runtime hosting
    if (this.ipcServer) {
      this.ipcServer.stop();
      this.ipcServer = null;
    }
    if (this.companionServer) {
      this.companionServer.stop();
      this.companionServer = null;
    }
    if (this.runtime) {
      this.runtime.close();
      this.runtime = null;
    }
    // Phase C: close the meeting SQLite connection + clear coaching timer
    if (this.meetingRuntime) {
      this.meetingRuntime.close();
      this.meetingRuntime = null;
    }
    this.rpcHandler = null;

    this.appendLog({ type: "stop", message: "KAIROS daemon stopped" });
    this.state = { ...this.state, status: "stopped" };
  }

  /**
   * Get the hosted WotannRuntime instance.
   * Returns null if runtime initialization failed.
   */
  getRuntime(): WotannRuntime | null {
    return this.runtime;
  }

  /**
   * Get the IPC server for external monitoring.
   */
  getIPCServer(): KairosIPCServer | null {
    return this.ipcServer;
  }

  /**
   * Get the CompanionServer for iOS connections.
   */
  getCompanionServer(): CompanionServer | null {
    return this.companionServer;
  }

  getStatus(): DaemonState {
    return this.state;
  }

  // ── Self-Improvement Subsystem Getters ──────────────
  // Accessible from all surfaces via KAIROS RPC

  getPatternCrystallizer(): PatternCrystallizer {
    return this.patternCrystallizer;
  }

  getFeedbackCollector(): FeedbackCollector {
    return this.feedbackCollector;
  }

  getSelfEvolution(): SelfEvolutionEngine {
    return this.selfEvolution;
  }

  getTrajectoryExtractor(): TrajectoryExtractor {
    return this.trajectoryExtractor;
  }

  getBackgroundWorkers(): BackgroundWorkerManager {
    return this.backgroundWorkers;
  }

  getWorkflowEngine(): WorkflowDAGEngine {
    return this.workflowEngine;
  }

  getSupabaseRelay(): SupabaseRelay | null {
    return this.supabaseRelay;
  }

  getBackgroundAgents(): BackgroundAgentManager {
    return this.backgroundAgents;
  }

  getAutomationEngine(): AutomationEngine {
    return this.automationEngine;
  }

  getFileSearch(): SmartFileSearch | null {
    return this.fileSearch;
  }

  getCostOracle(): CostOracle {
    return this.costOracle;
  }

  getSkillMerger(): SkillMerger | null {
    return this.skillMerger;
  }

  getDreamPipeline(): DreamPipeline | null {
    return this.dreamPipeline;
  }

  // ── Phase A7 Getters (marketplace, sandbox, identity, perception) ──
  // S5-3: getMCPMarketplace removed — callers should use getMCPRegistry.
  getMCPRegistry(): MCPRegistry {
    return this.mcpRegistry;
  }
  getSkillMarketplace(): SkillMarketplace {
    return this.skillMarketplace;
  }
  getDockerSandbox(): DockerSandbox {
    return this.dockerSandbox;
  }
  getTaskIsolation(): TaskIsolationManager | null {
    return this.taskIsolation;
  }
  getTerminalManager(): TerminalManager {
    return this.terminalManager;
  }
  getPluginSandbox(): PluginSandbox {
    return this.pluginSandbox;
  }
  getReasoningEngine(): ReasoningEngine | null {
    return this.reasoningEngine;
  }
  getUserModel(): UserModel | null {
    return this.userModel;
  }
  getPerceptionEngine(): PerceptionEngine {
    return this.perceptionEngine;
  }

  /**
   * Get the MeetingRuntime adapter for RPC callers.
   *
   * Returns `null` (not a silent stub) when the runtime hasn't been
   * initialized yet — callers must check and degrade gracefully. This is
   * the channel the `getMeetingStore?` ext() callback in kairos-rpc.ts
   * reads, making `meet.summarize` actually resolve transcripts from
   * SQLite instead of returning undefined.
   */
  getMeetingStore(): MeetingRuntime | null {
    return this.meetingRuntime;
  }

  getEventTriggerSystem(): EventTriggerSystem {
    return this.eventTriggerSystem;
  }

  getAmbientAwareness(): AmbientAwareness {
    return this.ambientAwareness;
  }

  /**
   * Get the PWR engine for phase cycle management.
   */
  getPWREngine(): PWREngine {
    return this.pwrEngine;
  }

  /**
   * Get the GitHub Bot adapter (null if not started).
   */
  getGitHubBot(): GitHubBot | null {
    return this.githubBot;
  }

  /**
   * Get the IDE Bridge adapter (null if not started).
   */
  getIDEBridge(): IDEBridge | null {
    return this.ideBridge;
  }

  /**
   * Run Ralph mode: persistent verify-fix loop until all tests pass.
   * Exposed for CLI `wotann ralph` command.
   */
  async runRalph(
    config: RalphConfig,
    verifier: () => Promise<{ success: boolean; output: string }>,
    fixer: (error: string) => Promise<string>,
  ): Promise<RalphResult> {
    this.appendLog({ type: "heartbeat", message: `Ralph mode started: ${config.description}` });
    const result = await runRalphMode(config, verifier, fixer);
    this.appendLog({
      type: "heartbeat",
      message: `Ralph mode ${result.success ? "succeeded" : "failed"} after ${result.cycles} cycles (${result.hud.totalDurationMs}ms)`,
    });
    return result;
  }

  /**
   * Forward a GitHub event to the event trigger system.
   * Called by the webhook channel adapter when a GitHub event arrives.
   */
  handleGithubEvent(event: GithubEvent): void {
    this.eventTriggerSystem.handleGithubEvent(event);
    // Session-13: PR-merge events → AutoArchiveHook for session archive +
    // branch cleanup. Honest: we only trigger on pull_request.closed
    // events whose payload declares merged=true. Missing payload fields
    // leave the archive unrun rather than silently succeeding.
    if (event.type === "pull_request.closed") {
      const payload = event.payload as Record<string, unknown> | undefined;
      const prNumber =
        typeof payload?.["number"] === "number" ? (payload["number"] as number) : undefined;
      const merged = payload?.["merged"] === true;
      if (merged && prNumber !== undefined) {
        const branchName =
          typeof payload["branch"] === "string" ? (payload["branch"] as string) : `pr-${prNumber}`;
        void this.autoArchiveHook
          .onPRMerge(prNumber, branchName)
          .then((result) => {
            this.appendLog({
              type: "heartbeat",
              message: `Auto-archive PR #${prNumber}: session=${result.sessionArchived} worktree=${result.worktreeRemoved}`,
            });
          })
          .catch((err) => {
            this.appendLog({
              type: "error",
              message: `Auto-archive PR #${prNumber} failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          });
      }
    }
  }

  /**
   * Session-13: record a rate-limit hit into RateLimitResumeManager so
   * the manager can plan a fallback provider or exponential backoff.
   * Invoked by the router / adapter error path when a 429 lands.
   */
  recordRateLimit(
    provider: string,
    retryAfterMs: number,
    snapshot: Parameters<RateLimitResumeManager["onRateLimit"]>[2],
  ): void {
    try {
      const state = this.rateLimitResume.onRateLimit(provider, retryAfterMs, snapshot);
      this.appendLog({
        type: "heartbeat",
        message: `Rate-limit: ${provider} retry#${state.retryCount} in ${retryAfterMs}ms`,
      });
    } catch (err) {
      this.appendLog({
        type: "error",
        message: `Rate-limit record failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  getRateLimitResumeManager(): RateLimitResumeManager {
    return this.rateLimitResume;
  }

  getAutoArchiveHook(): AutoArchiveHook {
    return this.autoArchiveHook;
  }

  /**
   * Start the channel gateway for multi-channel messaging.
   * Channels connect to the gateway, which routes messages to the agent.
   * Returns the gateway instance for external control.
   */
  async startChannelGateway(
    messageHandler: (
      message: Pick<ChannelMessage, "content" | "channelType" | "senderId" | "senderName">,
    ) => Promise<string>,
    options: ChannelGatewayStartOptions = {},
  ): Promise<ChannelGateway> {
    this.gateway = new ChannelGateway({ requirePairing: options.requirePairing ?? true });
    this.gateway.setMessageHandler(async (msg) => {
      // PWR cycle: auto-detect phase transitions from inbound messages
      const pwrResult = this.pwrEngine.processMessage(msg.content);
      if (pwrResult.transitioned) {
        this.appendLog({
          type: "heartbeat",
          message: `PWR phase transition: ${pwrResult.direction} → ${pwrResult.newPhase}`,
        });
      }
      return messageHandler(msg);
    });

    const selections = resolveChannelSelections(options);

    if (selections.webchat) {
      try {
        const { WebChatAdapter } = await import("../channels/webchat.js");
        this.gateway.registerAdapter(
          new WebChatAdapter({
            port: options.webchatPort ?? 3847,
            host: options.webchatHost ?? "127.0.0.1",
          }),
        );
      } catch {
        /* webchat not available */
      }
    }

    if (selections.telegram) {
      try {
        const { TelegramAdapter } = await import("../channels/telegram.js");
        this.gateway.registerAdapter(wrapLegacyAdapter(new TelegramAdapter()));
      } catch {
        /* telegram not available */
      }
    }

    if (selections.slack) {
      try {
        const { SlackAdapter } = await import("../channels/slack.js");
        this.gateway.registerAdapter(wrapLegacyAdapter(new SlackAdapter()));
      } catch {
        /* slack not available */
      }
    }

    if (selections.discord) {
      try {
        const { DiscordAdapter } = await import("../channels/discord.js");
        this.gateway.registerAdapter(wrapLegacyAdapter(new DiscordAdapter()));
      } catch {
        /* discord not available */
      }
    }

    // Extended channels — gateway-native adapters (import from gateway.js)
    if (selections.signal) {
      try {
        const { SignalAdapter } = await import("../channels/signal.js");
        this.gateway.registerAdapter(new SignalAdapter());
      } catch {
        /* signal-cli not available */
      }
    }

    if (selections.whatsapp) {
      try {
        const { WhatsAppAdapter } = await import("../channels/whatsapp.js");
        const { wrapLegacyAdapter } = await import("../channels/integration.js");
        this.gateway.registerAdapter(wrapLegacyAdapter(new WhatsAppAdapter()));
      } catch {
        /* baileys not available */
      }
    }

    if (selections.email) {
      try {
        const { EmailAdapter } = await import("../channels/email.js");
        this.gateway.registerAdapter(new EmailAdapter());
      } catch {
        /* email config not available */
      }
    }

    if (selections.webhook) {
      try {
        const { WebhookAdapter } = await import("../channels/webhook.js");
        this.gateway.registerAdapter(new WebhookAdapter());
      } catch {
        /* webhook not configured */
      }
    }

    // Extended channels — legacy adapters (import from adapter.js, need wrapping)
    if (selections.sms) {
      try {
        const { SMSAdapter } = await import("../channels/sms.js");
        this.gateway.registerAdapter(wrapLegacyAdapter(new SMSAdapter()));
      } catch {
        /* twilio not configured */
      }
    }

    if (selections.matrix) {
      try {
        const { MatrixAdapter } = await import("../channels/matrix.js");
        this.gateway.registerAdapter(wrapLegacyAdapter(new MatrixAdapter()));
      } catch {
        /* matrix not configured */
      }
    }

    if (selections.teams) {
      try {
        const { TeamsAdapter } = await import("../channels/teams.js");
        this.gateway.registerAdapter(wrapLegacyAdapter(new TeamsAdapter()));
      } catch {
        /* teams not configured */
      }
    }

    // iMessage adapter (macOS only — uses AppleScript + chat.db)
    try {
      const { IMessageGatewayAdapter } = await import("../channels/imessage-gateway-adapter.js");
      const imsgAdapter = new IMessageGatewayAdapter();
      if (imsgAdapter.connected || process.platform === "darwin") {
        this.gateway.registerAdapter(imsgAdapter);
        this.appendLog({ type: "heartbeat", message: "Channel: iMessage adapter registered" });
      }
    } catch {
      /* imessage not available — non-macOS or chat.db inaccessible */
    }

    // IRC adapter (E9): opt-in via IRC_SERVER + IRC_NICK env vars.
    // IRCAdapter implements gateway.ChannelAdapter directly — no wrap needed.
    if (process.env["IRC_SERVER"] && process.env["IRC_NICK"]) {
      try {
        const { IRCAdapter } = await import("../channels/irc.js");
        const ircAdapter = new IRCAdapter({
          server: process.env["IRC_SERVER"]!,
          port: parseInt(process.env["IRC_PORT"] ?? "6697", 10),
          nick: process.env["IRC_NICK"]!,
          user: process.env["IRC_USER"] ?? process.env["IRC_NICK"]!,
          realname: process.env["IRC_REALNAME"] ?? "WOTANN",
          channels: (process.env["IRC_CHANNELS"] ?? "").split(",").filter((c) => c.length > 0),
          useTLS: process.env["IRC_TLS"] !== "false",
        });
        this.gateway.registerAdapter(ircAdapter);
        this.appendLog({ type: "heartbeat", message: "Channel: IRC adapter registered" });
      } catch (err) {
        this.appendLog({
          type: "heartbeat",
          message: `Channel: IRC registration failed — ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Google Chat adapter (E9): opt-in via GOOGLE_CHAT_WEBHOOK env var.
    // GoogleChatAdapter implements gateway.ChannelAdapter directly — no wrap needed.
    if (process.env["GOOGLE_CHAT_WEBHOOK"] || process.env["GOOGLE_CHAT_SERVICE_ACCOUNT"]) {
      try {
        const { GoogleChatAdapter } = await import("../channels/google-chat.js");
        const gchat = new GoogleChatAdapter({
          webhookUrl: process.env["GOOGLE_CHAT_WEBHOOK"],
          serviceAccountKey: process.env["GOOGLE_CHAT_SERVICE_ACCOUNT"],
          spaceName: process.env["GOOGLE_CHAT_SPACE"],
        });
        this.gateway.registerAdapter(gchat);
        this.appendLog({ type: "heartbeat", message: "Channel: Google Chat adapter registered" });
      } catch (err) {
        this.appendLog({
          type: "heartbeat",
          message: `Channel: Google Chat registration failed — ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // GitHub Bot: start webhook server for @wotann mentions in issues/PRs
    if (process.env["GITHUB_WEBHOOK_SECRET"] || options.webhook) {
      try {
        this.githubBot = new GitHubBot({
          webhookSecret: process.env["GITHUB_WEBHOOK_SECRET"],
          port: 7743,
        });
        this.githubBot.onMention((event) => {
          this.handleGithubEvent({
            type: `${event.type}.${event.action}`,
            repo: event.repo,
            sender: event.author,
            payload: { body: event.body, number: event.number, url: event.url },
            receivedAt: event.timestamp,
          });
        });
        void this.githubBot.start().catch(() => {
          this.appendLog({ type: "error", message: "GitHub Bot webhook server failed to start" });
        });
      } catch {
        /* github bot not available */
      }
    }

    // IDE Bridge: start JSON-RPC server for VS Code/Cursor integration
    try {
      this.ideBridge = new IDEBridge({ port: 7742 });
      void this.ideBridge.start().catch(() => {
        this.appendLog({ type: "error", message: "IDE Bridge server failed to start" });
      });
    } catch {
      /* ide bridge not available */
    }

    // Phase-C wire-up: now that every adapter is registered on the
    // gateway, stand up the route-policy engine with a default policy
    // for each channel. This activates the 412-LOC policy module
    // (auth/pairing/rate-limit/escalation/response-formatting) that
    // was previously unreachable from the gateway code path.
    //
    // TODO(channels.setPolicy RPC): the richer RoutePolicy type here
    // differs from kairos-rpc.ts's DispatchRoutePolicy (which only
    // covers provider/model routing). Once the RPC surface is
    // unified, expose `channels.setPolicy(channel, policy)` via
    // kairos-rpc.ts to let CLI/Desktop mutate these policies at
    // runtime — matching the existing channels.policy.{list,add,remove}
    // pattern but targeting this engine instead of the dispatch plane's.
    this.routePolicyEngine = new RoutePolicyEngine();
    for (const channel of this.gateway.getRegisteredChannels()) {
      this.routePolicyEngine.registerChannel(channel, createDefaultPolicy(channel));
    }
    this.gateway.setRoutePolicyEngine(this.routePolicyEngine);
    this.appendLog({
      type: "heartbeat",
      message: `Route policy engine wired: ${this.gateway.getRegisteredChannels().length} channels with default policies`,
    });

    await this.gateway.connectAll();
    this.appendLog({
      type: "start",
      message: `Channel gateway started with ${this.gateway.getAdapterCount()} adapters`,
    });
    return this.gateway;
  }

  getGateway(): ChannelGateway | null {
    return this.gateway;
  }

  /**
   * Get the route-policy engine backing the channel gateway (null until
   * startChannelGateway has run). Exposed for RPC handlers and tests.
   */
  getRoutePolicyEngine(): RoutePolicyEngine | null {
    return this.routePolicyEngine;
  }

  /**
   * Start the unified dispatch plane for task-based channel routing.
   * The dispatch plane supersedes the legacy gateway with a task inbox,
   * cross-channel routing, health dashboard, and policy management.
   */
  async startDispatchPlane(
    messageHandler: (
      message: Pick<ChannelMessage, "content" | "channelType" | "senderId" | "senderName">,
    ) => Promise<string>,
    options: ChannelGatewayStartOptions = {},
  ): Promise<UnifiedDispatchPlane> {
    this.dispatchPlane = new UnifiedDispatchPlane({
      requirePairing: options.requirePairing ?? true,
    });
    this.dispatchPlane.setMessageHandler(async (msg) => messageHandler(msg));

    const selections = resolveChannelSelections(options);

    if (selections.webchat) {
      try {
        const { WebChatAdapter } = await import("../channels/webchat.js");
        this.dispatchPlane.registerAdapter(
          new WebChatAdapter({
            port: options.webchatPort ?? 3847,
            host: options.webchatHost ?? "127.0.0.1",
          }),
        );
      } catch {
        /* webchat not available */
      }
    }

    if (selections.telegram) {
      try {
        const { TelegramAdapter } = await import("../channels/telegram.js");
        this.dispatchPlane.registerAdapter(wrapLegacyAdapter(new TelegramAdapter()));
      } catch {
        /* telegram not available */
      }
    }

    if (selections.slack) {
      try {
        const { SlackAdapter } = await import("../channels/slack.js");
        this.dispatchPlane.registerAdapter(wrapLegacyAdapter(new SlackAdapter()));
      } catch {
        /* slack not available */
      }
    }

    if (selections.discord) {
      try {
        const { DiscordAdapter } = await import("../channels/discord.js");
        this.dispatchPlane.registerAdapter(wrapLegacyAdapter(new DiscordAdapter()));
      } catch {
        /* discord not available */
      }
    }

    // Extended channels — gateway-native adapters
    if (selections.signal) {
      try {
        const { SignalAdapter } = await import("../channels/signal.js");
        this.dispatchPlane.registerAdapter(new SignalAdapter());
      } catch {
        /* signal not available */
      }
    }

    if (selections.whatsapp) {
      try {
        const { WhatsAppAdapter } = await import("../channels/whatsapp.js");
        const { wrapLegacyAdapter } = await import("../channels/integration.js");
        this.dispatchPlane.registerAdapter(wrapLegacyAdapter(new WhatsAppAdapter()));
      } catch {
        /* whatsapp not available */
      }
    }

    if (selections.email) {
      try {
        const { EmailAdapter } = await import("../channels/email.js");
        this.dispatchPlane.registerAdapter(new EmailAdapter());
      } catch {
        /* email not available */
      }
    }

    if (selections.webhook) {
      try {
        const { WebhookAdapter } = await import("../channels/webhook.js");
        this.dispatchPlane.registerAdapter(new WebhookAdapter());
      } catch {
        /* webhook not available */
      }
    }

    // Extended channels — legacy adapters
    if (selections.sms) {
      try {
        const { SMSAdapter } = await import("../channels/sms.js");
        this.dispatchPlane.registerAdapter(wrapLegacyAdapter(new SMSAdapter()));
      } catch {
        /* sms not available */
      }
    }

    if (selections.matrix) {
      try {
        const { MatrixAdapter } = await import("../channels/matrix.js");
        this.dispatchPlane.registerAdapter(wrapLegacyAdapter(new MatrixAdapter()));
      } catch {
        /* matrix not available */
      }
    }

    if (selections.teams) {
      try {
        const { TeamsAdapter } = await import("../channels/teams.js");
        this.dispatchPlane.registerAdapter(wrapLegacyAdapter(new TeamsAdapter()));
      } catch {
        /* teams not available */
      }
    }

    // iMessage adapter (macOS only — uses AppleScript + chat.db)
    try {
      const { IMessageGatewayAdapter } = await import("../channels/imessage-gateway-adapter.js");
      const imsgAdapter = new IMessageGatewayAdapter();
      if (imsgAdapter.connected || process.platform === "darwin") {
        this.dispatchPlane.registerAdapter(imsgAdapter);
        this.appendLog({ type: "heartbeat", message: "Dispatch: iMessage adapter registered" });
      }
    } catch {
      /* imessage not available — non-macOS or chat.db inaccessible */
    }

    const result = await this.dispatchPlane.connectAll();
    const totalAdapters = result.connected.length + result.failed.length;
    this.appendLog({
      type: "start",
      message: `Unified dispatch plane started: ${result.connected.length}/${totalAdapters} adapters connected`,
      data: { connected: result.connected, failed: result.failed },
    });
    return this.dispatchPlane;
  }

  getDispatchPlane(): UnifiedDispatchPlane | null {
    return this.dispatchPlane;
  }

  private tick(): void {
    this.state = {
      ...this.state,
      tickCount: this.state.tickCount + 1,
    };

    const now = new Date();
    this.appendLog({ type: "tick", message: `Tick ${this.state.tickCount}` });
    this.runHeartbeatTasks(now, ["periodic", "nightly"]);

    // FlowTracker: record tick event for developer flow state tracking
    this.flowTracker.track({
      type: "terminal_command",
      timestamp: Date.now(),
      details: { tick: this.state.tickCount },
      command: "daemon-tick",
    });

    // IdleDetector: check if user is idle and generate away summary on return
    const wasIdle = this.idleDetector.checkIdle();
    if (wasIdle && this.idleDetector.getIdleDurationMs() > 0) {
      const idleDuration = this.idleDetector.getIdleDurationMs();
      const idleMinutes = Math.floor(idleDuration / 60_000);
      if (idleMinutes >= 5) {
        this.appendLog({
          type: "heartbeat",
          message: `User idle for ${idleMinutes} minutes`,
          data: { idleDurationMs: idleDuration },
        });
        // Surface idle notification via push
        pushNotification({
          title: "WOTANN — Away Summary",
          body: `You've been away for ${idleMinutes} minutes.`,
          urgency: "low",
        });
      }
    }

    // Check cron jobs
    for (const job of this.state.cronJobs) {
      if (job.enabled && this.shouldRunCron(job, now)) {
        this.executeCronJob(job);
      }
    }

    // Track C: Check event trigger cron schedules
    this.eventTriggerSystem.checkCronTriggers(now);

    // Track C: Ambient awareness — check signals every 4th tick (~1 min at 15s ticks)
    this.ambientTickCounter++;
    if (this.ambientTickCounter % 4 === 0) {
      const suggestion = this.ambientAwareness.getProactiveSuggestion();
      if (suggestion) {
        this.appendLog({
          type: "heartbeat",
          message: `Ambient signal: ${suggestion.slice(0, 200)}`,
          data: { signalCount: this.ambientAwareness.getSignalCount() },
        });

        // Surface ambient suggestion as a desktop notification
        pushNotification({
          title: "WOTANN — Ambient",
          body: suggestion.slice(0, 200),
          urgency: "low",
        });
      }

      // FlowTracker: check for developer struggle signals
      if (this.flowTracker.detectStruggle()) {
        this.appendLog({
          type: "heartbeat",
          message: "FlowTracker: developer appears to be struggling (3+ error-fix cycles)",
          data: { velocity: this.flowTracker.getVelocity() },
        });
        pushNotification({
          title: "WOTANN — Flow",
          body: "Rapid error-fix cycles detected. Consider a different approach.",
          urgency: "normal",
        });
      }

      // Proactive health checks (cost, CI, stale approvals)
      void proactiveCheck(this.costOracle).catch(() => {
        // Proactive check failure is non-fatal
      });
    }

    // Proactive heartbeat — every 20th tick (~5 min at 15s intervals)
    this.heartbeatTickCounter++;
    if (this.heartbeatTickCounter % 20 === 0) {
      void proactiveHeartbeatCheck({
        activeTasks: this.backgroundAgents.listTasks(),
      }).catch(() => {
        // Proactive heartbeat failure is non-fatal
      });
    }

    // Model discovery — refresh provider model lists every 400th tick (~100 minutes at 15s intervals)
    this.modelRefreshTickCounter++;
    if (this.modelRefreshTickCounter % 400 === 0) {
      const creds = {
        anthropicKey: process.env["ANTHROPIC_API_KEY"],
        openaiKey: process.env["OPENAI_API_KEY"],
        geminiKey: process.env["GEMINI_API_KEY"],
        githubToken: process.env["GITHUB_TOKEN"],
        ollamaHost: process.env["OLLAMA_HOST"],
        groqKey: process.env["GROQ_API_KEY"],
      };
      void discoverModels(creds)
        .then((models) => {
          if (models.length > 0) {
            this.appendLog({
              type: "heartbeat",
              message: `Model discovery: ${models.length} models found`,
            });
          }
        })
        .catch(() => {
          /* non-fatal */
        });
    }

    // Track C: Dream pipeline — run nightly (between 2AM-4AM, once per day)
    if (this.dreamPipeline && now.getHours() >= 2 && now.getHours() < 4) {
      this.checkAndRunDreamPipeline(now);
    }

    // Codebase health check — run once per day (between 3AM-5AM)
    if (now.getHours() >= 3 && now.getHours() < 5) {
      this.checkAndRunCodebaseHealth(now);
    }

    // Skill prompt optimization — nightly, once per day (between 2AM-4AM)
    if (this.runtime && now.getHours() >= 2 && now.getHours() < 4) {
      this.checkAndRunSkillOptimization(now);
    }

    // Living Spec divergence check — every 100th tick (~25 minutes at 15s intervals)
    this.specTickCounter++;
    if (this.specTickCounter % 100 === 0) {
      this.checkLivingSpecDivergence();
    }

    // ── Phase B Bug #1 fix: Consolidate auto_capture -> memory_entries ──
    // Every 8th tick (~2 min at 15s) run a small consolidation pass. Keeps
    // the work queue bounded and produces structured memory even when no
    // real user queries are happening. Cheap when the queue is empty.
    this.consolidationTickCounter++;
    if (this.consolidationTickCounter % 8 === 0 && this.runtime) {
      try {
        const report = this.runtime.consolidateObservations(200);
        if (report && report.read > 0) {
          this.appendLog({
            type: "heartbeat",
            message: `Consolidation: read ${report.read}, routed ${report.routed}, failed ${report.classificationFailed}, decisions ${report.decisionLogged}`,
            data: {
              byBlock: report.byBlock,
            },
          });
        }
      } catch (err) {
        this.appendLog({
          type: "error",
          message: `Consolidation tick failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // ── Tier 2A: Context Pressure — check every 4th tick (~1 min) ──
    this.contextPressureTickCounter++;
    if (this.contextPressureTickCounter % 4 === 0) {
      const rt = this.runtime as unknown as Record<string, (() => number) | undefined> | undefined;
      const tokensUsed = rt?.["getTokensUsed"]?.() ?? 0;
      const maxTokens = rt?.["getMaxTokens"]?.() ?? 200_000;
      const pressure = this.contextPressure.check(tokensUsed, maxTokens);
      if (pressure) {
        const pressureData: Record<string, unknown> = {
          level: pressure.level,
          utilizationPercent: pressure.utilizationPercent,
          tokensUsed: pressure.tokensUsed,
          tokensRemaining: pressure.tokensRemaining,
          recommendation: pressure.recommendation,
          timestamp: pressure.timestamp,
        };
        this.appendLog({
          type: "heartbeat",
          message: `Context pressure: ${pressure.level} (${Math.round(pressure.utilizationPercent)}%)`,
          data: pressureData,
        });
        // Broadcast to all connected CLI sessions
        this.ipcServer?.broadcast({
          jsonrpc: "2.0",
          method: "stream",
          params: {
            type: "text",
            content: JSON.stringify({ type: "context-pressure", ...pressureData }),
            sessionId: "daemon",
          },
        });
      }
    }
  }

  /**
   * Check Living Spec divergence and push notifications for high-severity issues.
   * Reloads the spec from disk to catch edits, then compares against the codebase.
   */
  private checkLivingSpecDivergence(): void {
    const specPath = join(this.workingDir, ".wotann", "SPEC.md");
    if (!existsSync(specPath)) return;

    try {
      // Reload spec to pick up any edits since last check
      this.livingSpec = this.livingSpecManager.loadSpec(specPath);
      const divergences = this.livingSpecManager.checkDivergence(this.livingSpec);

      if (divergences.length === 0) return;

      const highSeverity = divergences.filter((d: Divergence) => d.severity === "error");
      const warnings = divergences.filter((d: Divergence) => d.severity === "warning");

      this.appendLog({
        type: "heartbeat",
        message: `Living Spec divergence: ${highSeverity.length} errors, ${warnings.length} warnings, ${divergences.length} total`,
        data: {
          errors: highSeverity.map((d: Divergence) => d.description),
          warnings: warnings.map((d: Divergence) => d.description),
        },
      });

      // Push desktop notifications for high-severity divergences
      if (highSeverity.length > 0) {
        pushNotification({
          title: "WOTANN — Spec Divergence",
          body: `${highSeverity.length} spec violation(s): ${highSeverity[0]!.description.slice(0, 120)}${highSeverity.length > 1 ? ` (+${highSeverity.length - 1} more)` : ""}`,
          urgency: "critical",
          sound: true,
        });
      }
    } catch (err) {
      this.appendLog({
        type: "error",
        message: `Living Spec divergence check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Get the LivingSpecManager for external access.
   */
  getLivingSpecManager(): LivingSpecManager {
    return this.livingSpecManager;
  }

  /**
   * Get the currently loaded Living Spec, if any.
   */
  getLivingSpec(): LivingSpec | null {
    return this.livingSpec;
  }

  private async initDreamPipeline(wotannDir: string): Promise<void> {
    const dreamsDir = join(wotannDir, ".dreams");
    const dbPath = join(this.workingDir, ".wotann", "memory.db");
    const { MemoryStore } = await import("../memory/store.js");
    const memStore = new MemoryStore(dbPath);
    this.dreamPipeline = new DreamPipeline(memStore, dreamsDir);
    this.appendLog({ type: "start", message: "DreamPipeline initialized" });
  }

  private checkAndRunDreamPipeline(now: Date): void {
    const today = now.toISOString().slice(0, 10);
    if (this.lastDreamDate === today) return; // Already dreamed today
    if (!this.dreamPipeline) return;

    this.lastDreamDate = today;
    void Promise.resolve(this.dreamPipeline.runPipelineSync())
      .then((result) => {
        this.appendLog({
          type: "heartbeat",
          message: `Dream pipeline completed: ${result.deep.promoted} promoted, ${result.deep.rejected} rejected`,
          data: {
            lightCandidates: result.light.candidates.length,
            remDomains: result.rem.domainCount,
            durationMs: result.durationMs,
          },
        });
      })
      .catch((err) => {
        this.appendLog({
          type: "error",
          message: `Dream pipeline failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
  }

  private checkAndRunCodebaseHealth(now: Date): void {
    const today = now.toISOString().slice(0, 10);
    if (this.lastHealthCheckDate === today) return;

    this.lastHealthCheckDate = today;
    try {
      const report = analyzeCodebaseHealth(this.workingDir);
      this.lastHealthReport = report;
      this.appendLog({
        type: "heartbeat",
        message: `Codebase health check: score=${report.healthScore}/100, tests=${report.testCoverage}%, todos=${report.todoCount}, typeErrors=${report.typeErrors}`,
        data: {
          healthScore: report.healthScore,
          testCoverage: report.testCoverage,
          todoCount: report.todoCount,
          typeErrors: report.typeErrors,
          lintWarnings: report.lintWarnings,
        },
      });
    } catch (err) {
      this.appendLog({
        type: "error",
        message: `Codebase health check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Nightly skill prompt optimization — wires `skills/skill-optimizer.ts`
   * into the daemon. Picks the first N registered skills (no invocation
   * tracking source yet — honest note; pending a dedicated usage meter)
   * and logs a report. Full GEPA optimization is opt-in via
   * `WOTANN_SKILL_OPT=gepa`; absent the flag the run is a dry-enumeration
   * so the hook is live without spinning LLM calls every night.
   */
  private checkAndRunSkillOptimization(now: Date): void {
    const today = now.toISOString().slice(0, 10);
    if (this.lastSkillOptDate === today) return;
    if (!this.runtime) return;
    this.lastSkillOptDate = today;

    try {
      const registry = this.runtime.getSkillRegistry();
      const summaries = registry.getSummaries().slice(0, 3);
      const mode = process.env["WOTANN_SKILL_OPT"] === "gepa" ? "gepa" : "dry";
      this.appendLog({
        type: "heartbeat",
        message: `Nightly skill-optimizer ${mode}: picked top ${summaries.length} skills (no invocation-count source yet)`,
        data: { skills: summaries.map((s) => s.name), mode },
      });
      if (mode === "gepa") void this.runSkillOptimizationGepa(summaries.map((s) => s.name));
    } catch (err) {
      this.appendLog({
        type: "error",
        message: `Skill optimization failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private async runSkillOptimizationGepa(skillNames: readonly string[]): Promise<void> {
    if (!this.runtime) return;
    const rt = this.runtime;
    const llmQuery = async (prompt: string, opts: { maxTokens: number }): Promise<string> => {
      let accum = "";
      for await (const chunk of rt.query({ prompt, maxTokens: opts.maxTokens })) {
        if (chunk.type === "text") accum += chunk.content;
      }
      return accum;
    };
    const mutate = createLlmPromptMutator(llmQuery);
    const evaluate = buildBasicEvaluator(
      {
        query: async (p) => {
          let out = "";
          for await (const c of rt.query({ prompt: p })) if (c.type === "text") out += c.content;
          return out;
        },
      },
      [{ input: "ping", expectedContains: "pong" }],
    );
    for (const name of skillNames) {
      const loaded = rt.getSkillRegistry().loadSkill(name);
      if (!loaded) continue;
      try {
        const result = await optimizeSkillPrompt({
          initialPrompt: loaded.content,
          mutate,
          evaluate,
          maxGenerations: 2,
          populationSize: 2,
        });
        this.appendLog({
          type: "heartbeat",
          message: `Skill-optimizer: ${name} improved=${result.improved} fitness ${result.baselineFitness.toFixed(2)} -> ${result.fitness.toFixed(2)}`,
        });
      } catch (err) {
        this.appendLog({
          type: "error",
          message: `Skill-optimizer failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  getCrossDeviceContext(): CrossDeviceContextManager {
    return this.crossDeviceContext;
  }

  getLastHealthReport(): CodebaseHealthReport | null {
    return this.lastHealthReport;
  }

  getFlowTracker(): FlowTracker {
    return this.flowTracker;
  }

  getIdleDetector(): IdleDetector {
    return this.idleDetector;
  }

  getSmartFileSearch(): SmartFileSearch | null {
    return this.fileSearch;
  }

  getContextPressure(): ContextPressureMonitor {
    return this.contextPressure;
  }

  getTerminalMonitor(): TerminalMonitor {
    return this.terminalMonitor;
  }

  getFileDependencyGraph(): FileDependencyGraph {
    return this.fileDependencyGraph;
  }

  addCronJob(job: CronJob): void {
    this.state = {
      ...this.state,
      cronJobs: [...this.state.cronJobs, job],
    };
  }

  removeCronJob(id: string): void {
    this.state = {
      ...this.state,
      cronJobs: this.state.cronJobs.filter((j) => j.id !== id),
    };
  }

  addHeartbeatTask(task: HeartbeatTask): void {
    this.state = {
      ...this.state,
      heartbeatTasks: [...this.state.heartbeatTasks, task],
    };
  }

  loadHeartbeatTasksFromFile(heartbeatPath: string): number {
    if (!existsSync(heartbeatPath)) {
      this.state = { ...this.state, heartbeatTasks: [] };
      return 0;
    }

    const markdown = readFileSync(heartbeatPath, "utf-8");
    const tasks = parseHeartbeatTasks(markdown);
    this.state = { ...this.state, heartbeatTasks: tasks };
    return tasks.length;
  }

  private shouldRunCron(job: CronJob, now: Date): boolean {
    // Don't re-run if already ran this minute
    if (job.lastRun) {
      const lastRunMinute = Math.floor(job.lastRun.getTime() / 60_000);
      const nowMinute = Math.floor(now.getTime() / 60_000);
      if (lastRunMinute === nowMinute) return false;
    }

    return matchesCronSchedule(job.schedule, now);
  }

  private executeCronJob(job: CronJob): void {
    const parts = job.command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    if (!cmd) return;

    this.appendLog({
      type: "cron",
      message: `Executing cron job: ${job.name}`,
      data: { jobId: job.id, command: job.command },
    });

    execFileAsync(cmd, args, { timeout: 30_000, cwd: process.cwd() })
      .then(() => {
        this.updateCronJobResult(job.id, "success");
      })
      .catch(() => {
        this.updateCronJobResult(job.id, "failure");
      });
  }

  private updateCronJobResult(jobId: string, result: "success" | "failure"): void {
    this.state = {
      ...this.state,
      cronJobs: this.state.cronJobs.map((j) =>
        j.id === jobId ? { ...j, lastRun: new Date(), lastResult: result } : j,
      ),
    };
  }

  private runHeartbeatTasks(now: Date, schedules: readonly HeartbeatScheduleKind[]): void {
    for (const task of this.state.heartbeatTasks) {
      if (!isHeartbeatSchedule(task.schedule)) continue;
      if (!schedules.includes(task.schedule)) continue;
      if (!this.shouldRunHeartbeatTask(task, now)) continue;
      this.executeHeartbeatTask(task, now);
    }
  }

  private shouldRunHeartbeatTask(task: HeartbeatTask, now: Date): boolean {
    if (!task.enabled || !isHeartbeatSchedule(task.schedule)) {
      return false;
    }

    if (task.schedule === "on-wake") {
      return !task.lastRun;
    }

    if (task.schedule === "periodic") {
      return !task.lastRun || now.getTime() - task.lastRun.getTime() >= 15 * 60_000;
    }

    if (!task.lastRun) {
      return now.getHours() >= 2;
    }

    const lastRunDay = task.lastRun.toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    return lastRunDay !== today && now.getHours() >= 2;
  }

  private executeHeartbeatTask(task: HeartbeatTask, now: Date): void {
    if (!isHeartbeatSchedule(task.schedule)) {
      return;
    }

    this.appendLog({
      type: "heartbeat",
      message: `Running heartbeat task: ${task.name}`,
      data: { schedule: task.schedule },
    });

    this.updateHeartbeatTaskState(
      task.name,
      task.schedule,
      now,
      computeNextRun(task.schedule, now),
    );

    if (/consolidate|dream|gotchas|memory/i.test(task.name)) {
      const result = runWorkspaceDreamIfDue(process.cwd(), { quiet: true });
      this.appendLog({
        type: "heartbeat",
        message: result
          ? `autoDream executed from heartbeat: ${task.name}`
          : `autoDream skipped (not due): ${task.name}`,
        data: result
          ? {
              gotchasAdded: result.gotchasAdded,
              instinctsUpdated: result.instinctsUpdated,
              rulesUpdated: result.rulesUpdated,
            }
          : undefined,
      });
      return;
    }

    if (/git status|monitor file changes/i.test(task.name)) {
      execFileAsync("git", ["status", "--short"], { timeout: 10_000, cwd: process.cwd() })
        .then(({ stdout }) => {
          this.appendLog({
            type: "heartbeat",
            message: `Git status heartbeat: ${task.name}`,
            data: { changedEntries: stdout.trim().split("\n").filter(Boolean).length },
          });
        })
        .catch(() => {
          this.appendLog({
            type: "heartbeat",
            message: `Git status heartbeat failed: ${task.name}`,
          });
        });
      return;
    }

    this.appendLog({
      type: "heartbeat",
      message: `Heartbeat task completed: ${task.name}`,
    });
  }

  private updateHeartbeatTaskState(
    taskName: string,
    schedule: string,
    lastRun: Date,
    nextRun?: Date,
  ): void {
    this.state = {
      ...this.state,
      heartbeatTasks: this.state.heartbeatTasks.map((task) =>
        task.name === taskName && task.schedule === schedule ? { ...task, lastRun, nextRun } : task,
      ),
    };
  }

  /**
   * Phase B Bug #2 fix: install shutdown handlers so the daemon flushes
   * state and cleans up its `.tmp.*` / WAL files even on SIGINT/SIGTERM.
   *
   * Previously Ctrl-C mid-write left a stranded `knowledge-graph.json.tmp.*`.
   * Now the handler calls `stop()` (idempotent) before the process exits.
   * Registered once per daemon instance; subsequent start()s don't re-add
   * listeners (the `shutdownHandlersInstalled` flag prevents leak).
   */
  private installShutdownHandlers(): void {
    if (this.shutdownHandlersInstalled) return;
    this.shutdownHandlersInstalled = true;

    // Keep a reference so tests / external code can remove these if they
    // need clean teardown (process-wide listeners leak across vitest runs
    // otherwise).
    const handleShutdown = (signal: string) => {
      if (this.state.status === "stopped") return;
      this.appendLog({
        type: "stop",
        message: `Shutdown signal received: ${signal}`,
      });
      try {
        this.stop();
      } catch (err) {
        this.appendLog({
          type: "error",
          message: `stop() threw during ${signal}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };

    const sigintHandler = () => handleShutdown("SIGINT");
    const sigtermHandler = () => handleShutdown("SIGTERM");
    const exitHandler = () => {
      // 'exit' fires synchronously after all work is done. stop() is
      // idempotent — if SIGINT already fired we're a no-op.
      if (this.state.status !== "stopped") {
        try {
          this.stop();
        } catch {
          /* process is dying — nothing to do */
        }
      }
    };

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);
    process.on("exit", exitHandler);

    this.shutdownHandlers = { sigintHandler, sigtermHandler, exitHandler };
  }

  /**
   * Remove signal handlers. Called from stop() when the caller asks for a
   * clean teardown (tests, second start()).
   */
  private removeShutdownHandlers(): void {
    if (!this.shutdownHandlersInstalled || !this.shutdownHandlers) return;
    process.removeListener("SIGINT", this.shutdownHandlers.sigintHandler);
    process.removeListener("SIGTERM", this.shutdownHandlers.sigtermHandler);
    process.removeListener("exit", this.shutdownHandlers.exitHandler);
    this.shutdownHandlersInstalled = false;
    this.shutdownHandlers = null;
  }

  /**
   * Phase B Bug #2 fix: clean up orphan `.tmp.*` files and stranded
   * WAL/SHM files from previous daemon runs.
   *
   * Symptoms that triggered this fix:
   *   - `.wotann/knowledge-graph.json.tmp.*` × 30+ (leaked atomic-write temps)
   *   - `.wotann/memory 2.db-wal`, `memory 3.db-shm`, etc. — 6 orphan
   *     pairs from duplicate SQLite instances opened by crashed processes.
   *     They have no matching `.db` so they're dead weight.
   *
   * Sweeps:
   *   1. Remove all `*.tmp.*` files in `.wotann/` root (dead atomic-write temps).
   *   2. Remove all `memory N.db-wal` / `memory N.db-shm` whose corresponding
   *      `memory N.db` does NOT exist.
   *
   * Safe to run on every daemon start. Never touches files that are in-use
   * by a live SQLite connection (no matching bare `.db` means nothing owns them).
   *
   * @returns the number of files removed, split by bucket.
   */
  private sweepOrphanFiles(): { tmpRemoved: number; walRemoved: number; shmRemoved: number } {
    const wotannDirs = [join(this.workingDir, ".wotann"), join(homedir(), ".wotann")];
    let tmpRemoved = 0;
    let walRemoved = 0;
    let shmRemoved = 0;

    for (const dir of wotannDirs) {
      if (!existsSync(dir)) continue;

      let entries: readonly string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }

      // Build a set of live `.db` files so we know which WAL/SHM pairs
      // are safe to remove. A WAL/SHM with a corresponding `.db` is still
      // in use and must NOT be touched.
      const liveDbNames = new Set(
        entries.filter((name) => name.endsWith(".db")).map((name) => name),
      );

      for (const name of entries) {
        const full = join(dir, name);

        // Pass 1: remove stale atomic-write temps. Pattern is
        // `<base>.tmp.<pid>.<ts>` (e.g. `knowledge-graph.json.tmp.12345.67890`).
        // Match `.tmp.` followed by a digit to avoid false positives like
        // `.tmpl` or `.tmp` (with no suffix).
        if (/\.tmp\.\d+/.test(name)) {
          try {
            unlinkSync(full);
            tmpRemoved++;
          } catch {
            /* may have been deleted by a race — ignore */
          }
          continue;
        }

        // Pass 2: orphan SQLite WAL files. A `.db-wal` without a matching
        // `.db` is from a crashed process that can never finish the
        // checkpoint.
        if (name.endsWith(".db-wal")) {
          const baseDb = name.slice(0, -"-wal".length);
          if (!liveDbNames.has(baseDb)) {
            try {
              unlinkSync(full);
              walRemoved++;
            } catch {
              /* race — ignore */
            }
          }
          continue;
        }

        // Pass 3: orphan SQLite SHM files. Same rule.
        if (name.endsWith(".db-shm")) {
          const baseDb = name.slice(0, -"-shm".length);
          if (!liveDbNames.has(baseDb)) {
            try {
              unlinkSync(full);
              shmRemoved++;
            } catch {
              /* race — ignore */
            }
          }
          continue;
        }
      }
    }

    return { tmpRemoved, walRemoved, shmRemoved };
  }

  // ── Daily Log (append-only JSONL) ───────────────────────────

  private appendLog(entry: Omit<DailyLogEntry, "timestamp">): void {
    const fullEntry: DailyLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(this.logDir, `${today}.jsonl`);

    try {
      appendFileSync(logFile, JSON.stringify(fullEntry) + "\n");
    } catch {
      // Fail silently — logging should never crash the daemon
    }
  }

  getLogs(date?: string): readonly DailyLogEntry[] {
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    const logFile = join(this.logDir, `${targetDate}.jsonl`);

    if (!existsSync(logFile)) return [];

    try {
      const content = readFileSync(logFile, "utf-8");
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as DailyLogEntry);
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return [];
    }
  }
}

interface ResolvedChannelSelections {
  readonly webchat: boolean;
  readonly telegram: boolean;
  readonly slack: boolean;
  readonly discord: boolean;
  readonly signal: boolean;
  readonly whatsapp: boolean;
  readonly email: boolean;
  readonly webhook: boolean;
  readonly sms: boolean;
  readonly matrix: boolean;
  readonly teams: boolean;
}

function resolveChannelSelections(options: ChannelGatewayStartOptions): ResolvedChannelSelections {
  const allOptions = [
    options.webchat,
    options.telegram,
    options.slack,
    options.discord,
    options.signal,
    options.whatsapp,
    options.email,
    options.webhook,
    options.sms,
    options.matrix,
    options.teams,
  ];
  const explicitSelection = allOptions.some((value) => value !== undefined);

  if (explicitSelection) {
    return {
      webchat: options.webchat ?? false,
      telegram: options.telegram ?? false,
      slack: options.slack ?? false,
      discord: options.discord ?? false,
      signal: options.signal ?? false,
      whatsapp: options.whatsapp ?? false,
      email: options.email ?? false,
      webhook: options.webhook ?? false,
      sms: options.sms ?? false,
      matrix: options.matrix ?? false,
      teams: options.teams ?? false,
    };
  }

  // Auto-detect based on environment variables
  return {
    webchat: true,
    telegram: Boolean(process.env["TELEGRAM_BOT_TOKEN"]),
    slack: Boolean(process.env["SLACK_BOT_TOKEN"] && process.env["SLACK_APP_TOKEN"]),
    discord: Boolean(process.env["DISCORD_BOT_TOKEN"]),
    signal: Boolean(process.env["SIGNAL_CLI_PATH"] || process.env["SIGNAL_PHONE_NUMBER"]),
    whatsapp: Boolean(process.env["WHATSAPP_SESSION_DIR"]),
    email: Boolean(process.env["IMAP_HOST"] && process.env["SMTP_HOST"]),
    webhook: Boolean(process.env["WOTANN_WEBHOOK_SECRET"]),
    sms: Boolean(process.env["TWILIO_ACCOUNT_SID"]),
    matrix: Boolean(process.env["MATRIX_ACCESS_TOKEN"]),
    teams: Boolean(process.env["TEAMS_APP_ID"]),
  };
}

export function parseHeartbeatTasks(
  markdown: string,
  now: Date = new Date(),
): readonly HeartbeatTask[] {
  const tasks: HeartbeatTask[] = [];
  let schedule: HeartbeatScheduleKind | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("## ")) {
      const heading = line.toLowerCase();
      if (heading.includes("on wake")) schedule = "on-wake";
      else if (heading.includes("periodic")) schedule = "periodic";
      else if (heading.includes("nightly")) schedule = "nightly";
      else schedule = null;
      continue;
    }

    const taskMatch = line.match(/^- \[(?: |x)\] (.+)$/i);
    if (!taskMatch || !schedule) continue;

    tasks.push({
      name: taskMatch[1]!.trim(),
      schedule,
      enabled: true,
      nextRun: schedule === "on-wake" ? now : computeNextRun(schedule, now),
    });
  }

  return tasks;
}

function isHeartbeatSchedule(schedule: string): schedule is HeartbeatScheduleKind {
  return schedule === "on-wake" || schedule === "periodic" || schedule === "nightly";
}

function computeNextRun(schedule: HeartbeatScheduleKind, now: Date): Date | undefined {
  if (schedule === "on-wake") {
    return undefined;
  }

  if (schedule === "periodic") {
    return new Date(now.getTime() + 15 * 60_000);
  }

  const next = new Date(now);
  next.setDate(next.getHours() >= 2 ? next.getDate() + 1 : next.getDate());
  next.setHours(2, 0, 0, 0);
  return next;
}
