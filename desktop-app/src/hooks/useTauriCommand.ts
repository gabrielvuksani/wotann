/**
 * Type-safe Tauri invoke wrappers for WOTANN Desktop.
 * Falls back to mock data when running outside Tauri (dev mode).
 */

import type {
  AgentInfo,
  ArenaResponse,
  ConversationSummary,
  CostSnapshot,
  EnhanceResponse,
  FileTreeNode,
  MemoryEntry,
  ProviderInfo,
  RuntimeStatus,
} from "../types";

// ── New domain types for commands ───────────────────────

export interface CostDetailSnapshot extends CostSnapshot {
  readonly dailyUsage: readonly DayUsage[];
  readonly providerCosts: readonly ProviderCostBreakdown[];
  readonly weekTokens: number;
  readonly weekConversations: number;
  readonly avgCostPerMessage: number;
}

export interface DayUsage {
  readonly date: string;
  readonly cost: number;
  readonly tokens: number;
  readonly conversations: number;
}

export interface ProviderCostBreakdown {
  readonly provider: string;
  readonly cost: number;
  readonly percentage: number;
}

export interface ArbitrageEstimate {
  readonly provider: string;
  readonly model: string;
  readonly estimatedCost: number;
  readonly estimatedTokens: number;
  readonly estimatedLatencyMs: number;
  readonly quality: "best" | "good" | "acceptable";
  readonly recommended: boolean;
}

export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly category: "workflow" | "integration" | "ui" | "security" | "utility";
}

export interface ConnectorInfo {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly description: string;
  readonly connected: boolean;
  readonly documentsCount: number;
}

export interface CronJob {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly command: string;
  readonly enabled: boolean;
  readonly lastRun?: string;
  readonly lastResult?: "success" | "failure";
}

export interface WorkspaceInfo {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly description: string;
  readonly lastAccessed: number;
  readonly conversationCount: number;
  readonly pinned: boolean;
}

export interface ApprovalRule {
  readonly id: string;
  readonly pattern: string;
  readonly action: "allow" | "deny" | "ask";
  readonly scope: "global" | "project";
  readonly description: string;
}

export interface ShellOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface DependencyStatus {
  readonly nodeInstalled: boolean;
  readonly nodeVersion: string;
  readonly npmInstalled: boolean;
  readonly npmVersion: string;
  readonly wotannCliInstalled: boolean;
  readonly wotannCliVersion: string;
  readonly engineRunning: boolean;
  readonly ollamaInstalled: boolean;
  readonly ollamaRunning: boolean;
  readonly ollamaVersion: string;
  readonly gemma4Available: boolean;
}

export interface CompanionPairingInfo {
  readonly qrData: string;
  readonly pin: string;
  readonly host: string;
  readonly port: number;
  readonly expiresAt: string;
}

export interface CompanionDeviceInfo {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly lastSeen: string;
  readonly connected: boolean;
}

export interface CompanionSessionInfo {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly connectedAt: number;
  readonly messagesExchanged: number;
  readonly status: string;
}

// ── CLI Parity Types ─────────────────────────────────��──

export interface ResearchResult {
  readonly topic: string;
  readonly result: string;
  readonly timestamp: number;
}

export interface SkillInfo {
  readonly name: string;
  readonly description: string;
  readonly category: string;
}

export interface DreamResult {
  readonly success: boolean;
  readonly message: string;
}

export interface HealthCheck {
  readonly name: string;
  readonly status: string;
  readonly detail: string;
}

export interface ContextInfo {
  readonly percent: number;
  readonly tokens: number;
  readonly messageCount: number;
}

export interface ConfigSetResult {
  readonly success: boolean;
}

export interface ChannelStatusEntry {
  readonly id: string;
  readonly name: string;
  readonly channelType: string;
  readonly connected: boolean;
  readonly lastMessageAt: number | null;
}

export interface VoiceStatus {
  readonly available: boolean;
  readonly sttEngine: string;
  readonly ttsEngine: string;
  readonly listening: boolean;
}

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly action: string;
  readonly detail: string;
  readonly severity: string;
}

export interface PrecommitResult {
  readonly passed: boolean;
  readonly checks: readonly PrecommitCheck[];
  readonly summary: string;
}

export interface PrecommitCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string;
}

// ── Tauri Invoke Wrapper ─────────────────────────────────
// Uses static import. Falls back to disconnected responses outside Tauri.
// IMPORTANT: Do NOT use isTauri() — it checks window.isTauri which Tauri v2
// may not set. Check window.__TAURI_INTERNALS__ directly instead.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

function isInsideTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isInsideTauri()) {
    return getDisconnectedResponse<T>(cmd);
  }
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (err) {
    console.warn(`[WOTANN] invoke(${cmd}) failed:`, err);
    return getDisconnectedResponse<T>(cmd);
  }
}

// ── Disconnected Responses (no mock data — only empty/zero states) ──

function getDisconnectedResponse<T>(cmd: string): T {
  const empty: Record<string, unknown> = {
    // Status: explicitly disconnected
    get_status: {
      connected: false,
      provider: "",
      model: "",
      mode: "chat",
      sessionId: "",
      totalTokens: 0,
      totalCost: 0,
      contextPercent: 0,
      workerCount: 0,
    } satisfies RuntimeStatus,
    // Empty arrays for list commands
    get_providers: [] satisfies ProviderInfo[],
    get_conversations: [] satisfies ConversationSummary[],
    search_memory: [] satisfies MemoryEntry[],
    get_agents: [] satisfies AgentInfo[],
    run_arena: [] satisfies ArenaResponse[],
    read_directory: [] satisfies FileTreeNode[],
    get_arbitrage_estimates: [] satisfies ArbitrageEstimate[],
    get_plugins: [] satisfies PluginInfo[],
    get_connectors: [] satisfies ConnectorInfo[],
    get_cron_jobs: [] satisfies CronJob[],
    get_workspaces: [] satisfies WorkspaceInfo[],
    get_approval_rules: [] satisfies ApprovalRule[],
    // Zero cost when disconnected
    get_cost: {
      sessionCost: 0,
      todayCost: 0,
      weekCost: 0,
      budgetRemaining: null,
    } satisfies CostSnapshot,
    get_cost_details: {
      sessionCost: 0,
      todayCost: 0,
      weekCost: 0,
      budgetRemaining: null,
      dailyUsage: [],
      providerCosts: [],
      weekTokens: 0,
      weekConversations: 0,
      avgCostPerMessage: 0,
    } satisfies CostDetailSnapshot,
    // Dependency check fallback
    check_dependencies: {
      nodeInstalled: false,
      nodeVersion: "",
      npmInstalled: false,
      npmVersion: "",
      wotannCliInstalled: false,
      wotannCliVersion: "",
      engineRunning: false,
      ollamaInstalled: false,
      ollamaRunning: false,
      ollamaVersion: "",
      gemma4Available: false,
    } satisfies DependencyStatus,
    install_node: "Install requires the WOTANN desktop app. Run from the .dmg or .app bundle.",
    install_wotann_cli: "Install requires the WOTANN desktop app.",
    install_ollama: "Install requires the WOTANN desktop app. Run from the .dmg or .app bundle.",
    pull_ollama_model: "Model pull requires the WOTANN desktop app.",
    list_ollama_models: [] as string[],
    install_daemon_service: "Daemon install requires the WOTANN desktop app.",
    get_companion_pairing: null,
    get_companion_devices: [] satisfies CompanionDeviceInfo[],
    get_companion_sessions: [] satisfies CompanionSessionInfo[],
    unpair_companion_device: undefined,
    end_companion_session: undefined,
    save_api_keys: undefined,
    // Empty responses for actions
    send_message: null,
    enhance_prompt: null,
    spawn_agent: null,
    kill_agent: undefined,
    switch_provider: undefined,
    start_engine: undefined,
    stop_engine: undefined,
    read_file: "",
    execute_command: { stdout: "", stderr: "Engine not connected", exitCode: 1 } satisfies ShellOutput,
    // CLI parity commands — disconnected fallbacks
    deep_research: { topic: "", result: "", timestamp: 0 } satisfies ResearchResult,
    get_skills: [] satisfies SkillInfo[],
    search_skills: [] satisfies SkillInfo[],
    trigger_dream: { success: false, message: "Engine not connected" } satisfies DreamResult,
    run_doctor: [] satisfies HealthCheck[],
    get_context_info: { percent: 0, tokens: 0, messageCount: 0 } satisfies ContextInfo,
    get_config: null,
    set_config: { success: false } satisfies ConfigSetResult,
    get_channels_status: [] satisfies ChannelStatusEntry[],
    run_autonomous: null,
    run_architect: null,
    run_council: null,
    get_voice_status: { available: false, sttEngine: "", ttsEngine: "", listening: false } satisfies VoiceStatus,
    get_audit_trail: [] satisfies AuditEntry[],
    run_precommit: { passed: false, checks: [], summary: "Engine not connected" } satisfies PrecommitResult,
    // Subscription login fallbacks — engine is required for OAuth
    login_anthropic: {
      success: false,
      provider: "anthropic",
      expiresAt: null,
      error: "Engine not connected",
    },
    login_codex: {
      success: false,
      provider: "codex",
      expiresAt: null,
      error: "Engine not connected",
    },
    detect_existing_subscriptions: {
      anthropic: { found: false },
      codex: { found: false },
    },
    import_codex_credential: { success: false, error: "Engine not connected" },
    restart_engine: undefined,
    file_exists: false,
    scan_project_hotspots: null,
    initialize_project: null,
  };

  return (empty[cmd] ?? null) as T;
}

// ── Typed Command Functions ──────────────────────────────

export const commands = {
  getStatus: () => invoke<RuntimeStatus>("get_status"),

  /**
   * Generic JSON-RPC bridge to the daemon. Use for any RPC method that
   * doesn't have a typed wrapper here (gdpr.export, gdpr.delete,
   * workspace.trust, channels.policy.set, etc.). Returns the daemon's
   * raw result as `unknown` — caller does the type-narrow.
   */
  rpcCall: (method: string, params: Record<string, unknown> = {}) =>
    invoke<unknown>("rpc_call", { method, params }),

  sendMessage: (prompt: string) =>
    invoke<string>("send_message", { prompt }),

  getProviders: () => invoke<readonly ProviderInfo[]>("get_providers"),

  switchProvider: (provider: string, model: string) =>
    invoke<void>("switch_provider", { provider, model }),

  getCost: () => invoke<CostSnapshot>("get_cost"),

  getCostDetails: () => invoke<CostDetailSnapshot>("get_cost_details"),

  enhancePrompt: (prompt: string, style?: string) =>
    invoke<EnhanceResponse>("enhance_prompt", { prompt, style: style ?? "detailed" }),

  startEngine: () => invoke<void>("start_engine"),

  stopEngine: () => invoke<void>("stop_engine"),

  isDaemonConnected: () => invoke<boolean>("is_daemon_connected"),

  lastDaemonError: () => invoke<string | null>("last_daemon_error"),

  getConversations: () =>
    invoke<readonly ConversationSummary[]>("get_conversations"),

  searchMemory: (query: string) =>
    invoke<readonly MemoryEntry[]>("search_memory", { query }),

  getAgents: () => invoke<readonly AgentInfo[]>("get_agents"),

  spawnAgent: (task: string) =>
    invoke<AgentInfo | null>("spawn_agent", { task }),

  killAgent: (id: string) => invoke<void>("kill_agent", { id }),

  // ── Arena ────────────────────────────────────────────────

  runArena: (prompt: string, models: readonly string[]) =>
    invoke<readonly ArenaResponse[]>("run_arena", { prompt, models }),

  // ── File System ──────────────────────────────────────────

  readDirectory: (path: string) =>
    invoke<readonly FileTreeNode[]>("read_directory", { path }),

  readFile: (path: string) =>
    invoke<string>("read_file", { path }),

  // ── Shell ────────────────────────────────────────────────

  executeCommand: (cmd: string) =>
    invoke<ShellOutput>("execute_command", { cmd }),

  // ── Arbitrage ────────────────────────────────────────────

  getArbitrageEstimates: (prompt: string) =>
    invoke<readonly ArbitrageEstimate[]>("get_arbitrage_estimates", { prompt }),

  // ── Plugins ──────────────────────────────────────────────

  getPlugins: () =>
    invoke<readonly PluginInfo[]>("get_plugins"),

  // ── Connectors ───────────────────────────────────────────

  getConnectors: () =>
    invoke<readonly ConnectorInfo[]>("get_connectors"),

  // ── Cron / Scheduled Tasks ───────────────────────────────

  getCronJobs: () =>
    invoke<readonly CronJob[]>("get_cron_jobs"),

  // ── Workspaces ───────────────────────────────────────────

  getWorkspaces: () =>
    invoke<readonly WorkspaceInfo[]>("get_workspaces"),

  // ── Approval Rules ───────────────────────────────────────

  getApprovalRules: () =>
    invoke<readonly ApprovalRule[]>("get_approval_rules"),

  // ── First-Launch Dependencies ───────────────────────────

  checkDependencies: () =>
    invoke<DependencyStatus>("check_dependencies"),

  installNode: () =>
    invoke<string>("install_node"),

  installWotannCli: () =>
    invoke<string>("install_wotann_cli"),

  installOllama: () =>
    invoke<string>("install_ollama"),

  pullOllamaModel: (model: string) =>
    invoke<string>("pull_ollama_model", { model }),

  listOllamaModels: () =>
    invoke<readonly string[]>("list_ollama_models"),

  installDaemonService: () =>
    invoke<string>("install_daemon_service"),

  getCompanionPairing: () =>
    invoke<CompanionPairingInfo | null>("get_companion_pairing"),

  getCompanionDevices: () =>
    invoke<readonly CompanionDeviceInfo[]>("get_companion_devices"),

  getCompanionSessions: () =>
    invoke<readonly CompanionSessionInfo[]>("get_companion_sessions"),

  unpairCompanionDevice: (deviceId: string) =>
    invoke<void>("unpair_companion_device", { deviceId }),

  endCompanionSession: (sessionId: string) =>
    invoke<void>("end_companion_session", { sessionId }),

  saveApiKeys: (keys: Record<string, string>) =>
    invoke<void>("save_api_keys", { keys }),

  // ── Settings Persistence ────────────────────────────

  saveSettings: (settings: Record<string, unknown>) =>
    invoke<void>("save_settings", { settings }),

  loadSettings: () =>
    invoke<Record<string, unknown>>("load_settings"),

  clearMemory: () =>
    invoke<string>("clear_memory"),

  // ── Ollama Sidecar ─────────────────────────────────

  startOllamaSidecar: () =>
    invoke<string>("start_ollama_sidecar"),

  detectSystemRam: () =>
    invoke<number>("detect_system_ram"),

  // ── LocalSend ──────────────────────────────────────

  discoverLocalSendDevices: () =>
    invoke<readonly { alias: string; deviceType: string; port: number; fingerprint: string }[]>("discover_localsend_devices"),

  sendFileLocalSend: (peerId: string, filePath: string) =>
    invoke<string>("send_file_localsend", { peerId, filePath }),

  stopLocalSendDiscovery: () =>
    invoke<void>("stop_localsend_discovery"),

  // ── CLI Parity Commands ──────────────────────────────

  deepResearch: (topic: string) =>
    invoke<ResearchResult>("deep_research", { topic }),

  getSkills: () =>
    invoke<readonly SkillInfo[]>("get_skills"),

  searchSkills: (query: string) =>
    invoke<readonly SkillInfo[]>("search_skills", { query }),

  triggerDream: () =>
    invoke<DreamResult>("trigger_dream"),

  runDoctor: () =>
    invoke<readonly HealthCheck[]>("run_doctor"),

  getContextInfo: () =>
    invoke<ContextInfo>("get_context_info"),

  getConfig: (key?: string) =>
    invoke<unknown>("get_config", { key: key ?? null }),

  setConfig: (key: string, value: string) =>
    invoke<ConfigSetResult>("set_config", { key, value }),

  getChannelsStatus: () =>
    invoke<readonly ChannelStatusEntry[]>("get_channels_status"),

  runAutonomous: (prompt: string) =>
    invoke<string | null>("run_autonomous", { prompt }),

  runArchitect: (prompt: string) =>
    invoke<string>("run_architect", { prompt }),

  runCouncil: (query: string) =>
    invoke<string>("run_council", { query }),

  getVoiceStatus: () =>
    invoke<VoiceStatus>("get_voice_status"),

  getAuditTrail: (action?: string, severity?: string, limit?: number) =>
    invoke<readonly AuditEntry[]>("get_audit_trail", {
      action: action ?? null,
      severity: severity ?? null,
      limit: limit ?? null,
    }),

  runPrecommit: () =>
    invoke<PrecommitResult>("run_precommit"),

  getGitStatus: () =>
    invoke<{ isRepo: boolean; branch?: string; files?: readonly { path: string; status: string }[]; recentCommits?: readonly string[]; ahead?: number; behind?: number }>("get_git_status"),

  getGitDiff: (staged?: boolean) =>
    invoke<string>("get_git_diff", { staged }),

  // ── PDF Processing ──────────────────────────────────────
  processPdf: (path: string) =>
    invoke<{ text: string; outline: string[]; pageCount: number }>("process_pdf", { path }),

  // ── Lifetime Token Stats ────────────────────────────────
  getLifetimeTokenStats: () =>
    invoke<{
      totalInputTokens: number;
      totalOutputTokens: number;
      totalThinkingTokens: number;
      sessionCount: number;
      byProvider: Record<string, { input: number; output: number }>;
      byModel: Record<string, { input: number; output: number }>;
    }>("get_lifetime_token_stats"),

  // ── Marketplace Manifest ────────────────────────────────
  getMarketplaceManifest: () =>
    invoke<{ skillCount: number; pluginCount: number; lastUpdated: string }>("get_marketplace_manifest"),

  refreshMarketplaceCatalog: () =>
    invoke<{ skillCount: number; pluginCount: number; lastUpdated: string }>("refresh_marketplace_catalog"),

  // ── Camoufox ────────────────────────────────────────────
  getCamoufoxStatus: () =>
    invoke<{ available: boolean }>("get_camoufox_status"),

  // ── Subscription Logins ────────────────────────────────
  loginAnthropic: () =>
    invoke<{
      success: boolean;
      provider: string;
      expiresAt: number | null;
      error?: string;
      tokenSource?: string;
    }>("login_anthropic"),

  loginCodex: () =>
    invoke<{
      success: boolean;
      provider: string;
      expiresAt: number | null;
      error?: string;
      tokenSource?: string;
      reused?: boolean;
    }>("login_codex"),

  detectExistingSubscriptions: () =>
    invoke<{
      anthropic: { found: boolean; path?: string; expiresAt?: number | null };
      codex: { found: boolean; path?: string; expiresAt?: number | null };
    }>("detect_existing_subscriptions"),

  importCodexCredential: (path: string) =>
    invoke<{ success: boolean; error?: string }>("import_codex_credential", { path }),

  restartEngine: () => invoke<void>("restart_engine"),

  fileExists: (path: string) => invoke<boolean>("file_exists", { path }),

  // ── Project Scan & Initialization (command palette) ────
  scanProjectHotspots: () => invoke<unknown>("scan_project_hotspots"),

  initializeProject: (name?: string) =>
    invoke<unknown>("initialize_project", { name: name ?? null }),
} as const;
