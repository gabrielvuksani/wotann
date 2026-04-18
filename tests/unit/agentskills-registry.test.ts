import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanAgentSkillsDirectory,
  buildManifest,
  exportToAgentSkills,
  importAgentSkillFile,
  AGENTSKILLS_MANIFEST_VERSION,
  AGENTSKILLS_MANIFEST_FILENAME,
} from "../../src/skills/agentskills-registry.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00Z");

function writeSkill(dir: string, filename: string, frontmatter: string, body: string): string {
  const path = join(dir, filename);
  writeFileSync(path, `---\n${frontmatter}\n---\n${body}\n`, "utf8");
  return path;
}

describe("agentskills-registry — directory scan + manifest", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "agentskills-"));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("scans a flat-markdown skills directory and parses entries", () => {
    writeSkill(tmpRoot, "alpha.md", "name: alpha\ndescription: first skill\nversion: 1.0.0", "body-alpha");
    writeSkill(tmpRoot, "beta.md", "name: beta\ndescription: second skill", "body-beta");
    const { records, errors } = scanAgentSkillsDirectory(tmpRoot);
    expect(errors).toHaveLength(0);
    expect(records.map((r) => r.skill.name)).toEqual(["alpha", "beta"]);
  });

  it("scans a directory-style (`<name>/SKILL.md`) layout", () => {
    const subdir = join(tmpRoot, "gamma");
    mkdirSync(subdir);
    writeSkill(subdir, "SKILL.md", "name: gamma\ndescription: nested skill", "nested-body");
    const { records, errors } = scanAgentSkillsDirectory(tmpRoot);
    expect(errors).toHaveLength(0);
    expect(records).toHaveLength(1);
    expect(records[0]!.skill.name).toBe("gamma");
  });

  it("records problems for malformed frontmatter", () => {
    writeFileSync(join(tmpRoot, "bad.md"), "no frontmatter here\n", "utf8");
    const { records, errors } = scanAgentSkillsDirectory(tmpRoot);
    expect(records).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("records problems for failed validation (short description)", () => {
    writeSkill(tmpRoot, "short.md", "name: short\ndescription: hi", "body");
    const { records, errors } = scanAgentSkillsDirectory(tmpRoot);
    expect(records).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.problems[0]).toContain("description must be at least 5 characters");
  });

  it("buildManifest emits stable shape with sha256 + size", () => {
    writeSkill(tmpRoot, "one.md", "name: one\ndescription: first skill", "body-one");
    const { records } = scanAgentSkillsDirectory(tmpRoot);
    const manifest = buildManifest(records, { producer: "wotann-test", now: FIXED_NOW });
    expect(manifest.version).toBe(AGENTSKILLS_MANIFEST_VERSION);
    expect(manifest.producer).toBe("wotann-test");
    expect(manifest.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(manifest.skills).toHaveLength(1);
    const entry = manifest.skills[0]!;
    expect(entry.name).toBe("one");
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.size).toBeGreaterThan(0);
  });
});

describe("agentskills-registry — export", () => {
  let tmpSrc: string;
  let tmpOut: string;

  beforeEach(() => {
    tmpSrc = mkdtempSync(join(tmpdir(), "askills-src-"));
    tmpOut = mkdtempSync(join(tmpdir(), "askills-out-"));
  });
  afterEach(() => {
    rmSync(tmpSrc, { recursive: true, force: true });
    rmSync(tmpOut, { recursive: true, force: true });
  });

  it("exports a directory-style SKILL.md per skill + a manifest.json", () => {
    writeSkill(
      tmpSrc,
      "first.md",
      "name: first\ndescription: exported skill\nversion: 1.2.3\ntier: curated",
      "Export body",
    );
    const result = exportToAgentSkills(tmpSrc, tmpOut, {
      producer: "wotann",
      now: FIXED_NOW,
    });
    expect(result.skillsWritten).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(existsSync(result.manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      skills: { name: string; path: string; sha256: string }[];
    };
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.skills[0]!.name).toBe("first");

    const skillFile = join(tmpOut, "first", "SKILL.md");
    expect(existsSync(skillFile)).toBe(true);
    const emitted = readFileSync(skillFile, "utf8");
    expect(emitted).toContain("name: first");
    expect(emitted).toContain("version: 1.2.3");
    expect(emitted).toContain("Export body");
  });

  it("manifest filename matches AGENTSKILLS_MANIFEST_FILENAME", () => {
    writeSkill(tmpSrc, "y.md", "name: y\ndescription: y-skill", "body");
    const result = exportToAgentSkills(tmpSrc, tmpOut);
    expect(result.manifestPath.endsWith(AGENTSKILLS_MANIFEST_FILENAME)).toBe(true);
  });
});

describe("agentskills-registry — import", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "askills-imp-"));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("imports a valid external agentskills.io skill file", () => {
    const path = writeSkill(
      tmpRoot,
      "ext.md",
      "name: ext\ndescription: external skill",
      "external body",
    );
    const result = importAgentSkillFile(path);
    if ("error" in result) throw new Error(result.error);
    expect(result.skill.name).toBe("ext");
    expect(result.skill.body).toBe("external body");
  });

  it("rejects non-existent file with readable error", () => {
    const result = importAgentSkillFile(join(tmpRoot, "nope.md"));
    expect("error" in result).toBe(true);
  });

  it("rejects a file missing frontmatter", () => {
    const path = join(tmpRoot, "nope.md");
    writeFileSync(path, "just body\n", "utf8");
    const result = importAgentSkillFile(path);
    expect("error" in result).toBe(true);
  });

  it("rejects an invalid skill (validation failure)", () => {
    const path = writeSkill(tmpRoot, "bad.md", "name: bad\ndescription: x", "body");
    const result = importAgentSkillFile(path);
    expect("error" in result).toBe(true);
  });
});
