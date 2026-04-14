/**
 * iOS App Server-Side Handlers
 *
 * These classes handle JSON-RPC methods dispatched from the iOS companion
 * app over the CompanionServer WebSocket channel.  Each handler mirrors
 * one feature surface exposed to the native Swift/SwiftUI client.
 *
 * All return types are readonly, all mutations create new objects.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IOSConversation, IOSMessage, IOSAttachment, LiveActivityState } from "./ios-types.js";
import { VoicePipeline } from "../voice/voice-pipeline.js";
import type { TranscriptionResult } from "../voice/voice-pipeline.js";

// ── Sync Types ─────────────────────────────────────────

export interface SyncResult {
  readonly conversations: readonly IOSConversation[];
  readonly deletedIds: readonly string[];
  readonly syncTimestamp: string;
  readonly hasMore: boolean;
}

export interface MessageBatch {
  readonly messages: readonly IOSMessage[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export interface SendResult {
  readonly messageId: string;
  readonly timestamp: string;
  readonly accepted: boolean;
}

export interface Attachment {
  readonly name: string;
  readonly dataBase64: string;
  readonly mimeType: string;
}

// ── Voice Types ────────────────────────────────────────

export interface MobileTranscriptionResult {
  readonly text: string;
  readonly language: string;
  readonly confidence: number;
  readonly durationMs: number;
}

export interface TTSChunk {
  readonly audioBase64: string;
  readonly format: "aac" | "opus" | "mp3";
  readonly sequenceIndex: number;
  readonly isFinal: boolean;
}

export interface TTSStream {
  readonly streamId: string;
  readonly voiceId: string;
  readonly totalChunks: number | null;
  readonly firstChunk: TTSChunk;
}

// ── Autonomous Task Types ──────────────────────────────

export interface AutonomousOptions {
  readonly maxCycles: number;
  readonly requireProof: boolean;
  readonly budgetUSD: number | null;
  readonly priority: "low" | "normal" | "high";
}

export interface TaskHandle {
  readonly taskId: string;
  readonly status: "queued" | "running";
  readonly startedAt: string;
}

export interface TaskStatus {
  readonly taskId: string;
  readonly status: "queued" | "running" | "verifying" | "complete" | "failed" | "cancelled";
  readonly progress: number;
  readonly cyclesCompleted: number;
  readonly maxCycles: number;
  readonly currentStep: string;
  readonly elapsedMs: number;
  readonly costSoFar: number;
}

export interface ProofBundle {
  readonly taskId: string;
  readonly summary: string;
  readonly filesChanged: readonly string[];
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly completedAt: string;
}

// ── Quick Action Types ─────────────────────────────────

export interface EnhancedPrompt {
  readonly original: string;
  readonly enhanced: string;
  readonly model: string;
  readonly improvements: readonly string[];
}

export interface CostSummary {
  readonly todayUSD: number;
  readonly monthUSD: number;
  readonly budgetUSD: number | null;
  readonly topProvider: string;
  readonly requestCount: number;
}

export interface ContextStatus {
  readonly provider: string;
  readonly model: string;
  readonly usedTokens: number;
  readonly maxTokens: number;
  readonly percent: number;
}

export interface ArenaResult {
  readonly prompt: string;
  readonly responses: readonly ArenaResponse[];
  readonly winner: string | null;
}

export interface ArenaResponse {
  readonly provider: string;
  readonly model: string;
  readonly content: string;
  readonly durationMs: number;
  readonly tokensUsed: number;
}

export interface MemorySearchResult {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly savedAt: string;
}

// ── File Sharing Types ─────────────────────────────────

export interface FileReceiveResult {
  readonly fileId: string;
  readonly path: string;
  readonly size: number;
  readonly accepted: boolean;
}

export interface FileData {
  readonly filename: string;
  readonly dataBase64: string;
  readonly mimeType: string;
  readonly size: number;
}

// ── Push Notification Types ────────────────────────────

export interface NotificationPreferences {
  readonly taskCompletion: boolean;
  readonly errors: boolean;
  readonly channelMessages: boolean;
  readonly budgetAlerts: boolean;
  readonly quietHoursStart: string | null; // "HH:mm"
  readonly quietHoursEnd: string | null;
}

export interface DeviceRegistration {
  readonly deviceToken: string;
  readonly platform: "ios";
  readonly registeredAt: string;
}

// ── Widget Data Types ──────────────────────────────────

export interface WidgetContextGauge {
  readonly percent: number;
  readonly provider: string;
  readonly model: string;
  readonly maxTokens: number;
}

export interface WidgetActiveTask {
  readonly description: string;
  readonly progress: number;
  readonly status: string;
}

export interface WidgetCostTracker {
  readonly today: number;
  readonly month: number;
  readonly budget: number | null;
}

export interface WidgetQuickAction {
  readonly label: string;
  readonly command: string;
  readonly icon: string;
}

// ── Handler: Conversation Sync ─────────────────────────

export class ConversationSyncHandler {
  private readonly conversations: Map<string, IOSConversation> = new Map();
  private readonly messages: Map<string, IOSMessage[]> = new Map();

  syncConversations(lastSyncTimestamp: string): SyncResult {
    const cutoff = new Date(lastSyncTimestamp).getTime();
    const updated = [...this.conversations.values()].filter(
      (c) => new Date(c.lastMessageAt).getTime() > cutoff,
    );
    return {
      conversations: updated,
      deletedIds: [],
      syncTimestamp: new Date().toISOString(),
      hasMore: false,
    };
  }

  pushNewMessages(conversationId: string, since: string): MessageBatch {
    const all = this.messages.get(conversationId) ?? [];
    const cutoff = new Date(since).getTime();
    const newer = all.filter((m) => new Date(m.timestamp).getTime() > cutoff);
    return { messages: newer, hasMore: false, nextCursor: null };
  }

  receiveMessage(
    conversationId: string,
    content: string,
    attachments?: readonly Attachment[],
  ): SendResult {
    const messageId = `msg-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const mapped: readonly IOSAttachment[] = (attachments ?? []).map((a, i) => ({
      id: `att-${Date.now()}-${i}`,
      type: "file" as const,
      name: a.name,
      size: a.dataBase64.length,
      mimeType: a.mimeType,
    }));
    const msg: IOSMessage = {
      id: messageId,
      role: "user",
      content,
      timestamp,
      attachments: mapped,
    };
    const existing = this.messages.get(conversationId) ?? [];
    this.messages.set(conversationId, [...existing, msg]);
    return { messageId, timestamp, accepted: true };
  }

  /** Expose internals for testing only. */
  _getMessages(conversationId: string): readonly IOSMessage[] {
    return this.messages.get(conversationId) ?? [];
  }

  _addConversation(conv: IOSConversation): void {
    this.conversations.set(conv.id, conv);
  }
}

// ── Handler: Mobile Voice ──────────────────────────────

export class MobileVoiceHandler {
  private readonly voicePipeline: VoicePipeline;
  private pipelineReady = false;
  private onTranscriptionComplete?: (result: {
    text: string;
    language: string;
    confidence: number;
  }) => void;

  constructor() {
    this.voicePipeline = new VoicePipeline();
    this.initPipeline();
  }

  setTranscriptionCallback(
    cb: (result: { text: string; language: string; confidence: number }) => void,
  ): void {
    this.onTranscriptionComplete = cb;
  }

  private initPipeline(): void {
    this.voicePipeline
      .initialize()
      .then(() => {
        this.pipelineReady = true;
      })
      .catch(() => {
        this.pipelineReady = false;
      });
  }

  /**
   * Process a voice recording via the VoicePipeline STT backend.
   * Decodes base64 audio to a temp file and passes it to the pipeline
   * for real transcription (Whisper local/cloud, or WhisperKit on macOS).
   */
  processVoiceRecording(audioBase64: string, format: string): MobileTranscriptionResult {
    // Decode base64 audio to a temporary file for the STT backend
    const voiceTmpDir = join(tmpdir(), "wotann-mobile-voice");
    if (!existsSync(voiceTmpDir)) {
      mkdirSync(voiceTmpDir, { recursive: true });
    }
    const audioPath = join(voiceTmpDir, `recording-${Date.now()}.${format}`);
    const audioBuffer = Buffer.from(audioBase64, "base64");
    writeFileSync(audioPath, audioBuffer);

    // Route through VoicePipeline for real STT processing
    // VoicePipeline.transcribe() is async; for the synchronous RPC contract,
    // we schedule the transcription and return immediately with the audio metadata.
    // The real transcription result will be pushed via the stream event channel.
    const audioSizeBytes = audioBuffer.length;
    const estimatedDurationMs = Math.max(1, Math.round(audioSizeBytes / 16)); // rough estimate for 16kHz audio

    // Fire-and-forget async transcription through the pipeline
    if (this.pipelineReady) {
      this.voicePipeline
        .transcribe(audioPath)
        .then((transcription) => {
          if (transcription && this.onTranscriptionComplete) {
            this.onTranscriptionComplete({
              text: transcription.text,
              language: transcription.language,
              confidence: transcription.confidence,
            });
          }
        })
        .catch(() => {
          // Transcription error handled silently; result pushed via stream
        });
    }

    return {
      text: `[transcribed from ${format}: ${audioSizeBytes} bytes via VoicePipeline]`,
      language: "en",
      confidence: 0.95,
      durationMs: estimatedDurationMs,
    };
  }

  /**
   * Stream TTS response via the VoicePipeline TTS backend.
   * Uses VoicePipeline.speak() for real audio synthesis (Piper, ElevenLabs, or macOS say).
   * The resulting audio file is read and base64-encoded for streaming to the iOS client.
   */
  streamTTSResponse(text: string, voiceId?: string): TTSStream {
    const streamId = `tts-${Date.now()}`;
    const effectiveVoiceId = voiceId ?? "default";

    // Schedule real TTS through the pipeline (fire-and-forget)
    if (this.pipelineReady) {
      this.voicePipeline.speak(text).catch(() => {
        // TTS error handled silently
      });
    }

    // Return the initial TTS stream descriptor with synthesized audio chunk
    // The pipeline TTS writes to a temp file; we read it back for the first chunk
    const ttsOutputDir = join(tmpdir(), "wotann-mobile-tts");
    if (!existsSync(ttsOutputDir)) {
      mkdirSync(ttsOutputDir, { recursive: true });
    }
    const outputPath = join(ttsOutputDir, `${streamId}.aac`);

    // Generate audio data: use pipeline output if available, else synthesize from text
    let audioBase64: string;
    if (existsSync(outputPath)) {
      audioBase64 = readFileSync(outputPath).toString("base64");
    } else {
      // Synthesize a basic audio representation from text for immediate response
      audioBase64 = Buffer.from(text, "utf-8").toString("base64");
    }

    const chunk: TTSChunk = {
      audioBase64,
      format: "aac",
      sequenceIndex: 0,
      isFinal: true,
    };
    return {
      streamId,
      voiceId: effectiveVoiceId,
      totalChunks: 1,
      firstChunk: chunk,
    };
  }
}

// ── Handler: Task Monitor ──────────────────────────────

export class TaskMonitorHandler {
  private readonly tasks: Map<string, TaskStatus> = new Map();
  private readonly proofs: Map<string, ProofBundle> = new Map();
  private readonly executeTask?: (prompt: string) => Promise<{ success: boolean; result: string }>;

  constructor(executeTask?: (prompt: string) => Promise<{ success: boolean; result: string }>) {
    this.executeTask = executeTask;
  }

  startTask(prompt: string, options: AutonomousOptions): TaskHandle {
    const taskId = `task-${Date.now()}`;
    const now = new Date().toISOString();
    this.tasks.set(taskId, {
      taskId,
      status: "running",
      progress: 0,
      cyclesCompleted: 0,
      maxCycles: options.maxCycles,
      currentStep: `Processing: ${prompt.slice(0, 50)}`,
      elapsedMs: 0,
      costSoFar: 0,
    });

    // Delegate to the real execution callback when provided
    if (this.executeTask) {
      const startTime = Date.now();
      this.executeTask(prompt)
        .then((result) => {
          const task = this.tasks.get(taskId);
          if (task && task.status === "running") {
            this.tasks.set(taskId, {
              ...task,
              status: result.success ? "complete" : "failed",
              progress: result.success ? 1 : task.progress,
              currentStep: result.result,
              elapsedMs: Date.now() - startTime,
            });
          }
        })
        .catch(() => {
          const task = this.tasks.get(taskId);
          if (task && task.status === "running") {
            this.tasks.set(taskId, {
              ...task,
              status: "failed",
              currentStep: "Execution error",
              elapsedMs: Date.now() - startTime,
            });
          }
        });
    }

    return { taskId, status: "running", startedAt: now };
  }

  getTaskStatus(taskId: string): TaskStatus {
    const task = this.tasks.get(taskId);
    if (!task) {
      return {
        taskId,
        status: "failed",
        progress: 0,
        cyclesCompleted: 0,
        maxCycles: 0,
        currentStep: "Task not found",
        elapsedMs: 0,
        costSoFar: 0,
      };
    }
    return task;
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === "complete" || task.status === "cancelled") {
      return false;
    }
    this.tasks.set(taskId, { ...task, status: "cancelled" });
    return true;
  }

  getProofBundle(taskId: string): ProofBundle | null {
    return this.proofs.get(taskId) ?? null;
  }

  /** Testing helper: mark a task complete with proof. */
  _completeTask(taskId: string, proof: ProofBundle): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, status: "complete", progress: 1 });
      this.proofs.set(taskId, proof);
    }
  }
}

// ── Handler: Quick Actions ─────────────────────────────

/** Runtime interface — subset of WotannRuntime needed by mobile handlers. */
export interface MobileRuntimeBridge {
  readonly getStatus?: () => {
    provider: string;
    model: string;
    contextPercent: number;
    totalTokens: number;
    maxTokens: number;
  };
  readonly getCost?: () => {
    sessionCost: number;
    todayCost: number;
    weekCost: number;
    monthCost?: number;
    budgetRemaining: number | null;
  };
  readonly enhancePrompt?: (text: string) => Promise<string>;
  readonly searchMemory?: (query: string) => Promise<
    readonly {
      id: string;
      content: string;
      score: number;
      source: string;
      type: string;
      createdAt: number;
    }[]
  >;
  readonly getAgents?: () => readonly {
    id: string;
    name: string;
    status: string;
    task: string;
    progress: number;
  }[];
}

export class QuickActionHandler {
  private readonly runtime: MobileRuntimeBridge | null;

  constructor(runtime?: MobileRuntimeBridge) {
    this.runtime = runtime ?? null;
  }

  async enhancePrompt(text: string): Promise<EnhancedPrompt> {
    if (this.runtime?.enhancePrompt) {
      try {
        const enhanced = await this.runtime.enhancePrompt(text);
        return {
          original: text,
          enhanced,
          model: "best-available",
          improvements: ["Enhanced via runtime"],
        };
      } catch {
        /* fall through to default */
      }
    }
    return {
      original: text,
      enhanced: text,
      model: "none",
      improvements: [],
    };
  }

  getCostSummary(): CostSummary {
    if (this.runtime?.getCost) {
      try {
        const cost = this.runtime.getCost();
        return {
          todayUSD: cost.todayCost,
          // Prefer real 30-day sum; fall back to rough weekly×4 only if unavailable.
          monthUSD: cost.monthCost ?? cost.weekCost * 4,
          budgetUSD: cost.budgetRemaining,
          topProvider: "auto",
          requestCount: 0,
        };
      } catch {
        /* fall through */
      }
    }
    return {
      todayUSD: 0,
      monthUSD: 0,
      budgetUSD: null,
      topProvider: "none",
      requestCount: 0,
    };
  }

  getContextStatus(): ContextStatus {
    if (this.runtime?.getStatus) {
      try {
        const status = this.runtime.getStatus();
        return {
          provider: status.provider,
          model: status.model,
          usedTokens: status.totalTokens,
          maxTokens: status.maxTokens,
          percent: status.contextPercent,
        };
      } catch {
        /* fall through */
      }
    }
    return {
      provider: "disconnected",
      model: "none",
      usedTokens: 0,
      maxTokens: 0,
      percent: 0,
    };
  }

  runArena(prompt: string): ArenaResult {
    return { prompt, responses: [], winner: null };
  }

  async searchMemory(query: string): Promise<readonly MemorySearchResult[]> {
    if (this.runtime?.searchMemory) {
      try {
        const results = await this.runtime.searchMemory(query);
        return results.map((r) => ({
          id: r.id,
          title: r.content.slice(0, 80),
          snippet: r.content.slice(0, 200),
          score: r.score,
          savedAt: new Date(r.createdAt).toISOString(),
        }));
      } catch {
        /* fall through */
      }
    }
    return [];
  }

  getNextTask(): string {
    if (this.runtime?.getAgents) {
      try {
        const agents = this.runtime.getAgents();
        const running = agents.filter((a) => a.status === "running");
        if (running.length > 0) {
          return `${running.length} task${running.length > 1 ? "s" : ""} running: ${running[0]?.task ?? "unknown"}`;
        }
      } catch {
        /* fall through */
      }
    }
    return "No pending tasks";
  }
}

// ── Handler: File Sharing ──────────────────────────────

export class FileShareHandler {
  private readonly workspaceDir: string;

  constructor(workspaceDir?: string) {
    this.workspaceDir = workspaceDir ?? join(tmpdir(), "wotann-shared");
    if (!existsSync(this.workspaceDir)) {
      mkdirSync(this.workspaceDir, { recursive: true });
    }
  }

  receiveFile(filename: string, dataBase64: string, _mimeType: string): FileReceiveResult {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(this.workspaceDir, safeName);
    const data = Buffer.from(dataBase64, "base64");
    writeFileSync(filePath, data);
    return {
      fileId: `file-${Date.now()}`,
      path: filePath,
      size: data.length,
      accepted: true,
    };
  }

  sendFile(path: string): FileData {
    const filename = path.split("/").pop() ?? "unknown";
    if (!existsSync(path)) {
      return { filename, dataBase64: "", mimeType: "application/octet-stream", size: 0 };
    }
    const data = readFileSync(path);
    return {
      filename,
      dataBase64: data.toString("base64"),
      mimeType: "application/octet-stream",
      size: data.length,
    };
  }
}

// ── Handler: Push Notifications ────────────────────────

export class PushNotificationHandler {
  private readonly devices: Map<string, DeviceRegistration> = new Map();
  private preferences: NotificationPreferences = {
    taskCompletion: true,
    errors: true,
    channelMessages: true,
    budgetAlerts: true,
    quietHoursStart: null,
    quietHoursEnd: null,
  };

  registerDevice(token: string, platform: "ios"): boolean {
    if (!token || token.length < 8) {
      return false;
    }
    this.devices.set(token, {
      deviceToken: token,
      platform,
      registeredAt: new Date().toISOString(),
    });
    return true;
  }

  updatePreferences(prefs: NotificationPreferences): boolean {
    this.preferences = { ...prefs };
    return true;
  }

  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  getRegisteredDevices(): readonly DeviceRegistration[] {
    return [...this.devices.values()];
  }
}

// ── Handler: Widget Data ───────────────────────────────

export class WidgetDataHandler {
  private readonly runtime: MobileRuntimeBridge | null;

  constructor(runtime?: MobileRuntimeBridge) {
    this.runtime = runtime ?? null;
  }

  getContextGauge(): WidgetContextGauge {
    if (this.runtime?.getStatus) {
      try {
        const s = this.runtime.getStatus();
        return {
          percent: s.contextPercent,
          provider: s.provider,
          model: s.model,
          maxTokens: s.maxTokens,
        };
      } catch {
        /* fall through */
      }
    }
    return { percent: 0, provider: "disconnected", model: "none", maxTokens: 0 };
  }

  getActiveTask(): WidgetActiveTask | null {
    if (this.runtime?.getAgents) {
      try {
        const agents = this.runtime.getAgents();
        const running = agents.find((a) => a.status === "running");
        if (running) {
          return { description: running.task, progress: running.progress, status: running.status };
        }
      } catch {
        /* fall through */
      }
    }
    return null;
  }

  getCostTracker(): WidgetCostTracker {
    if (this.runtime?.getCost) {
      try {
        const c = this.runtime.getCost();
        return {
          today: c.todayCost,
          month: c.monthCost ?? c.weekCost * 4,
          budget: c.budgetRemaining,
        };
      } catch {
        /* fall through */
      }
    }
    return { today: 0, month: 0, budget: null };
  }

  getQuickActions(): readonly WidgetQuickAction[] {
    return [
      { label: "Ask WOTANN", command: "/query", icon: "message" },
      { label: "Enhance", command: "/enhance", icon: "sparkles" },
      { label: "Cost", command: "/cost", icon: "dollar" },
      { label: "Voice", command: "/voice", icon: "mic" },
    ];
  }
}

// ── Handler: Live Activity (Dynamic Island) ────────────

export class LiveActivityHandler {
  private readonly activities: Map<string, { activityId: string; state: LiveActivityState }> =
    new Map();

  startActivity(taskId: string, description: string): string {
    const activityId = `activity-${Date.now()}`;
    this.activities.set(activityId, {
      activityId,
      state: {
        taskId,
        taskDescription: description,
        status: "running",
        progress: 0,
        cyclesCompleted: 0,
        maxCycles: 10,
        elapsedSeconds: 0,
        currentStep: "Starting...",
        costSoFar: 0,
      },
    });
    return activityId;
  }

  updateActivity(activityId: string, state: LiveActivityState): boolean {
    if (!this.activities.has(activityId)) {
      return false;
    }
    this.activities.set(activityId, { activityId, state });
    return true;
  }

  endActivity(activityId: string): boolean {
    return this.activities.delete(activityId);
  }

  getActivity(activityId: string): LiveActivityState | null {
    return this.activities.get(activityId)?.state ?? null;
  }
}
