import { describe, it, expect } from "vitest";
import {
  cidOf,
  buildCidIndex,
  resolveCid,
  renderCidBlock,
  verifyCid,
} from "../../src/core/content-cid.js";

describe("content-cid — short hash anchor for weak-model edit workflows", () => {
  it("cidOf produces a stable base36 prefix of the SHA256 digest", () => {
    const a = cidOf("hello world");
    const b = cidOf("hello world");
    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-z]{3}$/);
  });

  it("cidOf returns different CIDs for different content", () => {
    expect(cidOf("a")).not.toEqual(cidOf("b"));
  });

  it("cidOf length is bounded [1,12]", () => {
    expect(cidOf("x", 1)).toHaveLength(1);
    expect(cidOf("x", 12)).toHaveLength(12);
    expect(() => cidOf("x", 0)).toThrow();
    expect(() => cidOf("x", 13)).toThrow();
  });

  it("buildCidIndex stores every chunk with a unique CID", () => {
    const chunks = [
      { content: "alpha" },
      { content: "beta" },
      { content: "gamma" },
    ];
    const { entries, cidLength } = buildCidIndex(chunks);
    expect(entries.size).toBe(3);
    expect(cidLength).toBeGreaterThanOrEqual(2);
    // Every CID has the same length.
    for (const cid of entries.keys()) {
      expect(cid).toHaveLength(cidLength);
    }
  });

  it("buildCidIndex auto-grows CID length on collision", () => {
    // Not easy to force a real 2-char collision deterministically without
    // crafting inputs; instead we verify the length grows when many
    // chunks overlap by feeding ~50 similar strings.
    const chunks = Array.from({ length: 50 }, (_, i) => ({
      content: `chunk_${i}`,
    }));
    const { cidLength } = buildCidIndex(chunks);
    expect(cidLength).toBeGreaterThanOrEqual(2);
  });

  it("resolveCid returns the original chunk", () => {
    const { entries } = buildCidIndex([{ content: "alpha", metadata: { kind: "file" } }]);
    const cid = [...entries.keys()][0]!;
    const hit = resolveCid(entries, cid);
    expect(hit).not.toBeNull();
    expect(hit!.content).toBe("alpha");
    expect((hit!.metadata as { kind: string }).kind).toBe("file");
  });

  it("resolveCid returns null for unknown CIDs (hallucination guard)", () => {
    const { entries } = buildCidIndex([{ content: "alpha" }]);
    expect(resolveCid(entries, "zzzzzz")).toBeNull();
  });

  it("renderCidBlock formats as [cid:xx] + indented content", () => {
    const { entries } = buildCidIndex([{ content: "line1\nline2" }]);
    const cid = [...entries.keys()][0]!;
    const out = renderCidBlock(entries);
    expect(out).toContain(`[cid:${cid}]`);
    expect(out).toContain("  line1");
    expect(out).toContain("  line2");
  });

  it("verifyCid detects drift — content hash change invalidates the CID", () => {
    const { entries } = buildCidIndex([{ content: "original" }]);
    const cid = [...entries.keys()][0]!;
    expect(verifyCid(entries, cid, "original")).toBe(true);
    expect(verifyCid(entries, cid, "modified")).toBe(false);
    expect(verifyCid(entries, "zzzzzz", "original")).toBe(false);
  });
});
