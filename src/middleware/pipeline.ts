/**
 * Middleware pipeline: executes all 26 layers in order.
 * Before hooks run in forward order (1→26), after hooks in reverse (26→1).
 *
 * Layers 1-18: Original pipeline (intent, thread, uploads, file-type-gate, sandbox, etc.)
 * Layers 19-24: TerminalBench accuracy optimizations (Sprint A + B)
 * Layer 25: Self-reflection (post-response quality validation)
 * Note: FileTypeGate (Magika classifier) sits at logical layer 3.5 between Uploads and Sandbox.
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";
import { intentGateMiddleware } from "./intent-gate.js";
import {
  threadDataMiddleware,
  uploadsMiddleware,
  sandboxMiddleware,
  guardrailMiddleware,
  toolErrorMiddleware,
  summarizationMiddleware,
  memoryMiddleware,
  clarificationMiddleware,
  cacheMiddleware,
  autonomyMiddleware,
  fileTrackMiddleware,
  forcedVerificationMiddleware,
  frustrationMiddleware,
  selfReflectionMiddleware,
} from "./layers.js";
import {
  PreCompletionChecklistMiddleware,
  createPreCompletionMiddleware,
} from "./pre-completion-checklist.js";
import {
  SystemNotificationTracker,
  createSystemNotificationsMiddleware,
} from "./system-notifications.js";
import { NonInteractiveMiddleware, createNonInteractiveMiddleware } from "./non-interactive.js";
import { PlanEnforcementMiddleware, createPlanEnforcementMiddleware } from "./plan-enforcement.js";
import {
  VerificationEnforcementMiddleware,
  createVerificationEnforcementMiddleware,
} from "./verification-enforcement.js";
import { AutoInstallMiddleware, createAutoInstallMiddleware } from "./auto-install.js";
import { StaleDetectionMiddleware, createStaleDetectionMiddleware } from "./stale-detection.js";
import { DoomLoopMiddleware, createDoomLoopMiddleware } from "./doom-loop.js";
import { LoopDetector, createLoopDetectionMiddleware } from "./loop-detection.js";
import {
  OutputTruncationMiddleware,
  createOutputTruncationMiddleware,
} from "./output-truncation.js";
import {
  ToolPairValidatorMiddleware,
  createToolPairValidatorMiddleware,
} from "./tool-pair-validator.js";
import { fileTypeGateMiddleware } from "./file-type-gate.js";
import {
  GuardrailProviderMiddleware,
  AllowlistProvider,
  createGuardrailProviderMiddleware,
} from "./guardrail-provider.js";
import {
  DanglingToolCallMiddleware,
  createDanglingToolCallMiddleware,
} from "./dangling-tool-call.js";
import {
  LLMErrorHandlingMiddleware,
  createLLMErrorHandlingMiddleware,
} from "./llm-error-handling.js";
import { SandboxAuditMiddleware, createSandboxAuditMiddleware } from "./sandbox-audit.js";
import { AuditTrail } from "../telemetry/audit-trail.js";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveWotannHome } from "../utils/wotann-home.js";
import { TitleMiddleware, createTitleMiddleware } from "./title.js";
import {
  DeferredToolFilterMiddleware,
  createDeferredToolFilterMiddleware,
} from "./deferred-tool-filter.js";
import { createTrifectaGuardMiddleware } from "./layers.js";
import type { TrifectaContext } from "./trifecta-guard.js";

// ── Shared instances for new middleware ────────────────────────

const defaultChecklistInstance = new PreCompletionChecklistMiddleware();
const defaultNotificationTracker = new SystemNotificationTracker();
const defaultNonInteractiveInstance = new NonInteractiveMiddleware();
const defaultPlanEnforcementInstance = new PlanEnforcementMiddleware();
const defaultVerificationInstance = new VerificationEnforcementMiddleware(defaultChecklistInstance);
const defaultAutoInstallInstance = new AutoInstallMiddleware();
const defaultStaleDetectionInstance = new StaleDetectionMiddleware();
const defaultDoomLoopInstance = new DoomLoopMiddleware();
const defaultLoopDetectorInstance = new LoopDetector();
const defaultOutputTruncationInstance = new OutputTruncationMiddleware();
const defaultToolPairValidatorInstance = new ToolPairValidatorMiddleware();
// Lane 2 deer-flow ports (6 new middleware — closes Lane 2 parity gap).
const defaultGuardrailProviderInstance = new GuardrailProviderMiddleware(new AllowlistProvider({}));
const defaultDanglingToolCallInstance = new DanglingToolCallMiddleware();
const defaultLLMErrorHandlingInstance = new LLMErrorHandlingMiddleware();
const defaultSandboxAuditInstance = new SandboxAuditMiddleware();

// GA-05 (V9_UNIFIED_GAP_MATRIX_2026-04-25) — lazy AuditTrail singleton.
// Constructed on first read (not at module load) so test runs that never
// touch sandbox-audit don't open a SQLite handle on the user's home
// directory. Uses the same `~/.wotann/audit.db` path as kairos-rpc
// (audit.query handler) so daemon-side queries see the writes the
// SandboxAuditMiddleware mirrors here. Failures during construction
// (read-only home, corrupt DB) collapse to `null` so the middleware
// option stays falsy and the pipeline degrades to in-memory-only audit
// rather than crashing on every turn.
let cachedAuditTrail: AuditTrail | null | undefined = undefined;
function getDefaultAuditTrail(): AuditTrail | undefined {
  if (cachedAuditTrail !== undefined) {
    return cachedAuditTrail ?? undefined;
  }
  try {
    const wotannDir = resolveWotannHome();
    if (!existsSync(wotannDir)) {
      mkdirSync(wotannDir, { recursive: true });
    }
    const dbPath = join(wotannDir, "audit.db");
    cachedAuditTrail = new AuditTrail(dbPath);
    return cachedAuditTrail;
  } catch (err) {
    // Honest fallback (QB#6): if the audit DB can't be opened, log once
    // and fall back to in-memory-only audit. Never crash the pipeline.
    console.warn(
      `[Pipeline] AuditTrail singleton init failed: ${(err as Error).message}; sandbox audit will be in-memory only`,
    );
    cachedAuditTrail = null;
    return undefined;
  }
}
const defaultTitleInstance = new TitleMiddleware();
const defaultDeferredToolFilterInstance = new DeferredToolFilterMiddleware();

// V9 T10.P0.4 — Trifecta Guard middleware. Closure of the agentic-browser
// P0 security gate: ANY tool call simultaneously satisfying Willison's
// lethal trifecta (untrusted page input + private data access + external
// communication capability) requires human approval. Default approval
// handler conservatively DENIES until the runtime injects a real
// ApprovalQueue handler — this fail-closed default matches QB #6.
const defaultTrifectaContextProvider = (
  ctx: import("./types.js").MiddlewareContext,
): TrifectaContext | null => {
  const tool = (ctx as unknown as { toolName?: unknown }).toolName;
  if (typeof tool !== "string" || tool.length === 0) return null;
  const args = (ctx as unknown as { toolArgs?: Readonly<Record<string, unknown>> }).toolArgs;
  return {
    toolName: tool,
    ...(args ? { args } : {}),
    initiatedFromUntrustedSource:
      (ctx as unknown as { initiatedFromUntrustedSource?: boolean })
        .initiatedFromUntrustedSource === true,
    sessionHasPrivateData:
      (ctx as unknown as { sessionHasPrivateData?: boolean }).sessionHasPrivateData === true,
  };
};
const defaultDenyApprovalHandler = async (): Promise<"approve" | "deny"> => "deny";

// ── Pipeline Definition (31 layers in order, 6 Lane 2 additions) ─

const PIPELINE: readonly Middleware[] = [
  createToolPairValidatorMiddleware(defaultToolPairValidatorInstance), // 0. Tool use/result pair validation
  intentGateMiddleware, // 1. Intent analysis
  threadDataMiddleware, // 2. Thread isolation
  uploadsMiddleware, // 3. File uploads
  fileTypeGateMiddleware, // 3.5. Magika file-type classifier + trust boundary
  createDanglingToolCallMiddleware(defaultDanglingToolCallInstance), // 3.7. Lane 2: repair dangling tool_use
  sandboxMiddleware, // 4. Sandbox env
  createSandboxAuditMiddleware(defaultSandboxAuditInstance, {
    ...(getDefaultAuditTrail() ? { auditTrail: getDefaultAuditTrail()! } : {}),
  }), // 4.7. Lane 2: sandbox command audit + GA-05 mirror to SQLite trail
  guardrailMiddleware, // 5. Pre-execution auth (keyword heuristic — existing)
  createGuardrailProviderMiddleware(defaultGuardrailProviderInstance), // 5.5. Lane 2: pluggable provider
  createTrifectaGuardMiddleware({
    approvalHandler: defaultDenyApprovalHandler,
    contextProvider: defaultTrifectaContextProvider,
    strictMode: false,
  }), // 5.7. V9 T10.P0.4: Trifecta Guard (untrusted-input + private-data + external-comm = approval-required)
  toolErrorMiddleware, // 6. Error standardization
  createOutputTruncationMiddleware(defaultOutputTruncationInstance), // 6.5. Output truncation
  createLLMErrorHandlingMiddleware(defaultLLMErrorHandlingInstance), // 6.7. Lane 2: canonical provider errors
  summarizationMiddleware, // 7. Token management
  memoryMiddleware, // 8. Memory extraction
  clarificationMiddleware, // 10. User clarification (S5-4: 9 SubagentLimit deleted as dead code)
  cacheMiddleware, // 11. Cache tracking
  autonomyMiddleware, // 12. Risk classification
  fileTrackMiddleware, // 14. File tracking (S5-4: 13 LSP deleted as dead code)
  createDeferredToolFilterMiddleware(defaultDeferredToolFilterInstance), // 14.5. Lane 2: hide deferred tool schemas
  forcedVerificationMiddleware, // 15. Auto-verify writes
  frustrationMiddleware, // 16. Frustration detection
  createPreCompletionMiddleware(defaultChecklistInstance), // 17. Pre-completion gate
  createTitleMiddleware(defaultTitleInstance), // 17.5. Lane 2: auto-title after first exchange
  createSystemNotificationsMiddleware(defaultNotificationTracker), // 18. System notifications
  // ── TerminalBench Accuracy Optimizations ──────────────────
  createNonInteractiveMiddleware(defaultNonInteractiveInstance), // 19. Non-interactive mode
  createPlanEnforcementMiddleware(defaultPlanEnforcementInstance), // 20. Mandatory planning gate
  createVerificationEnforcementMiddleware(defaultVerificationInstance), // 21. Verification enforcement
  createAutoInstallMiddleware(defaultAutoInstallInstance), // 22. Auto-install missing deps
  createStaleDetectionMiddleware(defaultStaleDetectionInstance), // 23. Stale-read detection
  createDoomLoopMiddleware(defaultDoomLoopInstance), // 24. Doom loop detection
  createLoopDetectionMiddleware(defaultLoopDetectorInstance), // 24.5. Loop detection (Crush port, per-session)
  selfReflectionMiddleware, // 25. Self-reflection (post-response validation)
];

// ── Pipeline Executor ───────────────────────────────────────

export class MiddlewarePipeline {
  private readonly layers: readonly Middleware[];

  constructor(layers?: readonly Middleware[]) {
    this.layers = layers ?? PIPELINE;
  }

  /** Number of middleware layers in this pipeline. */
  getLayerCount(): number {
    return this.layers.length;
  }

  /**
   * Run all before hooks in forward order (1→24).
   */
  async processBefore(ctx: MiddlewareContext): Promise<MiddlewareContext> {
    let current = ctx;
    for (const layer of this.layers) {
      if (layer.before) {
        current = await layer.before(current);
      }
    }
    return current;
  }

  /**
   * Run all after hooks in reverse order (24→1).
   */
  async processAfter(ctx: MiddlewareContext, result: AgentResult): Promise<AgentResult> {
    let current = result;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]!;
      if (layer.after) {
        current = await layer.after(ctx, current);
      }
    }
    return current;
  }

  /**
   * Get the ordered list of middleware names.
   */
  getLayerNames(): readonly string[] {
    return this.layers.map((l) => l.name);
  }

  /**
   * Get a specific layer by name.
   */
  getLayer(name: string): Middleware | undefined {
    return this.layers.find((l) => l.name === name);
  }
}

/**
 * Create the default 24-layer pipeline.
 */
export function createDefaultPipeline(): MiddlewarePipeline {
  return new MiddlewarePipeline();
}

/**
 * Create a pipeline with custom checklist and notification tracker instances.
 * Useful for testing or when the runtime needs direct access to the instances.
 */
export function createPipelineWithInstances(
  checklist: PreCompletionChecklistMiddleware,
  notificationTracker: SystemNotificationTracker,
): {
  readonly pipeline: MiddlewarePipeline;
  readonly checklist: PreCompletionChecklistMiddleware;
  readonly notificationTracker: SystemNotificationTracker;
  readonly nonInteractive: NonInteractiveMiddleware;
  readonly planEnforcement: PlanEnforcementMiddleware;
  readonly verificationEnforcement: VerificationEnforcementMiddleware;
  readonly autoInstall: AutoInstallMiddleware;
  readonly staleDetection: StaleDetectionMiddleware;
  readonly doomLoop: DoomLoopMiddleware;
  readonly loopDetector: LoopDetector;
  readonly outputTruncation: OutputTruncationMiddleware;
  readonly toolPairValidator: ToolPairValidatorMiddleware;
  readonly guardrailProvider: GuardrailProviderMiddleware;
  readonly danglingToolCall: DanglingToolCallMiddleware;
  readonly llmErrorHandling: LLMErrorHandlingMiddleware;
  readonly sandboxAudit: SandboxAuditMiddleware;
  readonly title: TitleMiddleware;
  readonly deferredToolFilter: DeferredToolFilterMiddleware;
} {
  const nonInteractive = new NonInteractiveMiddleware();
  const planEnforcement = new PlanEnforcementMiddleware();
  const verificationEnforcement = new VerificationEnforcementMiddleware(checklist);
  const autoInstall = new AutoInstallMiddleware();
  const staleDetection = new StaleDetectionMiddleware();
  const doomLoop = new DoomLoopMiddleware();
  const loopDetector = new LoopDetector();
  const outputTruncation = new OutputTruncationMiddleware();
  const toolPairValidator = new ToolPairValidatorMiddleware();
  const guardrailProvider = new GuardrailProviderMiddleware(new AllowlistProvider({}));
  const danglingToolCall = new DanglingToolCallMiddleware();
  const llmErrorHandling = new LLMErrorHandlingMiddleware();
  const sandboxAudit = new SandboxAuditMiddleware();
  const title = new TitleMiddleware();
  const deferredToolFilter = new DeferredToolFilterMiddleware();

  const layers: readonly Middleware[] = [
    createToolPairValidatorMiddleware(toolPairValidator),
    intentGateMiddleware,
    threadDataMiddleware,
    uploadsMiddleware,
    fileTypeGateMiddleware,
    createDanglingToolCallMiddleware(danglingToolCall),
    sandboxMiddleware,
    createSandboxAuditMiddleware(sandboxAudit, {
      ...(getDefaultAuditTrail() ? { auditTrail: getDefaultAuditTrail()! } : {}),
    }),
    guardrailMiddleware,
    createGuardrailProviderMiddleware(guardrailProvider),
    toolErrorMiddleware,
    createOutputTruncationMiddleware(outputTruncation),
    createLLMErrorHandlingMiddleware(llmErrorHandling),
    summarizationMiddleware,
    memoryMiddleware,
    clarificationMiddleware,
    cacheMiddleware,
    autonomyMiddleware,
    fileTrackMiddleware,
    createDeferredToolFilterMiddleware(deferredToolFilter),
    forcedVerificationMiddleware,
    frustrationMiddleware,
    createPreCompletionMiddleware(checklist),
    createTitleMiddleware(title),
    createSystemNotificationsMiddleware(notificationTracker),
    createNonInteractiveMiddleware(nonInteractive),
    createPlanEnforcementMiddleware(planEnforcement),
    createVerificationEnforcementMiddleware(verificationEnforcement),
    createAutoInstallMiddleware(autoInstall),
    createStaleDetectionMiddleware(staleDetection),
    createDoomLoopMiddleware(doomLoop),
    createLoopDetectionMiddleware(loopDetector),
    selfReflectionMiddleware,
  ];
  return {
    pipeline: new MiddlewarePipeline(layers),
    checklist,
    notificationTracker,
    nonInteractive,
    planEnforcement,
    verificationEnforcement,
    autoInstall,
    staleDetection,
    doomLoop,
    loopDetector,
    outputTruncation,
    toolPairValidator,
    guardrailProvider,
    danglingToolCall,
    llmErrorHandling,
    sandboxAudit,
    title,
    deferredToolFilter,
  };
}

/**
 * Get the default shared PreCompletionChecklistMiddleware instance.
 */
export function getDefaultChecklist(): PreCompletionChecklistMiddleware {
  return defaultChecklistInstance;
}

/**
 * Get the default shared SystemNotificationTracker instance.
 */
export function getDefaultNotificationTracker(): SystemNotificationTracker {
  return defaultNotificationTracker;
}

/**
 * Get the default shared NonInteractiveMiddleware instance.
 */
export function getDefaultNonInteractive(): NonInteractiveMiddleware {
  return defaultNonInteractiveInstance;
}

/**
 * Get the default shared PlanEnforcementMiddleware instance.
 */
export function getDefaultPlanEnforcement(): PlanEnforcementMiddleware {
  return defaultPlanEnforcementInstance;
}

/**
 * Get the default shared VerificationEnforcementMiddleware instance.
 */
export function getDefaultVerificationEnforcement(): VerificationEnforcementMiddleware {
  return defaultVerificationInstance;
}

/**
 * Get the default shared AutoInstallMiddleware instance.
 */
export function getDefaultAutoInstall(): AutoInstallMiddleware {
  return defaultAutoInstallInstance;
}

/**
 * Get the default shared StaleDetectionMiddleware instance.
 */
export function getDefaultStaleDetection(): StaleDetectionMiddleware {
  return defaultStaleDetectionInstance;
}

/**
 * Get the default shared DoomLoopMiddleware instance.
 */
export function getDefaultDoomLoop(): DoomLoopMiddleware {
  return defaultDoomLoopInstance;
}

/**
 * Get the default shared LoopDetector instance (Crush port, per-session).
 */
export function getDefaultLoopDetector(): LoopDetector {
  return defaultLoopDetectorInstance;
}

/**
 * Get the default shared OutputTruncationMiddleware instance.
 */
export function getDefaultOutputTruncation(): OutputTruncationMiddleware {
  return defaultOutputTruncationInstance;
}

/**
 * Get the default shared ToolPairValidatorMiddleware instance.
 */
export function getDefaultToolPairValidator(): ToolPairValidatorMiddleware {
  return defaultToolPairValidatorInstance;
}

// ── Lane 2 deer-flow port accessors ──────────────────────────

/** Get the default shared GuardrailProviderMiddleware instance (Lane 2). */
export function getDefaultGuardrailProvider(): GuardrailProviderMiddleware {
  return defaultGuardrailProviderInstance;
}

/** Get the default shared DanglingToolCallMiddleware instance (Lane 2). */
export function getDefaultDanglingToolCall(): DanglingToolCallMiddleware {
  return defaultDanglingToolCallInstance;
}

/** Get the default shared LLMErrorHandlingMiddleware instance (Lane 2). */
export function getDefaultLLMErrorHandling(): LLMErrorHandlingMiddleware {
  return defaultLLMErrorHandlingInstance;
}

/** Get the default shared SandboxAuditMiddleware instance (Lane 2). */
export function getDefaultSandboxAudit(): SandboxAuditMiddleware {
  return defaultSandboxAuditInstance;
}

/** Get the default shared TitleMiddleware instance (Lane 2). */
export function getDefaultTitle(): TitleMiddleware {
  return defaultTitleInstance;
}

/** Get the default shared DeferredToolFilterMiddleware instance (Lane 2). */
export function getDefaultDeferredToolFilter(): DeferredToolFilterMiddleware {
  return defaultDeferredToolFilterInstance;
}
