import { describe, it, expect, vi } from "vitest";
import {
  crystallizeIfEligible,
  prependRequiredReading,
} from "../../src/runtime-hooks/dead-code-hooks.js";

// Mock crystallizeSuccess so we don't actually write to disk
vi.mock("../../src/skills/self-crystallization.js", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    crystallizeSuccess: vi.fn((input: unknown) => ({
      path: "/tmp/mock.md",
      slug: "mock",
      input,
    })),
  };
});

describe("crystallizeIfEligible", () => {
  const baseInput = {
    prompt: "Write a widget",
    toolCalls: [],
    diffSummary: "Added src/widget.ts",
    title: "widget",
    cyclesCompleted: 5,
    filesChanged: 3,
    score: 0.95,
  };

  it("eligible when all thresholds met", () => {
    const r = crystallizeIfEligible(baseInput);
    expect(r.eligible).toBe(true);
    expect(r.crystallized).toBeDefined();
  });

  it("ineligible when cycles below min", () => {
    const r = crystallizeIfEligible({ ...baseInput, cyclesCompleted: 1 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("cycles");
    expect(r.crystallized).toBeUndefined();
  });

  it("ineligible when files below min", () => {
    const r = crystallizeIfEligible({ ...baseInput, filesChanged: 0 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("files");
  });

  it("ineligible when score below min", () => {
    const r = crystallizeIfEligible({ ...baseInput, score: 0.5 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("score");
  });

  it("score ignored when undefined", () => {
    const { score, ...noScore } = baseInput;
    const r = crystallizeIfEligible(noScore);
    expect(r.eligible).toBe(true);
  });

  it("custom eligibility thresholds", () => {
    const r = crystallizeIfEligible(
      { ...baseInput, cyclesCompleted: 10 },
      { minCycles: 20 },
    );
    expect(r.eligible).toBe(false);
  });
});

describe("prependRequiredReading", () => {
  it("prepends block before prompt", () => {
    const out = prependRequiredReading("System prompt", "READING BLOCK");
    expect(out.indexOf("READING BLOCK")).toBeLessThan(out.indexOf("System prompt"));
  });

  it("returns prompt unchanged when block is empty", () => {
    expect(prependRequiredReading("prompt", "")).toBe("prompt");
    expect(prependRequiredReading("prompt", "   ")).toBe("prompt");
  });

  it("returns block when prompt is empty", () => {
    expect(prependRequiredReading("", "BLOCK")).toBe("BLOCK");
  });

  it("includes separator between block and prompt", () => {
    const out = prependRequiredReading("prompt", "BLOCK");
    expect(out).toContain("---");
  });
});
