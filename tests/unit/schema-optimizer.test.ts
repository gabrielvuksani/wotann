import { describe, it, expect } from "vitest";
import {
  flattenSchema,
  rebuildSchema,
  optimizeToolSchema,
  addMissingDescriptions,
  validateAndCoerce,
} from "../../src/intelligence/schema-optimizer.js";

describe("Schema Optimizer (TerminalBench)", () => {
  describe("flattenSchema", () => {
    it("flattens nested objects to dot-notation fields", () => {
      const schema = {
        type: "object",
        required: ["file_path"],
        properties: {
          file_path: { type: "string", description: "Path to file" },
          options: {
            type: "object",
            properties: {
              encoding: { type: "string" },
              limit: { type: "number" },
            },
          },
        },
      };

      const fields = flattenSchema(schema);
      expect(fields.find((f) => f.name === "file_path")).toBeDefined();
      expect(fields.find((f) => f.name === "options_encoding")).toBeDefined();
      expect(fields.find((f) => f.name === "options_limit")).toBeDefined();
      // No nested "options" object field
      expect(fields.find((f) => f.name === "options")).toBeUndefined();
    });

    it("preserves required flag from parent schema", () => {
      const schema = {
        required: ["name"],
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      };

      const fields = flattenSchema(schema);
      const name = fields.find((f) => f.name === "name");
      const age = fields.find((f) => f.name === "age");
      expect(name?.required).toBe(true);
      expect(age?.required).toBe(false);
    });
  });

  describe("rebuildSchema", () => {
    it("puts required fields first in properties", () => {
      const fields = [
        { name: "optional_b", type: "string", description: "", required: false },
        { name: "required_a", type: "string", description: "", required: true },
      ];

      const schema = rebuildSchema(fields);
      const propKeys = Object.keys(schema["properties"] as Record<string, unknown>);
      expect(propKeys[0]).toBe("required_a");
    });

    it("includes required array at top level", () => {
      const fields = [
        { name: "file_path", type: "string", description: "Path", required: true },
        { name: "content", type: "string", description: "Content", required: true },
        { name: "encoding", type: "string", description: "", required: false },
      ];

      const schema = rebuildSchema(fields);
      expect(schema["required"]).toEqual(["content", "file_path"]);
    });
  });

  describe("optimizeToolSchema", () => {
    it("full pipeline: flatten + sort + rebuild", () => {
      const original = {
        type: "object",
        properties: {
          options: {
            type: "object",
            properties: {
              verbose: { type: "boolean" },
            },
          },
          path: { type: "string" },
        },
        required: ["path"],
      };

      const optimized = optimizeToolSchema(original);
      const props = optimized["properties"] as Record<string, unknown>;

      // Path should be first (required)
      const keys = Object.keys(props);
      expect(keys[0]).toBe("path");
      // Nested options should be flattened
      expect(props["options_verbose"]).toBeDefined();
      expect(props["options"]).toBeUndefined();
    });
  });

  describe("addMissingDescriptions", () => {
    it("infers description from field name", () => {
      const schema = {
        properties: {
          file_path: { type: "string" },
          command: { type: "string", description: "Existing description" },
        },
      };

      const enhanced = addMissingDescriptions(schema);
      const props = enhanced["properties"] as Record<string, Record<string, unknown>>;
      expect(props["file_path"]?.["description"]).toContain("path");
      expect(props["command"]?.["description"]).toBe("Existing description");
    });
  });

  describe("validateAndCoerce", () => {
    it("detects missing required fields", () => {
      const { valid, errors } = validateAndCoerce(
        { optional: "value" },
        { required: ["file_path"], properties: { file_path: { type: "string" } } },
      );
      expect(valid).toBe(false);
      expect(errors[0]).toContain("file_path");
    });

    it("coerces string to number", () => {
      const { corrected } = validateAndCoerce(
        { limit: "42" },
        { properties: { limit: { type: "number" } } },
      );
      expect(corrected["limit"]).toBe(42);
    });

    it("coerces string to boolean", () => {
      const { corrected } = validateAndCoerce(
        { verbose: "true" },
        { properties: { verbose: { type: "boolean" } } },
      );
      expect(corrected["verbose"]).toBe(true);
    });

    it("passes valid args through unchanged", () => {
      const { valid } = validateAndCoerce(
        { file_path: "/src/foo.ts" },
        { required: ["file_path"], properties: { file_path: { type: "string" } } },
      );
      expect(valid).toBe(true);
    });
  });
});
