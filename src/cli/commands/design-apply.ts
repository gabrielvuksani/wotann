/**
 * `wotann design apply` — V9 Tier 8 T8.4 CLI command.
 *
 * Pure staging pipeline for applying a Claude-Design handoff bundle
 * to a local workspace. Computes the diff against the current state,
 * routes each change through a user-supplied `approvalHandler`, and
 * returns the staged lists of approved and skipped changes. This
 * module NEVER writes to disk; a downstream consumer (the approval
 * queue in Phase 11) takes the approved list and emits file edits.
 *
 * Separating the decision layer (this file) from the write layer
 * gives us two honest properties:
 *   1. Tests drive the approval handler directly, no FS mocks.
 *   2. The "apply" action is reversible up until the approval queue
 *      commits — users can abort without corrupting their tree.
 *
 * Flow:
 *   parseHandoffBundle(bundlePath)                   (T8.0 receiver)
 *     -> extractor.extract(workspaceDir)             (T8.0 extractor)
 *       -> emitDtcg(localSystem)                     (T8.1)
 *         -> diffBundles(local, imported)            (T8.3)
 *           -> for each entry: approvalHandler(...)  (this module)
 *             -> { applied, skipped }
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: parse / extract / approval-handler
 *    errors each surface as `{ ok: false, error }`. A rejection from
 *    the approval handler is NOT an error — it lands in `skipped`.
 *  - QB #7 per-call state: fresh extractor per call; no caches. The
 *    `applied`/`skipped` arrays are local to this invocation.
 *  - QB #13 env guard: zero process.* reads.
 *  - QB #14 commit-claim verification: the returned arrays reflect
 *    only the approvalHandler's actual return values — we never
 *    optimistically mark something "applied" without a true return.
 */

import { resolve } from "node:path";
import {
  DesignExtractor,
  type DesignExtractorOptions,
  type DesignSystem,
} from "../../design/extractor.js";
import { emitDtcg, type DtcgBundle } from "../../design/dtcg-emitter.js";
import { diffBundles, type DiffEntry } from "../../design/bundle-diff.js";
import { parseHandoffBundle } from "../../design/handoff-receiver.js";
import type { DesignSystemExtractor } from "./design-export.js";

/**
 * Simplified per-change shape passed to the approval handler. Flat
 * `before`/`after` fields mirror what a reviewer needs to decide
 * yes/no — the caller doesn't need to understand DtcgNode shapes.
 */
export interface TokenChange {
  readonly kind: "added" | "removed" | "changed";
  /** Dotted path, e.g. `"colors.palette-1.base"`. */
  readonly path: string;
  readonly before?: string | number;
  readonly after?: string | number;
}

export type ApprovalHandler = (change: TokenChange) => Promise<boolean>;

export interface DesignApplyOptions {
  /** Path to the handoff bundle (.zip). Required. */
  readonly bundlePath: string;
  /** Workspace to apply against. Required. */
  readonly workspaceDir: string;
  /** User callback: returns true to stage, false to skip. */
  readonly approvalHandler: ApprovalHandler;
  /** Test injector for the extractor. */
  readonly extractor?: DesignSystemExtractor;
  /** Pass-through extractor options. */
  readonly extractorOptions?: DesignExtractorOptions;
}

export type ApplyResult =
  | {
      readonly ok: true;
      /** Dotted paths that the handler approved for staging. */
      readonly applied: readonly string[];
      /** Dotted paths that the handler rejected. */
      readonly skipped: readonly string[];
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
 * Lift a `DiffEntry` into a handler-friendly `TokenChange`. Only
 * primitive scalars ever land on the wire; group-level entries are
 * flagged with the sentinel `<group>` so handlers can special-case
 * them or reject by default.
 */
function toTokenChange(entry: DiffEntry): TokenChange {
  const path = entry.path.join(".");
  if (entry.kind === "added") {
    const after = entry.value.kind === "token" ? entry.value.$value : "<group>";
    return { kind: "added", path, after };
  }
  if (entry.kind === "removed") {
    const before = entry.value.kind === "token" ? entry.value.$value : "<group>";
    return { kind: "removed", path, before };
  }
  const before = entry.before.kind === "token" ? entry.before.$value : "<group>";
  const after = entry.after.kind === "token" ? entry.after.$value : "<group>";
  return { kind: "changed", path, before, after };
}

/**
 * Run the apply pipeline. Stages changes only; does NOT touch disk.
 *
 * The approval handler is awaited sequentially for deterministic
 * ordering (matches the diff's stable lexicographic order). Parallel
 * invocation would make approval UIs race against themselves.
 */
export async function runDesignApply(opts: DesignApplyOptions): Promise<ApplyResult> {
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
  const diff = diffBundles(local, imported);
  // Single flat list: every change goes through the handler in a
  // stable order (added, then changed, then removed — each already
  // sorted lexicographically by path inside the bucket).
  const allEntries: readonly DiffEntry[] = [...diff.added, ...diff.changed, ...diff.removed];

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const entry of allEntries) {
    const change = toTokenChange(entry);
    let approved: boolean;
    try {
      approved = await opts.approvalHandler(change);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `approval handler threw at ${change.path}: ${reason}` };
    }
    if (approved) {
      applied.push(change.path);
    } else {
      skipped.push(change.path);
    }
  }

  return { ok: true, applied, skipped };
}
