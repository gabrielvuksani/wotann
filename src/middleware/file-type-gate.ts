/**
 * File-Type Gate (Magika) — content-aware routing + security pre-filter.
 *
 * Session-6 competitor-win port (priority 10 per research agent). Replaces
 * extension-only file routing with Google's Magika (Apache-2.0, 99% accurate
 * across 200+ content types, ~5ms per file via a small bundled TFJS model).
 *
 * Routing examples the gate enables:
 *   .pdf disguised as .txt    → route to pdf-extractor (not text tool)
 *   binary uploaded as .log   → warn + route to binary-analyzer
 *   TypeScript misnamed .js   → route to TypeScript-aware LSP/skills
 *   executable masquerading as data → route to Exploit tab alert
 *
 * Security wedge: extension-based routing is trivially bypassable. Magika
 * sees the actual bytes; a renamed `.exe → .txt` still flags as binary and
 * enters the Exploit tab's review queue instead of being silently dumped
 * into a harmless text handler.
 *
 * Integration:
 *   import { detectFileType } from "./middleware/file-type-gate.js";
 *   const result = await detectFileType(bytes, "ambiguous-upload");
 *   switch (result.handler) { case "pdf": ...; case "code": ...; case "binary": ... }
 *
 * Fallback contract: when the optional `magika` dep isn't installed OR the
 * model fails to load, returns a legacy extension-based result so callers
 * always get a routing decision. Never throws.
 */

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
  /** Magika's specific label (e.g. "python", "pdf", "pebin") when available. */
  readonly label: string;
  /** 0.0–1.0 when from Magika; 1.0 (by-extension) or 0.0 (fallback) otherwise. */
  readonly confidence: number;
  /** True when the classification came from Magika's model, not extension fallback. */
  readonly fromModel: boolean;
  /** When true, the content disagrees with the filename extension. */
  readonly extensionMismatch: boolean;
}

/**
 * Minimal structural type for Magika's node bindings — spelled out so the
 * module typechecks without depending on the optional `magika` package at
 * compile time.
 */
type MagikaModule = {
  readonly MagikaNode: {
    create(options?: Record<string, unknown>): Promise<{
      identifyBytes(bytes: Uint8Array): Promise<{
        prediction: {
          output: { label: string };
          score: number;
        };
      }>;
    }>;
  };
};

let cachedMagika: Awaited<ReturnType<MagikaModule["MagikaNode"]["create"]>> | null | undefined;

async function loadMagika(): Promise<Awaited<
  ReturnType<MagikaModule["MagikaNode"]["create"]>
> | null> {
  if (cachedMagika !== undefined) return cachedMagika;
  try {
    // Dynamic import keeps `magika` an optional dependency — users who
    // don't install it still get extension-based routing via the fallback.
    const mod = (await import("magika/node" as string)) as unknown as MagikaModule;
    const instance = await mod.MagikaNode.create();
    cachedMagika = instance;
    return instance;
  } catch {
    cachedMagika = null;
    return null;
  }
}

/**
 * Map a Magika content-type label (200+ possible values) to one of the
 * coarse-grained handlers the WOTANN tool router understands. The mapping
 * is intentionally conservative — unknown labels fall through to "unknown"
 * rather than "text" so callers don't silently feed binaries to a text
 * handler.
 */
function labelToHandler(label: string): FileHandler {
  const l = label.toLowerCase();
  // Documents
  if (l === "pdf") return "pdf";
  if (l === "docx" || l === "doc" || l === "odt" || l === "rtf") return "docx";
  if (l === "xlsx" || l === "xls" || l === "ods" || l === "csv" || l === "tsv") return "xlsx";
  // Media
  if (
    l.startsWith("png") ||
    l === "jpeg" ||
    l === "jpg" ||
    l === "gif" ||
    l === "webp" ||
    l === "svg" ||
    l === "bmp" ||
    l === "heic" ||
    l === "heif" ||
    l === "tiff" ||
    l === "ico"
  ) {
    return "image";
  }
  if (l === "mp4" || l === "mov" || l === "webm" || l === "mkv" || l === "avi") {
    return "video";
  }
  if (l === "mp3" || l === "wav" || l === "ogg" || l === "flac" || l === "m4a") {
    return "audio";
  }
  // Archives
  if (
    l === "zip" ||
    l === "tar" ||
    l === "gzip" ||
    l === "bzip2" ||
    l === "xz" ||
    l === "7z" ||
    l === "rar" ||
    l === "zstd"
  ) {
    return "archive";
  }
  // Code
  if (
    l === "python" ||
    l === "typescript" ||
    l === "javascript" ||
    l === "rust" ||
    l === "go" ||
    l === "java" ||
    l === "cpp" ||
    l === "c" ||
    l === "csharp" ||
    l === "ruby" ||
    l === "php" ||
    l === "swift" ||
    l === "kotlin" ||
    l === "scala" ||
    l === "haskell" ||
    l === "elixir" ||
    l === "clojure" ||
    l === "lua" ||
    l === "shell" ||
    l === "sql" ||
    l === "makefile" ||
    l === "dockerfile" ||
    l === "perl" ||
    l === "dart" ||
    l === "r" ||
    l === "julia"
  ) {
    return "code";
  }
  // Markup / config
  if (
    l === "json" ||
    l === "yaml" ||
    l === "toml" ||
    l === "xml" ||
    l === "html" ||
    l === "markdown" ||
    l === "tex" ||
    l === "rst" ||
    l === "ini"
  ) {
    return "markup";
  }
  // Data
  if (l === "parquet" || l === "arrow" || l === "sqlite" || l === "jsonl") {
    return "data";
  }
  // Binaries — route to Exploit tab for review
  if (
    l === "pebin" ||
    l === "elf" ||
    l === "macho" ||
    l === "dex" ||
    l === "apk" ||
    l === "class" ||
    l === "jar" ||
    l === "wasm" ||
    l === "lnk" ||
    l === "msi" ||
    l === "smali" ||
    l === "dylib"
  ) {
    return "binary";
  }
  // Plain text as last resort
  if (l === "txt" || l === "asciiart" || l === "empty") return "text";
  return "unknown";
}

/**
 * Coarse-grained fallback from a filename extension when Magika isn't
 * available. Less accurate than the model — specifically, won't catch
 * extension-mismatch (the whole reason Magika exists).
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
 * Primary API — classify bytes via Magika when available, fall back to
 * extension when not. Always returns — never throws.
 */
export async function detectFileType(
  bytes: Uint8Array,
  filename: string = "",
): Promise<FileTypeResult> {
  const extensionHandler = handlerFromExtension(filename);
  const magika = await loadMagika();

  if (!magika) {
    return {
      handler: extensionHandler,
      label: filename.toLowerCase().split(".").pop() ?? "",
      confidence: extensionHandler === "unknown" ? 0 : 0.4,
      fromModel: false,
      extensionMismatch: false,
    };
  }

  try {
    const result = await magika.identifyBytes(bytes);
    const label = result.prediction.output.label;
    const score = result.prediction.score;
    const modelHandler = labelToHandler(label);
    const mismatch =
      extensionHandler !== "unknown" &&
      modelHandler !== "unknown" &&
      extensionHandler !== modelHandler;
    return {
      handler: modelHandler,
      label,
      confidence: score,
      fromModel: true,
      extensionMismatch: mismatch,
    };
  } catch {
    // Model call failed — fall back to extension rather than crashing.
    return {
      handler: extensionHandler,
      label: filename.toLowerCase().split(".").pop() ?? "",
      confidence: extensionHandler === "unknown" ? 0 : 0.4,
      fromModel: false,
      extensionMismatch: false,
    };
  }
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

// ── Pipeline integration (Layer 3.5) ─────────────────────────────
//
// The file-type gate sits immediately after the uploads layer. Before
// wiring it we only had extension-based routing which is trivially
// bypassed (`.exe → .txt`). The gate runs `detectFileType` on every
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
  /** Raw bytes. Required — the gate runs Magika on these. */
  readonly bytes: Uint8Array;
  /** Detected coarse-grained handler. Stamped by the gate; absent pre-gate. */
  readonly handler?: FileHandler;
  /** Magika's specific label (e.g. "python", "pdf"). Stamped by the gate. */
  readonly label?: string;
  /** 0.0–1.0 detector confidence. Stamped by the gate. */
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
 * Specific Magika labels that designate a SCRIPT (shell / ps1 / bat) —
 * these map to the coarse handler "code" by default but they differ
 * from ordinary source files (.ts, .py) in one critical way: they are
 * INTERPRETED by shells that honor every byte. An attacker uploading a
 * .txt that's actually a .sh can get code execution if the pipeline
 * ever passes the bytes to `chmod +x && ./file`. Quarantine them until
 * a human reviews — identical policy to executable binaries.
 */
const SCRIPT_LABELS: ReadonlySet<string> = new Set([
  "shell",
  "bash",
  "zsh",
  "powershell",
  "ps1",
  "batch",
  "bat",
  "cmd",
  "vbscript",
]);

/**
 * Map a FileHandler (and optionally the Magika label) to the trust
 * boundary that controls downstream routing.
 *
 * Wave-3E policy (spec priority #3):
 *   - `binary` (pebin/elf/macho/dex/…) → quarantine
 *   - `archive` (zip/tar/rar/7z/xz/…) → quarantine (upgraded from binary)
 *   - `code` with a script label (shell/ps1/bat) → quarantine (new)
 *   - `image/video/audio/data/pdf/docx/xlsx` → binary
 *   - `code` (non-script) / `markup` / `text` → safe
 *   - `unknown` → unknown (conservative)
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
      return SCRIPT_LABELS.has(label.toLowerCase()) ? "quarantine" : "safe";
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
    // Pass the Magika label so shell/ps1/bat get quarantined even though
    // their coarse handler is "code". Source files (.ts/.py) stay safe.
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
    // in case a Magika upgrade changes that contract. Emit the event and
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
 * Middleware layer 3.5 — Magika file-type gate.
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
      // No uploads → nothing to gate. Leave context untouched.
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
