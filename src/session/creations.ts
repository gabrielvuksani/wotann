/**
 * Creations Store — WOTANN Phase 3 P1-F5 (agent-created-file pipeline).
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S9 and the
 * Mythical Perfect Workflow state-transition diagram (§2.2), when an
 * agent writes a file as part of a research / creation task, that file
 * must land on a canonical path AND every registered surface (iOS
 * CreationsView, desktop Creations panel, watch toast, CarPlay ping)
 * must learn that the file now exists. F5 adds that primitive:
 *
 *   disk:    ~/.wotann/creations/<sessionId>/<filename>
 *   event:   UnifiedEvent { type: "file-write", payload: {...} }
 *
 * The design is deliberately narrow:
 *
 *   - One class: CreationsStore. Methods: save / list / get / delete.
 *   - Broadcast is optional — store works standalone in tests; the
 *     daemon wires it to UnifiedDispatchPlane.broadcastUnifiedEvent
 *     (F11 pattern) when constructing the handler.
 *   - All bytes-on-disk work goes through a single resolvePath helper
 *     so the traversal + sanitiser guards cannot be bypassed.
 *
 * Design principles (session quality bars referenced inline):
 *
 *   QB #6 (honest failures) — typed errors for every failure mode:
 *     - ErrorFileTooLarge   — file size > perFileMax
 *     - ErrorQuotaExceeded  — session cumulative > perSessionMax
 *     - ErrorInvalidFilename — filename fails the sanitiser
 *     - ErrorInvalidSessionId — sessionId fails the sanitiser
 *     - ErrorPathTraversal  — resolved path escapes the session root
 *     - ErrorDiskFull       — wraps ENOSPC / EDQUOT from fs
 *   Unknown sessions in `get` return null (not throw) — reads are
 *   expected to race against delete.
 *
 *   QB #7 (per-session state) — the store is an instance. The root
 *   directory is instance config, set at construction. Tests construct
 *   their own instances with a tmp dir; the daemon constructs one per
 *   handler in kairos-rpc.ts.
 *
 *   QB #10 (sibling-site scan) — grep -rn "creations\|\\.wotann/creations
 *   \|CreationsView" src found no prior writer; only the design-doc
 *   mentions of the canonical path. F5 is fresh ground.
 *
 *   QB #12 (deterministic tests) — caller-supplied `now()` clock
 *   drives the `createdAt` timestamp so tests can assert determinism.
 *
 *   QB #14 (claim verification) — the RPC wiring in kairos-rpc.ts is
 *   covered by end-to-end tests in tests/session/creations.test.ts,
 *   not just "added a method and called it done".
 *
 * Non-goals for F5: iOS-side CreationsView wiring (handled separately
 * in the iOS target per deny-list), shadow-git auto-commit of
 * creations (follow-up F6), APNs push notifications on write (wired
 * by the companion-server, not this module).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath, sep as pathSep } from "node:path";
import type { UnifiedEvent } from "../channels/fan-out.js";

// ── Types ──────────────────────────────────────────────────

/**
 * Metadata returned from `save` and each `list` entry. The `sha256`
 * lets surfaces verify integrity when syncing — useful for iOS, which
 * must re-download over a flaky cellular link.
 */
export interface CreationMetadata {
  readonly sessionId: string;
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
  readonly createdAt: number;
  /** Absolute path on disk. Useful for desktop surfaces to open directly. */
  readonly path: string;
}

/**
 * Content + metadata returned from `get`. `content` is a string when
 * text-like, Buffer when binary — callers discriminate on the
 * `encoding` hint we capture at save time.
 */
export interface CreationContent {
  readonly metadata: CreationMetadata;
  /**
   * Raw bytes as read from disk. Callers decide how to decode
   * (utf-8, base64, …). A Buffer is used so binary creations (PDFs,
   * images) survive the round-trip; JSON-RPC adapters base64-encode
   * this on the wire.
   */
  readonly content: Buffer;
}

// ── Fan-out hook ───────────────────────────────────────────

/**
 * Optional broadcast hook. When wired (typically
 * UnifiedDispatchPlane.broadcastUnifiedEvent per F11), each save and
 * delete event fans out to every registered surface. Silently
 * tolerated if undefined so tests and minimal daemons can run without
 * a dispatch plane.
 */
export type BroadcastFn = (event: UnifiedEvent) => void | Promise<void>;

// ── Config ─────────────────────────────────────────────────

export interface CreationsStoreConfig {
  /**
   * Root directory for all creations. Sessions are nested beneath:
   *   <rootDir>/<sessionId>/<filename>
   * Defaults to WOTANN_HOME env var (if set) + "/creations", else
   * ~/.wotann/creations.
   */
  readonly rootDir: string;
  /** Max size of a single file, in bytes. Default 10 MiB. */
  readonly perFileMaxBytes: number;
  /** Max cumulative size of all files in one session, in bytes. Default 100 MiB. */
  readonly perSessionMaxBytes: number;
}

const DEFAULT_PER_FILE_MAX = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_PER_SESSION_MAX = 100 * 1024 * 1024; // 100 MiB

/**
 * Resolve the default root directory honouring the WOTANN_HOME
 * environment variable (so Tauri bundles that ship with a relocated
 * home can write creations to the right spot without a recompile).
 * Splitting this out makes it unit-testable without process.env side
 * effects leaking between tests.
 */
export function resolveDefaultRootDir(env: NodeJS.ProcessEnv = process.env): string {
  const wotannHome = env["WOTANN_HOME"];
  if (typeof wotannHome === "string" && wotannHome.length > 0) {
    return join(wotannHome, "creations");
  }
  return join(homedir(), ".wotann", "creations");
}

export interface CreationsStoreOptions {
  readonly rootDir?: string;
  readonly perFileMaxBytes?: number;
  readonly perSessionMaxBytes?: number;
  readonly broadcast?: BroadcastFn;
  /** Deterministic clock. Default Date.now. */
  readonly now?: () => number;
  /**
   * Inject an alternate env map for resolveDefaultRootDir. Tests with
   * a non-default WOTANN_HOME can pass this instead of mutating
   * process.env. Only consulted when rootDir is not explicitly set.
   */
  readonly env?: NodeJS.ProcessEnv;
}

// ── Errors (QB #6 — typed failures) ────────────────────────

export class ErrorFileTooLarge extends Error {
  readonly code = "CREATIONS_FILE_TOO_LARGE";
  readonly actual: number;
  readonly limit: number;
  constructor(actual: number, limit: number) {
    super(`File size ${actual} bytes exceeds per-file limit of ${limit} bytes`);
    this.name = "ErrorFileTooLarge";
    this.actual = actual;
    this.limit = limit;
  }
}

export class ErrorQuotaExceeded extends Error {
  readonly code = "CREATIONS_QUOTA_EXCEEDED";
  readonly sessionId: string;
  readonly cumulative: number;
  readonly limit: number;
  constructor(sessionId: string, cumulative: number, limit: number) {
    super(
      `Session ${sessionId} cumulative size ${cumulative} bytes exceeds per-session limit of ${limit} bytes`,
    );
    this.name = "ErrorQuotaExceeded";
    this.sessionId = sessionId;
    this.cumulative = cumulative;
    this.limit = limit;
  }
}

export class ErrorInvalidFilename extends Error {
  readonly code = "CREATIONS_INVALID_FILENAME";
  readonly reason: string;
  constructor(filename: string, reason: string) {
    super(`Invalid filename ${JSON.stringify(filename)}: ${reason}`);
    this.name = "ErrorInvalidFilename";
    this.reason = reason;
  }
}

export class ErrorInvalidSessionId extends Error {
  readonly code = "CREATIONS_INVALID_SESSION_ID";
  readonly reason: string;
  constructor(sessionId: string, reason: string) {
    super(`Invalid sessionId ${JSON.stringify(sessionId)}: ${reason}`);
    this.name = "ErrorInvalidSessionId";
    this.reason = reason;
  }
}

export class ErrorPathTraversal extends Error {
  readonly code = "CREATIONS_PATH_TRAVERSAL";
  constructor(attempted: string) {
    super(`Resolved path escapes creations root: ${attempted}`);
    this.name = "ErrorPathTraversal";
  }
}

export class ErrorDiskFull extends Error {
  readonly code = "CREATIONS_DISK_FULL";
  constructor(cause: string) {
    super(`Disk full while writing creation: ${cause}`);
    this.name = "ErrorDiskFull";
  }
}

// ── Sanitiser helpers ──────────────────────────────────────

/**
 * Session ids are commonly UUIDs but we accept any reasonable token.
 * The goal is narrow: allow enough chars for UUIDs, shortids, and
 * human-friendly names; reject anything that could escape the root.
 */
function validateSessionId(sessionId: string): void {
  if (typeof sessionId !== "string") {
    throw new ErrorInvalidSessionId(String(sessionId), "must be a string");
  }
  if (sessionId.length === 0) {
    throw new ErrorInvalidSessionId(sessionId, "must be non-empty");
  }
  if (sessionId.length > 128) {
    throw new ErrorInvalidSessionId(sessionId, "must be <= 128 chars");
  }
  // Reject any path-separator or relative-traversal chars. Also reject
  // NUL because POSIX filesystems interpret it as end-of-string and
  // naive tools will truncate the path silently.
  if (/[/\\\0]/.test(sessionId)) {
    throw new ErrorInvalidSessionId(sessionId, "may not contain / \\ or NUL");
  }
  if (sessionId === "." || sessionId === "..") {
    throw new ErrorInvalidSessionId(sessionId, "may not be . or ..");
  }
  // Allow printable ASCII + - _ . only. Restrictive on purpose — this
  // is an internal id, not a user-visible label; we don't need unicode
  // here and allowing it invites homograph attacks on the filesystem.
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new ErrorInvalidSessionId(sessionId, "must match [A-Za-z0-9._-]+");
  }
}

/**
 * Filename validation — similar rules, but we permit spaces so users
 * can see "Q1 Report.md" in the Creations panel. No path separators,
 * no NUL, no leading dots (hidden files), max 255 chars (POSIX NAME_MAX).
 */
function validateFilename(filename: string): void {
  if (typeof filename !== "string") {
    throw new ErrorInvalidFilename(String(filename), "must be a string");
  }
  if (filename.length === 0) {
    throw new ErrorInvalidFilename(filename, "must be non-empty");
  }
  if (filename.length > 255) {
    throw new ErrorInvalidFilename(filename, "must be <= 255 chars");
  }
  if (/[/\\\0]/.test(filename)) {
    throw new ErrorInvalidFilename(filename, "may not contain / \\ or NUL");
  }
  if (filename === "." || filename === "..") {
    throw new ErrorInvalidFilename(filename, "may not be . or ..");
  }
  if (filename.includes("..")) {
    throw new ErrorInvalidFilename(filename, "may not contain ..");
  }
  if (filename.startsWith(".")) {
    throw new ErrorInvalidFilename(filename, "may not start with . (hidden)");
  }
  // Printable ASCII + space. Same rationale as sessionId: avoid
  // unicode homograph confusion; the UI renders the filename as plain
  // text and cross-platform encoding is not our problem to solve here.
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7E]+$/.test(filename)) {
    throw new ErrorInvalidFilename(filename, "must be printable ASCII");
  }
  // Reject trailing space or dot — Windows treats these as aliases
  // and the mixed-OS environment (iOS client, macOS daemon, occasional
  // Windows desktop) makes trailing-whitespace filenames a footgun.
  if (filename.endsWith(" ") || filename.endsWith(".")) {
    throw new ErrorInvalidFilename(filename, "may not end with space or .");
  }
}

// ── Store ──────────────────────────────────────────────────

/**
 * Agent-created file store. Writes land on disk under
 * <rootDir>/<sessionId>/<filename>; each write fires a UnifiedEvent
 * (if a broadcast hook is wired) so surfaces can sync.
 *
 * Per QB #7 the store is an instance, not a module global. The daemon
 * constructs one per handler in kairos-rpc.ts; tests construct their
 * own with a tmp rootDir.
 */
export class CreationsStore {
  private readonly config: CreationsStoreConfig;
  private broadcast: BroadcastFn | null;
  private readonly clock: () => number;

  constructor(options: CreationsStoreOptions = {}) {
    const rootDir = options.rootDir ?? resolveDefaultRootDir(options.env);
    this.config = {
      rootDir,
      perFileMaxBytes: options.perFileMaxBytes ?? DEFAULT_PER_FILE_MAX,
      perSessionMaxBytes: options.perSessionMaxBytes ?? DEFAULT_PER_SESSION_MAX,
    };
    this.broadcast = options.broadcast ?? null;
    this.clock = options.now ?? (() => Date.now());
  }

  /**
   * Attach (or replace / detach with null) the broadcast hook after
   * construction. Needed because the dispatch plane is set by the
   * daemon AFTER the RPC handler creates the store.
   */
  setBroadcast(fn: BroadcastFn | null): void {
    this.broadcast = fn;
  }

  /** Observe the effective root directory. Tests assert on this. */
  getRootDir(): string {
    return this.config.rootDir;
  }

  /** Observe the effective limits. Tests assert on this. */
  getLimits(): {
    readonly perFileMaxBytes: number;
    readonly perSessionMaxBytes: number;
  } {
    return {
      perFileMaxBytes: this.config.perFileMaxBytes,
      perSessionMaxBytes: this.config.perSessionMaxBytes,
    };
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Save `content` as `filename` under `sessionId`. Overwrites any
   * existing file of the same name in the same session (the store's
   * contract is "last-write-wins" — callers who need versioning layer
   * that on top via their own filename schemes).
   *
   * Path traversal, filename syntax, and size limits are enforced
   * BEFORE any bytes hit the disk. Fan-out fires AFTER the write
   * succeeds; broadcast failures do not roll back the write because
   * the store's contract is "bytes on disk = truth", and the iOS UI
   * that missed the event will catch up via the next `list` poll.
   */
  save(params: {
    readonly sessionId: string;
    readonly filename: string;
    readonly content: Buffer | string;
  }): CreationMetadata {
    validateSessionId(params.sessionId);
    validateFilename(params.filename);

    const buffer = Buffer.isBuffer(params.content)
      ? params.content
      : Buffer.from(params.content, "utf-8");

    // Per-file guard before anything hits the disk.
    if (buffer.byteLength > this.config.perFileMaxBytes) {
      throw new ErrorFileTooLarge(buffer.byteLength, this.config.perFileMaxBytes);
    }

    const absPath = this.resolveFilePath(params.sessionId, params.filename);
    const sessionDir = this.resolveSessionDir(params.sessionId);

    // Per-session quota check. We compute the cumulative size EXCLUDING
    // the file we're about to (over)write, since the save semantics is
    // overwrite — the old bytes go away. This means a resave of the
    // same filename with larger content can still succeed up to the
    // limit, and the numeric comparison is identical for first-writes.
    const cumulativeBeforeWrite = this.cumulativeSizeExcluding(sessionDir, absPath);
    const projected = cumulativeBeforeWrite + buffer.byteLength;
    if (projected > this.config.perSessionMaxBytes) {
      throw new ErrorQuotaExceeded(params.sessionId, projected, this.config.perSessionMaxBytes);
    }

    // Ensure the session dir exists. recursive: true is idempotent and
    // creates any intermediate directories (rootDir itself, mostly).
    try {
      mkdirSync(sessionDir, { recursive: true });
    } catch (err) {
      const rewrapped = rewrapDiskError(err);
      if (rewrapped) throw rewrapped;
      throw err;
    }

    // Actual write. We rewrap disk-full errors so callers can
    // discriminate on `.code === "CREATIONS_DISK_FULL"` rather than
    // parsing errno strings.
    try {
      writeFileSync(absPath, buffer);
    } catch (err) {
      const rewrapped = rewrapDiskError(err);
      if (rewrapped) throw rewrapped;
      throw err;
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const createdAt = this.clock();

    const metadata: CreationMetadata = {
      sessionId: params.sessionId,
      filename: params.filename,
      size: buffer.byteLength,
      sha256,
      createdAt,
      path: absPath,
    };

    // Fire the file-write event. Best-effort: broadcast is not allowed
    // to fail the save. If a surface listener throws, SurfaceRegistry
    // emits an error UnifiedEvent on its own error channel — that
    // belongs to the registry, not this store.
    this.emit({
      type: "file-write",
      timestamp: createdAt,
      payload: {
        sessionId: params.sessionId,
        filename: params.filename,
        size: buffer.byteLength,
        sha256,
        path: absPath,
      },
    });

    return metadata;
  }

  /**
   * List all creations for a session. Empty session returns `[]`
   * (not throw) because the caller may be polling an as-yet-unused
   * session id. Sorted by filename (stable ordering for UI rendering).
   */
  list(sessionId: string): readonly CreationMetadata[] {
    validateSessionId(sessionId);
    const sessionDir = this.resolveSessionDir(sessionId);
    if (!existsSync(sessionDir)) return [];

    const entries: CreationMetadata[] = [];
    const filenames = readdirSync(sessionDir).sort();
    for (const filename of filenames) {
      const absPath = join(sessionDir, filename);
      let st;
      try {
        st = statSync(absPath);
      } catch {
        // Race: file vanished between readdir and stat. Skip.
        continue;
      }
      // Skip non-regular-files defensively (shouldn't exist but be
      // honest about it rather than rendering directories as files).
      if (!st.isFile()) continue;

      // Compute sha256 + mtime for each entry. We could cache this
      // but the typical session has <100 files and creations are
      // written once, so a per-call compute is fine.
      let sha256: string;
      try {
        const bytes = readFileSync(absPath);
        sha256 = createHash("sha256").update(bytes).digest("hex");
      } catch {
        // Race: file vanished between stat and read. Skip.
        continue;
      }
      entries.push({
        sessionId,
        filename,
        size: st.size,
        sha256,
        createdAt: Math.floor(st.mtimeMs),
        path: absPath,
      });
    }
    return entries;
  }

  /**
   * Read a creation. Returns null (not throw) if the session or file
   * doesn't exist — callers poll this in races with delete, and
   * null-vs-throw lets them short-circuit without try/catch noise.
   */
  get(params: { readonly sessionId: string; readonly filename: string }): CreationContent | null {
    validateSessionId(params.sessionId);
    validateFilename(params.filename);

    const absPath = this.resolveFilePath(params.sessionId, params.filename);
    if (!existsSync(absPath)) return null;

    let bytes: Buffer;
    let st;
    try {
      bytes = readFileSync(absPath);
      st = statSync(absPath);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      metadata: {
        sessionId: params.sessionId,
        filename: params.filename,
        size: st.size,
        sha256,
        createdAt: Math.floor(st.mtimeMs),
        path: absPath,
      },
      content: bytes,
    };
  }

  /**
   * Delete a single creation or the entire session directory.
   * Emits one file-write (deleted: true) event per removed file so
   * surfaces can clear their corresponding rows.
   *
   * If `filename` is undefined, the entire session dir is removed.
   * No-ops (return empty array) when the session doesn't exist —
   * matches the common "clean up on abandon" call site which races
   * with sessions that were abandoned before any write.
   */
  delete(params: { readonly sessionId: string; readonly filename?: string }): readonly string[] {
    validateSessionId(params.sessionId);
    const sessionDir = this.resolveSessionDir(params.sessionId);
    if (!existsSync(sessionDir)) return [];

    if (params.filename !== undefined) {
      validateFilename(params.filename);
      const absPath = this.resolveFilePath(params.sessionId, params.filename);
      if (!existsSync(absPath)) return [];
      unlinkSync(absPath);
      this.emit({
        type: "file-write",
        timestamp: this.clock(),
        payload: {
          sessionId: params.sessionId,
          filename: params.filename,
          deleted: true,
        },
      });
      return [params.filename];
    }

    // Whole-session delete. Snapshot the filenames BEFORE removing so
    // we can emit per-file delete events; the UI expects granular
    // events so it can animate row removal.
    const snapshot = readdirSync(sessionDir).sort();
    rmSync(sessionDir, { recursive: true, force: true });
    for (const fname of snapshot) {
      this.emit({
        type: "file-write",
        timestamp: this.clock(),
        payload: {
          sessionId: params.sessionId,
          filename: fname,
          deleted: true,
        },
      });
    }
    return snapshot;
  }

  // ── Internal ─────────────────────────────────────────────

  /**
   * Resolve the session subdirectory under rootDir. After validation
   * there should be no traversal left to worry about, but we still
   * assert via resolvePath + startsWith just in case the validator
   * ever regresses.
   */
  private resolveSessionDir(sessionId: string): string {
    const rootAbs = resolvePath(this.config.rootDir);
    const attempted = resolvePath(rootAbs, sessionId);
    if (!this.isInside(attempted, rootAbs)) {
      throw new ErrorPathTraversal(attempted);
    }
    return attempted;
  }

  /**
   * Resolve a file path under session dir. Same double-check: the
   * validator already rejects path separators in filenames so the
   * resolved path can't escape sessionDir, but we still verify.
   */
  private resolveFilePath(sessionId: string, filename: string): string {
    const sessionDir = this.resolveSessionDir(sessionId);
    const attempted = resolvePath(sessionDir, filename);
    if (!this.isInside(attempted, sessionDir)) {
      throw new ErrorPathTraversal(attempted);
    }
    return attempted;
  }

  private isInside(child: string, parent: string): boolean {
    // Normalize by appending a separator so "/a/bbb" doesn't pass the
    // startsWith("/a/b") check. The child must either equal parent
    // exactly (which isn't a file path we'd ever resolve to, but
    // handled anyway) or sit strictly beneath with a separator.
    const parentWithSep = parent.endsWith(pathSep) ? parent : parent + pathSep;
    return child === parent || child.startsWith(parentWithSep);
  }

  /**
   * Sum the sizes of every regular file in sessionDir EXCLUDING the
   * file at `excludePath` (if any). Used by save() to compute the
   * quota without double-counting the about-to-be-overwritten file.
   */
  private cumulativeSizeExcluding(sessionDir: string, excludePath: string): number {
    if (!existsSync(sessionDir)) return 0;
    let total = 0;
    for (const filename of readdirSync(sessionDir)) {
      const absPath = join(sessionDir, filename);
      if (absPath === excludePath) continue;
      try {
        const st = statSync(absPath);
        if (st.isFile()) total += st.size;
      } catch {
        // Race: file vanished. Don't count it.
      }
    }
    return total;
  }

  /**
   * Emit a UnifiedEvent through the broadcast hook, if wired.
   * Swallows errors by design: F11 surfaces own their own error
   * channel (SurfaceRegistry.onError); a single surface failing
   * should not break the store's write path. Handoff and Fleet view
   * use the same swallow-after-attempt pattern.
   */
  private emit(event: UnifiedEvent): void {
    if (!this.broadcast) return;
    try {
      const result = this.broadcast(event);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          // Broadcast failures do not block the save — the canonical
          // truth is bytes on disk.
        });
      }
    } catch {
      // Same reasoning — broadcast is best-effort.
    }
  }
}

// ── Disk-error rewrap helper ───────────────────────────────

/**
 * Detect ENOSPC / EDQUOT and return an ErrorDiskFull. Other errors
 * return null so the caller rethrows the original — we don't want to
 * lose precision on EACCES / ENOENT / similar.
 */
function rewrapDiskError(err: unknown): ErrorDiskFull | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOSPC" || code === "EDQUOT") {
      const msg = err instanceof Error ? err.message : String(err);
      return new ErrorDiskFull(msg);
    }
  }
  return null;
}
