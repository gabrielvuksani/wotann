import { describe, it, expect } from "vitest";
import {
  ConversationSyncHandler,
  MobileVoiceHandler,
  TaskMonitorHandler,
  QuickActionHandler,
  FileShareHandler,
  PushNotificationHandler,
  WidgetDataHandler,
  LiveActivityHandler,
} from "../../src/mobile/ios-app.js";
import type { IOSConversation, LiveActivityState } from "../../src/mobile/ios-types.js";

// ── Helpers ────────────────────────────────────────────

function makeConversation(overrides: Partial<IOSConversation> = {}): IOSConversation {
  return {
    id: "conv-1",
    title: "Test Chat",
    preview: "Hello",
    messageCount: 1,
    lastMessageAt: new Date().toISOString(),
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    mode: "chat",
    pinned: false,
    archived: false,
    tags: [],
    ...overrides,
  };
}

// ── ConversationSyncHandler ────────────────────────────

describe("ConversationSyncHandler", () => {
  it("should return empty sync when no conversations exist", () => {
    const handler = new ConversationSyncHandler();
    const result = handler.syncConversations(new Date(0).toISOString());
    expect(result.conversations).toHaveLength(0);
    expect(result.deletedIds).toHaveLength(0);
    expect(result.syncTimestamp).toBeTruthy();
  });

  it("should sync conversations updated after the given timestamp", () => {
    const handler = new ConversationSyncHandler();
    const past = new Date(Date.now() - 60_000).toISOString();
    const conv = makeConversation({ lastMessageAt: new Date().toISOString() });
    handler._addConversation(conv);

    const result = handler.syncConversations(past);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]?.id).toBe("conv-1");
  });

  it("should not sync conversations older than the timestamp", () => {
    const handler = new ConversationSyncHandler();
    const old = makeConversation({ lastMessageAt: new Date(2020, 0, 1).toISOString() });
    handler._addConversation(old);

    const result = handler.syncConversations(new Date().toISOString());
    expect(result.conversations).toHaveLength(0);
  });

  it("should receive a message and store it", () => {
    const handler = new ConversationSyncHandler();
    const result = handler.receiveMessage("conv-1", "Hello from iOS");
    expect(result.accepted).toBe(true);
    expect(result.messageId).toBeTruthy();

    const msgs = handler._getMessages("conv-1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toBe("Hello from iOS");
  });

  it("should receive a message with attachments", () => {
    const handler = new ConversationSyncHandler();
    const result = handler.receiveMessage("conv-2", "Photo", [
      { name: "photo.jpg", dataBase64: "abc123", mimeType: "image/jpeg" },
    ]);
    expect(result.accepted).toBe(true);

    const msgs = handler._getMessages("conv-2");
    expect(msgs[0]?.attachments).toHaveLength(1);
    expect(msgs[0]?.attachments?.[0]?.name).toBe("photo.jpg");
  });

  it("should push new messages since a timestamp", () => {
    const handler = new ConversationSyncHandler();
    handler.receiveMessage("conv-1", "First");
    const batch = handler.pushNewMessages("conv-1", new Date(0).toISOString());
    expect(batch.messages).toHaveLength(1);
    expect(batch.hasMore).toBe(false);
  });

  it("should return empty batch for unknown conversation", () => {
    const handler = new ConversationSyncHandler();
    const batch = handler.pushNewMessages("nonexistent", new Date(0).toISOString());
    expect(batch.messages).toHaveLength(0);
  });
});

// ── MobileVoiceHandler ─────────────────────────────────

describe("MobileVoiceHandler", () => {
  it("should process a voice recording and return transcription", () => {
    const handler = new MobileVoiceHandler();
    const result = handler.processVoiceRecording("dGVzdA==", "aac");
    expect(result.text).toContain("aac");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.language).toBe("en");
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("should stream TTS response", () => {
    const handler = new MobileVoiceHandler();
    const stream = handler.streamTTSResponse("Hello world");
    expect(stream.streamId).toBeTruthy();
    expect(stream.voiceId).toBe("default");
    expect(stream.firstChunk.isFinal).toBe(true);
    expect(stream.firstChunk.format).toBe("aac");
  });

  it("should use custom voice ID for TTS", () => {
    const handler = new MobileVoiceHandler();
    const stream = handler.streamTTSResponse("Hi", "custom-voice");
    expect(stream.voiceId).toBe("custom-voice");
  });
});

// ── TaskMonitorHandler ─────────────────────────────────

describe("TaskMonitorHandler", () => {
  it("should start a task and return a handle", () => {
    const handler = new TaskMonitorHandler();
    const handle = handler.startTask("Fix the bug", {
      maxCycles: 5,
      requireProof: true,
      budgetUSD: 1.0,
      priority: "high",
    });
    expect(handle.taskId).toBeTruthy();
    expect(handle.status).toBe("running");
    expect(handle.startedAt).toBeTruthy();
  });

  it("should get task status", () => {
    const handler = new TaskMonitorHandler();
    const handle = handler.startTask("Write tests", {
      maxCycles: 3,
      requireProof: false,
      budgetUSD: null,
      priority: "normal",
    });
    const status = handler.getTaskStatus(handle.taskId);
    expect(status.status).toBe("running");
    expect(status.maxCycles).toBe(3);
  });

  it("should return failed status for unknown task", () => {
    const handler = new TaskMonitorHandler();
    const status = handler.getTaskStatus("nonexistent");
    expect(status.status).toBe("failed");
    expect(status.currentStep).toContain("not found");
  });

  it("should cancel a running task", () => {
    const handler = new TaskMonitorHandler();
    const handle = handler.startTask("Refactor", {
      maxCycles: 10,
      requireProof: false,
      budgetUSD: null,
      priority: "low",
    });
    expect(handler.cancelTask(handle.taskId)).toBe(true);
    expect(handler.getTaskStatus(handle.taskId).status).toBe("cancelled");
  });

  it("should not cancel a completed task", () => {
    const handler = new TaskMonitorHandler();
    const handle = handler.startTask("Deploy", {
      maxCycles: 1,
      requireProof: true,
      budgetUSD: null,
      priority: "normal",
    });
    handler._completeTask(handle.taskId, {
      taskId: handle.taskId,
      summary: "Done",
      filesChanged: ["a.ts"],
      testsPassed: 5,
      testsFailed: 0,
      completedAt: new Date().toISOString(),
    });
    expect(handler.cancelTask(handle.taskId)).toBe(false);
  });

  it("should return proof bundle for completed task", () => {
    const handler = new TaskMonitorHandler();
    const handle = handler.startTask("Build", {
      maxCycles: 1,
      requireProof: true,
      budgetUSD: null,
      priority: "normal",
    });
    handler._completeTask(handle.taskId, {
      taskId: handle.taskId,
      summary: "Built successfully",
      filesChanged: ["index.ts"],
      testsPassed: 10,
      testsFailed: 0,
      completedAt: new Date().toISOString(),
    });
    const proof = handler.getProofBundle(handle.taskId);
    expect(proof).not.toBeNull();
    expect(proof?.testsPassed).toBe(10);
  });

  it("should return null proof for non-completed task", () => {
    const handler = new TaskMonitorHandler();
    expect(handler.getProofBundle("no-such-task")).toBeNull();
  });
});

// ── QuickActionHandler ─────────────────────────────────

describe("QuickActionHandler", () => {
  it("should enhance a prompt", async () => {
    const handler = new QuickActionHandler();
    const result = await handler.enhancePrompt("make it better");
    expect(result.original).toBe("make it better");
    // Without a runtime bridge, returns original text unchanged
    expect(result.enhanced).toBe("make it better");
  });

  it("should enhance with runtime bridge", async () => {
    const handler = new QuickActionHandler({
      enhancePrompt: async (text: string) => `[Enhanced] ${text}`,
    });
    const result = await handler.enhancePrompt("make it better");
    expect(result.enhanced).toContain("Enhanced");
  });

  it("should return cost summary", () => {
    const handler = new QuickActionHandler();
    const cost = handler.getCostSummary();
    expect(cost.todayUSD).toBe(0);
    expect(cost.topProvider).toBe("none");
  });

  it("should return context status", () => {
    const handler = new QuickActionHandler();
    const ctx = handler.getContextStatus();
    // Without runtime, returns disconnected state
    expect(ctx.provider).toBe("disconnected");
    expect(ctx.percent).toBe(0);
  });

  it("should return context with runtime bridge", () => {
    const handler = new QuickActionHandler({
      getStatus: () => ({ provider: "anthropic", model: "opus", contextPercent: 42, totalTokens: 5000, maxTokens: 200000 }),
    });
    const ctx = handler.getContextStatus();
    expect(ctx.provider).toBe("anthropic");
    expect(ctx.maxTokens).toBe(200000);
    expect(ctx.percent).toBe(42);
  });

  it("should run arena and return empty results by default", () => {
    const handler = new QuickActionHandler();
    const result = handler.runArena("test prompt");
    expect(result.prompt).toBe("test prompt");
    expect(result.responses).toHaveLength(0);
  });

  it("should search memory", async () => {
    const handler = new QuickActionHandler();
    const results = await handler.searchMemory("hooks");
    // Without runtime, returns empty array
    expect(results).toHaveLength(0);
  });

  it("should search memory with runtime bridge", async () => {
    const handler = new QuickActionHandler({
      searchMemory: async () => [{ id: "1", content: "hooks pattern", score: 0.9, source: "test", type: "pattern", createdAt: Date.now() }],
    });
    const results = await handler.searchMemory("hooks");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toContain("hooks");
  });

  it("should return next task string", () => {
    const handler = new QuickActionHandler();
    expect(handler.getNextTask()).toBeTruthy();
  });
});

// ── FileShareHandler ───────────────────────────────────

describe("FileShareHandler", () => {
  it("should receive a file from iOS", () => {
    const handler = new FileShareHandler();
    const result = handler.receiveFile("photo.jpg", "base64data", "image/jpeg");
    expect(result.accepted).toBe(true);
    expect(result.path).toContain("photo.jpg");
    expect(result.fileId).toBeTruthy();
  });

  it("should send a file to iOS", () => {
    const handler = new FileShareHandler();
    const result = handler.sendFile("/workspace/src/index.ts");
    expect(result.filename).toBe("index.ts");
    expect(result.mimeType).toBe("application/octet-stream");
  });
});

// ── PushNotificationHandler ────────────────────────────

describe("PushNotificationHandler", () => {
  it("should register a device", () => {
    const handler = new PushNotificationHandler();
    expect(handler.registerDevice("abcdef123456", "ios")).toBe(true);
    expect(handler.getRegisteredDevices()).toHaveLength(1);
  });

  it("should reject empty or short tokens", () => {
    const handler = new PushNotificationHandler();
    expect(handler.registerDevice("", "ios")).toBe(false);
    expect(handler.registerDevice("short", "ios")).toBe(false);
  });

  it("should update notification preferences", () => {
    const handler = new PushNotificationHandler();
    const prefs = {
      taskCompletion: false,
      errors: true,
      channelMessages: false,
      budgetAlerts: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };
    expect(handler.updatePreferences(prefs)).toBe(true);
    expect(handler.getPreferences().taskCompletion).toBe(false);
    expect(handler.getPreferences().quietHoursStart).toBe("22:00");
  });
});

// ── WidgetDataHandler ──────────────────────────────────

describe("WidgetDataHandler", () => {
  it("should return context gauge data", () => {
    const handler = new WidgetDataHandler();
    const gauge = handler.getContextGauge();
    // Without runtime bridge, returns disconnected state
    expect(gauge.provider).toBe("disconnected");
    expect(gauge.percent).toBe(0);
  });

  it("should return context gauge with runtime bridge", () => {
    const handler = new WidgetDataHandler({
      getStatus: () => ({ provider: "anthropic", model: "opus", contextPercent: 55, totalTokens: 8000, maxTokens: 200000 }),
    });
    const gauge = handler.getContextGauge();
    expect(gauge.maxTokens).toBe(200000);
    expect(gauge.provider).toBe("anthropic");
    expect(gauge.percent).toBe(55);
  });

  it("should return null when no active task", () => {
    const handler = new WidgetDataHandler();
    expect(handler.getActiveTask()).toBeNull();
  });

  it("should return cost tracker data", () => {
    const handler = new WidgetDataHandler();
    const cost = handler.getCostTracker();
    expect(cost.today).toBe(0);
  });

  it("should return quick actions list", () => {
    const handler = new WidgetDataHandler();
    const actions = handler.getQuickActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]?.label).toBeTruthy();
    expect(actions[0]?.command).toBeTruthy();
  });
});

// ── LiveActivityHandler ────────────────────────────────

describe("LiveActivityHandler", () => {
  it("should start a live activity", () => {
    const handler = new LiveActivityHandler();
    const activityId = handler.startActivity("task-1", "Building feature");
    expect(activityId).toBeTruthy();
    expect(activityId).toContain("activity-");
  });

  it("should update a live activity", () => {
    const handler = new LiveActivityHandler();
    const activityId = handler.startActivity("task-1", "Building");
    const newState: LiveActivityState = {
      taskId: "task-1",
      taskDescription: "Building",
      status: "verifying",
      progress: 0.5,
      cyclesCompleted: 3,
      maxCycles: 10,
      elapsedSeconds: 120,
      currentStep: "Running tests",
      costSoFar: 0.05,
    };
    expect(handler.updateActivity(activityId, newState)).toBe(true);
    expect(handler.getActivity(activityId)?.status).toBe("verifying");
  });

  it("should fail to update nonexistent activity", () => {
    const handler = new LiveActivityHandler();
    const state: LiveActivityState = {
      taskId: "x",
      taskDescription: "x",
      status: "running",
      progress: 0,
      cyclesCompleted: 0,
      maxCycles: 1,
      elapsedSeconds: 0,
      currentStep: "",
      costSoFar: 0,
    };
    expect(handler.updateActivity("nonexistent", state)).toBe(false);
  });

  it("should end a live activity", () => {
    const handler = new LiveActivityHandler();
    const activityId = handler.startActivity("task-1", "Done");
    expect(handler.endActivity(activityId)).toBe(true);
    expect(handler.getActivity(activityId)).toBeNull();
  });

  it("should fail to end nonexistent activity", () => {
    const handler = new LiveActivityHandler();
    expect(handler.endActivity("nope")).toBe(false);
  });
});
