/**
 * File-type validator with optional ML upgrade (magika port).
 *
 * Two layers:
 *
 *   1. Magic-byte detection (always available, zero deps). Covers the
 *      common formats security-sensitive code cares about: ELF, Mach-O,
 *      PE, ZIP, gzip, JPEG/PNG/GIF, PDF, SQLite, plus a UTF-8/ASCII
 *      heuristic for text. This is enough for "is this an executable?"
 *      and "is the upload claiming to be a PDF really an SVG?" checks.
 *
 *   2. Optional magika upgrade (google/magika ONNX model, ~5 MB). If
 *      the user has `magika` installed in their node_modules, we
 *      dynamic-import it and use the ML-based classifier for higher
 *      precision on polyglot / disguised files. We never make magika
 *      a hard dependency: a fresh WOTANN install gets layer 1; users
 *      who want layer 2 run `npm install magika` themselves.
 *
 * The validator answers ONE question: does the declared content type
 * match the actual file content? Callers use it as a guard before
 * processing user-uploaded files (think: an attacker renaming a .so
 * to "image.png" hoping our skill loader will read it as text).
 */

import { readFileSync } from "node:fs";

export interface FileTypeVerdict {
  readonly detectedKind: string;
  readonly confidence: "high" | "medium" | "low";
  readonly source: "magic-byte" | "magika-onnx";
  readonly notes: string;
}

interface MagicSignature {
  readonly kind: string;
  readonly offset: number;
  readonly bytes: ReadonlyArray<number>;
}

const MAGIC_SIGNATURES: ReadonlyArray<MagicSignature> = [
  { kind: "elf", offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { kind: "macho-64", offset: 0, bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { kind: "macho-32", offset: 0, bytes: [0xce, 0xfa, 0xed, 0xfe] },
  { kind: "pe", offset: 0, bytes: [0x4d, 0x5a] },
  { kind: "zip", offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { kind: "gzip", offset: 0, bytes: [0x1f, 0x8b] },
  { kind: "jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { kind: "png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  { kind: "gif", offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { kind: "pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  {
    kind: "sqlite",
    offset: 0,
    bytes: [
      0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33,
    ],
  },
  { kind: "wasm", offset: 0, bytes: [0x00, 0x61, 0x73, 0x6d] },
  { kind: "shebang", offset: 0, bytes: [0x23, 0x21] },
  { kind: "utf8-bom", offset: 0, bytes: [0xef, 0xbb, 0xbf] },
];

function matchesSignature(buf: Buffer, sig: MagicSignature): boolean {
  if (buf.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buf[sig.offset + i] !== sig.bytes[i]) return false;
  }
  return true;
}

export function detectByMagicBytes(buffer: Buffer): FileTypeVerdict {
  const head = buffer.subarray(0, Math.min(buffer.length, 32));
  for (const sig of MAGIC_SIGNATURES) {
    if (matchesSignature(head, sig)) {
      return {
        detectedKind: sig.kind,
        confidence: "high",
        source: "magic-byte",
        notes: `Matched magic signature for ${sig.kind}`,
      };
    }
  }
  if (looksLikeText(buffer)) {
    return {
      detectedKind: "text",
      confidence: "medium",
      source: "magic-byte",
      notes: "No magic signature; UTF-8/ASCII content detected",
    };
  }
  return {
    detectedKind: "unknown",
    confidence: "low",
    source: "magic-byte",
    notes: "No magic signature matched; not obviously text",
  };
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length === 0) return true;
  let nullBytes = 0;
  let highByteRunNoUtf8 = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i] ?? 0;
    if (b === 0) nullBytes++;
    if (b > 127 && (sample[i + 1] ?? 0) < 128) highByteRunNoUtf8++;
  }
  if (nullBytes > sample.length * 0.01) return false;
  if (highByteRunNoUtf8 > sample.length * 0.3) return false;
  return true;
}

export function declaredVsActual(
  declared: string,
  actual: FileTypeVerdict,
): { readonly match: boolean; readonly reason: string } {
  const declaredNorm = declared.toLowerCase().trim();
  const actualNorm = actual.detectedKind.toLowerCase();
  const ALIASES: Readonly<Record<string, ReadonlyArray<string>>> = {
    image: ["jpeg", "png", "gif"],
    "image/jpeg": ["jpeg"],
    "image/png": ["png"],
    "image/gif": ["gif"],
    archive: ["zip", "gzip"],
    "application/zip": ["zip"],
    "application/pdf": ["pdf"],
    text: ["text", "shebang", "utf8-bom"],
    "text/plain": ["text", "shebang", "utf8-bom"],
    binary: ["elf", "macho-64", "macho-32", "pe", "wasm"],
  };
  if (declaredNorm === actualNorm) return { match: true, reason: "exact match" };
  const aliases = ALIASES[declaredNorm];
  if (aliases && aliases.includes(actualNorm))
    return { match: true, reason: `alias match (${declaredNorm} ⇒ ${actualNorm})` };
  return { match: false, reason: `declared=${declaredNorm} actual=${actualNorm}` };
}

let cachedMagika:
  | { readonly identifyBytes: (buf: Uint8Array) => Promise<{ readonly label: string }> }
  | null
  | undefined;

async function tryLoadMagika(): Promise<typeof cachedMagika> {
  if (cachedMagika !== undefined) return cachedMagika;
  try {
    // The "magika" package is an *optional* peer dep — most installs
    // won't have it. We use a runtime-only specifier (string variable)
    // so TypeScript doesn't try to resolve it during typecheck and
    // bundlers don't fail with "module not found" when it's absent.
    const moduleName = "magika";
    const mod = (await import(/* @vite-ignore */ moduleName)) as {
      Magika?: new () => {
        load(): Promise<void>;
        identifyBytes(buf: Uint8Array): Promise<{ label: string }>;
      };
    };
    if (!mod.Magika) {
      cachedMagika = null;
      return null;
    }
    const m = new mod.Magika();
    await m.load();
    cachedMagika = {
      identifyBytes: async (buf: Uint8Array) => {
        const r = await m.identifyBytes(buf);
        return { label: r.label };
      },
    };
    return cachedMagika;
  } catch {
    cachedMagika = null;
    return null;
  }
}

export async function detectFileType(buffer: Buffer): Promise<FileTypeVerdict> {
  const magika = await tryLoadMagika();
  if (magika) {
    try {
      const result = await magika.identifyBytes(buffer);
      return {
        detectedKind: result.label,
        confidence: "high",
        source: "magika-onnx",
        notes: "Detected via google/magika ONNX classifier",
      };
    } catch {
      // fall through to magic-byte
    }
  }
  return detectByMagicBytes(buffer);
}

export async function detectFile(path: string): Promise<FileTypeVerdict> {
  const buf = readFileSync(path);
  return detectFileType(buf);
}
