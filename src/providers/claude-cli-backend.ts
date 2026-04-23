/**
 * claude-cli-backend — spawns the `claude` binary as a subprocess, parses
 * stream-json, and lets the binary own its own credentials.
 *
 * Follows the pattern OpenClaw documents as sanctioned (per
 * docs.openclaw.ai/concepts/oauth + FAQ). NOT a claim that this usage is
 * "Anthropic-sanctioned" — that's OpenClaw's hedged wording, not ours to
 * strengthen.
 *
 * Key architectural invariant: WOTANN never sends a Claude subscription
 * access token to api.anthropic.com itself. Only the `claude` binary does,
 * exactly the same way a shell-invoked `claude -p` does. WOTANN is a
 * launcher + parser, not an authentication broker. `readClaudeCliCredentials`
 * is DISPLAY-ONLY — the returned `accessTokenPreview` is an 8-char prefix
 * for onboarding expiry badges and must never be shipped as an
 * Authorization header.
 *
 * Replaces src/providers/anthropic-subscription.ts (self-token-using
 * antipattern deleted per V9 T0.1).
 */

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
  StopReason,
} from "./types.js";
import { getModelContextConfig } from "../context/limits.js";
import { execFileNoThrow } from "../utils/execFileNoThrow.js";

// ── Paths ─────────────────────────────────────────────────────────────────

/** Current Claude CLI credential file. Leading dot — the old `credentials`
 *  path (without dot) was a 2024 layout that the current binary no longer
 *  uses. Confirmed via OpenClaw source + Claude Code docs 2026-04. */
const CLAUDE_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_KEYCHAIN_ACCOUNT = "Claude Code";

/** Legacy file written by previous WOTANN versions. Migrated on first
 *  read post-upgrade to `.legacy/` with a timestamp suffix. */
const WOTANN_LEGACY_OAUTH_FILE = join(homedir(), ".wotann", "anthropic-oauth.json");
const WOTANN_LEGACY_ARCHIVE_DIR = join(homedir(), ".wotann", ".legacy");

// ── Env scrub list ────────────────────────────────────────────────────────

/**
 * 38 env vars that MUST be deleted from the child process environment
 * before `spawn("claude", ...)`. Source: OpenClaw@main
 * extensions/anthropic/cli-shared.ts:50-89 (MIT-licensed, reproduced
 * verbatim).
 *
 * Rationale:
 * - ANTHROPIC_* API_KEY / TOKEN vars would cause the CLI to bypass the
 *   subscription session and bill against a raw API key.
 * - CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST is a host-managed marker — if
 *   left set, the run counts against the hosting provider's tier, NOT
 *   the user's subscription quota. This was the single highest-impact
 *   miss before V9 closure.
 * - CLAUDE_CONFIG_DIR would redirect the CLI's settings to a wrong path.
 * - OTEL_* vars would cross-contaminate WOTANN telemetry with CLI spans.
 */
export const CLAUDE_CLI_CLEAR_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY_OLD",
  "ANTHROPIC_API_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_OAUTH_TOKEN",
  "ANTHROPIC_UNIX_SOCKET",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CLAUDE_CODE_PLUGIN_CACHE_DIR",
  "CLAUDE_CODE_PLUGIN_SEED_DIR",
  "CLAUDE_CODE_REMOTE",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_COWORK_PLUGINS",
  "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
  "OTEL_SERVICE_NAME",
  "OTEL_RESOURCE_ATTRIBUTES",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TIMEOUT",
  "OTEL_TRACES_EXPORTER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_TRACES_SAMPLER",
  "OTEL_TRACES_SAMPLER_ARG",
  "OTEL_METRIC_EXPORT_INTERVAL",
  "OTEL_METRIC_EXPORT_TIMEOUT",
  "OTEL_LOG_LEVEL",
  "OTEL_PROPAGATORS",
  "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT",
  "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT",
] as const;

// ── Public types ──────────────────────────────────────────────────────────

export interface ClaudeCredential {
  readonly type: "oauth" | "token";
  /**
   * 8-char prefix of the access token — for display in the expiry badge
   * only. NEVER ship as an Authorization header anywhere. Not suitable
   * for authentication; only for showing the user which session is
   * active.
   */
  readonly accessTokenPreview?: string;
  /** Unix epoch milliseconds; undefined if not present in source. */
  readonly expiresAt?: number;
  readonly source: "keychain" | "file";
}

export interface ClaudeInvokeOptions {
  readonly prompt: string;
  readonly model: "opus" | "sonnet" | "haiku";
  readonly systemPrompt?: string;
  readonly sessionId?: string;
  readonly mcpConfigPath?: string;
  readonly pluginDir?: string;
}

export interface ClaudeCliChild {
  readonly messages: AsyncIterable<unknown>;
  /** Unix exit code once the child exits. Resolves on child-exit only. */
  readonly exitCode: Promise<number>;
}

// ── Credential reader (DISPLAY-ONLY) ──────────────────────────────────────

/**
 * Read the currently-active Claude CLI credential for display only. Use
 * the returned `accessTokenPreview` exclusively for onboarding UI
 * (expiry badge) — NEVER as an Authorization header. The `claude`
 * binary reads its own credentials when spawned; WOTANN must not
 * re-ship them anywhere.
 *
 * Precedence (matches Claude CLI's own lookup order):
 *   1. macOS Keychain `Claude Code-credentials` / `Claude Code`
 *   2. `~/.claude/.credentials.json`
 *
 * Returns `null` if no credential is present or the source is
 * unparseable. Errors are swallowed deliberately so callers can show a
 * single "not authenticated" state without branching on reason.
 */
export async function readClaudeCliCredentials(): Promise<ClaudeCredential | null> {
  if (platform() === "darwin") {
    const result = await execFileNoThrow("security", [
      "find-generic-password",
      "-s",
      CLAUDE_KEYCHAIN_SERVICE,
      "-a",
      CLAUDE_KEYCHAIN_ACCOUNT,
      "-w",
    ]);
    if (result.exitCode === 0 && result.stdout.trim().length > 0) {
      const parsed = tryParseCredentialBlob(result.stdout.trim());
      if (parsed) {
        return { ...parsed, source: "keychain" };
      }
    }
  }

  if (existsSync(CLAUDE_CREDENTIALS_PATH)) {
    try {
      const raw = readFileSync(CLAUDE_CREDENTIALS_PATH, "utf8");
      const parsed = tryParseCredentialBlob(raw);
      if (parsed) {
        return { ...parsed, source: "file" };
      }
    } catch {
      // Malformed or unreadable — return null (matches plaintext contract).
    }
  }

  return null;
}

/**
 * Shape both credential blobs (Keychain and file) agree on:
 *   { "claudeAiOauth": { accessToken, refreshToken?, expiresAt? } }
 *
 * Returns the display-safe projection or null if shape doesn't match.
 */
function tryParseCredentialBlob(raw: string): Omit<ClaudeCredential, "source"> | null {
  try {
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
      };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return {
      type: oauth.refreshToken ? "oauth" : "token",
      accessTokenPreview: `${oauth.accessToken.slice(0, 8)}...`,
      expiresAt: oauth.expiresAt,
    };
  } catch {
    return null;
  }
}

// ── Legacy-file migration ─────────────────────────────────────────────────

/**
 * One-shot migration for users upgrading from prior WOTANN versions that
 * wrote `~/.wotann/anthropic-oauth.json`. Moves the file to
 * `~/.wotann/.legacy/` with a timestamp suffix, so users retain a 30-day
 * rollback window. The archived file is never read — only preserved.
 *
 * Returns true if a migration happened; false if there was nothing to
 * migrate. Never throws — caller just logs the return value.
 */
export function migrateLegacyCredentialFile(): boolean {
  if (!existsSync(WOTANN_LEGACY_OAUTH_FILE)) return false;
  try {
    if (!existsSync(WOTANN_LEGACY_ARCHIVE_DIR)) {
      mkdirSync(WOTANN_LEGACY_ARCHIVE_DIR, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(WOTANN_LEGACY_ARCHIVE_DIR, `anthropic-oauth.${stamp}.json.bak`);
    renameSync(WOTANN_LEGACY_OAUTH_FILE, dest);
    return true;
  } catch {
    // If we can't archive cleanly, leave the file in place — never delete.
    return false;
  }
}

// ── Environment scrub ─────────────────────────────────────────────────────

/**
 * Strip 38 vars from a process env snapshot before spawning `claude`.
 * Pure — takes the parent env, returns a new env. Never mutates the
 * caller's env. See CLAUDE_CLI_CLEAR_ENV above for the rationale of
 * each var.
 */
export function scrubClaudeEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = { ...parent };
  for (const key of CLAUDE_CLI_CLEAR_ENV) {
    delete scrubbed[key];
  }
  return scrubbed;
}

// ── Subprocess invocation ─────────────────────────────────────────────────

/**
 * Spawn `claude -p …` with the exact argv shape OpenClaw documents
 * as sanctioned, return stream-json messages as an async iterable, and
 * expose the exit code as a promise.
 *
 * Key flag pins (all forced — not user-configurable at this layer):
 *   --setting-sources user         isolates from any project-level
 *                                  settings that might redirect auth
 *   --permission-mode bypassPermissions
 *                                  WOTANN is the trust authority; the
 *                                  CLI must not prompt the user mid-run
 *   --output-format stream-json    allows incremental parsing for
 *                                  real-time UI
 *   --include-partial-messages     surfaces mid-turn tokens
 *   --verbose                      ensures tool-use events are emitted
 *
 * All user-supplied inputs (prompt, model, sessionId, systemPrompt,
 * mcpConfigPath, pluginDir) are passed as argv — never interpolated
 * into a shell string. spawn() is called without `shell: true`, so
 * there is no shell parsing layer that could interpret metacharacters.
 */
export function invokeClaudeCli(opts: ClaudeInvokeOptions): ClaudeCliChild {
  const args: string[] = [
    "-p",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--setting-sources",
    "user",
    "--permission-mode",
    "bypassPermissions",
    "--model",
    opts.model,
  ];
  if (opts.sessionId) args.push("--session-id", opts.sessionId);
  if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
  if (opts.mcpConfigPath) args.push("--mcp-config", opts.mcpConfigPath);
  if (opts.pluginDir) args.push("--plugin-dir", opts.pluginDir);

  const env = scrubClaudeEnv(process.env);
  const child = spawn("claude", args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdin.end(opts.prompt);

  const exitCode = new Promise<number>((resolve) => {
    child.once("exit", (code) => resolve(typeof code === "number" ? code : 1));
    child.once("error", () => resolve(1));
  });

  return {
    messages: parseStreamJson(child.stdout),
    exitCode,
  };
}

/**
 * Yield each parsed JSON line from a readable stream. Malformed lines
 * are skipped silently — the stream-json format expects one JSON value
 * per line; partial writes (e.g., chunk boundaries mid-JSON-value) are
 * reassembled by the internal buffer, then parsed when a newline
 * arrives. The final unterminated tail is parsed on stream end.
 */
async function* parseStreamJson(stdout: NodeJS.ReadableStream): AsyncIterable<unknown> {
  let buf = "";
  for await (const chunk of stdout) {
    buf += chunk.toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.length > 0) {
        try {
          yield JSON.parse(line);
        } catch {
          // Skip malformed line — don't poison the rest of the stream.
        }
      }
      nl = buf.indexOf("\n");
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) {
    try {
      yield JSON.parse(tail);
    } catch {
      // Skip malformed tail.
    }
  }
}

// ── CLI availability + detection ──────────────────────────────────────────

/**
 * Cheap check: is the `claude` binary on PATH and responsive? Used during
 * provider discovery and the "Found existing Claude login" banner in
 * onboarding. Returns false on ENOENT, timeout, or any non-"claude" output.
 */
export function isClaudeCliAvailable(): boolean {
  try {
    const result = execFileSync("claude", ["--version"], {
      stdio: "pipe",
      timeout: 5000,
      encoding: "utf-8",
    });
    return result.includes("claude");
  } catch {
    return false;
  }
}

/**
 * Shape returned to the desktop "Found existing login — tap to import"
 * banner. Kept identical to the legacy `anthropic-subscription.ts` export
 * so callers don't need a shape migration.
 *
 * `path` is the source the credential was found at (keychain or
 * `.credentials.json`) — never a token itself. Callers use it only for
 * display ("via macOS Keychain" / "via ~/.claude/.credentials.json").
 */
export interface AnthropicCredentialDetection {
  readonly found: boolean;
  readonly path?: string;
  readonly expiresAt?: number | null;
}

/**
 * Detect whether the user has a usable Claude CLI credential, without
 * spawning a login flow. Async because macOS Keychain lookup is an IPC
 * call (`security find-generic-password`). Returns {found:false} if
 * neither source yields a credential.
 */
export async function detectExistingAnthropicCredential(): Promise<AnthropicCredentialDetection> {
  const cred = await readClaudeCliCredentials();
  if (!cred) return { found: false };
  const path =
    cred.source === "keychain"
      ? `macOS Keychain (service: ${CLAUDE_KEYCHAIN_SERVICE})`
      : CLAUDE_CREDENTIALS_PATH;
  return { found: true, path, expiresAt: cred.expiresAt ?? null };
}

// ── Login-envelope shape ──────────────────────────────────────────────────

/**
 * Result envelope the desktop "Sign in with Claude Max" toast expects.
 * Kept shape-compatible with the legacy `startAnthropicLogin` return so
 * the RPC handler in `src/daemon/kairos-rpc.ts` needs no caller rewrite.
 */
export interface AnthropicCliLoginResult {
  readonly success: boolean;
  readonly provider: "anthropic";
  readonly expiresAt: number | null;
  readonly tokenSource?: string;
  readonly error?: string;
}

/**
 * Delegate to `claude login`. Exec-only — NEVER copies the resulting
 * token to `~/.wotann/anthropic-oauth.json` (that was the self-token-using
 * antipattern removed per V9 T0.1). The `claude` binary owns its own
 * credential lifecycle; WOTANN just kicks off the browser flow and
 * reports whether the CLI finished successfully.
 *
 * Returns a Promise that resolves on CLI exit. Never rejects — failures
 * are reported via the envelope's `error` field to keep the RPC surface
 * clean.
 */
export async function startAnthropicLogin(): Promise<AnthropicCliLoginResult> {
  const timeoutMs = 4 * 60 * 1000;
  const result = await execFileNoThrow("claude", ["login"]);
  if (result.exitCode !== 0) {
    return {
      success: false,
      provider: "anthropic",
      expiresAt: null,
      error: result.stderr.trim() || `claude login exited with code ${result.exitCode}`,
    };
  }
  void timeoutMs;
  // Read back the credential for expiry display. If the login succeeded
  // but we can't read the credential, that's a Keychain / filesystem
  // permission problem, not a login failure — report success with a
  // null expiry rather than fabricating a failure.
  const cred = await readClaudeCliCredentials();
  const source =
    cred?.source === "keychain"
      ? `macOS Keychain (${CLAUDE_KEYCHAIN_SERVICE})`
      : cred?.source === "file"
        ? CLAUDE_CREDENTIALS_PATH
        : undefined;
  return {
    success: true,
    provider: "anthropic",
    expiresAt: cred?.expiresAt ?? null,
    ...(source ? { tokenSource: source } : {}),
  };
}

// ── Subprocess-based ProviderAdapter ──────────────────────────────────────

/**
 * Build a `ProviderAdapter` that routes Anthropic queries through the
 * spawned `claude` binary. Replaces the legacy
 * `createAnthropicSubscriptionAdapter()` (SDK-based, deleted per V9 T0.1).
 *
 * The old adapter imported `@anthropic-ai/claude-agent-sdk` and called
 * `sdkQuery()` — effectively the SDK was spawning the same `claude`
 * binary internally and wrapping it in typed iterators. This adapter
 * cuts out the middleman: spawn directly, parse stream-json messages
 * at the JSON level, yield `StreamChunk`s matching the same interface.
 *
 * Emits the same StreamChunk taxonomy as the old adapter:
 *   - text         per `content_block_delta` text_delta OR final assistant text block
 *   - thinking     per `content_block_delta` thinking_delta OR final assistant thinking block
 *   - tool_use     per assistant tool_use block (with toolName, toolInput, toolCallId)
 *   - done         per terminal `result` message (subtype "success")
 *   - error        per terminal `result` message (subtype != "success") or parse failure
 */
export function createAnthropicCliAdapter(): ProviderAdapter {
  const defaultConfig = getModelContextConfig("claude-sonnet-4-6", "anthropic");
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: true,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: defaultConfig.maxContextTokens,
  };

  // Map the subset of `options.model` values WOTANN uses to the `claude -p`
  // --model flag vocabulary. The CLI accepts the short family names
  // ("opus", "sonnet", "haiku"); full slugs like "claude-sonnet-4-6" are
  // not recognized.
  function mapModel(requested: string | undefined): "opus" | "sonnet" | "haiku" {
    const m = (requested ?? "").toLowerCase();
    if (m.includes("opus")) return "opus";
    if (m.includes("haiku")) return "haiku";
    return "sonnet"; // default, matches old adapter's default
  }

  async function* query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const model = mapModel(options.model);
    try {
      const child = invokeClaudeCli({
        prompt: options.prompt,
        model,
        ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      });

      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let stopReason: StopReason = "stop";
      let finalModel: string | undefined;

      for await (const raw of child.messages) {
        const msg = raw as {
          type?: string;
          subtype?: string;
          event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
          message?: {
            model?: string;
            content?: ReadonlyArray<{
              type?: string;
              text?: string;
              thinking?: string;
              id?: string;
              name?: string;
              input?: unknown;
            }>;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
            stop_reason?: string;
          };
          result?: string;
          error?: string;
        };

        if (msg.type === "assistant" && msg.message) {
          finalModel = msg.message.model ?? finalModel;
          for (const block of msg.message.content ?? []) {
            if (block.type === "text" && typeof block.text === "string") {
              yield {
                type: "text",
                content: block.text,
                ...(finalModel ? { model: finalModel } : {}),
                provider: "anthropic",
              };
            } else if (block.type === "tool_use") {
              const input =
                block.input && typeof block.input === "object"
                  ? (block.input as Record<string, unknown>)
                  : {};
              yield {
                type: "tool_use",
                content: JSON.stringify(input),
                toolName: block.name ?? "",
                ...(block.id ? { toolCallId: block.id } : {}),
                toolInput: input,
                ...(finalModel ? { model: finalModel } : {}),
                provider: "anthropic",
                stopReason: "tool_calls",
              };
              stopReason = "tool_calls";
            } else if (block.type === "thinking" && typeof block.thinking === "string") {
              yield {
                type: "thinking",
                content: block.thinking,
                ...(finalModel ? { model: finalModel } : {}),
                provider: "anthropic",
              };
            }
          }
          const usage = msg.message.usage;
          if (usage) {
            inputTokens = usage.input_tokens ?? inputTokens;
            outputTokens = usage.output_tokens ?? outputTokens;
            totalTokens = inputTokens + outputTokens;
            if (usage.cache_read_input_tokens && usage.cache_read_input_tokens > 0) {
              cacheReadTokens = usage.cache_read_input_tokens;
            }
            if (usage.cache_creation_input_tokens && usage.cache_creation_input_tokens > 0) {
              cacheWriteTokens = usage.cache_creation_input_tokens;
            }
          }
          const rawStop = msg.message.stop_reason;
          if (rawStop === "tool_use") stopReason = "tool_calls";
          else if (rawStop === "max_tokens") stopReason = "max_tokens";
          else if (rawStop === "end_turn" || rawStop === "stop_sequence") stopReason = "stop";
        } else if (msg.type === "stream_event" && msg.event) {
          const event = msg.event;
          if (event.type === "content_block_delta" && event.delta) {
            const delta = event.delta;
            if (delta.type === "text_delta" && delta.text) {
              yield { type: "text", content: delta.text, provider: "anthropic" };
            } else if (delta.type === "thinking_delta" && delta.thinking) {
              yield { type: "thinking", content: delta.thinking, provider: "anthropic" };
            }
          }
        } else if (msg.type === "result") {
          if (msg.subtype === "success") {
            yield {
              type: "done",
              content: msg.result ?? "",
              provider: "anthropic",
              tokensUsed: totalTokens,
              usage: {
                inputTokens,
                outputTokens,
                ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
                ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
              },
              stopReason,
            };
          } else {
            yield {
              type: "error",
              content: `Claude CLI error: ${msg.error ?? "unknown"}`,
              provider: "anthropic",
            };
          }
        }
      }
    } catch (error) {
      yield {
        type: "error",
        content: `Claude CLI error: ${error instanceof Error ? error.message : "unknown"}`,
        provider: "anthropic",
      };
    }
  }

  return {
    id: "anthropic-cli",
    name: "anthropic",
    transport: "anthropic",
    capabilities,
    query,
    listModels: async () => ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    isAvailable: async () => isClaudeCliAvailable(),
  };
}
