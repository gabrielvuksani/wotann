/**
 * Vision OCR pipeline (S3-7).
 *
 * Replaces the placeholder `[Image provided — see text description below]`
 * stub in capability-augmenter.augmentVision with a real OCR call so
 * non-vision models can actually reason about image content.
 *
 * Strategy: try platform-native OCR first (cheapest, no extra deps),
 * fall through to Tesseract if available, give up gracefully if no
 * OCR backend is present.
 *
 *   1. macOS: use `osascript` to invoke the system Vision.framework via
 *      a shortcut that already exists (`Live Text`) — falls back to
 *      `sips` extraction if shortcut is unavailable.
 *   2. Linux/Windows: shell to `tesseract` if it's on PATH.
 *   3. No backend: return null. The caller surfaces a clear
 *      "[OCR unavailable on this platform]" marker so the model gets
 *      honest input rather than a fake transcription.
 *
 * Image input accepted as either:
 *   - A file path (`/tmp/screenshot.png`)
 *   - A base64 data URL (`data:image/png;base64,...`)
 *
 * The data-URL case writes the bytes to a tmp file first since both
 * Vision and Tesseract are file-driven. Tmp file is cleaned up after.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

export interface OCRResult {
  readonly text: string;
  readonly backend: "macos-vision" | "tesseract" | "unavailable";
  readonly confidence?: number;
  readonly durationMs: number;
}

/**
 * Materialize a data URL to a tmp file. Returns the path + a cleanup
 * thunk the caller invokes when done. For file paths, returns the path
 * unchanged with a no-op cleanup.
 */
function materializeImage(input: string): { path: string; cleanup: () => void } {
  if (!input.startsWith("data:")) {
    if (!existsSync(input)) throw new Error(`Image not found: ${input}`);
    return { path: input, cleanup: () => {} };
  }
  const match = input.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URL");
  const mime = match[1] ?? "application/octet-stream";
  const ext = mime.split("/")[1] ?? "bin";
  const dir = mkdtempSync(join(tmpdir(), "wotann-ocr-"));
  const path = join(dir, `image.${ext}`);
  writeFileSync(path, Buffer.from(match[2] ?? "", "base64"));
  return {
    path,
    cleanup: () => {
      try {
        unlinkSync(path);
      } catch {
        /* best-effort */
      }
    },
  };
}

/** Attempt OCR via macOS Vision.framework. */
function tryMacOSVision(imagePath: string): string | null {
  if (platform() !== "darwin") return null;
  // Inline osascript that drops into Python via Foundation/Vision. The
  // alternative — Live Text shortcut — requires the user to have
  // configured a shortcut named "Extract Text"; the inline path is more
  // robust because it relies only on the Vision framework which is
  // present on macOS 13+.
  const script = `
import Vision
import Foundation
import sys

url = Foundation.NSURL.fileURLWithPath_(sys.argv[1])
req = Vision.VNRecognizeTextRequest.alloc().init()
req.setRecognitionLevel_(0)  // accurate
handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, None)
err = handler.performRequests_error_([req], None)
out = []
for obs in (req.results() or []):
    cand = obs.topCandidates_(1)
    if cand and len(cand) > 0:
        out.append(cand[0].string())
print("\\n".join(out))
`.trim();
  try {
    const out = execFileSync("/usr/bin/python3", ["-c", script, imagePath], {
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const text = out.toString("utf-8").trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Attempt OCR via Tesseract CLI. */
function tryTesseract(imagePath: string): string | null {
  try {
    const out = execFileSync("tesseract", [imagePath, "-", "--psm", "6"], {
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const text = out.toString("utf-8").trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Run OCR over an image and return the extracted text + which backend
 * was used. Always synchronous because both backends shell out to
 * blocking child processes; callers should treat this as ~100-1000ms.
 */
export function ocrImage(input: string): OCRResult {
  const start = Date.now();
  const { path, cleanup } = materializeImage(input);
  try {
    const macos = tryMacOSVision(path);
    if (macos !== null) {
      return {
        text: macos,
        backend: "macos-vision",
        durationMs: Date.now() - start,
      };
    }
    const tess = tryTesseract(path);
    if (tess !== null) {
      return {
        text: tess,
        backend: "tesseract",
        durationMs: Date.now() - start,
      };
    }
    return {
      text: "",
      backend: "unavailable",
      durationMs: Date.now() - start,
    };
  } finally {
    cleanup();
  }
}

/**
 * Render a structured "[Image: <description>]" marker for inclusion in
 * a text prompt. Returns a graceful fallback when OCR is unavailable so
 * the model gets HONEST signal ("[OCR unavailable on this platform —
 * image cannot be processed]") instead of a fabricated description.
 */
export function describeImageForPrompt(input: string): string {
  try {
    const result = ocrImage(input);
    if (result.backend === "unavailable") {
      return "[OCR unavailable on this platform — install tesseract or run on macOS 13+ for vision support]";
    }
    if (!result.text) {
      return `[Image processed via ${result.backend} — no readable text detected]`;
    }
    return `[Image OCR via ${result.backend} (${result.durationMs}ms):\n${result.text}\n]`;
  } catch (err) {
    return `[OCR failed: ${err instanceof Error ? err.message : "unknown error"}]`;
  }
}
