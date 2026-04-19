import { describe, it, expect } from "vitest";
import {
  makeStrict,
  validateToolArguments,
  enforceDeterministicSchema,
} from "../../src/intelligence/strict-schema.js";

describe("makeStrict", () => {
  it("adds additionalProperties: false to an object schema", () => {
    const input = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const out = makeStrict(input);
    expect(out["additionalProperties"]).toBe(false);
  });

  it("moves all properties into required and makes non-required ones nullable", () => {
    const input = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    };
    const out = makeStrict(input);
    expect(out["required"]).toEqual(["name", "age"]);
    const props = out["properties"] as Record<string, Record<string, unknown>>;
    // age was optional → now nullable via type union
    expect(Array.isArray(props["age"]?.type)).toBe(true);
    expect((props["age"]?.type as string[]).includes("null")).toBe(true);
    // name was required → NOT nullable
    expect(props["name"]?.type).toBe("string");
  });

  it("recurses into nested objects", () => {
    const input = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      required: ["user"],
    };
    const out = makeStrict(input);
    const user = (out["properties"] as Record<string, Record<string, unknown>>)["user"];
    expect(user).toBeDefined();
    expect(user?.["additionalProperties"]).toBe(false);
  });

  it("recurses into array items", () => {
    const input = {
      type: "array",
      items: {
        type: "object",
        properties: { x: { type: "number" } },
      },
    };
    const out = makeStrict(input);
    const items = out["items"] as Record<string, unknown>;
    expect(items["additionalProperties"]).toBe(false);
  });

  it("does not mutate the input", () => {
    const input = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    };
    const _out = makeStrict(input);
    expect(input).not.toHaveProperty("additionalProperties");
  });

  it("preserves anyOf branches", () => {
    const input = {
      anyOf: [
        { type: "string" },
        { type: "object", properties: { x: { type: "number" } } },
      ],
    };
    const out = makeStrict(input);
    const branches = out["anyOf"] as Record<string, unknown>[];
    expect(branches[1]?.["additionalProperties"]).toBe(false);
  });

  it("handles schemas without properties (e.g. plain types)", () => {
    const out = makeStrict({ type: "string" });
    expect(out).toEqual({ type: "string" });
  });

  it("handles schemas without required field (treats all as optional)", () => {
    const input = {
      type: "object",
      properties: { x: { type: "string" }, y: { type: "number" } },
    };
    const out = makeStrict(input);
    expect((out["required"] as string[]).sort()).toEqual(["x", "y"]);
    // Both were optional → both become nullable
    const props = out["properties"] as Record<string, Record<string, unknown>>;
    expect(Array.isArray(props["x"]?.type)).toBe(true);
    expect(Array.isArray(props["y"]?.type)).toBe(true);
  });
});

describe("validateToolArguments", () => {
  it("passes on valid args", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    };
    const result = validateToolArguments({ name: "foo" }, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("flags missing required fields", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    };
    const result = validateToolArguments({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.kind).toBe("missing-required");
    expect(result.errors[0]?.path).toBe("name");
  });

  it("flags additional properties under strict mode", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    };
    const result = validateToolArguments({ name: "foo", extra: "bar" }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.kind === "additional-property")).toBe(true);
  });

  it("flags type mismatches", () => {
    const schema = {
      type: "object",
      properties: { age: { type: "number" } },
      required: ["age"],
      additionalProperties: false,
    };
    const result = validateToolArguments({ age: "not a number" }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.kind).toBe("type-mismatch");
  });

  it("flags invalid enum values", () => {
    const schema = {
      type: "object",
      properties: { mode: { type: "string", enum: ["a", "b"] } },
      required: ["mode"],
    };
    const result = validateToolArguments({ mode: "c" }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.kind).toBe("invalid-enum");
  });

  it("recurses into arrays", () => {
    const schema = {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["ids"],
    };
    const result = validateToolArguments({ ids: ["a", 5, "c"] }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe("ids[1]");
  });

  it("recurses into nested objects", () => {
    const schema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
      },
      required: ["user"],
    };
    const result = validateToolArguments({ user: {} }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe("user.id");
  });

  it("auto-corrects by dropping additional properties", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    };
    const result = validateToolArguments({ name: "foo", extra: "bar" }, schema);
    expect(result.corrected).toEqual({ name: "foo" });
  });

  it("auto-fills missing required fields when nullable", () => {
    const schema = {
      type: "object",
      properties: { x: { type: ["string", "null"] } },
      required: ["x"],
    };
    const result = validateToolArguments({}, schema);
    expect(result.corrected).toEqual({ x: null });
  });

  it("does not fabricate data for non-nullable missing fields", () => {
    const schema = {
      type: "object",
      properties: { x: { type: "string" } },
      required: ["x"],
    };
    const result = validateToolArguments({}, schema);
    expect(result.corrected).toBeUndefined();
  });

  it("accepts anyOf variants", () => {
    const schema = {
      anyOf: [{ type: "string" }, { type: "number" }],
    };
    expect(validateToolArguments("hello", schema).valid).toBe(true);
    expect(validateToolArguments(42, schema).valid).toBe(true);
    expect(validateToolArguments(true, schema).valid).toBe(false);
  });
});

describe("enforceDeterministicSchema", () => {
  it("returns finalArgs equal to input when valid under strict", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const result = enforceDeterministicSchema({ name: "foo" }, schema);
    expect(result.validation.valid).toBe(true);
    expect(result.finalArgs).toEqual({ name: "foo" });
  });

  it("returns corrected finalArgs when correction succeeds", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const result = enforceDeterministicSchema({ name: "foo", junk: "x" }, schema);
    // makeStrict added additionalProperties:false → junk violates, gets dropped
    expect(result.finalArgs).toEqual({ name: "foo" });
  });

  it("returns null finalArgs when correction would fabricate data", () => {
    const schema = {
      type: "object",
      properties: { required_non_null: { type: "string" } },
      required: ["required_non_null"],
    };
    const result = enforceDeterministicSchema({}, schema);
    expect(result.finalArgs).toBeNull();
  });
});
