/**
 * Archive Preflight Security — validate archive files before extraction.
 *
 * Inspects zip and tar archives for common attack vectors without
 * extracting any content. Inspired by oh-my-openagent's archive
 * security layer.
 *
 * CHECKS:
 * 1. Zip bombs — reject if compressed/uncompressed ratio > 100x
 * 2. Path traversal — reject entries with "../" in their path
 * 3. Hard links — reject tar entries linking outside the archive
 * 4. Symlink attacks — reject symlinks pointing to absolute paths or outside
 * 5. File count — reject archives with > 10,000 entries
 * 6. Total size — reject if total uncompressed size > 1GB
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// ── Types ──────────────────────────────────────────────────

export interface ArchiveValidation {
  readonly safe: boolean;
  readonly issues: readonly string[];
}

// ── Constants ──────────────────────────────────────────────

const MAX_COMPRESSION_RATIO = 100;
const MAX_ENTRY_COUNT = 10_000;
const MAX_TOTAL_SIZE_BYTES = 1_073_741_824; // 1GB
const CLI_TIMEOUT = 30_000;

// ── Archive Type Detection ─────────────────────────────────

type ArchiveType = "zip" | "tar" | "unknown";

function detectArchiveType(filePath: string): ArchiveType {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip") || lower.endsWith(".jar") || lower.endsWith(".war")) {
    return "zip";
  }
  if (
    lower.endsWith(".tar") ||
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".tar.bz2") ||
    lower.endsWith(".tar.xz") ||
    lower.endsWith(".tar.zst")
  ) {
    return "tar";
  }
  return "unknown";
}

// ── Zip Validation ─────────────────────────────────────────

function validateZip(filePath: string): readonly string[] {
  const issues: string[] = [];

  let output: string;
  try {
    output = execFileSync("unzip", ["-l", filePath], {
      stdio: "pipe",
      timeout: CLI_TIMEOUT,
      encoding: "utf-8",
    });
  } catch {
    issues.push("Failed to list zip contents — file may be corrupted or password-protected");
    return issues;
  }

  const lines = output.split("\n");
  let entryCount = 0;
  let totalUncompressedSize = 0;
  let totalCompressedSize = 0;

  for (const line of lines) {
    // unzip -l format: "  Length      Date    Time    Name"
    // Data lines:      "    12345  2024-01-01 12:00   path/to/file"
    const match = line.match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/);
    if (!match) continue;

    const uncompressedSize = parseInt(match[1] ?? "0", 10);
    const entryPath = match[2] ?? "";

    entryCount++;
    totalUncompressedSize += uncompressedSize;

    // Check path traversal
    if (entryPath.includes("../") || entryPath.includes("..\\")) {
      issues.push(`Path traversal detected: "${entryPath}"`);
    }

    // Check absolute paths
    if (entryPath.startsWith("/") || /^[A-Za-z]:\\/.test(entryPath)) {
      issues.push(`Absolute path detected: "${entryPath}"`);
    }
  }

  // Extract total compressed size from the summary line
  // Format: " --------                     -------"
  //         "   123456                     50 files"
  const summaryMatch = output.match(/^\s*(\d+)\s+\d+\s+files?$/m);
  if (summaryMatch) {
    totalCompressedSize = parseInt(summaryMatch[1] ?? "0", 10);
  }

  // Check entry count
  if (entryCount > MAX_ENTRY_COUNT) {
    issues.push(`Excessive entry count: ${entryCount} entries (limit: ${MAX_ENTRY_COUNT})`);
  }

  // Check total size
  if (totalUncompressedSize > MAX_TOTAL_SIZE_BYTES) {
    const sizeMB = Math.round(totalUncompressedSize / (1024 * 1024));
    issues.push(`Excessive total size: ${sizeMB}MB uncompressed (limit: 1024MB)`);
  }

  // Check compression ratio (zip bomb detection)
  if (totalCompressedSize > 0 && totalUncompressedSize > 0) {
    const ratio = totalUncompressedSize / totalCompressedSize;
    if (ratio > MAX_COMPRESSION_RATIO) {
      issues.push(`Suspicious compression ratio: ${ratio.toFixed(1)}x (limit: ${MAX_COMPRESSION_RATIO}x) — possible zip bomb`);
    }
  }

  return issues;
}

// ── Tar Validation ─────────────────────────────────────────

function validateTar(filePath: string): readonly string[] {
  const issues: string[] = [];

  // Use --verbose to get file type indicators and sizes
  let output: string;
  try {
    output = execFileSync("tar", ["-tvf", filePath], {
      stdio: "pipe",
      timeout: CLI_TIMEOUT,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB for large listings
    });
  } catch {
    issues.push("Failed to list tar contents — file may be corrupted or unsupported format");
    return issues;
  }

  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  let entryCount = 0;
  let totalSize = 0;

  for (const line of lines) {
    entryCount++;

    // tar -tvf format: "drwxr-xr-x user/group  0 2024-01-01 12:00 path/"
    //                  "lrwxrwxrwx user/group  0 2024-01-01 12:00 link -> target"
    //                  "hrwxr-xr-x user/group  0 2024-01-01 12:00 hardlink link to target"

    // Extract the file size (third field, after permissions and owner)
    const sizeMatch = line.match(/^\S+\s+\S+\s+(\d+)\s+/);
    if (sizeMatch) {
      totalSize += parseInt(sizeMatch[1] ?? "0", 10);
    }

    // Extract the path (everything after the date/time)
    const pathMatch = line.match(/\d{2}:\d{2}\s+(.+)$/);
    const entryPath = pathMatch?.[1] ?? "";

    // Check path traversal
    if (entryPath.includes("../") || entryPath.includes("..\\")) {
      issues.push(`Path traversal detected: "${entryPath}"`);
    }

    // Check absolute paths
    if (entryPath.startsWith("/") || /^[A-Za-z]:\\/.test(entryPath)) {
      issues.push(`Absolute path detected: "${entryPath}"`);
    }

    // Check for symlinks pointing outside the archive
    if (line.startsWith("l")) {
      const symlinkMatch = entryPath.match(/^.+\s+->\s+(.+)$/);
      const target = symlinkMatch?.[1] ?? "";
      if (target.startsWith("/") || target.includes("../")) {
        issues.push(`Symlink escape detected: "${entryPath}" (points to "${target}")`);
      }
    }

    // Check for hard links (indicated by "h" in permissions or "link to" in path)
    if (line.startsWith("h") || entryPath.includes(" link to ")) {
      const linkMatch = entryPath.match(/^(.+)\s+link to\s+(.+)$/);
      const linkTarget = linkMatch?.[2] ?? "";
      if (linkTarget.startsWith("/") || linkTarget.includes("../")) {
        issues.push(`Hard link escape detected: "${linkMatch?.[1] ?? entryPath}" (links to "${linkTarget}")`);
      }
    }
  }

  // Check entry count
  if (entryCount > MAX_ENTRY_COUNT) {
    issues.push(`Excessive entry count: ${entryCount} entries (limit: ${MAX_ENTRY_COUNT})`);
  }

  // Check total size
  if (totalSize > MAX_TOTAL_SIZE_BYTES) {
    const sizeMB = Math.round(totalSize / (1024 * 1024));
    issues.push(`Excessive total size: ${sizeMB}MB (limit: 1024MB)`);
  }

  return issues;
}

// ── Main Validator ─────────────────────────────────────────

/**
 * Validate an archive file for common security issues before extraction.
 *
 * Checks for zip bombs, path traversal, symlink/hardlink attacks,
 * excessive file counts, and excessive total size. Does NOT extract
 * any files — inspection only.
 *
 * @param filePath - Absolute path to the archive file
 * @returns Validation result with safe flag and list of issues
 */
export function validateArchive(filePath: string): ArchiveValidation {
  if (!existsSync(filePath)) {
    return { safe: false, issues: [`Archive file not found: ${filePath}`] };
  }

  const archiveType = detectArchiveType(filePath);

  if (archiveType === "unknown") {
    return {
      safe: false,
      issues: [`Unsupported archive format: ${filePath}. Supported: .zip, .tar, .tar.gz, .tgz, .tar.bz2, .tar.xz, .tar.zst`],
    };
  }

  const issues = archiveType === "zip"
    ? validateZip(filePath)
    : validateTar(filePath);

  return {
    safe: issues.length === 0,
    issues,
  };
}
