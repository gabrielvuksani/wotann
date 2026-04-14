/**
 * Anthropic subscription provider via @anthropic-ai/claude-agent-sdk.
 * Uses the user's existing Claude Pro/Max subscription — no API key needed.
 * The SDK spawns a Claude Code subprocess with the user's logged-in session.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";
import { getModelContextConfig } from "../context/limits.js";

// ── Anthropic OAuth Login ──────────────────────────────
//
// Claude Max/Pro subscribers sign in via the Claude Code CLI's built-in
// `claude login` flow, which opens a browser to console.anthropic.com and
// persists tokens under ~/.claude. WOTANN captures the resulting OAuth
// token by reading the CLI's known credential paths once login succeeds,
// then writes a copy to ~/.wotann/anthropic-oauth.json for its own use.

const ANTHROPIC_OAUTH_FILE = join(homedir(), ".wotann", "anthropic-oauth.json");
const CLAUDE_CREDENTIAL_PATHS = [
  join(homedir(), ".claude", "credentials"),
  join(homedir(), ".claude", "auth.json"),
  join(homedir(), ".claude-code", "auth.json"),
];

export interface AnthropicOAuthResult {
  readonly success: boolean;
  readonly provider: "anthropic";
  readonly expiresAt: number | null;
  readonly tokenSource?: string;
  readonly error?: string;
}

function readFirstExistingCredential(): { source: string; data: unknown } | null {
  for (const path of CLAUDE_CREDENTIAL_PATHS) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        return { source: path, data: JSON.parse(raw) };
      } catch {
        // Not JSON or unreadable — skip
      }
    }
  }
  return null;
}

function extractExpiresAt(creds: unknown): number | null {
  if (!creds || typeof creds !== "object") return null;
  const obj = creds as Record<string, unknown>;
  const candidates = [obj["expiresAt"], obj["expires_at"], obj["expiry"], obj["exp"]];
  for (const c of candidates) {
    if (typeof c === "number") return c < 1e12 ? c * 1000 : c;
    if (typeof c === "string" && /^\d+$/.test(c)) return Number(c);
  }
  return null;
}

/**
 * Start the Anthropic (Claude Max/Pro) OAuth login. Delegates to the Claude
 * Code CLI's `claude login` subcommand which opens a browser. After the CLI
 * persists credentials, WOTANN copies them to ~/.wotann/anthropic-oauth.json
 * so the daemon can read them without shelling out every query.
 *
 * Returns the result envelope the desktop app expects for its toast.
 */
export function startAnthropicLogin(): Promise<AnthropicOAuthResult> {
  return new Promise((resolve) => {
    const timeoutMs = 4 * 60 * 1000;
    const child = execFile("claude", ["login"], { timeout: timeoutMs, env: process.env }, (err) => {
      if (err) {
        resolve({
          success: false,
          provider: "anthropic",
          expiresAt: null,
          error: err.message,
        });
        return;
      }

      const creds = readFirstExistingCredential();
      if (!creds) {
        resolve({
          success: false,
          provider: "anthropic",
          expiresAt: null,
          error: "Login succeeded but no credentials file was found under ~/.claude",
        });
        return;
      }

      try {
        const dir = join(homedir(), ".wotann");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(
          ANTHROPIC_OAUTH_FILE,
          JSON.stringify({ source: creds.source, data: creds.data }, null, 2),
          { mode: 0o600 },
        );
      } catch {
        // Non-fatal: original CLI-managed creds still work.
      }

      resolve({
        success: true,
        provider: "anthropic",
        expiresAt: extractExpiresAt(creds.data),
        tokenSource: creds.source,
      });
    });

    // Safety: if execFile never invokes the callback for any reason, the
    // surrounding Promise would hang — the `timeout` option above covers
    // the primary case. No additional cleanup is required here because
    // unref'ing lets Node exit normally when the daemon shuts down.
    child.on?.("error", (err) => {
      resolve({
        success: false,
        provider: "anthropic",
        expiresAt: null,
        error: err.message,
      });
    });
  });
}

/**
 * Detect existing Anthropic credentials without triggering a login.
 * Used by the desktop "Found existing Claude login" banner.
 */
export function detectExistingAnthropicCredential(): {
  readonly found: boolean;
  readonly path?: string;
  readonly expiresAt?: number | null;
} {
  const creds = readFirstExistingCredential();
  if (!creds) return { found: false };
  return { found: true, path: creds.source, expiresAt: extractExpiresAt(creds.data) };
}

export function isClaudeSubscriptionAvailable(): boolean {
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

export function createAnthropicSubscriptionAdapter(): ProviderAdapter {
  const defaultConfig = getModelContextConfig("claude-sonnet-4-6", "anthropic");
  const capabilities: ProviderCapabilities = {
    supportsComputerUse: true,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: defaultConfig.maxContextTokens,
  };

  async function* query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const model = options.model ?? "claude-sonnet-4-6";
    try {
      const { query: sdkQuery } = await import("@anthropic-ai/claude-agent-sdk");
      const q = sdkQuery({
        prompt: options.prompt,
        options: {
          model,
          cwd: process.cwd(),
          permissionMode: "bypassPermissions",
          maxTurns: 10,
          systemPrompt: options.systemPrompt,
          persistSession: false,
        },
      });

      let totalTokens = 0;
      for await (const message of q) {
        if (message.type === "assistant") {
          const betaMsg = message.message;
          for (const block of betaMsg.content) {
            if (block.type === "text") {
              yield {
                type: "text",
                content: block.text,
                model: betaMsg.model,
                provider: "anthropic",
              };
            } else if (block.type === "thinking") {
              const thinking =
                "thinking" in block
                  ? String((block as unknown as { thinking: string }).thinking)
                  : "";
              yield {
                type: "thinking",
                content: thinking,
                model: betaMsg.model,
                provider: "anthropic",
              };
            }
          }
          if (betaMsg.usage) totalTokens = betaMsg.usage.input_tokens + betaMsg.usage.output_tokens;
        } else if (message.type === "stream_event") {
          const event = message.event;
          if (event.type === "content_block_delta" && "delta" in event) {
            const delta = event.delta as { type: string; text?: string };
            if (delta.type === "text_delta" && delta.text) {
              yield { type: "text", content: delta.text, provider: "anthropic" };
            }
          }
        } else if (message.type === "result") {
          if (message.subtype === "success") {
            yield {
              type: "done",
              content: message.result ?? "",
              provider: "anthropic",
              tokensUsed: totalTokens,
            };
          } else {
            yield {
              type: "error",
              content: `Claude error: ${String((message as unknown as { error?: string }).error ?? "unknown")}`,
              provider: "anthropic",
            };
          }
        }
      }
    } catch (error) {
      yield {
        type: "error",
        content: `Anthropic subscription error: ${error instanceof Error ? error.message : "unknown"}`,
        provider: "anthropic",
      };
    }
  }

  return {
    id: "anthropic-subscription",
    name: "anthropic",
    transport: "anthropic",
    capabilities,
    query,
    listModels: async () => ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    isAvailable: async () => isClaudeSubscriptionAvailable(),
  };
}
