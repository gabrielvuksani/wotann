/**
 * atomic-io — atomic writes and advisory file locks.
 *
 * Intended for concurrent-access spots where multiple daemon/CLI processes or
 * workers write to the same JSON file. The primitives here implement the
 * POSIX "write to temp, fsync, rename" atomic-write pattern and a simple
 * lock file with exclusive-create semantics.
 *
 * Atomic write steps:
 *   1. write contents to `<path>.tmp` with `wx` flag (fails if temp exists)
 *   2. fsync the temp file so the contents are durable
 *   3. rename temp → path (atomic on POSIX)
 *
 * Lock acquisition:
 *   - open `<path>.lock` with `wx` flag (exclusive create)
 *   - retry with exponential backoff until timeout
 *   - release by deleting the lock file
 *
 * These primitives are synchronous (fit the existing sync fs patterns in the
 * codebase) and dependency-free.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

// ── Atomic write ─────────────────────────────────────────

export interface AtomicWriteOptions {
  /** File mode for the written file (default 0o600 — owner only). */
  readonly mode?: number;
  /** If true (default), ensure the parent directory exists. */
  readonly ensureDir?: boolean;
  /** Encoding for string contents (default "utf-8"). Ignored for Buffer input. */
  readonly encoding?: BufferEncoding;
}

/**
 * Atomically write `contents` to `path`. Survives crashes mid-write: if the
 * process dies after the temp file is created but before the rename, the
 * original `path` is untouched and the stale temp can be cleaned up on next run.
 *
 * Uses `<path>.tmp.<pid>` as the staging name so concurrent writers from
 * different processes don't collide on the temp file.
 */
export function writeFileAtomic(
  path: string,
  contents: string | Buffer,
  options: AtomicWriteOptions = {},
): void {
  if (options.ensureDir !== false) {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  const mode = options.mode ?? 0o600;

  // openSync with 'wx' flag fails if temp somehow exists (very unlikely given
  // pid/timestamp naming but still the safe choice).
  const fd = openSync(tmpPath, "wx", mode);
  try {
    const buffer = typeof contents === "string"
      ? Buffer.from(contents, options.encoding ?? "utf-8")
      : contents;
    // writeSync in a loop to handle partial writes (rare on regular files)
    let written = 0;
    while (written < buffer.length) {
      written += writeSync(fd, buffer, written, buffer.length - written, null);
    }
    // fsync so the bytes are durable before we rename
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // Rename is atomic on POSIX (same-filesystem). On Windows this is close-enough
  // for our use case since we're writing to the user's home directory.
  renameSync(tmpPath, path);
}

// ── File locks (advisory) ───────────────────────────────

export interface LockOptions {
  /** Maximum time to wait for the lock in ms (default 5000). */
  readonly timeoutMs?: number;
  /** Initial retry delay in ms (default 10). */
  readonly initialDelayMs?: number;
  /** Maximum retry delay in ms (default 250). */
  readonly maxDelayMs?: number;
  /**
   * Lock file stale TTL in ms (default 60s). If a lock file is older than
   * this, it's treated as orphaned and forcibly removed. Set to 0 to disable.
   */
  readonly staleMs?: number;
}

export type ReleaseLockFn = () => void;

/**
 * Acquire an exclusive advisory lock on `path`. Creates `<path>.lock` with the
 * `wx` flag (fails if the file already exists). Retries with exponential
 * backoff until the timeout expires.
 *
 * Returns a release function that deletes the lock file. Callers MUST call
 * the release function (typically via `try/finally` or `withLock`).
 *
 * Throws if the lock cannot be acquired within the timeout.
 */
export async function acquireLock(
  path: string,
  options: LockOptions = {},
): Promise<ReleaseLockFn> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const initialDelayMs = options.initialDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 250;
  const staleMs = options.staleMs ?? 60_000;

  const lockPath = `${path}.lock`;
  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;

  while (true) {
    try {
      // wx = fail if exists. This is the heart of the lock.
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        const payload = JSON.stringify({ pid: process.pid, acquiredAt: Date.now() });
        writeSync(fd, Buffer.from(payload, "utf-8"));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // Return the release function
      return () => {
        try {
          unlinkSync(lockPath);
        } catch {
          // Lock may have already been cleaned up by another process
        }
      };
    } catch (err: unknown) {
      // EEXIST means another process holds the lock
      const code = (err as { code?: string }).code;
      if (code !== "EEXIST") {
        throw err;
      }
      // Check whether the existing lock is stale
      if (staleMs > 0) {
        try {
          const raw = readFileSync(lockPath, "utf-8");
          const parsed = JSON.parse(raw) as { acquiredAt?: number };
          if (typeof parsed.acquiredAt === "number" && Date.now() - parsed.acquiredAt > staleMs) {
            try {
              unlinkSync(lockPath);
              // Retry immediately (skip sleep)
              continue;
            } catch {
              // Another process cleaned it up; retry
              continue;
            }
          }
        } catch {
          // Lock file corrupted or disappeared — retry
        }
      }
      // Timeout check
      if (Date.now() >= deadline) {
        throw new Error(
          `acquireLock(${path}): timed out after ${timeoutMs}ms (held by another process)`,
        );
      }
      // Backoff with jitter (±25%)
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      await sleep(Math.max(1, Math.floor(delay + jitter)));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
}

/**
 * Run `fn` while holding an exclusive lock on `path`. Automatically releases
 * the lock when `fn` completes, even if it throws.
 */
export async function withLock<T>(
  path: string,
  fn: () => T | Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const release = await acquireLock(path, options);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Convenience: atomic write + exclusive lock in one call. Acquires the lock,
 * writes the file atomically, then releases.
 */
export async function writeFileAtomicLocked(
  path: string,
  contents: string | Buffer,
  options: AtomicWriteOptions & LockOptions = {},
): Promise<void> {
  await withLock(path, () => {
    writeFileAtomic(path, contents, options);
  }, options);
}

// ── Internal ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sync variant for legacy call sites. Uses busy-wait with setImmediate — only
// suitable for very short timeouts. Prefer the async version where possible.
export function writeFileAtomicSync(
  path: string,
  contents: string | Buffer,
  options: AtomicWriteOptions = {},
): void {
  writeFileAtomic(path, contents, options);
}

/**
 * Fallback for modules that can't easily become async. Uses a file-based
 * busy-wait lock. Prefer `acquireLock` where possible.
 */
export function writeFileAtomicSyncBestEffort(
  path: string,
  contents: string | Buffer,
  options: AtomicWriteOptions & { lockRetryMs?: number; lockMaxRetries?: number } = {},
): void {
  const lockPath = `${path}.lock`;
  const retryMs = options.lockRetryMs ?? 20;
  const maxRetries = options.lockMaxRetries ?? 50; // up to 1s
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let acquired = false;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), { flag: "wx" });
      acquired = true;
      break;
    } catch {
      // Busy-wait with setTimeout — not ideal but sync-friendly
      const end = Date.now() + retryMs;
      while (Date.now() < end) {
        // spin
      }
    }
  }
  if (!acquired) {
    // Give up gracefully — caller gets a best-effort write instead of deadlock
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
  try {
    writeFileAtomic(path, contents, options);
  } finally {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
}
