/**
 * Path realpath/symlink defence helpers — Wave 3-S.
 *
 * Closes inherited Claude Code CVE classes:
 *   - CVE-2026-25724: deny-list bypass via symlink. Pure path.resolve is
 *     lexical only; `safe.txt` symlinked to `../../../package.json` evades
 *     any matcher that checks the raw user-supplied path. The fix is to
 *     resolve through realpath BEFORE matching, so the canonical target is
 *     what the matcher sees.
 *   - CVE-2026-39861: symlink sandbox-escape on write. `writeFileSync`
 *     follows existing symlinks at the leaf, so an attacker who
 *     pre-creates `harmless.txt` as a symlink to `~/.ssh/authorized_keys`
 *     gets us to write through to the target. Wrap writes with O_NOFOLLOW
 *     (POSIX) or an explicit lstat precheck (cross-platform fallback).
 *
 * This module is stateless. Every helper is pure: input -> output, no
 * shared globals, no caches. Designed for defence-in-depth — the caller
 * keeps its existing matcher AND consults this helper, so a bug in either
 * layer alone does not open the gate.
 */

import {
  existsSync,
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  writeSync,
  constants as fsConstants,
  type WriteFileOptions,
} from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

// ── canonicalizePathForCheck ────────────────────────────────

/**
 * Resolve `p` through every symlink in its prefix and return the canonical
 * absolute path. ENOENT-safe: when the leaf does not exist, walk up the
 * parent chain until we hit a real ancestor, realpath() that ancestor,
 * then re-append the unresolved tail. This mirrors the
 * `canonicalizeExistingPrefix` pattern already used in
 * src/tools/hashline-edits.ts so the two callers cannot disagree about
 * what "canonical" means.
 *
 * Used by deny-list matchers (file-freeze, secret-scanner, sensitive
 * file regex, command sanitizer) to ensure they evaluate the REAL
 * target, not the lexically-resolved input.
 *
 * Defensive: on any unexpected failure we return the lexically-resolved
 * path. Callers should treat a "differs from raw" canonical as a strong
 * signal — when in doubt, BLOCK (QB#6 honest fallback: better to refuse
 * a legit write than approve a malicious one).
 */
export function canonicalizePathForCheck(p: string): string {
  if (p.length === 0) return p;
  // Lexical resolution first — collapses `..` and produces an absolute
  // path. Without this, downstream realpath calls misbehave on relative
  // inputs.
  const lexical = resolvePath(p);
  return canonicalizeExistingPrefix(lexical);
}

/**
 * Internal helper: walk up `p` until an ancestor exists, realpath() it,
 * re-append the trailing components. Cap walk depth at 64 levels to
 * avoid pathological loops.
 */
function canonicalizeExistingPrefix(p: string): string {
  let current = p;
  const trailing: string[] = [];
  for (let i = 0; i < 64; i += 1) {
    if (existsSync(current)) {
      try {
        const real = realpathSync(current);
        if (trailing.length === 0) return real;
        // trailing was built leaf-first; reverse so the path is rebuilt
        // in normal root-to-leaf order.
        return resolvePath(real, ...trailing.reverse());
      } catch {
        // realpath of an existing entry can still throw on EACCES /
        // ELOOP. Fall back to the lexical input — caller's defence-in-
        // depth checks (assertNotSymlink, raw-path match) are still
        // armed.
        return p;
      }
    }
    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    trailing.push(current.slice(parent.length + 1));
    current = parent;
  }
  return p;
}

// ── assertNotSymlink ────────────────────────────────────────

/**
 * Throw if `path` exists AND is a symlink. Used as defence-in-depth
 * alongside `canonicalizePathForCheck` and `safeWriteFile` — even if
 * one layer mis-resolves, this layer refuses to operate on a symlink
 * leaf.
 *
 * NON-existing paths pass silently. The caller is presumed to be about
 * to create a fresh file; the write itself is what `safeWriteFile`
 * guards.
 */
export function assertNotSymlink(path: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (err: unknown) {
    // ENOENT is fine — file doesn't exist, nothing to follow. Other
    // errno codes (EACCES, ELOOP, EIO) are suspicious; honest fallback
    // (QB#6) is to BLOCK rather than silently succeed.
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") return;
    throw new Error(
      `assertNotSymlink: lstat failed for ${path}: ${e?.code ?? e?.message ?? "unknown"}`,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`assertNotSymlink: refusing to operate on symbolic link at ${path}`);
  }
}

// ── safeWriteFile ───────────────────────────────────────────

/**
 * O_NOFOLLOW value on Linux (0x20000) and macOS (0x100). The numeric
 * differs by platform; we resolve from `fs.constants.O_NOFOLLOW` when
 * it's exported, falling back to a runtime lstat precheck on platforms
 * where the constant is not defined (Windows).
 *
 * Why prefer O_NOFOLLOW over a precheck: the precheck is a TOCTOU
 * window — between lstat and open the attacker can swap the file. On
 * POSIX, O_NOFOLLOW makes the open syscall itself refuse to follow a
 * symlink at the leaf, eliminating the race.
 */
function getONofollowFlag(): number | null {
  // Node exposes O_NOFOLLOW on POSIX; the constant is undefined on
  // Windows. We check membership rather than truthiness so we don't
  // pick up a falsy zero from a pathological build.
  const c = fsConstants as unknown as Record<string, number | undefined>;
  if (typeof c["O_NOFOLLOW"] === "number") return c["O_NOFOLLOW"];
  return null;
}

export interface SafeWriteOptions {
  /** File mode for newly-created files. Default: 0o644. */
  readonly mode?: number;
}

/**
 * Write `content` to `path` with symlink-following defence. On POSIX the
 * underlying open() is called with O_WRONLY | O_CREAT | O_TRUNC |
 * O_NOFOLLOW so a pre-existing symlink at the leaf causes the syscall to
 * fail with ELOOP rather than silently overwrite the symlink target. On
 * platforms without O_NOFOLLOW (Windows) we fall back to an lstat
 * precheck — race-prone but better than nothing.
 *
 * Parent directories must already exist; this helper does NOT mkdir.
 * Callers that need recursive directory creation should call mkdirSync
 * explicitly first (and then this helper).
 *
 * Behaviour matches `writeFileSync(path, content)` for happy-path:
 * truncate-or-create, write all of content, close. On failure throws
 * the underlying syscall error.
 */
export function safeWriteFile(
  path: string,
  content: string | Buffer,
  options: SafeWriteOptions = {},
): void {
  const mode = options.mode ?? 0o644;
  const noFollow = getONofollowFlag();

  if (noFollow === null) {
    // Windows / non-POSIX fallback: lstat precheck + plain open. There
    // is a TOCTOU window here that we cannot close; document the gap
    // rather than pretend it isn't there (QB#6 honest fallback).
    assertNotSymlink(path);
    const fd = openSync(path, "w", mode);
    try {
      const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
      writeSync(fd, buf, 0, buf.length, null);
    } finally {
      closeSync(fd);
    }
    return;
  }

  // POSIX path — atomic refusal via O_NOFOLLOW. The flag combination is
  // equivalent to `wx`-but-allow-overwrite-of-non-symlinks.
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | noFollow;
  let fd: number;
  try {
    fd = openSync(path, flags, mode);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    // ELOOP = symlink at the leaf was refused by O_NOFOLLOW. Surface a
    // clear error so the caller can distinguish symlink rejection from
    // other write failures.
    if (e?.code === "ELOOP") {
      throw new Error(
        `safeWriteFile: refused to follow symbolic link at ${path} (CVE-2026-39861 defence)`,
      );
    }
    throw err;
  }
  try {
    const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    writeSync(fd, buf, 0, buf.length, null);
  } finally {
    closeSync(fd);
  }
}

/**
 * Convenience: writeFileSync-shaped wrapper that accepts the same
 * `WriteFileOptions` shape (encoding/mode/flag) some legacy call sites
 * pass. Encoding is honoured for string inputs; mode is honoured for
 * new file creation; the `flag` field is IGNORED — symlink refusal is
 * non-negotiable in this helper.
 */
export function safeWriteFileCompat(
  path: string,
  content: string | Buffer,
  options?: WriteFileOptions,
): void {
  let mode: number | undefined;
  if (options !== null && typeof options === "object") {
    const m = (options as { mode?: number }).mode;
    if (typeof m === "number") mode = m;
  }
  safeWriteFile(path, content, mode !== undefined ? { mode } : {});
}
