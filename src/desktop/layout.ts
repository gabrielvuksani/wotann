/**
 * Desktop App Layout System
 *
 * Defines the visual structure of the WOTANN desktop app.
 * The layout is a 3-column design inspired by Cursor 3 + Claude Desktop:
 *
 * ┌──────────┬───────────────────────────────┬──────────┐
 * │          │        Header Bar             │          │
 * │ Sidebar  ├───────────────────────────────┤ Context  │
 * │          │                               │  Panel   │
 * │ - Convos │      Main Content Area        │          │
 * │ - Projs  │      (Chat / Arena / Canvas)  │ - Files  │
 * │ - Skills │                               │ - Memory │
 * │ - Chans  │                               │ - Context│
 * │          │                               │ - Proof  │
 * │          ├───────────────────────────────┤          │
 * │          │     Prompt Input + Enhance    │          │
 * │          │     ┌─────────────┐ ┌──┐ ┌──┐│          │
 * │          │     │  Type here  │ │✨│ │🎤││          │
 * │          │     └─────────────┘ └──┘ └──┘│          │
 * ├──────────┴───────────────────────────────┴──────────┤
 * │              Status Bar (full width)                 │
 * └─────────────────────────────────────────────────────┘
 *
 * RESPONSIVE BEHAVIOR:
 * - Sidebar collapses to icons at < 900px
 * - Context panel hides at < 1100px
 * - Full single-column at < 700px
 */

// ── Layout Types ────────────────────────────────────────

export type LayoutMode = "full" | "compact" | "focused" | "mini";

export interface LayoutConfig {
  readonly mode: LayoutMode;
  readonly sidebarWidth: number;
  readonly contextPanelWidth: number;
  readonly sidebarCollapsed: boolean;
  readonly contextPanelVisible: boolean;
  readonly headerVisible: boolean;
  readonly statusBarVisible: boolean;
}

export interface PanelState {
  readonly id: string;
  readonly visible: boolean;
  readonly width: number;
  readonly position: "left" | "right" | "bottom" | "floating";
  readonly pinned: boolean;
}

// ── Default Layouts ─────────────────────────────────────

export const FULL_LAYOUT: LayoutConfig = {
  mode: "full",
  sidebarWidth: 260,
  contextPanelWidth: 320,
  sidebarCollapsed: false,
  contextPanelVisible: true,
  headerVisible: true,
  statusBarVisible: true,
};

export const COMPACT_LAYOUT: LayoutConfig = {
  mode: "compact",
  sidebarWidth: 52, // icon-only
  contextPanelWidth: 0,
  sidebarCollapsed: true,
  contextPanelVisible: false,
  headerVisible: true,
  statusBarVisible: true,
};

export const FOCUSED_LAYOUT: LayoutConfig = {
  mode: "focused",
  sidebarWidth: 0,
  contextPanelWidth: 0,
  sidebarCollapsed: true,
  contextPanelVisible: false,
  headerVisible: false,
  statusBarVisible: true,
};

export const MINI_LAYOUT: LayoutConfig = {
  mode: "mini",
  sidebarWidth: 0,
  contextPanelWidth: 0,
  sidebarCollapsed: true,
  contextPanelVisible: false,
  headerVisible: false,
  statusBarVisible: false,
};

// ── Sidebar Tabs ────────────────────────────────────────

export type SidebarTab =
  | "conversations"
  | "projects"
  | "skills"
  | "channels"
  | "memory"
  | "settings";

export interface SidebarTabConfig {
  readonly id: SidebarTab;
  readonly label: string;
  readonly icon: string;
  readonly shortcut: string;
  readonly badge?: number;
}

export const SIDEBAR_TABS: readonly SidebarTabConfig[] = [
  { id: "conversations", label: "Chats", icon: "message-circle", shortcut: "Cmd+1" },
  { id: "projects", label: "Projects", icon: "folder", shortcut: "Cmd+2" },
  { id: "skills", label: "Skills", icon: "zap", shortcut: "Cmd+3" },
  { id: "channels", label: "Channels", icon: "radio", shortcut: "Cmd+4" },
  { id: "memory", label: "Memory", icon: "brain", shortcut: "Cmd+5" },
  { id: "settings", label: "Settings", icon: "settings", shortcut: "Cmd+," },
];

// ── Context Panel Sections ──────────────────────────────

export type ContextSection =
  | "files"        // Files in context
  | "memory"       // Active memory entries
  | "context"      // Context window breakdown
  | "proof"        // Proof bundle from last autonomous run
  | "artifacts"    // Pinned artifacts
  | "agents"       // Running subagents
  | "channels"     // Active channel connections
  | "cost";        // Cost breakdown

export interface ContextSectionConfig {
  readonly id: ContextSection;
  readonly label: string;
  readonly icon: string;
  readonly collapsible: boolean;
  readonly defaultExpanded: boolean;
}

export const CONTEXT_SECTIONS: readonly ContextSectionConfig[] = [
  { id: "context", label: "Context Window", icon: "gauge", collapsible: true, defaultExpanded: true },
  { id: "files", label: "Files in Context", icon: "file-text", collapsible: true, defaultExpanded: true },
  { id: "memory", label: "Active Memory", icon: "database", collapsible: true, defaultExpanded: false },
  { id: "artifacts", label: "Artifacts", icon: "layers", collapsible: true, defaultExpanded: true },
  { id: "agents", label: "Agents", icon: "cpu", collapsible: true, defaultExpanded: false },
  { id: "proof", label: "Proof Bundle", icon: "shield-check", collapsible: true, defaultExpanded: false },
  { id: "channels", label: "Channels", icon: "radio", collapsible: true, defaultExpanded: false },
  { id: "cost", label: "Cost", icon: "dollar-sign", collapsible: true, defaultExpanded: false },
];

// ── Prompt Bar Configuration ────────────────────────────

export interface PromptBarConfig {
  readonly showEnhanceButton: boolean;
  readonly showVoiceButton: boolean;
  readonly showModelPicker: boolean;
  readonly showModePicker: boolean;
  readonly showAttachButton: boolean;
  readonly showSendButton: boolean;
  readonly maxHeight: number;
  readonly placeholder: string;
}

export const DEFAULT_PROMPT_BAR: PromptBarConfig = {
  showEnhanceButton: true,
  showVoiceButton: true,
  showModelPicker: true,
  showModePicker: true,
  showAttachButton: true,
  showSendButton: true,
  maxHeight: 200,
  placeholder: "Ask WOTANN anything... (Cmd+K for commands, Cmd+E to enhance)",
};

// ── Layout Calculation ──────────────────────────────────

export function calculateLayout(windowWidth: number, _windowHeight: number): LayoutConfig {
  if (windowWidth < 700) return MINI_LAYOUT;
  if (windowWidth < 900) return FOCUSED_LAYOUT;
  if (windowWidth < 1100) return COMPACT_LAYOUT;
  return FULL_LAYOUT;
}

export function getMainContentWidth(layout: LayoutConfig, windowWidth: number): number {
  const sidebarWidth = layout.sidebarCollapsed ? 0 : layout.sidebarWidth;
  const contextWidth = layout.contextPanelVisible ? layout.contextPanelWidth : 0;
  return Math.max(400, windowWidth - sidebarWidth - contextWidth);
}

// ── Animation Configuration ─────────────────────────────

export interface AnimationConfig {
  readonly sidebarTransitionMs: number;
  readonly panelTransitionMs: number;
  readonly messageAppearMs: number;
  readonly streamingCursorBlinkMs: number;
  readonly enhanceShimmerMs: number;
}

export const DEFAULT_ANIMATIONS: AnimationConfig = {
  sidebarTransitionMs: 200,
  panelTransitionMs: 150,
  messageAppearMs: 100,
  streamingCursorBlinkMs: 500,
  enhanceShimmerMs: 1500,
};
