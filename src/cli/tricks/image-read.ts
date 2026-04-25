/**
 * T12.2 — Terminus-KIRA image-read trick (~60 LOC, V9 §T12.2, line 1685).
 *
 * Reads an image file from disk and base64-encodes it for vision
 * model consumption. Unlocks visual-UI terminal workflows (vim
 * thumbnails, tmux screenshots, matplotlib plots in terminal) by
 * shaping the bytes into the {base64, mimeType} shape the
 * Anthropic / OpenAI / Gemini vision endpoints all accept.
 *
 * Supported formats: PNG, JPEG, GIF, WEBP. Anything else returns an
 * honest-stub error result (QB #6) — we never silently coerce a .bmp
 * or .heic to a wrong mime type and let the model fail downstream.
 *
 * Quality bars honoured:
 *   - QB #6  honest stubs: every failure returns
 *     `{ok:false, error:...}`. No throw, no silent success.
 *   - QB #7  per-call state: no module globals.
 *   - QB #13 env guard: no process.env reads. Caller threads any path
 *     prefix via the absolute path argument.
 *   - QB #14 commit-claim verification: the test file in
 *     tests/cli/tricks/image-read.test.ts asserts the actual base64 +
 *     mime extraction against real bytes written to a temp file.
 */

import { extname } from "node:path";
import { readFile } from "node:fs/promises";

// ── Public Types ──────────────────────────────────────

/** Mime types the vision endpoints accept. Caller-facing union so
 *  TypeScript catches drift if we add a format. */
export type SupportedImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type ImageReadResult =
  | {
      readonly ok: true;
      readonly base64: string;
      readonly mimeType: SupportedImageMime;
      readonly byteLength: number;
    }
  | { readonly ok: false; readonly error: string };

// ── Internal: extension → mime mapping ────────────────

/** Stable map. Frozen so a buggy caller can't shove .bmp in at
 *  runtime and break this module's invariants. */
const EXT_TO_MIME: Readonly<Record<string, SupportedImageMime>> = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
});

/** Exposed for tests + callers that want to render a "supported
 *  formats" list in a help string. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.freeze(Object.keys(EXT_TO_MIME));

// ── readImage ─────────────────────────────────────────

/**
 * Read an image file from disk and return base64 + mime. Returns
 * honest-stub error result on missing file, unsupported extension,
 * or read failure.
 */
export async function readImage(absPath: string): Promise<ImageReadResult> {
  if (typeof absPath !== "string" || absPath.length === 0) {
    return { ok: false, error: "image-read: path must be a non-empty string" };
  }
  const ext = extname(absPath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext];
  if (!mimeType) {
    return {
      ok: false,
      error: `image-read: unsupported extension "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(
        ", ",
      )}`,
    };
  }
  try {
    const buf = await readFile(absPath);
    return {
      ok: true,
      base64: buf.toString("base64"),
      mimeType,
      byteLength: buf.byteLength,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `image-read: failed to read ${absPath} — ${reason}`,
    };
  }
}
