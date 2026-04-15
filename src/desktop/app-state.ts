/**
 * Desktop App State — central state management for the macOS desktop application.
 *
 * Implements a pure-function reducer pattern with immutable updates.
 * All state transitions return new objects; nothing is mutated.
 *
 * State shape mirrors the desktop UI layout:
 * - Sidebar (conversations, projects, skills, channels, settings)
 * - Main area (active conversation, streaming, artifacts)
 * - Overlays (command palette, context panel, diff viewer)
 * - Status bar (cost, context %, provider/model, mode)
 */

import type { WotannMode } from "../core/mode-cycling.js";
import type { CompanionDevice } from "./types.js";
import type { Conversation, DesktopMessage } from "./conversation-manager.js";
import type { Artifact } from "./artifacts.js";
import { resolveDefaultProvider } from "../core/default-provider.js";

// ── State Types ────────────────────────────────────────

export type SidebarTab = "conversations" | "projects" | "skills" | "channels" | "settings";

export type ThemePreference = "system" | "light" | "dark";

export interface AppNotification {
  readonly id: string;
  readonly type:
    | "task-complete"
    | "error"
    | "channel-message"
    | "budget-alert"
    | "companion-paired";
  readonly title: string;
  readonly body: string;
  readonly timestamp: string;
  readonly read: boolean;
  readonly actionUrl?: string;
}

export interface DesktopAppState {
  readonly conversations: readonly Conversation[];
  readonly activeConversationId: string | null;
  readonly sidebarOpen: boolean;
  readonly sidebarTab: SidebarTab;
  readonly commandPaletteOpen: boolean;
  readonly contextPanelOpen: boolean;
  readonly diffViewerOpen: boolean;
  readonly theme: ThemePreference;
  readonly isStreaming: boolean;
  readonly voiceActive: boolean;
  readonly companionDevices: readonly CompanionDevice[];
  readonly notifications: readonly AppNotification[];
  readonly costToday: number;
  readonly contextPercent: number;
  /**
   * Active provider/model from the last user selection, discovered config,
   * or env detection. `null` means "no provider configured" — the UI shows
   * the onboarding/setup flow instead of pretending Anthropic is selected.
   */
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly currentMode: WotannMode;
}

// ── Actions ────────────────────────────────────────────

export type AppAction =
  | { readonly type: "CREATE_CONVERSATION"; readonly conversation: Conversation }
  | { readonly type: "DELETE_CONVERSATION"; readonly conversationId: string }
  | { readonly type: "SWITCH_CONVERSATION"; readonly conversationId: string }
  | {
      readonly type: "UPDATE_CONVERSATION";
      readonly conversationId: string;
      readonly updates: Partial<Conversation>;
    }
  | {
      readonly type: "APPEND_MESSAGE";
      readonly conversationId: string;
      readonly message: DesktopMessage;
    }
  | { readonly type: "SET_STREAMING"; readonly isStreaming: boolean }
  | { readonly type: "SET_VOICE_ACTIVE"; readonly voiceActive: boolean }
  | { readonly type: "TOGGLE_SIDEBAR" }
  | { readonly type: "SET_SIDEBAR_TAB"; readonly tab: SidebarTab }
  | { readonly type: "TOGGLE_COMMAND_PALETTE" }
  | { readonly type: "TOGGLE_CONTEXT_PANEL" }
  | { readonly type: "TOGGLE_DIFF_VIEWER" }
  | { readonly type: "SET_THEME"; readonly theme: ThemePreference }
  | { readonly type: "ADD_NOTIFICATION"; readonly notification: AppNotification }
  | { readonly type: "DISMISS_NOTIFICATION"; readonly notificationId: string }
  | { readonly type: "MARK_NOTIFICATION_READ"; readonly notificationId: string }
  | { readonly type: "ADD_COMPANION_DEVICE"; readonly device: CompanionDevice }
  | { readonly type: "REMOVE_COMPANION_DEVICE"; readonly deviceId: string }
  | { readonly type: "UPDATE_COST"; readonly costToday: number }
  | { readonly type: "UPDATE_CONTEXT"; readonly contextPercent: number }
  | { readonly type: "SET_PROVIDER"; readonly provider: string; readonly model: string }
  | { readonly type: "SET_MODE"; readonly mode: WotannMode }
  | {
      readonly type: "PIN_ARTIFACT";
      readonly conversationId: string;
      readonly messageId: string;
      readonly artifactId: string;
    }
  | {
      readonly type: "UNPIN_ARTIFACT";
      readonly conversationId: string;
      readonly messageId: string;
      readonly artifactId: string;
    };

// ── Initial State ──────────────────────────────────────

/**
 * Initial state with an honest "no provider configured" default (S1-18).
 *
 * The previous implementation hardcoded activeProvider/activeModel to
 * "anthropic" / "claude-sonnet-4-6" — which showed "Anthropic" as the
 * selected provider in the status bar even for users who had only
 * configured Gemini or were still onboarding. resolveDefaultProvider()
 * probes (in order): WOTANN_DEFAULT_PROVIDER env, ~/.wotann/wotann.yaml,
 * then individual provider env keys. If nothing resolves we leave both
 * fields null so the UI knows to show onboarding.
 */
const INITIAL_DEFAULT = resolveDefaultProvider();

export const INITIAL_STATE: DesktopAppState = {
  conversations: [],
  activeConversationId: null,
  sidebarOpen: true,
  sidebarTab: "conversations",
  commandPaletteOpen: false,
  contextPanelOpen: false,
  diffViewerOpen: false,
  theme: "system",
  isStreaming: false,
  voiceActive: false,
  companionDevices: [],
  notifications: [],
  costToday: 0,
  contextPercent: 0,
  activeProvider: INITIAL_DEFAULT?.provider ?? null,
  activeModel: INITIAL_DEFAULT?.model ?? null,
  currentMode: "default",
};

// ── Reducer ────────────────────────────────────────────

export function appReducer(state: DesktopAppState, action: AppAction): DesktopAppState {
  switch (action.type) {
    case "CREATE_CONVERSATION":
      return {
        ...state,
        conversations: [...state.conversations, action.conversation],
        activeConversationId: action.conversation.id,
      };

    case "DELETE_CONVERSATION": {
      const filtered = state.conversations.filter((c) => c.id !== action.conversationId);
      const newActive =
        state.activeConversationId === action.conversationId
          ? (filtered[0]?.id ?? null)
          : state.activeConversationId;
      return { ...state, conversations: filtered, activeConversationId: newActive };
    }

    case "SWITCH_CONVERSATION":
      return { ...state, activeConversationId: action.conversationId };

    case "UPDATE_CONVERSATION":
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.conversationId ? { ...c, ...action.updates } : c,
        ),
      };

    case "APPEND_MESSAGE":
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.conversationId
            ? {
                ...c,
                messages: [...c.messages, action.message],
                updatedAt: action.message.timestamp,
              }
            : c,
        ),
      };

    case "SET_STREAMING":
      return { ...state, isStreaming: action.isStreaming };

    case "SET_VOICE_ACTIVE":
      return { ...state, voiceActive: action.voiceActive };

    case "TOGGLE_SIDEBAR":
      return { ...state, sidebarOpen: !state.sidebarOpen };

    case "SET_SIDEBAR_TAB":
      return { ...state, sidebarTab: action.tab, sidebarOpen: true };

    case "TOGGLE_COMMAND_PALETTE":
      return { ...state, commandPaletteOpen: !state.commandPaletteOpen };

    case "TOGGLE_CONTEXT_PANEL":
      return { ...state, contextPanelOpen: !state.contextPanelOpen };

    case "TOGGLE_DIFF_VIEWER":
      return { ...state, diffViewerOpen: !state.diffViewerOpen };

    case "SET_THEME":
      return { ...state, theme: action.theme };

    case "ADD_NOTIFICATION":
      return { ...state, notifications: [...state.notifications, action.notification] };

    case "DISMISS_NOTIFICATION":
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== action.notificationId),
      };

    case "MARK_NOTIFICATION_READ":
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.notificationId ? { ...n, read: true } : n,
        ),
      };

    case "ADD_COMPANION_DEVICE":
      return { ...state, companionDevices: [...state.companionDevices, action.device] };

    case "REMOVE_COMPANION_DEVICE":
      return {
        ...state,
        companionDevices: state.companionDevices.filter((d) => d.id !== action.deviceId),
      };

    case "UPDATE_COST":
      return { ...state, costToday: action.costToday };

    case "UPDATE_CONTEXT":
      return { ...state, contextPercent: action.contextPercent };

    case "SET_PROVIDER":
      return { ...state, activeProvider: action.provider, activeModel: action.model };

    case "SET_MODE":
      return { ...state, currentMode: action.mode };

    case "PIN_ARTIFACT":
      return updateArtifactInState(
        state,
        action.conversationId,
        action.messageId,
        action.artifactId,
        true,
      );

    case "UNPIN_ARTIFACT":
      return updateArtifactInState(
        state,
        action.conversationId,
        action.messageId,
        action.artifactId,
        false,
      );
  }
}

// ── Selectors ──────────────────────────────────────────

export function selectActiveConversation(state: DesktopAppState): Conversation | undefined {
  return state.conversations.find((c) => c.id === state.activeConversationId);
}

export function selectUnreadNotificationCount(state: DesktopAppState): number {
  return state.notifications.filter((n) => !n.read).length;
}

export function selectPinnedConversations(state: DesktopAppState): readonly Conversation[] {
  return state.conversations.filter((c) => c.pinned);
}

export function selectConversationsByProject(
  state: DesktopAppState,
  projectId: string,
): readonly Conversation[] {
  return state.conversations.filter((c) => c.project === projectId);
}

// ── Helpers ────────────────────────────────────────────

function updateArtifactInState(
  state: DesktopAppState,
  conversationId: string,
  messageId: string,
  artifactId: string,
  pinned: boolean,
): DesktopAppState {
  return {
    ...state,
    conversations: state.conversations.map((c) => {
      if (c.id !== conversationId) return c;
      return {
        ...c,
        messages: c.messages.map((m) => {
          if (m.id !== messageId) return m;
          const artifacts: readonly Artifact[] = (m.artifacts ?? []).map((a) =>
            a.id === artifactId ? { ...a, pinned } : a,
          );
          return { ...m, artifacts };
        }),
      };
    }),
  };
}
