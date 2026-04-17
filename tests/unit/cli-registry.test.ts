/**
 * C32 — CLI auto-detect registry tests.
 */

import { describe, it, expect } from "vitest";
import {
  KNOWN_AGENT_CLIS,
  detectInstalledAgentCLIs,
  groupByCategory,
  renderCLIRegistry,
} from "../../src/providers/cli-registry.js";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function mkFakeBinaryDir(binaries: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wotann-cliregistry-"));
  for (const name of binaries) {
    const path = join(dir, name);
    writeFileSync(path, "#!/bin/sh\necho fake\n", "utf-8");
    chmodSync(path, 0o755);
  }
  return dir;
}

describe("KNOWN_AGENT_CLIS seed list", () => {
  it("has at least 20 entries", () => {
    expect(KNOWN_AGENT_CLIS.length).toBeGreaterThanOrEqual(20);
  });

  it("all entries have a binary, label, category, and homepage", () => {
    for (const cli of KNOWN_AGENT_CLIS) {
      expect(cli.binary.length).toBeGreaterThan(0);
      expect(cli.label.length).toBeGreaterThan(0);
      expect(cli.homepage).toMatch(/^https?:\/\//);
      expect(["agent", "assist", "ide-cli", "editor", "runtime"]).toContain(cli.category);
    }
  });

  it("binary names are unique", () => {
    const names = KNOWN_AGENT_CLIS.map((c) => c.binary);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes the core four (claude, codex, aider, wotann)", () => {
    const names = KNOWN_AGENT_CLIS.map((c) => c.binary);
    expect(names).toContain("claude");
    expect(names).toContain("codex");
    expect(names).toContain("aider");
    expect(names).toContain("wotann");
  });
});

describe("detectInstalledAgentCLIs", () => {
  it("returns empty when nothing on PATH matches", () => {
    const detected = detectInstalledAgentCLIs({ path: "/nowhere-real" });
    expect(detected).toEqual([]);
  });

  it("finds seeded binaries placed on the injected PATH", () => {
    const dir = mkFakeBinaryDir(["claude", "aider", "ollama"]);
    const detected = detectInstalledAgentCLIs({ path: dir, platform: "linux" });
    const binaries = detected.map((d) => d.binary);
    expect(binaries).toContain("claude");
    expect(binaries).toContain("aider");
    expect(binaries).toContain("ollama");
  });

  it("returns resolved absolute paths", () => {
    const dir = mkFakeBinaryDir(["claude"]);
    const detected = detectInstalledAgentCLIs({ path: dir, platform: "linux" });
    expect(detected[0]?.path).toBe(join(dir, "claude"));
  });

  it("does not capture version unless requested", () => {
    const dir = mkFakeBinaryDir(["claude"]);
    const detected = detectInstalledAgentCLIs({ path: dir, platform: "linux" });
    expect(detected[0]?.version).toBeUndefined();
  });

  it("does not crash when one binary is non-executable", () => {
    const dir = mkdtempSync(join(tmpdir(), "wotann-cliregistry-nonexec-"));
    writeFileSync(join(dir, "aider"), "not executable", "utf-8");
    // No chmod — access(X_OK) will fail, so aider should NOT be detected.
    const detected = detectInstalledAgentCLIs({ path: dir, platform: "linux" });
    expect(detected.find((d) => d.binary === "aider")).toBeUndefined();
  });
});

describe("groupByCategory", () => {
  it("puts entries in their declared buckets", () => {
    const dir = mkFakeBinaryDir(["claude", "cursor", "ollama", "tabby"]);
    const detected = detectInstalledAgentCLIs({ path: dir, platform: "linux" });
    const grouped = groupByCategory(detected);
    expect(grouped.agent.find((c) => c.binary === "claude")).toBeDefined();
    expect(grouped["ide-cli"].find((c) => c.binary === "cursor")).toBeDefined();
    expect(grouped.runtime.find((c) => c.binary === "ollama")).toBeDefined();
    expect(grouped.assist.find((c) => c.binary === "tabby")).toBeDefined();
  });
});

describe("renderCLIRegistry", () => {
  it('returns "no known CLIs" message when empty', () => {
    expect(renderCLIRegistry([])).toMatch(/No known agent CLIs/);
  });

  it("groups under category headers", () => {
    const dir = mkFakeBinaryDir(["claude", "cursor", "ollama"]);
    const detected = detectInstalledAgentCLIs({ path: dir, platform: "linux" });
    const rendered = renderCLIRegistry(detected);
    expect(rendered).toMatch(/## Agents/);
    expect(rendered).toMatch(/## IDE CLIs/);
    expect(rendered).toMatch(/## Runtimes/);
    expect(rendered).toMatch(/claude/);
  });
});
