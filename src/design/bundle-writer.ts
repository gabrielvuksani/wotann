/**
 * Claude-Design handoff bundle writer — V9 Tier 8 T8.2.
 *
 * Mirror image of `handoff-receiver.ts`: the receiver reverse-
 * engineers a `.zip` Claude Design produced into a typed
 * `HandoffBundle`; this module goes the other direction — takes a
 * typed bundle input and writes it to disk as a directory tree
 * the receiver (or any DTCG consumer) can read back.
 *
 * Output is a plain directory, NOT a `.zip`. `zip-reader.ts` today
 * only reads ZIPs; packaging to .zip is a caller concern (the T8.5
 * round-trip tests + T8.4 `wotann design export` CLI compose this
 * writer with a zip-archiver of their choosing). Decoupling keeps
 * this module free of binary-format bugs — it only needs to write
 * well-formed JSON + text files.
 *
 * ── Directory layout produced ─────────────────────────────────────
 *   <outputDir>/
 *     manifest.json              (required)
 *     design-system.json         (required, DTCG tree from T8.1 emitter)
 *     tokens.json                (optional alias)
 *     components.json            (optional, components array)
 *     figma.json                 (optional, raw Figma export passthrough)
 *     code-scaffold/**           (optional, React/Vue/HTML starter files)
 *     assets/**                  (optional, images/svgs/fonts)
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: every write wraps try/catch and surfaces
 *    a descriptive error; partial writes leave a `_wotann-partial`
 *    sentinel so the caller can detect interrupted runs.
 *  - QB #7 per-call state: no module-level caches; each write is a
 *    fresh filesystem call.
 *  - QB #11 sibling-site scan: handoff-receiver's `parseHandoffBundle`
 *    is the only reader contract this writer targets. Output that
 *    doesn't round-trip through it is a bug.
 *  - QB #13 env guard: no `process.*` reads; all paths come in as
 *    arguments.
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeDtcg, type DtcgBundle } from "./dtcg-emitter.js";

// ═══ Types ════════════════════════════════════════════════════════════════

export interface BundleManifest {
  readonly name: string;
  readonly version: string;
  readonly bundleVersion: string;
  readonly author?: string;
  readonly exportedFrom?: string;
  readonly createdAt?: string;
}

export interface ScaffoldFile {
  readonly path: string;
  readonly contents: string;
}

export interface BinaryAsset {
  readonly path: string;
  readonly data: Buffer;
}

/**
 * Single input object for the writer. The DTCG tree is passed
 * already-emitted (callers consume T8.1 `emitDtcg` first); this module
 * doesn't re-run the extractor.
 */
export interface BundleWriteInput {
  readonly manifest: BundleManifest;
  readonly designSystem: DtcgBundle;
  readonly components?: readonly unknown[];
  readonly figma?: unknown;
  readonly codeScaffold?: readonly ScaffoldFile[];
  readonly assets?: readonly BinaryAsset[];
  /**
   * When `true`, also write `tokens.json` as a duplicate of
   * `design-system.json`. Some Claude Design bundles ship both;
   * receiver treats tokens.json as an alias. Default: false (saves
   * disk space; keep design-system.json authoritative).
   */
  readonly writeTokensAlias?: boolean;
}

export interface BundleWriteOptions {
  /**
   * If the output directory already exists and is non-empty, refuse
   * to overwrite unless `force` is set. Default: false.
   */
  readonly force?: boolean;
  /**
   * Indent used for JSON files. Default: 2.
   */
  readonly jsonIndent?: number;
}

export interface BundleWriteResult {
  readonly ok: true;
  readonly outputDir: string;
  /** Count of files written (manifest + design-system + optional extras). */
  readonly filesWritten: number;
  readonly manifestPath: string;
  readonly designSystemPath: string;
}

// ═══ Helpers ══════════════════════════════════════════════════════════════

function serializeManifest(m: BundleManifest, indent: number): string {
  // Emit snake_case fields so the receiver's snake-case-first parser
  // consumes them without falling through to its camelCase fallback
  // — matches Claude Design's own wire format.
  const payload: Record<string, unknown> = {
    name: m.name,
    version: m.version,
    bundle_version: m.bundleVersion,
  };
  if (m.author !== undefined) payload["author"] = m.author;
  if (m.exportedFrom !== undefined) payload["exported_from"] = m.exportedFrom;
  if (m.createdAt !== undefined) payload["created_at"] = m.createdAt;
  return JSON.stringify(payload, null, indent);
}

function writeTextFile(root: string, relPath: string, contents: string): void {
  const full = join(root, relPath);
  const parent = dirname(full);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(full, contents, "utf-8");
}

function writeBinaryFile(root: string, relPath: string, data: Buffer): void {
  const full = join(root, relPath);
  const parent = dirname(full);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(full, data);
}

// ═══ Main ═════════════════════════════════════════════════════════════════

/**
 * Write a handoff bundle to `outputDir`. Returns `{ok: true, ...}` on
 * success; throws with a descriptive Error when the output is unsafe
 * (non-empty + !force) or a write fails partway through. Partial
 * state is marked with a `_wotann-partial` sentinel so callers can
 * resume or clean up.
 */
export function writeHandoffBundle(
  input: BundleWriteInput,
  outputDir: string,
  options: BundleWriteOptions = {},
): BundleWriteResult {
  const indent = options.jsonIndent ?? 2;
  const sentinel = join(outputDir, "_wotann-partial");

  if (existsSync(outputDir)) {
    if (!options.force) {
      throw new Error(
        `writeHandoffBundle: ${outputDir} already exists (pass { force: true } to overwrite).`,
      );
    }
    // `force` semantics: blow away the directory so we don't merge with stale content.
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });
  // Mark as partial until every planned write completes.
  writeFileSync(sentinel, `writing at ${new Date().toISOString()}\n`, "utf-8");

  let filesWritten = 0;

  try {
    // manifest.json
    const manifestPath = join(outputDir, "manifest.json");
    writeTextFile(outputDir, "manifest.json", serializeManifest(input.manifest, indent));
    filesWritten++;

    // design-system.json — DTCG tree from T8.1 emitter
    const designSystemPath = join(outputDir, "design-system.json");
    const designSystemJson = serializeDtcg(input.designSystem, indent);
    writeTextFile(outputDir, "design-system.json", designSystemJson);
    filesWritten++;

    // tokens.json alias (opt-in duplicate for compatibility)
    if (input.writeTokensAlias === true) {
      writeTextFile(outputDir, "tokens.json", designSystemJson);
      filesWritten++;
    }

    // components.json (optional)
    if (input.components !== undefined) {
      writeTextFile(outputDir, "components.json", JSON.stringify(input.components, null, indent));
      filesWritten++;
    }

    // figma.json (optional passthrough)
    if (input.figma !== undefined) {
      writeTextFile(outputDir, "figma.json", JSON.stringify(input.figma, null, indent));
      filesWritten++;
    }

    // code-scaffold/** (optional)
    if (input.codeScaffold !== undefined) {
      for (const file of input.codeScaffold) {
        const rel = file.path.startsWith("code-scaffold/")
          ? file.path
          : join("code-scaffold", file.path);
        writeTextFile(outputDir, rel, file.contents);
        filesWritten++;
      }
    }

    // assets/** (optional)
    if (input.assets !== undefined) {
      for (const asset of input.assets) {
        const rel = asset.path.startsWith("assets/") ? asset.path : join("assets", asset.path);
        writeBinaryFile(outputDir, rel, asset.data);
        filesWritten++;
      }
    }

    // All writes succeeded — clear the sentinel.
    rmSync(sentinel, { force: true });

    return {
      ok: true,
      outputDir,
      filesWritten,
      manifestPath,
      designSystemPath,
    };
  } catch (err) {
    // Leave the sentinel in place so the caller sees the bundle is
    // incomplete. Re-throw with context so the CLI can show which
    // file failed.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`writeHandoffBundle failed after ${filesWritten} files: ${msg}`);
  }
}
