import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession } from "../../src/core/session.js";
import { StreamCheckpointStore, buildResumeQuery } from "../../src/core/stream-resume.js";

describe("Stream resume", () => {
  it("builds a resume query from an interrupted checkpoint", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-stream-resume-"));

    try {
      mkdirSync(join(tempDir, ".wotann"), { recursive: true });
      const store = new StreamCheckpointStore(join(tempDir, ".wotann", "streams"));
      const session = createSession("anthropic", "claude-sonnet-4-6");
      const checkpoint = store.start({
        prompt: "Explain the architecture",
        systemPrompt: "Be concise.",
      }, session);

      store.appendText(checkpoint.id, "WOTANN uses ");
      store.markInterrupted(checkpoint.id, "ssh-timeout");

      const interrupted = store.getLatestInterrupted();
      expect(interrupted?.lastError).toBe("ssh-timeout");

      const resume = buildResumeQuery(interrupted!);
      expect(resume.prompt).toBe("Explain the architecture");
      expect(resume.systemPrompt).toContain("Resume an interrupted assistant response.");
      expect(resume.systemPrompt).toContain("WOTANN uses ");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
