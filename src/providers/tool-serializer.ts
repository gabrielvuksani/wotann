/**
 * Unified tool serializer.
 *
 * Per MASTER_PLAN_V8 P0-4 + RESEARCH_HERMES_AGENT_PORT (§4.1, §5):
 * Hermes Agent's `convert_tools_to_anthropic` is a pass-through that
 * copies the caller's JSON schema verbatim into the provider envelope.
 * The 1-line pattern preserves nested objects, arrays-of-objects,
 * `additionalProperties`, `required` arrays, and `enum` automatically
 * because JSON pass-through is structure-preserving.
 *
 * This module is the single home for that pattern across WOTANN's four
 * provider families that take their tool schemas via the chat-completions
 * / messages-style payload:
 *
 *   - Anthropic Messages API   → { name, description, input_schema }
 *   - OpenAI Chat Completions  → { type: "function", function: {...} }
 *   - Codex Responses API      → flat { type, name, description, parameters }
 *   - GitHub Copilot           → identical to OpenAI (it's a proxy)
 *
 * Bedrock + Vertex + Gemini-native + Ollama are intentionally NOT routed
 * here — each has a wire format different enough that a shared serializer
 * would obscure rather than clarify (Bedrock wraps in `toolSpec.inputSchema.json`,
 * Gemini in `tools[0].functionDeclarations`, Ollama in native /api/chat
 * `tools` with its own quirks). Those adapters keep their bespoke
 * serializers, locked by their own regression tests.
 *
 * `$ref` handling: every shared-serializer provider rejects `$ref` in tool
 * schemas because none of them dereference it before sending to the model.
 * Without this guard, the request reaches the API and returns an opaque
 * 400 ("invalid_request_error") that's hard to root-cause. We fail loud
 * with the offending tool name so callers can pre-resolve refs.
 */

import type { ToolSchema } from "./types.js";

// ── Provider Envelope Types ─────────────────────────────────

/** Anthropic Messages API tool envelope. */
export interface AnthropicToolParam {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/** OpenAI Chat Completions tool envelope. */
export interface OpenAIToolParam {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

/**
 * Codex Responses API tool envelope. Note this is FLAT — `parameters` lives
 * on the top-level object, not nested under `function`. The Responses API
 * format diverges from Chat Completions in this one way and Codex is the
 * only adapter that hits it.
 */
export interface CodexToolParam {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** Copilot envelope — identical to OpenAI (Copilot proxies the OpenAI wire format). */
export type CopilotToolParam = OpenAIToolParam;

// ── $ref Detection ──────────────────────────────────────────

/**
 * Recursively scan a JSON schema for any `$ref` key. Returns true on the
 * first hit. Used as the gate before each serializer emits a tool whose
 * schema would confuse the receiving provider.
 *
 * Walks: object properties, array items, oneOf/anyOf/allOf, $defs.
 * Stops at primitives. Handles cycles by short-circuiting on the first
 * `$ref` (cyclic schemas are themselves an error case the caller should
 * resolve before serializing).
 */
export function containsRef(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsRef(item)) return true;
    }
    return false;
  }
  const obj = value as Record<string, unknown>;
  if ("$ref" in obj) return true;
  for (const key of Object.keys(obj)) {
    if (containsRef(obj[key])) return true;
  }
  return false;
}

/**
 * Throw a clean Error if the tool's schema contains `$ref`. The error
 * message names the tool so callers can find and pre-resolve the ref.
 */
function assertNoRef(tool: ToolSchema): void {
  if (containsRef(tool.inputSchema)) {
    throw new Error(
      `Tool "${tool.name}" inputSchema contains $ref which is not supported by ` +
        `Anthropic / OpenAI / Codex / Copilot adapters. Resolve $ref before ` +
        `passing the tool to the serializer (or inline the $defs).`,
    );
  }
}

// ── Serializers ─────────────────────────────────────────────

/**
 * Convert WOTANN tool specs to the Anthropic Messages API envelope.
 *
 * Pattern: rename `inputSchema` → `input_schema`. The schema itself is
 * passed through verbatim — nested objects, arrays-of-objects,
 * `additionalProperties`, `required: []`, and enums survive unchanged.
 *
 * Throws if any tool schema contains `$ref` (see `assertNoRef`).
 */
export function toAnthropicTools(tools: readonly ToolSchema[]): readonly AnthropicToolParam[] {
  const out: AnthropicToolParam[] = [];
  for (const t of tools) {
    assertNoRef(t);
    out.push({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    });
  }
  return out;
}

/**
 * Convert WOTANN tool specs to the OpenAI Chat Completions envelope.
 *
 * Pattern: wrap as `{ type: "function", function: { name, description,
 * parameters: inputSchema } }`. Schema preserved verbatim.
 */
export function toOpenAITools(tools: readonly ToolSchema[]): readonly OpenAIToolParam[] {
  const out: OpenAIToolParam[] = [];
  for (const t of tools) {
    assertNoRef(t);
    out.push({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    });
  }
  return out;
}

/**
 * Convert WOTANN tool specs to the Codex Responses API envelope.
 *
 * Pattern: FLAT `{ type: "function", name, description, parameters }` —
 * Codex's Responses API does not nest under `function:` the way Chat
 * Completions does. Schema preserved verbatim.
 */
export function toCodexTools(tools: readonly ToolSchema[]): readonly CodexToolParam[] {
  const out: CodexToolParam[] = [];
  for (const t of tools) {
    assertNoRef(t);
    out.push({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    });
  }
  return out;
}

/**
 * Convert WOTANN tool specs to the Copilot envelope.
 *
 * Copilot proxies the OpenAI Chat Completions wire format, so this is
 * exactly `toOpenAITools`. Kept as a distinct export so future Copilot-
 * specific quirks (e.g. premium-tier-only schema features) have a
 * single place to land without touching OpenAI.
 */
export function toCopilotTools(tools: readonly ToolSchema[]): readonly CopilotToolParam[] {
  return toOpenAITools(tools);
}
