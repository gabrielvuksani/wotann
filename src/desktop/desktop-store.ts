/**
 * Desktop Store -- Zustand-compatible state management types and factory.
 *
 * Defines the shape of the desktop application store that mirrors
 * the appReducer from app-state.ts but structured for Zustand.
 * The actual Zustand store instance is created in desktop-app/src/store/
 * using these types.
 *
 * This module exports:
 *   - ConversationSummary: lightweight conversation representation
 *   - DesktopStoreState: the state slice (data)
 *   - DesktopStoreActions: the action slice (mutations)
 *   - DesktopStore: combined state + actions
 *   - createInitialState: factory for initial state
 *   - applyStoreAction: pure-function state transitions
 *
 * All state transitions create new objects (immutable pattern).
 */

// -- Conversation Summary ---------------------------------------------------

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly updatedAt: number;
  readonly provider: string;
  readonly model: string;
  readonly cost: number;
  readonly messageCount: number;
  readonly pinned: boolean;
  readonly project: string | null;
}

// -- Theme ------------------------------------------------------------------

export type DesktopTheme = "dark" | "light";

// -- State Slice ------------------------------------------------------------

export interface DesktopStoreState {
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId: string | null;
  readonly isStreaming: boolean;
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly contextPercent: number;
  readonly sessionCost: number;
  readonly todayCost: number;
  readonly workerCount: number;
  readonly theme: DesktopTheme;
}

// -- Action Slice -----------------------------------------------------------

export interface DesktopStoreActions {
  readonly setActiveConversation: (id: string) => void;
  readonly addConversation: (conv: ConversationSummary) => void;
  readonly removeConversation: (id: string) => void;
  readonly updateConversation: (id: string, updates: Partial<ConversationSummary>) => void;
  readonly setProvider: (provider: string, model: string) => void;
  readonly setMode: (mode: string) => void;
  readonly updateCost: (session: number, today: number) => void;
  readonly setStreaming: (streaming: boolean) => void;
  readonly setWorkerCount: (count: number) => void;
  readonly setContextPercent: (percent: number) => void;
  readonly toggleTheme: () => void;
  readonly pinConversation: (id: string) => void;
  readonly unpinConversation: (id: string) => void;
}

// -- Combined Store ---------------------------------------------------------

export type DesktopStore = DesktopStoreState & DesktopStoreActions;

// -- Initial State Factory --------------------------------------------------

export function createInitialState(overrides: Partial<DesktopStoreState> = {}): DesktopStoreState {
  return {
    conversations: [],
    activeConversationId: null,
    isStreaming: false,
    provider: "ollama",
    model: "gemma4:e4b",
    mode: "default",
    contextPercent: 0,
    sessionCost: 0,
    todayCost: 0,
    workerCount: 0,
    theme: "dark",
    ...overrides,
  };
}

// -- Pure State Transitions -------------------------------------------------
// These mirror the appReducer logic but as standalone functions
// suitable for Zustand's set() pattern.

export type StoreAction =
  | { readonly type: "SET_ACTIVE_CONVERSATION"; readonly id: string }
  | { readonly type: "ADD_CONVERSATION"; readonly conversation: ConversationSummary }
  | { readonly type: "REMOVE_CONVERSATION"; readonly id: string }
  | {
      readonly type: "UPDATE_CONVERSATION";
      readonly id: string;
      readonly updates: Partial<ConversationSummary>;
    }
  | { readonly type: "SET_PROVIDER"; readonly provider: string; readonly model: string }
  | { readonly type: "SET_MODE"; readonly mode: string }
  | { readonly type: "UPDATE_COST"; readonly session: number; readonly today: number }
  | { readonly type: "SET_STREAMING"; readonly streaming: boolean }
  | { readonly type: "SET_WORKER_COUNT"; readonly count: number }
  | { readonly type: "SET_CONTEXT_PERCENT"; readonly percent: number }
  | { readonly type: "TOGGLE_THEME" }
  | { readonly type: "PIN_CONVERSATION"; readonly id: string }
  | { readonly type: "UNPIN_CONVERSATION"; readonly id: string };

/**
 * Pure-function state reducer for all store actions.
 * Returns a new state object -- never mutates the input.
 */
export function applyStoreAction(state: DesktopStoreState, action: StoreAction): DesktopStoreState {
  switch (action.type) {
    case "SET_ACTIVE_CONVERSATION":
      return { ...state, activeConversationId: action.id };

    case "ADD_CONVERSATION":
      return {
        ...state,
        conversations: [...state.conversations, action.conversation],
        activeConversationId: action.conversation.id,
      };

    case "REMOVE_CONVERSATION": {
      const filtered = state.conversations.filter((c) => c.id !== action.id);
      const newActive =
        state.activeConversationId === action.id
          ? (filtered[0]?.id ?? null)
          : state.activeConversationId;
      return { ...state, conversations: filtered, activeConversationId: newActive };
    }

    case "UPDATE_CONVERSATION":
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.id ? { ...c, ...action.updates } : c,
        ),
      };

    case "SET_PROVIDER":
      return { ...state, provider: action.provider, model: action.model };

    case "SET_MODE":
      return { ...state, mode: action.mode };

    case "UPDATE_COST":
      return { ...state, sessionCost: action.session, todayCost: action.today };

    case "SET_STREAMING":
      return { ...state, isStreaming: action.streaming };

    case "SET_WORKER_COUNT":
      return { ...state, workerCount: action.count };

    case "SET_CONTEXT_PERCENT":
      return { ...state, contextPercent: action.percent };

    case "TOGGLE_THEME":
      return { ...state, theme: state.theme === "dark" ? "light" : "dark" };

    case "PIN_CONVERSATION":
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.id ? { ...c, pinned: true } : c,
        ),
      };

    case "UNPIN_CONVERSATION":
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.id ? { ...c, pinned: false } : c,
        ),
      };
  }
}

// -- Selectors --------------------------------------------------------------

export function selectActiveConversation(
  state: DesktopStoreState,
): ConversationSummary | undefined {
  return state.conversations.find((c) => c.id === state.activeConversationId);
}

export function selectPinnedConversations(
  state: DesktopStoreState,
): readonly ConversationSummary[] {
  return state.conversations.filter((c) => c.pinned);
}

export function selectConversationsByProject(
  state: DesktopStoreState,
  projectId: string,
): readonly ConversationSummary[] {
  return state.conversations.filter((c) => c.project === projectId);
}

export function selectTotalCost(state: DesktopStoreState): number {
  return state.conversations.reduce((sum, c) => sum + c.cost, 0);
}
