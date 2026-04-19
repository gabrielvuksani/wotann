/**
 * Virtual path scrubbing — deer-flow `/mnt/user-data/*` bidirectional mapper
 * (Lane 2 #8).
 *
 * Agents leak information through file paths: the user's home directory, a
 * project name, maybe even machine-specific directory layouts. deer-flow
 * solves this by NEVER letting the agent see a real path. Every physical
 * path is rewritten to `/mnt/user-data/<bucket>/<rel>` before the model sees
 * it, and every model-emitted path is reversed back to the real filesystem
 * before it reaches the kernel.
 *
 * Unlike `src/core/virtual-paths.ts` (which is a full stateful VFS resolver
 * with mounts + read-only flags + overlap checks), this module is a pure
 * scrub/unscrub pair over a small bucket table. Callers are expected to
 * pipe model I/O through it at the tool boundary:
 *
 *   inbound (user/fs → model):  toVirtual(real) | scrubPaths(text)
 *   outbound (model → fs):      toPhysical(virtual)
 *
 * Semantics:
 *   - Longest-prefix-first substitution. Two buckets `/Users/a/proj` and
 *     `/Users/a/proj/src` both match the latter; the MORE-SPECIFIC one
 *     wins so a nested workspace is not virtualized through its parent.
 *   - Idempotent: toVirtual(toVirtual(x)) === toVirtual(x). A path that
 *     is already virtual round-trips unchanged.
 *   - Safe by default: an unknown physical path is passed through untouched
 *     — we never fabricate a virtual mapping. Caller can opt into
 *     `strict: true` to reject unmapped paths instead.
 *
 * Not a security boundary. Scrubbing is defense-in-depth against prompt
 * leakage, NOT a sandbox — a determined model can still emit literal
 * strings. Pair with `src/sandbox/executor.ts` + seatbelt for real
 * isolation.
 */

import { normalize, sep } from "node:path";

// ── Types ──────────────────────────────────────────────

export interface VirtualBucket {
  /** Virtual prefix the agent sees (e.g. `/mnt/user-data/project`). */
  readonly virtualPrefix: string;
  /** Real physical root this bucket maps to. */
  readonly physicalRoot: string;
}

export interface VirtualPathsConfig {
  readonly buckets: readonly VirtualBucket[];
  /**
   * When true, `toVirtual` / `toPhysical` throw on paths that don't match
   * any bucket. When false (default), unknown paths pass through untouched.
   */
  readonly strict?: boolean;
}

export const DEFAULT_VIRTUAL_ROOT = "/mnt/user-data";

// ── Public API ─────────────────────────────────────────

/**
 * Rewrite a physical path to its virtual equivalent.
 *
 * Longest-physicalRoot-first matching ensures nested buckets win over
 * their parents. If no bucket matches and `strict` is false the input
 * is returned unchanged.
 */
export function toVirtual(physical: string, config: VirtualPathsConfig): string {
  const normalized = normalizeForward(physical);
  const buckets = sortByPhysicalDescending(config.buckets);

  // If already virtual (starts with any virtualPrefix) — idempotent.
  for (const b of buckets) {
    const vp = ensureTrailingSlash(normalizeForward(b.virtualPrefix));
    if (normalized === stripTrailingSlash(vp) || normalized.startsWith(vp)) {
      return normalized;
    }
  }

  for (const b of buckets) {
    const root = ensureTrailingSlash(normalizeForward(b.physicalRoot));
    if (normalized === stripTrailingSlash(root)) {
      return normalizeForward(b.virtualPrefix);
    }
    if (normalized.startsWith(root)) {
      const rel = normalized.slice(root.length);
      return joinForward(b.virtualPrefix, rel);
    }
  }

  if (config.strict) {
    throw new Error(`toVirtual: no bucket matched physical path "${physical}" (strict mode)`);
  }
  return physical;
}

/**
 * Rewrite a virtual path back to its physical equivalent.
 *
 * Longest-virtualPrefix-first matching. When `strict` is false unmapped
 * paths pass through.
 */
export function toPhysical(virtual: string, config: VirtualPathsConfig): string {
  const normalized = normalizeForward(virtual);
  const buckets = sortByVirtualDescending(config.buckets);

  for (const b of buckets) {
    const prefix = ensureTrailingSlash(normalizeForward(b.virtualPrefix));
    if (normalized === stripTrailingSlash(prefix)) {
      return normalizeForward(b.physicalRoot);
    }
    if (normalized.startsWith(prefix)) {
      const rel = normalized.slice(prefix.length);
      return joinForward(b.physicalRoot, rel);
    }
  }

  if (config.strict) {
    throw new Error(`toPhysical: no bucket matched virtual path "${virtual}" (strict mode)`);
  }
  return virtual;
}

/**
 * Replace every physical-root occurrence inside free-form text with its
 * virtual prefix. Used to scrub tool output, stack traces, compiler
 * diagnostics, etc. before they reach the model.
 *
 * Substitution is longest-root-first so nested workspaces scrub
 * correctly (we don't accidentally rewrite `/Users/a/proj/src` as if
 * it lived under `/Users/a`).
 */
export function scrubPaths(text: string, config: VirtualPathsConfig): string {
  if (!text) return text;
  const buckets = sortByPhysicalDescending(config.buckets);
  let out = text;
  for (const b of buckets) {
    const root = normalizeForward(b.physicalRoot);
    if (!root) continue;
    // Use a plain-literal replaceAll to avoid regex injection from path chars.
    out = replaceAllLiteral(out, root, normalizeForward(b.virtualPrefix));
  }
  return out;
}

/**
 * Reverse scrub: rewrite virtual prefixes found in a text blob back to
 * their physical roots. Useful when the model echoes a virtual path in
 * a shell command argument that must hit the real filesystem.
 */
export function unscrubPaths(text: string, config: VirtualPathsConfig): string {
  if (!text) return text;
  const buckets = sortByVirtualDescending(config.buckets);
  let out = text;
  for (const b of buckets) {
    const vp = normalizeForward(b.virtualPrefix);
    if (!vp) continue;
    out = replaceAllLiteral(out, vp, normalizeForward(b.physicalRoot));
  }
  return out;
}

/**
 * Convenience: build a default config mapping a single project root to
 * `/mnt/user-data/project` — the common deer-flow arrangement.
 */
export function makeDefaultConfig(physicalRoot: string): VirtualPathsConfig {
  return {
    buckets: [
      {
        virtualPrefix: `${DEFAULT_VIRTUAL_ROOT}/project`,
        physicalRoot,
      },
    ],
  };
}

/**
 * Validate buckets for common misconfigurations. Returns the list of
 * errors (empty = ok). Does NOT throw — callers decide severity.
 */
export function validateBuckets(buckets: readonly VirtualBucket[]): readonly string[] {
  const errors: string[] = [];
  const seenVirtual = new Set<string>();
  const seenPhysical = new Set<string>();

  for (const b of buckets) {
    const vp = normalizeForward(b.virtualPrefix);
    const pr = normalizeForward(b.physicalRoot);

    if (!vp || vp === "/") {
      errors.push(`bucket virtualPrefix "${b.virtualPrefix}" is empty or root`);
    }
    if (!pr || pr === "/") {
      errors.push(`bucket physicalRoot "${b.physicalRoot}" is empty or root`);
    }
    if (seenVirtual.has(vp)) {
      errors.push(`duplicate virtualPrefix "${vp}"`);
    }
    if (seenPhysical.has(pr)) {
      errors.push(`duplicate physicalRoot "${pr}"`);
    }
    seenVirtual.add(vp);
    seenPhysical.add(pr);
  }

  return errors;
}

// ── Internal helpers ───────────────────────────────────

function normalizeForward(p: string): string {
  if (!p) return p;
  // node's normalize keeps backslashes on win32; convert to POSIX-style for
  // the virtual namespace (agents see a unix-like path regardless of host).
  return normalize(p).split(sep).join("/");
}

function ensureTrailingSlash(p: string): string {
  return p.endsWith("/") ? p : `${p}/`;
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

function joinForward(base: string, rel: string): string {
  const b = stripTrailingSlash(normalizeForward(base));
  const r = rel.replace(/^\/+/, "");
  if (!r) return b;
  return `${b}/${r}`;
}

function sortByPhysicalDescending(buckets: readonly VirtualBucket[]): readonly VirtualBucket[] {
  return [...buckets].sort(
    (a, b) => normalizeForward(b.physicalRoot).length - normalizeForward(a.physicalRoot).length,
  );
}

function sortByVirtualDescending(buckets: readonly VirtualBucket[]): readonly VirtualBucket[] {
  return [...buckets].sort(
    (a, b) => normalizeForward(b.virtualPrefix).length - normalizeForward(a.virtualPrefix).length,
  );
}

function replaceAllLiteral(haystack: string, needle: string, replacement: string): string {
  if (!needle) return haystack;
  // Avoid String.prototype.replaceAll with a regex — path strings can
  // contain regex metacharacters. Do an explicit split+join.
  return haystack.split(needle).join(replacement);
}
