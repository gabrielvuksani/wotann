/**
 * `wotann design export` — V9 Tier 8 T8.4 CLI command.
 *
 * Pure handler that composes the three T8.1-T8.3 primitives into a
 * single user-facing action: walk the workspace, emit a DTCG v6.3
 * bundle, and write it to disk as a Claude-Design-compatible handoff
 * directory tree.
 *
 * Flow:
 *   extractor.extract(workspaceDir)   (T8.0)
 *     -> emitDtcg(system)             (T8.1)
 *       -> writeHandoffBundle(...)    (T8.2)
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: every branch returns a typed envelope
 *    `{ ok: false, error }` rather than throwing; partial-write
 *    sentinels from the writer bubble through the error message.
 *  - QB #7 per-call state: a fresh `DesignExtractor` is constructed
 *    per call unless an injected `extractor` callback is supplied
 *    (tests do that). No module-level caches.
 *  - QB #13 env guard: zero `process.env` reads; all inputs come in
 *    through `opts`. Only `basename(workspaceDir)` is derived and it
 *    is purely a pathname computation.
 */

import { basename, resolve } from "node:path";
import {
  DesignExtractor,
  type DesignExtractorOptions,
  type DesignSystem,
} from "../../design/extractor.js";
import { emitDtcg } from "../../design/dtcg-emitter.js";
import { writeHandoffBundle, type BundleManifest } from "../../design/bundle-writer.js";

/** Injector type so tests can short-circuit the filesystem walk. */
export type DesignSystemExtractor = (opts: {
  readonly workspaceDir: string;
}) => Promise<DesignSystem>;

export interface DesignExportOptions {
  /** Absolute workspace path to extract from. Required. */
  readonly workspaceDir: string;
  /** Absolute output directory for the bundle. Required. */
  readonly outDir: string;
  /** Currently only `"dtcg"` is supported. Default: `"dtcg"`. */
  readonly format?: "dtcg";
  /** When true, each emitted token carries a `$description` with frequency. */
  readonly includeFrequencyMeta?: boolean;
  /** Injector for tests. Default: use `DesignExtractor.extract`. */
  readonly extractor?: DesignSystemExtractor;
  /** Overwrite `outDir` if it exists. Default: false (writer refuses). */
  readonly force?: boolean;
  /** Pass-through extractor options (exclude/include/threshold). */
  readonly extractorOptions?: DesignExtractorOptions;
}

export type ExportResult =
  | {
      readonly ok: true;
      readonly bundleDir: string;
      readonly fileCount: number;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

const BUNDLE_VERSION = "1.0.0";
const PACKAGE_VERSION = "0.1.0";

/** Default extractor implementation. Construct once per call (QB #7). */
function defaultExtractor(
  extractorOptions: DesignExtractorOptions | undefined,
): DesignSystemExtractor {
  return async ({ workspaceDir }) => {
    const extractor = new DesignExtractor(extractorOptions ?? {});
    return extractor.extract(workspaceDir);
  };
}

/**
 * Run the export pipeline.
 *
 * Returns a typed result envelope on every code path; never throws
 * synchronously. Callers (CLI shell, MCP server, tests) branch on
 * `result.ok` and surface `error` verbatim when it is false.
 */
export async function runDesignExport(opts: DesignExportOptions): Promise<ExportResult> {
  const format = opts.format ?? "dtcg";
  if (format !== "dtcg") {
    // Honest refusal (QB #6): do not silently fall back to DTCG.
    return { ok: false, error: `unsupported export format: ${format}` };
  }

  const workspaceDir = resolve(opts.workspaceDir);
  const outDir = resolve(opts.outDir);
  const extractor = opts.extractor ?? defaultExtractor(opts.extractorOptions);

  let system: DesignSystem;
  try {
    system = await extractor({ workspaceDir });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `design extraction failed: ${reason}` };
  }

  const bundle = emitDtcg(system, {
    includeFrequencyMeta: opts.includeFrequencyMeta === true,
  });

  const manifest: BundleManifest = {
    name: basename(workspaceDir) || "workspace",
    version: PACKAGE_VERSION,
    bundleVersion: BUNDLE_VERSION,
    exportedFrom: "WOTANN",
    createdAt: new Date().toISOString(),
  };

  try {
    const result = writeHandoffBundle(
      {
        manifest,
        designSystem: bundle,
      },
      outDir,
      { force: opts.force === true },
    );
    return {
      ok: true,
      bundleDir: result.outputDir,
      fileCount: result.filesWritten,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `bundle write failed: ${reason}` };
  }
}
