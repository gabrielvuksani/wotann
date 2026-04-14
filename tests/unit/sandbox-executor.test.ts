import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSeatbeltProfile, runSandboxedCommandSync } from "../../src/sandbox/executor.js";

describe("sandbox executor", () => {
  it("builds a Seatbelt profile with workspace-scoped writes", () => {
    const profile = buildSeatbeltProfile({
      allowNetwork: false,
      writePaths: ["/tmp/workspace"],
    });

    expect(profile).toContain('(subpath "/tmp/workspace")');
    expect(profile).not.toContain("(allow network*)");
  });

  it("runs a safe command successfully", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-sandbox-"));

    try {
      const result = runSandboxedCommandSync(process.execPath, [
        "-e",
        "process.stdout.write('ok')",
      ], {
        workingDir: tempDir,
        timeoutMs: 10_000,
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("ok");
      expect(result.command).toEqual([process.execPath, "-e", "process.stdout.write('ok')"]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks writes outside the workspace when Seatbelt is enforced", () => {
    if (
      process.platform !== "darwin"
      || !existsSync("/usr/bin/sandbox-exec")
      || process.env["WOTANN_SANDBOX_ACTIVE"] === "1"
    ) {
      return;
    }

    const tempDir = mkdtempSync(join(tmpdir(), "wotann-seatbelt-workspace-"));
    const outsidePath = join(tmpdir(), `wotann-seatbelt-outside-${Date.now()}.txt`);

    try {
      const script = [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(outsidePath)}, 'blocked');`,
        "process.stdout.write('wrote');",
      ].join("");
      const result = runSandboxedCommandSync(process.execPath, ["-e", script], {
        workingDir: tempDir,
        timeoutMs: 10_000,
      });

      expect(result.enforced).toBe(true);
      expect(result.success).toBe(false);
      expect(existsSync(outsidePath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(outsidePath, { force: true });
    }
  });

  it("allows writes inside the workspace", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-sandbox-write-"));
    const outputPath = join(tempDir, "allowed.txt");

    try {
      const script = [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(outputPath)}, 'ok');`,
        "process.stdout.write('done');",
      ].join("");
      const result = runSandboxedCommandSync(process.execPath, ["-e", script], {
        workingDir: tempDir,
        timeoutMs: 10_000,
      });

      expect(result.success).toBe(true);
      expect(readFileSync(outputPath, "utf-8")).toBe("ok");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
