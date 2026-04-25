import { describe, it, expect } from "vitest";
import { summarizeForSleep } from "../../src/context/sleep-summarizer.js";

const fixedClock = () => 1000;

describe("summarizeForSleep", () => {
  it("rejects missing options", () => {
    // @ts-expect-error — invalid input
    expect(summarizeForSleep(null).ok).toBe(false);
  });

  it("rejects empty entries", () => {
    const r = summarizeForSleep({ entries: [], now: fixedClock });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/non-empty/);
  });

  it("emits a summary block for valid input", () => {
    const r = summarizeForSleep({
      entries: [
        { id: "e1", timestamp: 1, source: "memory", content: "User prefers Pacific time" },
        { id: "e2", timestamp: 2, source: "memory", content: "Project uses Postgres" },
      ],
      targetTokens: 100,
      now: fixedClock,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.outputCount).toBe(2);
    expect(r.block.summary).toContain("Pacific time");
    expect(r.block.summary).toContain("Postgres");
    expect(r.block.producedAt).toBe(1000);
  });

  it("dedupes near-duplicate entries", () => {
    const text = "User prefers Pacific time and works mostly in TypeScript projects";
    const r = summarizeForSleep({
      entries: [
        { id: "a", timestamp: 1, source: "memory", content: text },
        { id: "b", timestamp: 2, source: "memory", content: text },
        { id: "c", timestamp: 3, source: "memory", content: text },
      ],
      targetTokens: 200,
      now: fixedClock,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.droppedAsDuplicate).toBe(2);
    expect(r.block.outputCount).toBe(1);
  });

  it("keeps the higher-weight duplicate", () => {
    const text = "WOTANN routes through provider router with rate-limit awareness";
    const r = summarizeForSleep({
      entries: [
        { id: "low", timestamp: 1, source: "low-source", content: text, weight: 0.5 },
        { id: "high", timestamp: 2, source: "high-source", content: text, weight: 2.0 },
      ],
      now: fixedClock,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.outputCount).toBe(1);
    expect(r.block.summary).toContain("high-source");
  });

  it("truncates at the token budget", () => {
    // Three distinct long texts (so dedupe doesn't collapse them) at
    // ≈ 50 tokens each. With targetTokens=60 only the first fits.
    const r = summarizeForSleep({
      entries: [
        { id: "1", timestamp: 1, source: "x", content: "alpha " + "a".repeat(195) },
        { id: "2", timestamp: 2, source: "x", content: "bravo " + "b".repeat(195) },
        { id: "3", timestamp: 3, source: "x", content: "charlie " + "c".repeat(193) },
      ],
      targetTokens: 60,
      now: fixedClock,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.truncatedToFitBudget).toBe(true);
    expect(r.block.outputCount).toBeLessThan(3);
  });

  it("respects maxEntries (drops oldest)", () => {
    const r = summarizeForSleep({
      entries: Array.from({ length: 10 }, (_, i) => ({
        id: `e${i}`,
        timestamp: i,
        source: "x",
        content: `entry ${i} content`,
      })),
      maxEntries: 3,
      targetTokens: 1000,
      now: fixedClock,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.block.outputCount).toBeLessThanOrEqual(3);
    // Older entries dropped — should not see entry 0/1/.../6 in summary.
    expect(r.block.summary).not.toContain("entry 0 content");
    expect(r.block.summary).toContain("entry 9 content");
  });

  it("rejects invalid token budget", () => {
    const r = summarizeForSleep({
      entries: [{ id: "x", timestamp: 1, source: "y", content: "hello" }],
      targetTokens: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects out-of-range dedupeThreshold", () => {
    const r = summarizeForSleep({
      entries: [{ id: "x", timestamp: 1, source: "y", content: "hello" }],
      dedupeThreshold: 1.5,
    });
    expect(r.ok).toBe(false);
  });
});
