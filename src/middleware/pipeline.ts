/**
 * Middleware pipeline: executes all 25 layers in order.
 * Before hooks run in forward order (1→25), after hooks in reverse (25→1).
 *
 * Layers 1-18: Original pipeline (intent, thread, uploads, sandbox, etc.)
 * Layers 19-24: TerminalBench accuracy optimizations (Sprint A + B)
 * Layer 25: Self-reflection (post-response quality validation)
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
  subagentLimitMiddleware,
  clarificationMiddleware,
  cacheMiddleware,
  autonomyMiddleware,
  lspMiddleware,
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
import {
  NonInteractiveMiddleware,
  createNonInteractiveMiddleware,
} from "./non-interactive.js";
import {
  PlanEnforcementMiddleware,
  createPlanEnforcementMiddleware,
} from "./plan-enforcement.js";
import {
  VerificationEnforcementMiddleware,
  createVerificationEnforcementMiddleware,
} from "./verification-enforcement.js";
import {
  AutoInstallMiddleware,
  createAutoInstallMiddleware,
} from "./auto-install.js";
import {
  StaleDetectionMiddleware,
  createStaleDetectionMiddleware,
} from "./stale-detection.js";
import {
  DoomLoopMiddleware,
  createDoomLoopMiddleware,
} from "./doom-loop.js";
import {
  OutputTruncationMiddleware,
  createOutputTruncationMiddleware,
} from "./output-truncation.js";
import {
  ToolPairValidatorMiddleware,
  createToolPairValidatorMiddleware,
} from "./tool-pair-validator.js";

// ── Shared instances for new middleware ────────────────────────

const defaultChecklistInstance = new PreCompletionChecklistMiddleware();
const defaultNotificationTracker = new SystemNotificationTracker();
const defaultNonInteractiveInstance = new NonInteractiveMiddleware();
const defaultPlanEnforcementInstance = new PlanEnforcementMiddleware();
const defaultVerificationInstance = new VerificationEnforcementMiddleware(defaultChecklistInstance);
const defaultAutoInstallInstance = new AutoInstallMiddleware();
const defaultStaleDetectionInstance = new StaleDetectionMiddleware();
const defaultDoomLoopInstance = new DoomLoopMiddleware();
const defaultOutputTruncationInstance = new OutputTruncationMiddleware();
const defaultToolPairValidatorInstance = new ToolPairValidatorMiddleware();

// ── Pipeline Definition (24 layers in order) ────────────────

const PIPELINE: readonly Middleware[] = [
  createToolPairValidatorMiddleware(defaultToolPairValidatorInstance), // 0. Tool use/result pair validation
  intentGateMiddleware,                                           // 1. Intent analysis
  threadDataMiddleware,                                           // 2. Thread isolation
  uploadsMiddleware,                                              // 3. File uploads
  sandboxMiddleware,                                              // 4. Sandbox env
  guardrailMiddleware,                                            // 5. Pre-execution auth
  toolErrorMiddleware,                                            // 6. Error standardization
  createOutputTruncationMiddleware(defaultOutputTruncationInstance), // 6.5. Output truncation
  summarizationMiddleware,                                        // 7. Token management
  memoryMiddleware,                                               // 8. Memory extraction
  subagentLimitMiddleware,                                        // 9. Subagent count (max 3)
  clarificationMiddleware,                                        // 10. User clarification
  cacheMiddleware,                                                // 11. Cache tracking
  autonomyMiddleware,                                             // 12. Risk classification
  lspMiddleware,                                                  // 13. LSP context
  fileTrackMiddleware,                                            // 14. File tracking
  forcedVerificationMiddleware,                                   // 15. Auto-verify writes
  frustrationMiddleware,                                          // 16. Frustration detection
  createPreCompletionMiddleware(defaultChecklistInstance),         // 17. Pre-completion gate
  createSystemNotificationsMiddleware(defaultNotificationTracker), // 18. System notifications
  // ── TerminalBench Accuracy Optimizations ──────────────────
  createNonInteractiveMiddleware(defaultNonInteractiveInstance),   // 19. Non-interactive mode
  createPlanEnforcementMiddleware(defaultPlanEnforcementInstance), // 20. Mandatory planning gate
  createVerificationEnforcementMiddleware(defaultVerificationInstance), // 21. Verification enforcement
  createAutoInstallMiddleware(defaultAutoInstallInstance),         // 22. Auto-install missing deps
  createStaleDetectionMiddleware(defaultStaleDetectionInstance),   // 23. Stale-read detection
  createDoomLoopMiddleware(defaultDoomLoopInstance),               // 24. Doom loop detection
  selfReflectionMiddleware,                                        // 25. Self-reflection (post-response validation)
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
  readonly outputTruncation: OutputTruncationMiddleware;
  readonly toolPairValidator: ToolPairValidatorMiddleware;
} {
  const nonInteractive = new NonInteractiveMiddleware();
  const planEnforcement = new PlanEnforcementMiddleware();
  const verificationEnforcement = new VerificationEnforcementMiddleware(checklist);
  const autoInstall = new AutoInstallMiddleware();
  const staleDetection = new StaleDetectionMiddleware();
  const doomLoop = new DoomLoopMiddleware();
  const outputTruncation = new OutputTruncationMiddleware();
  const toolPairValidator = new ToolPairValidatorMiddleware();

  const layers: readonly Middleware[] = [
    createToolPairValidatorMiddleware(toolPairValidator),
    intentGateMiddleware,
    threadDataMiddleware,
    uploadsMiddleware,
    sandboxMiddleware,
    guardrailMiddleware,
    toolErrorMiddleware,
    createOutputTruncationMiddleware(outputTruncation),
    summarizationMiddleware,
    memoryMiddleware,
    subagentLimitMiddleware,
    clarificationMiddleware,
    cacheMiddleware,
    autonomyMiddleware,
    lspMiddleware,
    fileTrackMiddleware,
    forcedVerificationMiddleware,
    frustrationMiddleware,
    createPreCompletionMiddleware(checklist),
    createSystemNotificationsMiddleware(notificationTracker),
    createNonInteractiveMiddleware(nonInteractive),
    createPlanEnforcementMiddleware(planEnforcement),
    createVerificationEnforcementMiddleware(verificationEnforcement),
    createAutoInstallMiddleware(autoInstall),
    createStaleDetectionMiddleware(staleDetection),
    createDoomLoopMiddleware(doomLoop),
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
    outputTruncation,
    toolPairValidator,
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
