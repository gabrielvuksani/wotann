/**
 * Core type definitions for WOTANN agent harness.
 * Provider-agnostic types shared across the entire system.
 */

// ── Provider Types ──────────────────────────────────────────

export type ProviderName =
  | "anthropic"
  | "openai"
  | "codex"
  | "copilot"
  | "ollama"
  | "gemini"
  | "huggingface"
  | "free"
  | "azure"
  | "bedrock"
  | "vertex"
  | "mistral"
  | "deepseek"
  | "perplexity"
  | "xai"
  | "together"
  | "fireworks"
  | "sambanova"
  | "groq";

export type TransportType = "anthropic" | "chat_completions" | "codex_responses";

export type BillingType = "subscription" | "api-key" | "free";

export type AuthMethod =
  | "oauth-token"
  | "api-key"
  | "codex-jwt"
  | "github-pat"
  | "local"
  | "azure-ad"
  | "aws-iam"
  | "gcp-sa";

export interface ProviderAuth {
  readonly provider: ProviderName;
  readonly method: AuthMethod;
  readonly token: string;
  readonly billing: BillingType;
  readonly label?: string;
  readonly priority?: number;
  readonly transport?: TransportType;
  readonly models: readonly string[];
  readonly subscription?: string;
}

export interface ProviderStatus {
  readonly provider: ProviderName;
  readonly available: boolean;
  readonly authMethod: AuthMethod;
  readonly billing: BillingType;
  readonly models: readonly string[];
  readonly label: string;
  readonly error?: string;
}

// ── Model Router Types ──────────────────────────────────────

export type ModelTier = 0 | 1 | 2 | 3 | 4;

export interface RoutingDecision {
  readonly tier: ModelTier;
  readonly provider: ProviderName;
  readonly model: string;
  readonly cost: number;
  readonly method?: "wasm";
}

export type TaskCategory =
  | "utility"
  | "classify"
  | "code"
  | "plan"
  | "review"
  | "vision"
  | "computer-use";

export interface TaskDescriptor {
  readonly category: TaskCategory;
  readonly requiresComputerUse: boolean;
  readonly requiresVision: boolean;
  readonly estimatedTokens: number;
  readonly priority: "latency" | "balanced" | "quality" | "cost";
}

// ── Agent Types ─────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

export interface AgentMessage {
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly model?: string;
  readonly provider?: ProviderName;
  readonly tokensUsed?: number;
  readonly cost?: number;
  /** Stable identifier for O(1) lookup via the runtime's message index. */
  readonly id?: string;
}

export interface WotannQueryOptions {
  readonly prompt: string;
  readonly context?: readonly AgentMessage[];
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly provider?: ProviderName;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly tools?: readonly ToolDefinition[];
  /** TurboQuant KV cache compression params for Ollama local models. */
  readonly ollamaParams?: {
    readonly numCtx: number;
    readonly kvCacheType: string;
    readonly flashAttention: boolean;
  };
}

// ── Tool Types ──────────────────────────────────────────────

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

// ── Hook Types ──────────────────────────────────────────────

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  // ToolResultReceived fires when a raw tool_result chunk arrives back
  // from the tool layer, BEFORE it enters the model's next-turn context.
  // PostToolUse fires once the agent's response text is assembled; by
  // then any prompt-injection in the tool output is already visible
  // to the model. Guards like ResultInjectionScanner need this earlier
  // hook event so they can sanitise (or block) before the model sees
  // the result. Session-5 §Tier-1 architectural fix.
  | "ToolResultReceived"
  | "UserPromptSubmit"
  | "Stop"
  | "SubagentStop"
  | "PreCompact"
  | "PostCompact"
  | "Notification"
  | "SubagentStart"
  | "PermissionRequest"
  | "SessionStart"
  | "SessionEnd"
  | "Setup"
  | "TeammateIdle"
  | "TaskCompleted"
  | "ConfigChange"
  | "WorktreeCreate"
  | "WorktreeRemove";

export type HookProfile = "minimal" | "standard" | "strict";

// ── Config Types ────────────────────────────────────────────

export interface WotannConfig {
  readonly version: string;
  readonly providers: Partial<Record<ProviderName, ProviderConfig>>;
  readonly hooks: HookConfig;
  readonly memory: MemoryConfig;
  readonly ui: UIConfig;
  readonly daemon: DaemonConfig;
}

export interface ProviderConfig {
  readonly enabled: boolean;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly priority?: number;
}

export interface HookConfig {
  readonly profile: HookProfile;
  readonly custom?: readonly string[];
}

export interface MemoryConfig {
  readonly enabled: boolean;
  readonly dbPath?: string;
  readonly maxEntries?: number;
}

export interface UIConfig {
  readonly theme: string;
  readonly panels: readonly string[];
}

export interface DaemonConfig {
  readonly enabled: boolean;
  readonly tickInterval?: number;
  readonly heartbeatPath?: string;
}

// ── Permission Types ────────────────────────────────────────

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "bypassPermissions"
  | "dontAsk";

export type PermissionDecision = "allow" | "deny" | "always-allow";

// ── Session Types ───────────────────────────────────────────

export interface SessionState {
  readonly id: string;
  readonly startedAt: Date;
  readonly provider: ProviderName;
  readonly model: string;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly toolCalls: number;
  readonly messages: readonly AgentMessage[];
  /** When true, conversation is not saved to history, memory is not captured, and learning is skipped */
  readonly incognito: boolean;
}
