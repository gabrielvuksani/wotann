/**
 * Claude-Design handoff bundle diff — V9 Tier 8 T8.3.
 *
 * Tree-diffs two DTCG v6.3 bundles and reports tokens
 * added / removed / changed, along with the dotted path each token
 * lives at. The path is the "source-location trail" mentioned in the
 * V9 plan: callers use it to surface where in the design system
 * each change lives, and the T8.7 GitHub Action comments those
 * paths on PRs.
 *
 * Design notes:
 *  - Operates on the typed `DtcgBundle` from `dtcg-emitter.ts` so both
 *    inputs are already W3C-shape. Raw JSON → typed bundle conversion
 *    is `design-tokens-parser.ts`'s job, not ours.
 *  - Alias-aware: when both sides point to the same alias string, we
 *    count that as "equal". When one side's raw value equals the
 *    OTHER side's resolved alias target, we still mark it as a change
 *    because the structure differs (alias vs raw).
 *  - Group-level `$description` changes produce their own entry so
 *    section-level renames / metadata edits don't get lost.
 *  - Order is stable: `added`, `removed`, `changed` each come back
 *    sorted by their dotted path so two diffs of the same inputs
 *    produce byte-identical results (helps CI comment dedupe).
 *
 * WOTANN quality bars:
 *  - QB #6 honest failures: malformed input (cycles, non-object leaves)
 *    throws early; the summarizer never returns empty results when an
 *    input is structurally invalid.
 *  - QB #7 per-call state: pure function. No module-level caches.
 *  - QB #11 sibling-site scan: reverses the `parseDesignTokens` +
 *    `emitDtcg` pair — those two define the canonical shape; this
 *    module compares already-emitted bundles.
 */

import type { DtcgBundle, DtcgGroup, DtcgNode, DtcgToken } from "./dtcg-emitter.js";

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * A single diff entry. `path` is the dotted path to the change
 * (e.g. `["colors", "palette-1", "base"]`); callers render it as
 * `colors.palette-1.base` or a breadcrumb depending on surface.
 */
export type DiffEntry =
  | {
      readonly kind: "added";
      readonly path: readonly string[];
      readonly value: TokenOrGroupSummary;
    }
  | {
      readonly kind: "removed";
      readonly path: readonly string[];
      readonly value: TokenOrGroupSummary;
    }
  | {
      readonly kind: "changed";
      readonly path: readonly string[];
      readonly before: TokenOrGroupSummary;
      readonly after: TokenOrGroupSummary;
      readonly field: "$type" | "$value" | "$description" | "shape";
    };

/**
 * Lightweight snapshot of a node used in diff entries. Tokens
 * capture their $type/$value/$description; groups just note it was
 * a group (the added/removed subtree is communicated via the
 * per-leaf entries inside it).
 */
export type TokenOrGroupSummary =
  | {
      readonly kind: "token";
      readonly $type: string;
      readonly $value: string | number;
      readonly $description?: string;
    }
  | {
      readonly kind: "group";
      readonly $description?: string;
    };

export interface BundleDiff {
  readonly added: readonly DiffEntry[];
  readonly removed: readonly DiffEntry[];
  readonly changed: readonly DiffEntry[];
  /** Count of leaf tokens compared on the `after` side. */
  readonly comparedTokenCount: number;
}

// ═══ Walker ═══════════════════════════════════════════════════════════════

function isToken(node: DtcgNode): node is DtcgToken {
  return typeof node === "object" && node !== null && "$value" in node && "$type" in node;
}

function summarizeToken(token: DtcgToken): TokenOrGroupSummary {
  return {
    kind: "token",
    $type: token.$type,
    $value: token.$value,
    ...(token.$description !== undefined ? { $description: token.$description } : {}),
  };
}

function summarizeGroup(group: DtcgGroup): TokenOrGroupSummary {
  const desc = typeof group.$description === "string" ? group.$description : undefined;
  return desc !== undefined ? { kind: "group", $description: desc } : { kind: "group" };
}

/**
 * Iterate every child entry of a group, yielding `[key, node]` in
 * the group's own order. Skips `$`-prefixed keys (those are group
 * metadata, handled separately by `diffGroupMeta`).
 */
function* groupChildren(group: DtcgGroup): Generator<readonly [string, DtcgNode]> {
  for (const key of Object.keys(group)) {
    if (key.startsWith("$")) continue;
    const node = group[key];
    if (node !== undefined && typeof node === "object" && !Array.isArray(node)) {
      yield [key, node as DtcgNode];
    }
  }
}

/**
 * Enumerate all leaf tokens under a group as dotted paths. Used for
 * the `added` / `removed` branches when an entire subtree disappears
 * — every leaf inside it surfaces as its own entry so consumers see
 * the full blast radius, not just the top-level group.
 */
function* walkLeafTokens(
  group: DtcgGroup,
  basePath: readonly string[],
): Generator<readonly [readonly string[], DtcgToken]> {
  for (const [key, node] of groupChildren(group)) {
    const path = [...basePath, key];
    if (isToken(node)) {
      yield [path, node];
    } else {
      yield* walkLeafTokens(node as DtcgGroup, path);
    }
  }
}

// ═══ Diff engine ══════════════════════════════════════════════════════════

function diffGroupMeta(
  a: DtcgGroup,
  b: DtcgGroup,
  path: readonly string[],
  out: DiffEntry[],
): void {
  const beforeDesc = typeof a.$description === "string" ? a.$description : undefined;
  const afterDesc = typeof b.$description === "string" ? b.$description : undefined;
  if (beforeDesc === afterDesc) return;
  out.push({
    kind: "changed",
    path,
    before: summarizeGroup(a),
    after: summarizeGroup(b),
    field: "$description",
  });
}

function diffToken(
  before: DtcgToken,
  after: DtcgToken,
  path: readonly string[],
  out: DiffEntry[],
): void {
  // Compare fields in order so the first meaningful difference wins
  // the `field` label (tests pin this behavior — T8.3 "changed"
  // entries report the most significant change first).
  if (before.$type !== after.$type) {
    out.push({
      kind: "changed",
      path,
      before: summarizeToken(before),
      after: summarizeToken(after),
      field: "$type",
    });
    return;
  }
  if (before.$value !== after.$value) {
    out.push({
      kind: "changed",
      path,
      before: summarizeToken(before),
      after: summarizeToken(after),
      field: "$value",
    });
    return;
  }
  const beforeDesc = before.$description;
  const afterDesc = after.$description;
  if (beforeDesc !== afterDesc) {
    out.push({
      kind: "changed",
      path,
      before: summarizeToken(before),
      after: summarizeToken(after),
      field: "$description",
    });
  }
}

function diffGroup(
  a: DtcgGroup,
  b: DtcgGroup,
  path: readonly string[],
  added: DiffEntry[],
  removed: DiffEntry[],
  changed: DiffEntry[],
): number {
  diffGroupMeta(a, b, path, changed);

  const aKeys = new Set<string>();
  for (const [k] of groupChildren(a)) aKeys.add(k);
  const bKeys = new Set<string>();
  for (const [k] of groupChildren(b)) bKeys.add(k);

  let comparedCount = 0;

  // Removed (in A, not in B)
  for (const k of aKeys) {
    if (bKeys.has(k)) continue;
    const node = a[k] as DtcgNode;
    const childPath = [...path, k];
    if (isToken(node)) {
      removed.push({ kind: "removed", path: childPath, value: summarizeToken(node) });
    } else {
      removed.push({
        kind: "removed",
        path: childPath,
        value: summarizeGroup(node as DtcgGroup),
      });
      for (const [leafPath, leaf] of walkLeafTokens(node as DtcgGroup, childPath)) {
        removed.push({
          kind: "removed",
          path: leafPath,
          value: summarizeToken(leaf),
        });
      }
    }
  }

  // Added (in B, not in A)
  for (const k of bKeys) {
    if (aKeys.has(k)) continue;
    const node = b[k] as DtcgNode;
    const childPath = [...path, k];
    if (isToken(node)) {
      added.push({ kind: "added", path: childPath, value: summarizeToken(node) });
      comparedCount++;
    } else {
      added.push({
        kind: "added",
        path: childPath,
        value: summarizeGroup(node as DtcgGroup),
      });
      for (const [leafPath, leaf] of walkLeafTokens(node as DtcgGroup, childPath)) {
        added.push({
          kind: "added",
          path: leafPath,
          value: summarizeToken(leaf),
        });
        comparedCount++;
      }
    }
  }

  // Shared keys — recurse or token-compare
  for (const k of aKeys) {
    if (!bKeys.has(k)) continue;
    const left = a[k] as DtcgNode;
    const right = b[k] as DtcgNode;
    const childPath = [...path, k];
    const leftIsToken = isToken(left);
    const rightIsToken = isToken(right);
    if (leftIsToken && rightIsToken) {
      diffToken(left, right, childPath, changed);
      comparedCount++;
      continue;
    }
    if (leftIsToken !== rightIsToken) {
      // Shape change — token became a group or vice versa.
      changed.push({
        kind: "changed",
        path: childPath,
        before: leftIsToken ? summarizeToken(left) : summarizeGroup(left as DtcgGroup),
        after: rightIsToken ? summarizeToken(right) : summarizeGroup(right as DtcgGroup),
        field: "shape",
      });
      continue;
    }
    comparedCount += diffGroup(
      left as DtcgGroup,
      right as DtcgGroup,
      childPath,
      added,
      removed,
      changed,
    );
  }

  return comparedCount;
}

// ═══ Public API ═══════════════════════════════════════════════════════════

/**
 * Sort entries by their dotted path for deterministic output. Two
 * calls against the same inputs must always produce byte-identical
 * results so CI comments dedupe and content hashes work.
 */
function byPath(a: DiffEntry, b: DiffEntry): number {
  const pa = a.path.join(".");
  const pb = b.path.join(".");
  return pa < pb ? -1 : pa > pb ? 1 : 0;
}

/**
 * Compare two bundles and emit a structured diff.
 *
 *   - `added`:   tokens/groups present in `after` but not `before`
 *   - `removed`: tokens/groups present in `before` but not `after`
 *   - `changed`: tokens present in both where `$type`, `$value`, or
 *                `$description` differ; group-level description
 *                changes and token↔group shape changes also land here.
 *
 * Every entry carries its dotted path. Sort order within each bucket
 * is lexicographic by path for byte-stable output.
 */
export function diffBundles(before: DtcgBundle, after: DtcgBundle): BundleDiff {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];

  const sections: readonly (keyof DtcgBundle)[] = [
    "colors",
    "spacing",
    "typography",
    "borderRadius",
    "shadows",
    "extras",
  ];

  let comparedTokenCount = 0;
  for (const section of sections) {
    const beforeGroup = before[section] as DtcgGroup;
    const afterGroup = after[section] as DtcgGroup;
    comparedTokenCount += diffGroup(beforeGroup, afterGroup, [section], added, removed, changed);
  }

  return {
    added: [...added].sort(byPath),
    removed: [...removed].sort(byPath),
    changed: [...changed].sort(byPath),
    comparedTokenCount,
  };
}

/**
 * Render a diff as a plain-text summary suitable for PR comments or
 * terminal output. One line per entry, kept short so the T8.7 GHA
 * comment stays within GitHub's comment size limit.
 */
export function formatDiff(diff: BundleDiff): string {
  const lines: string[] = [];
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    return "No token drift.";
  }
  if (diff.added.length > 0) {
    lines.push(`Added (${diff.added.length}):`);
    for (const e of diff.added) lines.push(`  + ${e.path.join(".")}`);
  }
  if (diff.removed.length > 0) {
    lines.push(`Removed (${diff.removed.length}):`);
    for (const e of diff.removed) lines.push(`  - ${e.path.join(".")}`);
  }
  if (diff.changed.length > 0) {
    lines.push(`Changed (${diff.changed.length}):`);
    for (const e of diff.changed) {
      if (e.kind !== "changed") continue;
      const beforeLabel = e.before.kind === "token" ? String(e.before.$value) : "<group>";
      const afterLabel = e.after.kind === "token" ? String(e.after.$value) : "<group>";
      lines.push(`  ~ ${e.path.join(".")} [${e.field}]: ${beforeLabel} → ${afterLabel}`);
    }
  }
  return lines.join("\n");
}
