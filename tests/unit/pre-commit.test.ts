import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPreCommitAnalysis } from "../../src/verification/pre-commit.js";

describe("pre-commit analysis", () => {
  it("detects and runs available package scripts", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-precommit-"));

    try {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({
        name: "demo",
        scripts: {
          typecheck: "node -e \"process.exit(0)\"",
          test: "node -e \"process.exit(0)\"",
        },
      }, null, 2));

      const result = runPreCommitAnalysis(tempDir, 10_000);
      expect(result.checks.map((check) => check.name)).toEqual(["typecheck", "test"]);
      expect(result.checks.every((check) => typeof check.sandboxEnforced === "boolean")).toBe(true);
      expect(result.checks.every((check) => typeof check.sandbox === "string")).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
