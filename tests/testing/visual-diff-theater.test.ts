import { describe, it, expect, beforeEach } from "vitest";
import { VisualDiffTheater } from "../../src/testing/visual-diff-theater.js";
import type { FileChange } from "../../src/testing/visual-diff-theater.js";

describe("VisualDiffTheater", () => {
  let theater: VisualDiffTheater;

  beforeEach(() => {
    theater = new VisualDiffTheater();
  });

  const sampleChange: FileChange = {
    filePath: "src/auth.ts",
    oldContent: [
      "function login(user: string) {",
      "  return false;",
      "}",
    ].join("\n"),
    newContent: [
      "function login(user: string) {",
      "  return validateUser(user);",
      "}",
    ].join("\n"),
  };

  describe("createSession", () => {
    it("creates a session with hunks", () => {
      const session = theater.createSession([sampleChange]);
      expect(session.id).toMatch(/^ds_/);
      expect(session.files).toContain("src/auth.ts");
      expect(session.hunks.length).toBeGreaterThanOrEqual(1);
      expect(session.status).toBe("active");
    });

    it("handles multiple file changes", () => {
      const changes: FileChange[] = [
        sampleChange,
        {
          filePath: "src/utils.ts",
          oldContent: "export const VERSION = '1.0';",
          newContent: "export const VERSION = '2.0';",
        },
      ];

      const session = theater.createSession(changes);
      expect(session.files).toHaveLength(2);
    });

    it("creates no hunks for identical content", () => {
      const noChange: FileChange = {
        filePath: "src/same.ts",
        oldContent: "const x = 1;",
        newContent: "const x = 1;",
      };

      const session = theater.createSession([noChange]);
      expect(session.hunks).toHaveLength(0);
    });
  });

  describe("getHunks", () => {
    it("returns hunks for a specific file", () => {
      const session = theater.createSession([sampleChange]);
      const hunks = theater.getHunks(session.id, "src/auth.ts");
      expect(hunks.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty for unknown file", () => {
      const session = theater.createSession([sampleChange]);
      const hunks = theater.getHunks(session.id, "nonexistent.ts");
      expect(hunks).toHaveLength(0);
    });

    it("returns empty for unknown session", () => {
      const hunks = theater.getHunks("nonexistent", "src/auth.ts");
      expect(hunks).toHaveLength(0);
    });
  });

  describe("accept/reject individual hunks", () => {
    it("accepts a hunk", () => {
      const session = theater.createSession([sampleChange]);
      const hunks = theater.getAllHunks(session.id);
      expect(hunks[0]?.status).toBe("pending");

      theater.acceptHunk(session.id, hunks[0]!.id);
      const updated = theater.getAllHunks(session.id);
      expect(updated[0]?.status).toBe("accepted");
    });

    it("rejects a hunk", () => {
      const session = theater.createSession([sampleChange]);
      const hunks = theater.getAllHunks(session.id);

      theater.rejectHunk(session.id, hunks[0]!.id);
      const updated = theater.getAllHunks(session.id);
      expect(updated[0]?.status).toBe("rejected");
    });
  });

  describe("acceptAll / rejectAll", () => {
    it("accepts all pending hunks", () => {
      const changes: FileChange[] = [
        sampleChange,
        { filePath: "b.ts", oldContent: "old", newContent: "new" },
      ];
      const session = theater.createSession(changes);

      theater.acceptAll(session.id);
      const hunks = theater.getAllHunks(session.id);
      expect(hunks.every((h) => h.status === "accepted")).toBe(true);
    });

    it("rejects all pending hunks", () => {
      const session = theater.createSession([sampleChange]);

      theater.rejectAll(session.id);
      const hunks = theater.getAllHunks(session.id);
      expect(hunks.every((h) => h.status === "rejected")).toBe(true);
    });

    it("does not change already-accepted hunks when rejecting all", () => {
      const session = theater.createSession([sampleChange]);
      const hunks = theater.getAllHunks(session.id);

      theater.acceptHunk(session.id, hunks[0]!.id);
      theater.rejectAll(session.id);

      const updated = theater.getAllHunks(session.id);
      expect(updated[0]?.status).toBe("accepted"); // Already accepted, not overwritten
    });
  });

  describe("applyAccepted", () => {
    it("applies accepted hunks and produces result content", () => {
      const session = theater.createSession([sampleChange]);
      theater.acceptAll(session.id);

      const result = theater.applyAccepted(session.id);
      expect(result.appliedHunks).toBeGreaterThanOrEqual(1);
      expect(result.filesAffected).toContain("src/auth.ts");

      const content = result.resultContent.get("src/auth.ts");
      expect(content).toContain("validateUser");
    });

    it("keeps old content when all hunks rejected", () => {
      const session = theater.createSession([sampleChange]);
      theater.rejectAll(session.id);

      const result = theater.applyAccepted(session.id);
      expect(result.appliedHunks).toBe(0);

      const content = result.resultContent.get("src/auth.ts");
      expect(content).toContain("return false");
    });

    it("returns empty result for unknown session", () => {
      const result = theater.applyAccepted("nonexistent");
      expect(result.appliedHunks).toBe(0);
    });
  });

  describe("renderDiff", () => {
    it("produces formatted diff output", () => {
      const session = theater.createSession([sampleChange]);
      const output = theater.renderDiff(session.id);

      expect(output).toContain("=== Diff Session");
      expect(output).toContain("--- src/auth.ts");
      expect(output).toContain("+++ src/auth.ts");
      expect(output).toContain("[PENDING]");
    });

    it("shows accepted/rejected status", () => {
      const session = theater.createSession([sampleChange]);
      const hunks = theater.getAllHunks(session.id);
      theater.acceptHunk(session.id, hunks[0]!.id);

      const output = theater.renderDiff(session.id);
      expect(output).toContain("[ACCEPTED]");
    });

    it("returns error for unknown session", () => {
      const output = theater.renderDiff("nonexistent");
      expect(output).toContain("not found");
    });
  });

  describe("getSession / discardSession", () => {
    it("retrieves a session by ID", () => {
      const session = theater.createSession([sampleChange]);
      const retrieved = theater.getSession(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(session.id);
    });

    it("returns null for unknown session", () => {
      expect(theater.getSession("nope")).toBeNull();
    });

    it("discards a session", () => {
      const session = theater.createSession([sampleChange]);
      theater.discardSession(session.id);

      const retrieved = theater.getSession(session.id);
      expect(retrieved!.status).toBe("discarded");
    });
  });
});
