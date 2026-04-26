/**
 * Scaffold-pack materializer — V9 Wave 6.9 / W6.9 AH (audit §3.1.14).
 *
 * `wotann build --emit` previously wrote placeholder stubs whose only
 * payload was a comment saying "run `wotann skills load pack-<id>` to
 * materialize the full template." The packs themselves landed in
 * `skills/pack-*.md` (see `docs/build-templates/README.md`) but no code
 * ever read them — so `--emit` was effectively a fake-success path
 * (QB #6 violation).
 *
 * This module closes that gap by parsing a pack's Markdown body into a
 * `(path, contents)` map and exposing a single function the build
 * pipeline can call. A pack is a Markdown file whose body is a sequence
 * of `### path/to/file` headings followed by fenced code blocks. The
 * pack's frontmatter `materializes: <scaffold-id>` field links it back
 * to the scaffold registry; we trust the file name (`pack-<id>.md`) and
 * cross-check it against the frontmatter so a misnamed pack fails
 * loudly.
 *
 * Quality bars:
 *  - QB #6 honest failures: missing pack file, missing frontmatter,
 *    missing fence — every branch returns `{ ok: false, error }`.
 *    Caller (`composeFiles`) keeps the placeholder fallback so a
 *    pack-less scaffold still emits something usable rather than
 *    crashing the whole build.
 *  - QB #7 per-call state: zero module-level caches. Each call
 *    re-reads the disk so a user editing a pack mid-session sees the
 *    new contents on the next `wotann build`.
 *  - QB #14 commit-claim verification: the parsed file map keys are
 *    EXACTLY the heading paths from the pack — never invented. Tests
 *    diff this against the SCAFFOLDS[<id>].files list to confirm
 *    coverage. (See build-command tests.)
 *  - QB #15 source-verified: each parsed file's source is a verbatim
 *    slice of the pack's text — no rewriting, no template
 *    interpolation. The pack author's bytes are what lands on disk.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ScaffoldId } from "./scaffold-registry.js";

// ── Public types ─────────────────────────────────────────────

export interface ScaffoldPackFile {
  readonly path: string;
  readonly contents: string;
}

export type ScaffoldPackResult =
  | {
      readonly ok: true;
      readonly scaffoldId: ScaffoldId;
      readonly packPath: string;
      readonly files: readonly ScaffoldPackFile[];
    }
  | { readonly ok: false; readonly error: string };

// ── Path resolution ──────────────────────────────────────────

/**
 * Resolve the absolute path to a scaffold pack on disk. The caller can
 * override the search root (mostly for tests); production callers pass
 * `undefined` and we walk up from this file's location to the repo
 * `skills/` directory — same convention `SkillRegistry.createWithDefaults`
 * uses elsewhere in the codebase.
 */
export function resolvePackPath(scaffoldId: ScaffoldId, rootOverride?: string): string {
  if (rootOverride !== undefined && rootOverride.length > 0) {
    return resolve(rootOverride, `pack-${scaffoldId}.md`);
  }
  // Walk up from this file (src/build/scaffold-pack-materializer.ts) to
  // the repo root, then into `skills/`. We resolve via `import.meta.url`
  // so the same code works from `src/` (tsx dev) and `dist/` (compiled).
  const here = dirname(fileURLToPath(import.meta.url));
  // src/build -> src -> repo root
  const repoRoot = resolve(here, "..", "..");
  return join(repoRoot, "skills", `pack-${scaffoldId}.md`);
}

// ── Pack parsing ─────────────────────────────────────────────

/**
 * Load and parse a scaffold pack from disk. Returns the parsed file
 * list, or a typed error envelope — never throws.
 */
export function loadScaffoldPack(
  scaffoldId: ScaffoldId,
  rootOverride?: string,
): ScaffoldPackResult {
  const packPath = resolvePackPath(scaffoldId, rootOverride);
  if (!existsSync(packPath)) {
    return {
      ok: false,
      error: `pack file not found: ${packPath}`,
    };
  }
  let raw: string;
  try {
    raw = readFileSync(packPath, "utf-8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `failed to read pack ${packPath}: ${reason}`,
    };
  }
  const parsed = parsePackBody(raw, scaffoldId);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    scaffoldId,
    packPath,
    files: parsed.files,
  };
}

/**
 * Parse a pack's raw text into a list of (path, contents) pairs.
 *
 * Format:
 *   ---
 *   name: pack-<id>
 *   materializes: <id>
 *   ...
 *   ---
 *
 *   ### path/to/file
 *
 *   ```<lang>
 *   <file body>
 *   ```
 *
 *   ### path/to/another
 *
 *   ```<lang>
 *   <file body>
 *   ```
 *
 * Exported for testability — the build-command test suite uses this to
 * lock the parser against frontmatter / fence drift.
 */
export function parsePackBody(
  raw: string,
  expectedScaffoldId: ScaffoldId,
):
  | { readonly ok: true; readonly files: readonly ScaffoldPackFile[] }
  | { readonly ok: false; readonly error: string } {
  // Strip frontmatter. A pack MUST start with `---\n` and have a
  // closing `---\n`. The frontmatter MUST contain `materializes:
  // <expectedScaffoldId>` so a misnamed pack fails loudly (QB #6).
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { ok: false, error: "pack missing YAML frontmatter (must start with `---`)" };
  }
  const fmEnd = raw.indexOf("\n---", 4);
  if (fmEnd < 0) {
    return { ok: false, error: "pack frontmatter not closed (missing `---` terminator)" };
  }
  const frontmatter = raw.slice(4, fmEnd);
  const body = raw.slice(fmEnd + "\n---".length);

  // Defensive frontmatter check — we don't pull a YAML parser in just
  // for one field. A regex on the literal `materializes:` key is
  // sufficient; pack authors who write valid YAML will match.
  const fmMatch = frontmatter.match(/^\s*materializes:\s*(\S+)/m);
  if (!fmMatch || fmMatch[1] === undefined) {
    return {
      ok: false,
      error: "pack frontmatter missing `materializes: <scaffold-id>` field",
    };
  }
  const declaredId = fmMatch[1].replace(/["']/g, "").trim();
  if (declaredId !== expectedScaffoldId) {
    return {
      ok: false,
      error: `pack frontmatter mismatch: declares materializes=${declaredId}, expected ${expectedScaffoldId}`,
    };
  }

  // Walk the body. We collect every `### path/to/file` heading via
  // matchAll, then for each one slice the segment up to the next
  // heading and pull the first fenced code block.
  const headingRegex = /^###\s+([^\n\r]+)\s*$/gm;
  const matches: { path: string; index: number; matchEnd: number }[] = [];
  for (const headingMatch of body.matchAll(headingRegex)) {
    if (headingMatch[1] === undefined || headingMatch.index === undefined) continue;
    matches.push({
      path: headingMatch[1].trim(),
      index: headingMatch.index,
      matchEnd: headingMatch.index + headingMatch[0].length,
    });
  }
  if (matches.length === 0) {
    return {
      ok: false,
      error: "pack body has no `### path/to/file` headings",
    };
  }

  const files: ScaffoldPackFile[] = [];
  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i]!;
    const segmentEnd = i + 1 < matches.length ? matches[i + 1]!.index : body.length;
    const segment = body.slice(heading.matchEnd, segmentEnd);
    const block = extractFirstFencedBlock(segment);
    if (block === null) {
      return {
        ok: false,
        error: `pack heading "### ${heading.path}" missing a fenced code block`,
      };
    }
    files.push({ path: heading.path, contents: block });
  }

  return { ok: true, files };
}

/**
 * Pull the first triple-backtick fenced code block from a body segment.
 * Returns the block's INNER text (no surrounding backticks, no language
 * tag) or `null` when no closed fence exists.
 *
 * Implementation note: we accept the loosest standard CommonMark fence
 * — three backticks at line start, optional language identifier, then
 * the body, then three closing backticks at line start. Pack authors
 * never embed literal "```" in file bodies (a documented constraint
 * in docs/build-templates/README.md).
 */
function extractFirstFencedBlock(segment: string): string | null {
  const openMatch = segment.match(/^```([^\n\r]*)\r?\n/m);
  if (!openMatch || openMatch.index === undefined) return null;
  const bodyStart = openMatch.index + openMatch[0].length;
  const after = segment.slice(bodyStart);
  // Closing fence must be at line start. We accept either an interior
  // fence (preceded by a newline) or the file-end edge case.
  const closeMatch = after.match(/(^|\r?\n)```\s*(?:\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) return null;
  const innerEnd = closeMatch.index;
  let inner = after.slice(0, innerEnd);
  // Normalize the trailing newline so emitted files end with exactly
  // one `\n` (POSIX convention; matches what placeholderFor emitted
  // for scalar files like .gitignore).
  if (!inner.endsWith("\n")) inner += "\n";
  return inner;
}

// ── Convenience: file-set check ──────────────────────────────

/**
 * For a pack already loaded via `loadScaffoldPack`, return the subset
 * of `expectedFiles` that the pack covers. The build pipeline uses
 * this to know which placeholders to keep when a pack is incomplete
 * (graceful degradation rather than fake-success).
 */
export function intersectPackFiles(
  pack: { readonly files: readonly ScaffoldPackFile[] },
  expectedFiles: readonly string[],
): { covered: readonly string[]; missing: readonly string[] } {
  const have = new Set(pack.files.map((f) => f.path));
  const covered: string[] = [];
  const missing: string[] = [];
  for (const expected of expectedFiles) {
    if (have.has(expected)) covered.push(expected);
    else missing.push(expected);
  }
  return { covered, missing };
}
