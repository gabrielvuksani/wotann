/**
 * File-Type Gate — content-aware routing + security pre-filter.
 *
 * Session-6 competitor-win port (priority 10 per research agent). Replaces
 * extension-only file routing with byte-signature detection via
 * `magic-bytes.js` (MIT, zero CVE history, ~35KB pure JS lookup tree
 * covering ~140 file formats from magic numbers).
 *
 * Prior implementation used Google's `magika` (Apache-2.0, TFJS-backed).
 * We swapped it out because the magika -> @tensorflow/tfjs-node -> protobufjs
 * chain shipped 9 CVEs (4 CRITICAL, 4 HIGH) with no non-breaking fix. The
 * magic-bytes.js library is strictly less accurate than a learned model,
 * but it's zero-runtime (no 10MB weights on cold-load), CVE-free, and
 * synchronous — so it actually runs on every upload in CI. Magika's cold
 * load was ~17s, which meant the gate was effectively a no-op in practice.
 *
 * Routing examples the gate enables:
 *   .pdf disguised as .txt    -> route to pdf-extractor (not text tool)
 *   binary uploaded as .log   -> warn + route to binary-analyzer
 *   executable masquerading as data -> route to Exploit tab alert
 *
 * Security wedge: extension-based routing is trivially bypassable. Byte
 * signatures see the actual magic numbers; a renamed `.exe -> .txt` still
 * flags as binary and enters the Exploit tab's review queue instead of
 * being silently dumped into a harmless text handler.
 *
 * Integration:
 *   import { detectFileType } from "./middleware/file-type-gate.js";
 *   const result = await detectFileType(bytes, "ambiguous-upload");
 *   switch (result.handler) { case "pdf": ...; case "code": ...; case "binary": ... }
 *
 * Honest-fallback contract: if magic-bytes returns no match AND the
 * filename extension is unknown, the function returns
 * `{ handler: "unknown", confidence: 0, fromModel: false }` — an HONEST
 * STUB rather than a silent "text" guess. Never throws.
 */

import { filetypeinfo } from "magic-bytes.js";

export type FileHandler =
  | "pdf"
  | "docx"
  | "xlsx"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "markup"
  | "data"
  | "text"
  | "binary"
  | "unknown";

export interface FileTypeResult {
  readonly handler: FileHandler;
  /** Specific detector label (e.g. "pdf", "png", "exe", filename ext) when available. */
  readonly label: string;
  /** 0.0-1.0. 0.9 when from magic-bytes, 0.4 when from extension, 0.0 when neither. */
  readonly confidence: number;
  /**
   * True when the classification came from byte-signature detection, not
   * extension fallback. Name kept for backward compatibility with callers
   * and tests — the "model" in the old magika world is the pattern tree
   * in magic-bytes.
   */
  readonly fromModel: boolean;
  /** When true, the content disagrees with the filename extension. */
  readonly extensionMismatch: boolean;
}

/**
 * Map a magic-bytes typename (e.g. "pdf", "png", "zip", "exe") to one
 * of the coarse-grained handlers the WOTANN tool router understands.
 * The mapping is intentionally conservative — unknown typenames fall
 * through to "unknown" rather than "text" so callers don't silently
 * feed binaries to a text handler.
 *
 * magic-bytes.js typenames catalogue: see
 * node_modules/magic-bytes.js/dist/model/pattern-tree.js
 */
function typenameToHandler(typename: string): FileHandler {
  const l = typename.toLowerCase();
  // Documents
  if (l === "pdf") return "pdf";
  if (l === "docx" || l === "doc" || l === "odt" || l === "rtf") return "docx";
  if (l === "xlsx" || l === "xls" || l === "ods") return "xlsx";
  // Media — magic-bytes typenames align with extensions for media
  if (
    l === "png" ||
    l === "jpg" ||
    l === "jpeg" ||
    l === "gif" ||
    l === "webp" ||
    l === "bmp" ||
    l === "heic" ||
    l === "heif" ||
    l === "tiff" ||
    l === "tif" ||
    l === "ico" ||
    l === "avif" ||
    l === "psd"
  ) {
    return "image";
  }
  if (
    l === "mp4" ||
    l === "mov" ||
    l === "webm" ||
    l === "mkv" ||
    l === "avi" ||
    l === "flv" ||
    l === "m4v" ||
    l === "3gp"
  ) {
    return "video";
  }
  if (
    l === "mp3" ||
    l === "wav" ||
    l === "ogg" ||
    l === "flac" ||
    l === "m4a" ||
    l === "aac" ||
    l === "opus" ||
    l === "mid" ||
    l === "midi"
  ) {
    return "audio";
  }
  // Archives
  if (
    l === "zip" ||
    l === "tar" ||
    l === "gz" ||
    l === "gzip" ||
    l === "bz2" ||
    l === "bzip2" ||
    l === "xz" ||
    l === "7z" ||
    l === "rar" ||
    l === "zst" ||
    l === "zstd" ||
    l === "jar" ||
    l === "apk"
  ) {
    return "archive";
  }
  // Markup / config (magic-bytes detects a subset — mostly xml/html/json)
  if (l === "json" || l === "xml" || l === "html" || l === "htm") {
    return "markup";
  }
  // Data / DB
  if (l === "sqlite" || l === "parquet") {
    return "data";
  }
  // Executable binaries -> route to Exploit tab for review
  if (
    l === "exe" ||
    l === "elf" ||
    l === "mach-o" ||
    l === "macho" ||
    l === "dll" ||
    l === "class" ||
    l === "dex" ||
    l === "wasm" ||
    l === "lnk" ||
    l === "msi" ||
    l === "dylib" ||
    l === "so"
  ) {
    return "binary";
  }
  // magic-bytes doesn't sniff textual source (no reliable byte signature);
  // extension fallback handles .ts/.py/.rs etc.
  return "unknown";
}

/**
 * Coarse-grained fallback from a filename extension when byte-signature
 * detection yields nothing. Less accurate than a learned model, but for
 * plain-text/source-code extensions with no magic number this is the
 * ONLY signal available and it's honest about what it is.
 */
function handlerFromExtension(filename: string): FileHandler {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const EXT: Record<string, FileHandler> = {
    pdf: "pdf",
    docx: "docx",
    doc: "docx",
    odt: "docx",
    rtf: "docx",
    xlsx: "xlsx",
    xls: "xlsx",
    ods: "xlsx",
    csv: "xlsx",
    tsv: "xlsx",
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    webp: "image",
    svg: "image",
    bmp: "image",
    heic: "image",
    mp4: "video",
    mov: "video",
    webm: "video",
    mkv: "video",
    mp3: "audio",
    wav: "audio",
    ogg: "audio",
    flac: "audio",
    zip: "archive",
    tar: "archive",
    gz: "archive",
    bz2: "archive",
    "7z": "archive",
    ts: "code",
    tsx: "code",
    js: "code",
    jsx: "code",
    py: "code",
    rs: "code",
    go: "code",
    java: "code",
    cpp: "code",
    c: "code",
    cs: "code",
    rb: "code",
    php: "code",
    swift: "code",
    kt: "code",
    sh: "code",
    bash: "code",
    zsh: "code",
    ps1: "code",
    bat: "code",
    cmd: "code",
    sql: "code",
    json: "markup",
    yaml: "markup",
    yml: "markup",
    toml: "markup",
    xml: "markup",
    html: "markup",
    md: "markup",
    markdown: "markup",
    parquet: "data",
    arrow: "data",
    sqlite: "data",
    db: "data",
    exe: "binary",
    dll: "binary",
    dylib: "binary",
    so: "binary",
    txt: "text",
    log: "text",
  };
  return EXT[ext] ?? "unknown";
}

/**
 * Run magic-bytes against the supplied bytes. Returns the first matched
 * typename, or null if nothing matched. Synchronous under the hood —
 * wrapped here only so the call site can stay `await`-friendly.
 */
function detectByBytes(bytes: Uint8Array): string | null {
  // magic-bytes inspects a bounded prefix — passing the full buffer is
  // safe but wasteful for very large files. Cap at 4096 bytes which is
  // enough for every signature in the pattern tree.
  const slice = bytes.length > 4096 ? bytes.slice(0, 4096) : bytes;
  try {
    const matches = filetypeinfo(slice);
    if (matches.length === 0) return null;
    const first = matches[0];
    return first?.typename ?? null;
  } catch {
    // magic-bytes is pure lookup and shouldn't throw, but belt-and-suspend
    // against future library changes.
    return null;
  }
}

/**
 * Primary API — classify bytes via magic-bytes when possible, fall back
 * to extension when not. Always returns — never throws. When neither
 * signal produces a classification, returns an HONEST STUB
 * `{handler: "unknown", confidence: 0}` so callers never silently
 * receive a wrong guess.
 */
export async function detectFileType(
  bytes: Uint8Array,
  filename: string = "",
): Promise<FileTypeResult> {
  const extensionHandler = handlerFromExtension(filename);
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  // Byte-signature detection first — catches the extension-mismatch
  // attack (.exe disguised as .txt).
  const typename = bytes.length > 0 ? detectByBytes(bytes) : null;
  if (typename !== null) {
    const byteHandler = typenameToHandler(typename);
    // Only treat byte-signature detection as authoritative when it
    // mapped to a known handler. magic-bytes can return typenames we
    // don't cover (e.g. exotic formats) — in that case fall through to
    // extension so we still return something useful.
    if (byteHandler !== "unknown") {
      const mismatch = extensionHandler !== "unknown" && extensionHandler !== byteHandler;
      return {
        handler: byteHandler,
        label: typename,
        confidence: 0.9,
        fromModel: true,
        extensionMismatch: mismatch,
      };
    }
  }

  // Byte-signature failed or unmapped. Use extension fallback when it
  // has a known answer — otherwise emit the honest {unknown, 0} stub.
  if (extensionHandler !== "unknown") {
    return {
      handler: extensionHandler,
      label: ext,
      confidence: 0.4,
      fromModel: false,
      extensionMismatch: false,
    };
  }

  return {
    handler: "unknown",
    label: ext,
    confidence: 0,
    fromModel: false,
    extensionMismatch: false,
  };
}

/**
 * Convenience: classify a file path by reading its bytes. Returns the
 * same shape as `detectFileType`. Use when you have a path, not bytes.
 */
export async function detectFileTypeFromPath(filePath: string): Promise<FileTypeResult> {
  try {
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(filePath);
    return detectFileType(new Uint8Array(bytes), filePath);
  } catch {
    return {
      handler: "unknown",
      label: "",
      confidence: 0,
      fromModel: false,
      extensionMismatch: false,
    };
  }
}

// -- Pipeline integration (Layer 3.5) -----------------------------
//
// The file-type gate sits immediately after the uploads layer. Before
// wiring it we only had extension-based routing which is trivially
// bypassed (`.exe -> .txt`). The gate runs `detectFileType` on every
// upload's bytes and stamps the classification *plus* a trust boundary
// so downstream layers (sandbox, skills router, exploit-tab queue) can
// quarantine dangerous payloads before they touch a text handler.

/** Trust classification applied to each upload after gate inspection. */
export type UploadTrustBoundary =
  /** Plain text / markup / docs — safe to pass to text handlers. */
  | "safe"
  /** Binary content (image/audio/video/archive/data) — needs typed handler, not text. */
  | "binary"
  /** Known-executable formats (pebin/elf/macho/dex/etc.) — quarantine for Exploit review. */
  | "quarantine"
  /** Gate failed (no bytes / detection threw) — defer decision, treat conservatively. */
  | "unknown";

/**
 * A single uploaded blob flowing through the pipeline. Consumers build this
 * in whichever pre-pipeline ingestion layer they own (file picker, drag-drop,
 * iOS upload RPC, channel inbox). The gate stamps `handler` and
 * `trustBoundary` in place by producing a new immutable object.
 */
export interface FileUpload {
  /** Original filename as supplied by the user (kept for extension fallback + display). */
  readonly filename: string;
  /** Raw bytes. Required — the gate runs byte-signature detection on these. */
  readonly bytes: Uint8Array;
  /** Detected coarse-grained handler. Stamped by the gate; absent pre-gate. */
  readonly handler?: FileHandler;
  /** Specific detector label (e.g. "pdf", "png", ext fallback). Stamped by the gate. */
  readonly label?: string;
  /** 0.0-1.0 detector confidence. Stamped by the gate. */
  readonly confidence?: number;
  /** True if extension disagrees with content. Stamped by the gate. */
  readonly extensionMismatch?: boolean;
  /** Trust classification. Stamped by the gate. */
  readonly trustBoundary?: UploadTrustBoundary;
}

/**
 * Event emitted when the gate cannot classify an upload (empty bytes,
 * detection threw, or both model + extension fallback failed). Surface
 * these via the existing telemetry / structured-logger rather than
 * silently letting the upload through — quality bar: "no silent error
 * swallow".
 */
export interface FileTypeGateEvent {
  readonly kind: "gate_failed";
  readonly filename: string;
  readonly reason: "empty-bytes" | "detection-error" | "unknown-format";
  readonly error?: string;
}

/**
 * Declaration-merging augmentation — adds the upload slot and gate-event
 * log to `MiddlewareContext` without editing the owner file (types.ts).
 * The fields are optional so existing callers compile unchanged.
 */
declare module "./types.js" {
  interface MiddlewareContext {
    uploads?: readonly FileUpload[];
    /** Append-only log of gate failures seen during this request. */
    fileTypeGateEvents?: readonly FileTypeGateEvent[];
  }
}

/**
 * Detector labels that designate a SCRIPT (shell / ps1 / bat) — these
 * map to the coarse handler "code" by default but they differ from
 * ordinary source files (.ts, .py) in one critical way: they are
 * INTERPRETED by shells that honor every byte. An attacker uploading a
 * .txt that's actually a .sh can get code execution if the pipeline
 * ever passes the bytes to `chmod +x && ./file`. Quarantine them until
 * a human reviews — identical policy to executable binaries.
 */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "ps1",
  "powershell",
  "bat",
  "cmd",
  "vbs",
  "vbscript",
]);

/**
 * Map a FileHandler (and optionally the detector label) to the trust
 * boundary that controls downstream routing.
 *
 * Wave-3E policy (spec priority #3):
 *   - `binary` (pebin/elf/macho/dex/...) -> quarantine
 *   - `archive` (zip/tar/rar/7z/xz/...) -> quarantine (upgraded from binary)
 *   - `code` with a script label (shell/ps1/bat) -> quarantine (new)
 *   - `image/video/audio/data/pdf/docx/xlsx` -> binary
 *   - `code` (non-script) / `markup` / `text` -> safe
 *   - `unknown` -> unknown (conservative)
 *
 * Archives move to quarantine because a malicious archive can pack an
 * executable + payload chain; automated extraction in the sandbox stage
 * must be gated by explicit user approval. Scripts move to quarantine
 * because bash/ps1/bat are executable artefacts, not passive data.
 */
function boundaryForHandler(handler: FileHandler, label: string = ""): UploadTrustBoundary {
  switch (handler) {
    case "binary":
    case "archive":
      return "quarantine";
    case "code":
      return SCRIPT_EXTENSIONS.has(label.toLowerCase()) ? "quarantine" : "safe";
    case "image":
    case "video":
    case "audio":
    case "data":
    case "pdf":
    case "docx":
    case "xlsx":
      return "binary";
    case "markup":
    case "text":
      return "safe";
    case "unknown":
      return "unknown";
    default: {
      // Exhaustiveness guard — if FileHandler grows a new variant and we
      // forget to classify it, the compiler flags the missing branch.
      const _never: never = handler;
      void _never;
      return "unknown";
    }
  }
}

/**
 * Classify a single upload by invoking `detectFileType` on its bytes.
 * Returns both the stamped upload and an optional gate-failure event so
 * the caller can fold failures into the context event log.
 */
async function classifyUpload(upload: FileUpload): Promise<{
  readonly stamped: FileUpload;
  readonly event?: FileTypeGateEvent;
}> {
  if (upload.bytes.length === 0) {
    // Empty payload — flag rather than silently mark "text".
    return {
      stamped: {
        ...upload,
        handler: "unknown",
        label: "",
        confidence: 0,
        extensionMismatch: false,
        trustBoundary: "unknown",
      },
      event: {
        kind: "gate_failed",
        filename: upload.filename,
        reason: "empty-bytes",
      },
    };
  }

  try {
    const result = await detectFileType(upload.bytes, upload.filename);
    // Pass the label so shell/ps1/bat get quarantined even though their
    // coarse handler is "code". Source files (.ts/.py) stay safe.
    const boundary = boundaryForHandler(result.handler, result.label);
    const stamped: FileUpload = {
      ...upload,
      handler: result.handler,
      label: result.label,
      confidence: result.confidence,
      extensionMismatch: result.extensionMismatch,
      trustBoundary: boundary,
    };
    if (result.handler === "unknown") {
      return {
        stamped,
        event: {
          kind: "gate_failed",
          filename: upload.filename,
          reason: "unknown-format",
        },
      };
    }
    return { stamped };
  } catch (err) {
    // `detectFileType` is designed never to throw, but we belt-and-suspend
    // in case a library upgrade changes that contract. Emit the event and
    // mark the upload as unknown/unknown-boundary instead of passing raw.
    return {
      stamped: {
        ...upload,
        handler: "unknown",
        label: "",
        confidence: 0,
        extensionMismatch: false,
        trustBoundary: "unknown",
      },
      event: {
        kind: "gate_failed",
        filename: upload.filename,
        reason: "detection-error",
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// Defer the Middleware type import until use to avoid forcing every
// module that imports `detectFileType` to also pull in the middleware
// shape surface.
import type { Middleware, MiddlewareContext } from "./types.js";

/**
 * Middleware layer 3.5 — byte-signature file-type gate.
 *
 * Pipeline position: after `uploadsMiddleware` (which resolves `@file`
 * references to filenames) and before `sandboxMiddleware` (which needs
 * trustBoundary to decide containment). The gate runs `detectFileType`
 * on every upload's bytes and returns a NEW context with each upload
 * stamped (handler, label, confidence, extensionMismatch, trustBoundary)
 * plus an append-only `fileTypeGateEvents` log for any failures.
 *
 * Immutability: neither the input context nor its uploads array are
 * mutated — we return fresh objects so downstream layers see a stable
 * snapshot and the caller's reference is untouched.
 */
export const fileTypeGateMiddleware: Middleware = {
  name: "FileTypeGate",
  order: 3.5,
  async before(ctx: MiddlewareContext): Promise<MiddlewareContext> {
    const uploads = ctx.uploads;
    if (!uploads || uploads.length === 0) {
      // No uploads -> nothing to gate. Leave context untouched.
      return ctx;
    }

    const classified = await Promise.all(uploads.map(classifyUpload));
    const stampedUploads: readonly FileUpload[] = classified.map((c) => c.stamped);
    const newEvents: readonly FileTypeGateEvent[] = classified
      .map((c) => c.event)
      .filter((e): e is FileTypeGateEvent => e !== undefined);

    const existingEvents = ctx.fileTypeGateEvents ?? [];
    const mergedEvents: readonly FileTypeGateEvent[] =
      newEvents.length > 0 ? [...existingEvents, ...newEvents] : existingEvents;

    return {
      ...ctx,
      uploads: stampedUploads,
      fileTypeGateEvents: mergedEvents,
    };
  },
};
