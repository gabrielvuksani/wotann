/**
 * Native Google Gemini adapter (S3-1).
 *
 * Replaces the OpenAI-compatibility shim for users with GEMINI_API_KEY
 * configured. Hitting `generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`
 * directly unlocks Gemini-specific capabilities that the /openai/ endpoint
 * strips out:
 *
 *   - `google_search` grounding — FREE web search (500-1500 queries/day
 *     on the free tier)
 *   - `code_execution` — FREE sandboxed Python execution
 *   - `url_context` — FREE URL content extraction (20 URLs, 34 MB each)
 *   - `thinking_config.thinking_budget` — tunable reasoning depth
 *   - Thought signatures (preserved across tool loops)
 *   - 1M-token context window
 *   - Native vision, audio, and (Gemini 3+) video understanding
 *
 * Users with only a Gemini key get free tool-level capabilities that no
 * other provider matches. That's the free-tier differentiator called out
 * in the §16 Google-stack analysis of the master audit.
 *
 * The adapter conforms to the `ProviderAdapter` interface so it slots into
 * the existing fallback/router pipeline with no downstream changes.
 */

import type {
  ProviderAdapter,
  UnifiedQueryOptions,
  StreamChunk,
  ProviderCapabilities,
} from "./types.js";
import { getModelContextConfig } from "../context/limits.js";

// ── Wire types (subset of the Gemini REST schema we use) ────────────

/**
 * Gemini's "part" discriminated union. A single content message can
 * interleave text, inline data (images/audio), tool requests, and tool
 * responses in one array.
 */
interface GeminiPartText {
  readonly text: string;
}
interface GeminiPartFunctionCall {
  readonly functionCall: { readonly name: string; readonly args: Record<string, unknown> };
}
interface GeminiPartFunctionResponse {
  readonly functionResponse: {
    readonly name: string;
    readonly response: Record<string, unknown>;
  };
}
interface GeminiPartThought {
  readonly thought: true;
  readonly text: string;
}
interface GeminiPartExecutableCode {
  readonly executableCode: { readonly language: string; readonly code: string };
}
interface GeminiPartCodeExecutionResult {
  readonly codeExecutionResult: { readonly outcome: string; readonly output?: string };
}
type GeminiPart =
  | GeminiPartText
  | GeminiPartFunctionCall
  | GeminiPartFunctionResponse
  | GeminiPartThought
  | GeminiPartExecutableCode
  | GeminiPartCodeExecutionResult;

interface GeminiContent {
  readonly role: "user" | "model";
  readonly parts: readonly GeminiPart[];
}

interface GeminiCandidate {
  readonly content?: GeminiContent;
  readonly finishReason?: string;
  readonly groundingMetadata?: Record<string, unknown>;
}

interface GeminiUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly totalTokenCount?: number;
  readonly thoughtsTokenCount?: number;
}

interface GeminiStreamChunk {
  readonly candidates?: readonly GeminiCandidate[];
  readonly usageMetadata?: GeminiUsageMetadata;
}

// ── Adapter options ───────────────────────────────────────────────

export interface GeminiNativeOptions {
  /**
   * Enable free web-search grounding (google_search tool). Defaults to
   * true — it's one of the most valuable differentiators and costs
   * nothing on the free tier.
   */
  readonly enableWebSearch?: boolean;
  /**
   * Enable free sandboxed Python execution (code_execution tool).
   * Defaults to true.
   */
  readonly enableCodeExecution?: boolean;
  /**
   * Enable free URL content extraction (url_context tool). Defaults to
   * false because url_context counts against request size — turn it on
   * when the query explicitly references URLs.
   */
  readonly enableUrlContext?: boolean;
  /**
   * Thinking budget in tokens. Gemini 3 supports 0 (off), "low",
   * "medium", "high", or a number. Default: "medium".
   */
  readonly thinkingBudget?: "none" | "low" | "medium" | "high" | number;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Convert our internal AgentMessage array into Gemini Content[] */
function toGeminiContents(
  messages: readonly { role: string; content: string; toolCallId?: string }[],
): GeminiContent[] {
  return messages
    .filter((m) => m.role !== "system") // systemInstruction carries system content
    .map((m) => {
      const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
      return { role, parts: [{ text: m.content }] };
    });
}

/** Map our thinking-budget option to Gemini's thinkingBudget enum. */
function mapThinkingBudget(budget: GeminiNativeOptions["thinkingBudget"]): number | undefined {
  switch (budget) {
    case "none":
      return 0;
    case "low":
      return 512;
    case "medium":
      return 2048;
    case "high":
      return 8192;
    case undefined:
      return 2048;
    default:
      return typeof budget === "number" && Number.isFinite(budget) ? Math.max(0, budget) : 2048;
  }
}

function mapFinishReason(
  reason: string | undefined,
): "stop" | "tool_calls" | "max_tokens" | "content_filter" {
  switch (reason) {
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content_filter";
    case "STOP":
    default:
      return "stop";
  }
}

// ── Adapter factory ───────────────────────────────────────────────

export function createGeminiNativeAdapter(
  apiKey: string,
  options: GeminiNativeOptions = {},
): ProviderAdapter {
  const enableWebSearch = options.enableWebSearch ?? true;
  const enableCodeExecution = options.enableCodeExecution ?? true;
  const enableUrlContext = options.enableUrlContext ?? false;

  const baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  const capabilities: ProviderCapabilities = {
    supportsComputerUse: false,
    supportsToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    maxContextWindow: getModelContextConfig("gemini-3.1-pro", "gemini").maxContextTokens,
  };

  async function* query(opts: UnifiedQueryOptions): AsyncGenerator<StreamChunk> {
    const model = opts.model ?? "gemini-3.1-pro";
    const authToken = opts.authToken ?? apiKey;

    // --- Build the request body ---------------------------------------
    // Convert messages → Gemini Content[], then append the current user
    // prompt. If caller already supplied messages, we honour them.
    const contents = opts.messages ? toGeminiContents(opts.messages) : [];
    contents.push({ role: "user", parts: [{ text: opts.prompt }] });

    // tools[]: Gemini accepts a mix of user-defined functionDeclarations
    // and first-class tools like googleSearch, codeExecution, urlContext.
    const tools: Array<Record<string, unknown>> = [];
    if (opts.tools && opts.tools.length > 0) {
      tools.push({
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      });
    }
    if (enableWebSearch) tools.push({ googleSearch: {} });
    if (enableCodeExecution) tools.push({ codeExecution: {} });
    if (enableUrlContext) tools.push({ urlContext: {} });

    const systemInstruction = opts.systemPrompt
      ? { parts: [{ text: opts.systemPrompt }] }
      : undefined;

    const thinkingBudget = mapThinkingBudget(options.thinkingBudget);

    const body: Record<string, unknown> = {
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      generationConfig: {
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { maxOutputTokens: opts.maxTokens } : {}),
        ...(thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget, includeThoughts: true } }
          : {}),
      },
    };

    const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": authToken,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: "error",
          content: `Gemini API error (${response.status}): ${errorText.slice(0, 400)}`,
          model,
          provider: "gemini",
        };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: "error", content: "No response body", model, provider: "gemini" };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let totalTokens = 0;
      let stopReason: "stop" | "tool_calls" | "max_tokens" | "content_filter" = "stop";

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

          let chunk: GeminiStreamChunk;
          try {
            chunk = JSON.parse(data) as GeminiStreamChunk;
          } catch {
            continue; // malformed SSE fragment
          }

          const candidate = chunk.candidates?.[0];
          const parts = candidate?.content?.parts ?? [];
          for (const part of parts) {
            if ("thought" in part) {
              yield {
                type: "thinking",
                content: part.text,
                model,
                provider: "gemini",
              };
            } else if ("text" in part) {
              yield {
                type: "text",
                content: part.text,
                model,
                provider: "gemini",
              };
            } else if ("functionCall" in part) {
              yield {
                type: "tool_use",
                content: JSON.stringify(part.functionCall.args),
                toolName: part.functionCall.name,
                toolInput: part.functionCall.args,
                model,
                provider: "gemini",
                stopReason: "tool_calls",
              };
              stopReason = "tool_calls";
            } else if ("executableCode" in part) {
              // Gemini's native code_execution — surface the code as a
              // tool_use for the built-in pseudo-tool so the UI can
              // display it like any other tool call.
              yield {
                type: "tool_use",
                content: part.executableCode.code,
                toolName: "code_execution",
                toolInput: {
                  language: part.executableCode.language,
                  code: part.executableCode.code,
                },
                model,
                provider: "gemini",
              };
            } else if ("codeExecutionResult" in part) {
              yield {
                type: "text",
                content: `[code_execution ${part.codeExecutionResult.outcome}]\n${part.codeExecutionResult.output ?? ""}`,
                model,
                provider: "gemini",
              };
            }
          }

          if (candidate?.finishReason) {
            stopReason = mapFinishReason(candidate.finishReason);
          }

          if (chunk.usageMetadata?.totalTokenCount) {
            totalTokens = chunk.usageMetadata.totalTokenCount;
          }
        }
      }

      yield {
        type: "done",
        content: "",
        model,
        provider: "gemini",
        tokensUsed: totalTokens,
        stopReason,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      yield {
        type: "error",
        content: `Gemini error: ${message}`,
        model,
        provider: "gemini",
      };
    }
  }

  async function listModels(): Promise<readonly string[]> {
    return [
      "gemini-3.1-pro",
      "gemini-3.1-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ];
  }

  async function isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${baseUrl}/models?key=${apiKey}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  return {
    id: "gemini",
    name: "gemini",
    transport: "chat_completions",
    capabilities,
    query,
    listModels,
    isAvailable,
  };
}
