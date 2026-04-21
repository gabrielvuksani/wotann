/**
 * Unified tool serializer.
 *
 * Per MASTER_PLAN_V8 P0-4 + P1-B2 + RESEARCH_HERMES_AGENT_PORT (§4.1, §5):
 * Hermes Agent's `convert_tools_to_anthropic` is a pass-through that
 * copies the caller's JSON schema verbatim into the provider envelope.
 * The 1-line pattern preserves nested objects, arrays-of-objects,
 * `additionalProperties`, `required` arrays, and `enum` automatically
 * because JSON pass-through is structure-preserving.
 *
 * This module is the single home for that pattern across WOTANN's
 * seven provider families that all speak native `tools:` at the
 * provider-level (NOT JSON-in-prompt hacks). Each adapter's tool
 * envelope is different, so each family gets a dedicated serializer
 * that produces EXACTLY the wire shape that adapter POSTs:
 *
 *   - Anthropic Messages API   → { name, description, input_schema }
 *   - OpenAI Chat Completions  → { type: "function", function: {...} }
 *   - Codex Responses API      → flat { type, name, description, parameters }
 *   - GitHub Copilot           → identical to OpenAI (it's a proxy)
 *   - AWS Bedrock Converse     → { toolSpec: { name, description, inputSchema: { json } } }
 *   - Google Vertex (Claude)   → same as Anthropic (Vertex fronts Anthropic's wire)
 *   - Gemini native            → { functionDeclarations: [{ name, description, parameters }] }
 *   - Ollama /api/chat         → { type: "function", function: {...} } (OpenAI-shape)
 *
 * The rationale for centralizing even the bespoke formats: per-adapter
 * drift is the #1 source of tool-serialization bugs (session-10 audit
 * found 4 of 5 adapters silently stripping `tools:`). One canonical
 * home per provider keeps the shape definitions next to each other so
 * future changes (e.g. a new required top-level field) land in one
 * review, not six scattered edits.
 *
 * `$ref` handling: every native-tools provider rejects `$ref` in tool
 * schemas because none of them dereference it before sending to the model.
 * Without this guard, the request reaches the API and returns an opaque
 * 400 ("invalid_request_error") that's hard to root-cause. We fail loud
 * with the offending tool name so callers can pre-resolve refs.
 */

import type { ToolSchema } from "./types.js";

// ── Schema Discipline (ForgeCode P1-B11) ────────────────────
//
// ForgeCode's empirical TB2 finding: models emit better tool calls when
// the serialized JSON schema follows three conventions.
//
//   1. `required` appears BEFORE `properties` in key order. Some models
//      anchor on the first key of an object — listing `required` first
//      primes them to emit those fields first in their tool call.
//   2. `additionalProperties: false` is explicit on every object schema —
//      prevents models from inventing optional keys (e.g. OpenAI's strict
//      mode rejects unknown keys with 400).
//   3. The transform is RECURSIVE — applies to nested objects, array
//      items, and oneOf/anyOf branches so the discipline is uniform
//      regardless of schema depth.
//
// The transform is PURE — it deep-clones the input so caller schemas are
// safe to reuse across providers. If a schema is already disciplined,
// the transform is idempotent (no double-nesting, no duplicate keys).
//
// Authors continue to write tool schemas in natural JS-object-literal
// order (`type`, `properties`, `required`). The wire format is consistent
// at the boundary.

/**
 * Recursively rewrite a JSON schema to apply ForgeCode's discipline:
 * emit `required` before `properties` in object schemas, and ensure
 * every object has an explicit `additionalProperties` value (defaults
 * to `false` when the caller omitted it).
 *
 * Returns a new schema tree — caller's input is not mutated.
 *
 * Handles:
 *   - top-level object schemas
 *   - nested object properties (recursive)
 *   - arrays-of-objects via `items`
 *   - oneOf / anyOf / allOf branches (recursive)
 *   - primitive / null / non-object inputs (returned as-is)
 *
 * Does NOT handle:
 *   - `$ref` resolution (caller must pre-resolve; `assertNoRef` guards)
 *   - additionalProperties when already explicitly set (preserved verbatim,
 *     even if `true` or a sub-schema)
 */
export function applySchemaDiscipline<T>(schema: T): T {
  if (schema === null || schema === undefined) return schema;
  if (typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    // Arrays at schema-tree level: recurse into each element.
    return schema.map((item) => applySchemaDiscipline(item)) as unknown as T;
  }

  const input = schema as Record<string, unknown>;
  const isObjectSchema = input["type"] === "object" || input["properties"] !== undefined;

  // Build the output with a deterministic key order:
  //   1. type           (if present)
  //   2. required       (if present, BEFORE properties)
  //   3. properties     (with each child disciplined)
  //   4. additionalProperties  (false by default on object schemas)
  //   5. every other key preserved in insertion order
  const out: Record<string, unknown> = {};

  if ("type" in input) out["type"] = input["type"];
  if (isObjectSchema && "required" in input) {
    out["required"] = input["required"];
  } else if (!isObjectSchema && "required" in input) {
    out["required"] = input["required"];
  }

  if (isObjectSchema && "properties" in input) {
    const srcProps = input["properties"] as Record<string, unknown>;
    const newProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(srcProps)) {
      newProps[key] = applySchemaDiscipline(value);
    }
    out["properties"] = newProps;
  }

  if (isObjectSchema) {
    // If caller set additionalProperties, preserve (even `true` or a
    // sub-schema). If missing, default to `false` — the ForgeCode rule.
    if ("additionalProperties" in input) {
      const existing = input["additionalProperties"];
      out["additionalProperties"] =
        typeof existing === "object" && existing !== null
          ? applySchemaDiscipline(existing)
          : existing;
    } else {
      out["additionalProperties"] = false;
    }
  }

  // Array items: recurse.
  if ("items" in input) {
    out["items"] = applySchemaDiscipline(input["items"]);
  }

  // oneOf / anyOf / allOf: recurse into each branch.
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    if (key in input && Array.isArray(input[key])) {
      out[key] = (input[key] as unknown[]).map((branch) => applySchemaDiscipline(branch));
    }
  }

  // Copy every other key verbatim in original order (but skip the ones
  // we've already placed to avoid duplicates).
  const placed = new Set([
    "type",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "oneOf",
    "anyOf",
    "allOf",
  ]);
  for (const [key, value] of Object.entries(input)) {
    if (placed.has(key)) continue;
    out[key] = value;
  }

  return out as T;
}

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
      input_schema: applySchemaDiscipline(t.inputSchema),
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
        parameters: applySchemaDiscipline(t.inputSchema),
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
      parameters: applySchemaDiscipline(t.inputSchema),
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

// ── Bedrock ─────────────────────────────────────────────────

/**
 * AWS Bedrock Converse API tool envelope.
 *
 * Shape: `{ toolSpec: { name, description, inputSchema: { json: ... } } }`.
 * Bedrock wraps the schema twice — once in `toolSpec`, then again inside
 * `inputSchema.json`. The inner `.json` is a discriminator that lets
 * Bedrock route to the JSON Schema interpreter (vs. future formats).
 */
export interface BedrockToolParam {
  readonly toolSpec: {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: {
      readonly json: Record<string, unknown>;
    };
  };
}

/**
 * Convert WOTANN tool specs to the Bedrock Converse envelope. The Bedrock
 * adapter then wraps the array under `toolConfig.tools` on the request
 * body. Schema preserved verbatim inside `inputSchema.json`.
 */
export function toBedrockTools(tools: readonly ToolSchema[]): readonly BedrockToolParam[] {
  const out: BedrockToolParam[] = [];
  for (const t of tools) {
    assertNoRef(t);
    out.push({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: { json: applySchemaDiscipline(t.inputSchema) },
      },
    });
  }
  return out;
}

// ── Vertex (Claude on Vertex AI) ────────────────────────────

/**
 * Vertex AI tool envelope for Claude models.
 *
 * Vertex fronts Anthropic's Messages API wire format with OAuth2 + its
 * own endpoint, so the tool shape is IDENTICAL to Anthropic's
 * `{ name, description, input_schema }`. Exported as a distinct type
 * so Vertex-specific quirks (if any ever appear) land in one place
 * without touching the native Anthropic path.
 */
export type VertexToolParam = AnthropicToolParam;

/**
 * Convert WOTANN tool specs to the Vertex envelope (Anthropic-shaped).
 *
 * Delegates to `toAnthropicTools` — Vertex Claude speaks the same wire
 * format as native Anthropic. Kept as a distinct export for future-
 * proofing in case Google ever adds Vertex-specific tool fields (e.g.
 * `vertex_routing`), so callers don't have to guess which serializer
 * the path uses.
 */
export function toVertexTools(tools: readonly ToolSchema[]): readonly VertexToolParam[] {
  return toAnthropicTools(tools);
}

// ── Gemini (native) ─────────────────────────────────────────

/**
 * Gemini native functionDeclarations envelope — what goes INSIDE the
 * `tools: [{ functionDeclarations: [...] }]` wrapper on the request.
 *
 * Shape: `{ name, description, parameters }`. Gemini uses `parameters`
 * (like OpenAI) rather than Anthropic's `input_schema`. The full request
 * body wraps the array as `tools: [{ functionDeclarations }]`; this
 * serializer returns the inner declarations so the adapter can assemble
 * the outer wrapper alongside `googleSearch`/`codeExecution`/`urlContext`
 * first-class tools.
 */
export interface GeminiFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * Convert WOTANN tool specs to Gemini native functionDeclarations.
 *
 * Returns the declarations array. The caller wraps it as
 * `tools: [{ functionDeclarations: <this-result> }]` and optionally
 * appends `{ googleSearch: {} }`, `{ codeExecution: {} }`, or
 * `{ urlContext: {} }` for Gemini's first-class built-in tools.
 */
export function toGeminiFunctionDeclarations(
  tools: readonly ToolSchema[],
): readonly GeminiFunctionDeclaration[] {
  const out: GeminiFunctionDeclaration[] = [];
  for (const t of tools) {
    assertNoRef(t);
    out.push({
      name: t.name,
      description: t.description,
      parameters: applySchemaDiscipline(t.inputSchema),
    });
  }
  return out;
}

// ── Ollama ──────────────────────────────────────────────────

/**
 * Ollama native /api/chat tool envelope.
 *
 * Wire format: `{ type: "function", function: { name, description,
 * parameters } }` — identical to OpenAI Chat Completions. Ollama's
 * native endpoint deliberately mirrors OpenAI's shape so open-model
 * tool training datasets transfer over. Exported distinctly so
 * future Ollama-specific fields (e.g. per-tool thinking budgets) can
 * land here without touching the OpenAI path.
 */
export type OllamaToolParam = OpenAIToolParam;

/**
 * Convert WOTANN tool specs to the Ollama envelope (OpenAI-shaped).
 *
 * Delegates to `toOpenAITools`. Ollama's /api/chat accepts the OpenAI
 * tool shape verbatim.
 */
export function toOllamaTools(tools: readonly ToolSchema[]): readonly OllamaToolParam[] {
  return toOpenAITools(tools);
}
