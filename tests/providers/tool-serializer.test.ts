/**
 * Tool serializer fidelity tests.
 *
 * Per MASTER_PLAN_V8 P0-4 + RESEARCH_HERMES_AGENT_PORT (§4.1, §5):
 * Hermes's `convert_tools_to_anthropic` is a pass-through that copies the
 * caller's JSON schema verbatim into the provider envelope. The same
 * pattern fans out to OpenAI (`parameters`), Codex (flat `parameters`),
 * and Copilot (chat-completions `function.parameters`). The pass-through
 * preserves nested objects, arrays-of-objects, `additionalProperties`,
 * `required` arrays, and `enum` automatically.
 *
 * The historical risk in WOTANN was four bespoke serialization sites
 * drifting apart. These tests lock the contract so every adapter agrees
 * on:
 *
 *   - nested object schemas survive round-trip with depth + required
 *   - arrays-of-objects keep their `items` shape and inner required
 *   - `additionalProperties: false` is preserved (some bespoke serializers
 *     historically dropped it under "noise reduction")
 *   - `required: []` (empty array meaning all optional) is preserved
 *     verbatim — distinct from missing `required`
 *   - `enum` constraints preserved on string + number fields
 *   - `$ref` is rejected with a clean error rather than silently emitting
 *     a broken schema the provider rejects 400 with no useful message
 *   - input objects are not mutated (caller can reuse the same schema
 *     across providers)
 *
 * The serializer is provider-aware: each `to<Provider>Tools` returns the
 * exact wire shape that adapter would post.
 */

import { describe, it, expect } from "vitest";
import {
  toAnthropicTools,
  toOpenAITools,
  toCodexTools,
  toCopilotTools,
  containsRef,
} from "../../src/providers/tool-serializer.js";
import type { ToolSchema } from "../../src/providers/types.js";

// ── Fixtures ────────────────────────────────────────────────

const NESTED_OBJECT_TOOL: ToolSchema = {
  name: "create_user",
  description: "Create a new user with nested address",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Display name" },
      address: {
        type: "object",
        properties: {
          street: { type: "string" },
          city: { type: "string" },
          country: { type: "string", enum: ["US", "CA", "MX"] },
        },
        required: ["street", "city"],
        additionalProperties: false,
      },
    },
    required: ["name", "address"],
    additionalProperties: false,
  },
};

const ARRAY_OF_OBJECTS_TOOL: ToolSchema = {
  name: "bulk_invite",
  description: "Invite multiple users",
  inputSchema: {
    type: "object",
    properties: {
      invites: {
        type: "array",
        items: {
          type: "object",
          properties: {
            email: { type: "string" },
            role: { type: "string", enum: ["admin", "member", "guest"] },
          },
          required: ["email"],
        },
      },
    },
    required: ["invites"],
  },
};

const ALL_OPTIONAL_TOOL: ToolSchema = {
  name: "search",
  description: "Search with optional filters",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: [], // explicitly empty — all fields are optional
  },
};

const ENUM_TOOL: ToolSchema = {
  name: "set_priority",
  description: "Set priority level",
  inputSchema: {
    type: "object",
    properties: {
      level: { type: "string", enum: ["low", "medium", "high"] },
      score: { type: "number", enum: [1, 2, 3, 4, 5] },
    },
    required: ["level"],
  },
};

const REF_TOOL: ToolSchema = {
  name: "lookup",
  description: "Lookup with $ref",
  inputSchema: {
    type: "object",
    properties: {
      target: { $ref: "#/$defs/Target" },
    },
    $defs: {
      Target: { type: "string" },
    },
  },
};

// ── Anthropic ────────────────────────────────────────────────

describe("toAnthropicTools — fidelity", () => {
  it("nested object preserves depth + required + additionalProperties", () => {
    const out = toAnthropicTools([NESTED_OBJECT_TOOL]);
    expect(out).toHaveLength(1);
    const tool = out[0]!;
    expect(tool.name).toBe("create_user");
    expect(tool.description).toBe("Create a new user with nested address");
    expect(tool.input_schema).toEqual(NESTED_OBJECT_TOOL.inputSchema);
    // Defensive: spot-check that the deep fields survive
    const addr = (tool.input_schema as { properties: { address: { properties: unknown; required: string[]; additionalProperties: boolean } } }).properties
      .address;
    expect(addr.required).toEqual(["street", "city"]);
    expect(addr.additionalProperties).toBe(false);
  });

  it("array-of-objects preserves items.required + items.properties", () => {
    const out = toAnthropicTools([ARRAY_OF_OBJECTS_TOOL]);
    const items = (out[0]!.input_schema as {
      properties: { invites: { items: { required: string[]; properties: { email: unknown; role: { enum: string[] } } } } };
    }).properties.invites.items;
    expect(items.required).toEqual(["email"]);
    expect(items.properties.role.enum).toEqual(["admin", "member", "guest"]);
  });

  it("required: [] (empty array) is preserved verbatim — distinct from missing", () => {
    const out = toAnthropicTools([ALL_OPTIONAL_TOOL]);
    const schema = out[0]!.input_schema as { required?: unknown };
    expect(schema.required).toEqual([]);
  });

  it("enum on string + number fields preserved", () => {
    const out = toAnthropicTools([ENUM_TOOL]);
    const props = (out[0]!.input_schema as { properties: { level: { enum: string[] }; score: { enum: number[] } } }).properties;
    expect(props.level.enum).toEqual(["low", "medium", "high"]);
    expect(props.score.enum).toEqual([1, 2, 3, 4, 5]);
  });

  it("$ref in schema throws a clean Error rather than silently emitting", () => {
    // Error must name the offending tool and explicitly call out $ref so
    // a developer reading the stack trace can root-cause without needing
    // to read the serializer source.
    expect(() => toAnthropicTools([REF_TOOL])).toThrowError(/\$ref/);
    expect(() => toAnthropicTools([REF_TOOL])).toThrowError(/lookup/);
    expect(() => toAnthropicTools([REF_TOOL])).toThrowError(/not supported/i);
  });

  it("does not mutate the caller's input schema (idempotent across providers)", () => {
    const tool: ToolSchema = JSON.parse(JSON.stringify(NESTED_OBJECT_TOOL)) as ToolSchema;
    const before = JSON.stringify(tool.inputSchema);
    toAnthropicTools([tool]);
    toOpenAITools([tool]);
    toCodexTools([tool]);
    toCopilotTools([tool]);
    expect(JSON.stringify(tool.inputSchema)).toBe(before);
  });

  it("empty tools[] returns empty array", () => {
    expect(toAnthropicTools([])).toEqual([]);
  });
});

// ── OpenAI Chat Completions ─────────────────────────────────

describe("toOpenAITools — fidelity", () => {
  it("wraps as { type: 'function', function: { name, description, parameters } }", () => {
    const out = toOpenAITools([NESTED_OBJECT_TOOL]);
    expect(out).toHaveLength(1);
    const tool = out[0]!;
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("create_user");
    expect(tool.function.description).toBe("Create a new user with nested address");
    expect(tool.function.parameters).toEqual(NESTED_OBJECT_TOOL.inputSchema);
  });

  it("array-of-objects + additionalProperties survives", () => {
    const out = toOpenAITools([ARRAY_OF_OBJECTS_TOOL]);
    const params = out[0]!.function.parameters as {
      properties: { invites: { items: { required: string[] } } };
    };
    expect(params.properties.invites.items.required).toEqual(["email"]);
  });

  it("required: [] preserved", () => {
    const out = toOpenAITools([ALL_OPTIONAL_TOOL]);
    const params = out[0]!.function.parameters as { required?: unknown };
    expect(params.required).toEqual([]);
  });

  it("$ref rejected", () => {
    expect(() => toOpenAITools([REF_TOOL])).toThrowError(/\$ref/);
  });
});

// ── Codex Responses API ─────────────────────────────────────

describe("toCodexTools — fidelity", () => {
  it("flat shape: { type, name, description, parameters } — NOT nested under function", () => {
    const out = toCodexTools([NESTED_OBJECT_TOOL]);
    expect(out).toHaveLength(1);
    const tool = out[0]!;
    expect(tool.type).toBe("function");
    expect(tool.name).toBe("create_user");
    expect(tool.description).toBe("Create a new user with nested address");
    expect(tool.parameters).toEqual(NESTED_OBJECT_TOOL.inputSchema);
    // Codex Responses API is flat — there is NO `function:` wrapper.
    expect((tool as Record<string, unknown>)["function"]).toBeUndefined();
  });

  it("nested object + array-of-objects + required survive", () => {
    const out = toCodexTools([ARRAY_OF_OBJECTS_TOOL]);
    const params = out[0]!.parameters as {
      properties: { invites: { items: { required: string[]; properties: { role: { enum: string[] } } } } };
    };
    expect(params.properties.invites.items.required).toEqual(["email"]);
    expect(params.properties.invites.items.properties.role.enum).toEqual(["admin", "member", "guest"]);
  });

  it("$ref rejected", () => {
    expect(() => toCodexTools([REF_TOOL])).toThrowError(/\$ref/);
  });
});

// ── Copilot (OpenAI-shaped) ─────────────────────────────────

describe("toCopilotTools — fidelity", () => {
  it("matches OpenAI shape exactly (Copilot is an OpenAI-compat proxy)", () => {
    const openai = toOpenAITools([NESTED_OBJECT_TOOL]);
    const copilot = toCopilotTools([NESTED_OBJECT_TOOL]);
    expect(copilot).toEqual(openai);
  });

  it("nested + arrays + enums preserved end-to-end", () => {
    // Note: schema discipline (P1-B11) normalises `additionalProperties: false`
    // onto every object schema that omitted it, so deep-equal against the
    // bare caller schema is no longer the right invariant. Instead verify
    // the data content (properties, required, enums) survived.
    const out = toCopilotTools([NESTED_OBJECT_TOOL, ARRAY_OF_OBJECTS_TOOL, ENUM_TOOL]);
    expect(out).toHaveLength(3);

    // NESTED_OBJECT_TOOL already has additionalProperties set — discipline
    // is a no-op so deep equality still holds.
    expect(out[0]!.function.parameters).toEqual(NESTED_OBJECT_TOOL.inputSchema);

    // ARRAY_OF_OBJECTS_TOOL was authored without additionalProperties — spot
    // check that the original content survives and the normalisation ran.
    const aoo = out[1]!.function.parameters as {
      type: string;
      required: string[];
      properties: {
        invites: {
          type: string;
          items: {
            type: string;
            required: string[];
            properties: { email: unknown; role: { enum: string[] } };
            additionalProperties: boolean;
          };
        };
      };
      additionalProperties: boolean;
    };
    expect(aoo.type).toBe("object");
    expect(aoo.required).toEqual(["invites"]);
    expect(aoo.additionalProperties).toBe(false);
    expect(aoo.properties.invites.items.required).toEqual(["email"]);
    expect(aoo.properties.invites.items.properties.role.enum).toEqual([
      "admin",
      "member",
      "guest",
    ]);
    expect(aoo.properties.invites.items.additionalProperties).toBe(false);

    // ENUM_TOOL: enum values survive verbatim, discipline adds additionalProperties.
    const enumSchema = out[2]!.function.parameters as {
      properties: { level: { enum: string[] }; score: { enum: number[] } };
      required: string[];
      additionalProperties: boolean;
    };
    expect(enumSchema.properties.level.enum).toEqual(["low", "medium", "high"]);
    expect(enumSchema.properties.score.enum).toEqual([1, 2, 3, 4, 5]);
    expect(enumSchema.required).toEqual(["level"]);
    expect(enumSchema.additionalProperties).toBe(false);
  });

  it("$ref rejected", () => {
    expect(() => toCopilotTools([REF_TOOL])).toThrowError(/\$ref/);
  });
});

// ── containsRef helper ──────────────────────────────────────

describe("containsRef — schema $ref detection", () => {
  it("detects $ref at top level", () => {
    expect(containsRef({ $ref: "#/foo" })).toBe(true);
  });

  it("detects $ref nested in properties", () => {
    expect(
      containsRef({
        type: "object",
        properties: { x: { $ref: "#/$defs/X" } },
      }),
    ).toBe(true);
  });

  it("detects $ref inside array items", () => {
    expect(
      containsRef({
        type: "array",
        items: { $ref: "#/$defs/X" },
      }),
    ).toBe(true);
  });

  it("detects $ref deep inside arrays of objects", () => {
    expect(
      containsRef({
        type: "object",
        properties: {
          list: {
            type: "array",
            items: {
              type: "object",
              properties: { ptr: { $ref: "#/$defs/Y" } },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("returns false for ref-free schemas", () => {
    expect(containsRef(NESTED_OBJECT_TOOL.inputSchema)).toBe(false);
    expect(containsRef(ARRAY_OF_OBJECTS_TOOL.inputSchema)).toBe(false);
    expect(containsRef(ENUM_TOOL.inputSchema)).toBe(false);
  });

  it("returns false for null/undefined/primitives", () => {
    expect(containsRef(null)).toBe(false);
    expect(containsRef(undefined)).toBe(false);
    expect(containsRef("string")).toBe(false);
    expect(containsRef(42)).toBe(false);
  });
});
