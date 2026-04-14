/**
 * Workspace preset configurations.
 * Presets REORDER and EMPHASIZE UI elements based on user role
 * but NEVER hide features -- everything remains accessible.
 */

import type { WorkspacePreset, SidebarTab } from "../types";

// ── Quick Action Config ─────────────────────────────────

export interface QuickActionConfig {
  readonly label: string;
  readonly icon: string;
  readonly action: string;
  readonly description: string;
}

// ── Preset Config ───────────────────────────────────────

export interface PresetConfig {
  readonly label: string;
  readonly description: string;
  readonly quickActions: readonly QuickActionConfig[];
  /** Reserved for future use: sidebar tabs to emphasize per preset. Not consumed yet. */
  readonly sidebarEmphasis: readonly SidebarTab[];
  /** Reserved for future use: extra status bar items per preset. Not consumed yet. */
  readonly statusBarExtras: readonly string[];
}

// ── Preset Definitions ──────────────────────────────────

export const WORKSPACE_PRESETS: Readonly<Record<WorkspacePreset, PresetConfig>> = {
  developer: {
    label: "Developer",
    description: "Editor, Terminal, Git, Tests + Research",
    quickActions: [
      { label: "Start coding", icon: "code", action: "editor", description: "Open the code editor" },
      { label: "Run tests", icon: "play", action: "test", description: "Run project tests" },
      { label: "Review code", icon: "diff", action: "review", description: "Open diff view" },
      { label: "Research", icon: "search", action: "research", description: "Deep research a topic" },
      { label: "Compare models", icon: "columns", action: "compare", description: "Side-by-side comparison" },
      { label: "Check costs", icon: "dollar", action: "cost", description: "View spending" },
    ],
    sidebarEmphasis: ["conversations", "projects", "agents"],
    statusBarExtras: ["git-branch", "test-status"],
  },
  security: {
    label: "Security Pro",
    description: "Exploit mode, Findings, MITRE + Research",
    quickActions: [
      { label: "Security scan", icon: "shield", action: "exploit", description: "Run security analysis" },
      { label: "Research vuln", icon: "search", action: "research", description: "Research a vulnerability" },
      { label: "Review code", icon: "diff", action: "review", description: "Security code review" },
      { label: "Start coding", icon: "code", action: "editor", description: "Open the code editor" },
      { label: "Compare models", icon: "columns", action: "compare", description: "Model comparison" },
      { label: "Check costs", icon: "dollar", action: "cost", description: "View spending" },
    ],
    sidebarEmphasis: ["conversations", "agents", "skills"],
    statusBarExtras: ["findings-count", "engagement-scope"],
  },
  pm: {
    label: "Project Manager",
    description: "Tasks, Specs, Dispatch, Reports + Research",
    quickActions: [
      { label: "View tasks", icon: "list", action: "tasks", description: "Monitor active tasks" },
      { label: "Dispatch work", icon: "send", action: "dispatch", description: "Send work to agents" },
      { label: "Research topic", icon: "search", action: "research", description: "Deep research" },
      { label: "Scheduled jobs", icon: "clock", action: "scheduled", description: "Recurring tasks" },
      { label: "Compare models", icon: "columns", action: "compare", description: "Model comparison" },
      { label: "Check costs", icon: "dollar", action: "cost", description: "View spending" },
    ],
    sidebarEmphasis: ["conversations", "agents", "skills"],
    statusBarExtras: ["active-tasks", "dispatched-count"],
  },
  analyst: {
    label: "Analyst",
    description: "Playground, Charts, Data + Research",
    quickActions: [
      { label: "Playground", icon: "terminal", action: "playground", description: "Code playground" },
      { label: "Research data", icon: "search", action: "research", description: "Deep data research" },
      { label: "Compare models", icon: "columns", action: "compare", description: "Model comparison" },
      { label: "Provider costs", icon: "bar-chart", action: "arbitrage", description: "Cost comparison" },
      { label: "Start coding", icon: "code", action: "editor", description: "Open the code editor" },
      { label: "Check costs", icon: "dollar", action: "cost", description: "View spending" },
    ],
    sidebarEmphasis: ["conversations", "projects", "agents"],
    statusBarExtras: ["data-sources", "query-count"],
  },
};

// ── Icon Mapping ────────────────────────────────────────
// Maps icon names to inline SVG string + background color for quick action cards.

export interface QuickActionVisual {
  readonly svg: string;
  readonly bg: string;
}

const ICON_VISUALS: Readonly<Record<string, QuickActionVisual>> = {
  code: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 4 1 8 5 12"/><polyline points="11 4 15 8 11 12"/></svg>',
    bg: "rgba(10, 132, 255, 0.08)",
  },
  play: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2"/><polyline points="6 11 6 5 11 8 6 11"/></svg>',
    bg: "rgba(16, 185, 129, 0.06)",
  },
  diff: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
    bg: "rgba(59, 130, 246, 0.06)",
  },
  search: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/><path d="M5.5 7h3M7 5.5v3"/></svg>',
    bg: "rgba(59, 130, 246, 0.06)",
  },
  columns: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="3" width="5" height="10" rx="1"/><rect x="9.5" y="3" width="5" height="10" rx="1"/></svg>',
    bg: "rgba(6, 182, 212, 0.06)",
  },
  dollar: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v14"/><path d="M11.5 4H6.25a2.25 2.25 0 000 4.5h3.5a2.25 2.25 0 010 4.5H4"/></svg>',
    bg: "rgba(245, 158, 11, 0.06)",
  },
  shield: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V4L8 1.5z"/></svg>',
    bg: "rgba(239, 68, 68, 0.06)",
  },
  list: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 5.5h1M5 8h1M5 10.5h1M8 5.5h3M8 8h3M8 10.5h3"/></svg>',
    bg: "rgba(10, 132, 255, 0.08)",
  },
  send: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 1.5l-6 13-2.5-5.5L.5 6.5l14-5z"/><path d="M14.5 1.5L6 9"/></svg>',
    bg: "rgba(16, 185, 129, 0.06)",
  },
  clock: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4v4l2.5 2.5"/></svg>',
    bg: "rgba(245, 158, 11, 0.06)",
  },
  terminal: {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="2"/><path d="M4.5 6l2.5 2-2.5 2M8.5 10h3"/></svg>',
    bg: "rgba(10, 132, 255, 0.08)",
  },
  "bar-chart": {
    svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13V8M8 13V3M12 13V6"/></svg>',
    bg: "rgba(6, 182, 212, 0.06)",
  },
};

const DEFAULT_VISUAL: QuickActionVisual = {
  svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 10v1"/></svg>',
  bg: "rgba(10, 132, 255, 0.06)",
};

export function getQuickActionVisual(icon: string): QuickActionVisual {
  return ICON_VISUALS[icon] ?? DEFAULT_VISUAL;
}

// ── Action-to-Mode Mapping ──────────────────────────────
// Maps preset action strings to ChatMode or AppView navigation.

import type { ChatMode, AppView } from "../types";

export interface ActionRoute {
  readonly type: "mode" | "view";
  readonly target: ChatMode | AppView;
  readonly engineAction?: "deep_research";
  /** Sub-tab routing for the workshop view */
  readonly workshopTab?: "active" | "inbox" | "scheduled";
}

const ACTION_ROUTES: Readonly<Record<string, ActionRoute>> = {
  editor:     { type: "view", target: "editor" },
  test:       { type: "mode", target: "build" },
  review:     { type: "mode", target: "review" },
  research:   { type: "mode", target: "chat", engineAction: "deep_research" },
  compare:    { type: "view", target: "compare" },
  cost:       { type: "view", target: "cost" },
  exploit:    { type: "view", target: "exploit" },
  tasks:      { type: "view", target: "workshop", workshopTab: "active" },
  dispatch:   { type: "view", target: "workshop", workshopTab: "inbox" },
  scheduled:  { type: "view", target: "workshop", workshopTab: "scheduled" },
  playground: { type: "view", target: "editor" },
  arbitrage:  { type: "view", target: "cost" },
};

const DEFAULT_ROUTE: ActionRoute = { type: "mode", target: "chat" };

export function getActionRoute(action: string): ActionRoute {
  return ACTION_ROUTES[action] ?? DEFAULT_ROUTE;
}
