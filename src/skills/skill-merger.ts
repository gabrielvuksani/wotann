/**
 * Skill Merger — imports skills from multiple sources and merges similar ones
 * into supercharged unified versions.
 *
 * Sources:
 * - WOTANN built-in (skills/*.md — 86 files)
 * - Anthropic Skills (github.com/anthropics/skills)
 * - OpenAI Codex (codex app skills format)
 * - ClawHub (clawhub.com marketplace)
 * - AgentSkills.io (2600+ skills, cross-platform standard)
 * - User-installed (via wotann skills install)
 *
 * Merge strategy:
 * 1. Discover all skills from all sources
 * 2. Group by domain/purpose (fuzzy matching on name + description)
 * 3. For each group: merge into one supercharged skill combining best instructions
 * 4. Deduplicate conflicting guidance (prefer WOTANN built-in over external)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────

export interface SkillSource {
  readonly id: string;
  readonly name: string;
  readonly type: "builtin" | "anthropic" | "openai" | "clawhub" | "agentskills" | "user";
  readonly path: string;
  readonly priority: number; // Lower = higher priority (builtin = 1, external = 5)
}

export interface DiscoveredSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly source: SkillSource;
  readonly filePath: string;
  readonly triggers?: readonly string[];
}

export interface MergedSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly sources: readonly string[]; // Which sources contributed
  readonly mergeStrategy: "unified" | "best-of" | "supplemented";
}

// ── Skill Source Discovery ──────────────────────────────

const SKILL_SOURCES: readonly SkillSource[] = [
  {
    id: "builtin",
    name: "WOTANN Built-in",
    type: "builtin",
    path: "", // Set dynamically based on working directory
    priority: 1,
  },
  {
    id: "anthropic",
    name: "Anthropic Skills",
    type: "anthropic",
    path: join(homedir(), ".claude", "skills"),
    priority: 3,
  },
  {
    id: "openai",
    name: "OpenAI Codex Skills",
    type: "openai",
    path: join(homedir(), ".codex", "skills"),
    priority: 3,
  },
  {
    id: "cursor",
    name: "Cursor Rules",
    type: "user",
    path: join(homedir(), ".cursor", "rules"),
    priority: 4,
  },
  {
    id: "clawhub",
    name: "ClawHub Marketplace",
    type: "clawhub",
    path: join(homedir(), ".openclaw", "skills"),
    priority: 5,
  },
  {
    id: "user",
    name: "User Installed",
    type: "user",
    path: join(homedir(), ".wotann", "marketplace"),
    priority: 2,
  },
];

// ── Skill Merger ────────────────────────────────────────

export class SkillMerger {
  private readonly builtinPath: string;
  private readonly mergedPath: string;

  constructor(builtinSkillsPath: string) {
    this.builtinPath = builtinSkillsPath;
    this.mergedPath = join(homedir(), ".wotann", "merged-skills");
    if (!existsSync(this.mergedPath)) {
      mkdirSync(this.mergedPath, { recursive: true });
    }
  }

  /**
   * Return the deduplicated set of trigger phrases across all discovered
   * skills — the desktop's TrainingReview surfaces these as "what users
   * could say to invoke a skill that doesn't exist yet". Used by the
   * skills.forge.triggers RPC handler.
   */
  getPendingTriggers(): readonly { skill: string; trigger: string; source: string }[] {
    const all = this.discoverAll();
    const seen = new Set<string>();
    const result: { skill: string; trigger: string; source: string }[] = [];
    for (const skill of all) {
      for (const trigger of skill.triggers ?? []) {
        const key = `${skill.name}::${trigger}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ skill: skill.name, trigger, source: skill.source.id });
      }
    }
    return result;
  }

  /**
   * Discover all skills from all configured sources.
   */
  discoverAll(): readonly DiscoveredSkill[] {
    const skills: DiscoveredSkill[] = [];

    for (const source of SKILL_SOURCES) {
      const path = source.id === "builtin" ? this.builtinPath : source.path;
      if (!path || !existsSync(path)) continue;

      try {
        const discovered = this.discoverFromPath(path, source);
        skills.push(...discovered);
      } catch {
        // Skip sources that fail to read
      }
    }

    return skills;
  }

  /**
   * Discover skills from a specific directory path.
   */
  private discoverFromPath(dirPath: string, source: SkillSource): readonly DiscoveredSkill[] {
    const skills: DiscoveredSkill[] = [];

    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".skill"))) {
        try {
          const filePath = join(dirPath, entry.name);
          const content = readFileSync(filePath, "utf-8");
          const { name, description, triggers } = this.parseSkillMetadata(content, entry.name);

          skills.push({
            name,
            description,
            content,
            source,
            filePath,
            triggers,
          });
        } catch {
          // Skip unreadable files
        }
      } else if (entry.isDirectory()) {
        // Check for SKILL.md inside directory (AgentSkills standard)
        const skillMdPath = join(dirPath, entry.name, "SKILL.md");
        if (existsSync(skillMdPath)) {
          try {
            const content = readFileSync(skillMdPath, "utf-8");
            const { name, description, triggers } = this.parseSkillMetadata(content, entry.name);

            skills.push({
              name: name || entry.name,
              description,
              content,
              source,
              filePath: skillMdPath,
              triggers,
            });
          } catch {
            // Skip
          }
        }
      }
    }

    return skills;
  }

  /**
   * Parse YAML frontmatter from a skill file.
   */
  private parseSkillMetadata(
    content: string,
    filename: string,
  ): {
    name: string;
    description: string;
    triggers?: readonly string[];
  } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return {
        name: basename(filename, ".md"),
        description: "",
      };
    }

    const yaml = frontmatterMatch[1] ?? "";
    const nameMatch = yaml.match(/name:\s*(.+)/);
    const descMatch = yaml.match(/description:\s*(.+)/);
    const pathsMatch = yaml.match(/paths:\s*\[([^\]]*)\]/);

    return {
      name: nameMatch?.[1]?.trim() ?? basename(filename, ".md"),
      description: descMatch?.[1]?.trim() ?? "",
      triggers: pathsMatch?.[1]?.split(",").map((p) => p.trim().replace(/"/g, "")) ?? undefined,
    };
  }

  /**
   * Group skills by domain similarity.
   * Skills with similar names or overlapping triggers are grouped together.
   */
  groupByDomain(skills: readonly DiscoveredSkill[]): Map<string, DiscoveredSkill[]> {
    const groups = new Map<string, DiscoveredSkill[]>();

    for (const skill of skills) {
      const domain = this.classifyDomain(skill);
      const existing = groups.get(domain) ?? [];
      existing.push(skill);
      groups.set(domain, existing);
    }

    return groups;
  }

  /**
   * Classify a skill's domain from its name and description.
   */
  private classifyDomain(skill: DiscoveredSkill): string {
    const text = `${skill.name} ${skill.description}`.toLowerCase();

    const domains: readonly [string, readonly string[]][] = [
      ["typescript", ["typescript", "ts", "type-safe", "generics"]],
      ["react", ["react", "jsx", "tsx", "hooks", "component"]],
      ["python", ["python", "py", "pip", "django", "fastapi"]],
      ["rust", ["rust", "cargo", "borrow", "lifetime"]],
      ["go", ["golang", "go", "goroutine"]],
      ["security", ["security", "owasp", "xss", "injection", "vulnerability", "pentest"]],
      ["testing", ["test", "tdd", "coverage", "jest", "vitest", "playwright"]],
      ["debugging", ["debug", "trace", "root cause", "hypothesis"]],
      ["devops", ["docker", "kubernetes", "terraform", "ci/cd", "deploy"]],
      ["database", ["sql", "postgres", "database", "migration", "query"]],
      ["git", ["git", "commit", "branch", "merge", "pr"]],
      ["code-quality", ["review", "refactor", "simplify", "clean"]],
      ["planning", ["plan", "spec", "architecture", "design"]],
      ["research", ["research", "search", "web", "scrape"]],
    ];

    for (const [domain, keywords] of domains) {
      if (keywords.some((k) => text.includes(k))) {
        return domain;
      }
    }

    return skill.name; // Use skill name as domain if no match
  }

  /**
   * Merge a group of similar skills into one supercharged version.
   * Priority: builtin > user > anthropic/openai > clawhub > agentskills
   */
  mergeGroup(_groupName: string, skills: readonly DiscoveredSkill[]): MergedSkill {
    if (skills.length === 1) {
      const single = skills[0]!;
      return {
        name: single.name,
        description: single.description,
        content: single.content,
        sources: [single.source.name],
        mergeStrategy: "best-of",
      };
    }

    // Sort by priority (lower = higher priority)
    const sorted = [...skills].sort((a, b) => a.source.priority - b.source.priority);
    const primary = sorted[0]!; // Highest priority skill (guaranteed by length check above)
    const supplements = sorted.slice(1);

    // Extract unique instructions from supplements that aren't in the primary
    const primaryInstructions = new Set(
      primary.content
        .split("\n")
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l.length > 10),
    );

    const supplementInstructions: string[] = [];
    for (const supplement of supplements) {
      const lines = supplement.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 10 && !primaryInstructions.has(trimmed.toLowerCase())) {
          // Check it's not a duplicate instruction
          const isDuplicate = supplementInstructions.some(
            (existing) => this.similarity(existing.toLowerCase(), trimmed.toLowerCase()) > 0.8,
          );
          if (!isDuplicate) {
            supplementInstructions.push(trimmed);
          }
        }
      }
    }

    // Build merged content
    const mergedContent = [
      primary.content,
      "",
      supplements.length > 0
        ? `## Additional Guidance (merged from ${supplements.map((s) => s.source.name).join(", ")})`
        : "",
      "",
      ...supplementInstructions.slice(0, 20), // Cap at 20 additional instructions
    ]
      .join("\n")
      .trim();

    return {
      name: primary.name,
      description: `${primary.description} (enhanced with ${supplements.length} additional source${supplements.length > 1 ? "s" : ""})`,
      content: mergedContent,
      sources: sorted.map((s) => s.source.name),
      mergeStrategy: supplements.length > 0 ? "supplemented" : "best-of",
    };
  }

  /**
   * Simple word-level Jaccard similarity.
   */
  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Full merge pipeline: discover → group → merge → export.
   */
  runMerge(): {
    discovered: number;
    groups: number;
    merged: number;
    outputDir: string;
  } {
    const skills = this.discoverAll();
    const groups = this.groupByDomain(skills);

    let merged = 0;
    for (const [groupName, groupSkills] of groups) {
      if (groupSkills.length >= 2) {
        const result = this.mergeGroup(groupName, groupSkills);

        // Write merged skill
        const filename = `${groupName.replace(/[^a-z0-9-]/g, "-")}.md`;
        writeFileSync(join(this.mergedPath, filename), result.content);
        merged++;
      }
    }

    return {
      discovered: skills.length,
      groups: groups.size,
      merged,
      outputDir: this.mergedPath,
    };
  }

  /**
   * Import skills from a specific external source.
   */
  async importFromSource(sourceId: string): Promise<number> {
    const source = SKILL_SOURCES.find((s) => s.id === sourceId);
    if (!source) return 0;

    // For GitHub-based sources, clone/pull
    if (sourceId === "anthropic") {
      return this.importFromGitHub("anthropics/skills", source.path);
    }

    return 0;
  }

  /**
   * Clone or update a GitHub skills repo.
   */
  private importFromGitHub(repo: string, targetDir: string): number {
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    try {
      if (existsSync(join(targetDir, ".git"))) {
        // Pull latest
        execFileSync("git", ["pull"], { cwd: targetDir, timeout: 30000 });
      } else {
        // Clone
        execFileSync("git", ["clone", `https://github.com/${repo}.git`, targetDir], {
          timeout: 60000,
        });
      }

      // Count skill files
      const files = readdirSync(targetDir, { recursive: true }) as string[];
      return files.filter(
        (f) => typeof f === "string" && (f.endsWith("SKILL.md") || f.endsWith(".md")),
      ).length;
    } catch {
      return 0;
    }
  }
}
