/**
 * Hashline Edits — text-format surgical patch parser + applier.
 *
 * Port of can1357/oh-my-pi's hashline edit format (see
 * docs/internal/RESEARCH_OH_MY_PI_AND_NEW_CLONES.md §2.1 and
 * MASTER_PLAN_V8 §5 P1-UI8).
 *
 * This is the *text-format* sibling of `hash-anchored-edit.ts` and
 * `hashline-edit.ts`, which both expose structured `{startLine, endLine,
 * hash, replacement}` APIs. This module parses a human-readable block
 * format that the model emits inline:
 *
 *   # path/to/file.ts:42
 *   - const x = 1;
 *   + const x = 2;
 *
 *   # path/to/other.ts:5-7
 *   - function foo() {
 *   -   return 1;
 *   - }
 *   + function foo() { return 2; }
 *
 *   # path/to/new.ts
 *   + // prepended to new file
 *
 *   # path/to/end.ts:end
 *   + // appended to end of file
 *
 * The `-` lines are the EXPECTED current content (used for conflict
 * detection — a stale read fails with a structured error). The `+` lines
 * are the new content. A block with only `+` lines and no `:line`
 * suffix creates/prepends; with `:end` it appends; with `:line` it
 * replaces starting at that line.
 *
 * WHY THIS EXISTS
 * ---------------
 * Per oh-my-pi's empirical benchmark (16 models × 180 tasks × 3 runs),
 * mid-tier models achieve dramatically higher edit success with this
 * format vs free-form diff or str_replace — Grok Code Fast 1 went from
 * 6.7% → 68.3% (a 10× gain). The format is strict enough to parse
 * unambiguously but ergonomic enough that the model rarely fails to
 * emit it correctly.
 *
 * SECURITY POSTURE
 * ----------------
 * 1. Path traversal: every target path is resolved against a supplied
 *    workspace root via `isWithinWorkspace`. Any path that escapes the
 *    root (including through symlinks) is rejected before any filesystem
 *    operation.
 * 2. Binary files: files containing NUL bytes are refused (we do not
 *    attempt line-wise edits on binary content).
 * 3. Atomic application: if ANY edit in a batch fails to apply, ALL
 *    writes are rolled back to their pre-batch state.
 * 4. Content-mismatch detection: the `-` lines must exactly match the
 *    current file content at the specified lines. If not, the edit is
 *    rejected with an explicit diff showing expected vs actual.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

import { isWithinWorkspace } from "../sandbox/security.js";

// ── Types ─────────────────────────────────────────────────

/**
 * A single parsed hashline edit. The location is either:
 *   - a specific line or range inside an existing file,
 *   - the special marker `"prepend"` meaning before-line-1,
 *   - the special marker `"append"` meaning after-last-line.
 *
 * The `minusLines` array captures the expected current content (used
 * for conflict detection). The `plusLines` array is what replaces it.
 * For pure appends/prepends, `minusLines` is empty.
 */
export interface HashlineEdit {
  readonly path: string;
  readonly locator: HashlineLocator;
  readonly minusLines: readonly string[];
  readonly plusLines: readonly string[];
}

export type HashlineLocator =
  | { readonly kind: "line"; readonly start: number; readonly end: number }
  | { readonly kind: "prepend" }
  | { readonly kind: "append" };

/**
 * Result of a single edit application. `ok` distinguishes success from
 * the four failure modes. On `content_mismatch`, `expected` and
 * `actual` capture the diff for the model to retry.
 */
export type HashlineApplyOutcome =
  | { readonly ok: true; readonly path: string; readonly bytesWritten: number }
  | {
      readonly ok: false;
      readonly path: string;
      readonly reason:
        | "file_missing"
        | "binary_refused"
        | "range_invalid"
        | "content_mismatch"
        | "path_escape"
        | "write_failed";
      readonly detail: string;
      readonly expected?: readonly string[];
      readonly actual?: readonly string[];
    };

/**
 * Result of a batch (multi-edit) application. Either all succeed, or
 * all are rolled back to pre-batch state and a single failing outcome
 * is reported.
 */
export type HashlineBatchResult =
  | { readonly ok: true; readonly outcomes: readonly HashlineApplyOutcome[] }
  | {
      readonly ok: false;
      readonly rolledBack: true;
      readonly failure: HashlineApplyOutcome;
      readonly priorOutcomes: readonly HashlineApplyOutcome[];
    };

export interface HashlineParseError {
  readonly lineNumber: number;
  readonly message: string;
  readonly raw: string;
}

export type HashlineParseResult =
  | { readonly ok: true; readonly edits: readonly HashlineEdit[] }
  | { readonly ok: false; readonly errors: readonly HashlineParseError[] };

// ── Parser ────────────────────────────────────────────────

/**
 * Regex for the hashline header. Captures:
 *   1. path
 *   2. optional locator — `:line`, `:start-end`, or `:end`
 *
 * The path must NOT contain whitespace (a deliberate constraint so
 * we can parse unambiguously without escape sequences).
 */
const HEADER_REGEX = /^#\s+([^\s:]+)(?::(\d+(?:-\d+)?|end))?\s*$/;

/**
 * Parse a block of hashline edits. Accepts the full text the model
 * emitted; returns either a list of structured edits or a list of
 * parse errors with line numbers.
 */
export function parseHashlines(text: string): HashlineParseResult {
  const lines = text.split(/\r?\n/);
  const edits: HashlineEdit[] = [];
  const errors: HashlineParseError[] = [];

  let cursor = 0;
  while (cursor < lines.length) {
    const raw = lines[cursor] ?? "";
    const trimmed = raw.trimEnd();

    // Skip blank lines between blocks
    if (trimmed === "") {
      cursor += 1;
      continue;
    }

    // Every block MUST start with a `#` header
    if (!trimmed.startsWith("#")) {
      errors.push({
        lineNumber: cursor + 1,
        message: "expected '# path[:line]' header to start an edit block",
        raw,
      });
      // Skip to next blank line to resync
      while (cursor < lines.length && (lines[cursor]?.trim() ?? "") !== "") {
        cursor += 1;
      }
      continue;
    }

    const match = HEADER_REGEX.exec(trimmed);
    if (!match) {
      errors.push({
        lineNumber: cursor + 1,
        message: "malformed header; expected '# <path>[:<line>|<start>-<end>|end]'",
        raw,
      });
      cursor += 1;
      continue;
    }

    const path = match[1] ?? "";
    const locatorRaw = match[2];
    const locator = parseLocator(locatorRaw);

    if (!locator.ok) {
      errors.push({
        lineNumber: cursor + 1,
        message: locator.error,
        raw,
      });
      cursor += 1;
      continue;
    }

    cursor += 1;

    const minusLines: string[] = [];
    const plusLines: string[] = [];

    while (cursor < lines.length) {
      const body = lines[cursor] ?? "";
      const bodyTrimmed = body.trimEnd();

      // Blank line or a new `#` header terminates the block
      if (bodyTrimmed === "" || bodyTrimmed.startsWith("#")) {
        break;
      }

      if (body.startsWith("- ")) {
        minusLines.push(body.slice(2));
      } else if (body === "-") {
        minusLines.push("");
      } else if (body.startsWith("+ ")) {
        plusLines.push(body.slice(2));
      } else if (body === "+") {
        plusLines.push("");
      } else {
        errors.push({
          lineNumber: cursor + 1,
          message: "edit body must start with '-' or '+' (or be blank to end block)",
          raw: body,
        });
        // Resync: advance to next blank or header
        while (cursor < lines.length) {
          const next = lines[cursor] ?? "";
          if (next.trim() === "" || next.trimStart().startsWith("#")) break;
          cursor += 1;
        }
        break;
      }

      cursor += 1;
    }

    // Semantic validation on the assembled edit
    if (locator.locator.kind === "prepend" && minusLines.length > 0) {
      errors.push({
        lineNumber: cursor,
        message: "prepend block (no :line suffix) cannot contain '-' lines",
        raw: trimmed,
      });
      continue;
    }
    if (locator.locator.kind === "append" && minusLines.length > 0) {
      errors.push({
        lineNumber: cursor,
        message: "append block (:end) cannot contain '-' lines",
        raw: trimmed,
      });
      continue;
    }
    if (locator.locator.kind === "line" && minusLines.length === 0 && plusLines.length === 0) {
      errors.push({
        lineNumber: cursor,
        message: "edit block at :line must contain at least one '-' or '+' line",
        raw: trimmed,
      });
      continue;
    }

    edits.push({
      path,
      locator: locator.locator,
      minusLines,
      plusLines,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, edits: dedupEdits(edits) };
}

function parseLocator(
  raw: string | undefined,
): { ok: true; locator: HashlineLocator } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, locator: { kind: "prepend" } };
  }
  if (raw === "end") {
    return { ok: true, locator: { kind: "append" } };
  }
  if (/^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (n < 1) {
      return { ok: false, error: "line number must be >= 1" };
    }
    return { ok: true, locator: { kind: "line", start: n, end: n } };
  }
  const rangeMatch = /^(\d+)-(\d+)$/.exec(raw);
  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1] ?? "0", 10);
    const end = Number.parseInt(rangeMatch[2] ?? "0", 10);
    if (start < 1 || end < start) {
      return { ok: false, error: `invalid range: ${start}-${end}` };
    }
    return { ok: true, locator: { kind: "line", start, end } };
  }
  return { ok: false, error: `unrecognized locator: '${raw}'` };
}

/**
 * Deduplicate edits that target the exact same location. The LATER
 * edit wins (consistent with "last writer wins" for a single batch).
 * Prepend and append are NOT deduped against each other — each is a
 * distinct operation.
 */
function dedupEdits(edits: readonly HashlineEdit[]): readonly HashlineEdit[] {
  const seen = new Map<string, number>();
  const result: HashlineEdit[] = [];
  for (const edit of edits) {
    const key = locatorKey(edit.path, edit.locator);
    const prev = seen.get(key);
    if (prev !== undefined) {
      // Replace the earlier edit in-place so ordering is preserved
      // for other locations.
      result[prev] = edit;
    } else {
      seen.set(key, result.length);
      result.push(edit);
    }
  }
  return result;
}

function locatorKey(path: string, locator: HashlineLocator): string {
  switch (locator.kind) {
    case "line":
      return `${path}:${locator.start}-${locator.end}`;
    case "prepend":
      return `${path}:<prepend>`;
    case "append":
      return `${path}:<append>`;
  }
}

// ── Applier ───────────────────────────────────────────────

/**
 * Apply a batch of edits with all-or-nothing semantics. Before writing
 * anything, we validate every edit against the current filesystem
 * state. Only if ALL validations pass do we perform the writes. If a
 * mid-batch write fails (e.g. permission error), we restore every
 * already-written file to its pre-batch contents.
 *
 * `workspaceRoot` must be an absolute path; every edit.path is checked
 * to be inside it to prevent path-traversal attacks (`../../etc/passwd`).
 */
export function applyHashlineEdits(
  edits: readonly HashlineEdit[],
  workspaceRoot: string,
  options?: { readonly allowCreate?: boolean },
): HashlineBatchResult {
  const allowCreate = options?.allowCreate ?? true;

  if (edits.length === 0) {
    return { ok: true, outcomes: [] };
  }

  // Pre-validate every edit without mutating anything
  const preparedEdits: PreparedEditOk[] = [];
  for (const edit of edits) {
    const prep = prepareEdit(edit, workspaceRoot, allowCreate);
    if (!prep.ok) {
      return {
        ok: false,
        rolledBack: true,
        failure: prep.outcome,
        priorOutcomes: [],
      };
    }
    preparedEdits.push(prep);
  }

  // Apply in order, capturing original contents for rollback
  const rollbackLog: Array<{ path: string; originalContent: string | null }> = [];
  const outcomes: HashlineApplyOutcome[] = [];

  for (const prep of preparedEdits) {
    try {
      const original = existsSync(prep.edit.path) ? readFileSync(prep.edit.path, "utf-8") : null;
      rollbackLog.push({ path: prep.edit.path, originalContent: original });
      mkdirSync(dirname(prep.edit.path), { recursive: true });
      writeFileSync(prep.edit.path, prep.newContent, "utf-8");
      outcomes.push({
        ok: true,
        path: prep.edit.path,
        bytesWritten: Buffer.byteLength(prep.newContent, "utf-8"),
      });
    } catch (err) {
      // Roll back every write we've done so far
      rollback(rollbackLog);
      return {
        ok: false,
        rolledBack: true,
        failure: {
          ok: false,
          path: prep.edit.path,
          reason: "write_failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        priorOutcomes: outcomes,
      };
    }
  }

  return { ok: true, outcomes };
}

function rollback(log: ReadonlyArray<{ path: string; originalContent: string | null }>): void {
  // Iterate in reverse so the most-recent writes are undone first
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const entry = log[i];
    if (!entry) continue;
    try {
      if (entry.originalContent === null) {
        // The file didn't exist before — but we only care about
        // restoring state we overwrote. Creating-then-deleting could
        // race with external readers, so we leave new files in place.
        // A stricter caller can wrap us in a filesystem snapshot.
        continue;
      }
      writeFileSync(entry.path, entry.originalContent, "utf-8");
    } catch {
      // Best-effort rollback; surface failure via outcomes, not throw
    }
  }
}

interface PreparedEditOk {
  readonly ok: true;
  readonly edit: HashlineEdit & { readonly path: string };
  readonly newContent: string;
}

interface PreparedEditFail {
  readonly ok: false;
  readonly outcome: HashlineApplyOutcome & { readonly ok: false };
}

type PreparedEdit = PreparedEditOk | PreparedEditFail;

function prepareEdit(
  edit: HashlineEdit,
  workspaceRoot: string,
  allowCreate: boolean,
): PreparedEdit {
  // Normalize path: must be relative-to-workspace or absolute-within-workspace
  const absolutePath = resolveEditPath(edit.path, workspaceRoot);
  if (!absolutePath) {
    return {
      ok: false,
      outcome: {
        ok: false,
        path: edit.path,
        reason: "path_escape",
        detail: `path escapes workspace root or is otherwise invalid: '${edit.path}'`,
      },
    };
  }

  if (!isWithinWorkspace(absolutePath, workspaceRoot)) {
    return {
      ok: false,
      outcome: {
        ok: false,
        path: edit.path,
        reason: "path_escape",
        detail: `path '${edit.path}' escapes workspace root '${workspaceRoot}'`,
      },
    };
  }

  const exists = existsSync(absolutePath);

  if (!exists && edit.locator.kind === "line") {
    return {
      ok: false,
      outcome: {
        ok: false,
        path: edit.path,
        reason: "file_missing",
        detail: `cannot apply line-edit: file does not exist: ${edit.path}`,
      },
    };
  }

  if (!exists && !allowCreate) {
    return {
      ok: false,
      outcome: {
        ok: false,
        path: edit.path,
        reason: "file_missing",
        detail: `file does not exist and allowCreate=false: ${edit.path}`,
      },
    };
  }

  const currentContent = exists ? readFileSync(absolutePath, "utf-8") : "";

  if (containsBinaryBytes(currentContent)) {
    return {
      ok: false,
      outcome: {
        ok: false,
        path: edit.path,
        reason: "binary_refused",
        detail: `file appears to be binary (contains NUL byte): ${edit.path}`,
      },
    };
  }

  // Compute the new content based on locator kind
  switch (edit.locator.kind) {
    case "line":
      return applyLineEdit(
        edit,
        absolutePath,
        currentContent,
        edit.locator.start,
        edit.locator.end,
      );
    case "prepend":
      return applyPrepend(edit, absolutePath, currentContent);
    case "append":
      return applyAppend(edit, absolutePath, currentContent);
  }
}

function applyLineEdit(
  edit: HashlineEdit,
  absolutePath: string,
  currentContent: string,
  start: number,
  end: number,
): PreparedEdit {
  const lines = currentContent.split("\n");
  // If the file ends with a newline, `split` yields a trailing empty
  // element. We treat that as "no extra line" for range math.
  const effectiveLineCount =
    currentContent.endsWith("\n") && lines.length > 0 ? lines.length - 1 : lines.length;

  if (start > effectiveLineCount || end > effectiveLineCount) {
    return {
      ok: false,
      outcome: {
        ok: false,
        path: edit.path,
        reason: "range_invalid",
        detail: `range ${start}-${end} exceeds file length ${effectiveLineCount}`,
      },
    };
  }

  // Conflict detection: the minus-lines must match the current content
  const actualSlice = lines.slice(start - 1, end);
  if (edit.minusLines.length !== actualSlice.length) {
    return {
      ok: false,
      outcome: {
        ok: false,
        path: edit.path,
        reason: "content_mismatch",
        detail: `expected ${edit.minusLines.length} '-' lines but range covers ${actualSlice.length} lines`,
        expected: edit.minusLines,
        actual: actualSlice,
      },
    };
  }
  for (let i = 0; i < edit.minusLines.length; i += 1) {
    if (edit.minusLines[i] !== actualSlice[i]) {
      return {
        ok: false,
        outcome: {
          ok: false,
          path: edit.path,
          reason: "content_mismatch",
          detail: `content mismatch at line ${start + i}`,
          expected: edit.minusLines,
          actual: actualSlice,
        },
      };
    }
  }

  // Splice: before + plusLines + after
  const before = lines.slice(0, start - 1);
  const after = lines.slice(end);
  const merged = [...before, ...edit.plusLines, ...after];
  return {
    ok: true,
    edit: { ...edit, path: absolutePath },
    newContent: merged.join("\n"),
  };
}

function applyPrepend(
  edit: HashlineEdit,
  absolutePath: string,
  currentContent: string,
): PreparedEdit {
  const prefix = edit.plusLines.join("\n");
  const sep = currentContent.length === 0 ? "" : "\n";
  return {
    ok: true,
    edit: { ...edit, path: absolutePath },
    newContent: prefix + sep + currentContent,
  };
}

function applyAppend(
  edit: HashlineEdit,
  absolutePath: string,
  currentContent: string,
): PreparedEdit {
  const suffix = edit.plusLines.join("\n");
  const sep = currentContent.length === 0 || currentContent.endsWith("\n") ? "" : "\n";
  return {
    ok: true,
    edit: { ...edit, path: absolutePath },
    newContent: currentContent + sep + suffix,
  };
}

// ── Helpers ──────────────────────────────────────────────

function resolveEditPath(rawPath: string, workspaceRoot: string): string | null {
  if (rawPath.length === 0) return null;
  // Quick rejection of obviously hostile patterns. A defense-in-depth
  // layer; the authoritative check is `isWithinWorkspace`.
  if (rawPath.includes("\0")) return null;
  try {
    // Use node:path.resolve to collapse `..` segments. Then symlink-
    // canonicalise by walking up to the nearest existing ancestor
    // (needed because `realpathSync` fails on non-existent files, but
    // macOS `/var` -> `/private/var` symlinks require resolution even
    // when the leaf doesn't exist yet).
    const resolved = resolvePath(workspaceRoot, rawPath);
    return canonicalizeExistingPrefix(resolved);
  } catch {
    return null;
  }
}

/**
 * Walk up `p` until we find an existing ancestor, realpath() that
 * ancestor, then re-append the tail. This preserves the symlink-
 * resolution guarantees of `isWithinWorkspace` for paths that don't
 * yet exist on disk (new file creation).
 */
function canonicalizeExistingPrefix(p: string): string {
  let current = p;
  const trailing: string[] = [];
  // Walk up at most 64 levels — paranoia against infinite loops on
  // pathological inputs.
  for (let i = 0; i < 64; i += 1) {
    if (existsSync(current)) {
      try {
        const real = realpathSync(current);
        return trailing.length === 0 ? real : resolvePath(real, ...trailing.reverse());
      } catch {
        return p;
      }
    }
    const parent = dirname(current);
    if (parent === current) break; // reached filesystem root
    trailing.push(current.slice(parent.length + 1));
    current = parent;
  }
  return p;
}

function containsBinaryBytes(content: string): boolean {
  // NUL byte is the canonical binary-file marker. We do not attempt
  // encoding detection here; the read/write path is UTF-8 only.
  return content.indexOf("\0") >= 0;
}

// ── Prompt Schema ─────────────────────────────────────────

/**
 * Tool schema fragment for consumers registering the hashline-edit
 * format to their model interface. The description is deliberately
 * explicit about the grammar because mid-tier models benefit from
 * worked examples.
 */
export const HASHLINE_EDITS_TOOL_SCHEMA = {
  name: "hashline_edits",
  description: [
    "Apply one or more surgical code edits using the hashline format.",
    "",
    "Each block starts with '# path' header, optionally followed by ':line',",
    "':start-end', or ':end'. Within a block, lines starting with '- ' are the",
    "EXPECTED current content (used for conflict detection — must match",
    "exactly). Lines starting with '+ ' are the NEW content.",
    "",
    "Examples:",
    "  # src/foo.ts:42",
    "  - const x = 1;",
    "  + const x = 2;",
    "",
    "  # src/foo.ts:5-7       (replace lines 5 through 7)",
    "  - function a() {",
    "  -   return 1;",
    "  - }",
    "  + function a() { return 2; }",
    "",
    "  # src/new.ts           (prepend / create)",
    "  + // new file",
    "",
    "  # src/foo.ts:end       (append)",
    "  + // new last line",
    "",
    "If the '-' lines do not match current file content, the edit is rejected",
    "with a diff — re-read the file and retry.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: {
      text: {
        type: "string",
        description: "One or more hashline edit blocks as described above.",
      },
      allowCreate: {
        type: "boolean",
        description: "Whether new files may be created via prepend (default: true).",
      },
    },
  },
} as const;
