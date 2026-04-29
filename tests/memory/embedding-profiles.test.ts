/**
 * Asymmetric embedding prefixes — registry + opt-in gate tests.
 *
 * Validates the LightRAG `embedding-prefixes` port:
 *   - getEmbeddingProfile() resolves known model name patterns
 *   - applyQueryPrefix / applyDocPrefix are no-ops for null/empty
 *   - isAsymmetricEmbeddingsEnabled honors the env-var gate
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  EMBEDDING_PROFILES,
  applyDocPrefix,
  applyQueryPrefix,
  getEmbeddingProfile,
  isAsymmetricEmbeddingsEnabled,
} from "../../src/memory/embedding-profiles.js";

describe("EMBEDDING_PROFILES registry shape", () => {
  it("contains at least the BGE / Qwen3 / E5 / Voyage families", () => {
    // We search by pattern.toString() because the `RegExp.source` reads
    // straight from the pattern body without flags — easier to assert.
    const sources = EMBEDDING_PROFILES.map(([p]) => p.source);
    expect(sources.some((s) => s.includes("bge-"))).toBe(true);
    expect(sources.some((s) => s.includes("qwen"))).toBe(true);
    expect(sources.some((s) => s.includes("e5-"))).toBe(true);
    expect(sources.some((s) => s.includes("voyage-"))).toBe(true);
  });

  it("each entry's profile has string queryPrefix and docPrefix fields", () => {
    for (const [, profile] of EMBEDDING_PROFILES) {
      expect(typeof profile.queryPrefix).toBe("string");
      expect(typeof profile.docPrefix).toBe("string");
    }
  });
});

describe("getEmbeddingProfile()", () => {
  it("resolves intfloat/e5-small-v2 to the query:/passage: pair", () => {
    const profile = getEmbeddingProfile("intfloat/e5-small-v2");
    expect(profile).not.toBeNull();
    expect(profile!.queryPrefix).toBe("query: ");
    expect(profile!.docPrefix).toBe("passage: ");
  });

  it("resolves multilingual-e5-large to the same query:/passage: pair", () => {
    const profile = getEmbeddingProfile("multilingual-e5-large");
    expect(profile).not.toBeNull();
    expect(profile!.queryPrefix).toBe("query: ");
    expect(profile!.docPrefix).toBe("passage: ");
  });

  it("resolves bge-large-en-v1.5 to the BGE query-only prefix", () => {
    const profile = getEmbeddingProfile("bge-large-en-v1.5");
    expect(profile).not.toBeNull();
    expect(profile!.queryPrefix).toContain("Represent this sentence");
    expect(profile!.docPrefix).toBe("");
  });

  it("resolves bge-m3 to symmetric (no prefix) — distinct from v1.5", () => {
    const profile = getEmbeddingProfile("BAAI/bge-m3");
    expect(profile).not.toBeNull();
    expect(profile!.queryPrefix).toBe("");
    expect(profile!.docPrefix).toBe("");
  });

  it("resolves Qwen3-Embedding-8B to the Instruct: query template", () => {
    const profile = getEmbeddingProfile("Qwen3-Embedding-8B");
    expect(profile).not.toBeNull();
    expect(profile!.queryPrefix.startsWith("Instruct:")).toBe(true);
    expect(profile!.docPrefix).toBe("");
  });

  it("returns null for unknown / symmetric models (OpenAI, Cohere)", () => {
    expect(getEmbeddingProfile("text-embedding-3-large")).toBeNull();
    expect(getEmbeddingProfile("embed-english-v3.0")).toBeNull();
    expect(getEmbeddingProfile("nonexistent-model")).toBeNull();
  });

  it("returns null on empty / non-string input (defensive)", () => {
    expect(getEmbeddingProfile("")).toBeNull();
    // Cast to bypass the static type check — runtime defensive path.
    expect(getEmbeddingProfile(null as unknown as string)).toBeNull();
    expect(getEmbeddingProfile(undefined as unknown as string)).toBeNull();
  });
});

describe("applyQueryPrefix() / applyDocPrefix()", () => {
  it("returns input unchanged when profile is null", () => {
    expect(applyQueryPrefix(null, "what time is it")).toBe("what time is it");
    expect(applyDocPrefix(null, "the meeting is at 3pm")).toBe("the meeting is at 3pm");
  });

  it("returns input unchanged when prefix is empty string", () => {
    const symmetric = { queryPrefix: "", docPrefix: "" };
    expect(applyQueryPrefix(symmetric, "hello")).toBe("hello");
    expect(applyDocPrefix(symmetric, "world")).toBe("world");
  });

  it("prepends queryPrefix only on the query side", () => {
    const e5 = getEmbeddingProfile("e5-small")!;
    expect(applyQueryPrefix(e5, "what is wotann")).toBe("query: what is wotann");
    expect(applyDocPrefix(e5, "wotann is an agent harness")).toBe(
      "passage: wotann is an agent harness",
    );
  });

  it("BGE applies query prefix only — doc side is unchanged", () => {
    const bge = getEmbeddingProfile("bge-base-en-v1.5")!;
    const q = applyQueryPrefix(bge, "find the policy");
    const d = applyDocPrefix(bge, "Section 3.1 — refund policy");
    expect(q).toContain("Represent this sentence");
    expect(q).toContain("find the policy");
    expect(d).toBe("Section 3.1 — refund policy"); // unchanged
  });
});

describe("isAsymmetricEmbeddingsEnabled() — env-var gate", () => {
  const original = process.env.WOTANN_ASYMMETRIC_EMBEDDINGS;

  afterEach(() => {
    if (original === undefined) delete process.env.WOTANN_ASYMMETRIC_EMBEDDINGS;
    else process.env.WOTANN_ASYMMETRIC_EMBEDDINGS = original;
  });

  it("returns false when unset (default OFF)", () => {
    delete process.env.WOTANN_ASYMMETRIC_EMBEDDINGS;
    expect(isAsymmetricEmbeddingsEnabled()).toBe(false);
  });

  it("returns true for truthy literals 1/true/yes/on (case-insensitive)", () => {
    for (const v of ["1", "true", "TRUE", "yes", "Yes", "on", "ON"]) {
      process.env.WOTANN_ASYMMETRIC_EMBEDDINGS = v;
      expect(isAsymmetricEmbeddingsEnabled()).toBe(true);
    }
  });

  it("returns false for non-truthy values (0, false, garbage, empty)", () => {
    for (const v of ["0", "false", "no", "off", "garbage", ""]) {
      process.env.WOTANN_ASYMMETRIC_EMBEDDINGS = v;
      expect(isAsymmetricEmbeddingsEnabled()).toBe(false);
    }
  });
});
