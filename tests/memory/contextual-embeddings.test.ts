import { describe, it, expect, vi } from "vitest";
import {
  cleanContext,
  buildContextualChunk,
  buildBatchedContextualChunks,
  createLlmContextGenerator,
  type ContextualChunkGenerator,
} from "../../src/memory/contextual-embeddings.js";

describe("cleanContext", () => {
  it("trims whitespace", () => {
    expect(cleanContext("  hello  ")).toBe("hello");
  });

  it("strips surrounding quotes", () => {
    expect(cleanContext('"quoted context"')).toBe("quoted context");
  });

  it("strips leading Context: label", () => {
    expect(cleanContext("Context: This is from section 3")).toBe("This is from section 3");
  });

  it("strips ```...``` fences", () => {
    expect(cleanContext("```\ncontext here\n```")).toBe("context here");
  });

  it("handles empty/undefined input", () => {
    expect(cleanContext("")).toBe("");
  });
});

describe("createLlmContextGenerator", () => {
  it("calls query with a prompt that includes chunk + document", async () => {
    let capturedPrompt = "";
    const gen = createLlmContextGenerator(async (prompt) => {
      capturedPrompt = prompt;
      return "from section 3 of TechCo returns policy";
    });
    const ctx = await gen.generate("The return policy is 30 days.", "TechCo returns doc...");
    expect(ctx).toBe("from section 3 of TechCo returns policy");
    expect(capturedPrompt).toContain("The return policy is 30 days");
    expect(capturedPrompt).toContain("TechCo returns doc");
  });

  it("caps document preview at MAX_DOC_PREVIEW_CHARS", async () => {
    let capturedPrompt = "";
    const longDoc = "x".repeat(20_000);
    const gen = createLlmContextGenerator(async (prompt) => {
      capturedPrompt = prompt;
      return "ctx";
    });
    await gen.generate("chunk", longDoc);
    // Full doc NOT in prompt
    expect(capturedPrompt.length).toBeLessThan(20_000);
    expect(capturedPrompt).toContain("truncated");
  });

  it("passes maxTokens and temperature: 0", async () => {
    let capturedOpts: { maxTokens?: number; temperature?: number } = {};
    const gen = createLlmContextGenerator(async (_p, opts) => {
      capturedOpts = opts as { maxTokens: number; temperature?: number };
      return "ok";
    });
    await gen.generate("c", "d");
    expect(capturedOpts.maxTokens).toBe(120);
    expect(capturedOpts.temperature).toBe(0);
  });
});

describe("buildContextualChunk", () => {
  it("prepends context to chunk with separator", async () => {
    const gen: ContextualChunkGenerator = {
      generate: async () => "In section 3 of the policy",
    };
    const result = await buildContextualChunk("The rule is X.", "doc", gen);
    expect(result.context).toBe("In section 3 of the policy");
    expect(result.chunk).toBe("The rule is X.");
    expect(result.contextualized).toBe("In section 3 of the policy\n\nThe rule is X.");
  });

  it("returns chunk unchanged when generator returns empty", async () => {
    const gen: ContextualChunkGenerator = { generate: async () => "" };
    const result = await buildContextualChunk("chunk", "doc", gen);
    expect(result.context).toBe("");
    expect(result.contextualized).toBe("chunk");
  });

  it("throws when allowEmptyContext=false and generator returns empty", async () => {
    const gen: ContextualChunkGenerator = { generate: async () => "" };
    await expect(
      buildContextualChunk("chunk", "doc", gen, { allowEmptyContext: false }),
    ).rejects.toThrow(/empty context/);
  });

  it("accepts custom separator", async () => {
    const gen: ContextualChunkGenerator = { generate: async () => "ctx" };
    const result = await buildContextualChunk("chunk", "doc", gen, { separator: " | " });
    expect(result.contextualized).toBe("ctx | chunk");
  });

  it("short-circuits empty chunk", async () => {
    const gen: ContextualChunkGenerator = {
      generate: vi.fn(async () => "never called"),
    };
    const result = await buildContextualChunk("   ", "doc", gen);
    expect(result.context).toBe("");
    expect(gen.generate).not.toHaveBeenCalled();
  });
});

describe("buildBatchedContextualChunks", () => {
  it("processes chunks concurrently with bounded parallelism", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gen: ContextualChunkGenerator = {
      generate: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return "ctx";
      },
    };
    await buildBatchedContextualChunks(
      Array.from({ length: 20 }, (_, i) => `chunk ${i}`),
      "doc",
      gen,
      { concurrency: 3 },
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("preserves input order in output", async () => {
    const gen: ContextualChunkGenerator = {
      generate: async (chunk) => {
        // Introduce variable delay so out-of-order is exposed
        await new Promise((r) => setTimeout(r, Math.random() * 20));
        return `ctx-for-${chunk}`;
      },
    };
    const chunks = ["a", "b", "c", "d", "e"];
    const results = await buildBatchedContextualChunks(chunks, "doc", gen, { concurrency: 4 });
    expect(results.map((r) => r.chunk)).toEqual(chunks);
    expect(results.map((r) => r.context)).toEqual([
      "ctx-for-a",
      "ctx-for-b",
      "ctx-for-c",
      "ctx-for-d",
      "ctx-for-e",
    ]);
  });

  it("continues batch when individual chunk generation throws", async () => {
    let callCount = 0;
    const gen: ContextualChunkGenerator = {
      generate: async () => {
        callCount++;
        if (callCount === 2) throw new Error("simulated failure");
        return "ctx";
      },
    };
    const results = await buildBatchedContextualChunks(
      ["a", "b", "c"],
      "doc",
      gen,
      { concurrency: 1 }, // force serial so callCount ordering is deterministic
    );
    expect(results).toHaveLength(3);
    expect(results[1]?.context).toBe(""); // failed chunk
    expect(results[0]?.context).toBe("ctx");
    expect(results[2]?.context).toBe("ctx");
  });

  it("calls onProgress for each chunk", async () => {
    const calls: Array<[number, number]> = [];
    const gen: ContextualChunkGenerator = { generate: async () => "x" };
    await buildBatchedContextualChunks(
      ["a", "b", "c"],
      "doc",
      gen,
      {
        concurrency: 1,
        onProgress: (done, total) => calls.push([done, total]),
      },
    );
    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("skipEmpty: true skips whitespace-only chunks", async () => {
    const gen: ContextualChunkGenerator = {
      generate: vi.fn(async () => "ctx"),
    };
    const results = await buildBatchedContextualChunks(
      ["a", "   ", "c"],
      "doc",
      gen,
    );
    expect(results[1]?.context).toBe("");
    // Generator called only for non-empty chunks
    expect(gen.generate).toHaveBeenCalledTimes(2);
  });

  it("concurrency clamps to chunks.length when smaller", async () => {
    // Regression test: don't spawn 100 workers for 5 chunks
    const gen: ContextualChunkGenerator = { generate: async () => "x" };
    const results = await buildBatchedContextualChunks(
      ["a", "b"],
      "doc",
      gen,
      { concurrency: 100 },
    );
    expect(results).toHaveLength(2);
  });
});
