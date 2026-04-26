/**
 * PROVIDER-AGNOSTIC TEST — exercises ThinkingPreserver extract/restore
 * round-trip. Model id is associated with the thinking-block but never
 * asserted as a specific value.
 */
import { describe, it, expect } from "vitest";
import { ThinkingPreserver } from "../../src/providers/thinking-preserver.js";
import { getTierModel } from "../_helpers/model-tier.js";

const STRONG_MODEL = getTierModel("strong").model;

describe("ThinkingPreserver", () => {
  it("extracts thinking blocks and stores them", () => {
    const preserver = new ThinkingPreserver();
    const content = [
      { type: "thinking", thinking: "Let me reason about this..." },
      { type: "text", text: "The answer is 42." },
    ];

    const preserved = preserver.extractAndStore("session-1", 0, content, STRONG_MODEL);
    expect(preserved.length).toBe(1); // Only text, thinking removed
    expect(preserved[0]!.type).toBe("text");

    const blocks = preserver.getBlocks("session-1", 0);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.content).toBe("Let me reason about this...");
  });

  it("reattaches thinking blocks when translating back", () => {
    const preserver = new ThinkingPreserver();

    // Store thinking
    preserver.extractAndStore("s1", 0, [
      { type: "thinking", thinking: "Analysis step 1" },
      { type: "text", text: "Result" },
    ], "claude-opus");

    // Reattach at the same turn
    const reattached = preserver.reattach("s1", 0, [{ type: "text", text: "Result" }]);
    expect(reattached.length).toBe(2);
    expect(reattached[0]!.type).toBe("thinking");
    expect(reattached[0]!.thinking).toBe("Analysis step 1");
    expect(reattached[1]!.type).toBe("text");
  });

  it("returns original content when no thinking stored", () => {
    const preserver = new ThinkingPreserver();
    const content = [{ type: "text", text: "No thinking here" }];
    const result = preserver.reattach("empty-session", 5, content);
    expect(result).toEqual(content);
  });

  it("builds thinking chain across turns", () => {
    const preserver = new ThinkingPreserver();

    preserver.extractAndStore("s1", 0, [{ type: "thinking", thinking: "Step 1: understand" }], "claude");
    preserver.extractAndStore("s1", 1, [{ type: "thinking", thinking: "Step 2: apply" }], "claude");
    preserver.extractAndStore("s1", 2, [{ type: "thinking", thinking: "Step 3: verify" }], "claude");

    const chain = preserver.getThinkingChain("s1");
    expect(chain).toContain("[Turn 0]");
    expect(chain).toContain("[Turn 2]");
    expect(chain).toContain("Step 1: understand");
  });

  it("estimates token count", () => {
    const preserver = new ThinkingPreserver();
    preserver.extractAndStore("s1", 0, [{ type: "thinking", thinking: "x".repeat(400) }], "claude");

    const tokens = preserver.estimateTokens("s1");
    expect(tokens).toBe(100); // 400 chars / 4 chars per token
  });

  it("clears session thinking blocks", () => {
    const preserver = new ThinkingPreserver();
    preserver.extractAndStore("s1", 0, [{ type: "thinking", thinking: "thought" }], "claude");
    expect(preserver.getBlocks("s1").length).toBe(1);

    preserver.clear("s1");
    expect(preserver.getBlocks("s1").length).toBe(0);
  });

  it("clears all sessions", () => {
    const preserver = new ThinkingPreserver();
    preserver.extractAndStore("s1", 0, [{ type: "thinking", thinking: "t1" }], "claude");
    preserver.extractAndStore("s2", 0, [{ type: "thinking", thinking: "t2" }], "claude");

    preserver.clearAll();
    expect(preserver.getBlocks("s1").length).toBe(0);
    expect(preserver.getBlocks("s2").length).toBe(0);
  });
});
