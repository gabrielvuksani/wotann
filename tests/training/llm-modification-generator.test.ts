import { describe, it, expect } from "vitest";
import { createLlmModificationGenerator } from "../../src/training/llm-modification-generator.js";
import type { StreamChunk } from "../../src/providers/types.js";
import type { WotannQueryOptions } from "../../src/core/types.js";

/**
 * Fake query helper — returns whatever StreamChunks we enqueue.
 * Each call to the generator invokes the query callback once, so we
 * model a FIFO of scripted response sequences.
 */
function makeScriptedQuery(responses: StreamChunk[][]): (opts: WotannQueryOptions) => AsyncGenerator<StreamChunk> {
  let call = 0;
  return async function* (_opts: WotannQueryOptions): AsyncGenerator<StreamChunk> {
    const script = responses[call] ?? [];
    call++;
    for (const chunk of script) {
      yield chunk;
    }
  };
}

function textChunk(content: string): StreamChunk {
  return { type: "text", content, provider: "openai" };
}

const TARGET_FILE = "src/fake.ts";
const ORIGINAL_CONTENT = [
  "export function square(n: number): number {",
  "  return n * n;",
  "}",
  "",
  "export function cube(n: number): number {",
  "  return n * n * n;",
  "}",
].join("\n");

describe("createLlmModificationGenerator", () => {
  it("returns a ModificationProposal when the LLM emits a clean fenced JSON block", async () => {
    const newContent = ORIGINAL_CONTENT.replace("n * n * n", "Math.pow(n, 3)");
    const llmBody = [
      "Sure, here is the improvement:",
      "",
      "```json",
      JSON.stringify({
        description: "use Math.pow for cube",
        reasoning: "clearer intent, identical runtime semantics",
        modifiedContent: newContent,
      }),
      "```",
    ].join("\n");
    const generator = createLlmModificationGenerator(makeScriptedQuery([[textChunk(llmBody)]]));
    const result = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(result).not.toBeNull();
    expect(result?.description).toBe("use Math.pow for cube");
    expect(result?.newContent).toContain("Math.pow(n, 3)");
    expect(result?.reasoning.length).toBeGreaterThan(0);
  });

  it("rejects no-op proposals whose modifiedContent equals the original", async () => {
    const llmBody = [
      "```json",
      JSON.stringify({
        description: "no change",
        reasoning: "could not find anything to improve",
        modifiedContent: ORIGINAL_CONTENT,
      }),
      "```",
    ].join("\n");
    const generator = createLlmModificationGenerator(
      makeScriptedQuery([[textChunk(llmBody)]]),
      { maxEmptyRetries: 3 },
    );
    const result = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(result).toBeNull();
  });

  it("rejects proposals that radically resize the file (>+/- 50%)", async () => {
    const bloated = new Array(100).fill("// bloat line").join("\n") + "\n" + ORIGINAL_CONTENT;
    const llmBody = [
      "```json",
      JSON.stringify({
        description: "add lots of comments",
        reasoning: "documentation",
        modifiedContent: bloated,
      }),
      "```",
    ].join("\n");
    const generator = createLlmModificationGenerator(makeScriptedQuery([[textChunk(llmBody)]]));
    const result = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(result).toBeNull();
  });

  it("returns null after N consecutive unparseable responses", async () => {
    const garbage = "not JSON at all, no code block, just words";
    const generator = createLlmModificationGenerator(
      makeScriptedQuery([[textChunk(garbage)], [textChunk(garbage)], [textChunk(garbage)]]),
      { maxEmptyRetries: 3 },
    );
    // First call: emits garbage → counter=1 → returns null (by design in current
    // implementation; the loop treats each unparseable as a "stop candidate").
    const r1 = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(r1).toBeNull();
    const r2 = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(r2).toBeNull();
    const r3 = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(r3).toBeNull();
  });

  it("falls back to brace-balanced JSON extraction when no fence is present", async () => {
    const newContent = ORIGINAL_CONTENT.replace("n * n;", "n ** 2;");
    const llmBody = [
      "Here you go:",
      JSON.stringify({
        description: "use ** operator",
        reasoning: "idiomatic modern JS",
        modifiedContent: newContent,
      }),
      "That's the proposal.",
    ].join("\n");
    const generator = createLlmModificationGenerator(makeScriptedQuery([[textChunk(llmBody)]]));
    const result = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(result).not.toBeNull();
    expect(result?.newContent).toContain("n ** 2");
  });

  it("survives JSON with embedded braces in string values", async () => {
    const modified = ORIGINAL_CONTENT + "\n// note: {nested: 'brace'}\n";
    const llmBody = [
      "```json",
      JSON.stringify({
        description: "add an annotation",
        reasoning: "string contains { and } which must not confuse the extractor",
        modifiedContent: modified,
      }),
      "```",
    ].join("\n");
    const generator = createLlmModificationGenerator(makeScriptedQuery([[textChunk(llmBody)]]));
    const result = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(result).not.toBeNull();
    expect(result?.newContent).toContain("{nested: 'brace'}");
  });

  it("handles transport failures gracefully (returns null, does not throw)", async () => {
    const throwingQuery = async function* (): AsyncGenerator<StreamChunk> {
      // The generator must be async so await doesn't block — the failure
      // mode we want to simulate is "provider threw mid-stream." The yield
      // below exists purely so TypeScript classifies this as an async
      // generator; it's unreachable by design.
      if (Date.now() < 0) yield { type: "text", content: "never", provider: "openai" };
      throw new Error("fake provider outage");
    };
    const generator = createLlmModificationGenerator(throwingQuery);
    const result = await generator(TARGET_FILE, ORIGINAL_CONTENT, []);
    expect(result).toBeNull();
  });
});
