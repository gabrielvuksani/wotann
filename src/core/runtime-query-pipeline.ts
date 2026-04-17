/**
 * QueryPipeline — the full 12-step query execution pipeline,
 * extracted from WotannRuntime.query() for single-responsibility.
 */

import type {
  ProviderName,
  WotannQueryOptions,
  AgentMessage,
  ToolDefinition,
  SessionState,
} from "./types.js";
import { extractTrackedFilePath } from "./tool-path-extractor.js";
import type { StreamChunk } from "../providers/types.js";
import type { HookEngine } from "../hooks/engine.js";
import type { DoomLoopDetector } from "../hooks/doom-loop-detector.js";
import type { MiddlewarePipeline } from "../middleware/pipeline.js";
import type { IntelligenceAmplifier } from "../intelligence/amplifier.js";
import type { AccuracyBooster } from "../intelligence/accuracy-boost.js";
import type { ResponseValidator } from "../intelligence/response-validator.js";
import type { ResponseCache, CacheableQuery } from "../middleware/response-cache.js";
import type { ReasoningSandwich } from "../middleware/reasoning-sandwich.js";
import type { TTSREngine } from "../middleware/ttsr.js";
import type { CostTracker } from "../telemetry/cost-tracker.js";
import type { SecretScanner } from "../security/secret-scanner.js";
import type { MemoryStore } from "../memory/store.js";
import type { TFIDFIndex } from "../memory/semantic-search.js";
import type { TraceAnalyzer } from "../intelligence/trace-analyzer.js";
import type { ProactiveMemoryEngine } from "../memory/proactive-memory.js";
import type { EpisodicMemory } from "../memory/episodic-memory.js";
import type { ContextWindowIntelligence } from "../context/window-intelligence.js";
import type { PerFileEditTracker } from "../hooks/benchmark-engineering.js";
import type { SessionRecorder } from "../telemetry/session-replay.js";
import type { PluginLifecycle } from "../plugins/lifecycle.js";
import type { CrossSessionLearner } from "../learning/cross-session.js";
import type { FileFreezer } from "../security/file-freeze.js";
import type { PIIRedactor } from "../security/pii-redactor.js";
import type { SkillRegistry } from "../skills/loader.js";
import type { ModeCycler } from "./mode-cycling.js";
import type { QMDContextEngine } from "../memory/qmd-integration.js";
import type { VectorStore } from "../memory/vector-store.js";
import type { KnowledgeGraph } from "../memory/graph-rag.js";
import type { RepoModelPerformanceStore } from "../providers/model-performance.js";
import type { ProviderInfrastructure } from "../providers/registry.js";
import type { MiddlewareContext, AgentResult } from "../middleware/types.js";
import { StreamCheckpointStore } from "./stream-resume.js";
import { canBypass, executeBypass } from "../utils/wasm-bypass.js";
import { classifyTaskType } from "../intelligence/accuracy-boost.js";
import {
  buildOverrideDirective,
  buildPostQueryOverrideWarning,
} from "../intelligence/overrides.js";
import { formatQMDContext } from "../memory/qmd-integration.js";
import {
  buildSecurityResearchPrompt,
  getDefaultGuardrailsConfig,
} from "../security/guardrails-off.js";
import {
  buildContextBudgetPrompt,
  buildMemoryActivationPrompt,
  buildSkillActivationPrompt,
  compactConversationHistory,
} from "./runtime-intelligence.js";
import { addMessage, updateModel } from "./session.js";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────

/** Runtime configuration values the pipeline reads but never mutates. */
export interface QueryPipelineConfig {
  readonly workingDir: string;
  readonly enableWasmBypass?: boolean;
  readonly enableHooks?: boolean;
  readonly enableMiddleware?: boolean;
  readonly enableTTSR?: boolean;
  readonly enableMemory?: boolean;
  readonly enableSemanticSearch?: boolean;
}

/** All subsystem references the pipeline needs. Borrowed, never owned. */
export interface QueryPipelineContext {
  readonly hookEngine: HookEngine;
  readonly pipeline: MiddlewarePipeline;
  readonly amplifier: IntelligenceAmplifier;
  readonly accuracyBooster: AccuracyBooster;
  readonly responseValidator: ResponseValidator;
  readonly responseCache: ResponseCache;
  readonly reasoningSandwich: ReasoningSandwich;
  readonly ttsrEngine: TTSREngine;
  readonly doomLoop: DoomLoopDetector;
  readonly contextIntelligence: ContextWindowIntelligence;
  readonly costTracker: CostTracker;
  readonly secretScanner: SecretScanner;
  readonly memoryStore: MemoryStore | null;
  readonly semanticIndex: TFIDFIndex;
  readonly traceAnalyzer: TraceAnalyzer;
  readonly proactiveMemory: ProactiveMemoryEngine;
  readonly episodicMemory: EpisodicMemory;
  readonly editTracker: PerFileEditTracker;
  readonly sessionRecorder: SessionRecorder;
  readonly pluginLifecycle: PluginLifecycle;
  readonly crossSessionLearner: CrossSessionLearner;
  readonly fileFreezer: FileFreezer;
  readonly piiRedactor: PIIRedactor;
  readonly skillRegistry: SkillRegistry;
  readonly modeCycler: ModeCycler;
  readonly qmdContext: QMDContextEngine;
  readonly vectorStore: VectorStore;
  readonly knowledgeGraph: KnowledgeGraph;
  readonly modelPerformanceStore: RepoModelPerformanceStore;
  readonly infra: ProviderInfrastructure;
}

/** Mutable state snapshot passed in; returned as QueryPipelineStateUpdate. */
export interface QueryPipelineMutableState {
  readonly session: SessionState;
  readonly systemPrompt: string;
  readonly recentErrors: readonly string[];
  readonly isFirstTurn: boolean;
  readonly currentEpisodeId: string | undefined;
}

/** State updates the runtime applies after the generator is drained. */
export interface QueryPipelineStateUpdate {
  readonly session: SessionState;
  readonly recentErrors: readonly string[];
  readonly isFirstTurn: boolean;
  readonly currentEpisodeId: string | undefined;
}

/** Callbacks into the runtime, avoiding circular dependency. */
export interface QueryPipelineCallbacks {
  readonly resolveSecurityResearchProvider: () => ProviderName | undefined;
  readonly refreshContextTelemetry: (input: {
    readonly conversationContext: readonly AgentMessage[];
    readonly systemParts: readonly string[];
    readonly tools?: readonly ToolDefinition[];
  }) => void;
  readonly captureLearningFeedback: (message: string) => void;
}

// ── Helpers ────────────────────────────────────────────────

// extractTrackedFilePath moved to src/core/tool-path-extractor.ts —
// shared with runtime.ts to prevent the two copies from drifting.

// ── QueryPipeline ──────────────────────────────────────────

/** Full 12-step query execution pipeline, delegated from WotannRuntime. */
export class QueryPipeline {
  constructor(
    private readonly ctx: QueryPipelineContext,
    private readonly config: QueryPipelineConfig,
  ) {}

  /** Execute the full pipeline. Yields StreamChunks; returns state update. */
  async *execute(
    options: WotannQueryOptions,
    state: QueryPipelineMutableState,
    callbacks: QueryPipelineCallbacks,
  ): AsyncGenerator<StreamChunk, QueryPipelineStateUpdate> {
    const stateSnapshot = (): QueryPipelineStateUpdate => ({
      session,
      recentErrors,
      isFirstTurn,
      currentEpisodeId,
    });

    // Working copies of mutable state — will be returned at the end
    let session = addMessage(state.session, {
      role: "user",
      content: options.prompt,
      provider: options.provider ?? state.session.provider,
      model: options.model ?? state.session.model,
    });
    let recentErrors = [...state.recentErrors];
    let isFirstTurn = state.isFirstTurn;
    let currentEpisodeId = state.currentEpisodeId;

    this.ctx.memoryStore?.captureEvent("user_prompt", options.prompt, "query", session.id);
    callbacks.captureLearningFeedback(options.prompt);
    const streamCheckpointStore = new StreamCheckpointStore(
      join(this.config.workingDir, ".wotann", "streams"),
    );
    const streamCheckpoint = streamCheckpointStore.start(options, state.session);
    let streamCompleted = false;
    let streamInterruptedReason: string | undefined;
    try {
      // ── Step 1: WASM Bypass ──
      if (this.config.enableWasmBypass !== false && canBypass(options.prompt)) {
        const result = executeBypass(options.prompt, options.prompt);
        if (result.output) {
          streamCheckpointStore.appendText(streamCheckpoint.id, result.output, "anthropic");
          yield { type: "text", content: result.output ?? "", provider: "anthropic" };
          yield { type: "done", content: "", provider: "anthropic", tokensUsed: 0 };
          streamCheckpointStore.markCompleted(streamCheckpoint.id);
          streamCompleted = true;
          return stateSnapshot();
        }
      }

      // ── Step 2: Pre-query hooks ──
      if (this.config.enableHooks !== false) {
        const hookResult = await this.ctx.hookEngine.fire({
          event: "UserPromptSubmit",
          content: options.prompt,
          sessionId: session.id,
        });
        if (hookResult.action === "block") {
          streamInterruptedReason = `Blocked by hook: ${hookResult.message ?? ""}`;
          yield { type: "error", content: streamInterruptedReason, provider: "anthropic" };
          return stateSnapshot();
        }
      }

      // ── Step 3: Middleware before ──
      let middlewareCtx: MiddlewareContext | undefined;
      if (this.config.enableMiddleware !== false) {
        middlewareCtx = await this.ctx.pipeline.processBefore({
          sessionId: session.id,
          userMessage: options.prompt,
          workingDir: this.config.workingDir,
          recentHistory: [...session.messages],
        });
      }

      this.ctx.ttsrEngine.reset();
      // ── Step 4: DoomLoop check ──
      const doomResult = this.ctx.doomLoop.record("query", { prompt: options.prompt });
      if (doomResult.detected) {
        streamInterruptedReason = `DoomLoop detected (${doomResult.type ?? "repeated"}): Try a different approach.`;
        yield {
          type: "error",
          content: streamInterruptedReason,
          provider: "anthropic",
        };
        return stateSnapshot();
      }

      // ── Step 5: Intelligence amplification ──
      const amplified = this.ctx.amplifier.amplify(options.prompt, {
        workingDir: this.config.workingDir,
        recentErrors: [...recentErrors],
        strictTypes: true,
      });

      // ── Step 5.1: Accuracy boost ──
      const boosted = this.ctx.accuracyBooster.boost(amplified.amplified, {
        taskType: classifyTaskType(options.prompt),
        previousErrors: [...recentErrors],
        previousAttempts: 0,
        availableFiles: [],
        recentToolResults: this.ctx.traceAnalyzer.getRecentEntries(3).map((e) => e.content),
        language: "typescript",
      });
      // ── Step 5.5: Proactive memory & episodic recording ──
      const proactiveHints = this.ctx.proactiveMemory.processEvent({
        type: "task-started",
        data: { task: options.prompt },
      });

      const proactiveContext =
        proactiveHints.length > 0
          ? "\n\n[Proactive Context]\n" +
            proactiveHints.map((h) => `- ${h.content} (source: ${h.source})`).join("\n")
          : "";

      if (!currentEpisodeId) {
        currentEpisodeId = this.ctx.episodicMemory.startEpisode(
          options.prompt,
          options.provider ?? session.provider,
          options.model ?? session.model,
        );
      }
      this.ctx.episodicMemory.recordEvent("plan", options.prompt.slice(0, 200));

      // ── Step 6: Reasoning sandwich (asymmetric budget) ──
      const reasoning = this.ctx.reasoningSandwich.getAdjustment(options.prompt, isFirstTurn);
      isFirstTurn = false;
      this.ctx.contextIntelligence.adaptToProvider(
        options.provider ?? session.provider,
        options.model ?? session.model,
      );

      let conversationContext = options.context ? [...options.context] : [...session.messages];

      const skillActivation = buildSkillActivationPrompt(
        this.ctx.skillRegistry,
        options.prompt,
        this.config.workingDir,
      );

      const currentFile = skillActivation.referencedPaths[0];
      const memoryActivation = buildMemoryActivationPrompt(
        this.ctx.memoryStore,
        session.id,
        options.prompt,
        currentFile,
      );

      callbacks.refreshContextTelemetry({
        conversationContext,
        systemParts: [
          options.systemPrompt ?? state.systemPrompt,
          memoryActivation.prompt,
          skillActivation.prompt,
        ],
        tools: options.tools,
      });

      // ── Step 6.1: Context compaction (if needed) ──
      const compactionPlan = this.ctx.contextIntelligence.shouldCompact();
      if (compactionPlan.needed && !options.context) {
        const compacted = compactConversationHistory(
          session.messages,
          compactionPlan.stage ?? "old-messages",
        );
        if (compacted) {
          await this.ctx.hookEngine.fire({
            event: "PreCompact",
            content: `${compactionPlan.stage}:${compacted.removedMessages}`,
            sessionId: session.id,
          });

          session = {
            ...session,
            messages: compacted.messages,
          };
          conversationContext = [...compacted.messages];
          this.ctx.contextIntelligence.compact(compactionPlan.stage ?? "old-messages");
          this.ctx.memoryStore?.setWorkingMemory(
            session.id,
            `compaction-${Date.now()}`,
            compacted.summary,
            0.8,
          );
          this.ctx.memoryStore?.captureEvent(
            "context_compaction",
            compacted.summary,
            compactionPlan.stage ?? undefined,
            session.id,
          );

          await this.ctx.hookEngine.fire({
            event: "PostCompact",
            content: `${compactionPlan.stage}:${compacted.removedMessages}`,
            sessionId: session.id,
          });
        }
      }

      const overrideDirective = buildOverrideDirective(options.prompt, conversationContext);
      const qmdPrompt = formatQMDContext(
        await this.ctx.qmdContext.getRelevantContext(options.prompt, 6),
      );
      callbacks.refreshContextTelemetry({
        conversationContext,
        systemParts: [
          options.systemPrompt ?? state.systemPrompt,
          memoryActivation.prompt,
          skillActivation.prompt,
          qmdPrompt,
        ],
        tools: options.tools,
      });
      const budgetPrompt = buildContextBudgetPrompt(this.ctx.contextIntelligence);
      const activeReminders = this.ctx.contextIntelligence.getActiveReminders();
      const guardrailsOff = this.ctx.modeCycler.shouldClearSafetyFlags();
      const providerForSecurityMode =
        options.provider ?? callbacks.resolveSecurityResearchProvider();
      const securityPrompt = guardrailsOff
        ? buildSecurityResearchPrompt(
            providerForSecurityMode ?? session.provider,
            getDefaultGuardrailsConfig(),
          )
        : "";

      const fullSystemPrompt = [
        securityPrompt,
        options.systemPrompt ?? state.systemPrompt,
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

      // ── Step 6.5: PII redaction ──
      const piiResult = this.ctx.piiRedactor.redact(amplified.amplified);
      const sanitizedPrompt =
        piiResult.totalRedacted > 0 ? piiResult.redactedText : amplified.amplified;

      // ── Step 7: Query with amplified prompt ──
      const queryOptions: WotannQueryOptions = {
        ...options,
        provider: providerForSecurityMode ?? options.provider,
        context: conversationContext,
        prompt: sanitizedPrompt,
        systemPrompt: fullSystemPrompt,
      };

      // ── Step 7.1: Response cache fast-path ──
      const cacheQuery: CacheableQuery = {
        model: queryOptions.model ?? session.model,
        provider: queryOptions.provider ?? session.provider,
        systemPrompt: queryOptions.systemPrompt,
        messages: conversationContext.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: 0,
        stream: false,
      };
      const cached = this.ctx.responseCache.get(cacheQuery);
      if (cached) {
        const cachedProvider = (cached.provider ?? session.provider) as ProviderName;
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
        return stateSnapshot();
      }

      // ── Step 7.2: Provider query with TTSR retry loop ──
      let totalTokens = 0;
      let contentParts: string[] = [];
      let responseProvider = session.provider;
      let responseModel = session.model;
      let blockedByEditTracker = false;
      let exhaustedTTSRRetries = false;
      const retrySystemMessages: string[] = [];
      const maxTTSRRetries = 2;
      this.ctx.traceAnalyzer.record({
        timestamp: Date.now(),
        type: "tool_call",
        toolName: "query",
        toolArgs: { prompt: options.prompt.slice(0, 200) },
        content: "",
        tokensUsed: 0,
        durationMs: 0,
      });

      const queryStart = Date.now();

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

        for await (const chunk of this.ctx.infra.bridge.query(attemptQueryOptions)) {
          if (chunk.provider) responseProvider = chunk.provider;
          if (chunk.model) responseModel = chunk.model;

          if (chunk.type === "tool_use") {
            const toolName = chunk.toolName?.toLowerCase() ?? "";

            // PreToolUse hook firing (mirrors runtime.ts's main query loop).
            // This sibling pipeline is used when the runtime opts into the
            // extracted query path; keep PreToolUse wired here too so
            // hooks registered for PreToolUse actually run regardless of
            // which execution path the runtime picks.
            if (this.config.enableHooks !== false) {
              const preResult = await this.ctx.hookEngine.fire({
                event: "PreToolUse",
                toolName: chunk.toolName,
                toolInput: chunk.toolInput as Record<string, unknown> | undefined,
                filePath:
                  extractTrackedFilePath(chunk.toolInput as Record<string, unknown> | undefined) ??
                  undefined,
                content:
                  typeof chunk.toolInput === "object"
                    ? JSON.stringify(chunk.toolInput ?? {})
                    : String(chunk.toolInput ?? ""),
                sessionId: session.id,
                timestamp: Date.now(),
              });
              if (preResult.action === "block") {
                const hookLabel = preResult.hookName ?? "PreToolUse";
                yield {
                  type: "error",
                  content: `[Hook ${hookLabel}] ${preResult.message ?? "Tool call blocked"}`,
                  provider: chunk.provider ?? responseProvider,
                  model: chunk.model ?? responseModel,
                };
                break;
              }
            }

            if (toolName === "write" || toolName === "edit") {
              const filePath =
                extractTrackedFilePath(chunk.toolInput) ?? chunk.toolName ?? "unknown";

              // File freezer check: block edits to frozen files
              const freezeCheck = this.ctx.fileFreezer.check(filePath);
              if (freezeCheck.frozen) {
                yield {
                  type: "error",
                  content: `[FileFreezer] ${filePath} is frozen: ${freezeCheck.rule?.reason ?? "session lock"}. Edit blocked.`,
                  provider: chunk.provider ?? responseProvider,
                  model: chunk.model ?? responseModel,
                };
                break;
              }

              const result = this.ctx.editTracker.recordEdit(filePath);

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
            }
          }

          if (blockedByEditTracker) {
            break;
          }

          // TTSR: abort the stream and retry with corrected system context.
          if (chunk.type === "text" && this.config.enableTTSR !== false) {
            const ttsrResult = this.ctx.ttsrEngine.processChunk(chunk.content);
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
        this.ctx.ttsrEngine.reset();
      }

      if (blockedByEditTracker || exhaustedTTSRRetries) {
        return stateSnapshot();
      }

      // ── Step 8: Post-query processing ──
      const fullContent = contentParts.join("");

      // Secret scanner: check response for leaked secrets/PII
      const secretScanResult = this.ctx.secretScanner.scanText(fullContent);
      if (!secretScanResult.clean) {
        yield {
          type: "error",
          content: `[SecretScanner] Potential secret detected in response: ${secretScanResult.findings.map((f) => f.pattern).join(", ")}. Review before sharing.`,
          provider: responseProvider,
          model: responseModel,
        };
      }

      const validation = this.ctx.responseValidator.validate(fullContent, options.prompt, {
        previousResponses: session.messages
          .filter((m) => m.role === "assistant")
          .map((m) => m.content)
          .slice(-3),
        availableContext: state.systemPrompt,
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

      this.ctx.sessionRecorder.recordResponse(fullContent.slice(0, 2000), totalTokens, 0);

      await this.ctx.pluginLifecycle.fire(
        "post_llm_call",
        {
          content: fullContent,
          provider: responseProvider,
          model: responseModel,
        },
        {
          sessionId: session.id,
          provider: responseProvider,
          model: responseModel,
          mode: this.ctx.modeCycler.getModeName(),
          timestamp: Date.now(),
        },
      );

      this.ctx.crossSessionLearner.recordAction({
        type: "llm_response",
        output: fullContent.slice(0, 500),
        success: true,
      });

      session = updateModel(session, responseProvider, responseModel);
      this.ctx.contextIntelligence.adaptToProvider(responseProvider, responseModel);
      const truncationWarning = buildPostQueryOverrideWarning(options.prompt, fullContent);

      // ── Step 8.5: Middleware after ──
      if (this.config.enableMiddleware !== false && middlewareCtx && !blockedByEditTracker) {
        const agentResult: AgentResult = {
          content: fullContent,
          success: !fullContent.toLowerCase().startsWith("error"),
          tokensUsed: totalTokens,
        };
        await this.ctx.pipeline.processAfter(middlewareCtx, agentResult);
      }
      const queryDuration = Date.now() - queryStart;
      callbacks.refreshContextTelemetry({
        conversationContext: [
          ...session.messages,
          {
            role: "assistant",
            content: fullContent,
            provider: responseProvider,
            model: responseModel,
            tokensUsed: totalTokens,
          },
        ],
        systemParts: [fullSystemPrompt],
        tools: options.tools,
      });

      this.ctx.traceAnalyzer.record({
        timestamp: Date.now(),
        type: "text",
        content: fullContent.slice(0, 500),
        tokensUsed: totalTokens,
        durationMs: queryDuration,
      });

      const hasErrorIndicators =
        /\b(error|exception|traceback|stack trace|failed|failure|cannot|unable to)\b/i.test(
          fullContent,
        ) &&
        (/at .+:\d+:\d+/.test(fullContent) ||
          /Error:/.test(fullContent) ||
          /exit code [1-9]/.test(fullContent.toLowerCase()) ||
          /FAIL|FAILED|ERR!/i.test(fullContent));
      if (hasErrorIndicators) {
        recentErrors = [...recentErrors, fullContent.slice(0, 300)];
        if (recentErrors.length > 5) {
          recentErrors = recentErrors.slice(recentErrors.length - 5);
        }

        this.ctx.proactiveMemory.processEvent({
          type: "error-encountered",
          data: { error: fullContent.slice(0, 200) },
        });

        this.ctx.episodicMemory.recordEvent("error", fullContent.slice(0, 200));
      }
      this.ctx.memoryStore?.captureEvent("assistant_response", fullContent, "query", session.id);
      if (fullContent.includes("Write") || fullContent.includes("Edit")) {
        this.ctx.reasoningSandwich.recordCodeWrite();
      }

      if (this.config.enableHooks !== false) {
        await this.ctx.hookEngine.fire({
          event: "PostToolUse",
          content: fullContent,
          sessionId: session.id,
        });
      }

      // ── Step 9: Memory capture ──
      if (this.ctx.memoryStore && fullContent.length > 50) {
        this.ctx.memoryStore.memoryInsert(
          "project",
          `response-${Date.now()}`,
          fullContent.slice(0, 500),
        );

        if (this.config.enableSemanticSearch !== false) {
          this.ctx.semanticIndex.addDocument(`response-${Date.now()}`, fullContent.slice(0, 1000));
        }

        this.ctx.vectorStore.addDocument(`response-${Date.now()}`, fullContent.slice(0, 1000));
      }

      if (fullContent.length > 100) {
        this.ctx.knowledgeGraph.addDocument(`response-${Date.now()}`, fullContent.slice(0, 2000));
      }

      // ── Step 10: Update session and cost ──
      const message: AgentMessage = {
        role: "assistant",
        content: fullContent,
        tokensUsed: totalTokens,
        provider: responseProvider,
        model: responseModel,
      };
      const costEntry = this.ctx.costTracker.record(
        responseProvider,
        responseModel,
        totalTokens,
        0,
      );
      this.ctx.infra.router?.recordCost(costEntry.cost);
      this.ctx.infra.router?.recordRepoOutcome({
        provider: responseProvider,
        model: responseModel,
        success: truncationWarning === null && !fullContent.toLowerCase().startsWith("error"),
        durationMs: queryDuration,
        tokensUsed: totalTokens,
        costUsd: costEntry.cost,
      });
      this.ctx.modelPerformanceStore.record({
        provider: responseProvider,
        model: responseModel,
        success: truncationWarning === null && !fullContent.toLowerCase().startsWith("error"),
        durationMs: queryDuration,
        tokensUsed: totalTokens,
        costUsd: costEntry.cost,
      });
      session = addMessage(session, {
        ...message,
        cost: costEntry.cost,
      });

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

      return stateSnapshot();
    } finally {
      if (!streamCompleted) {
        streamCheckpointStore.markInterrupted(streamCheckpoint.id, streamInterruptedReason);
      }
    }
  }
}
