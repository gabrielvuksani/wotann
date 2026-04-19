import { describe, it, expect } from "vitest";
import {
  EntitySchema,
  EXTRACTION_RESULT_SCHEMA,
  ENTITY_TYPES,
  parseExtractionResponse,
  extractEntities,
  buildExtractionPrompt,
  isPerson,
  isProject,
  filterByType,
  type Entity,
} from "../../src/memory/entity-types.js";

describe("EntitySchema discriminated union", () => {
  it("validates a person", () => {
    const result = EntitySchema.safeParse({ type: "person", name: "Ada Lovelace" });
    expect(result.success).toBe(true);
  });

  it("validates a project with status", () => {
    const result = EntitySchema.safeParse({
      type: "project",
      name: "WOTANN",
      status: "active",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status enum", () => {
    const result = EntitySchema.safeParse({
      type: "project",
      name: "WOTANN",
      status: "made-up-status",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = EntitySchema.safeParse({ type: "person", name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown entity type", () => {
    const result = EntitySchema.safeParse({ type: "alien", name: "E.T." });
    expect(result.success).toBe(false);
  });

  it("email must be valid", () => {
    const result = EntitySchema.safeParse({
      type: "person",
      name: "Ada",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("progress in goal is clamped to [0,1]", () => {
    const over = EntitySchema.safeParse({
      type: "goal",
      name: "X",
      progress: 1.5,
    });
    expect(over.success).toBe(false);
  });
});

describe("ENTITY_TYPES", () => {
  it("exports 8 canonical types", () => {
    expect(ENTITY_TYPES).toHaveLength(8);
    expect(ENTITY_TYPES).toContain("person");
    expect(ENTITY_TYPES).toContain("tool");
  });
});

describe("buildExtractionPrompt", () => {
  it("includes the observation", () => {
    const prompt = buildExtractionPrompt("Gabriel met Ada yesterday");
    expect(prompt).toContain("Gabriel met Ada");
  });

  it("includes max-entities count", () => {
    const prompt = buildExtractionPrompt("x", 5);
    expect(prompt).toContain("up to 5");
  });

  it("includes schema hint", () => {
    const prompt = buildExtractionPrompt("x");
    expect(prompt).toContain("person");
    expect(prompt).toContain("project");
  });
});

describe("parseExtractionResponse", () => {
  it("parses a valid JSON response", () => {
    const raw = JSON.stringify({
      entities: [
        { type: "person", name: "Ada" },
        { type: "project", name: "WOTANN", status: "active" },
      ],
    });
    const result = parseExtractionResponse(raw);
    expect(result?.entities).toHaveLength(2);
  });

  it("accepts fenced ```json block", () => {
    const raw = `\`\`\`json
${JSON.stringify({ entities: [{ type: "person", name: "Ada" }] })}
\`\`\``;
    const result = parseExtractionResponse(raw);
    expect(result?.entities).toHaveLength(1);
  });

  it("returns null on garbage", () => {
    expect(parseExtractionResponse("not json")).toBeNull();
    expect(parseExtractionResponse("")).toBeNull();
  });

  it("returns null when schema validation fails", () => {
    const raw = JSON.stringify({ entities: [{ type: "alien", name: "E.T." }] });
    expect(parseExtractionResponse(raw)).toBeNull();
  });

  it("brace-balanced fallback on surrounding junk", () => {
    const raw = `Before ${JSON.stringify({
      entities: [{ type: "person", name: "Ada" }],
    })} after`;
    const result = parseExtractionResponse(raw);
    expect(result?.entities).toHaveLength(1);
  });
});

describe("extractEntities", () => {
  it("returns entities on successful LLM response", async () => {
    const entities = await extractEntities("obs", {
      llmQuery: async () =>
        JSON.stringify({ entities: [{ type: "person", name: "Ada" }] }),
    });
    expect(entities).toHaveLength(1);
    expect(entities[0]?.type).toBe("person");
  });

  it("returns [] on parse failure", async () => {
    const entities = await extractEntities("obs", {
      llmQuery: async () => "garbage",
    });
    expect(entities).toEqual([]);
  });

  it("returns [] when LLM throws", async () => {
    const entities = await extractEntities("obs", {
      llmQuery: async () => {
        throw new Error("LLM down");
      },
    });
    expect(entities).toEqual([]);
  });
});

describe("type guards", () => {
  const person: Entity = { type: "person", name: "Ada" };
  const project: Entity = { type: "project", name: "WOTANN" };

  it("isPerson narrows correctly", () => {
    expect(isPerson(person)).toBe(true);
    expect(isPerson(project)).toBe(false);
  });

  it("isProject narrows correctly", () => {
    expect(isProject(project)).toBe(true);
    expect(isProject(person)).toBe(false);
  });
});

describe("filterByType", () => {
  const entities: Entity[] = [
    { type: "person", name: "Ada" },
    { type: "project", name: "WOTANN" },
    { type: "person", name: "Bob" },
    { type: "file", path: "/x.ts" },
  ];

  it("returns only matching type", () => {
    const people = filterByType(entities, "person");
    expect(people).toHaveLength(2);
    expect(people.every((p) => p.type === "person")).toBe(true);
  });

  it("returns [] when no matches", () => {
    expect(filterByType(entities, "event")).toEqual([]);
  });
});
