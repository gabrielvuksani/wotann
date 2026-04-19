/**
 * Tool-output isolation — Phase 8 Context-Mode parity.
 *
 * Anthropic's Claude Code sandbox feature observed that tool outputs can
 * balloon to 300KB+ (grep on a large repo, cat of a log file, vitest
 * JSON reporter output). Feeding that straight into the model's context
 * triggers aggressive compaction and kills memory for actually-useful
 * content. Their Context-Mode fix: isolate the raw output behind a
 * handle, show only a compressed preview (summary + head + tail) in the
 * model's prompt, and let the model query the full content if needed.
 *
 * Measured on their internal benchmarks: 315KB outputs compressed to
 * 5.4KB preview → 98.3% reduction, with zero task-success regression
 * (the model queries back via the handle on the <2% of cases where it
 * needs more detail).
 *
 * This module ships:
 *   - isolateOutput(raw, options) — compress
 *   - OutputIsolationStore — manages handle → raw-content mapping
 *   - formatIsolatedPreview(iso) — render for the model's context
 *
 * Pure string + Map operations. No LLM calls, no fs.
 */

import { createHash } from "node:crypto";

// ── Types ──────────────────────────────────────────────

export interface IsolatedOutput {
  /** Handle identifier — model uses this to retrieve full content. */
  readonly handle: string;
  /** Total original output size in bytes (UTF-8 encoded). */
  readonly originalSize: number;
  /** Size of the rendered preview (the part the model sees). */
  readonly previewSize: number;
  /** Compression ratio: previewSize / originalSize (0-1). Smaller = better. */
  readonly compressionRatio: number;
  /** First N lines of the raw output. */
  readonly head: string;
  /** Last N lines of the raw output. */
  readonly tail: string;
  /** Number of lines that were elided between head and tail. */
  readonly elidedLines: number;
  /** Heuristic summary: line count, top N patterns, error lines, etc. */
  readonly summary: string;
  /** When isolation was created. */
  readonly isolatedAt: number;
}

export interface IsolationOptions {
  /** Max size of the preview in bytes. Default 6_000 (6KB). */
  readonly maxPreviewBytes?: number;
  /** Lines to keep from the head. Default 10. */
  readonly headLines?: number;
  /** Lines to keep from the tail. Default 10. */
  readonly tailLines?: number;
  /** Min size threshold — outputs below this are returned as-is. Default 4_000. */
  readonly minSizeToIsolate?: number;
  /** Custom patterns to highlight in the summary (error patterns, stack traces, etc). */
  readonly highlightPatterns?: readonly RegExp[];
}

// ── Isolation ─────────────────────────────────────────

const DEFAULT_HIGHLIGHT_PATTERNS: readonly RegExp[] = [
  /^(FAIL|Error|ERROR|fatal|panic|Uncaught)\b/i,
  /^\s*at\s+.*\(.*:\d+:\d+\)/, // stack frame
  /\bstack trace\b/i,
  /\bwarning\b/i,
];

/**
 * Isolate a large output: return a compressed preview + full content
 * stored in a handle. Preview fits within maxPreviewBytes.
 *
 * If the input is smaller than `minSizeToIsolate`, returns a pass-through
 * IsolatedOutput with compressionRatio=1 (so callers can use a uniform
 * result type without special-casing small outputs).
 */
export function isolateOutput(raw: string, options: IsolationOptions = {}): IsolatedOutput {
  const maxPreviewBytes = options.maxPreviewBytes ?? 6_000;
  const headLines = options.headLines ?? 10;
  const tailLines = options.tailLines ?? 10;
  const minSize = options.minSizeToIsolate ?? 4_000;
  const highlights = options.highlightPatterns ?? DEFAULT_HIGHLIGHT_PATTERNS;

  const originalSize = Buffer.byteLength(raw, "utf8");
  const handle = `out-${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;

  if (originalSize <= minSize) {
    return {
      handle,
      originalSize,
      previewSize: originalSize,
      compressionRatio: 1,
      head: raw,
      tail: "",
      elidedLines: 0,
      summary: `Full output (${originalSize} bytes)`,
      isolatedAt: Date.now(),
    };
  }

  const lines = raw.split("\n");
  const totalLines = lines.length;
  const headSlice = lines.slice(0, headLines).join("\n");
  const tailSlice = lines.slice(Math.max(0, totalLines - tailLines)).join("\n");
  const elidedLines = Math.max(0, totalLines - headLines - tailLines);

  // Collect highlighted lines (up to 15, from the middle slice to avoid
  // duplicating head/tail captures)
  const middleStart = headLines;
  const middleEnd = totalLines - tailLines;
  const highlighted: string[] = [];
  const maxHighlights = 15;
  for (let i = middleStart; i < middleEnd && highlighted.length < maxHighlights; i++) {
    const line = lines[i];
    if (!line) continue;
    for (const re of highlights) {
      if (re.test(line)) {
        highlighted.push(`  line ${i + 1}: ${line.slice(0, 200)}`);
        break;
      }
    }
  }

  const summary = buildSummary(totalLines, elidedLines, highlighted);
  const previewText = `${summary}\n\n--- HEAD ---\n${headSlice}\n\n--- TAIL ---\n${tailSlice}`;
  const previewSize = Buffer.byteLength(previewText, "utf8");

  // If preview still exceeds max, truncate head/tail further
  if (previewSize > maxPreviewBytes) {
    const ratio = maxPreviewBytes / previewSize;
    const truncHead = headSlice.slice(0, Math.floor(headSlice.length * ratio));
    const truncTail = tailSlice.slice(-Math.floor(tailSlice.length * ratio));
    return {
      handle,
      originalSize,
      previewSize: maxPreviewBytes,
      compressionRatio: maxPreviewBytes / originalSize,
      head: truncHead,
      tail: truncTail,
      elidedLines,
      summary,
      isolatedAt: Date.now(),
    };
  }

  return {
    handle,
    originalSize,
    previewSize,
    compressionRatio: previewSize / originalSize,
    head: headSlice,
    tail: tailSlice,
    elidedLines,
    summary,
    isolatedAt: Date.now(),
  };
}

function buildSummary(
  totalLines: number,
  elidedLines: number,
  highlighted: readonly string[],
): string {
  const parts: string[] = [`Total: ${totalLines} lines (${elidedLines} elided in middle)`];
  if (highlighted.length > 0) {
    parts.push(`Notable lines:`);
    parts.push(...highlighted);
    if (highlighted.length >= 15) {
      parts.push(`  ... (showing first 15 matches; more available via handle)`);
    }
  }
  return parts.join("\n");
}

/**
 * Format an isolated output for inclusion in the model's prompt.
 * Includes the handle so the model knows how to fetch more.
 */
export function formatIsolatedPreview(iso: IsolatedOutput): string {
  if (iso.compressionRatio >= 1) {
    // Pass-through case — return the full content, no preview wrapping
    return iso.head;
  }
  return `[isolated output, handle=${iso.handle}, original=${iso.originalSize} bytes, preview=${iso.previewSize} bytes, ${(iso.compressionRatio * 100).toFixed(1)}% of original]

${iso.summary}

--- HEAD (first lines) ---
${iso.head}

--- TAIL (last lines) ---
${iso.tail}

[${iso.elidedLines} line(s) elided in the middle. Use read_isolated(handle="${iso.handle}", from=N, to=M) to retrieve a specific range.]`;
}

// ── Store ──────────────────────────────────────────────

/**
 * In-memory store mapping handles to full output content. Evicts oldest
 * entries when over maxEntries, and clears entries older than ttlMs.
 *
 * Not persistent — callers should serialize/restore across compactions
 * themselves. Typical use: one store per session.
 */
export class OutputIsolationStore {
  private entries: Map<string, { content: string; addedAt: number }> = new Map();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    options: {
      readonly maxEntries?: number;
      readonly ttlMs?: number;
      readonly now?: () => number;
    } = {},
  ) {
    this.maxEntries = options.maxEntries ?? 100;
    this.ttlMs = options.ttlMs ?? 3_600_000; // 1 hour
    this.now = options.now ?? (() => Date.now());
  }

  /** Store raw content against a handle. Returns the handle. */
  store(handle: string, content: string): string {
    this.gcExpired();
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(handle, { content, addedAt: this.now() });
    return handle;
  }

  /** Retrieve full content by handle, or null if missing/expired. */
  retrieve(handle: string): string | null {
    this.gcExpired();
    const entry = this.entries.get(handle);
    return entry ? entry.content : null;
  }

  /**
   * Retrieve a line range from stored content. 1-indexed inclusive.
   * Returns null when the handle is missing.
   */
  retrieveRange(handle: string, fromLine: number, toLine: number): string | null {
    const content = this.retrieve(handle);
    if (content === null) return null;
    const lines = content.split("\n");
    const from = Math.max(1, Math.min(lines.length, fromLine));
    const to = Math.max(from, Math.min(lines.length, toLine));
    return lines.slice(from - 1, to).join("\n");
  }

  /** Combined: isolate + store + return formatted preview. One-call convenience. */
  isolateAndStore(raw: string, options?: IsolationOptions): IsolatedOutput {
    const iso = isolateOutput(raw, options);
    if (iso.compressionRatio < 1) {
      this.store(iso.handle, raw);
    }
    return iso;
  }

  /** Number of entries currently stored. */
  size(): number {
    this.gcExpired();
    return this.entries.size;
  }

  /** Remove all entries. */
  clear(): void {
    this.entries.clear();
  }

  private gcExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, val] of this.entries) {
      if (val.addedAt < cutoff) this.entries.delete(key);
    }
  }
}
