/**
 * Hash-anchored editing (E1).
 *
 * oh-my-pi pattern: instead of asking the model to quote a full surrounding
 * block of code to pinpoint an edit, require the model to supply a short
 * content hash of the lines it intends to modify. We verify the hash before
 * editing and refuse if the hash is stale (the file was modified since the
 * model "saw" it). This traps the class of weak-model errors where the
 * model hallucinates context and overwrites the wrong region.
 *
 * Wire protocol (tool argument):
 *   {
 *     filePath: "src/foo.ts",
 *     hashAnchor: { startLine: 42, endLine: 48, hash: "a1b2c3d4e5f6" },
 *     replacement: "new code goes here",
 *   }
 *
 * Hash is a short 16-char prefix of SHA-256 over the EXACT characters
 * between `startLine` (inclusive) and `endLine` (inclusive), normalised for
 * trailing whitespace and line endings.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

export interface HashAnchor {
  readonly startLine: number; // 1-indexed
  readonly endLine: number; // 1-indexed, inclusive
  readonly hash: string; // 16-char hex prefix of SHA-256
}

export interface HashAnchoredEdit {
  readonly filePath: string;
  readonly hashAnchor: HashAnchor;
  readonly replacement: string;
}

export type HashAnchoredEditResult =
  | { readonly ok: true; readonly bytesWritten: number; readonly newHash: string }
  | {
      readonly ok: false;
      readonly reason: "file_missing" | "hash_mismatch" | "range_invalid" | "write_failed";
      readonly detail: string;
      readonly expectedHash?: string;
      readonly actualHash?: string;
    };

/**
 * Compute the 16-char hash of a specific line range. Used by both the
 * tool handler and by any agent that wants to pre-compute an anchor.
 */
export function computeAnchorHash(content: string, startLine: number, endLine: number): string {
  const lines = content.split(/\r?\n/);
  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    return "";
  }
  const slice = lines
    .slice(startLine - 1, endLine)
    .map((l) => l.replace(/\s+$/, "")) // trim trailing whitespace
    .join("\n");
  return createHash("sha256").update(slice).digest("hex").slice(0, 16);
}

/**
 * Apply a hash-anchored edit atomically. Verifies the hash before writing;
 * refuses if the file changed since the model saw it.
 */
export function applyHashAnchoredEdit(edit: HashAnchoredEdit): HashAnchoredEditResult {
  if (!existsSync(edit.filePath)) {
    return { ok: false, reason: "file_missing", detail: `File does not exist: ${edit.filePath}` };
  }

  const content = readFileSync(edit.filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const { startLine, endLine, hash } = edit.hashAnchor;

  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    return {
      ok: false,
      reason: "range_invalid",
      detail: `startLine=${startLine}, endLine=${endLine}, fileLines=${lines.length}`,
    };
  }

  const actualHash = computeAnchorHash(content, startLine, endLine);
  if (actualHash !== hash) {
    return {
      ok: false,
      reason: "hash_mismatch",
      detail: "Anchor hash does not match current file content. Re-read the file and retry.",
      expectedHash: hash,
      actualHash,
    };
  }

  // Splice: everything before startLine + replacement + everything after endLine
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  const replacementLines = edit.replacement.split(/\r?\n/);
  const newContent = [...before, ...replacementLines, ...after].join("\n");

  try {
    writeFileSync(edit.filePath, newContent, "utf-8");
  } catch (err) {
    return {
      ok: false,
      reason: "write_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const newHash = computeAnchorHash(newContent, startLine, startLine + replacementLines.length - 1);
  return {
    ok: true,
    bytesWritten: Buffer.byteLength(newContent, "utf-8"),
    newHash,
  };
}

/**
 * Tool schema fragment — consumers register this so the model knows to
 * supply a `hashAnchor`. Keep the description model-friendly.
 */
export const HASH_ANCHORED_EDIT_TOOL_SCHEMA = {
  name: "hash_anchored_edit",
  description:
    "Apply a code edit identified by a precise content hash, not a fuzzy text match. " +
    "Use this for any edit on a weak model — it prevents accidentally overwriting the " +
    "wrong region. You must FIRST read the target file, compute the 16-char SHA-256 " +
    "prefix of the lines you intend to replace (trailing whitespace stripped), then " +
    "pass that hash as hashAnchor.hash. If the hash does not match, the edit is refused " +
    "and you must re-read the file before retrying.",
  inputSchema: {
    type: "object",
    required: ["filePath", "hashAnchor", "replacement"],
    properties: {
      filePath: { type: "string", description: "Absolute or workspace-relative file path." },
      hashAnchor: {
        type: "object",
        required: ["startLine", "endLine", "hash"],
        properties: {
          startLine: { type: "integer", description: "1-indexed inclusive start line." },
          endLine: { type: "integer", description: "1-indexed inclusive end line." },
          hash: {
            type: "string",
            description: "First 16 hex characters of SHA-256 over the line range.",
          },
        },
      },
      replacement: { type: "string", description: "New content. May contain multiple lines." },
    },
  },
} as const;

/** Convenience: annotate a file with hashes for every symbol, for the model. */
export function annotateFileWithHashes(
  content: string,
  chunkSize = 20,
): Array<{ startLine: number; endLine: number; hash: string; preview: string }> {
  const lines = content.split(/\r?\n/);
  const out: Array<{ startLine: number; endLine: number; hash: string; preview: string }> = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    const startLine = i + 1;
    const endLine = Math.min(i + chunkSize, lines.length);
    const hash = computeAnchorHash(content, startLine, endLine);
    out.push({
      startLine,
      endLine,
      hash,
      preview: (lines[i] ?? "").slice(0, 80),
    });
  }
  return out;
}
