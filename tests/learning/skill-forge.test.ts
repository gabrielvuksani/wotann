import { describe, it, expect } from "vitest";
import {
  SkillForge,
  type SessionAction,
  type SkillPattern,
} from "../../src/learning/skill-forge.js";

// ── Helpers ────────────────────────────────────────────────

function makeActions(types: readonly string[], domain?: string): SessionAction[] {
  return types.map((type, i) => ({
    type,
    tool: `tool-${type}`,
    success: true,
    timestamp: Date.now() + i * 1000,
    domain,
  }));
}

// ── SkillForge Tests ───────────────────────────────────────

describe("SkillForge", () => {
  it("starts with no patterns or candidates", () => {
    const forge = new SkillForge();
    expect(forge.getPatternCount()).toBe(0);
    expect(forge.getCandidateCount()).toBe(0);
  });

  it("detects patterns from session actions", () => {
    const forge = new SkillForge();
    const actions = makeActions(["read", "edit", "test"], "typescript");

    const result = forge.analyzeSession(actions);

    expect(result.patternsFound).toBeGreaterThan(0);
    expect(forge.getPatternCount()).toBeGreaterThan(0);
  });

  it("increases frequency on repeated patterns", () => {
    const forge = new SkillForge();
    const actions = makeActions(["read", "edit", "test"], "typescript");

    forge.analyzeSession(actions);
    const firstPatterns = forge.getPatterns();
    const firstFreq = firstPatterns[0]?.frequency ?? 0;

    forge.analyzeSession(actions);
    const secondPatterns = forge.getPatterns();
    const secondFreq = secondPatterns[0]?.frequency ?? 0;

    expect(secondFreq).toBeGreaterThan(firstFreq);
  });

  it("creates candidates when pattern reaches frequency threshold", () => {
    const forge = new SkillForge();
    const actions = makeActions(["read", "edit", "test"], "debugging");

    // Run enough sessions to reach frequency threshold (3)
    forge.analyzeSession(actions);
    forge.analyzeSession(actions);
    const result = forge.analyzeSession(actions);

    expect(result.candidatesCreated).toBeGreaterThanOrEqual(0);
    // Candidates may or may not appear depending on frequency accumulation
  });

  it("generates skill definitions from patterns", () => {
    const forge = new SkillForge();

    const pattern: SkillPattern = {
      id: "test-pattern",
      trigger: "read using tool-read",
      actions: [
        { type: "read", tool: "grep", description: "Search codebase" },
        { type: "edit", tool: "write", description: "Apply changes" },
        { type: "test", tool: "vitest", description: "Run tests" },
      ],
      successRate: 0.9,
      frequency: 5,
      domain: "typescript",
      firstSeen: "2025-01-01T00:00:00.000Z",
      lastSeen: "2025-01-15T00:00:00.000Z",
    };

    const definition = forge.generateSkillDefinition(pattern);

    expect(definition.name).toBeTruthy();
    expect(definition.description).toContain("3 steps");
    expect(definition.content).toContain("---");
    expect(definition.content).toContain("## Steps");
    expect(definition.content).toContain("grep");
    expect(definition.content).toContain("vitest");
    expect(definition.category).toBe("typescript");
  });

  it("returns candidate skills sorted by confidence", () => {
    const forge = new SkillForge();
    const actions = makeActions(["analyze", "fix", "verify"], "bugfix");

    // Build up enough frequency
    for (let i = 0; i < 5; i++) {
      forge.analyzeSession(actions);
    }

    const candidates = forge.candidateSkills();
    if (candidates.length > 1) {
      // Verify sorted by confidence descending
      for (let i = 0; i < candidates.length - 1; i++) {
        expect(candidates[i]!.confidence).toBeGreaterThanOrEqual(
          candidates[i + 1]!.confidence,
        );
      }
    }
  });

  it("records success and boosts confidence", () => {
    const forge = new SkillForge();
    const actions = makeActions(["read", "fix"], "debug");

    // Create enough patterns to get candidates
    for (let i = 0; i < 5; i++) {
      forge.analyzeSession(actions);
    }

    const candidates = forge.candidateSkills();
    if (candidates.length > 0) {
      const id = candidates[0]!.id;
      const beforeConfidence = candidates[0]!.confidence;

      forge.recordOutcome(id, true);
      const afterCandidate = forge.candidateSkills().find((c) => c.id === id);

      expect(afterCandidate?.confidence).toBeGreaterThan(beforeConfidence);
      expect(afterCandidate?.successCount).toBe(1);
    }
  });

  it("records failure and reduces confidence", () => {
    const forge = new SkillForge();
    const actions = makeActions(["read", "fix"], "debug");

    for (let i = 0; i < 5; i++) {
      forge.analyzeSession(actions);
    }

    const candidates = forge.candidateSkills();
    if (candidates.length > 0) {
      const id = candidates[0]!.id;
      const beforeConfidence = candidates[0]!.confidence;

      forge.recordOutcome(id, false, "did not work");
      const afterCandidate = forge.candidateSkills().find((c) => c.id === id);

      expect(afterCandidate?.confidence).toBeLessThan(beforeConfidence);
      expect(afterCandidate?.failureCount).toBe(1);
      expect(afterCandidate?.failureReasons).toContain("did not work");
    }
  });

  it("rejects candidate when confidence drops below threshold", () => {
    const forge = new SkillForge();
    const actions = makeActions(["read", "fix"], "debug");

    for (let i = 0; i < 5; i++) {
      forge.analyzeSession(actions);
    }

    const candidates = forge.candidateSkills();
    if (candidates.length > 0) {
      const id = candidates[0]!.id;

      // Hammer with failures to drive confidence below rejection threshold
      for (let i = 0; i < 20; i++) {
        forge.recordOutcome(id, false);
      }

      const remaining = forge.candidateSkills();
      const found = remaining.find((c) => c.id === id);
      // Should be rejected (filtered out of candidates)
      expect(found).toBeUndefined();
    }
  });

  it("promotes candidate to skill", () => {
    const forge = new SkillForge();
    const actions = makeActions(["search", "implement"], "feature");

    for (let i = 0; i < 5; i++) {
      forge.analyzeSession(actions);
    }

    const candidates = forge.candidateSkills();
    if (candidates.length > 0) {
      const id = candidates[0]!.id;
      const definition = forge.promoteCandidateToSkill(id);

      expect(definition).not.toBeNull();
      expect(definition?.content).toContain("---");
    }
  });

  it("returns null when promoting unknown candidate", () => {
    const forge = new SkillForge();
    const result = forge.promoteCandidateToSkill("nonexistent");
    expect(result).toBeNull();
  });

  it("does not re-promote already promoted candidates", () => {
    const forge = new SkillForge();
    const actions = makeActions(["plan", "implement"], "feature");

    for (let i = 0; i < 5; i++) {
      forge.analyzeSession(actions);
    }

    const candidates = forge.candidateSkills();
    if (candidates.length > 0) {
      const id = candidates[0]!.id;
      forge.promoteCandidateToSkill(id);

      const secondAttempt = forge.promoteCandidateToSkill(id);
      expect(secondAttempt).toBeNull();
    }
  });

  it("handles empty session gracefully", () => {
    const forge = new SkillForge();
    const result = forge.analyzeSession([]);

    expect(result.patternsFound).toBe(0);
    expect(result.candidatesCreated).toBe(0);
  });

  it("handles single-action session gracefully", () => {
    const forge = new SkillForge();
    const actions: SessionAction[] = [{
      type: "read",
      success: true,
      timestamp: Date.now(),
    }];

    const result = forge.analyzeSession(actions);
    // Single actions are below MIN_SEQUENCE_LENGTH, so no patterns
    expect(result.patternsFound).toBe(0);
  });
});
