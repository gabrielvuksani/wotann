/**
 * Shared types for the WOTANN ↔ Claude SDK bridge — V9 T3 Waves 2-5.
 *
 * The Claude binary exposes 26 lifecycle "hook events" via stream-json. WOTANN
 * receives these via an HTTP transport (lower latency than stdin/stdout
 * round-trip on a long session) and returns decisions that shape the
 * subprocess's behaviour without direct token access.
 *
 * Every payload here is shape-faithful to the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk@0.5.x` typings + the documented
 * stream-json envelope). We intentionally re-define the shapes here so
 * callers don't pull in the SDK package as a runtime dependency — WOTANN
 * spawns the `claude` binary directly (per V9 T0.1 + claude-cli-backend.ts).
 *
 * Quality bars
 *   - QB #6 honest stubs: callers receive `decision: "allow"` only when the
 *     handler explicitly approved. There is no implicit allow on error.
 *   - QB #13 env guard: every dep is injected via `WaveDeps`. No
 *     module-level singleton state.
 *   - QB #14 commit messages are claims: this file ships only the wire-shape;
 *     handler logic lives in sibling files and is verified by the integration
 *     test matrix in `MASTER_PLAN_V9.md` Tier 3.
 */

// ── Hook event taxonomy (26 events) ──────────────────────────

/**
 * The full Claude Agent SDK hook event vocabulary as of v0.5 (April 2026).
 * The 6 "load-bearing" events specced in V9 T3.3 are the ones with wired
 * handlers; the rest are passively listened to and forwarded to WOTANN's
 * Observer subsystem for drift detection without participating in
 * decision-making. Event names match the SDK / Claude binary's
 * `stream-json` `event` field exactly.
 */
export type ClaudeHookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "UserPromptExpansion"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "PreCompact"
  | "PostCompact"
  | "ToolError"
  | "AgentStart"
  | "AgentEnd"
  | "ChannelMessage"
  | "ChannelOutbound"
  | "PermissionRequest"
  | "PermissionDecision"
  | "Elicitation"
  | "ElicitationResult"
  | "ModelChange"
  | "TurnStart"
  | "TurnEnd"
  | "Notification"
  | "ApiError"
  | "RateLimit"
  | "ContextWarning"
  | "QuotaWarning";

// ── Payloads (shape-faithful to stream-json) ──────────────────

export interface BasePayload {
  readonly event: ClaudeHookEvent;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly timestamp: number;
}

export interface SessionStartPayload extends BasePayload {
  readonly event: "SessionStart";
  readonly model?: string;
  readonly cwd?: string;
  readonly resumed?: boolean;
}

export interface UserPromptSubmitPayload extends BasePayload {
  readonly event: "UserPromptSubmit";
  /** The user's raw prompt text. */
  readonly prompt: string;
}

export interface UserPromptExpansionPayload extends BasePayload {
  readonly event: "UserPromptExpansion";
  readonly prompt: string;
  /** Expansion source — slash command, file mention, etc. */
  readonly source: "slash" | "mention" | "macro";
}

export interface PreToolUsePayload extends BasePayload {
  readonly event: "PreToolUse";
  readonly toolName: string;
  /** Tool arguments — opaque to the framework; handler interprets. */
  readonly input: Record<string, unknown>;
  readonly toolCallId: string;
}

export interface PostToolUsePayload extends BasePayload {
  readonly event: "PostToolUse";
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly output: unknown;
  readonly toolCallId: string;
  readonly durationMs: number;
  readonly isError?: boolean;
}

export interface StopPayload extends BasePayload {
  readonly event: "Stop";
  /** Reason the model considers the task complete. */
  readonly reason?: string;
  /** Final assistant text shown to the user, if any. */
  readonly finalText?: string;
}

export interface PreCompactPayload extends BasePayload {
  readonly event: "PreCompact";
  /** Approximate token count at the time of compaction. */
  readonly approxTokens: number;
  /** Trigger of compaction — "auto" (context fill) or "user" (/compact). */
  readonly trigger: "auto" | "user";
}

// ── Decisions (handler return shapes) ────────────────────────

/**
 * The handler's decision is a structured record. We deliberately do not
 * reuse the WOTANN-internal `HookResult` shape (`src/hooks/engine.ts`)
 * because the Claude SDK's contract is more verb-rich:
 *
 *   - `allow`        : tool call permitted with original args
 *   - `block`        : tool call rejected; `message` shown to model
 *   - `modifyInput`  : tool call permitted with rewritten args
 *   - `inject`       : prepend `additionalContext` to next assistant turn
 *   - `defer`        : route to an external resolver (council/arena),
 *                      Claude waits up to `deferTimeoutMs` ms for the
 *                      resolver to call back with a final decision
 */
export type HookDecision =
  | { readonly action: "allow" }
  | { readonly action: "block"; readonly message: string }
  | {
      readonly action: "modifyInput";
      readonly newInput: Record<string, unknown>;
      readonly reason?: string;
    }
  | {
      readonly action: "inject";
      readonly additionalContext: string;
    }
  | {
      readonly action: "defer";
      readonly deferTimeoutMs: number;
      readonly resolver: "council" | "arena" | "approval" | "human";
      readonly reason?: string;
    };

/** Stop hook returns a richer decision shape that allows blocking termination. */
export type StopDecision =
  | { readonly decision: "allow" }
  | {
      readonly decision: "block";
      readonly additionalContext: string;
      readonly reason?: string;
    };

// ── Dependency injection surface ──────────────────────────────

/**
 * Every wave in the bridge accepts a partial `WaveDeps`. Missing deps
 * trigger an "honest stub" decision (allow + warning logged) — see
 * QB #6 in CLAUDE_QUALITY_BARS.md. The bridge never hides a missing
 * dep behind a silent `allow`.
 */
export interface WaveDeps {
  /** Memory injector — UserPromptSubmit pulls relevant memory. */
  readonly memoryRecall?: (
    prompt: string,
    sessionId: string,
  ) => Promise<{ readonly contextBlock: string; readonly hits: number }>;

  /** Skill dispatcher — UserPromptSubmit + UserPromptExpansion. */
  readonly skillDispatch?: (
    prompt: string,
  ) => Promise<{ readonly skillIds: readonly string[]; readonly contextBlock: string }>;

  /** Permission resolver — PreToolUse for risky actions. */
  readonly resolvePermission?: (
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string,
  ) => Promise<{
    readonly verdict: "allow" | "deny" | "approval" | "council";
    readonly reason?: string;
    readonly modifiedInput?: Record<string, unknown>;
  }>;

  /** Observer — PostToolUse drift signal collection. */
  readonly observe?: (event: PostToolUsePayload) => Promise<void>;

  /** Reflector — Stop verifies the work is actually complete. */
  readonly reflect?: (
    payload: StopPayload,
  ) => Promise<{ readonly complete: boolean; readonly reason: string; readonly hint?: string }>;

  /** Shadow-git writer — PostToolUse(Edit|Write) records a commit. */
  readonly shadowGitWrite?: (filePath: string, content: string, sessionId: string) => Promise<void>;

  /** WAL writer — PreCompact saves session state to Engram. */
  readonly walSave?: (sessionId: string, approxTokens: number) => Promise<void>;

  /** Cost ledger — every event updates a per-session cost preview. */
  readonly recordCost?: (
    sessionId: string,
    tokens: { readonly input?: number; readonly output?: number },
  ) => Promise<void>;
}

// ── Wire shape of an HTTP hook handler ───────────────────────

/**
 * Each handler is a pure async function over (payload, deps). The HTTP
 * server in `hooks/server.ts` is the only adapter aware of HTTP.
 */
export type HookHandler<P extends BasePayload, D> = (payload: P, deps: WaveDeps) => Promise<D>;

// ── Telemetry signals (Wave 5) ────────────────────────────────

export interface CostSnapshot {
  readonly sessionId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly capturedAt: number;
}

export interface QuotaProbe {
  readonly periodTokens: number;
  readonly periodCap: number | null;
  readonly remainingPct: number | null;
  readonly resetAt: number | null;
}

// ── Errors (Wave 5) ───────────────────────────────────────────

export type ClaudeBridgeError =
  | { readonly kind: "spawn-enoent"; readonly hint: string }
  | { readonly kind: "auth-expired"; readonly source: "keychain" | "file" | "unknown" }
  | { readonly kind: "rate-limit"; readonly resetAt: number | null }
  | { readonly kind: "network-partition"; readonly bytesBuffered: number }
  | { readonly kind: "stream-truncated"; readonly bytesBuffered: number }
  | { readonly kind: "unknown"; readonly message: string };
