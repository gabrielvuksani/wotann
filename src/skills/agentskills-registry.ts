/**
 * agentskills.io registry — directory scanner + manifest generator.
 *
 * `skill-standard.ts` handles a single SKILL.md file (parse / validate /
 * render). This module operates on a DIRECTORY of skills and produces
 * the cross-ecosystem manifest shape consumers expect:
 *
 *   skills/
 *     manifest.json              ← inventory + checksums
 *     my-skill/
 *       SKILL.md                 ← agentskills.io-format file
 *     other-skill.md             ← flat-markdown (auto-wrapped on export)
 *
 * The manifest is what Crush, Hermes, Superpowers, and other agentskills.io
 * consumers fetch first to discover available skills. By emitting it from
 * WOTANN's `skills/` tree we become a first-class producer in that
 * ecosystem without changing any existing skill file.
 *
 * Session-10 P10-5 port.
 */

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename, extname, resolve } from "node:path";
import {
  type AgentSkill,
  parseAgentSkillFile,
  validateAgentSkill,
  renderAgentSkillFile,
} from "./skill-standard.js";

/** Fixed schema identifier emitted in every manifest for consumer sniffing. */
export const AGENTSKILLS_MANIFEST_VERSION = "1.0.0" as const;

/** Canonical filename a consumer expects at the registry root. */
export const AGENTSKILLS_MANIFEST_FILENAME = "manifest.json" as const;

export interface AgentSkillsManifestEntry {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly license?: string;
  readonly domain?: string;
  readonly tier?: string;
  /** Relative path from the registry root to the SKILL.md file. */
  readonly path: string;
  /** SHA-256 of the canonical SKILL.md bytes for integrity checking. */
  readonly sha256: string;
  /** Byte length of the canonical SKILL.md. */
  readonly size: number;
}

export interface AgentSkillsManifest {
  readonly version: typeof AGENTSKILLS_MANIFEST_VERSION;
  /** Stable producer-identifier so consumers can attribute the feed. */
  readonly producer: string;
  /** UTC ISO-8601 timestamp. */
  readonly generatedAt: string;
  readonly skills: readonly AgentSkillsManifestEntry[];
}

export interface ScanOptions {
  readonly producer?: string;
  readonly now?: () => Date;
}

interface ScanRecord {
  readonly skill: AgentSkill;
  readonly relativePath: string;
  readonly sourceBytes: string;
}

/**
 * Scan a directory tree for agentskills.io-format files. Accepts BOTH
 * `foo/SKILL.md` (directory-style) and `foo.md` (flat-markdown) since
 * WOTANN ships both variants. Returns the parsed + validated list plus
 * any problems encountered so the caller can surface them.
 */
export function scanAgentSkillsDirectory(
  root: string,
  _options: ScanOptions = {},
): {
  readonly records: readonly ScanRecord[];
  readonly errors: readonly { readonly path: string; readonly problems: readonly string[] }[];
} {
  const absRoot = resolve(root);
  if (!existsSync(absRoot)) {
    return { records: [], errors: [] };
  }
  const records: ScanRecord[] = [];
  const errors: { readonly path: string; readonly problems: readonly string[] }[] = [];

  for (const entry of readdirSync(absRoot)) {
    const abs = join(absRoot, entry);
    const stat = statSync(abs);
    const candidates: string[] = [];
    if (stat.isDirectory()) {
      const dirSkill = join(abs, "SKILL.md");
      if (existsSync(dirSkill)) candidates.push(dirSkill);
    } else if (stat.isFile() && extname(entry) === ".md") {
      candidates.push(abs);
    }
    for (const skillPath of candidates) {
      const source = readFileSync(skillPath, "utf8");
      const skill = parseAgentSkillFile(source, skillPath);
      if (!skill) {
        errors.push({
          path: skillPath,
          problems: ["missing or malformed agentskills.io frontmatter"],
        });
        continue;
      }
      const problems = validateAgentSkill(skill);
      if (problems.length > 0) {
        errors.push({ path: skillPath, problems });
        continue;
      }
      records.push({
        skill,
        relativePath: abs.slice(absRoot.length + 1),
        sourceBytes: renderAgentSkillFile(skill),
      });
    }
  }

  // Stable ordering so the manifest digest is reproducible.
  records.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  return { records, errors };
}

/**
 * Build the manifest for a scanned set of records. Pure — does not
 * touch the filesystem. Use `writeManifest` to persist.
 */
export function buildManifest(
  records: readonly ScanRecord[],
  options: ScanOptions = {},
): AgentSkillsManifest {
  const entries: AgentSkillsManifestEntry[] = records.map((r) => {
    const sha = createHash("sha256").update(r.sourceBytes).digest("hex");
    const size = Buffer.byteLength(r.sourceBytes, "utf8");
    const entry: AgentSkillsManifestEntry = {
      name: r.skill.name,
      description: r.skill.description,
      path: r.relativePath,
      sha256: sha,
      size,
      ...(r.skill.version ? { version: r.skill.version } : {}),
      ...(r.skill.license ? { license: r.skill.license } : {}),
      ...(r.skill.domain ? { domain: r.skill.domain } : {}),
      ...(r.skill.tier ? { tier: r.skill.tier } : {}),
    };
    return entry;
  });
  const now = options.now ? options.now() : new Date();
  return {
    version: AGENTSKILLS_MANIFEST_VERSION,
    producer: options.producer ?? "wotann",
    generatedAt: now.toISOString(),
    skills: entries,
  };
}

/**
 * Emit an agentskills.io-compatible directory. Re-renders every skill
 * as its canonical SKILL.md form and writes `manifest.json` at the
 * root. Destructive: existing files at `outRoot` may be overwritten.
 *
 * Returns a summary suitable for logging.
 */
export function exportToAgentSkills(
  sourceRoot: string,
  outRoot: string,
  options: ScanOptions = {},
): {
  readonly skillsWritten: number;
  readonly errors: readonly { readonly path: string; readonly problems: readonly string[] }[];
  readonly manifestPath: string;
} {
  const { records, errors } = scanAgentSkillsDirectory(sourceRoot, options);
  if (!existsSync(outRoot)) mkdirSync(outRoot, { recursive: true });
  for (const record of records) {
    // Always emit in the directory-style shape (SKILL.md inside a dir named
    // after the skill) — that's the most portable form.
    const dir = join(outRoot, record.skill.name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), record.sourceBytes, "utf8");
  }
  const manifest = buildManifest(records, options);
  const manifestPath = join(outRoot, AGENTSKILLS_MANIFEST_FILENAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { skillsWritten: records.length, errors, manifestPath };
}

/**
 * Import a single external agentskills.io skill file into WOTANN's
 * runtime. Pure — returns the parsed AgentSkill; callers decide where
 * to persist it. Rejects skills with validation problems so a weak-
 * model import cycle can't smuggle in malformed skills.
 */
export function importAgentSkillFile(
  filePath: string,
): { readonly skill: AgentSkill } | { readonly error: string } {
  if (!existsSync(filePath)) {
    return { error: `skill file not found: ${filePath}` };
  }
  const source = readFileSync(filePath, "utf8");
  const skill = parseAgentSkillFile(source, filePath);
  if (!skill) {
    return { error: `file is not agentskills.io-format: ${basename(filePath)}` };
  }
  const problems = validateAgentSkill(skill);
  if (problems.length > 0) {
    return { error: `invalid skill — ${problems.join("; ")}` };
  }
  return { skill };
}
