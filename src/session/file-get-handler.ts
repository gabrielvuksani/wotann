/**
 * File-Get Handler — WOTANN Phase 3 P1-F7 (general-purpose file read
 * with HTTP-style range-request support).
 *
 * F5 landed `creations.get` — but that was narrow: it only serves files
 * the agent itself wrote under `~/.wotann/creations/<sessionId>/`. F7
 * generalises to arbitrary workspace files. iOS ShareLink needs this so
 * the phone can pull any artifact the user references from the
 * Creations feed, chat attachments, or code-review comments.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-F7 the primitive
 * must:
 *
 *   - Scope reads to the daemon's working-dir (no arbitrary host reads).
 *   - Support HTTP-style range requests for large files so iOS ShareLink
 *     shows progress bars + can resume a cellular-interrupted download.
 *   - Refuse to return binary bytes as UTF-8 (that corrupts the wire on
 *     JSON transports) — callers must opt-in to base64 for binary.
 *   - Refuse files larger than a configured ceiling unless the caller
 *     asks for a range (so a misbehaving phone cannot OOM the daemon
 *     with a `file.get` on a 10GB log).
 *
 * Design principles (session quality bars referenced inline):
 *
 *   QB #6 (honest failures) — typed errors for every failure mode:
 *     ErrorFileNotFound         — missing file (not throw generic)
 *     ErrorPathTraversal        — requested path escapes workspace root
 *     ErrorSymlinkEscape        — path is a symlink whose real target
 *                                 lives outside the workspace
 *     ErrorBinaryNotAsciiSafe   — binary file without asBase64 flag
 *     ErrorFileTooLarge         — file > ceiling and no range given
 *     ErrorRangeUnsatisfiable   — range start >= file size, or end < start
 *     ErrorInvalidPath          — empty or malformed path input
 *
 *   QB #7 (per-session state) — FileGetHandler is an instance, not a
 *   module global. The root directory and size ceiling are instance
 *   config set at construction; tests construct their own instances
 *   with a tmp dir; the daemon constructs one per handler in
 *   kairos-rpc.ts bound to runtime.getWorkingDir().
 *
 *   QB #10 (sibling-site scan) — the existing `file.get` in
 *   companion-server.ts:1631 uses FileShare.sendFile but does NOT
 *   support ranges and does NOT reject binary-without-base64. The
 *   daemon-level `file.get` we add here is the canonical path; iOS
 *   ShareLink will route through kairos-rpc rather than the companion.
 *
 *   QB #12 (deterministic tests) — no wall-clock usage; size ceilings
 *   are instance config and fully overridable.
 *
 *   QB #14 (claim verification) — every claim made in the commit
 *   ("range works / path-traversal rejected / symlink rejected") has a
 *   dedicated test in file-get.test.ts exercising the real code path.
 *
 * Non-goals for F7:
 *   - Streaming over NDJSON (the JSON-RPC transport buffers the whole
 *     chunk; range requests are the streaming primitive here).
 *   - Directory listings (out of scope; a future F-item will add
 *     `dir.list`).
 *   - Write access (F7 is read-only by design; writes go through
 *     existing `composer.apply` / `creations.save`).
 */

import { createHash } from "node:crypto";
import { existsSync, openSync, closeSync, readSync, realpathSync, statSync } from "node:fs";
import { extname, resolve as resolvePath, sep as pathSep } from "node:path";

// ── Types ──────────────────────────────────────────────────

/**
 * Request shape for FileGetHandler.serve.
 *
 * `rootDir` is the workspace root — the handler rejects any requested
 * path that resolves outside it (including via symlinks). Callers
 * construct the handler with a rootDir once and reuse it for all
 * requests; tests construct with a tmp dir for isolation.
 *
 * `range` follows HTTP Range semantics: `start` is inclusive,
 * `end` is inclusive. `end` defaults to `total - 1` (read-to-EOF from
 * start). `start` must be less than `total`, else
 * ErrorRangeUnsatisfiable. `end` must be >= `start`, else
 * ErrorRangeUnsatisfiable.
 */
export interface FileGetRequest {
  readonly requestedPath: string;
  readonly range?: { readonly start: number; readonly end?: number };
  /**
   * Opt-in to base64-encoded bytes. If false/undefined and the file is
   * not plain ASCII-safe (see isAsciiSafe), the handler throws
   * ErrorBinaryNotAsciiSafe so the caller cannot accidentally corrupt
   * the wire.
   */
  readonly asBase64?: boolean;
}

/**
 * Response shape from FileGetHandler.serve.
 *
 * `content` is a string: utf-8 text when `asBase64` is false,
 * base64-encoded bytes when `asBase64` is true. Callers inspect
 * `contentType` + `encoding` to discriminate.
 *
 * `contentRange` follows the HTTP Content-Range header shape:
 * "bytes <start>-<end>/<total>". Only present when a range was
 * requested (full-file reads omit it).
 *
 * `total` is the full file size in bytes regardless of range —
 * iOS ShareLink uses this to render progress bars across multiple
 * range requests.
 *
 * `sha256` is the hash of the RETURNED bytes (not the full file when a
 * range was taken). This way the caller can verify integrity of each
 * chunk independently.
 */
export interface FileGetResponse {
  readonly content: string;
  readonly encoding: "utf-8" | "base64";
  readonly contentType: string;
  readonly contentRange?: string;
  readonly total: number;
  readonly sha256: string;
}

// ── Config ─────────────────────────────────────────────────

/**
 * Instance configuration.
 *
 * `maxBytesWithoutRange` caps full-file reads: requests for files
 * larger than this without an explicit range throw ErrorFileTooLarge
 * with a hint to retry with `range: {start: 0, end: N}`. Ranged reads
 * ignore this cap — the caller signals they know what they're doing
 * by providing a range.
 *
 * `maxBytesPerRange` caps the size of a single ranged response so a
 * misbehaving phone cannot request `range: {start: 0, end: 1e12}` on a
 * sparse file and OOM the daemon. Default 10MB per range call.
 */
export interface FileGetHandlerConfig {
  readonly rootDir: string;
  readonly maxBytesWithoutRange: number;
  readonly maxBytesPerRange: number;
}

const DEFAULT_MAX_BYTES_WITHOUT_RANGE = 50 * 1024 * 1024; // 50 MiB
const DEFAULT_MAX_BYTES_PER_RANGE = 10 * 1024 * 1024; // 10 MiB

export interface FileGetHandlerOptions {
  readonly rootDir: string;
  readonly maxBytesWithoutRange?: number;
  readonly maxBytesPerRange?: number;
}

// ── Errors (QB #6 — typed failures) ────────────────────────

export class ErrorFileNotFound extends Error {
  readonly code = "FILE_GET_NOT_FOUND";
  readonly requestedPath: string;
  constructor(requestedPath: string) {
    super(`File not found: ${requestedPath}`);
    this.name = "ErrorFileNotFound";
    this.requestedPath = requestedPath;
  }
}

export class ErrorPathTraversal extends Error {
  readonly code = "FILE_GET_PATH_TRAVERSAL";
  readonly attemptedPath: string;
  constructor(attemptedPath: string) {
    super(`Requested path escapes workspace root: ${attemptedPath}`);
    this.name = "ErrorPathTraversal";
    this.attemptedPath = attemptedPath;
  }
}

export class ErrorSymlinkEscape extends Error {
  readonly code = "FILE_GET_SYMLINK_ESCAPE";
  readonly realPath: string;
  constructor(realPath: string) {
    super(`Symlink target escapes workspace root: ${realPath}`);
    this.name = "ErrorSymlinkEscape";
    this.realPath = realPath;
  }
}

export class ErrorBinaryNotAsciiSafe extends Error {
  readonly code = "FILE_GET_BINARY_NOT_ASCII_SAFE";
  readonly contentType: string;
  constructor(contentType: string) {
    super(`File appears to be binary (${contentType}); pass asBase64:true to fetch`);
    this.name = "ErrorBinaryNotAsciiSafe";
    this.contentType = contentType;
  }
}

export class ErrorFileTooLarge extends Error {
  readonly code = "FILE_GET_FILE_TOO_LARGE";
  readonly size: number;
  readonly limit: number;
  constructor(size: number, limit: number) {
    super(
      `File size ${size} bytes exceeds maxBytesWithoutRange (${limit}); retry with a range parameter`,
    );
    this.name = "ErrorFileTooLarge";
    this.size = size;
    this.limit = limit;
  }
}

export class ErrorRangeUnsatisfiable extends Error {
  readonly code = "FILE_GET_RANGE_UNSATISFIABLE";
  readonly reason: string;
  constructor(reason: string) {
    super(`Range unsatisfiable: ${reason}`);
    this.name = "ErrorRangeUnsatisfiable";
    this.reason = reason;
  }
}

export class ErrorInvalidPath extends Error {
  readonly code = "FILE_GET_INVALID_PATH";
  readonly reason: string;
  constructor(reason: string) {
    super(`Invalid path: ${reason}`);
    this.name = "ErrorInvalidPath";
    this.reason = reason;
  }
}

// ── Content-type inference ─────────────────────────────────

/**
 * Minimal, extensible MIME map. Not every extension is covered — the
 * goal is to distinguish "text that the wire can carry as utf-8" from
 * "binary that needs base64". When unknown, we fall back to sniffing
 * the bytes themselves (isAsciiSafe).
 */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".yml": "application/yaml",
  ".yaml": "application/yaml",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".ts": "application/typescript",
  ".tsx": "application/typescript",
  ".jsx": "application/javascript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".swift": "text/x-swift",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c-header",
  ".java": "text/x-java",
  ".kt": "text/x-kotlin",
  ".sh": "text/x-shellscript",
  ".toml": "application/toml",
  ".csv": "text/csv",
  ".log": "text/plain",
  // Binary formats — matched so we can refuse-without-base64 fast.
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".wasm": "application/wasm",
  ".so": "application/octet-stream",
  ".dylib": "application/octet-stream",
  ".dll": "application/octet-stream",
  ".exe": "application/octet-stream",
  ".bin": "application/octet-stream",
};

/**
 * Infer content-type from the filename extension. Unknown extensions
 * return `application/octet-stream` — the caller then decides based on
 * isAsciiSafe() whether the bytes are actually text.
 */
export function inferContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Is a content-type text-like? Used to decide whether to refuse an
 * asBase64:false request. Text/* and application/json|yaml|xml|toml|
 * typescript|javascript|markdown are all wire-safe as utf-8.
 */
export function isTextContentType(contentType: string): boolean {
  if (contentType.startsWith("text/")) return true;
  if (contentType === "application/json") return true;
  if (contentType === "application/yaml") return true;
  if (contentType === "application/xml") return true;
  if (contentType === "application/toml") return true;
  if (contentType === "application/javascript") return true;
  if (contentType === "application/typescript") return true;
  return false;
}

/**
 * Last-resort byte-sniff: is a buffer plausibly UTF-8 text?
 *
 * Rules:
 *   - A NUL byte (`\0`) anywhere -> binary.
 *   - More than 10% bytes in the "control" range (< 0x09 or 0x0E..0x1F)
 *     excluding \t, \n, \r -> binary.
 *
 * We don't try to decode UTF-8 strictly — the wire carrier (JSON) is
 * utf-8 capable and valid-looking text is fine. The point is to catch
 * obvious binaries (PNGs, PDFs, compiled objects) where the extension
 * was missing or misleading.
 */
export function isAsciiSafe(buf: Buffer): boolean {
  if (buf.byteLength === 0) return true;
  let controlCount = 0;
  for (let i = 0; i < buf.byteLength; i++) {
    const b = buf[i]!;
    if (b === 0x00) return false;
    // Allow \t (9), \n (10), \r (13).
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20) controlCount++;
  }
  // >10% control chars -> treat as binary. Threshold chosen so
  // fully-text buffers with one odd byte still pass, while PNG (which
  // starts with 8 non-printable bytes) fails on any sample size.
  return controlCount * 10 < buf.byteLength;
}

// ── Handler ────────────────────────────────────────────────

/**
 * Stateless read helper. Construct once per daemon workspace; call
 * `serve()` for each RPC request.
 *
 * The handler owns no state between calls — rootDir is config, not
 * cached state. This makes it safe to share across concurrent RPC
 * handlers on the same daemon (per QB #7: per-session state lives on
 * the caller, not the helper).
 */
export class FileGetHandler {
  private readonly config: FileGetHandlerConfig;

  constructor(options: FileGetHandlerOptions) {
    this.config = {
      rootDir: options.rootDir,
      maxBytesWithoutRange: options.maxBytesWithoutRange ?? DEFAULT_MAX_BYTES_WITHOUT_RANGE,
      maxBytesPerRange: options.maxBytesPerRange ?? DEFAULT_MAX_BYTES_PER_RANGE,
    };
  }

  getRootDir(): string {
    return this.config.rootDir;
  }

  getLimits(): {
    readonly maxBytesWithoutRange: number;
    readonly maxBytesPerRange: number;
  } {
    return {
      maxBytesWithoutRange: this.config.maxBytesWithoutRange,
      maxBytesPerRange: this.config.maxBytesPerRange,
    };
  }

  /**
   * Read a file (or range) and return its content + metadata.
   *
   * Guard ordering matters:
   *   1. Validate path (non-empty string)
   *   2. Lexical traversal check (resolvePath stays under rootDir)
   *   3. Existence check (throws ErrorFileNotFound if missing)
   *   4. Symlink check (realpath still under rootDir)
   *   5. Stat to get total size
   *   6. Range validation vs total
   *   7. Size ceiling check (only for no-range full-file reads)
   *   8. Read bytes (chunked, fd-based for ranged reads)
   *   9. Content-type inference + binary-safety check
   *  10. Encode (utf-8 or base64) + hash
   */
  serve(req: FileGetRequest): FileGetResponse {
    // ── 1. Validate path input ────────────────────────────
    if (typeof req.requestedPath !== "string") {
      throw new ErrorInvalidPath("path must be a string");
    }
    if (req.requestedPath.length === 0) {
      throw new ErrorInvalidPath("path must be non-empty");
    }
    // Reject NUL bytes — POSIX filesystems truncate at NUL and naive
    // tools silently read `/etc/passwd\0ignore` as `/etc/passwd`.
    if (req.requestedPath.includes("\0")) {
      throw new ErrorInvalidPath("path may not contain NUL");
    }

    // ── 2. Lexical traversal check ────────────────────────
    const rootAbs = resolvePath(this.config.rootDir);
    if (rootAbs === "/" || rootAbs === "") {
      // Defence-in-depth: a degenerate root would let every absolute
      // path pass the prefix check. This should not happen with a
      // daemon bound to a real working directory.
      throw new ErrorInvalidPath("refusing file.get with degenerate workspace root");
    }
    const requestedAbs = resolvePath(rootAbs, req.requestedPath);
    if (!isInside(requestedAbs, rootAbs)) {
      throw new ErrorPathTraversal(requestedAbs);
    }

    // ── 3. Existence check ────────────────────────────────
    if (!existsSync(requestedAbs)) {
      throw new ErrorFileNotFound(requestedAbs);
    }

    // ── 4. Symlink-escape check ───────────────────────────
    // realpathSync resolves every symlink in the path. If the resolved
    // target sits outside the workspace, refuse even though the
    // lexical path would be fine.
    let realPath: string;
    try {
      realPath = realpathSync(requestedAbs);
    } catch {
      // ENOENT races, EACCES on intermediate dirs, etc. We already
      // verified existence; a realpath failure here is almost always
      // a TOCTOU race -> treat as not-found.
      throw new ErrorFileNotFound(requestedAbs);
    }
    let realRoot: string;
    try {
      realRoot = realpathSync(rootAbs);
    } catch {
      realRoot = rootAbs;
    }
    if (!isInside(realPath, realRoot)) {
      throw new ErrorSymlinkEscape(realPath);
    }

    // ── 5. Stat for size + file-type check ────────────────
    let st;
    try {
      st = statSync(realPath);
    } catch {
      throw new ErrorFileNotFound(realPath);
    }
    if (!st.isFile()) {
      throw new ErrorFileNotFound(realPath);
    }
    const total = st.size;

    // ── 6 & 7. Range validation + size ceiling ────────────
    let rangeStart: number;
    let rangeEnd: number;
    const hasRange = req.range !== undefined;

    if (hasRange) {
      const range = req.range!;
      if (!Number.isInteger(range.start) || range.start < 0) {
        throw new ErrorRangeUnsatisfiable(
          `start must be a non-negative integer (got ${String(range.start)})`,
        );
      }
      // An empty file has total=0; any range on it (even 0-0) is
      // unsatisfiable because there is no byte to return. HTTP 416
      // parity — serve semantics diverge from file-not-found for
      // zero-byte files, which still exist and should return total=0
      // with empty content on a no-range read.
      if (range.start >= total) {
        throw new ErrorRangeUnsatisfiable(`start ${range.start} >= total ${total}`);
      }
      rangeStart = range.start;
      rangeEnd = range.end ?? total - 1;
      if (!Number.isInteger(rangeEnd) || rangeEnd < rangeStart) {
        throw new ErrorRangeUnsatisfiable(`end ${String(rangeEnd)} must be >= start ${rangeStart}`);
      }
      if (rangeEnd >= total) {
        // Clamp end to EOF — HTTP parity. We DON'T throw here; a
        // caller asking for `start: total - 10, end: total + 100` is
        // almost always a caller that doesn't know the total yet.
        rangeEnd = total - 1;
      }
      const span = rangeEnd - rangeStart + 1;
      if (span > this.config.maxBytesPerRange) {
        throw new ErrorRangeUnsatisfiable(
          `range span ${span} exceeds maxBytesPerRange ${this.config.maxBytesPerRange}`,
        );
      }
    } else {
      rangeStart = 0;
      rangeEnd = total === 0 ? 0 : total - 1;
      if (total > this.config.maxBytesWithoutRange) {
        throw new ErrorFileTooLarge(total, this.config.maxBytesWithoutRange);
      }
    }

    // ── 8. Read bytes ─────────────────────────────────────
    const byteLength = hasRange ? rangeEnd - rangeStart + 1 : total;
    const buf = Buffer.alloc(byteLength);
    if (byteLength > 0) {
      const fd = openSync(realPath, "r");
      try {
        // readSync with a position argument supports random-access
        // reads without streaming machinery. One syscall for typical
        // < 10MiB ranges; large files are paged by the kernel anyway.
        let readSoFar = 0;
        while (readSoFar < byteLength) {
          const n = readSync(fd, buf, readSoFar, byteLength - readSoFar, rangeStart + readSoFar);
          if (n === 0) break; // EOF reached unexpectedly — buf has zeros past this
          readSoFar += n;
        }
        if (readSoFar < byteLength) {
          // File shrank between stat() and read() — surface as not-found
          // because the state the caller asked for doesn't exist any more.
          throw new ErrorFileNotFound(realPath);
        }
      } finally {
        closeSync(fd);
      }
    }

    // ── 9. Content-type + binary-safety check ─────────────
    let contentType = inferContentType(realPath);
    if (contentType === "application/octet-stream") {
      // Extension was unknown or explicitly binary. Sniff the bytes —
      // if they look like text, upgrade to text/plain so asBase64=false
      // still works.
      if (isAsciiSafe(buf)) {
        contentType = "text/plain";
      }
    }

    const wantBase64 = req.asBase64 === true;
    if (!wantBase64) {
      // Only allow UTF-8 return for content-types the transport can
      // carry safely. Everything else requires opt-in base64.
      const textLike = isTextContentType(contentType);
      const looksText = isAsciiSafe(buf);
      if (!textLike && !looksText) {
        throw new ErrorBinaryNotAsciiSafe(contentType);
      }
      if (!textLike && !looksText) {
        // defensive double-check (dead branch, but signals intent)
        throw new ErrorBinaryNotAsciiSafe(contentType);
      }
    }

    // ── 10. Encode + hash ─────────────────────────────────
    const encoding: "utf-8" | "base64" = wantBase64 ? "base64" : "utf-8";
    const content = wantBase64 ? buf.toString("base64") : buf.toString("utf-8");
    const sha256 = createHash("sha256").update(buf).digest("hex");

    const contentRange = hasRange ? `bytes ${rangeStart}-${rangeEnd}/${total}` : undefined;

    return {
      content,
      encoding,
      contentType,
      ...(contentRange !== undefined ? { contentRange } : {}),
      total,
      sha256,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Is `child` a descendant of (or equal to) `parent`? Appends a
 * separator to guard against the classic `/workspace` matching
 * `/workspace-secret/...` bypass.
 */
function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const parentWithSep = parent.endsWith(pathSep) ? parent : parent + pathSep;
  return child.startsWith(parentWithSep);
}
