import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession } from "../../src/core/session.js";
import { StreamCheckpointStore, buildResumeQuery } from "../../src/core/stream-resume.js";
import { getTierModel } from "../_helpers/model-tier.js";

// PROVIDER-AGNOSTIC: session model is checkpoint metadata; the test
// asserts on resume-query construction and lastError, not the model.
const STREAM_TIER = getTierModel("balanced");

describe("Stream resume", () => {
  it("builds a resume query from an interrupted checkpoint", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-stream-resume-"));

    try {
      mkdirSync(join(tempDir, ".wotann"), { recursive: true });
      const store = new StreamCheckpointStore(join(tempDir, ".wotann", "streams"));
      const session = createSession(STREAM_TIER.provider, STREAM_TIER.model);
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
