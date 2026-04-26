/**
 * Marketplace JSON manifest for plugin/skill discovery.
 *
 * Generates a standardized manifest from existing skills in .wotann/skills/
 * and plugins in .wotann/plugins/ for marketplace browsing and installation.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { basename, extname, join } from "node:path";
import { dirname } from "node:path";

// ── Types ──────────────────────────────────────────────────────

export interface MarketplaceManifest {
  readonly version: string;
  readonly plugins: readonly PluginEntry[];
  readonly skills: readonly SkillEntry[];
  readonly lastUpdated: string;
}

export interface PluginEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly tags: readonly string[];
  readonly installCommand: string;
  readonly homepage?: string;
}

export interface SkillEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly tags: readonly string[];
  readonly installCommand: string;
  readonly homepage?: string;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Load an existing manifest from disk. Returns null if the file
 * does not exist or cannot be parsed.
 */
export function loadManifest(path: string): MarketplaceManifest | null {
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as MarketplaceManifest;

    // Minimal validation
    if (!parsed.version || !Array.isArray(parsed.plugins) || !Array.isArray(parsed.skills)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Generate a manifest by scanning the skills and plugins directories.
 * Reads package.json for plugins and SKILL.md/frontmatter for skills.
 */
export function generateManifest(skillsDir: string, pluginsDir: string): MarketplaceManifest {
  const skills = scanSkills(skillsDir);
  const plugins = scanPlugins(pluginsDir);

  return {
    version: "1.0.0",
    plugins,
    skills,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Write a manifest to disk as formatted JSON.
 */
export function writeManifest(manifest: MarketplaceManifest, path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Wave 6.5-UU (H-22) — marketplace manifest (skill/plugin index).
  // Atomic write so a crash mid-save can't truncate it and break discovery.
  writeFileAtomic(path, JSON.stringify(manifest, null, 2));
}

// ── Internal Scanners ──────────────────────────────────────────

interface PluginPackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string | { name?: string };
  readonly keywords?: readonly string[];
  readonly homepage?: string;
}

function scanPlugins(pluginsDir: string): readonly PluginEntry[] {
  if (!existsSync(pluginsDir)) return [];

  const entries: PluginEntry[] = [];

  try {
    const dirs = readdirSync(pluginsDir, { withFileTypes: true });
    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;

      const pkgPath = join(pluginsDir, dirent.name, "package.json");
      if (!existsSync(pkgPath)) continue;

      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PluginPackageJson;
        const authorName =
          typeof pkg.author === "string" ? pkg.author : (pkg.author?.name ?? "unknown");

        entries.push({
          id: dirent.name,
          name: pkg.name ?? dirent.name,
          description: pkg.description ?? "",
          version: pkg.version ?? "0.0.0",
          author: authorName,
          tags: pkg.keywords ? [...pkg.keywords] : [],
          installCommand: `wotann install ${pkg.name ?? dirent.name}`,
          homepage: pkg.homepage,
        });
      } catch {
        // Skip malformed plugin directories
      }
    }
  } catch {
    // pluginsDir unreadable
  }

  return entries;
}

function scanSkills(skillsDir: string): readonly SkillEntry[] {
  if (!existsSync(skillsDir)) return [];

  const entries: SkillEntry[] = [];

  try {
    const files = readdirSync(skillsDir, { withFileTypes: true });
    for (const dirent of files) {
      const isMarkdown = !dirent.isDirectory() && extname(dirent.name) === ".md";
      const isDirectory = dirent.isDirectory();

      if (!isMarkdown && !isDirectory) continue;

      const skillId = isMarkdown ? basename(dirent.name, ".md") : dirent.name;

      const contentPath = isDirectory
        ? join(skillsDir, dirent.name, "SKILL.md")
        : join(skillsDir, dirent.name);

      if (!existsSync(contentPath)) continue;

      try {
        const content = readFileSync(contentPath, "utf-8");
        const meta = extractSkillFrontmatter(content);

        entries.push({
          id: skillId,
          name: meta.name ?? skillId,
          description: meta.description ?? "",
          version: meta.version ?? "1.0.0",
          author: meta.author ?? "unknown",
          tags: meta.tags ?? [],
          installCommand: `wotann skills install ${skillId}`,
        });
      } catch {
        // Skip unreadable skill files
      }
    }
  } catch {
    // skillsDir unreadable
  }

  return entries;
}

// ── Frontmatter Parser ─────────────────────────────────────────

interface SkillFrontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly version?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
}

function extractSkillFrontmatter(content: string): SkillFrontmatter {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    // Fall back to first heading as name, first paragraph as description
    const headingMatch = content.match(/^#\s+(.+)/m);
    const paraMatch = content.match(/^[^#\n].{10,}/m);
    return {
      name: headingMatch?.[1]?.trim(),
      description: paraMatch?.[0]?.trim()?.slice(0, 200),
    };
  }

  const frontmatter = fmMatch[1] ?? "";
  const lines = frontmatter.split("\n");
  const result: Record<string, string | string[]> = {};

  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.+)/);
    if (kv) {
      const key = kv[1]!;
      const value = kv[2]!.trim();
      // Handle array values like "tags: [a, b, c]"
      if (value.startsWith("[") && value.endsWith("]")) {
        result[key] = value
          .slice(1, -1)
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      } else {
        result[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }

  return {
    name: typeof result["name"] === "string" ? result["name"] : undefined,
    description: typeof result["description"] === "string" ? result["description"] : undefined,
    version: typeof result["version"] === "string" ? result["version"] : undefined,
    author: typeof result["author"] === "string" ? result["author"] : undefined,
    tags: Array.isArray(result["tags"]) ? result["tags"] : undefined,
  };
}
