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
 * Token refresh: WOTANN does NOT refresh tokens itself (V9 T0.2 —
 * POSTing to OpenAI's OAuth endpoint with Codex CLI's public client_id
 * would masquerade as the official CLI). Instead, we re-read
 * ~/.codex/auth.json — the Codex CLI's own refresh loop keeps that
 * file fresh. If a request returns 401 and the on-disk token is
 * unchanged, we surface "session expired — run `codex login`".
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";
import { getModelContextConfig } from "../context/limits.js";
import { toCodexTools } from "./tool-serializer.js";
import { getProviderService } from "./provider-service.js";

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
 * Refresh is NOT performed by WOTANN per V9 T0.2 — POSTing to OpenAI's
 * OAuth endpoint with Codex CLI's public client_id would masquerade as
 * the official CLI. Instead, we re-read `~/.codex/auth.json`. If the
 * Codex CLI is running its own refresh loop (as `codex login` leaves
 * it), the file on disk will already have a fresh token when we
 * re-read. If not, this returns the same auth it was called with —
 * the caller then surfaces the 401 and asks the user to run
 * `codex login` themselves.
 */
function rereadAuthFromDisk(): CodexAuthFile | null {
  return readCodexAuthFile();
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

    // Re-read the on-disk auth file in case the Codex CLI rotated the
    // token out-of-band. WOTANN no longer performs OAuth refresh itself
    // (V9 T0.2) — if the token is stale, the request fails with 401
    // and the user is prompted to run `codex login` themselves.
    const fresh = rereadAuthFromDisk();
    if (fresh?.tokens.access_token) {
      auth = fresh;
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

    // S1-6 + P0-4: Codex Responses API accepts a flat `tools` array. The
    // shared tool-serializer produces the exact flat shape with the JSON
    // schema preserved verbatim and `$ref`-bearing schemas rejected up
    // front. Distinct from OpenAI Chat Completions where `parameters` is
    // nested under `function:`.
    const codexTools =
      options.tools && options.tools.length > 0 ? toCodexTools(options.tools) : undefined;

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
          // V9 Wave 6-MM — flag the failed bearer as expired so the
          // rest of the harness (UI badge, fallback chain) can react
          // BEFORE we attempt the on-disk re-read fallback.
          try {
            getProviderService().markCredentialExpired("codex", creds.token);
          } catch {
            /* provider-service init is best-effort */
          }

          // Re-read the on-disk auth file — if the Codex CLI rotated
          // the token out-of-band, we'll see a newer value. WOTANN no
          // longer performs OAuth refresh itself (V9 T0.2).
          //
          // QB#9: this re-read path stays so that the existing test
          // codifying "Codex CLI rotated the token out-of-band" still
          // passes; we just additionally call markCredentialExpired.
          const fresh = rereadAuthFromDisk();
          if (
            fresh?.tokens.access_token &&
            fresh.tokens.access_token !== auth!.tokens.access_token
          ) {
            auth = fresh;
            // V9 Wave 6-MM — drop the expired flag on a fresh on-disk
            // token so subsequent requests don't see a stale "expired"
            // marker for what is now a valid credential.
            try {
              getProviderService().clearExpiredCredential("codex");
            } catch {
              /* best effort */
            }
            yield {
              type: "error",
              content: "Token refreshed by Codex CLI — please retry the request.",
              model: inputModel,
              provider: "codex",
            };
          } else {
            // Codex needs the upstream `codex login` CLI flow to refresh
            // tokens — `wotann login codex` then re-imports the file.
            // Kept verbatim so existing UX docs / muscle memory survive,
            // but tagged with auth_expired so structured error consumers
            // (router, fallback chain) treat it like any other 401.
            yield {
              type: "error",
              content:
                "Codex session expired. Re-authenticate by running `codex login` in a shell, then `wotann login codex`.",
              code: "auth_expired",
              model: inputModel,
              provider: "codex",
              stopReason: "error",
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
