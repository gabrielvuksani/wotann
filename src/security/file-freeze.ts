/**
 * File Freeze — prevent accidental modification of protected files.
 *
 * Inspired by KiloCode's File Freezing. Freezes files, directories, and
 * glob patterns. Any Edit/Write tool call against a frozen path is blocked
 * by the hook engine before it reaches the filesystem.
 *
 * Use cases:
 * - Protect config files during debugging (tsconfig, eslint, etc.)
 * - Lock finished modules while working on adjacent code
 * - Prevent tooling writes to vendor/generated dirs
 * - Focus mode: only allow edits to a single file/directory
 */

import { resolve, relative, isAbsolute } from "node:path";
import { canonicalizePathForCheck } from "../utils/path-realpath.js";

export interface FreezeRule {
  readonly pattern: string;
  readonly reason: string;
  readonly frozenAt: number;
  readonly frozenBy: string;
  readonly permanent: boolean;
}

export interface FreezeCheckResult {
  readonly frozen: boolean;
  readonly rule?: FreezeRule;
  readonly resolvedPath: string;
}

export class FileFreezer {
  private readonly rules: FreezeRule[] = [];
  private readonly workingDir: string;
  private focusPath: string | null = null;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  /**
   * Freeze a file, directory, or glob pattern.
   */
  freeze(
    pattern: string,
    reason: string = "Manual freeze",
    permanent: boolean = false,
  ): FreezeRule {
    const existing = this.rules.find((r) => r.pattern === pattern);
    if (existing) return existing;

    const rule: FreezeRule = {
      pattern,
      reason,
      frozenAt: Date.now(),
      frozenBy: "user",
      permanent,
    };
    this.rules.push(rule);
    return rule;
  }

  /**
   * Unfreeze a pattern. Permanent rules cannot be unfrozen.
   */
  unfreeze(pattern: string): boolean {
    const index = this.rules.findIndex((r) => r.pattern === pattern);
    if (index === -1) return false;
    if (this.rules[index]!.permanent) return false;
    this.rules.splice(index, 1);
    return true;
  }

  /**
   * Focus mode: ONLY allow edits to a specific path (file or directory).
   * Everything else becomes frozen.
   */
  setFocus(path: string): void {
    this.focusPath = resolve(this.workingDir, path);
  }

  /**
   * Clear focus mode — return to normal freeze rules.
   */
  clearFocus(): void {
    this.focusPath = null;
  }

  /**
   * Check if a file path is frozen.
   *
   * CVE-2026-25724 defence: pure path.resolve is lexical, so a symlink
   * `safe.txt → ../../../package.json` would bypass any freeze rule that
   * matched on the raw path. We canonicalize through realpath BEFORE
   * matching, so the matcher sees the real target. Defence-in-depth:
   * we also check the lexically-resolved path so a freeze rule written
   * against the user-visible name still fires.
   */
  check(filePath: string): FreezeCheckResult {
    const resolved = isAbsolute(filePath) ? filePath : resolve(this.workingDir, filePath);
    const canonical = canonicalizePathForCheck(resolved);
    const rel = relative(this.workingDir, resolved);
    const canonicalRel = relative(this.workingDir, canonical);

    // Focus mode: block everything outside the focus path. We check both
    // the raw resolved path AND the canonical (post-realpath) path —
    // either one outside focus is grounds for blocking.
    if (this.focusPath) {
      const focusRaw = resolved.startsWith(this.focusPath) || resolved === this.focusPath;
      const focusCanonical = canonical.startsWith(this.focusPath) || canonical === this.focusPath;
      if (!focusRaw || !focusCanonical) {
        return {
          frozen: true,
          rule: {
            pattern: `!${this.focusPath}`,
            reason: `Focus mode active: only editing ${relative(this.workingDir, this.focusPath)}`,
            frozenAt: Date.now(),
            frozenBy: "focus-mode",
            permanent: false,
          },
          resolvedPath: resolved,
        };
      }
    }

    // Check explicit freeze rules. A match on EITHER the raw user-supplied
    // path OR the canonical (symlink-resolved) target counts as frozen.
    for (const rule of this.rules) {
      if (matchesPattern(rel, rule.pattern) || matchesPattern(canonicalRel, rule.pattern)) {
        return { frozen: true, rule, resolvedPath: resolved };
      }
    }

    return { frozen: false, resolvedPath: resolved };
  }

  /**
   * Get all active freeze rules.
   */
  getRules(): readonly FreezeRule[] {
    return [...this.rules];
  }

  /**
   * Get focus path if active.
   */
  getFocus(): string | null {
    return this.focusPath;
  }

  /**
   * Reset all non-permanent rules and clear focus.
   */
  reset(): void {
    const permanentRules = this.rules.filter((r) => r.permanent);
    this.rules.length = 0;
    this.rules.push(...permanentRules);
    this.focusPath = null;
  }

  /**
   * Auto-freeze common config files for safe debugging.
   */
  freezeConfigFiles(): readonly string[] {
    const configs = [
      "tsconfig.json",
      "tsconfig.*.json",
      ".eslintrc*",
      ".prettierrc*",
      "biome.json",
      "biome.jsonc",
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      ".env",
      ".env.*",
    ];

    for (const pattern of configs) {
      this.freeze(pattern, "Config protection (debug mode)", false);
    }

    return configs;
  }

  /**
   * Auto-freeze WOTANN's own configuration surface so the agent can't
   * rewrite the policy/skills/memory directories that govern its own
   * behaviour. Inspired by Roo-Code's `RooProtectedController` —
   * `.wotann/**`, `wotann.yaml`, AGENTS.md, CLAUDE.md are all "self-rule"
   * files where an auto-approved Edit would let the agent disable its
   * own safety mechanisms. Always freeze these unless `--no-self-protect`
   * is explicitly passed.
   */
  freezeSelfConfigFiles(): readonly string[] {
    const selfConfigs = [".wotann/**", "wotann.yaml", "wotann.yml", "AGENTS.md", "CLAUDE.md"];
    for (const pattern of selfConfigs) {
      this.freeze(pattern, "Self-config protection (Roo-Code pattern)", false);
    }
    return selfConfigs;
  }
}

/**
 * Match a relative path against a freeze pattern.
 * Supports: exact match, extension wildcard, directory prefix, simple glob.
 */
function matchesPattern(relativePath: string, pattern: string): boolean {
  // Exact match
  if (relativePath === pattern) return true;

  // Directory prefix: "src/core/" matches "src/core/foo.ts"
  if (pattern.endsWith("/") && relativePath.startsWith(pattern)) return true;

  // Extension wildcard: "*.json" matches "tsconfig.json"
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(1);
    if (relativePath.endsWith(ext)) return true;
  }

  // Double-star prefix: "**/*.test.ts" matches "src/tests/foo.test.ts"
  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3);
    if (suffix.startsWith("*.")) {
      const ext = suffix.slice(1);
      if (relativePath.endsWith(ext)) return true;
    }
    if (relativePath.endsWith(suffix)) return true;
  }

  // Glob with single asterisk: ".eslintrc*" matches ".eslintrc.js"
  if (pattern.includes("*") && !pattern.includes("**")) {
    const parts = pattern.split("*");
    if (parts.length === 2) {
      const [prefix, suffix] = parts;
      if (prefix !== undefined && suffix !== undefined) {
        const basename = relativePath.split("/").pop() ?? relativePath;
        if (basename.startsWith(prefix) && basename.endsWith(suffix)) return true;
      }
    }
  }

  return false;
}
