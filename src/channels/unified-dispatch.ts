/**
 * Unified Dispatch Plane — the single entry point for ALL communication in WOTANN.
 *
 * Merges the concepts of:
 * - ChannelGateway (message routing, DM pairing, device registry)
 * - ChannelDispatchManager (route policies, runtime pooling, session management)
 * - OpenClaw Channels (50+ platform adapters)
 * - Claude Code Dispatch (leaked feature — task routing)
 *
 * Every inbound message (Telegram, Slack, Discord, WebChat, Email, Voice, CLI)
 * becomes a TASK in a unified inbox. Tasks can be:
 * - auto-processed (routed to the right agent session)
 * - snooped (review before processing)
 * - escalated (forward to a more powerful model)
 * - forwarded (send to a different channel or human)
 * - snoozed (defer for later)
 *
 * CROSS-CHANNEL ROUTING:
 * A message received on Telegram can be responded to on Slack and emailed.
 * The dispatch plane abstracts away the transport layer completely.
 */

import { randomUUID } from "node:crypto";
import type { ChannelAdapter, ChannelMessage, ChannelType, DeviceNode } from "./gateway.js";
import type { DispatchRoutePolicy } from "./dispatch.js";
import { RoutePolicyEngine, createDefaultPolicy } from "./route-policies.js";
import type { ComputerSessionStore, SessionEvent } from "../session/computer-session-store.js";

// ── Task Inbox Types ─────────────────────────────────────

export type TaskPriority = "critical" | "high" | "normal" | "low";
export type TaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "snoozed"
  | "escalated"
  | "forwarded";

export interface DispatchTask {
  readonly id: string;
  readonly message: ChannelMessage;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly createdAt: number;
  readonly processedAt?: number;
  readonly completedAt?: number;
  readonly response?: string;
  readonly routeKey?: string;
  readonly assignedModel?: string;
  readonly assignedProvider?: string;
  readonly costUsd?: number;
  readonly tokensUsed?: number;
  readonly responseChannels?: readonly ChannelType[];
  readonly snoozeUntil?: number;
  readonly escalatedFrom?: string;
  readonly error?: string;
}

// ── Channel Health Types ─────────────────────────────────

export interface ChannelHealth {
  readonly channelType: ChannelType;
  readonly connected: boolean;
  readonly lastMessageAt: number;
  readonly messagesReceived: number;
  readonly messagesSent: number;
  readonly errors: number;
  readonly latencyMs: number;
  readonly upSince: number;
}

// ── Dispatch Plane Config ────────────────────────────────

export interface UnifiedDispatchConfig {
  readonly requirePairing: boolean;
  readonly pairingCodeTTL: number;
  readonly maxQueueSize: number;
  readonly maxInboxSize: number;
  readonly allowedChannels: readonly ChannelType[];
  readonly autoProcessEnabled: boolean;
  readonly defaultResponseChannels: readonly ChannelType[];
  readonly taskTimeoutMs: number;
  readonly enableCrossChannelRouting: boolean;
}

const DEFAULT_CONFIG: UnifiedDispatchConfig = {
  requirePairing: true,
  pairingCodeTTL: 5 * 60 * 1000,
  maxQueueSize: 100,
  maxInboxSize: 500,
  allowedChannels: ["telegram", "slack", "discord", "webchat", "email", "webhook", "cli"],
  autoProcessEnabled: true,
  defaultResponseChannels: [],
  taskTimeoutMs: 5 * 60 * 1000,
  enableCrossChannelRouting: true,
};

// ── Priority Classification ──────────────────────────────

function classifyPriority(message: ChannelMessage): TaskPriority {
  const content = message.content.toLowerCase();
  if (content.includes("urgent") || content.includes("critical") || content.includes("emergency"))
    return "critical";
  if (content.includes("important") || content.includes("asap") || content.includes("blocking"))
    return "high";
  if (
    content.includes("low priority") ||
    content.includes("when you can") ||
    content.includes("fyi")
  )
    return "low";
  return "normal";
}

// ── Complexity Analysis ──────────────────────────────────

export interface TaskComplexity {
  readonly score: number;
  readonly factors: readonly string[];
  readonly suggestedModel: "fast" | "balanced" | "powerful";
}

function analyzeComplexity(content: string): TaskComplexity {
  const factors: string[] = [];
  let score = 0;

  if (content.length > 500) {
    score += 2;
    factors.push("long-prompt");
  }
  if (content.length > 2000) {
    score += 3;
    factors.push("very-long-prompt");
  }
  if (/refactor|architect|design|migrate/i.test(content)) {
    score += 3;
    factors.push("architectural-task");
  }
  if (/debug|fix|error|bug|crash/i.test(content)) {
    score += 2;
    factors.push("debugging");
  }
  if (/test|verify|validate/i.test(content)) {
    score += 1;
    factors.push("verification");
  }
  if (/multiple files|across.*files|many.*changes/i.test(content)) {
    score += 2;
    factors.push("multi-file");
  }
  if (/security|auth|encrypt|credential/i.test(content)) {
    score += 2;
    factors.push("security-sensitive");
  }
  if (/explain|what is|how does|why/i.test(content)) {
    score -= 1;
    factors.push("informational-query");
  }

  const suggestedModel: "fast" | "balanced" | "powerful" =
    score >= 5 ? "powerful" : score >= 2 ? "balanced" : "fast";

  return { score: Math.max(0, score), factors, suggestedModel };
}

// ── Unified Dispatch Plane ──────────────────────────────

export class UnifiedDispatchPlane {
  private readonly config: UnifiedDispatchConfig;
  private readonly adapters: Map<ChannelType, ChannelAdapter> = new Map();
  private readonly verifiedSenders: Set<string> = new Set();
  private readonly pairingCodes: Map<
    string,
    { senderId: string; channelType: ChannelType; expiresAt: number }
  > = new Map();
  private readonly devices: Map<string, DeviceNode> = new Map();
  private readonly inbox: Map<string, DispatchTask> = new Map();
  private readonly channelHealth: Map<ChannelType, ChannelHealth> = new Map();
  private readonly policies: Map<string, DispatchRoutePolicy> = new Map();
  private readonly routePolicyEngine: RoutePolicyEngine;
  private messageHandler: ((message: ChannelMessage) => Promise<string>) | null = null;

  // Computer-session bridge (Phase 3 P1-F1). When wired, incoming SessionEvents
  // fan out to every listener registered via `onComputerSessionEvent`. The
  // ComputerSessionStore remains the single source of truth for session state
  // (QB #7); this plane is the bus that carries events across surfaces.
  private computerSessionStore: ComputerSessionStore | null = null;
  private computerSessionDispose: (() => void) | null = null;
  private readonly computerSessionListeners = new Set<(event: SessionEvent) => void>();

  constructor(config?: Partial<UnifiedDispatchConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize route policy engine with default policies for all allowed channels
    this.routePolicyEngine = new RoutePolicyEngine();
    for (const channel of this.config.allowedChannels) {
      this.routePolicyEngine.addPolicy(createDefaultPolicy(channel));
    }
  }

  // ── Adapter Registration ─────────────────────────────────

  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.type, adapter);
    this.channelHealth.set(adapter.type, {
      channelType: adapter.type,
      connected: false,
      lastMessageAt: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      latencyMs: 0,
      upSince: 0,
    });

    adapter.onMessage((message) => {
      void this.handleIncomingMessage(message);
    });
  }

  setMessageHandler(handler: (message: ChannelMessage) => Promise<string>): void {
    this.messageHandler = handler;
  }

  // ── Computer-Session Bridge (Phase 3 P1-F1) ────────────

  /**
   * Attach a ComputerSessionStore so session events flow through this plane
   * to every registered listener. Calling again with a different store
   * disconnects the previous one. Passing `null` tears the bridge down.
   *
   * QB #11 — before wiring, a sibling-site scan confirmed no other cross-surface
   * channel carried session-like events. This is the first and canonical bridge.
   */
  attachComputerSessionStore(store: ComputerSessionStore | null): void {
    if (this.computerSessionDispose) {
      this.computerSessionDispose();
      this.computerSessionDispose = null;
    }
    this.computerSessionStore = store;
    if (store) {
      this.computerSessionDispose = store.subscribeAll((event) => {
        for (const listener of this.computerSessionListeners) {
          try {
            listener(event);
          } catch {
            // Listener errors must not poison the bus. Callers that need
            // durable error signalling should wrap their own try/catch.
          }
        }
      });
    }
  }

  getComputerSessionStore(): ComputerSessionStore | null {
    return this.computerSessionStore;
  }

  /**
   * Register a listener for every SessionEvent that passes through the plane.
   * Returns a disposer. Used by phone, watch, desktop, TUI bridges — any
   * connected surface can tap the same stream without knowing about others.
   */
  onComputerSessionEvent(listener: (event: SessionEvent) => void): () => void {
    this.computerSessionListeners.add(listener);
    return () => {
      this.computerSessionListeners.delete(listener);
    };
  }

  // ── Connection Management ────────────────────────────────

  async connectAll(): Promise<{
    connected: readonly ChannelType[];
    failed: readonly ChannelType[];
  }> {
    const connected: ChannelType[] = [];
    const failed: ChannelType[] = [];

    for (const [type, adapter] of this.adapters) {
      try {
        const ok = await adapter.connect();
        if (ok) {
          connected.push(type);
          this.updateHealth(type, { connected: true, upSince: Date.now() });
        } else {
          failed.push(type);
        }
      } catch {
        failed.push(type);
        this.updateHealth(type, { errors: (this.channelHealth.get(type)?.errors ?? 0) + 1 });
      }
    }

    return { connected, failed };
  }

  async disconnectAll(): Promise<void> {
    for (const [type, adapter] of this.adapters) {
      await adapter.disconnect();
      this.updateHealth(type, { connected: false });
    }
  }

  // ── Task Inbox Operations ────────────────────────────────

  getInbox(filter?: {
    status?: TaskStatus;
    priority?: TaskPriority;
    channelType?: ChannelType;
  }): readonly DispatchTask[] {
    let tasks = [...this.inbox.values()];
    if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
    if (filter?.priority) tasks = tasks.filter((t) => t.priority === filter.priority);
    if (filter?.channelType)
      tasks = tasks.filter((t) => t.message.channelType === filter.channelType);
    return tasks.sort((a, b) => {
      const priorityOrder: Record<TaskPriority, number> = {
        critical: 0,
        high: 1,
        normal: 2,
        low: 3,
      };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      return pDiff !== 0 ? pDiff : a.createdAt - b.createdAt;
    });
  }

  getTask(taskId: string): DispatchTask | undefined {
    return this.inbox.get(taskId);
  }

  snoozeTask(taskId: string, durationMs: number): boolean {
    const task = this.inbox.get(taskId);
    if (!task) return false;
    this.inbox.set(taskId, { ...task, status: "snoozed", snoozeUntil: Date.now() + durationMs });
    return true;
  }

  escalateTask(taskId: string, toModel?: string, toProvider?: string): boolean {
    const task = this.inbox.get(taskId);
    if (!task) return false;
    this.inbox.set(taskId, {
      ...task,
      status: "escalated",
      escalatedFrom: task.assignedModel,
      assignedModel: toModel,
      assignedProvider: toProvider,
    });
    return true;
  }

  async forwardTask(
    taskId: string,
    targetChannels: readonly ChannelType[],
  ): Promise<readonly ChannelType[]> {
    const task = this.inbox.get(taskId);
    if (!task) return [];

    const forwarded: ChannelType[] = [];
    const content = `[Forwarded Task] ${task.message.content}`;
    for (const channelType of targetChannels) {
      const adapter = this.adapters.get(channelType);
      if (adapter?.connected) {
        const ok = await adapter.send("forward", content);
        if (ok) forwarded.push(channelType);
      }
    }

    this.inbox.set(taskId, { ...task, status: "forwarded", responseChannels: forwarded });
    return forwarded;
  }

  // ── DM Pairing ──────────────────────────────────────────

  generatePairingCode(senderId: string, channelType: ChannelType): string {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.pairingCodes.set(code, {
      senderId,
      channelType,
      expiresAt: Date.now() + this.config.pairingCodeTTL,
    });
    return code;
  }

  verifyPairingCode(code: string): boolean {
    const pairing = this.pairingCodes.get(code);
    if (!pairing || Date.now() > pairing.expiresAt) {
      this.pairingCodes.delete(code);
      return false;
    }
    this.verifiedSenders.add(pairing.senderId);
    this.pairingCodes.delete(code);
    return true;
  }

  verifySender(senderId: string): void {
    this.verifiedSenders.add(senderId);
  }

  // ── Cross-Channel Routing ────────────────────────────────

  async sendToChannel(
    channelType: ChannelType,
    channelId: string,
    content: string,
    replyTo?: string,
  ): Promise<boolean> {
    const adapter = this.adapters.get(channelType);
    if (!adapter?.connected) return false;
    const ok = await adapter.send(channelId, content, replyTo);
    if (ok) {
      this.updateHealth(channelType, {
        messagesSent: (this.channelHealth.get(channelType)?.messagesSent ?? 0) + 1,
      });
    }
    return ok;
  }

  async broadcast(content: string): Promise<readonly ChannelType[]> {
    const sent: ChannelType[] = [];
    for (const [type, adapter] of this.adapters) {
      if (adapter.connected) {
        const ok = await adapter.send("broadcast", content);
        if (ok) {
          sent.push(type);
          this.updateHealth(type, {
            messagesSent: (this.channelHealth.get(type)?.messagesSent ?? 0) + 1,
          });
        }
      }
    }
    return sent;
  }

  async respondOnMultipleChannels(
    content: string,
    channels: readonly { channelType: ChannelType; channelId: string; replyTo?: string }[],
  ): Promise<readonly ChannelType[]> {
    const sent: ChannelType[] = [];
    for (const target of channels) {
      const ok = await this.sendToChannel(
        target.channelType,
        target.channelId,
        content,
        target.replyTo,
      );
      if (ok) sent.push(target.channelType);
    }
    return sent;
  }

  // ── Device Registration ──────────────────────────────────

  registerDevice(
    name: string,
    channelType: ChannelType,
    capabilities: readonly string[],
  ): DeviceNode {
    const node: DeviceNode = {
      id: randomUUID(),
      name,
      channelType,
      capabilities,
      lastSeen: Date.now(),
      online: true,
    };
    this.devices.set(node.id, node);
    return node;
  }

  getDevices(): readonly DeviceNode[] {
    return [...this.devices.values()];
  }

  // ── Policy Management ────────────────────────────────────

  upsertPolicy(policy: DispatchRoutePolicy): void {
    this.policies.set(policy.id, policy);
  }

  removePolicy(id: string): boolean {
    return this.policies.delete(id);
  }

  getPolicies(): readonly DispatchRoutePolicy[] {
    return [...this.policies.values()];
  }

  // ── Health Dashboard ─────────────────────────────────────

  getChannelHealth(): readonly ChannelHealth[] {
    return [...this.channelHealth.values()];
  }

  getChannelHealthByType(type: ChannelType): ChannelHealth | undefined {
    return this.channelHealth.get(type);
  }

  getConnectedChannels(): readonly ChannelType[] {
    return [...this.adapters.entries()]
      .filter(([_, adapter]) => adapter.connected)
      .map(([type]) => type);
  }

  // ── Route Policy Engine Access ──────────────────��────────

  getRoutePolicyEngine(): RoutePolicyEngine {
    return this.routePolicyEngine;
  }

  // ── Stats ────────────────────────────────────────────────

  getStats(): {
    readonly totalTasks: number;
    readonly pendingTasks: number;
    readonly completedTasks: number;
    readonly failedTasks: number;
    readonly connectedChannels: number;
    readonly verifiedSenders: number;
    readonly registeredDevices: number;
    readonly policiesLoaded: number;
  } {
    const tasks = [...this.inbox.values()];
    return {
      totalTasks: tasks.length,
      pendingTasks: tasks.filter((t) => t.status === "pending").length,
      completedTasks: tasks.filter((t) => t.status === "completed").length,
      failedTasks: tasks.filter((t) => t.status === "failed").length,
      connectedChannels: this.getConnectedChannels().length,
      verifiedSenders: this.verifiedSenders.size,
      registeredDevices: this.devices.size,
      policiesLoaded: this.policies.size,
    };
  }

  // ── Private: Inbound Message Handling ────────────────────

  private async handleIncomingMessage(message: ChannelMessage): Promise<void> {
    if (!this.config.allowedChannels.includes(message.channelType)) return;

    // Update health
    this.updateHealth(message.channelType, {
      lastMessageAt: Date.now(),
      messagesReceived: (this.channelHealth.get(message.channelType)?.messagesReceived ?? 0) + 1,
    });

    // DM pairing security
    if (this.config.requirePairing && !this.verifiedSenders.has(message.senderId)) {
      if (message.channelType !== "cli" && message.channelType !== "webchat") {
        const code = this.generatePairingCode(message.senderId, message.channelType);
        const adapter = this.adapters.get(message.channelType);
        if (adapter) {
          await adapter.send(
            message.channelId,
            `Unknown sender. Enter this pairing code in the WOTANN CLI to verify: ${code}`,
            message.id,
          );
        }
        return;
      }
      this.verifiedSenders.add(message.senderId);
    }

    // Match against route policies for model tier, rate limits, and response format
    const routePolicy = this.routePolicyEngine.resolvePolicy(message.channelType, message.senderId);
    const complexity = analyzeComplexity(message.content);

    // Use route policy to determine model tier (if policy matched)
    const assignedModel: string = routePolicy
      ? this.routePolicyEngine.getModelTierForRoute(routePolicy, complexity.score)
      : complexity.suggestedModel;

    // Create task in inbox
    const task: DispatchTask = {
      id: randomUUID(),
      message,
      priority: classifyPriority(message),
      status: "pending",
      createdAt: Date.now(),
      assignedModel,
    };

    this.inbox.set(task.id, task);
    this.trimInbox();

    // Auto-process if enabled
    if (this.config.autoProcessEnabled && this.messageHandler) {
      await this.processTask(task.id);
    }
  }

  private async processTask(taskId: string): Promise<void> {
    const task = this.inbox.get(taskId);
    if (!task || !this.messageHandler) return;

    this.inbox.set(taskId, { ...task, status: "processing", processedAt: Date.now() });

    try {
      const startTime = Date.now();
      const rawResponse = await this.messageHandler(task.message);
      const latencyMs = Date.now() - startTime;

      this.updateHealth(task.message.channelType, { latencyMs });

      // Format response according to route policy (if matched)
      const taskRoutePolicy = this.routePolicyEngine.resolvePolicy(
        task.message.channelType,
        task.message.senderId,
      );
      const response = taskRoutePolicy
        ? this.routePolicyEngine.formatResponse(
            rawResponse,
            taskRoutePolicy.responseFormat,
            taskRoutePolicy.maxResponseLength,
          )
        : rawResponse;

      // Respond on the original channel
      const adapter = this.adapters.get(task.message.channelType);
      if (adapter?.connected) {
        await adapter.send(task.message.channelId, response, task.message.id);
        this.updateHealth(task.message.channelType, {
          messagesSent: (this.channelHealth.get(task.message.channelType)?.messagesSent ?? 0) + 1,
        });
      }

      // Cross-channel routing: also send to configured response channels
      if (this.config.enableCrossChannelRouting) {
        const extraChannels = this.config.defaultResponseChannels.filter(
          (ch) => ch !== task.message.channelType,
        );
        for (const channelType of extraChannels) {
          await this.sendToChannel(channelType, "cross-channel", response);
        }
      }

      this.inbox.set(taskId, { ...task, status: "completed", completedAt: Date.now(), response });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown";
      this.inbox.set(taskId, { ...task, status: "failed", error: errorMessage });
      this.updateHealth(task.message.channelType, {
        errors: (this.channelHealth.get(task.message.channelType)?.errors ?? 0) + 1,
      });
    }
  }

  private updateHealth(type: ChannelType, updates: Partial<ChannelHealth>): void {
    const current = this.channelHealth.get(type) ?? {
      channelType: type,
      connected: false,
      lastMessageAt: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      latencyMs: 0,
      upSince: 0,
    };
    this.channelHealth.set(type, { ...current, ...updates });
  }

  private trimInbox(): void {
    if (this.inbox.size > this.config.maxInboxSize) {
      const completed = [...this.inbox.entries()]
        .filter(([_, t]) => t.status === "completed" || t.status === "failed")
        .sort(([_, a], [__, b]) => a.createdAt - b.createdAt);

      for (const [id] of completed.slice(0, this.inbox.size - this.config.maxInboxSize)) {
        this.inbox.delete(id);
      }
    }
  }
}

// ── Exported helpers ─────────────────────────────────────

export { analyzeComplexity, classifyPriority };
