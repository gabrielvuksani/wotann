/**
 * Engine actions — async operations that call Tauri commands
 * and update the Zustand store with real KAIROS data.
 *
 * Separated from the main store to keep the store file focused
 * on state shape and synchronous actions.
 */

import {
  commands,
  type ArbitrageEstimate,
  type ApprovalRule,
  type AuditEntry,
  type ChannelStatusEntry,
  type ConnectorInfo,
  type ContextInfo,
  type CostDetailSnapshot,
  type CronJob,
  type DreamResult,
  type HealthCheck,
  type PluginInfo,
  type PrecommitResult,
  type ResearchResult,
  type ShellOutput,
  type SkillInfo,
  type VoiceStatus,
  type WorkspaceInfo,
} from "../hooks/useTauriCommand";
import { useStore } from "./index";
import type {
  AgentInfo,
  ArenaResponse,
  ConversationSummary,
  CostSnapshot,
  FileTreeNode,
  MemoryEntry,
  ProviderInfo,
  RuntimeStatus,
  EnhanceResponse,
} from "../types";

// ── Error Helper ────────────────────────────────────────

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

// ── Initialization ──────────────────────────────────────

/**
 * Fetches real data from the KAIROS engine and populates the store.
 * Called once on app mount. Silently handles failures so the app
 * works in disconnected mode (empty state, no crashes).
 */
/**
 * Load persisted settings from disk (~/.wotann/settings.json).
 * Called before engine init so theme and preferences are ready immediately.
 */
export async function loadPersistedSettings(): Promise<void> {
  try {
    const saved = await commands.loadSettings();
    if (saved && typeof saved === "object" && Object.keys(saved).length > 0) {
      const store = useStore.getState();
      // Merge saved settings into store (only known keys)
      for (const [key, value] of Object.entries(saved)) {
        if (key in store.settings) {
          store.updateSetting(key as any, value as any);
        }
      }
    }
  } catch {
    // Not in Tauri context or no saved settings — use defaults
  }
}

export async function initializeFromEngine(): Promise<void> {
  const results = await Promise.allSettled([
    commands.getStatus(),
    commands.getProviders(),
    commands.getCost(),
    commands.getAgents(),
    commands.getConversations(),
  ]);

  const [statusResult, providersResult, costResult, agentsResult, conversationsResult] = results;

  // Batch ALL state updates into a single setState call to avoid
  // rapid re-renders that trigger React 19's infinite loop detection.
  const patch: Record<string, unknown> = {};

  if (statusResult.status === "fulfilled") {
    const status = statusResult.value as RuntimeStatus;
    patch.engineConnected = status.connected;
    patch.provider = status.provider;
    patch.model = status.model;
    patch.mode = status.mode as "chat" | "build" | "autopilot" | "compare" | "review";
    patch.totalTokens = status.totalTokens;
    patch.contextPercent = status.contextPercent;
  } else {
    patch.engineConnected = false;
  }

  if (providersResult.status === "fulfilled") {
    patch.providers = providersResult.value as readonly ProviderInfo[];
  }

  // Resolve the provider/model to use for this session. Priority order:
  //   1. Saved localStorage choice, IF the pair still exists in providers[]
  //   2. Current engine status (status.provider + status.model), IF valid
  //   3. First enabled provider + its first model (fallback)
  //
  // Surfaces a notification when the saved pair was pruned so the user
  // understands why their previous choice didn't stick.
  const savedProvider = localStorage.getItem("wotann-selected-provider");
  const savedModel = localStorage.getItem("wotann-selected-model");
  const availableProviders = (patch.providers as readonly ProviderInfo[] | undefined) ?? [];
  const pairExists = (p: string, m: string): boolean => {
    const found = availableProviders.find((x) => x.id === p && x.enabled);
    return !!found && found.models.some((mm) => mm.id === m);
  };
  const firstEnabled = availableProviders.find((p) => p.enabled && p.models.length > 0);
  let resolvedProvider: string | undefined;
  let resolvedModel: string | undefined;

  if (savedProvider && savedModel && pairExists(savedProvider, savedModel)) {
    resolvedProvider = savedProvider;
    resolvedModel = savedModel;
  } else if (
    typeof patch.provider === "string" &&
    typeof patch.model === "string" &&
    pairExists(patch.provider, patch.model)
  ) {
    resolvedProvider = patch.provider;
    resolvedModel = patch.model;
    if (savedProvider && savedModel) {
      // Clean up stale saved pair so we don't keep bouncing back to an
      // unavailable provider on every restart.
      localStorage.removeItem("wotann-selected-provider");
      localStorage.removeItem("wotann-selected-model");
      pushNotification(
        "error",
        "Provider no longer available",
        `Saved choice ${savedProvider}/${savedModel} was pruned — using ${resolvedProvider}/${resolvedModel} instead.`,
      );
    }
  } else if (firstEnabled && firstEnabled.models[0]) {
    resolvedProvider = firstEnabled.id;
    resolvedModel = firstEnabled.models[0].id;
    localStorage.removeItem("wotann-selected-provider");
    localStorage.removeItem("wotann-selected-model");
  }

  if (resolvedProvider && resolvedModel) {
    patch.provider = resolvedProvider;
    patch.model = resolvedModel;
    // Persist + sync to Rust AppState. The previous implementation did
    // this inside a savedProvider-gated branch, so first-launch users
    // never got localStorage + engine in sync.
    localStorage.setItem("wotann-selected-provider", resolvedProvider);
    localStorage.setItem("wotann-selected-model", resolvedModel);
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke("switch_provider", {
          provider: resolvedProvider,
          model: resolvedModel,
        }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          pushNotification(
            "error",
            "Provider sync failed",
            `Could not sync ${resolvedProvider}/${resolvedModel} to engine: ${message}`,
          );
        });
      })
      .catch(() => {});
  }

  if (costResult.status === "fulfilled") {
    patch.cost = costResult.value as CostSnapshot;
  }

  if (agentsResult.status === "fulfilled") {
    patch.agents = agentsResult.value as readonly AgentInfo[];
  }

  if (conversationsResult.status === "fulfilled") {
    patch.conversations = conversationsResult.value as readonly ConversationSummary[];
  }

  useStore.setState(patch);
}

// ── Notification Helpers ────────────────────────────────

/**
 * Tracks previous agent statuses to detect transitions.
 * Key = agent ID, value = last known status.
 * Module-level state — survives across polling cycles.
 */
const previousAgentStatuses = new Map<string, string>();

/**
 * Tracks whether a budget alert has already been fired for the
 * current "over-budget" period. Resets when cost drops below limit
 * (e.g., next day).
 */
let budgetAlertFired = false;

/**
 * Creates and pushes a notification into the store.
 * Uses immutable append via setState.
 */
function pushNotification(
  type: "task_complete" | "error" | "approval" | "cost_alert" | "companion" | "agent",
  title: string,
  message: string,
): void {
  const notification = {
    id: `notif-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    type,
    title,
    message,
    timestamp: Date.now(),
    read: false,
  } as const;

  const current = useStore.getState().notifications;
  useStore.setState({ notifications: [...current, notification] });

  // Also trigger native macOS notification via Tauri plugin (best-effort)
  triggerNativeNotification(title, message).catch(() => {});
}

/** Send a native macOS notification via @tauri-apps/plugin-notification. */
async function triggerNativeNotification(title: string, body: string): Promise<void> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    // Not in Tauri context or plugin unavailable — silent fallback
  }
}

// ── Polling Refreshers ──────────────────────────────────

/** Counter for periodic provider refresh (every ~30s = 6 poll cycles at 5s each) */
let refreshProviderCounter = 0;

/**
 * Refreshes runtime status from the engine.
 * Called on a 5-second polling interval.
 */
export async function refreshStatus(): Promise<void> {
  try {
    const status = await commands.getStatus();
    const prevConnected = useStore.getState().engineConnected;
    // Respect user's explicit model selection — don't overwrite with daemon defaults
    const userProvider = localStorage.getItem("wotann-selected-provider");
    const userModel = localStorage.getItem("wotann-selected-model");

    const patch: Record<string, unknown> = {
      engineConnected: status.connected,
      provider: userProvider || status.provider,
      model: userModel || status.model,
      mode: status.mode as "chat" | "build" | "autopilot" | "compare" | "review",
      totalTokens: status.totalTokens,
      contextPercent: status.contextPercent,
    };

    // Refresh providers on reconnect, when empty, or every ~30s (6 poll cycles at 5s each)
    const currentProviders = useStore.getState().providers;
    const shouldRefreshProviders =
      (status.connected && !prevConnected) ||     // just reconnected
      (status.connected && currentProviders.length === 0) ||  // no providers loaded
      (status.connected && (refreshProviderCounter++ % 6 === 0));  // every ~30s

    if (shouldRefreshProviders) {
      try {
        const providers = await commands.getProviders();
        if (providers.length > 0) {
          patch.providers = providers;
        }
      } catch { /* provider fetch failed */ }
    }

    useStore.setState(patch);
  } catch {
    useStore.setState({ engineConnected: false });
  }
}

/**
 * Refreshes the agent list from the engine.
 * Called on a 10-second polling interval.
 *
 * Also generates notifications when agents transition:
 * - running -> completed => task_complete notification
 * - * -> error => error notification
 */
export async function refreshAgents(): Promise<void> {
  try {
    const agents = await commands.getAgents();

    // Detect status transitions and generate notifications
    for (const agent of agents) {
      const prevStatus = previousAgentStatuses.get(agent.id);

      if (prevStatus !== undefined && prevStatus !== agent.status) {
        if (prevStatus === "running" && agent.status === "completed") {
          pushNotification("task_complete", "Task completed", agent.name);
        } else if (agent.status === "error") {
          pushNotification("error", "Task failed", agent.name);
        }
      }

      // Record current status for next cycle
      previousAgentStatuses.set(agent.id, agent.status);
    }

    // Clean up entries for agents no longer reported
    const currentIds = new Set(agents.map((a) => a.id));
    for (const trackedId of previousAgentStatuses.keys()) {
      if (!currentIds.has(trackedId)) {
        previousAgentStatuses.delete(trackedId);
      }
    }

    useStore.setState({ agents });
  } catch {
    // Keep existing agents on failure
  }
}

/**
 * Refreshes cost snapshot from the engine.
 * Called on a 10-second polling interval.
 *
 * Also generates a cost_alert notification when todayCost
 * exceeds the user's budgetLimit setting.
 */
export async function refreshCost(): Promise<void> {
  try {
    const cost = await commands.getCost();
    useStore.setState({ cost });

    // Check budget limit and fire alert (once per over-budget period)
    const { settings } = useStore.getState();
    const budgetLimit = settings.budgetLimit;

    if (
      settings.budgetAlerts &&
      budgetLimit != null &&
      budgetLimit > 0
    ) {
      if (cost.todayCost > budgetLimit && !budgetAlertFired) {
        pushNotification(
          "cost_alert",
          "Budget alert",
          "Today's cost exceeds limit",
        );
        budgetAlertFired = true;
      } else if (cost.todayCost <= budgetLimit) {
        // Reset when cost drops below limit (new day or cost reset)
        budgetAlertFired = false;
      }
    }
  } catch {
    // Keep existing cost on failure
  }
}

// ── Daemon Notification Polling ─────────────────────────

/**
 * Polls the daemon for backend-originated notifications via the KAIROS
 * status RPC. Extracts notification data from the daemon's status response
 * and pushes new entries into the in-app notification store.
 *
 * This bridges the gap between daemon-side notifications (CI failures,
 * stalled tasks, spec divergences, ambient signals) and the desktop app's
 * notification center. The daemon generates these via pushNotification()
 * in kairos-tools.ts, and they're included in the status response.
 */
export async function pollDaemonNotifications(): Promise<void> {
  try {
    const status = await commands.getStatus();
    if (!status) return;

    // Check for agent state changes that warrant notifications
    const agents = useStore.getState().agents;
    for (const agent of agents) {
      // Stalled agent detection (running > 10 min with < 5% progress)
      if (agent.status === "running") {
        const elapsed = Date.now() - agent.startedAt;
        if (elapsed > 600_000 && agent.progress < 5) {
          pushNotification("agent", "Agent may be stalled", `${agent.name} has been running for ${Math.floor(elapsed / 60_000)}min with ${agent.progress}% progress`);
        }
      }
    }
  } catch {
    // Daemon notification polling failure is non-fatal
  }
}

// ── Ambient Awareness ──────────────────────────────────

/**
 * Tracks the last ambient suggestion timestamp to avoid flooding.
 * Only one ambient toast per 60-second window.
 */
let lastAmbientSuggestionAt = 0;

/**
 * Checks current engine state for ambient suggestions and surfaces
 * them as notifications. Piggybacks on existing polled data rather
 * than requiring a new RPC endpoint.
 *
 * Ambient signals:
 * - Context usage > 80% => suggest compaction
 * - Multiple idle agents => suggest cleanup
 * - High cost trajectory => suggest switching to cheaper provider
 *
 * Called alongside refreshStatus in the polling loop.
 */
export function checkAmbientSuggestions(): void {
  const now = Date.now();
  const COOLDOWN_MS = 60_000;

  if (now - lastAmbientSuggestionAt < COOLDOWN_MS) return;

  const { contextPercent, agents, cost, settings, engineConnected } = useStore.getState();

  if (!engineConnected) return;

  // Signal: Context usage approaching limit
  if (contextPercent > 80) {
    pushNotification(
      "agent",
      "Context nearing limit",
      `Context is at ${Math.round(contextPercent)}%. Consider compacting or starting a new conversation.`,
    );
    lastAmbientSuggestionAt = now;
    return;
  }

  // Signal: Multiple idle agents suggest cleanup opportunity
  const idleAgents = agents.filter((a) => a.status === "idle");
  if (idleAgents.length >= 3) {
    pushNotification(
      "agent",
      "Idle workers detected",
      `${idleAgents.length} workers are idle. Consider assigning tasks or cleaning up.`,
    );
    lastAmbientSuggestionAt = now;
    return;
  }

  // Signal: Cost is trending high relative to budget
  const budgetLimit = settings.budgetLimit;
  if (
    budgetLimit != null &&
    budgetLimit > 0 &&
    cost.todayCost > budgetLimit * 0.8 &&
    cost.todayCost <= budgetLimit
  ) {
    pushNotification(
      "agent",
      "Approaching budget limit",
      `Today's cost is ${Math.round((cost.todayCost / budgetLimit) * 100)}% of your daily budget. Consider using a more efficient model.`,
    );
    lastAmbientSuggestionAt = now;
    return;
  }
}

// ── Message Sending ─────────────────────────────────────

/**
 * Sends a message to the engine via Tauri command.
 * Creates the user message in the store, then invokes send_message.
 * Streaming responses arrive via "stream-chunk" events handled by useStreaming.
 *
 * Returns the message_id from the engine, or null on failure.
 */
export async function sendMessage(prompt: string): Promise<string | null> {
  const state = useStore.getState();
  const conversationId = state.activeConversationId;

  if (!conversationId) return null;

  // Create user message (immutable)
  const userMessage = {
    id: `msg-${Date.now()}`,
    role: "user" as const,
    content: prompt,
    timestamp: Date.now(),
  };
  state.addMessage(conversationId, userMessage);

  // Create placeholder assistant message for streaming
  const assistantId = `msg-${Date.now() + 1}`;
  const assistantMessage = {
    id: assistantId,
    role: "assistant" as const,
    content: "",
    timestamp: Date.now(),
    model: state.model,
    provider: state.provider,
    isStreaming: true,
  };
  state.addMessage(conversationId, assistantMessage);
  state.setStreaming(true);

  try {
    const messageId = await commands.sendMessage(prompt);
    return messageId ?? assistantId;
  } catch (err) {
    state.updateMessage(conversationId, assistantId, {
      content: `Error: ${toErrorMessage(err)}`,
      isStreaming: false,
    });
    state.setStreaming(false);
    return null;
  }
}

// ── Memory Search ───────────────────────────────────────

/**
 * Searches memory via the engine and updates the store.
 */
export async function searchMemory(query: string): Promise<readonly MemoryEntry[]> {
  try {
    const results = await commands.searchMemory(query);
    useStore.setState({ memoryEntries: results });
    return results;
  } catch {
    return [];
  }
}

// ── Prompt Enhancement ──────────────────────────────────

/**
 * Enhances a prompt via the engine. Returns the enhanced result
 * or null on failure.
 */
export async function enhancePrompt(
  prompt: string,
  style?: string,
): Promise<EnhanceResponse | null> {
  try {
    return await commands.enhancePrompt(prompt, style);
  } catch {
    return null;
  }
}

// ── Agent Management ────────────────────────────────────

/**
 * Spawns a new agent with the given task.
 */
export async function spawnAgent(task: string): Promise<AgentInfo | null> {
  try {
    const agent = await commands.spawnAgent(task);
    if (agent) {
      const current = useStore.getState().agents;
      useStore.setState({ agents: [...current, agent] });
    }
    return agent;
  } catch {
    return null;
  }
}

/**
 * Kills an agent by ID.
 */
export async function killAgent(id: string): Promise<void> {
  try {
    await commands.killAgent(id);
    const current = useStore.getState().agents;
    useStore.setState({ agents: current.filter((a) => a.id !== id) });
  } catch {
    // Silently fail — agent may already be dead
  }
}

// ── Engine Control ──────────────────────────────────────

/**
 * Starts the KAIROS engine.
 */
export async function startEngine(): Promise<void> {
  try {
    await commands.startEngine();
    useStore.setState({ engineConnected: true });
  } catch {
    useStore.setState({ engineConnected: false });
  }
}

/**
 * Stops the KAIROS engine.
 */
export async function stopEngine(): Promise<void> {
  try {
    await commands.stopEngine();
    useStore.setState({ engineConnected: false });
  } catch {
    // Already disconnected or error — mark disconnected
    useStore.setState({ engineConnected: false });
  }
}

/**
 * Restarts the KAIROS engine. Used after saving API keys / env vars so the
 * daemon picks them up from ~/.wotann/providers.env without the user having
 * to stop and start manually. Surfaces success/failure as a notification
 * because the Settings UI triggers this from a button click.
 */
export async function restartEngine(): Promise<void> {
  try {
    useStore.setState({ engineConnected: false });
    await commands.restartEngine();
    // Re-probe state from the daemon once it has settled so the UI reflects
    // real connection status rather than an optimistic "connected" flag.
    await initializeFromEngine();
    pushNotification("task_complete", "Engine restarted", "Environment variables reloaded.");
  } catch (err) {
    useStore.setState({ engineConnected: false });
    pushNotification("error", "Engine restart failed", toErrorMessage(err));
  }
}

// ── Arena (multi-model comparison) ──────────────────────

/**
 * Runs a prompt through multiple models in parallel and returns
 * the collected responses. Does not store results in global state
 * since Arena is a local UI concern.
 */
export async function runArena(
  prompt: string,
  models: readonly string[],
): Promise<readonly ArenaResponse[]> {
  try {
    return await commands.runArena(prompt, models);
  } catch {
    return [];
  }
}

// ── File System ─────────────────────────────────────────

/**
 * Reads a directory tree from the file system via Tauri.
 */
export async function readDirectory(path: string): Promise<readonly FileTreeNode[]> {
  try {
    return await commands.readDirectory(path);
  } catch {
    return [];
  }
}

/**
 * Reads the content of a single file.
 */
export async function readFile(path: string): Promise<string | null> {
  try {
    return await commands.readFile(path);
  } catch {
    return null;
  }
}

// ── Shell Execution ─────────────────────────────────────

/**
 * Executes a shell command and returns the output.
 */
export async function executeCommand(cmd: string): Promise<ShellOutput> {
  try {
    return await commands.executeCommand(cmd);
  } catch (err) {
    return { stdout: "", stderr: toErrorMessage(err), exitCode: 1 };
  }
}

// ── Cost Details ────────────────────────────────────────

/**
 * Fetches extended cost details including daily breakdown
 * and per-provider costs.
 */
export async function getCostDetails(): Promise<CostDetailSnapshot | null> {
  try {
    return await commands.getCostDetails();
  } catch {
    return null;
  }
}

// ── Arbitrage Estimates ─────────────────────────────────

/**
 * Fetches cost/quality/latency estimates for a prompt
 * across all available providers.
 */
export async function getArbitrageEstimates(
  prompt: string,
): Promise<readonly ArbitrageEstimate[]> {
  try {
    return await commands.getArbitrageEstimates(prompt);
  } catch {
    return [];
  }
}

// ── Plugins ─────────────────────────────────────────────

/**
 * Fetches the list of installed and available plugins from KAIROS.
 */
export async function getPlugins(): Promise<readonly PluginInfo[]> {
  try {
    return await commands.getPlugins();
  } catch {
    return [];
  }
}

// ── Lifetime Token Stats ─────────────────────────────────

/**
 * Fetches cumulative token usage across all sessions from token-stats.json.
 */
export async function getLifetimeTokenStats(): Promise<{
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionCount: number;
  byProvider: Record<string, { input: number; output: number }>;
  byModel: Record<string, { input: number; output: number }>;
} | null> {
  try {
    return await commands.getLifetimeTokenStats();
  } catch {
    return null;
  }
}

// ── Connectors ──────────────────────────────────────────

/**
 * Fetches data connector statuses from KAIROS.
 */
export async function getConnectors(): Promise<readonly ConnectorInfo[]> {
  try {
    return await commands.getConnectors();
  } catch {
    return [];
  }
}

// ── Cron Jobs / Scheduled Tasks ─────────────────────────

/**
 * Fetches scheduled cron jobs from the KAIROS daemon.
 */
export async function getCronJobs(): Promise<readonly CronJob[]> {
  try {
    return await commands.getCronJobs();
  } catch {
    return [];
  }
}

// ── Workspaces ──────────────────────────────────────────

/**
 * Discovers workspaces / projects known to KAIROS.
 */
export async function getWorkspaces(): Promise<readonly WorkspaceInfo[]> {
  try {
    return await commands.getWorkspaces();
  } catch {
    return [];
  }
}

// ── Approval Rules ──────────────────────────────────────

/**
 * Fetches exec approval rules from the KAIROS hook config.
 */
export async function getApprovalRules(): Promise<readonly ApprovalRule[]> {
  try {
    return await commands.getApprovalRules();
  } catch {
    return [];
  }
}

// ── CLI Parity Functions ───────────────────────────────

/**
 * Runs deep research on a topic via KAIROS.
 */
export async function deepResearch(topic: string): Promise<ResearchResult | null> {
  try {
    return await commands.deepResearch(topic);
  } catch {
    return null;
  }
}

/**
 * Fetches the list of available skills from KAIROS.
 */
export async function getSkills(): Promise<readonly SkillInfo[]> {
  try {
    return await commands.getSkills();
  } catch {
    return [];
  }
}

/**
 * Searches skills by query string.
 */
export async function searchSkills(query: string): Promise<readonly SkillInfo[]> {
  try {
    return await commands.searchSkills(query);
  } catch {
    return [];
  }
}

/**
 * Triggers a dream cycle for learning extraction.
 */
export async function triggerDream(): Promise<DreamResult | null> {
  try {
    return await commands.triggerDream();
  } catch {
    return null;
  }
}

/**
 * Runs doctor diagnostics and returns health check results.
 */
export async function runDoctor(): Promise<readonly HealthCheck[]> {
  try {
    return await commands.runDoctor();
  } catch {
    return [];
  }
}

/**
 * Fetches context usage information (percent, tokens, message count).
 */
export async function getContextInfo(): Promise<ContextInfo | null> {
  try {
    return await commands.getContextInfo();
  } catch {
    return null;
  }
}

/**
 * Gets a config value by key, or the full config if no key is provided.
 */
export async function getConfig(key?: string): Promise<unknown> {
  try {
    return await commands.getConfig(key);
  } catch {
    return null;
  }
}

/**
 * Sets a config value by key.
 */
export async function setConfig(key: string, value: string): Promise<boolean> {
  try {
    const result = await commands.setConfig(key, value);
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Fetches the status of all configured channels (Telegram, Discord, etc.).
 */
export async function getChannelsStatus(): Promise<readonly ChannelStatusEntry[]> {
  try {
    return await commands.getChannelsStatus();
  } catch {
    return [];
  }
}

/**
 * Runs an autonomous task. Streams results via Tauri events.
 * Returns the message ID for tracking, or null on failure.
 */
export async function runAutonomous(prompt: string): Promise<string | null> {
  try {
    return await commands.runAutonomous(prompt);
  } catch {
    return null;
  }
}

/**
 * Runs architect analysis on a prompt.
 */
export async function runArchitect(prompt: string): Promise<string | null> {
  try {
    return await commands.runArchitect(prompt);
  } catch {
    return null;
  }
}

/**
 * Runs council review (multi-model) on a query.
 */
export async function runCouncil(query: string): Promise<string | null> {
  try {
    return await commands.runCouncil(query);
  } catch {
    return null;
  }
}

/**
 * Fetches voice capability status from KAIROS.
 */
export async function getVoiceStatus(): Promise<VoiceStatus | null> {
  try {
    return await commands.getVoiceStatus();
  } catch {
    return null;
  }
}

/**
 * Fetches audit trail entries with optional filters.
 */
export async function getAuditTrail(
  action?: string,
  severity?: string,
  limit?: number,
): Promise<readonly AuditEntry[]> {
  try {
    return await commands.getAuditTrail(action, severity, limit);
  } catch {
    return [];
  }
}

/**
 * Runs precommit analysis on the current working directory.
 */
export async function runPrecommit(): Promise<PrecommitResult | null> {
  try {
    return await commands.runPrecommit();
  } catch {
    return null;
  }
}

/**
 * Get git status for the current project.
 */
export async function getGitStatus(): Promise<{
  readonly isRepo: boolean;
  readonly branch?: string;
  readonly files?: readonly { path: string; status: string }[];
  readonly recentCommits?: readonly string[];
  readonly ahead?: number;
  readonly behind?: number;
} | null> {
  try {
    return await commands.getGitStatus();
  } catch {
    return null;
  }
}

/**
 * Get git diff output.
 */
export async function getGitDiff(staged?: boolean): Promise<string | null> {
  try {
    return await commands.getGitDiff(staged);
  } catch {
    return null;
  }
}
