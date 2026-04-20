/**
 * Codex provider adapter using the ChatGPT backend Responses API.
 *
 * CRITICAL: The ChatGPT OAuth token does NOT work against api.openai.com.
 * It ONLY works against the ChatGPT backend:
 *   https://chatgpt.com/backend-api/codex/responses
 *
 * Auth: Bearer <access_token> + ChatGPT-Account-Id header.
 * Format: Responses API (input array, instructions field, NOT chat/completions).
 *
 * Token refresh: Uses refresh_token against https://auth.openai.com/oauth/token.
 * If refresh_token is also expired, user must re-authenticate with:
 *   npx @openai/codex --full-auto "hello"
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";
import { getModelContextConfig } from "../context/limits.js";

// ── Auth Types ──────────────────────────────────────────────

interface CodexAuthFile {
  auth_mode: string;
  OPENAI_API_KEY?: string | null;
  tokens: {
    access_token: string;
    id_token: string;
    refresh_token: string;
    account_id: string;
  };
  last_refresh: string;
}

// ── Auth Helpers ────────────────────────────────────────────

function getAuthPath(): string {
  const codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  return process.env["CODEX_AUTH_JSON_PATH"] ?? join(codexHome, "auth.json");
}

function readCodexAuthFile(): CodexAuthFile | null {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) return null;

  try {
    return JSON.parse(readFileSync(authPath, "utf-8")) as CodexAuthFile;
  } catch {
    return null;
  }
}

/**
 * Build a synthetic CodexAuthFile from a caller-supplied raw access token.
 * Used as a fallback when no on-disk Codex auth exists — primarily for test
 * fixtures that need to exercise the wire-format assembly path without
 * vendoring credentials. The `refresh_token` is left empty; refreshTokens()
 * will surface an error if the synthetic token expires mid-session, which is
 * the correct failure mode (tests never reach that branch because they
 * capture the first fetch call and abort).
 */
function synthesizeAuthFromToken(rawToken: string | undefined): CodexAuthFile | null {
  if (!rawToken) return null;
  return {
    auth_mode: "raw_token",
    tokens: {
      access_token: rawToken,
      id_token: "",
      refresh_token: "",
      account_id: "",
    },
    // Set to a future-enough timestamp so ensureFreshAuth() doesn't
    // trigger a refresh path on first use.
    last_refresh: new Date().toISOString(),
  };
}

/**
 * Extract the access token from the auth file, searching multiple nested paths.
 * Matches OpenClaw's resilient approach (10+ paths searched).
 */
export function readCodexToken(): string | null {
  const auth = readCodexAuthFile();
  if (!auth) return null;

  // Search multiple nested paths (from OpenClaw's resolveCodexApiCredentials)
  const raw = auth as unknown as Record<string, unknown>;
  const tokens = raw["tokens"] as Record<string, unknown> | undefined;
  const authBlock = raw["auth"] as Record<string, unknown> | undefined;
  const tokenBlock = raw["token"] as Record<string, unknown> | undefined;

  return (tokens?.["access_token"] ??
    tokens?.["accessToken"] ??
    raw["access_token"] ??
    raw["accessToken"] ??
    authBlock?.["access_token"] ??
    authBlock?.["accessToken"] ??
    tokenBlock?.["access_token"] ??
    tokenBlock?.["accessToken"] ??
    raw["OPENAI_API_KEY"] ??
    null) as string | null;
}

/**
 * Refresh the tokens using the refresh_token.
 * Saves updated tokens back to auth.json.
 */
async function refreshTokens(auth: CodexAuthFile): Promise<CodexAuthFile | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      refresh_token: auth.tokens.refresh_token,
    });

    const response = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      access_token?: string;
      id_token?: string;
      refresh_token?: string;
    };

    if (!data.access_token) return null;

    // Update auth file with fresh tokens
    const updated: CodexAuthFile = {
      ...auth,
      tokens: {
        ...auth.tokens,
        access_token: data.access_token,
        id_token: data.id_token ?? auth.tokens.id_token,
        refresh_token: data.refresh_token ?? auth.tokens.refresh_token,
      },
      last_refresh: new Date().toISOString(),
    };

    try {
      writeFileSync(getAuthPath(), JSON.stringify(updated, null, 2));
    } catch {
      // Non-fatal — we have the tokens in memory
    }

    return updated;
  } catch {
    return null;
  }
}

// ── Adapter ─────────────────────────────────────────────────

const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export function createCodexAdapter(rawToken?: string): ProviderAdapter {
  // Prefer the on-disk Codex auth file (where Codex CLI stores the refreshable
  // access_token + refresh_token). Fall back to the caller-supplied rawToken
  // so fixtures and test harnesses can exercise the adapter without a live
  // ~/.codex/auth.json on the runner. The fallback path skips refresh logic
  // (there's no refresh_token to use) but preserves every downstream wire-
  // format assertion — tools[], messages[], stream decoding — so CI can
  // validate request shape without vendored credentials.
  let auth = readCodexAuthFile() ?? synthesizeAuthFromToken(rawToken);
  const contextConfig = getModelContextConfig("codexplan", "codex");

  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: false,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: contextConfig.maxContextTokens,
  };

  async function ensureFreshAuth(): Promise<{ token: string; accountId: string } | null> {
    if (!auth) return null;

    // Check if token needs refresh (>8 min since last refresh, matching Codex CLI)
    const lastRefresh = new Date(auth.last_refresh);
    const minutesSinceRefresh = (Date.now() - lastRefresh.getTime()) / 60_000;

    if (minutesSinceRefresh > 8) {
      const refreshed = await refreshTokens(auth);
      if (refreshed) {
        auth = refreshed;
      }
      // If refresh fails, try with existing token anyway
    }

    return {
      token: auth.tokens.access_token,
      accountId: auth.tokens.account_id,
    };
  }

  async function* query(options: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const creds = await ensureFreshAuth();
    if (!creds) {
      yield {
        type: "error",
        content: 'Codex auth not available. Run: npx @openai/codex --full-auto "hello"',
        provider: "codex",
      };
      return;
    }

    // Map model aliases to actual model IDs
    const inputModel = options.model ?? "codexspark";
    const model =
      inputModel === "codexplan"
        ? "gpt-5.4"
        : inputModel === "codexspark"
          ? "gpt-5.3-codex"
          : inputModel === "codexmini"
            ? "gpt-5.1-codex"
            : inputModel;

    // Build Responses API request body.
    //
    // Codex Responses API requires prior tool interactions to be round-
    // tripped back as `function_call` and `function_call_output` items,
    // NOT as plain messages. The Opus audit found the prior loop only
    // wrote `{type: "message", role, content}` so the model lost all
    // pending call_ids on the second turn and would either retry the
    // call or desync entirely. Multi-turn tool loops on Codex were
    // effectively broken.
    //
    // Now:
    // - assistant messages with a toolCallId emit `function_call` items
    //   carrying call_id + name + arguments (JSON-stringified content)
    // - tool-role messages emit `function_call_output` items with the
    //   matching call_id and the tool's output string
    // - everything else keeps the current `{type: "message", ...}` shape
    const input: Array<Record<string, unknown>> = [];

    if (options.messages) {
      for (const msg of options.messages) {
        if (msg.role === "assistant" && msg.toolCallId) {
          input.push({
            type: "function_call",
            call_id: msg.toolCallId,
            name: msg.toolName ?? "unknown",
            arguments: msg.content,
          });
          continue;
        }
        if (msg.role === "tool") {
          input.push({
            type: "function_call_output",
            call_id: msg.toolCallId ?? "",
            output: msg.content,
          });
          continue;
        }
        input.push({
          type: "message",
          role: msg.role === "assistant" ? "assistant" : "user",
          content: [
            {
              type: msg.role === "assistant" ? "output_text" : "input_text",
              text: msg.content,
            },
          ],
        });
      }
    }

    // Add current prompt
    input.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: options.prompt }],
    });

    // S1-6: Codex Responses API accepts a flat `tools` array. Each tool is a
    // top-level object with `type: "function"`, `name`, `description`,
    // `parameters` (different from OpenAI Chat Completions where it's nested
    // under `function`).
    const codexTools =
      options.tools && options.tools.length > 0
        ? options.tools.map((t) => ({
            type: "function" as const,
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as Record<string, unknown>,
          }))
        : undefined;

    const body = JSON.stringify({
      model,
      instructions: options.systemPrompt ?? "",
      input,
      stream: true,
      store: false,
      ...(inputModel === "codexplan" ? { reasoning: { effort: "high" } } : {}),
      ...(codexTools ? { tools: codexTools } : {}),
    });

    try {
      const response = await fetch(`${CODEX_BASE_URL}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.token}`,
          "ChatGPT-Account-Id": creds.accountId,
          "User-Agent": "wotann-cli",
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 401) {
          // Try one more refresh
          const refreshed = await refreshTokens(auth!);
          if (refreshed) {
            auth = refreshed;
            yield {
              type: "error",
              content: "Token refreshed — please retry the request.",
              model: inputModel,
              provider: "codex",
            };
          } else {
            yield {
              type: "error",
              content:
                'Codex session expired. Re-authenticate with: npx @openai/codex --full-auto "hello"',
              model: inputModel,
              provider: "codex",
            };
          }
          return;
        }

        yield {
          type: "error",
          content: `Codex API error (${response.status}): ${errorText.slice(0, 300)}`,
          model: inputModel,
          provider: "codex",
        };
        return;
      }

      // Parse SSE stream (Responses API format)
      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: "error", content: "No response body", model: inputModel, provider: "codex" };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let totalTokens = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" = "stop";

      // S1-23: Codex Responses API tool-call + reasoning events.
      // The stream sends response.function_call_arguments.delta fragments
      // keyed by item_id, plus response.reasoning.delta for chain-of-thought.
      // Function call metadata (name, id) arrives on response.output_item.added
      // before any argument fragments.
      const codexToolState = new Map<
        string,
        { name: string; callId: string; args: string; emitted: boolean }
      >();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            const eventType = event["type"] as string | undefined;

            if (eventType === "response.output_text.delta") {
              const delta = event["delta"] as string | undefined;
              if (delta) {
                yield { type: "text", content: delta, model: inputModel, provider: "codex" };
              }
            } else if (eventType === "response.reasoning.delta") {
              const delta = event["delta"] as string | undefined;
              if (delta) {
                yield { type: "thinking", content: delta, model: inputModel, provider: "codex" };
              }
            } else if (eventType === "response.output_item.added") {
              const item = event["item"] as Record<string, unknown> | undefined;
              if (item && item["type"] === "function_call") {
                const id = (item["id"] as string) ?? "";
                const callId = (item["call_id"] as string) ?? id;
                const name = (item["name"] as string) ?? "";
                if (id) {
                  codexToolState.set(id, { name, callId, args: "", emitted: false });
                }
              }
            } else if (eventType === "response.function_call_arguments.delta") {
              const itemId = (event["item_id"] as string) ?? "";
              const delta = (event["delta"] as string) ?? "";
              if (itemId) {
                const state = codexToolState.get(itemId) ?? {
                  name: "",
                  callId: itemId,
                  args: "",
                  emitted: false,
                };
                state.args += delta;
                codexToolState.set(itemId, state);
              }
            } else if (eventType === "response.function_call_arguments.done") {
              const itemId = (event["item_id"] as string) ?? "";
              const state = codexToolState.get(itemId);
              if (state && !state.emitted && state.name) {
                let parsedInput: Record<string, unknown> = {};
                try {
                  parsedInput = state.args
                    ? (JSON.parse(state.args) as Record<string, unknown>)
                    : {};
                } catch {
                  yield {
                    type: "error",
                    content: `Codex: malformed tool arguments for ${state.name}`,
                    model: inputModel,
                    provider: "codex",
                  };
                  state.emitted = true;
                  continue;
                }
                yield {
                  type: "tool_use",
                  content: state.args,
                  toolName: state.name,
                  toolCallId: state.callId,
                  toolInput: parsedInput,
                  model: inputModel,
                  provider: "codex",
                  stopReason: "tool_calls",
                };
                state.emitted = true;
                stopReason = "tool_calls";
              }
            } else if (eventType === "response.completed" || eventType === "response.done") {
              const resp = event["response"] as Record<string, unknown> | undefined;
              const usage = (resp?.["usage"] ?? event["usage"]) as
                | Record<string, number>
                | undefined;
              if (usage) {
                totalTokens = usage["total_tokens"] ?? 0;
                inputTokens = usage["input_tokens"] ?? usage["prompt_tokens"] ?? 0;
                outputTokens = usage["output_tokens"] ?? usage["completion_tokens"] ?? 0;
              }
            } else if (eventType === "response.failed") {
              const error = event["error"] as Record<string, unknown> | undefined;
              yield {
                type: "error",
                content: `Codex response failed: ${error?.["message"] ?? "unknown error"}`,
                model: inputModel,
                provider: "codex",
              };
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }

      // Wave 4G: surface split usage for honest cost attribution.
      const finalInput = inputTokens > 0 ? inputTokens : Math.floor(totalTokens / 2);
      const finalOutput = outputTokens > 0 ? outputTokens : Math.max(0, totalTokens - finalInput);
      yield {
        type: "done",
        content: "",
        model: inputModel,
        provider: "codex",
        tokensUsed: totalTokens,
        usage: {
          inputTokens: finalInput,
          outputTokens: finalOutput,
        },
        stopReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      yield {
        type: "error",
        content: `Codex error: ${message}`,
        model: inputModel,
        provider: "codex",
      };
    }
  }

  async function listModels(): Promise<readonly string[]> {
    // codexplan = GPT-5.4 (high reasoning), codexspark = GPT-5.3-Codex (fast loops)
    // codexmini = GPT-5.1-Codex (Max, with optional Mini variant)
    return ["codexplan", "codexspark", "codexmini"];
  }

  async function isAvailable(): Promise<boolean> {
    return auth !== null && auth.tokens?.access_token?.length > 0;
  }

  return {
    id: "codex",
    name: "codex",
    transport: "codex_responses",
    capabilities,
    query,
    listModels,
    isAvailable,
  };
}
