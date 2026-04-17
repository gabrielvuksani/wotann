/**
 * WOTANN Desktop Store — Zustand state management.
 * Single source of truth for the desktop app UI state.
 * Uses immutable update patterns throughout.
 */

import { create } from "zustand";
import type {
  Message,
  ConversationSummary,
  AgentInfo,
  CostSnapshot,
  ContextSource,
  AppView,
  ChatMode,
  LayoutMode,
  SidebarTab,
  MemoryEntry,
  AppSettings,
  ProviderInfo,
  WorkspacePreset,
} from "../types";
import { resolveLegacyView } from "../types";

// ── State Shape ──────────────────────────────────────────

/** Overlay types — at most one open at a time. */
type OverlayType = "commandPalette" | "notificationCenter" | "filePicker" | "quickActions" | "modeSwitcher" | "modelPicker" | "connectionDetails" | "modePicker" | null;

interface DesktopState {
  // UI
  readonly sidebarOpen: boolean;
  readonly contextPanelOpen: boolean;
  readonly chatPaneOpen: boolean;
  readonly commandPaletteOpen: boolean;
  readonly terminalPanelOpen: boolean;
  readonly diffPanelOpen: boolean;
  readonly workerDrawerOpen: boolean;
  readonly activeOverlay: OverlayType;
  readonly layoutMode: LayoutMode;
  readonly currentView: AppView;
  readonly sidebarTab: SidebarTab;

  // Session
  readonly activeConversationId: string | null;
  readonly conversations: readonly ConversationSummary[];
  readonly messages: Readonly<Record<string, readonly Message[]>>;
  readonly isStreaming: boolean;

  // Provider
  readonly provider: string;
  readonly model: string;
  readonly mode: ChatMode;
  readonly providers: readonly ProviderInfo[];

  // Metrics
  readonly contextPercent: number;
  readonly contextSources: readonly ContextSource[];
  readonly cost: CostSnapshot;
  readonly totalTokens: number;

  // Agents
  readonly agents: readonly AgentInfo[];

  // Memory
  readonly memoryEntries: readonly MemoryEntry[];

  // Connection
  readonly engineConnected: boolean;
  readonly onboardingComplete: boolean;

  // Notifications
  readonly notifications: readonly {
    readonly id: string;
    readonly type: "task_complete" | "error" | "approval" | "cost_alert" | "companion" | "agent";
    readonly title: string;
    readonly message: string;
    readonly timestamp: number;
    readonly read: boolean;
  }[];

  // Companion
  readonly pairedDevices: readonly {
    readonly id: string;
    readonly name: string;
    readonly platform: string;
    readonly lastSeen: string;
    readonly connected: boolean;
  }[];

  readonly remoteSessions: readonly {
    readonly id: string;
    readonly deviceName: string;
    readonly connectedAt: number;
    readonly messagesExchanged: number;
    readonly status: "active" | "idle" | "disconnected";
  }[];

  // Settings
  readonly settings: AppSettings;

  // Command palette mode (file-search vs general)
  readonly commandPaletteMode: "general" | "file-search";

  // Exploit mode findings
  readonly exploitFindings: readonly {
    readonly id: string;
    readonly severity: "critical" | "high" | "medium" | "low";
    readonly title: string;
    readonly description: string;
    readonly cvss: number;
    readonly mitre: string;
  }[];

  // Actions
  readonly toggleSidebar: () => void;
  readonly toggleContextPanel: () => void;
  readonly toggleChatPane: () => void;
  readonly toggleCommandPalette: () => void;
  readonly toggleTerminalPanel: () => void;
  readonly toggleDiffPanel: () => void;
  readonly toggleWorkerDrawer: () => void;
  readonly setView: (view: AppView | string) => void;
  readonly setSidebarTab: (tab: SidebarTab) => void;
  readonly setActiveConversation: (id: string | null) => void;
  readonly addConversation: (conv: ConversationSummary) => void;
  readonly addMessage: (conversationId: string, message: Message) => void;
  readonly updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  readonly setStreaming: (streaming: boolean) => void;
  readonly setProvider: (provider: string, model: string) => void;
  readonly setMode: (mode: ChatMode) => void;
  readonly updateCost: (cost: CostSnapshot) => void;
  readonly updateContext: (percent: number, tokens: number, sources: readonly ContextSource[]) => void;
  readonly setEngineConnected: (connected: boolean) => void;
  readonly setOnboardingComplete: () => void;
  readonly setAgents: (agents: readonly AgentInfo[]) => void;
  readonly setMemoryEntries: (entries: readonly MemoryEntry[]) => void;
  readonly updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  readonly setProviders: (providers: readonly ProviderInfo[]) => void;
  readonly addNotification: (notification: { type: "task_complete" | "error" | "approval" | "cost_alert" | "companion" | "agent"; title: string; message: string }) => void;
  readonly markNotificationRead: (id: string) => void;
  readonly clearNotifications: () => void;
  readonly removePairedDevice: (id: string) => void;
  readonly forkConversation: (conversationId: string, atMessageId: string) => void;
  readonly setWorkspacePreset: (preset: WorkspacePreset) => void;
  readonly toggleConversationIncognito: (conversationId: string) => void;
  readonly deleteConversation: (conversationId: string) => void;
  readonly updateConversation: (conversationId: string, updates: Partial<ConversationSummary>) => void;
  readonly removeAgent: (agentId: string) => void;

  // Overlay manager — mutual exclusion
  readonly openOverlay: (overlay: OverlayType) => void;
  readonly closeOverlay: () => void;

  // Layout modes
  readonly setLayoutMode: (mode: LayoutMode) => void;
  readonly enterCodeMode: () => void;
  readonly enterExploitMode: () => void;
}

// ── Default Settings ─────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  autoEnhance: true,
  autoVerify: true,
  autoSelectProvider: true,
  launchAtLogin: false,
  theme: "dark",
  accentColor: "violet",
  fontSize: 14,
  codeFont: "JetBrains Mono",
  notificationsEnabled: true,
  soundAlerts: false,
  budgetAlerts: true,
  dangerousCommandGuard: true,
  blockNoVerify: true,
  configProtection: true,
  loopDetection: true,
  voiceInput: false,
  voiceOutput: false,
  persistentMemory: true,
  autoSaveDiscoveries: true,
  budgetLimit: 50,
  workspacePreset: "developer",
  stealthBrowsing: false,
};

// ── Store ────────────────────────────────────────────────

export const useStore = create<DesktopState>((set) => ({
  // UI
  sidebarOpen: true,
  contextPanelOpen: false,
  chatPaneOpen: true,
  commandPaletteOpen: false,
  terminalPanelOpen: false,
  diffPanelOpen: false,
  workerDrawerOpen: false,
  activeOverlay: null,
  layoutMode: "chat",
  currentView: "chat",
  sidebarTab: "conversations",

  // Session — empty until engine populates via initializeFromEngine()
  activeConversationId: null,
  conversations: [],
  messages: {},
  isStreaming: false,

  // Provider — defaults until engine provides real values
  provider: "",
  model: "",
  mode: "chat",
  providers: [],

  // Metrics — zeroed until engine reports
  contextPercent: 0,
  contextSources: [],
  cost: { sessionCost: 0, todayCost: 0, weekCost: 0, budgetRemaining: null },
  totalTokens: 0,

  // Agents — empty until engine reports
  agents: [],

  // Memory — empty until searched
  memoryEntries: [],

  // Connection — starts disconnected, set to true when engine responds
  engineConnected: false,
  onboardingComplete: !!localStorage.getItem("wotann-onboarded"),

  // Notifications — empty on fresh start
  notifications: [],

  // Companion
  pairedDevices: [],
  remoteSessions: [],

  // Settings
  settings: DEFAULT_SETTINGS,

  // Command palette mode
  commandPaletteMode: "general",

  // Exploit findings
  exploitFindings: [],

  // Actions (all immutable)
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
  toggleChatPane: () => set((s) => ({ chatPaneOpen: !s.chatPaneOpen })),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  toggleTerminalPanel: () => set((s) => ({ terminalPanelOpen: !s.terminalPanelOpen })),
  toggleDiffPanel: () => set((s) => ({ diffPanelOpen: !s.diffPanelOpen })),
  toggleWorkerDrawer: () => set((s) => ({ workerDrawerOpen: !s.workerDrawerOpen })),
  setView: (view) => set({ currentView: resolveLegacyView(view) }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  addConversation: (conv) => set((s) => ({ conversations: [conv, ...s.conversations] })),
  addMessage: (conversationId, message) =>
    set((s) => {
      const existing = s.messages[conversationId] ?? [];
      return { messages: { ...s.messages, [conversationId]: [...existing, message] } };
    }),
  updateMessage: (conversationId, messageId, updates) =>
    set((s) => {
      const existing = s.messages[conversationId] ?? [];
      return {
        messages: {
          ...s.messages,
          [conversationId]: existing.map((m) =>
            m.id === messageId ? { ...m, ...updates } : m,
          ),
        },
      };
    }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setProvider: (provider, model) => {
    // Validate against available providers so we can't get stuck in a
    // state where the header pill shows "openai/gpt-5" but the dropdown
    // only has "ollama/gemma" available. Silent reject would hide the
    // bug; surface a notification instead so the user knows why their
    // click didn't take.
    const state = useStore.getState();
    const target = state.providers.find((p) => p.id === provider);
    const modelValid = target?.models.some((m) => m.id === model) ?? false;
    if (!target || !target.enabled || !modelValid) {
      // Add a notification for the user
      const id = `notif-invalid-${Date.now()}`;
      set((s) => ({
        notifications: [
          ...s.notifications,
          {
            id,
            type: "error",
            title: "Provider unavailable",
            message: `${provider}/${model} is not in the enabled providers list — selection ignored.`,
            timestamp: Date.now(),
            read: false,
          },
        ],
      }));
      return;
    }

    set({ provider, model });
    localStorage.setItem("wotann-selected-provider", provider);
    localStorage.setItem("wotann-selected-model", model);
    // Sync to Rust AppState — this is the channel send_message_streaming uses
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("switch_provider", { provider, model }).catch(() => {});
      })
      .catch(() => {});
    // Also tell the daemon config so it survives restarts
    import("../store/engine")
      .then(({ setConfig }) => {
        setConfig("active_provider", provider).catch(() => {});
        setConfig("active_model", model).catch(() => {});
      })
      .catch(() => {});
  },
  setMode: (mode) => set({ mode }),
  updateCost: (cost) => set({ cost }),
  updateContext: (percent, tokens, sources) =>
    set({ contextPercent: percent, totalTokens: tokens, contextSources: sources }),
  setEngineConnected: (connected) => set({ engineConnected: connected }),
  setOnboardingComplete: () => {
    localStorage.setItem("wotann-onboarded", "true");
    set({ onboardingComplete: true });
  },
  setAgents: (agents) => set({ agents }),
  setMemoryEntries: (entries) => set({ memoryEntries: entries }),
  updateSetting: (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
    // Debounced save to disk — 300ms after last change
    if (typeof window !== "undefined") {
      clearTimeout((window as any).__settingsSaveTimer);
      (window as any).__settingsSaveTimer = setTimeout(async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const state = useStore.getState();
          await invoke("save_settings", { settings: state.settings });
        } catch { /* not in Tauri context */ }
      }, 300);
    }
  },
  setProviders: (providers) => set({ providers }),
  addNotification: (notification) =>
    set((s) => ({
      notifications: [
        {
          ...notification,
          id: `notif-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
          timestamp: Date.now(),
          read: false,
        },
        ...s.notifications,
      ].slice(0, 100), // Keep max 100 notifications
    })),
  markNotificationRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    })),
  clearNotifications: () => set({ notifications: [] }),
  removePairedDevice: (id) =>
    set((s) => ({
      pairedDevices: s.pairedDevices.filter((d) => d.id !== id),
    })),
  forkConversation: (conversationId, atMessageId) =>
    set((s) => {
      const sourceMessages = s.messages[conversationId] ?? [];
      const cutIndex = sourceMessages.findIndex((m) => m.id === atMessageId);
      if (cutIndex < 0) return {};
      const forkedMessages = sourceMessages.slice(0, cutIndex + 1).map((m) => ({
        ...m,
        id: `${m.id}-fork-${Date.now()}`,
      }));
      const newId = `conv-fork-${Date.now()}`;
      const sourceConv = s.conversations.find((c) => c.id === conversationId);
      const newConv: ConversationSummary = {
        id: newId,
        title: `Fork: ${sourceConv?.title ?? "conversation"}`,
        preview: forkedMessages[forkedMessages.length - 1]?.content.slice(0, 80) ?? "",
        updatedAt: Date.now(),
        provider: sourceConv?.provider ?? "anthropic",
        model: sourceConv?.model ?? "",
        cost: 0,
        messageCount: forkedMessages.length,
        parentId: conversationId,
      };
      return {
        conversations: [newConv, ...s.conversations],
        messages: { ...s.messages, [newId]: forkedMessages },
        activeConversationId: newId,
      };
    }),
  setWorkspacePreset: (preset) => {
    set((s) => ({ settings: { ...s.settings, workspacePreset: preset } }));
    // Persist via the same debounced save mechanism
    if (typeof window !== "undefined") {
      clearTimeout((window as any).__settingsSaveTimer);
      (window as any).__settingsSaveTimer = setTimeout(async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const state = useStore.getState();
          await invoke("save_settings", { settings: state.settings });
        } catch { /* not in Tauri context */ }
      }, 300);
    }
  },
  toggleConversationIncognito: (conversationId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, incognito: !c.incognito } : c,
      ),
    })),
  deleteConversation: (conversationId) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== conversationId),
      activeConversationId: s.activeConversationId === conversationId ? null : s.activeConversationId,
      messages: Object.fromEntries(
        Object.entries(s.messages).filter(([k]) => k !== conversationId),
      ),
    })),
  updateConversation: (conversationId, updates) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, ...updates } : c,
      ),
    })),
  removeAgent: (agentId) =>
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== agentId),
    })),

  // Overlay manager — opening one auto-closes others
  openOverlay: (overlay) => set({ activeOverlay: overlay, commandPaletteOpen: overlay === "commandPalette" }),
  closeOverlay: () => set({ activeOverlay: null, commandPaletteOpen: false }),

  // Layout modes
  setLayoutMode: (mode) => set({ layoutMode: mode }),
  enterCodeMode: () => set({
    layoutMode: "code",
    currentView: "editor" as AppView,
    chatPaneOpen: true,
    mode: "build" as ChatMode,
  }),
  enterExploitMode: () => set({
    layoutMode: "exploit",
    currentView: "exploit" as AppView,
    chatPaneOpen: true,
  }),
}));
