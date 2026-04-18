/**
 * Content ID (CID) — short compact hash anchor for weak-model edit workflows.
 *
 * Competitive port from oh-my-pi's hashline pattern
 * (UI_DESIGN_SPEC §12 P10-item-10 / research/oh-my-openagent). When a
 * weak model has to reference a specific piece of content inside a diff
 * conversation, the full 64-char SHA256 eats up context budget and the
 * model often miscopies a digit — inverting the safety guarantee.
 *
 * A CID is a base36-encoded prefix of the content's SHA256 digest.
 * Two chars give 36² = 1,296 combinations — enough to unambiguously
 * reference every chunk in a session-scope edit window. The default is
 * three chars (46,656 combinations) for safety on larger workspaces.
 *
 * Usage pattern:
 *
 *   import { cidOf, resolveCid, buildCidIndex } from "./content-cid.js";
 *
 *   const chunks = [
 *     { path: "a.ts:L1-20",  content: fileA.slice(0, 20) },
 *     { path: "b.ts:L40-60", content: fileB.slice(40, 60) },
 *   ];
 *   const idx = buildCidIndex(chunks);  // { "a1": chunk1, "b7": chunk2, ... }
 *
 *   // Model sees the short CID in prompt:
 *   //   "[cid:a1] <content of chunk 1>"
 *   //   "[cid:b7] <content of chunk 2>"
 *   //
 *   // Model proposes: "edit [cid:a1] to read: …"
 *   // We resolve the CID back to (path, content) before applying.
 *
 * The pattern is particularly valuable for 3B-7B local models that
 * cannot reliably carry long SHA strings through chain-of-thought.
 */

import { createHash } from "node:crypto";

/**
 * BASE_36_ALPHABET intentionally omits uppercase and punctuation so the
 * CID can sit inside prose without escaping. Collisions are detected
 * explicitly by `buildCidIndex` — the CID length auto-grows if needed.
 */
const BASE_36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Compute the short CID for a string. Returns the first `length` base-36
 * characters of the SHA256 digest.
 */
export function cidOf(content: string, length = 3): string {
  if (length < 1 || length > 12) {
    throw new Error(`cidOf: length must be between 1 and 12, got ${length}`);
  }
  const digest = createHash("sha256").update(content).digest();
  // Encode the first 8 bytes of the digest as base36 and slice to length.
  // 8 bytes = 64 bits = ~12.4 base36 chars of entropy, plenty for any
  // feasible length.
  let acc = 0n;
  for (let i = 0; i < 8; i++) {
    acc = (acc << 8n) | BigInt(digest[i]!);
  }
  const out: string[] = [];
  while (out.length < length) {
    const idx = Number(acc % 36n);
    out.unshift(BASE_36_ALPHABET[idx]!);
    acc /= 36n;
  }
  return out.join("");
}

export interface CidChunk<T = unknown> {
  readonly content: string;
  readonly metadata?: T;
}

export interface CidIndexEntry<T = unknown> extends CidChunk<T> {
  readonly cid: string;
  readonly sha256: string;
}

/**
 * Build a CID lookup index for a set of chunks. Automatically grows
 * the CID length if collisions are detected. Returns:
 *   - `entries`: Map<cid, {content, sha256, metadata}>
 *   - `cidLength`: the length selected (callers reference this when
 *     rendering the prompt block so every CID uses the same width)
 */
export function buildCidIndex<T = unknown>(
  chunks: readonly CidChunk<T>[],
): {
  readonly entries: ReadonlyMap<string, CidIndexEntry<T>>;
  readonly cidLength: number;
} {
  for (let length = 2; length <= 12; length++) {
    const entries = new Map<string, CidIndexEntry<T>>();
    let collision = false;
    for (const chunk of chunks) {
      const sha = createHash("sha256").update(chunk.content).digest("hex");
      const cid = cidOf(chunk.content, length);
      if (entries.has(cid)) {
        collision = true;
        break;
      }
      entries.set(cid, { cid, sha256: sha, content: chunk.content, metadata: chunk.metadata });
    }
    if (!collision) return { entries, cidLength: length };
  }
  throw new Error(
    `buildCidIndex: unable to build collision-free index even at length 12 ` +
      `(n=${chunks.length}); probably means the inputs contain duplicate content`,
  );
}

/**
 * Look up a CID in an index. Returns `null` if unknown — safer than
 * throwing since CID lookups come from untrusted model output and a
 * hallucinated CID is a recoverable error.
 */
export function resolveCid<T = unknown>(
  index: ReadonlyMap<string, CidIndexEntry<T>>,
  cid: string,
): CidIndexEntry<T> | null {
  return index.get(cid) ?? null;
}

/**
 * Render an index as a prompt block that teaches the model the CID
 * vocabulary for the turn. Output is intentionally compact so the
 * anchors fit inside a small context budget on local models.
 *
 *   [cid: a1]
 *     <content line 1>
 *     <content line 2>
 *   [cid: b7]
 *     <content line 1>
 *     ...
 */
export function renderCidBlock<T>(
  index: ReadonlyMap<string, CidIndexEntry<T>>,
): string {
  const lines: string[] = [];
  for (const entry of index.values()) {
    lines.push(`[cid:${entry.cid}]`);
    for (const line of entry.content.split("\n")) {
      lines.push(`  ${line}`);
    }
  }
  return lines.join("\n");
}

/**
 * Verify that the CID passed by a model still resolves to the same
 * content (no silent drift between index build time and edit time).
 * Returns `true` iff the CID is present AND its SHA256 still matches
 * the current content.
 */
export function verifyCid<T>(
  index: ReadonlyMap<string, CidIndexEntry<T>>,
  cid: string,
  currentContent: string,
): boolean {
  const entry = index.get(cid);
  if (!entry) return false;
  const currentSha = createHash("sha256").update(currentContent).digest("hex");
  return currentSha === entry.sha256;
}
