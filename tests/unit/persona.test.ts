import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PersonaManager, loadIdentity, type PersonaConfig } from "../../src/identity/persona.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("Persona System", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wotann-persona-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(join(testDir, "personas"), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true }); } catch { /* ok */ }
  });

  describe("PersonaManager", () => {
    it("loads personas from YAML files", () => {
      writeFileSync(join(testDir, "personas", "architect.yaml"), [
        "name: Architect",
        "description: Thinks in systems",
        "priorities:",
        "  - scalability",
        "  - maintainability",
        "communication:",
        "  - concise",
        "  - visual",
      ].join("\n"));

      const manager = new PersonaManager(testDir);
      expect(manager.getCount()).toBe(1);
      expect(manager.list()).toContain("architect");
    });

    it("returns null for missing personas", () => {
      const manager = new PersonaManager(testDir);
      expect(manager.get("nonexistent")).toBeNull();
    });

    it("lists loaded persona names", () => {
      writeFileSync(join(testDir, "personas", "fast.yaml"), "name: Fast\ndescription: Speed\npriorities: [speed]\ncommunication: [brief]");
      writeFileSync(join(testDir, "personas", "deep.yaml"), "name: Deep\ndescription: Depth\npriorities: [accuracy]\ncommunication: [detailed]");

      const manager = new PersonaManager(testDir);
      const names = manager.list();
      expect(names.length).toBe(2);
      expect(names).toContain("fast");
      expect(names).toContain("deep");
    });

    it("formats persona for prompt injection", () => {
      const persona: PersonaConfig = {
        name: "Reviewer",
        description: "Reviews code for quality",
        priorities: ["correctness", "readability"],
        communication: ["structured", "evidence-based"],
        decisionFramework: "RACI",
        avoidPatterns: ["nitpicking style"],
      };

      const manager = new PersonaManager(testDir);
      const formatted = manager.formatForPrompt(persona);
      expect(formatted).toContain("Reviewer");
      expect(formatted).toContain("correctness");
      expect(formatted).toContain("RACI");
      expect(formatted).toContain("nitpicking");
    });

    it("handles missing personas directory gracefully", () => {
      const manager = new PersonaManager("/nonexistent/path");
      expect(manager.getCount()).toBe(0);
    });
  });

  describe("loadIdentity", () => {
    it("returns defaults when no files exist", () => {
      const emptyDir = join(testDir, "empty");
      mkdirSync(emptyDir);
      const identity = loadIdentity(emptyDir);
      expect(identity.name).toBe("Nexus");
      expect(identity.role).toBe("AI Agent");
      expect(identity.soul).toBe("");
    });

    it("reads name from IDENTITY.md", () => {
      writeFileSync(join(testDir, "IDENTITY.md"), "## Name\nMyAgent\n\n## Role\nCoding Assistant");
      const identity = loadIdentity(testDir);
      expect(identity.name).toBe("MyAgent");
      expect(identity.role).toBe("Coding Assistant");
    });

    it("reads soul from SOUL.md", () => {
      writeFileSync(join(testDir, "SOUL.md"), "You are a helpful coding agent.");
      const identity = loadIdentity(testDir);
      expect(identity.soul).toContain("helpful");
    });
  });
});
