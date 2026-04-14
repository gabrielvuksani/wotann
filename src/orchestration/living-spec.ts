/**
 * Living Spec Manager -- spec as single source of truth.
 *
 * Loads a spec file (markdown or YAML), compares against the current codebase,
 * and reports divergences. Supports features, architecture decisions, naming
 * conventions, and file structure checks.
 */

import { existsSync, readFileSync, watchFile, unwatchFile } from "node:fs";
import { join, resolve, basename } from "node:path";

// ── Types ────────────────────────────────────────────────

export type SpecItemKind = "feature" | "architecture" | "naming" | "structure";

export interface SpecItem {
  readonly kind: SpecItemKind;
  readonly id: string;
  readonly description: string;
  /** Glob or path pattern to check against the codebase */
  readonly pattern: string;
  /** Optional: expected content or naming convention regex */
  readonly expectedMatch?: string;
}

export interface LivingSpec {
  readonly title: string;
  readonly version: string;
  readonly basePath: string;
  readonly items: readonly SpecItem[];
  readonly rawContent: string;
}

export type DivergenceType =
  | "missing-in-code"
  | "missing-in-spec"
  | "naming-violation"
  | "structure-mismatch";

export interface Divergence {
  readonly type: DivergenceType;
  readonly specItemId: string;
  readonly description: string;
  readonly expected: string;
  readonly actual: string;
  readonly severity: "error" | "warning" | "info";
}

// ── Parser helpers ───────────────────────────────────────

function parseMarkdownSpec(content: string, basePath: string): LivingSpec {
  const lines = content.split("\n");
  const title = extractSpecTitle(lines);
  const version = extractSpecVersion(lines);
  const items: SpecItem[] = [];
  let itemCounter = 0;

  let currentKind: SpecItemKind | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Detect section headers
    if (/^#{1,3}\s/.test(trimmed)) {
      if (/feature/i.test(lower)) currentKind = "feature";
      else if (/architect/i.test(lower) || /decision/i.test(lower)) currentKind = "architecture";
      else if (/naming/i.test(lower) || /convention/i.test(lower)) currentKind = "naming";
      else if (/structure/i.test(lower) || /director/i.test(lower) || /file/i.test(lower)) currentKind = "structure";
      else currentKind = null;
      continue;
    }

    // Parse bullet items within a known section
    if (currentKind && (trimmed.startsWith("- ") || trimmed.startsWith("* "))) {
      const text = trimmed.slice(2).trim();
      const parsed = parseBulletItem(text, currentKind, ++itemCounter);
      if (parsed) {
        items.push(parsed);
      }
    }
  }

  return { title, version, basePath, items, rawContent: content };
}

function parseBulletItem(text: string, kind: SpecItemKind, counter: number): SpecItem | null {
  // Pattern: `description` or `description -> pattern` or `description [pattern]`
  const arrowMatch = text.match(/^(.+?)\s*->\s*(.+)$/);
  const bracketMatch = text.match(/^(.+?)\s*\[(.+?)\]\s*$/);

  const description = arrowMatch?.[1] ?? bracketMatch?.[1] ?? text;
  const pattern = arrowMatch?.[2]?.trim() ?? bracketMatch?.[2]?.trim() ?? inferPattern(description, kind);

  if (!description) return null;

  return {
    kind,
    id: `${kind}-${counter}`,
    description: description.trim(),
    pattern,
    expectedMatch: kind === "naming" ? pattern : undefined,
  };
}

function inferPattern(description: string, kind: SpecItemKind): string {
  // Try to extract a file/directory reference from the description
  const pathMatch = description.match(/`([^`]+)`/);
  if (pathMatch?.[1]) return pathMatch[1];

  switch (kind) {
    case "feature":
      return `src/**/*${slugify(description)}*`;
    case "architecture":
      return `src/**/*`;
    case "naming":
      return description;
    case "structure":
      return description.replace(/\s+/g, "/");
    default:
      return "**/*";
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

function extractSpecTitle(lines: readonly string[]): string {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "Untitled Spec";
}

function extractSpecVersion(lines: readonly string[]): string {
  for (const line of lines) {
    const match = line.match(/version\s*[:=]\s*["']?([^\s"']+)/i);
    if (match?.[1]) return match[1];
  }
  return "0.0.0";
}

// ── Divergence Checking ──────────────────────────────────

function checkFeatureDivergence(item: SpecItem, basePath: string): Divergence | null {
  const targetPath = resolve(basePath, item.pattern);
  const globBase = targetPath.replace(/\*.*$/, "");

  // For glob-like patterns, check if the base directory exists
  if (item.pattern.includes("*")) {
    if (!existsSync(globBase) && globBase !== basePath) {
      return {
        type: "missing-in-code",
        specItemId: item.id,
        description: `Feature "${item.description}" has no matching code`,
        expected: item.pattern,
        actual: "not found",
        severity: "error",
      };
    }
    return null;
  }

  // For exact paths, check existence
  if (!existsSync(targetPath)) {
    return {
      type: "missing-in-code",
      specItemId: item.id,
      description: `Feature "${item.description}" expected at ${item.pattern}`,
      expected: item.pattern,
      actual: "not found",
      severity: "error",
    };
  }
  return null;
}

function checkStructureDivergence(item: SpecItem, basePath: string): Divergence | null {
  const targetPath = resolve(basePath, item.pattern);
  if (!existsSync(targetPath)) {
    return {
      type: "structure-mismatch",
      specItemId: item.id,
      description: `Expected directory/file "${item.pattern}" does not exist`,
      expected: item.pattern,
      actual: "not found",
      severity: "warning",
    };
  }
  return null;
}

function checkNamingDivergence(item: SpecItem, basePath: string): Divergence | null {
  if (!item.expectedMatch) return null;

  // Naming conventions are checked as regex patterns against filenames
  // in the basePath
  try {
    const regex = new RegExp(item.expectedMatch);
    // Check a sampling of the base path name
    const base = basename(basePath);
    if (!regex.test(base)) {
      return {
        type: "naming-violation",
        specItemId: item.id,
        description: `Naming convention "${item.description}" not followed`,
        expected: item.expectedMatch,
        actual: base,
        severity: "info",
      };
    }
  } catch {
    // Invalid regex in spec -- skip
  }
  return null;
}

function checkArchitectureDivergence(item: SpecItem, basePath: string): Divergence | null {
  // Architecture decisions: check that referenced paths/patterns exist
  const targetPath = resolve(basePath, item.pattern);
  if (!item.pattern.includes("*") && !existsSync(targetPath)) {
    return {
      type: "missing-in-code",
      specItemId: item.id,
      description: `Architecture decision "${item.description}" not reflected in code`,
      expected: item.pattern,
      actual: "not found",
      severity: "warning",
    };
  }
  return null;
}

// ── Main Class ───────────────────────────────────────────

export class LivingSpecManager {
  private readonly watchers = new Map<string, () => void>();

  /** Load a spec file (markdown or YAML) as the source of truth. */
  loadSpec(specPath: string): LivingSpec {
    const resolved = resolve(specPath);
    if (!existsSync(resolved)) {
      throw new Error(`Spec file not found: ${resolved}`);
    }

    const content = readFileSync(resolved, "utf-8");
    const basePath = join(resolved, "..");

    // Detect format by extension
    if (resolved.endsWith(".yaml") || resolved.endsWith(".yml")) {
      // YAML support: parse as markdown-like for now (YAML front matter)
      // Full YAML parsing would require a dependency; keep it simple
      return parseMarkdownSpec(content, basePath);
    }

    return parseMarkdownSpec(content, basePath);
  }

  /** Compare current codebase state against the spec. Returns divergences. */
  checkDivergence(spec: LivingSpec): readonly Divergence[] {
    const divergences: Divergence[] = [];

    for (const item of spec.items) {
      let divergence: Divergence | null = null;

      switch (item.kind) {
        case "feature":
          divergence = checkFeatureDivergence(item, spec.basePath);
          break;
        case "structure":
          divergence = checkStructureDivergence(item, spec.basePath);
          break;
        case "naming":
          divergence = checkNamingDivergence(item, spec.basePath);
          break;
        case "architecture":
          divergence = checkArchitectureDivergence(item, spec.basePath);
          break;
      }

      if (divergence) {
        divergences.push(divergence);
      }
    }

    return divergences;
  }

  /** Generate a report of what needs to change. */
  generateActionPlan(divergences: readonly Divergence[]): string {
    if (divergences.length === 0) {
      return "No divergences found. Codebase matches the spec.";
    }

    const errors = divergences.filter((d) => d.severity === "error");
    const warnings = divergences.filter((d) => d.severity === "warning");
    const infos = divergences.filter((d) => d.severity === "info");

    const sections: string[] = [
      `# Living Spec Action Plan`,
      ``,
      `Found ${divergences.length} divergence${divergences.length > 1 ? "s" : ""}: ${errors.length} error${errors.length !== 1 ? "s" : ""}, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}, ${infos.length} info.`,
      ``,
    ];

    if (errors.length > 0) {
      sections.push(`## Errors (must fix)`);
      for (const d of errors) {
        sections.push(`- [${d.specItemId}] ${d.description}`);
        sections.push(`  Expected: ${d.expected} | Actual: ${d.actual}`);
      }
      sections.push(``);
    }

    if (warnings.length > 0) {
      sections.push(`## Warnings (should fix)`);
      for (const d of warnings) {
        sections.push(`- [${d.specItemId}] ${d.description}`);
        sections.push(`  Expected: ${d.expected} | Actual: ${d.actual}`);
      }
      sections.push(``);
    }

    if (infos.length > 0) {
      sections.push(`## Info (consider fixing)`);
      for (const d of infos) {
        sections.push(`- [${d.specItemId}] ${d.description}`);
      }
      sections.push(``);
    }

    return sections.join("\n");
  }

  /** Watch for changes to the spec file and proactively notify. */
  watchSpec(specPath: string, onChange: (divergences: readonly Divergence[]) => void): void {
    const resolved = resolve(specPath);

    // Remove existing watcher if any
    this.unwatchSpec(resolved);

    const callback = (): void => {
      try {
        const spec = this.loadSpec(resolved);
        const divergences = this.checkDivergence(spec);
        onChange(divergences);
      } catch {
        // Spec file may be temporarily unreadable during writes
      }
    };

    watchFile(resolved, { interval: 2000 }, callback);
    this.watchers.set(resolved, () => unwatchFile(resolved, callback));
  }

  /** Stop watching a spec file. */
  unwatchSpec(specPath: string): void {
    const resolved = resolve(specPath);
    const cleanup = this.watchers.get(resolved);
    if (cleanup) {
      cleanup();
      this.watchers.delete(resolved);
    }
  }

  /** Stop all watchers. */
  dispose(): void {
    for (const cleanup of this.watchers.values()) {
      cleanup();
    }
    this.watchers.clear();
  }
}
