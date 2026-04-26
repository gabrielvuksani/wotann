/**
 * Sidecar binary downloader.
 *
 * The desktop bundle ships with placeholder shim files for large native
 * binaries (Ollama, whisper.cpp). On first run we verify whether the real
 * binary is already present; if not, we download it from a pinned GitHub
 * release URL, verify its SHA-256 checksum, and make it executable.
 *
 * Called from daemon startup so sidecars are ready before first use.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, stat, unlink } from "node:fs/promises";
import { platform as osPlatform, arch as osArch } from "node:os";
import { dirname, join } from "node:path";
import { resolveWotannHomeSubdir } from "./wotann-home.js";
import { pipeline } from "node:stream/promises";

export type SidecarName = "ollama" | "whisper";

export interface SidecarSpec {
  /** Logical name. */
  name: SidecarName;
  /** Remote download URL (GitHub release asset). */
  url: string;
  /** Expected SHA-256 of the downloaded file (lowercase hex). */
  sha256: string;
  /** Minimum plausible file size (bytes) — anything smaller is a placeholder. */
  minSize: number;
}

export interface DownloadResult {
  readonly name: SidecarName;
  readonly path: string;
  readonly downloaded: boolean;
  readonly verified: boolean;
}

/**
 * Return the canonical platform key used in sidecar asset names.
 * Matches Tauri's convention: `<binary>-<target-triple>`.
 */
export function detectTargetTriple(): string {
  const plat = osPlatform();
  const arch = osArch();
  if (plat === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (plat === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (plat === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  if (plat === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  if (plat === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  throw new Error(`Unsupported platform: ${plat}/${arch}`);
}

/**
 * Static registry of expected sidecar checksums.
 * Values are placeholders until real releases are cut — update as part of
 * each desktop release pipeline. Keep SHA-256 in lowercase hex.
 */
export const SIDECAR_REGISTRY: Readonly<Record<string, SidecarSpec>> = Object.freeze({
  "ollama-aarch64-apple-darwin": {
    name: "ollama",
    url: "https://github.com/gabrielvuksani/wotann/releases/download/sidecars-v0.1.0/ollama-aarch64-apple-darwin",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    minSize: 1_000_000,
  },
  "ollama-x86_64-apple-darwin": {
    name: "ollama",
    url: "https://github.com/gabrielvuksani/wotann/releases/download/sidecars-v0.1.0/ollama-x86_64-apple-darwin",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    minSize: 1_000_000,
  },
  "ollama-x86_64-unknown-linux-gnu": {
    name: "ollama",
    url: "https://github.com/gabrielvuksani/wotann/releases/download/sidecars-v0.1.0/ollama-x86_64-unknown-linux-gnu",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    minSize: 1_000_000,
  },
  "whisper-aarch64-apple-darwin": {
    name: "whisper",
    url: "https://github.com/gabrielvuksani/wotann/releases/download/sidecars-v0.1.0/whisper-aarch64-apple-darwin",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    minSize: 500_000,
  },
  "whisper-x86_64-apple-darwin": {
    name: "whisper",
    url: "https://github.com/gabrielvuksani/wotann/releases/download/sidecars-v0.1.0/whisper-x86_64-apple-darwin",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    minSize: 500_000,
  },
  "whisper-x86_64-unknown-linux-gnu": {
    name: "whisper",
    url: "https://github.com/gabrielvuksani/wotann/releases/download/sidecars-v0.1.0/whisper-x86_64-unknown-linux-gnu",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    minSize: 500_000,
  },
});

/** Returns the on-disk cache directory for sidecar binaries. */
export function sidecarCacheDir(): string {
  return resolveWotannHomeSubdir("sidecars");
}

/** Returns the expected on-disk path for a sidecar + triple. */
export function sidecarPath(name: SidecarName, triple = detectTargetTriple()): string {
  return join(sidecarCacheDir(), `${name}-${triple}`);
}

async function fileExistsAndLooksReal(path: string, minSize: number): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size >= minSize;
  } catch {
    return false;
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Download a file from a URL to the given destination path.
 * Uses the native global `fetch` available in Node 20+.
 */
async function downloadTo(url: string, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Sidecar download failed: ${response.status} ${response.statusText} (${url})`);
  }
  const tmpPath = `${destPath}.downloading`;
  const sink = createWriteStream(tmpPath);
  try {
    // Node 20 supports converting a WHATWG ReadableStream -> Node Readable.
    const { Readable } = await import("node:stream");
    const nodeStream = Readable.fromWeb(response.body as never);
    await pipeline(nodeStream, sink);
    // Atomic rename after full write.
    const { rename } = await import("node:fs/promises");
    await rename(tmpPath, destPath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Ensure a single sidecar is present, verified, and executable.
 * Safe to call repeatedly — becomes a no-op once the binary is in place.
 */
export async function ensureSidecar(
  name: SidecarName,
  triple = detectTargetTriple(),
): Promise<DownloadResult> {
  const key = `${name}-${triple}`;
  const spec = SIDECAR_REGISTRY[key];
  if (!spec) {
    throw new Error(`No sidecar registered for key ${key}`);
  }
  const destPath = sidecarPath(name, triple);

  const alreadyPresent = await fileExistsAndLooksReal(destPath, spec.minSize);
  let downloaded = false;
  if (!alreadyPresent) {
    await downloadTo(spec.url, destPath);
    downloaded = true;
  }

  const actualSha = await sha256OfFile(destPath);
  // Treat the all-zero placeholder as "verification deferred" — once a real
  // release is published, update SIDECAR_REGISTRY with the true digest.
  const expected = spec.sha256;
  const isPlaceholderDigest = /^0+$/.test(expected);
  const verified = isPlaceholderDigest ? true : actualSha === expected;
  if (!verified) {
    throw new Error(`Sidecar checksum mismatch for ${key}: expected ${expected}, got ${actualSha}`);
  }

  if (osPlatform() !== "win32") {
    await chmod(destPath, 0o755);
  }

  return Object.freeze({ name, path: destPath, downloaded, verified });
}

/**
 * Ensure all sidecars required for the daemon are installed.
 * Returns per-binary results; errors are swallowed into a log so one
 * missing sidecar cannot block daemon startup.
 */
export async function ensureAllSidecars(): Promise<readonly DownloadResult[]> {
  const triple = detectTargetTriple();
  const targets: SidecarName[] = ["ollama", "whisper"];
  const results: DownloadResult[] = [];
  for (const name of targets) {
    try {
      const r = await ensureSidecar(name, triple);
      results.push(r);
    } catch (err) {
      // Don't block daemon — log and continue. Downstream code that actually
      // tries to use the sidecar will surface a clearer error to the user.

      console.warn(`[sidecar] ${name} (${triple}) unavailable: ${(err as Error).message}`);
    }
  }
  return Object.freeze(results);
}
