import { describe, it, expect } from "vitest";
import {
  appReducer,
  INITIAL_STATE,
  selectActiveConversation,
  selectUnreadNotificationCount,
  selectPinnedConversations,
  selectConversationsByProject,
} from "../../src/desktop/app-state.js";
import type { DesktopAppState, AppAction, AppNotification } from "../../src/desktop/app-state.js";
import type { Conversation, DesktopMessage } from "../../src/desktop/conversation-manager.js";

// ── Test Helpers ───────────────────────────────────────

function makeConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: "conv-1",
    title: "Test Conversation",
    messages: [],
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    mode: "default",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    pinned: false,
    archived: false,
    tags: [],
    tokenCount: 0,
    cost: 0,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<DesktopMessage>): DesktopMessage {
  return {
    id: "msg-1",
    role: "user",
    content: "Hello world",
    timestamp: "2025-01-01T00:01:00.000Z",
    ...overrides,
  };
}

function makeNotification(overrides?: Partial<AppNotification>): AppNotification {
  return {
    id: "notif-1",
    type: "task-complete",
    title: "Task Done",
    body: "Your task completed.",
    timestamp: "2025-01-01T00:00:00.000Z",
    read: false,
    ...overrides,
  };
}

// ── Reducer Tests ──────────────────────────────────────

describe("appReducer", () => {
  it("should return initial state values", () => {
    expect(INITIAL_STATE.conversations).toHaveLength(0);
    expect(INITIAL_STATE.activeConversationId).toBeNull();
    expect(INITIAL_STATE.sidebarOpen).toBe(true);
    expect(INITIAL_STATE.commandPaletteOpen).toBe(false);
    expect(INITIAL_STATE.isStreaming).toBe(false);
    expect(INITIAL_STATE.currentMode).toBe("default");
  });

  it("should create a conversation and set it active", () => {
    const conv = makeConversation();
    const state = appReducer(INITIAL_STATE, { type: "CREATE_CONVERSATION", conversation: conv });

    expect(state.conversations).toHaveLength(1);
    expect(state.activeConversationId).toBe("conv-1");
  });

  it("should not mutate the original state on CREATE_CONVERSATION", () => {
    const conv = makeConversation();
    const _newState = appReducer(INITIAL_STATE, { type: "CREATE_CONVERSATION", conversation: conv });

    expect(INITIAL_STATE.conversations).toHaveLength(0);
    expect(INITIAL_STATE.activeConversationId).toBeNull();
  });

  it("should delete a conversation and fall back to first remaining", () => {
    const conv1 = makeConversation({ id: "c1" });
    const conv2 = makeConversation({ id: "c2" });
    let state = appReducer(INITIAL_STATE, { type: "CREATE_CONVERSATION", conversation: conv1 });
    state = appReducer(state, { type: "CREATE_CONVERSATION", conversation: conv2 });
    state = appReducer(state, { type: "DELETE_CONVERSATION", conversationId: "c2" });

    expect(state.conversations).toHaveLength(1);
    expect(state.activeConversationId).toBe("c1");
  });

  it("should set active to null when last conversation is deleted", () => {
    const conv = makeConversation();
    let state = appReducer(INITIAL_STATE, { type: "CREATE_CONVERSATION", conversation: conv });
    state = appReducer(state, { type: "DELETE_CONVERSATION", conversationId: "conv-1" });

    expect(state.conversations).toHaveLength(0);
    expect(state.activeConversationId).toBeNull();
  });

  it("should switch conversation", () => {
    const state = appReducer(INITIAL_STATE, { type: "SWITCH_CONVERSATION", conversationId: "xyz" });
    expect(state.activeConversationId).toBe("xyz");
  });

  it("should append a message to a conversation", () => {
    const conv = makeConversation();
    let state = appReducer(INITIAL_STATE, { type: "CREATE_CONVERSATION", conversation: conv });

    const msg = makeMessage();
    state = appReducer(state, { type: "APPEND_MESSAGE", conversationId: "conv-1", message: msg });

    expect(state.conversations[0]?.messages).toHaveLength(1);
    expect(state.conversations[0]?.messages[0]?.content).toBe("Hello world");
  });

  it("should toggle sidebar", () => {
    const state = appReducer(INITIAL_STATE, { type: "TOGGLE_SIDEBAR" });
    expect(state.sidebarOpen).toBe(false);
    const toggled = appReducer(state, { type: "TOGGLE_SIDEBAR" });
    expect(toggled.sidebarOpen).toBe(true);
  });

  it("should set sidebar tab and open sidebar", () => {
    const closed: DesktopAppState = { ...INITIAL_STATE, sidebarOpen: false };
    const state = appReducer(closed, { type: "SET_SIDEBAR_TAB", tab: "projects" });
    expect(state.sidebarTab).toBe("projects");
    expect(state.sidebarOpen).toBe(true);
  });

  it("should toggle command palette", () => {
    const state = appReducer(INITIAL_STATE, { type: "TOGGLE_COMMAND_PALETTE" });
    expect(state.commandPaletteOpen).toBe(true);
  });

  it("should set theme", () => {
    const state = appReducer(INITIAL_STATE, { type: "SET_THEME", theme: "dark" });
    expect(state.theme).toBe("dark");
  });

  it("should add and dismiss notifications", () => {
    const notif = makeNotification();
    let state = appReducer(INITIAL_STATE, { type: "ADD_NOTIFICATION", notification: notif });
    expect(state.notifications).toHaveLength(1);

    state = appReducer(state, { type: "DISMISS_NOTIFICATION", notificationId: "notif-1" });
    expect(state.notifications).toHaveLength(0);
  });

  it("should mark notification as read", () => {
    const notif = makeNotification();
    let state = appReducer(INITIAL_STATE, { type: "ADD_NOTIFICATION", notification: notif });
    state = appReducer(state, { type: "MARK_NOTIFICATION_READ", notificationId: "notif-1" });

    expect(state.notifications[0]?.read).toBe(true);
  });

  it("should set streaming state", () => {
    const state = appReducer(INITIAL_STATE, { type: "SET_STREAMING", isStreaming: true });
    expect(state.isStreaming).toBe(true);
  });

  it("should set provider and model", () => {
    const state = appReducer(INITIAL_STATE, {
      type: "SET_PROVIDER",
      provider: "openai",
      model: "gpt-4o",
    });
    expect(state.activeProvider).toBe("openai");
    expect(state.activeModel).toBe("gpt-4o");
  });

  it("should set mode", () => {
    const state = appReducer(INITIAL_STATE, { type: "SET_MODE", mode: "autonomous" });
    expect(state.currentMode).toBe("autonomous");
  });

  it("should update cost and context", () => {
    let state = appReducer(INITIAL_STATE, { type: "UPDATE_COST", costToday: 1.23 });
    expect(state.costToday).toBe(1.23);

    state = appReducer(state, { type: "UPDATE_CONTEXT", contextPercent: 45 });
    expect(state.contextPercent).toBe(45);
  });

  it("should add and remove companion devices", () => {
    const device = {
      id: "dev-1",
      name: "iPhone",
      platform: "ios" as const,
      lastSeen: "2025-01-01T00:00:00.000Z",
      paired: true,
      capabilities: ["voice-input" as const],
    };

    let state = appReducer(INITIAL_STATE, { type: "ADD_COMPANION_DEVICE", device });
    expect(state.companionDevices).toHaveLength(1);

    state = appReducer(state, { type: "REMOVE_COMPANION_DEVICE", deviceId: "dev-1" });
    expect(state.companionDevices).toHaveLength(0);
  });
});

// ── Selector Tests ─────────────────────────────────────

describe("selectors", () => {
  it("selectActiveConversation should find the active conversation", () => {
    const conv = makeConversation({ id: "active-1" });
    const state: DesktopAppState = {
      ...INITIAL_STATE,
      conversations: [conv],
      activeConversationId: "active-1",
    };
    expect(selectActiveConversation(state)?.id).toBe("active-1");
  });

  it("selectActiveConversation should return undefined when no active", () => {
    expect(selectActiveConversation(INITIAL_STATE)).toBeUndefined();
  });

  it("selectUnreadNotificationCount should count unread only", () => {
    const state: DesktopAppState = {
      ...INITIAL_STATE,
      notifications: [
        makeNotification({ id: "n1", read: false }),
        makeNotification({ id: "n2", read: true }),
        makeNotification({ id: "n3", read: false }),
      ],
    };
    expect(selectUnreadNotificationCount(state)).toBe(2);
  });

  it("selectPinnedConversations should filter pinned", () => {
    const state: DesktopAppState = {
      ...INITIAL_STATE,
      conversations: [
        makeConversation({ id: "c1", pinned: true }),
        makeConversation({ id: "c2", pinned: false }),
        makeConversation({ id: "c3", pinned: true }),
      ],
    };
    expect(selectPinnedConversations(state)).toHaveLength(2);
  });

  it("selectConversationsByProject should filter by project", () => {
    const state: DesktopAppState = {
      ...INITIAL_STATE,
      conversations: [
        makeConversation({ id: "c1", project: "proj-a" }),
        makeConversation({ id: "c2", project: "proj-b" }),
        makeConversation({ id: "c3", project: "proj-a" }),
      ],
    };
    expect(selectConversationsByProject(state, "proj-a")).toHaveLength(2);
  });
});
