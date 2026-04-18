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

/**
 * All hook events the engine recognises. Session-10 audit: 9 of 19
 * variants are actually fired by the runtime / daemon (PreToolUse,
 * PostToolUse, ToolResultReceived, UserPromptSubmit, Stop, PreCompact,
 * PostCompact, SessionStart, SessionEnd). The remaining 10 —
 * `PostToolUseFailure`, `SubagentStart`, `SubagentStop`,
 * `Notification`, `PermissionRequest`, `Setup`, `TeammateIdle`,
 * `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`
 * — are NEVER dispatched by any producer. They remain in the union so
 * external plugins that register handlers against them typecheck, but
 * are explicitly marked advisory-only: handlers registered against
 * them will not fire unless / until a producer is wired. See
 * `src/hooks/engine.ts` for the live dispatch table.
 *
 * Rule of thumb: if you are adding a new feature and reach for one of
 * the ADVISORY events, you must ALSO add the producer call site in
 * the same change. Otherwise the event stays dead letter.
 */
export type HookEvent =
  // ── Fired by runtime.ts ──
  | "PreToolUse"
  | "PostToolUse"
  | "ToolResultReceived"
  | "UserPromptSubmit"
  | "Stop"
  | "PreCompact"
  | "PostCompact"
  | "SessionStart"
  | "SessionEnd"
  // ── ADVISORY ONLY — no producer wired; handlers never fire ──
  // Session-10 audit dead-letter list. Keep the variants so external
  // plugins typecheck, but do not treat as real event surfaces.
  | "PostToolUseFailure" // advisory — no producer
  | "SubagentStop" // advisory — no producer
  | "Notification" // advisory — no producer
  | "SubagentStart" // advisory — no producer
  | "PermissionRequest" // advisory — no producer
  | "Setup" // advisory — no producer
  | "TeammateIdle" // advisory — no producer
  | "TaskCompleted" // advisory — no producer
  | "ConfigChange" // advisory — no producer
  | "WorktreeCreate" // advisory — no producer
  | "WorktreeRemove"; // advisory — no producer

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
