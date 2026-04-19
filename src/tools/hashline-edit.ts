/**
 * Hash-Anchored Editing — content-hash-based file editing.
 *
 * Instead of matching exact strings (which can fail on whitespace/encoding),
 * this tool uses content hashes to anchor edits to specific regions.
 *
 * DESIGN (from §8):
 * - Each line gets a hash (xxhash32 or simple FNV-1a for speed)
 * - Edits specify the hash of the content to replace, not the content itself
 * - This prevents accidental matches on duplicate strings
 * - Works alongside the traditional Edit tool as a safer alternative
 *
 * BENEFITS:
 * - No ambiguity when the same string appears multiple times
 * - Immune to whitespace/encoding differences
 * - Faster matching (hash comparison vs string comparison)
 * - Can verify file hasn't changed since the agent read it
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { recordWrite } from "../security/write-audit.js";

// ── Hash Functions ────────────────────────────────────────

/**
 * FNV-1a 32-bit hash — fast, non-cryptographic, good distribution.
 * Used for line-level hashing where speed matters more than security.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Hash a single line for anchoring.
 * Returns a hex string for readability in tool calls.
 */
export function hashLine(line: string): string {
  return fnv1a32(line.trimEnd()).toString(16).padStart(8, "0");
}

/**
 * Hash a block of text (multiple lines).
 * Uses SHA-256 truncated to 8 chars for blocks.
 */
export function hashBlock(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Hash an entire file for change detection.
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

// ── Line Index ────────────────────────────────────────────

export interface HashedLine {
  readonly lineNumber: number;
  readonly content: string;
  readonly hash: string;
}

/**
 * Build a hash index for a file.
 * Returns each line with its hash for anchored editing.
 */
export function buildLineIndex(content: string): readonly HashedLine[] {
  return content.split("\n").map((line, i) => ({
    lineNumber: i + 1,
    content: line,
    hash: hashLine(line),
  }));
}

/**
 * Find lines matching a specific hash.
 * Returns all matching lines (hashes may collide, but rarely).
 */
export function findByHash(
  index: readonly HashedLine[],
  targetHash: string,
): readonly HashedLine[] {
  return index.filter((line) => line.hash === targetHash);
}

// ── Hash-Anchored Edit ────────────────────────────────────

export interface HashEditOperation {
  /** Hash of the first line to replace */
  readonly startHash: string;
  /** Hash of the last line to replace (inclusive). If omitted, single line. */
  readonly endHash?: string;
  /** New content to insert in place of the matched range */
  readonly newContent: string;
  /** File-level hash to verify the file hasn't changed */
  readonly fileHash?: string;
}

export interface HashEditResult {
  readonly success: boolean;
  readonly linesReplaced: number;
  readonly newFileHash: string;
  readonly error?: string;
}

/**
 * Apply a hash-anchored edit to a file.
 *
 * 1. Verify file hash (if provided) — ensures file hasn't changed
 * 2. Find the start line by hash
 * 3. Find the end line by hash (or use start line if endHash omitted)
 * 4. Replace the range with newContent
 * 5. Write the file and return the new file hash
 */
export function applyHashEdit(filePath: string, edit: HashEditOperation): HashEditResult {
  const content = readFileSync(filePath, "utf-8");

  // Verify file hash if provided
  if (edit.fileHash) {
    const currentHash = createHash("sha256").update(content).digest("hex");
    if (currentHash !== edit.fileHash) {
      return {
        success: false,
        linesReplaced: 0,
        newFileHash: currentHash,
        error: "File has been modified since last read. Re-read the file first.",
      };
    }
  }

  const index = buildLineIndex(content);

  // Find start line
  const startMatches = findByHash(index, edit.startHash);
  if (startMatches.length === 0) {
    return {
      success: false,
      linesReplaced: 0,
      newFileHash: hashBlock(content),
      error: `No line found with hash ${edit.startHash}`,
    };
  }
  if (startMatches.length > 1) {
    return {
      success: false,
      linesReplaced: 0,
      newFileHash: hashBlock(content),
      error: `Hash collision: ${startMatches.length} lines match hash ${edit.startHash}. Use a more specific range.`,
    };
  }

  const startLine = startMatches[0]!.lineNumber;
  let endLine = startLine;

  // Find end line if specified
  if (edit.endHash) {
    const endMatches = findByHash(index, edit.endHash);
    if (endMatches.length === 0) {
      return {
        success: false,
        linesReplaced: 0,
        newFileHash: hashBlock(content),
        error: `No line found with end hash ${edit.endHash}`,
      };
    }
    // Find the first match that comes after the start line
    const validEnd = endMatches.find((m) => m.lineNumber >= startLine);
    if (!validEnd) {
      return {
        success: false,
        linesReplaced: 0,
        newFileHash: hashBlock(content),
        error: `End hash ${edit.endHash} found but before start line ${startLine}`,
      };
    }
    endLine = validEnd.lineNumber;
  }

  // Apply the edit
  const lines = content.split("\n");
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  const newContent = [...before, ...edit.newContent.split("\n"), ...after].join("\n");

  // Compute shaBefore over the pre-write bytes so the audit entry
  // captures the exact state this edit observed. `edit.fileHash` is
  // only present when the caller supplied it; re-hashing the content
  // we just read is the authoritative before-state.
  const shaBefore = createHash("sha256").update(content).digest("hex");

  writeFileSync(filePath, newContent);

  const newFileHash = createHash("sha256").update(newContent).digest("hex");

  // Wave-3E (spec priority #5): append to the write-audit chain so
  // every file mutation is tamper-evidently logged. `recordWrite`
  // is a no-op when WOTANN_WRITE_AUDIT_DISABLED=1 (tests only).
  recordWrite({
    file: filePath,
    shaBefore,
    shaAfter: newFileHash,
    tool: "hashline_edit",
  });

  return {
    success: true,
    linesReplaced: endLine - startLine + 1,
    newFileHash,
  };
}
