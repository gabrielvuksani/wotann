/**
 * `wotann design extract` — Claude Design codebase→design-system port (P1-C8).
 *
 * Reads a workspace, extracts colors / spacing / typography, and emits either
 * JSON or Markdown. Pure handler (no commander / chalk / process.exit inside)
 * — the CLI entry wires options in, prints output, and decides exit codes.
 *
 * Per-session state (QB #7): constructs a fresh `DesignExtractor` per call.
 * Two concurrent invocations cannot cross-contaminate.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DesignExtractor,
  type DesignSystem,
  type DesignExtractorOptions,
} from "../../design/extractor.js";

export type DesignExtractFormat = "json" | "md";

export interface DesignExtractCommandOptions {
  /** Workspace root (default: process.cwd()). */
  readonly root?: string;
  /** Output format. Default: `md`. */
  readonly format?: DesignExtractFormat;
  /** File path to write. If omitted, result is returned in `output` only. */
  readonly output?: string;
  /** Glob patterns to exclude. Falls back to extractor defaults if omitted. */
  readonly exclude?: readonly string[];
  /** Glob patterns to include. If provided, overrides default extension filter. */
  readonly include?: readonly string[];
  /** Palette clustering threshold. Default inside extractor: 12. */
  readonly paletteDistanceThreshold?: number;
  /** Dry-run: skip writing to disk even if `output` is set. */
  readonly dryRun?: boolean;
  /** Test injection — bypass the default extractor. */
  readonly extractor?: DesignExtractor;
}

export interface DesignExtractRunResult {
  readonly success: boolean;
  readonly format: DesignExtractFormat;
  readonly output: string;
  readonly system: DesignSystem | null;
  readonly wrotePath: string | null;
  readonly error?: string;
}

export async function runDesignExtractCommand(
  options: DesignExtractCommandOptions,
): Promise<DesignExtractRunResult> {
  const format: DesignExtractFormat = options.format ?? "md";
  const root = resolve(options.root ?? process.cwd());

  const extractorOpts: DesignExtractorOptions = {};
  if (options.exclude !== undefined) {
    (extractorOpts as { exclude?: readonly string[] }).exclude = options.exclude;
  }
  if (options.include !== undefined) {
    (extractorOpts as { include?: readonly string[] }).include = options.include;
  }
  if (options.paletteDistanceThreshold !== undefined) {
    (extractorOpts as { paletteDistanceThreshold?: number }).paletteDistanceThreshold =
      options.paletteDistanceThreshold;
  }

  const extractor = options.extractor ?? new DesignExtractor(extractorOpts);

  let system: DesignSystem;
  try {
    system = extractor.extract(root);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      format,
      output: "",
      system: null,
      wrotePath: null,
      error: reason,
    };
  }

  const serialized = format === "json" ? extractor.toJson(system) : extractor.toMarkdown(system);

  let wrotePath: string | null = null;
  if (options.output !== undefined && options.dryRun !== true) {
    const abs = resolve(options.output);
    try {
      writeFileSync(abs, serialized, "utf8");
      wrotePath = abs;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        format,
        output: serialized,
        system,
        wrotePath: null,
        error: `failed to write ${abs}: ${reason}`,
      };
    }
  }

  return {
    success: true,
    format,
    output: serialized,
    system,
    wrotePath,
  };
}
