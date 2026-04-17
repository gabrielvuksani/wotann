import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import {
  crystallizeSuccess,
  redactPrompt,
  slugifyPrompt,
} from "../../src/skills/self-crystallization.js";
import { parseAgentSkillFile } from "../../src/skills/skill-standard.js";

describe("self-crystallization — auto-skill-from-success", () => {
  it("slugifies prompts into filename-safe kebab-case", () => {
    expect(slugifyPrompt("Fix the authentication bug")).toMatch(/^fix-authentication-bug/);
    expect(slugifyPrompt("   ")).toMatch(/^auto-/);
  });

  it("redacts likely secrets from prompts", () => {
    const redacted = redactPrompt("my key is sk-abc123XYZ456defGHI789jklMNO");
    expect(redacted).not.toMatch(/sk-abc/);
    expect(redacted).toContain("<redacted-api-key>");
  });

  it("redacts GitHub tokens", () => {
    const redacted = redactPrompt("use ghp_abc123XYZ456defGHI789jklMNO42");
    expect(redacted).not.toMatch(/ghp_abc/);
    expect(redacted).toContain("<redacted-gh-token>");
  });

  it("produces a validated AgentSkill shape on dryRun", () => {
    const result = crystallizeSuccess({
      prompt: "add rate limiting to the API endpoints",
      toolCalls: ["read_file", "edit_file", "run_tests"],
      diffSummary: "2 files, +45 -0",
      dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(result.problems).toEqual([]);
    expect(result.skill.name).toMatch(/^add-rate-limiting/);
    expect(result.skill.tier).toBe("experimental");
    expect(result.skill.triggers?.length).toBeGreaterThan(0);
    expect(result.skill.body).toContain("read_file → edit_file → run_tests");
    expect(result.skill.body).toContain("2 files, +45 -0");
  });

  it("writes to disk and roundtrips back through the parser", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wotann-xstal-"));
    const result = crystallizeSuccess({
      prompt: "improve the error handling",
      toolCalls: ["grep", "edit_file"],
      diffSummary: "3 files touched",
      outputDir: tmp,
    });
    expect(result.written).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    const content = readFileSync(result.path, "utf-8");
    const parsed = parseAgentSkillFile(content, result.path);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe(result.skill.name);
    expect(parsed!.tier).toBe("experimental");
    expect(parsed!.body.length).toBeGreaterThan(0);
  });

  it("never includes an unredacted API key", () => {
    const tmp = mkdtempSync(join(tmpdir(), "wotann-xstal-"));
    const result = crystallizeSuccess({
      prompt: "use my token sk-real_secret_abcdefghijklmnopqrstuvwxyz",
      toolCalls: ["read_file"],
      diffSummary: "0 files",
      outputDir: tmp,
    });
    const content = readFileSync(result.path, "utf-8");
    expect(content).not.toContain("sk-real_secret");
    expect(content).toContain("<redacted-api-key>");
  });
});
