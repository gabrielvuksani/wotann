import { describe, it, expect } from "vitest";
import {
  maybeBuildCidIndexForProvider,
  renderCidAnnotation,
} from "../../src/intelligence/content-cid.js";

describe("content-cid (intelligence wrapper)", () => {
  const chunks = [
    { content: "alpha chunk content" },
    { content: "beta chunk content" },
    { content: "gamma chunk content" },
  ];

  it("returns null for frontier-vision models (no CID needed)", () => {
    const result = maybeBuildCidIndexForProvider({
      modelId: "claude-sonnet-4-6",
      hasVision: true,
      chunks,
    });
    expect(result).toBeNull();
  });

  it("returns null for gpt-4 frontier models", () => {
    const result = maybeBuildCidIndexForProvider({
      modelId: "gpt-4-turbo",
      hasVision: true,
      chunks,
    });
    expect(result).toBeNull();
  });

  it("builds CID index for small-vision provider (gemma)", () => {
    const result = maybeBuildCidIndexForProvider({
      modelId: "gemma-3-4b-vision",
      hasVision: true,
      chunks,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("small-vision");
    expect(result!.chunkCount).toBe(3);
    expect(result!.index.size).toBe(3);
  });

  it("builds CID index for text-only provider (phi)", () => {
    const result = maybeBuildCidIndexForProvider({
      modelId: "phi-3-mini",
      hasVision: false,
      chunks,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("text-only");
  });

  it("force=true overrides frontier tier decision", () => {
    const result = maybeBuildCidIndexForProvider({
      modelId: "claude-sonnet-4-6",
      hasVision: true,
      chunks,
      force: true,
    });
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("frontier-vision");
  });

  it("returns null when no chunks are provided", () => {
    const result = maybeBuildCidIndexForProvider({
      modelId: "gemma-3-4b-vision",
      hasVision: true,
      chunks: [],
    });
    expect(result).toBeNull();
  });

  it("promptBlock contains [cid:] anchors for each chunk", () => {
    const result = maybeBuildCidIndexForProvider({
      modelId: "gemma-3-4b-vision",
      hasVision: true,
      chunks,
    });
    expect(result!.promptBlock).toMatch(/\[cid:[0-9a-z]+\]/);
    const matches = result!.promptBlock.match(/\[cid:[0-9a-z]+\]/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it("renderCidAnnotation wraps prompt block with header + instructions", () => {
    const result = maybeBuildCidIndexForProvider({
      modelId: "gemma-3-4b-vision",
      hasVision: true,
      chunks,
    });
    const annotated = renderCidAnnotation(result);
    expect(annotated).toContain("Content anchors");
    expect(annotated).toContain("CID");
    expect(annotated).toContain("[cid:");
  });

  it("renderCidAnnotation returns empty string for null result", () => {
    expect(renderCidAnnotation(null)).toBe("");
  });
});
