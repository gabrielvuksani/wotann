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
