import { describe, it, expect } from "vitest";
import {
  mineNGrams,
  PatternDetector,
  type ToolCall,
} from "../../src/intelligence/tool-pattern-detector.js";

function call(name: string, at: number): ToolCall {
  return { toolName: name, at };
}

describe("mineNGrams", () => {
  it("counts 2-grams", () => {
    const history = [
      call("Read", 0),
      call("Edit", 10),
      call("Read", 20),
      call("Edit", 30),
    ];
    const grams = mineNGrams(history, 2);
    const readEdit = grams.get("Read→Edit");
    expect(readEdit?.count).toBe(2);
  });

  it("returns empty when history too short for n", () => {
    expect(mineNGrams([call("a", 0)], 5).size).toBe(0);
  });

  it("counts 3-grams", () => {
    const history = [
      call("a", 0),
      call("b", 1),
      call("c", 2),
      call("a", 3),
      call("b", 4),
      call("c", 5),
    ];
    const grams = mineNGrams(history, 3);
    const abc = grams.get("a→b→c");
    expect(abc?.count).toBe(2);
  });
});

describe("PatternDetector", () => {
  it("records tool calls", () => {
    const d = new PatternDetector();
    d.record({ toolName: "Read" });
    d.record({ toolName: "Edit" });
    expect(d.getHistory()).toHaveLength(2);
  });

  it("caps history at maxHistory", () => {
    const d = new PatternDetector({ maxHistory: 3 });
    for (let i = 0; i < 10; i++) d.record({ toolName: "T" });
    expect(d.getHistory()).toHaveLength(3);
  });

  it("suggestShortcuts ranks by estimated saving", () => {
    const d = new PatternDetector();
    // Common pattern: Read → Edit → Bash, 5 times
    for (let i = 0; i < 5; i++) {
      d.record({ toolName: "Read", at: i * 100 });
      d.record({ toolName: "Edit", at: i * 100 + 50 });
      d.record({ toolName: "Bash", at: i * 100 + 100 });
    }
    const suggestions = d.suggestShortcuts({ minOccurrences: 3, minN: 2, maxN: 3 });
    expect(suggestions.length).toBeGreaterThan(0);
    // The 3-gram "Read→Edit→Bash" or 2-gram should surface
    const found = suggestions.some(
      (s) => s.pattern.sequence.join("→") === "Read→Edit→Bash",
    );
    expect(found).toBe(true);
  });

  it("suggestShortcuts respects minOccurrences", () => {
    const d = new PatternDetector();
    d.record({ toolName: "A" });
    d.record({ toolName: "B" });
    const suggestions = d.suggestShortcuts({ minOccurrences: 5 });
    expect(suggestions).toEqual([]);
  });

  it("uniqueToolCount counts distinct", () => {
    const d = new PatternDetector();
    d.record({ toolName: "Read" });
    d.record({ toolName: "Read" });
    d.record({ toolName: "Edit" });
    expect(d.uniqueToolCount()).toBe(2);
  });

  it("topTools ranks by frequency", () => {
    const d = new PatternDetector();
    for (let i = 0; i < 5; i++) d.record({ toolName: "Read" });
    for (let i = 0; i < 3; i++) d.record({ toolName: "Edit" });
    d.record({ toolName: "Bash" });
    const top = d.topTools();
    expect(top[0]?.name).toBe("Read");
    expect(top[0]?.count).toBe(5);
    expect(top[1]?.name).toBe("Edit");
  });

  it("clear empties history", () => {
    const d = new PatternDetector();
    d.record({ toolName: "x" });
    d.clear();
    expect(d.getHistory()).toEqual([]);
  });
});
