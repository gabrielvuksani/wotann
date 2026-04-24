/**
 * `wotann design verify` — V9 Tier 8 T8.4 CLI command.
 *
 * Compares a local workspace's current design system against an
 * imported Claude-Design handoff bundle and reports drift. Used by
 * the T8.7 GitHub Action on PRs and by developers who want to audit
 * "is my codebase still aligned with the design handoff?".
 *
 * Flow:
 *   parseHandoffBundle(bundlePath)            (T8.0 receiver)
 *     -> extractor.extract(workspaceDir)      (T8.0 extractor)
 *       -> emitDtcg(localSystem)              (T8.1)
 *         -> diffBundles(local, imported)     (T8.3)
 *           -> formatDiff(diff)               (T8.3)
 *
 * `hasDrift` is true iff any of `added`, `removed`, or `changed` is
 * non-empty. `summary` is the human-readable render from `formatDiff`.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: both parse and extract are wrapped in
 *    try/catch; errors surface as `{ ok: false, error }` with the
 *    underlying reason. No silent fallback to "no drift".
 *  - QB #7 per-call state: fresh extractor per call; no caches.
 *  - QB #14 commit-claim verification: the summary string reflects
 *    the *actual* diff, not a pre-baked "OK" message.
 */

import { resolve } from "node:path";
import {
  DesignExtractor,
  type DesignExtractorOptions,
  type DesignSystem,
} from "../../design/extractor.js";
import { emitDtcg, type DtcgBundle } from "../../design/dtcg-emitter.js";
import { diffBundles, formatDiff, type BundleDiff } from "../../design/bundle-diff.js";
import { parseHandoffBundle } from "../../design/handoff-receiver.js";
import type { DesignSystemExtractor } from "./design-export.js";

export interface DesignVerifyOptions {
  /** Path to the handoff bundle (.zip). Required. */
  readonly bundlePath: string;
  /** Workspace to extract the local design system from. Required. */
  readonly workspaceDir: string;
  /** Injector for tests. Default: use `DesignExtractor.extract`. */
  readonly extractor?: DesignSystemExtractor;
  /** Pass-through extractor options. */
  readonly extractorOptions?: DesignExtractorOptions;
}

export type VerifyResult =
  | {
      readonly ok: true;
      readonly diff: BundleDiff;
      readonly hasDrift: boolean;
      readonly summary: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

function defaultExtractor(
  extractorOptions: DesignExtractorOptions | undefined,
): DesignSystemExtractor {
  return async ({ workspaceDir }) => {
    const extractor = new DesignExtractor(extractorOptions ?? {});
    return extractor.extract(workspaceDir);
  };
}

/**
 * Run the verify pipeline. Returns a typed envelope on every path.
 *
 * The imported bundle's `rawDesignSystem` field is the original JSON
 * tree as written by `writeHandoffBundle` (or by Claude Design
 * itself). We cast it to `DtcgBundle` for the diff — any DTCG v6.3
 * tree is a structural supertype of `DtcgBundle`, and `diffBundles`
 * walks defensively so non-matching sections degrade to empty groups.
 */
export async function runDesignVerify(opts: DesignVerifyOptions): Promise<VerifyResult> {
  const bundlePath = resolve(opts.bundlePath);
  const workspaceDir = resolve(opts.workspaceDir);
  const extractor = opts.extractor ?? defaultExtractor(opts.extractorOptions);

  let imported: DtcgBundle;
  try {
    const bundle = parseHandoffBundle(bundlePath);
    imported = bundle.rawDesignSystem as DtcgBundle;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `failed to parse handoff bundle: ${reason}` };
  }

  let localSystem: DesignSystem;
  try {
    localSystem = await extractor({ workspaceDir });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `local extraction failed: ${reason}` };
  }

  const local = emitDtcg(localSystem);
  const diff = diffBundles(imported, local);
  const hasDrift = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
  const summary = formatDiff(diff);

  return { ok: true, diff, hasDrift, summary };
}
