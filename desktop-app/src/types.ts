/**
 * WOTANN Desktop — Shared types.
 * Single source of truth for all TypeScript interfaces.
 */

// ── Messages ─────────────────────────────────────────────

export interface Message {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly timestamp: number;
  readonly model?: string;
  readonly provider?: string;
  readonly tokensUsed?: number;
  readonly costUsd?: number;
  readonly isStreaming?: boolean;
}

// ── Conversations ────────────────────────────────────────

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly updatedAt: number;
  readonly provider: string;
  readonly model: string;
  readonly cost: number;
  readonly messageCount: number;
  readonly incognito?: boolean;
  readonly parentId?: string;
  readonly pinned?: boolean;
}

// ── Providers ────────────────────────────────────────────

export interface ProviderInfo {
  readonly name: string;
  readonly id: string;
  readonly enabled: boolean;
  readonly models: readonly ModelInfo[];
  readonly defaultModel: string;
}

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly costPerMTok: number;
}

// ── Cost ─────────────────────────────────────────────────

export interface CostSnapshot {
  readonly sessionCost: number;
  readonly todayCost: number;
  readonly weekCost: number;
  readonly budgetRemaining: number | null;
}

// ── Agents / Workers ─────────────────────────────────────

export interface AgentInfo {
  readonly id: string;
  readonly name: string;
  readonly status: "running" | "idle" | "error" | "completed";
  readonly task: string;
  readonly progress: number;
  readonly cost: number;
  readonly startedAt: number;
  readonly model: string;
  readonly provider: string;
  readonly tokensUsed: number;
}

// ── Memory ───────────────────────────────────────────────

export interface MemoryEntry {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly source: string;
  readonly type: "case" | "pattern" | "decision" | "feedback" | "project" | "reference";
  readonly createdAt: number;
}

// ── Context Sources ──────────────────────────────────────

export interface ContextSource {
  readonly name: string;
  readonly tokens: number;
  readonly type: "system" | "conversation" | "files" | "tools" | "memory" | "skills";
}

// ── Views ────────────────────────────────────────────────

/** Primary spaces shown as header tabs. */
export type PrimarySpace = "chat" | "editor" | "workshop" | "exploit";

/** All navigable views. */
export type AppView =
  | "chat"
  | "editor"
  | "workshop"
  | "exploit"
  | "compare"
  | "memory"
  | "blocks"
  | "operations"
  | "teams"
  | "snippets"
  | "cost"
  | "settings"
  | "intelligence"
  | "computer-use"
  | "council"
  | "training";

/** Legacy view aliases for backward compatibility during migration. */
export type LegacyView = "arena" | "agents" | "pairing" | "playground" | "dispatch" | "tasks" | "connectors" | "remote" | "approvals" | "scheduled" | "plugins" | "projects" | "arbitrage" | "canvas";

/** Resolve legacy view names to their new destinations. */
export function resolveLegacyView(view: string): AppView {
  const legacyMap: Record<string, AppView> = {
    arena: "compare", agents: "workshop", pairing: "settings",
    playground: "editor", dispatch: "workshop", tasks: "workshop",
    connectors: "settings", remote: "settings", approvals: "settings",
    scheduled: "workshop", projects: "chat",
    arbitrage: "cost", canvas: "editor",
  };
  return legacyMap[view] ?? (view as AppView);
}

// ── Editor ──────────────────────────────────────────────

export interface OpenFile {
  readonly path: string;
  readonly name: string;
  readonly language: string;
  readonly content: string;
  readonly modified: boolean;
}

export interface FileTreeNode {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "directory";
  readonly children?: readonly FileTreeNode[];
  readonly expanded?: boolean;
  readonly gitStatus?: "modified" | "staged" | "untracked" | "none";
}

export interface EditorDiff {
  readonly filePath: string;
  readonly hunks: readonly DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
}

export interface DiffHunk {
  readonly startLine: number;
  readonly lines: readonly { type: "add" | "remove" | "context"; content: string }[];
}

export type SidebarTab = "conversations" | "projects" | "skills" | "agents";

/** Chat AI behavior modes (orthogonal to layout/view). */
export type ChatMode = "chat" | "build" | "autopilot" | "compare" | "review";

/** Layout modes controlling the overall app experience. */
export type LayoutMode = "chat" | "code" | "meet" | "exploit";

// ── Composer (Multi-File Edits) ──────────────────────────

export interface Hunk {
  readonly id: string;
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
  readonly startLine: number;
  readonly accepted?: boolean;
}

export interface FileEdit {
  readonly path: string;
  readonly oldContent: string;
  readonly newContent: string;
  readonly hunks: readonly Hunk[];
}

export interface ComposerPlanResponse {
  readonly edits: readonly FileEdit[];
}

export interface ComposerApplyRequest {
  readonly path: string;
  readonly newContent: string;
  readonly acceptedHunkIds: readonly string[];
}

// ── Arena ────────────────────────────────────────────────

export interface ArenaResponse {
  readonly id: string;
  readonly model: string;
  readonly provider: string;
  readonly content: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly isStreaming: boolean;
}

// ── Streaming ───────────────────────────────────────────

export interface StreamChunk {
  readonly type: "text" | "thinking" | "tool_use" | "done" | "error";
  readonly content: string;
  readonly provider: string;
  readonly model: string;
  readonly message_id: string;
  readonly tokens_used?: number;
  readonly cost_usd?: number;
}

// ── Runtime Status ──────────────────────────────────────

export interface RuntimeStatus {
  readonly connected: boolean;
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly sessionId: string;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly contextPercent: number;
  readonly workerCount: number;
}

// ── Enhance Response ────────────────────────────────────

export interface EnhanceResponse {
  readonly original: string;
  readonly enhanced: string;
  readonly style: string;
  readonly improvements: readonly string[];
}

// ── Memory Search Result ────────────────────────────────

export interface MemoryResult {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly source: string;
  readonly type: string;
  readonly createdAt: number;
}

// ── Workspace Presets ────────────────────────────────────

export type WorkspacePreset = "developer" | "security" | "pm" | "analyst";

// ── Settings ─────────────────────────────────────────────

export interface AppSettings {
  readonly autoEnhance: boolean;
  readonly autoVerify: boolean;
  readonly autoSelectProvider: boolean;
  readonly launchAtLogin: boolean;
  readonly theme: "dark" | "midnight" | "true-black" | "light" | "system";
  readonly accentColor: "violet" | "blue" | "emerald" | "amber" | "rose" | "cyan";
  readonly fontSize: number;
  readonly codeFont: string;
  readonly notificationsEnabled: boolean;
  readonly soundAlerts: boolean;
  readonly budgetAlerts: boolean;
  readonly dangerousCommandGuard: boolean;
  readonly blockNoVerify: boolean;
  readonly configProtection: boolean;
  readonly loopDetection: boolean;
  readonly voiceInput: boolean;
  readonly voiceOutput: boolean;
  readonly persistentMemory: boolean;
  readonly autoSaveDiscoveries: boolean;
  readonly budgetLimit: number | null;
  readonly workspacePreset: WorkspacePreset;
  readonly stealthBrowsing: boolean;
}
