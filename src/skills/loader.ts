/**
 * Skill system with progressive disclosure.
 *
 * Upgraded with ClawHub patterns:
 * - `not_for` rejection boundaries (prevent false activation)
 * - `always` flag for passively-active skills
 * - `anyBins` requirement (at least one of these must exist)
 * - `os` restrictions (darwin/linux/win32)
 * - `version` pinning for safe updates
 * - Pre-flight validation before execution
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import { parse as parseYaml } from "yaml";
import type { AgentTool } from "../core/config-discovery.js";

// ── Types ───────────────────────────────────────────────────

export interface SkillRequirements {
  readonly bins?: readonly string[];
  readonly anyBins?: readonly string[];
  readonly env?: readonly string[];
  readonly os?: readonly string[];
}

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly allowedTools?: readonly string[];
  readonly extraMetadata?: Readonly<Record<string, string>>;
  readonly format?: "flat-markdown" | "agentskills-directory";
  readonly context: "fork" | "main";
  readonly paths: readonly string[];
  readonly notFor?: readonly string[];
  readonly always?: boolean;
  readonly category: string;
  readonly requires?: SkillRequirements;
}

export interface LoadedSkill {
  readonly metadata: SkillMetadata;
  readonly content: string;
  readonly filePath: string;
}

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly version?: string;
  readonly always?: boolean;
}

export interface PreflightResult {
  readonly ready: boolean;
  readonly missingBins: readonly string[];
  readonly missingEnv: readonly string[];
  readonly osBlocked: boolean;
  readonly message: string;
}

interface SkillSource {
  readonly entryPath: string;
  readonly skillFilePath: string;
  readonly format: "flat-markdown" | "agentskills-directory";
}

interface ResolvedSkill {
  readonly metadata: SkillMetadata;
  readonly content: string;
  readonly source: SkillSource;
}

// ── Built-in Skills (metadata only — progressive disclosure) ─

const BUILT_IN_SKILLS: readonly SkillMetadata[] = [
  // Languages (4)
  { name: "typescript-pro", description: "TypeScript strict mode, generics, type-level programming", version: "1.0.0", context: "fork", paths: ["**/*.ts", "**/*.tsx"], notFor: ["**/*.test.ts", "**/*.spec.ts"], category: "languages" },
  { name: "react-expert", description: "React 18+ hooks, composition, performance", version: "1.0.0", context: "fork", paths: ["**/*.tsx", "**/*.jsx"], notFor: ["**/*.test.*"], category: "frontend" },
  { name: "python-pro", description: "Python 3.11+, async, type hints", version: "1.0.0", context: "fork", paths: ["**/*.py"], notFor: ["**/test_*", "**/*_test.py"], category: "languages", requires: { anyBins: ["python3", "python"] } },
  { name: "golang-pro", description: "Go idioms, goroutines, channels", version: "1.0.0", context: "fork", paths: ["**/*.go", "**/go.mod"], category: "languages", requires: { bins: ["go"] } },

  // Frontend (2)
  { name: "nextjs-developer", description: "App Router, server components, server actions", version: "1.0.0", context: "fork", paths: ["**/next.config*"], category: "frontend" },
  { name: "rust-engineer", description: "Ownership, borrowing, zero-cost abstractions", version: "1.0.0", context: "fork", paths: ["**/*.rs", "**/Cargo.toml"], category: "languages", requires: { bins: ["cargo"] } },

  // Database (1)
  { name: "sql-pro", description: "Query optimization, indexing, migrations", version: "1.0.0", context: "fork", paths: ["**/*.sql"], category: "database" },

  // Debugging (1)
  { name: "systematic-debugging", description: "Hypothesis-driven root cause analysis", version: "1.0.0", context: "fork", paths: [], category: "debugging" },

  // Testing (1)
  { name: "tdd-workflow", description: "RED-GREEN-REFACTOR enforcement", version: "1.0.0", context: "fork", paths: ["**/*.test.*", "**/*.spec.*"], always: true, category: "testing" },

  // Quality (2)
  { name: "code-reviewer", description: "Severity-based code review (CRITICAL/HIGH/MED/LOW)", version: "1.0.0", context: "fork", paths: [], category: "quality" },
  { name: "code-simplifier", description: "Reduce complexity, preserve behavior", version: "1.0.0", context: "fork", paths: [], notFor: ["**/*.test.*", "**/*.spec.*"], category: "quality" },

  // Git (1)
  { name: "conventional-commit", description: "Conventional commit format enforcement", version: "1.0.0", context: "main", paths: [], always: true, category: "git" },

  // Research (1)
  { name: "search-first", description: "Library search before coding", version: "1.0.0", context: "fork", paths: [], always: true, category: "research" },

  // Planning (1)
  { name: "file-based-planning", description: "task_plan.md, findings.md, progress.md", version: "1.0.0", context: "fork", paths: [], category: "planning" },

  // Security (1)
  { name: "security-reviewer", description: "OWASP Top 10, injection, XSS scanning", version: "1.0.0", context: "fork", paths: [], always: true, category: "security" },

  // DevOps (1)
  { name: "docker-expert", description: "Multi-stage builds, optimization", version: "1.0.0", context: "fork", paths: ["**/Dockerfile", "**/docker-compose*"], category: "devops", requires: { anyBins: ["docker", "podman"] } },

  // Architecture (1)
  { name: "api-design", description: "REST vs GraphQL, versioning, response formats", version: "1.0.0", context: "fork", paths: [], category: "architecture" },

  // Scraping (1)
  { name: "web-scraper", description: "6-phase reconnaissance and extraction", version: "1.0.0", context: "fork", paths: [], category: "scraping" },
];

// ── Skill Registry ──────────────────────────────────────────

export class SkillRegistry {
  private readonly skills: Map<string, SkillMetadata> = new Map();
  private readonly loadedContent: Map<string, string> = new Map();
  private readonly skillSources: Map<string, SkillSource> = new Map();
  private readonly searchPaths: readonly string[];

  constructor(searchPaths: readonly string[] = []) {
    this.searchPaths = searchPaths;

    for (const skill of BUILT_IN_SKILLS) {
      this.skills.set(skill.name, skill);
    }
  }

  /**
   * Create a registry pre-loaded with all skills from a directory.
   * This is the standard way to create a registry in production —
   * it picks up all 69+ .md skill files from the skills/ directory
   * while keeping the 18 built-in entries as fallback.
   */
  static createWithDefaults(skillsDir: string): SkillRegistry {
    const registry = new SkillRegistry([skillsDir]);
    registry.scanDirectory(skillsDir);
    return registry;
  }

  /**
   * Get all skill summaries (~10 tokens each for progressive disclosure).
   */
  getSummaries(): readonly SkillSummary[] {
    return [...this.skills.values()].map((s) => ({
      name: s.name,
      description: s.description,
      category: s.category,
      version: s.version,
      always: s.always,
    }));
  }

  /**
   * Auto-detect relevant skills from file paths.
   * Respects `not_for` rejection boundaries — prevents false activation.
   */
  detectRelevant(filePaths: readonly string[]): readonly SkillMetadata[] {
    const relevant: SkillMetadata[] = [];

    for (const skill of this.skills.values()) {
      if (skill.paths.length === 0) continue;

      const matches = filePaths.some((fp) =>
        skill.paths.some((pattern) => matchGlob(fp, pattern)),
      );

      if (!matches) continue;

      // ClawHub pattern: check NOT_FOR rejection boundaries
      if (skill.notFor && skill.notFor.length > 0) {
        const rejected = filePaths.some((fp) =>
          skill.notFor!.some((pattern) => matchGlob(fp, pattern)),
        );
        if (rejected) continue;
      }

      relevant.push(skill);
    }

    return relevant;
  }

  /**
   * Get skills that are always active (passively loaded without invocation).
   * ClawHub pattern: `always: true` flag.
   */
  getAlwaysActive(): readonly SkillMetadata[] {
    return [...this.skills.values()].filter((s) => s.always === true);
  }

  /**
   * Pre-flight validation: verify a skill's requirements before execution.
   * ClawHub pattern: fail fast with actionable error messages.
   */
  validatePreflight(skillName: string): PreflightResult {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return { ready: false, missingBins: [], missingEnv: [], osBlocked: false, message: `Skill not found: ${skillName}` };
    }

    if (!skill.requires) {
      return { ready: true, missingBins: [], missingEnv: [], osBlocked: false, message: "No requirements" };
    }

    const missingBins: string[] = [];
    const missingEnv: string[] = [];
    let osBlocked = false;

    // Check OS restriction
    if (skill.requires.os && skill.requires.os.length > 0) {
      const currentOS = platform();
      if (!skill.requires.os.includes(currentOS)) {
        osBlocked = true;
      }
    }

    // Check required binaries (ALL must exist)
    if (skill.requires.bins) {
      for (const bin of skill.requires.bins) {
        if (!hasBinary(bin)) {
          missingBins.push(bin);
        }
      }
    }

    // Check anyBins (at least ONE must exist)
    if (skill.requires.anyBins && skill.requires.anyBins.length > 0) {
      const hasAny = skill.requires.anyBins.some((bin) => hasBinary(bin));
      if (!hasAny) {
        missingBins.push(`one of: ${skill.requires.anyBins.join(", ")}`);
      }
    }

    // Check required environment variables
    if (skill.requires.env) {
      for (const envVar of skill.requires.env) {
        if (!process.env[envVar]) {
          missingEnv.push(envVar);
        }
      }
    }

    const ready = missingBins.length === 0 && missingEnv.length === 0 && !osBlocked;
    const parts: string[] = [];
    if (missingBins.length > 0) parts.push(`Missing binaries: ${missingBins.join(", ")}`);
    if (missingEnv.length > 0) parts.push(`Missing env vars: ${missingEnv.join(", ")}`);
    if (osBlocked) parts.push(`OS not supported: requires ${skill.requires.os!.join(" or ")}, running on ${platform()}`);

    return {
      ready,
      missingBins,
      missingEnv,
      osBlocked,
      message: ready ? "All requirements met" : parts.join(". "),
    };
  }

  /**
   * Load full skill content (lazy activation).
   */
  loadSkill(name: string): LoadedSkill | null {
    const metadata = this.skills.get(name);
    if (!metadata) return null;

    const cached = this.loadedContent.get(name);
    if (cached) {
      return {
        metadata,
        content: cached,
        filePath: this.skillSources.get(name)?.skillFilePath ?? `built-in:${name}`,
      };
    }

    const registeredSource = this.skillSources.get(name);
    if (registeredSource) {
      const resolved = resolveSkillEntry(registeredSource.entryPath);
      if (resolved) {
        this.loadedContent.set(name, resolved.content);
        this.skillSources.set(name, resolved.source);
        return { metadata, content: resolved.content, filePath: resolved.source.skillFilePath };
      }
    }

    for (const searchPath of this.searchPaths) {
      const source = resolveNamedSkillSource(searchPath, name);
      if (!source) continue;

      const resolved = resolveSkillEntry(source.entryPath);
      if (resolved) {
        this.loadedContent.set(name, resolved.content);
        this.skillSources.set(name, resolved.source);
        return {
          metadata,
          content: resolved.content,
          filePath: resolved.source.skillFilePath,
        };
      }
    }

    return {
      metadata,
      content: `# ${metadata.name}\n\n${metadata.description}`,
      filePath: `built-in:${name}`,
    };
  }

  /**
   * Register a custom skill from a SKILL.md file.
   */
  registerFromFile(filePath: string): boolean {
    const resolved = resolveSkillEntry(filePath);
    if (!resolved) return false;

    this.skills.set(resolved.metadata.name, resolved.metadata);
    this.loadedContent.set(resolved.metadata.name, resolved.content);
    this.skillSources.set(resolved.metadata.name, resolved.source);
    return true;
  }

  /**
   * Scan directories for custom skills.
   */
  scanDirectory(dir: string): number {
    if (!existsSync(dir)) return 0;

    let count = 0;
    for (const skillEntry of discoverSkillEntries(dir)) {
      if (this.registerFromFile(skillEntry)) {
        count++;
      }
    }
    return count;
  }

  getSkillCount(): number {
    return this.skills.size;
  }

  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  getSkill(name: string): SkillMetadata | undefined {
    return this.skills.get(name);
  }

  /**
   * Discover and load skills from all 8 known agent tool directories.
   * Searches: .wotann/, .claude/, .cursor/, .codex/, .gemini/, .crush/, .cline/, .copilot/
   *
   * Scans both homeDir and projectDir for each tool's skills directory.
   * Returns the total number of newly discovered skills.
   */
  discoverCrossToolSkills(homeDir: string, projectDir: string): number {
    const TOOL_SKILL_DIRS: readonly { readonly tool: AgentTool; readonly dirName: string; readonly skillsDir: string }[] = [
      { tool: "wotann", dirName: ".wotann", skillsDir: "skills" },
      { tool: "claude", dirName: ".claude", skillsDir: "skills" },
      { tool: "cursor", dirName: ".cursor", skillsDir: "rules" },
      { tool: "codex", dirName: ".codex", skillsDir: "skills" },
      { tool: "gemini", dirName: ".gemini", skillsDir: "rules" },
      { tool: "crush", dirName: ".crush", skillsDir: "rules" },
      { tool: "cline", dirName: ".cline", skillsDir: "rules" },
      { tool: "copilot", dirName: ".copilot", skillsDir: "skills" },
    ];

    const searchDirs = [...new Set([homeDir, projectDir])];
    let totalDiscovered = 0;

    for (const toolDef of TOOL_SKILL_DIRS) {
      for (const searchDir of searchDirs) {
        const skillsPath = join(searchDir, toolDef.dirName, toolDef.skillsDir);
        if (!existsSync(skillsPath) || !isDirectoryCheck(skillsPath)) continue;

        const countBefore = this.skills.size;
        this.scanDirectory(skillsPath);
        totalDiscovered += this.skills.size - countBefore;
      }
    }

    return totalDiscovered;
  }
}

function isDirectoryCheck(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// ── Helpers ─────────────────────────────────────────────────

function parseSkillFrontmatter(content: string): SkillMetadata | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return null;

  try {
    const fm = parseYaml(match[1]) as Record<string, unknown>;
    if (!fm["name"] || !fm["description"]) return null;

    const requires = fm["requires"] as Record<string, unknown> | undefined;
    const nestedMetadata = asStringRecord(fm["metadata"]);
    const version = (fm["version"] as string | undefined) ?? nestedMetadata?.["version"];
    const allowedTools = parseAllowedTools(fm["allowed-tools"] ?? fm["allowedTools"]);

    return {
      name: fm["name"] as string,
      description: fm["description"] as string,
      version,
      license: fm["license"] as string | undefined,
      compatibility: fm["compatibility"] as string | undefined,
      allowedTools,
      extraMetadata: nestedMetadata,
      format: "flat-markdown",
      context: (fm["context"] as "fork" | "main") ?? "fork",
      paths: (fm["paths"] as string[]) ?? [],
      notFor: (fm["not_for"] as string[]) ?? (fm["notFor"] as string[]) ?? undefined,
      always: (fm["always"] as boolean) ?? undefined,
      category: (fm["category"] as string) ?? "custom",
      requires: requires ? {
        bins: requires["bins"] as string[] | undefined,
        anyBins: requires["anyBins"] as string[] | undefined,
        env: requires["env"] as string[] | undefined,
        os: requires["os"] as string[] | undefined,
      } : undefined,
    };
  } catch {
    return null;
  }
}

function resolveSkillEntry(entryPath: string): ResolvedSkill | null {
  const source = resolveSkillSource(entryPath);
  if (!source) return null;

  const content = readFileSync(source.skillFilePath, "utf-8");
  const metadata = parseSkillFrontmatter(content);
  if (!metadata) return null;

  if (source.format === "agentskills-directory") {
    return {
      metadata: {
        ...metadata,
        format: source.format,
        category: metadata.category === "custom" ? "external" : metadata.category,
      },
      content: convertAgentSkillBundle(source.entryPath, content),
      source,
    };
  }

  return {
    metadata: {
      ...metadata,
      format: source.format,
    },
    content,
    source,
  };
}

function resolveSkillSource(entryPath: string): SkillSource | null {
  if (!existsSync(entryPath)) return null;

  const stats = statSync(entryPath);
  if (stats.isDirectory()) {
    const skillFilePath = join(entryPath, "SKILL.md");
    if (!existsSync(skillFilePath)) return null;
    return {
      entryPath,
      skillFilePath,
      format: "agentskills-directory",
    };
  }

  if (extname(entryPath) !== ".md") return null;

  if (basename(entryPath) === "SKILL.md") {
    const bundleDir = dirname(entryPath);
    return {
      entryPath: bundleDir,
      skillFilePath: entryPath,
      format: "agentskills-directory",
    };
  }

  return {
    entryPath,
    skillFilePath: entryPath,
    format: "flat-markdown",
  };
}

function resolveNamedSkillSource(searchPath: string, name: string): SkillSource | null {
  const markdownFile = join(searchPath, `${name}.md`);
  if (existsSync(markdownFile)) {
    return {
      entryPath: markdownFile,
      skillFilePath: markdownFile,
      format: "flat-markdown",
    };
  }

  const bundleDir = join(searchPath, name);
  const bundleSkillFile = join(bundleDir, "SKILL.md");
  if (existsSync(bundleSkillFile)) {
    return {
      entryPath: bundleDir,
      skillFilePath: bundleSkillFile,
      format: "agentskills-directory",
    };
  }

  return null;
}

function discoverSkillEntries(dir: string): readonly string[] {
  const entries: string[] = [];
  const children = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !shouldSkipSkillScanEntry(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of children) {
    const fullPath = join(dir, entry.name);

    if (entry.isFile() && extname(entry.name) === ".md") {
      entries.push(fullPath);
      continue;
    }

    if (!entry.isDirectory()) continue;

    if (existsSync(join(fullPath, "SKILL.md"))) {
      entries.push(fullPath);
      continue;
    }

    entries.push(...discoverSkillEntries(fullPath));
  }

  return entries;
}

function convertAgentSkillBundle(skillRoot: string, skillContent: string): string {
  const sections = [
    { heading: "Scripts", files: listBundleFiles(join(skillRoot, "scripts"), skillRoot) },
    { heading: "References", files: listBundleFiles(join(skillRoot, "references"), skillRoot) },
    { heading: "Assets", files: listBundleFiles(join(skillRoot, "assets"), skillRoot) },
    { heading: "Additional Files", files: listAdditionalBundleFiles(skillRoot) },
  ].filter((section) => section.files.length > 0);

  if (sections.length === 0) {
    return skillContent;
  }

  const inventory = sections.flatMap((section) => [
    `### ${section.heading}`,
    ...section.files.map((file) => `- ${file}`),
    "",
  ]);

  return [
    skillContent.trimEnd(),
    "",
    "<!-- WOTANN Agent Skills adapter: generated bundle inventory -->",
    "## WOTANN Bundle Context",
    "",
    "This skill was loaded from an Agent Skills directory bundle.",
    `Bundle root: ${skillRoot}`,
    "Resolve relative paths from that directory when following file references.",
    "",
    ...inventory,
  ].join("\n").trimEnd();
}

function listBundleFiles(dir: string, root: string): readonly string[] {
  return listFilesRecursive(dir, root, 25);
}

function listAdditionalBundleFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];

  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => !shouldSkipSkillScanEntry(entry.name))
    .filter((entry) => entry.name !== "SKILL.md" && entry.name !== "scripts" && entry.name !== "references" && entry.name !== "assets")
    .sort((a, b) => a.name.localeCompare(b.name));

  return files.map((entry) => entry.name + (entry.isDirectory() ? "/" : ""));
}

function listFilesRecursive(dir: string, root: string, limit: number): readonly string[] {
  if (!existsSync(dir)) return [];

  const results: string[] = [];
  const visit = (currentDir: string): void => {
    if (results.length >= limit) return;

    const entries = readdirSync(currentDir, { withFileTypes: true })
      .filter((entry) => !shouldSkipSkillScanEntry(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= limit) break;

      const fullPath = join(currentDir, entry.name);
      const relativePath = fullPath.slice(root.length + 1).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  };

  visit(dir);

  const allFilesCount = countFilesRecursive(dir);
  if (allFilesCount > results.length) {
    results.push(`... (+${allFilesCount - results.length} more)`);
  }

  return results;
}

function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;

  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkipSkillScanEntry(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(fullPath);
    } else if (entry.isFile()) {
      count++;
    }
  }
  return count;
}

function shouldSkipSkillScanEntry(name: string): boolean {
  return name === ".git" || name === "node_modules" || name.startsWith(".");
}

function parseAllowedTools(value: unknown): readonly string[] | undefined {
  if (typeof value === "string") {
    const tools = value.split(/\s+/).filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }

  if (Array.isArray(value)) {
    const tools = value.filter((tool): tool is string => typeof tool === "string" && tool.length > 0);
    return tools.length > 0 ? tools : undefined;
  }

  return undefined;
}

function asStringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue === "string")
    .map(([key, entryValue]) => [key, entryValue as string]);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function matchGlob(filePath: string, pattern: string): boolean {
  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3);
    if (suffix.startsWith("*.")) {
      const ext = suffix.slice(1);
      return filePath.endsWith(ext);
    }
    return filePath.endsWith(suffix) || filePath === suffix;
  }

  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1);
    return filePath.endsWith(ext);
  }

  return filePath === pattern || filePath.endsWith(`/${pattern}`);
}

function hasBinary(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
