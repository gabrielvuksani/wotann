/**
 * Virtual Path System — isolate agents from the real filesystem layout.
 *
 * Inspired by DeerFlow's virtual path mapping. Agents operate against
 * virtual path prefixes (e.g. `/mnt/workspace/`) which are transparently
 * resolved to physical locations on disk.
 *
 * Benefits:
 * - Agents never see the user's real home directory or absolute paths
 * - Multiple workspaces can be mounted under different prefixes
 * - Read-only mounts prevent accidental writes to protected directories
 * - Path translation is consistent and reversible
 */

import { join, normalize, relative, isAbsolute, sep } from "node:path";

// ── Types ────────────────────────────────────────────────────

export interface VirtualPathConfig {
  readonly prefix: string;
  readonly physicalRoot: string;
  readonly readOnly: boolean;
}

export interface ResolvedPath {
  readonly virtualPath: string;
  readonly physicalPath: string;
  readonly mount: VirtualPathConfig;
  readonly readOnly: boolean;
  readonly relativePath: string;
}

export interface MountValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

// ── Virtual Path Resolver ────────────────────────────────────

export class VirtualPathResolver {
  private readonly mounts: readonly VirtualPathConfig[];

  constructor(mounts?: readonly VirtualPathConfig[]) {
    const validated = (mounts ?? []).map(normalizeMount);
    // Sort by prefix length descending so more specific mounts match first
    this.mounts = [...validated].sort(
      (a, b) => b.prefix.length - a.prefix.length,
    );
  }

  /**
   * Resolve a virtual path to a physical path.
   * Returns null if no mount matches the virtual path.
   */
  resolve(virtualPath: string): ResolvedPath | null {
    const normalized = normalizePath(virtualPath);
    const mount = this.findMount(normalized);
    if (!mount) return null;

    const relativePath = normalized.slice(mount.prefix.length);
    const physicalPath = normalize(join(mount.physicalRoot, relativePath));

    // Security: ensure the resolved path is still under the mount root
    if (!isUnderRoot(physicalPath, mount.physicalRoot)) {
      return null;
    }

    return {
      virtualPath: normalized,
      physicalPath,
      mount,
      readOnly: mount.readOnly,
      relativePath: relativePath || ".",
    };
  }

  /**
   * Convert a physical path to its virtual equivalent.
   * Returns null if the physical path is not under any mount.
   */
  virtualize(physicalPath: string): string | null {
    const normalizedPhysical = normalize(physicalPath);

    for (const mount of this.mounts) {
      if (isUnderRoot(normalizedPhysical, mount.physicalRoot)) {
        const rel = relative(mount.physicalRoot, normalizedPhysical);
        if (rel.startsWith("..")) continue;
        return normalizePath(join(mount.prefix, rel));
      }
    }

    return null;
  }

  /**
   * Check whether a virtual path is writable (not in a read-only mount).
   */
  isWritable(virtualPath: string): boolean {
    const resolved = this.resolve(virtualPath);
    if (!resolved) return false;
    return !resolved.readOnly;
  }

  /**
   * Check whether a virtual path is valid (matches a mount).
   */
  isValid(virtualPath: string): boolean {
    return this.resolve(virtualPath) !== null;
  }

  /**
   * Get all configured mounts.
   */
  getMounts(): readonly VirtualPathConfig[] {
    return this.mounts;
  }

  /**
   * Create a new resolver with an additional mount.
   * Returns a new instance (immutable pattern).
   */
  withMount(mount: VirtualPathConfig): VirtualPathResolver {
    return new VirtualPathResolver([...this.mounts, mount]);
  }

  /**
   * Create a new resolver without the specified prefix.
   * Returns a new instance (immutable pattern).
   */
  withoutMount(prefix: string): VirtualPathResolver {
    const normalizedPrefix = ensureTrailingSep(normalizePath(prefix));
    return new VirtualPathResolver(
      this.mounts.filter((m) => m.prefix !== normalizedPrefix),
    );
  }

  /**
   * Validate mount configurations for common issues.
   */
  static validateMounts(
    mounts: readonly VirtualPathConfig[],
  ): MountValidation {
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const mount of mounts) {
      const normalized = ensureTrailingSep(normalizePath(mount.prefix));

      if (normalized.length === 0 || normalized === "/") {
        errors.push(`Mount prefix "${mount.prefix}" is too broad (root mount).`);
      }

      if (seen.has(normalized)) {
        errors.push(`Duplicate mount prefix: "${mount.prefix}".`);
      }
      seen.add(normalized);

      if (!isAbsolute(mount.physicalRoot)) {
        errors.push(
          `Physical root for "${mount.prefix}" must be absolute, got "${mount.physicalRoot}".`,
        );
      }
    }

    // Check for overlapping prefixes
    const prefixes = [...seen];
    for (let i = 0; i < prefixes.length; i++) {
      for (let j = i + 1; j < prefixes.length; j++) {
        const a = prefixes[i]!;
        const b = prefixes[j]!;
        if (a.startsWith(b) || b.startsWith(a)) {
          errors.push(`Overlapping mount prefixes: "${a}" and "${b}".`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ── Private Helpers ────────────────────────────────────────

  private findMount(normalizedVirtualPath: string): VirtualPathConfig | undefined {
    return this.mounts.find((m) => normalizedVirtualPath.startsWith(m.prefix));
  }
}

// ── Module-Level Helpers ─────────────────────────────────────

function normalizePath(p: string): string {
  // Normalize to forward slashes for consistency
  return normalize(p).replace(/\\/g, "/");
}

function ensureTrailingSep(p: string): string {
  const normalizedSep = "/";
  return p.endsWith(normalizedSep) ? p : p + normalizedSep;
}

function normalizeMount(mount: VirtualPathConfig): VirtualPathConfig {
  return {
    prefix: ensureTrailingSep(normalizePath(mount.prefix)),
    physicalRoot: normalize(mount.physicalRoot),
    readOnly: mount.readOnly,
  };
}

function isUnderRoot(path: string, root: string): boolean {
  const normalizedPath = normalize(path);
  const normalizedRoot = normalize(root);
  const rel = relative(normalizedRoot, normalizedPath);
  return !rel.startsWith("..") && !isAbsolute(rel);
}
