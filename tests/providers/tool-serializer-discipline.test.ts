/**
 * Schema discipline tests — ForgeCode P1-B11 port.
 *
 * Per MASTER_PLAN_V8 §5 P1-B11 + RESEARCH_TERMINALBENCH_HARNESSES_DEEP §2.1:
 * ForgeCode's empirical TB2 win includes schema discipline at the serializer
 * boundary:
 *
 *   1. `required` array BEFORE `properties` in JSON key order — some models
 *      anchor on the first key they see, and listing required fields first
 *      nudges them to emit those first in their tool call.
 *   2. `additionalProperties: false` explicitly set on every object schema —
 *      prevents models from inventing optional keys that the provider will
 *      then reject with a 400 for unknown properties.
 *   3. Truncation reminders in the description for tools that return large
 *      output (read, list, grep) — so the model knows to anticipate `[...]`
 *      trails and not treat truncated output as the complete file.
 *
 * These tests lock the serializer's output SHAPE without changing what keys
 * are present (vs. `tool-serializer.test.ts` which locks fidelity). The
 * discipline transform is recursive — it applies to nested object schemas,
 * arrays-of-objects, and oneOf/anyOf branches uniformly.
 *
 * The transform is a PURE serializer-side concern — it never mutates the
 * caller's `ToolSchema.inputSchema`. This keeps authored tool schemas
 * readable (humans can write `required` wherever they want) while the wire
 * format is consistent.
 */

import { describe, it, expect } from "vitest";
import {
  toAnthropicTools,
  toOpenAITools,
  toCodexTools,
  toCopilotTools,
  toBedrockTools,
  toGeminiFunctionDeclarations,
  toOllamaTools,
  applySchemaDiscipline,
} from "../../src/providers/tool-serializer.js";
import type { ToolSchema } from "../../src/providers/types.js";

// ── Fixtures ────────────────────────────────────────────────

/**
 * An authored-by-human schema with `properties` listed before `required`
 * (the common JS-object-literal order). The discipline transform should
 * emit it with `required` first.
 */
const PROPS_BEFORE_REQUIRED: ToolSchema = {
  name: "create_user",
  description: "Create a new user",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
    },
    required: ["name"],
  },
};

/**
 * Nested object schema where the inner object also has the "properties
 * before required" ordering. Discipline must recurse.
 */
const NESTED_PROPS_BEFORE_REQUIRED: ToolSchema = {
  name: "register",
  description: "Register a user with nested profile",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string" },
      profile: {
        type: "object",
        properties: {
          handle: { type: "string" },
          bio: { type: "string" },
        },
        required: ["handle"],
      },
    },
    required: ["email", "profile"],
  },
};

/**
 * An object schema missing `additionalProperties` entirely — discipline
 * should add `additionalProperties: false`. Also nested — inner object
 * gets the same treatment.
 */
const MISSING_ADDITIONAL_PROPS: ToolSchema = {
  name: "search",
  description: "Search for items",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      filter: {
        type: "object",
        properties: { tag: { type: "string" } },
      },
    },
    required: ["query"],
  },
};

/**
 * Array-of-objects — discipline must recurse into `items` and apply the
 * same reordering + additionalProperties normalization.
 */
const ARRAY_OF_OBJECTS: ToolSchema = {
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
            role: { type: "string" },
          },
          required: ["email"],
        },
      },
    },
    required: ["invites"],
  },
};

/**
 * Schema already has `additionalProperties: false` and `required` before
 * `properties` — discipline must NOT double-wrap or duplicate.
 */
const ALREADY_DISCIPLINED: ToolSchema = {
  name: "noop",
  description: "Already disciplined",
  inputSchema: {
    type: "object",
    required: ["x"],
    properties: { x: { type: "string" } },
    additionalProperties: false,
  },
};

// Helper: get the key order of the emitted object schema as an array.
function keyOrder(obj: Record<string, unknown>): string[] {
  return Object.keys(obj);
}

// ── applySchemaDiscipline — standalone transform ────────────

describe("applySchemaDiscipline — standalone", () => {
  it("reorders top-level object so required appears before properties", () => {
    const disciplined = applySchemaDiscipline(PROPS_BEFORE_REQUIRED.inputSchema);
    const order = keyOrder(disciplined as Record<string, unknown>);
    const reqIdx = order.indexOf("required");
    const propIdx = order.indexOf("properties");
    expect(reqIdx).toBeGreaterThanOrEqual(0);
    expect(propIdx).toBeGreaterThanOrEqual(0);
    expect(reqIdx).toBeLessThan(propIdx);
  });

  it("recurses — nested object schemas also get required before properties", () => {
    const disciplined = applySchemaDiscipline(
      NESTED_PROPS_BEFORE_REQUIRED.inputSchema,
    ) as Record<string, unknown>;
    const profile = (disciplined["properties"] as Record<string, unknown>)[
      "profile"
    ] as Record<string, unknown>;
    const order = keyOrder(profile);
    expect(order.indexOf("required")).toBeLessThan(order.indexOf("properties"));
  });

  it("adds additionalProperties: false when missing on object schemas", () => {
    const disciplined = applySchemaDiscipline(
      MISSING_ADDITIONAL_PROPS.inputSchema,
    ) as Record<string, unknown>;
    expect(disciplined["additionalProperties"]).toBe(false);
    // Nested inner object also gets it
    const filter = (disciplined["properties"] as Record<string, unknown>)[
      "filter"
    ] as Record<string, unknown>;
    expect(filter["additionalProperties"]).toBe(false);
  });

  it("preserves additionalProperties when already set (does not overwrite)", () => {
    const schema: Record<string, unknown> = {
      type: "object",
      properties: { x: { type: "string" } },
      required: ["x"],
      additionalProperties: true, // deliberately permissive
    };
    const disciplined = applySchemaDiscipline(schema);
    expect((disciplined as Record<string, unknown>)["additionalProperties"]).toBe(
      true,
    );
  });

  it("recurses into array items", () => {
    const disciplined = applySchemaDiscipline(
      ARRAY_OF_OBJECTS.inputSchema,
    ) as Record<string, unknown>;
    const invites = (disciplined["properties"] as Record<string, unknown>)[
      "invites"
    ] as Record<string, unknown>;
    const items = invites["items"] as Record<string, unknown>;
    // items has required before properties
    expect(keyOrder(items).indexOf("required")).toBeLessThan(
      keyOrder(items).indexOf("properties"),
    );
    // items got additionalProperties: false
    expect(items["additionalProperties"]).toBe(false);
  });

  it("is idempotent — already-disciplined schema passes through unchanged", () => {
    const before = JSON.stringify(ALREADY_DISCIPLINED.inputSchema);
    const once = applySchemaDiscipline(ALREADY_DISCIPLINED.inputSchema);
    const twice = applySchemaDiscipline(once);
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
    // caller's schema not mutated
    expect(JSON.stringify(ALREADY_DISCIPLINED.inputSchema)).toBe(before);
  });

  it("does not mutate caller's schema (pure transform)", () => {
    const original = JSON.parse(
      JSON.stringify(MISSING_ADDITIONAL_PROPS.inputSchema),
    );
    const before = JSON.stringify(original);
    applySchemaDiscipline(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("handles non-object / null / primitives gracefully (returns as-is)", () => {
    expect(applySchemaDiscipline(null as unknown as Record<string, unknown>)).toBe(
      null,
    );
    expect(
      applySchemaDiscipline("string" as unknown as Record<string, unknown>),
    ).toBe("string");
  });

  it("preserves required: [] (empty array — distinct from missing)", () => {
    const schema = {
      type: "object",
      properties: { x: { type: "string" } },
      required: [],
    };
    const disciplined = applySchemaDiscipline(schema) as Record<string, unknown>;
    expect(disciplined["required"]).toEqual([]);
    // Empty required still comes before properties
    expect(keyOrder(disciplined).indexOf("required")).toBeLessThan(
      keyOrder(disciplined).indexOf("properties"),
    );
  });

  it("recurses into oneOf / anyOf branches", () => {
    const schema = {
      type: "object",
      properties: {
        payload: {
          oneOf: [
            {
              type: "object",
              properties: { kind: { type: "string" } },
              required: ["kind"],
            },
            {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          ],
        },
      },
      required: ["payload"],
    };
    const disciplined = applySchemaDiscipline(schema) as Record<string, unknown>;
    const branches = (
      (disciplined["properties"] as Record<string, unknown>)["payload"] as {
        oneOf: Record<string, unknown>[];
      }
    ).oneOf;
    for (const branch of branches) {
      expect(keyOrder(branch).indexOf("required")).toBeLessThan(
        keyOrder(branch).indexOf("properties"),
      );
      expect(branch["additionalProperties"]).toBe(false);
    }
  });
});

// ── Serialized wire-shape tests ─────────────────────────────

describe("toAnthropicTools — applies schema discipline", () => {
  it("emits `required` before `properties` in JSON output", () => {
    const out = toAnthropicTools([PROPS_BEFORE_REQUIRED]);
    const serialized = JSON.stringify(out[0]!.input_schema);
    const reqPos = serialized.indexOf('"required"');
    const propPos = serialized.indexOf('"properties"');
    expect(reqPos).toBeGreaterThanOrEqual(0);
    expect(propPos).toBeGreaterThanOrEqual(0);
    expect(reqPos).toBeLessThan(propPos);
  });

  it("normalizes additionalProperties: false on nested object schemas", () => {
    const out = toAnthropicTools([MISSING_ADDITIONAL_PROPS]);
    const json = JSON.stringify(out[0]!.input_schema);
    // Top-level gets it
    expect(out[0]!.input_schema["additionalProperties"]).toBe(false);
    // Every "type":"object" block in the serialized form carries it
    const objectTypes = json.match(/"type":"object"/g) ?? [];
    const addlProps = json.match(/"additionalProperties":/g) ?? [];
    expect(addlProps.length).toBe(objectTypes.length);
  });

  it("does not mutate caller's inputSchema", () => {
    const tool: ToolSchema = JSON.parse(
      JSON.stringify(PROPS_BEFORE_REQUIRED),
    ) as ToolSchema;
    const before = JSON.stringify(tool.inputSchema);
    toAnthropicTools([tool]);
    expect(JSON.stringify(tool.inputSchema)).toBe(before);
  });

  it("preserves all original properties + values (no data loss)", () => {
    const out = toAnthropicTools([NESTED_PROPS_BEFORE_REQUIRED]);
    const schema = out[0]!.input_schema as {
      properties: {
        email: { type: string };
        profile: { properties: { handle: unknown; bio: unknown } };
      };
    };
    expect(schema.properties.email.type).toBe("string");
    expect(schema.properties.profile.properties.handle).toEqual({
      type: "string",
    });
    expect(schema.properties.profile.properties.bio).toEqual({ type: "string" });
  });
});

describe("toOpenAITools — applies schema discipline", () => {
  it("emits `required` before `properties` in function.parameters", () => {
    const out = toOpenAITools([PROPS_BEFORE_REQUIRED]);
    const serialized = JSON.stringify(out[0]!.function.parameters);
    expect(serialized.indexOf('"required"')).toBeLessThan(
      serialized.indexOf('"properties"'),
    );
  });

  it("normalizes additionalProperties: false", () => {
    const out = toOpenAITools([MISSING_ADDITIONAL_PROPS]);
    expect(
      (out[0]!.function.parameters as { additionalProperties: unknown })[
        "additionalProperties"
      ],
    ).toBe(false);
  });
});

describe("toCodexTools — applies schema discipline", () => {
  it("emits `required` before `properties` in flat parameters", () => {
    const out = toCodexTools([PROPS_BEFORE_REQUIRED]);
    const serialized = JSON.stringify(out[0]!.parameters);
    expect(serialized.indexOf('"required"')).toBeLessThan(
      serialized.indexOf('"properties"'),
    );
  });
});

describe("toCopilotTools — applies schema discipline", () => {
  it("emits `required` before `properties`", () => {
    const out = toCopilotTools([PROPS_BEFORE_REQUIRED]);
    const serialized = JSON.stringify(out[0]!.function.parameters);
    expect(serialized.indexOf('"required"')).toBeLessThan(
      serialized.indexOf('"properties"'),
    );
  });
});

describe("toBedrockTools — applies schema discipline", () => {
  it("emits `required` before `properties` in inputSchema.json", () => {
    const out = toBedrockTools([PROPS_BEFORE_REQUIRED]);
    const serialized = JSON.stringify(out[0]!.toolSpec.inputSchema.json);
    expect(serialized.indexOf('"required"')).toBeLessThan(
      serialized.indexOf('"properties"'),
    );
  });

  it("normalizes additionalProperties: false inside the Bedrock envelope", () => {
    const out = toBedrockTools([MISSING_ADDITIONAL_PROPS]);
    const inner = out[0]!.toolSpec.inputSchema.json as Record<string, unknown>;
    expect(inner["additionalProperties"]).toBe(false);
  });
});

describe("toGeminiFunctionDeclarations — applies schema discipline", () => {
  it("emits `required` before `properties`", () => {
    const out = toGeminiFunctionDeclarations([PROPS_BEFORE_REQUIRED]);
    const serialized = JSON.stringify(out[0]!.parameters);
    expect(serialized.indexOf('"required"')).toBeLessThan(
      serialized.indexOf('"properties"'),
    );
  });
});

describe("toOllamaTools — applies schema discipline", () => {
  it("emits `required` before `properties` (OpenAI-shaped)", () => {
    const out = toOllamaTools([PROPS_BEFORE_REQUIRED]);
    const serialized = JSON.stringify(out[0]!.function.parameters);
    expect(serialized.indexOf('"required"')).toBeLessThan(
      serialized.indexOf('"properties"'),
    );
  });
});
