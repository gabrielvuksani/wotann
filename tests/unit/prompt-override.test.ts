/**
 * C12 — per-prompt provider/model/effort override tests.
 */

import { describe, it, expect } from "vitest";
import {
  applyOverride,
  extractOverride,
  hasOverride,
  type TurnDispatchConfig,
} from "../../src/core/prompt-override.js";

describe("extractOverride", () => {
  it("returns empty override when no tag present", () => {
    const r = extractOverride("just a regular prompt");
    expect(r.cleaned).toBe("just a regular prompt");
    expect(hasOverride(r.override)).toBe(false);
    expect(r.problems).toEqual([]);
  });

  it("extracts a known-provider-only tag", () => {
    const r = extractOverride("hello [@anthropic]");
    expect(r.override.provider).toBe("anthropic");
    expect(r.override.model).toBeUndefined();
    expect(r.cleaned).toBe("hello");
  });

  it("extracts a model-only tag when token isn't a known provider", () => {
    const r = extractOverride("review this [@opus-4-7]");
    expect(r.override.model).toBe("opus-4-7");
    expect(r.override.provider).toBeUndefined();
  });

  it("extracts provider:model form", () => {
    const r = extractOverride("[@openai:gpt-5] hi");
    expect(r.override.provider).toBe("openai");
    expect(r.override.model).toBe("gpt-5");
    expect(r.cleaned).toBe("hi");
  });

  it("parses effort + thinking + temperature kv pairs", () => {
    const r = extractOverride("plan this [@opus-4-7 effort=high thinking=medium temperature=0.3]");
    expect(r.override.effort).toBe("high");
    expect(r.override.thinking).toBe("medium");
    expect(r.override.temperature).toBe(0.3);
    expect(r.problems).toEqual([]);
  });

  it("rejects out-of-range temperature", () => {
    const r = extractOverride("x [@opus temperature=5]");
    expect(r.override.temperature).toBeUndefined();
    expect(r.problems.some((p) => p.includes("temperature"))).toBe(true);
  });

  it("rejects unknown kv key", () => {
    const r = extractOverride("x [@opus unknown=42]");
    expect(r.problems.some((p) => p.includes("unknown override key"))).toBe(true);
  });

  it("collapses extra whitespace around the removed tag", () => {
    const r = extractOverride("hello   [@anthropic]   world");
    expect(r.cleaned).toBe("hello world");
  });

  it("handles tag at the start", () => {
    const r = extractOverride("[@opus-4-7] summarise the diff");
    expect(r.override.model).toBe("opus-4-7");
    expect(r.cleaned).toBe("summarise the diff");
  });

  it("accepts thinking=off as a sentinel", () => {
    const r = extractOverride("x [@opus thinking=off]");
    expect(r.override.thinking).toBe("off");
  });

  it("accepts max_tokens alias for maxTokens", () => {
    const r = extractOverride("x [@opus max_tokens=4096]");
    expect(r.override.maxTokens).toBe(4096);
  });

  it("flags malformed kv without =", () => {
    const r = extractOverride("x [@opus high]");
    expect(r.problems.some((p) => p.includes("missing ="))).toBe(true);
  });

  it("normalises provider casing to lowercase", () => {
    const r = extractOverride("x [@Anthropic]");
    expect(r.override.provider).toBe("anthropic");
  });

  it("preserves original raw for the audit trail", () => {
    const r = extractOverride("x [@opus effort=high] y");
    expect(r.raw).toBe("x [@opus effort=high] y");
    expect(r.cleaned).toBe("x y");
  });
});

describe("applyOverride", () => {
  const defaults: TurnDispatchConfig = {
    provider: "anthropic",
    model: "claude-opus-4-7",
    effort: "medium",
    thinking: "medium",
    temperature: 0.7,
    maxTokens: 8192,
  };

  it("returns defaults when override is empty", () => {
    const r = applyOverride(defaults, {});
    expect(r).toEqual(defaults);
  });

  it("replaces only overridden fields", () => {
    const r = applyOverride(defaults, { provider: "openai", model: "gpt-5" });
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("gpt-5");
    expect(r.effort).toBe("medium");
    expect(r.thinking).toBe("medium");
    expect(r.temperature).toBe(0.7);
  });

  it("honours a numeric zero override", () => {
    const r = applyOverride(defaults, { temperature: 0 });
    expect(r.temperature).toBe(0);
  });

  it("falls back to defaults when override fields omitted", () => {
    const r = applyOverride(defaults, { effort: "high" });
    expect(r.effort).toBe("high");
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-opus-4-7");
  });
});

describe("hasOverride", () => {
  it("returns false for empty override", () => {
    expect(hasOverride({})).toBe(false);
  });
  it("returns true when any field is set", () => {
    expect(hasOverride({ effort: "high" })).toBe(true);
    expect(hasOverride({ temperature: 0 })).toBe(true);
  });
});
