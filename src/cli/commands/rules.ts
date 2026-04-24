/**
 * `wotann rules` — community-sourced rule marketplace — V9 Tier 14.9.
 *
 * Ports the Cline `.clinerules` marketplace pattern to WOTANN. The
 * `.wotann/rules/*.md` convention already exists (prompt/engine.ts
 * loads rule files into the system prompt); this command adds:
 *
 *   - `wotann rules list`        — what's installed locally
 *   - `wotann rules search <q>`  — browse a community index
 *   - `wotann rules install <id>`— pull a rule into .wotann/rules/
 *   - `wotann rules remove <id>` — clean it up
 *
 * The index is a static JSON file hosted on GitHub Pages. No auth.
 * Every downloaded rule is verified by SHA-256 before landing on
 * disk so a compromised host can't inject a malicious prompt fragment.
 *
 * ── Security contract ────────────────────────────────────────────────
 *  - All outbound fetches go through `guardedFetch` (SSRF-safe).
 *  - Every `install` rejects the write when the downloaded content's
 *    SHA-256 doesn't match the index entry — there's no "just trust
 *    the host" fallback.
 *  - Rules are markdown only; the loader treats them as prompt text,
 *    never as code.
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: every operation returns a structured
 *    result `{ok: true, ...}` or `{ok: false, error}`. Never silent.
 *  - QB #7 per-call state: pure functions; callers inject fs / fetch.
 *  - QB #13 env guard: directories and URLs are explicit parameters.
 *  - QB #11 sibling-site scan: prompt/engine.ts line 271 already reads
 *    `.wotann/rules/` into the system prompt; this module is the only
 *    writer into that directory.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * Index entry describing one community rule. The `url` points to the
 * raw Markdown content; the `sha256` is the hex digest of that content.
 */
export interface RuleIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly author?: string;
  readonly tags?: readonly string[];
  readonly url: string;
  readonly sha256: string;
  readonly version?: string;
}

export interface RuleIndex {
  readonly generatedAt?: string;
  readonly rules: readonly RuleIndexEntry[];
}

/**
 * Filesystem handle for the `.wotann/rules/` directory. Separated so
 * tests can point at a tmp dir without touching the real workspace.
 */
export interface RulesFsLayout {
  readonly rulesDir: string;
}

/**
 * HTTP fetcher abstraction — callers inject the real `guardedFetch`
 * in production; tests pass a stub so the suite runs offline.
 */
export type RulesFetcher = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}>;

// ═══ Result envelopes ════════════════════════════════════════════════════

export type ListResult =
  | { readonly ok: true; readonly installed: readonly InstalledRule[] }
  | { readonly ok: false; readonly error: string };

export interface InstalledRule {
  readonly id: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

export type SearchResult =
  | { readonly ok: true; readonly matches: readonly RuleIndexEntry[] }
  | { readonly ok: false; readonly error: string };

export type InstallResult =
  | {
      readonly ok: true;
      readonly installed: InstalledRule;
      readonly verifiedSha: string;
    }
  | { readonly ok: false; readonly error: string };

export type RemoveResult =
  | { readonly ok: true; readonly removed: string }
  | { readonly ok: false; readonly error: string };

// ═══ Pure helpers ═════════════════════════════════════════════════════════

/**
 * Return the canonical on-disk path for a rule ID. The `.md` suffix
 * is always enforced so the prompt engine's glob (`*.md`) picks it up.
 */
export function rulePath(layout: RulesFsLayout, id: string): string {
  const safeId = sanitizeRuleId(id);
  return join(layout.rulesDir, `${safeId}.md`);
}

/**
 * Enforce a strict naming policy: lowercase, dash-separated, no path
 * traversal, no dots, no special chars. Prevents malicious index
 * entries from writing outside `.wotann/rules/`.
 */
export function sanitizeRuleId(id: string): string {
  const cleaned = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const trimmed = cleaned.replace(/^-+|-+$/g, "");
  if (trimmed.length === 0) {
    throw new Error("sanitizeRuleId: id reduces to empty string");
  }
  if (trimmed.length > 100) {
    throw new Error("sanitizeRuleId: id must be <= 100 chars after sanitize");
  }
  return trimmed;
}

/**
 * Search an in-memory index by substring match on id/name/description
 * plus tag equality. Case-insensitive. Empty query returns the full
 * index so `wotann rules search` with no args lists everything.
 */
export function matchRules(index: RuleIndex, query: string): readonly RuleIndexEntry[] {
  if (query.trim().length === 0) return index.rules;
  const q = query.trim().toLowerCase();
  return index.rules.filter((r) => {
    if (r.id.toLowerCase().includes(q)) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    if (r.description.toLowerCase().includes(q)) return true;
    if (r.tags && r.tags.some((t) => t.toLowerCase() === q)) return true;
    return false;
  });
}

// ═══ list ═════════════════════════════════════════════════════════════════

export function listInstalled(layout: RulesFsLayout): ListResult {
  try {
    if (!existsSync(layout.rulesDir)) {
      return { ok: true, installed: [] };
    }
    const entries = readdirSync(layout.rulesDir);
    const installed: InstalledRule[] = [];
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const full = join(layout.rulesDir, name);
      const st = statSync(full);
      if (!st.isFile()) continue;
      installed.push({
        id: name.replace(/\.md$/, ""),
        path: full,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
      });
    }
    installed.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, installed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══ search ═══════════════════════════════════════════════════════════════

/**
 * Pull the community index and return matches. `indexUrl` is the
 * static JSON the hosted marketplace serves. The fetcher is injected
 * for testability; production passes `guardedFetch`.
 */
export async function searchRules(
  query: string,
  indexUrl: string,
  fetcher: RulesFetcher,
): Promise<SearchResult> {
  let raw: string;
  try {
    const res = await fetcher(indexUrl);
    if (!res.ok) {
      return { ok: false, error: `index fetch failed: HTTP ${res.status}` };
    }
    raw = await res.text();
  } catch (err) {
    return {
      ok: false,
      error: `index fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let index: RuleIndex;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as { rules?: unknown }).rules)
    ) {
      return { ok: false, error: "index JSON missing required `rules` array" };
    }
    index = parsed as RuleIndex;
  } catch (err) {
    return {
      ok: false,
      error: `index JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, matches: matchRules(index, query) };
}

// ═══ install ══════════════════════════════════════════════════════════════

/**
 * Download a rule's markdown content, verify its SHA-256 matches the
 * index entry, and write it to `.wotann/rules/<id>.md`. Rejects
 * mismatched hashes without writing anything — never a "just trust
 * it" fallback.
 */
export async function installRule(
  entry: RuleIndexEntry,
  layout: RulesFsLayout,
  fetcher: RulesFetcher,
): Promise<InstallResult> {
  let safeId: string;
  try {
    safeId = sanitizeRuleId(entry.id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let content: string;
  try {
    const res = await fetcher(entry.url);
    if (!res.ok) {
      return { ok: false, error: `rule fetch failed: HTTP ${res.status}` };
    }
    content = await res.text();
  } catch (err) {
    return {
      ok: false,
      error: `rule fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const digest = createHash("sha256").update(content, "utf-8").digest("hex");
  if (digest !== entry.sha256.toLowerCase()) {
    return {
      ok: false,
      error: `sha256 mismatch: index says ${entry.sha256}, got ${digest}. Refusing install.`,
    };
  }

  try {
    if (!existsSync(layout.rulesDir)) mkdirSync(layout.rulesDir, { recursive: true });
    const dest = rulePath(layout, safeId);
    writeFileSync(dest, content, "utf-8");
    const st = statSync(dest);
    return {
      ok: true,
      installed: {
        id: safeId,
        path: resolve(dest),
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
      },
      verifiedSha: digest,
    };
  } catch (err) {
    return {
      ok: false,
      error: `write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ═══ remove ═══════════════════════════════════════════════════════════════

export function removeRule(id: string, layout: RulesFsLayout): RemoveResult {
  let safeId: string;
  try {
    safeId = sanitizeRuleId(id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const path = rulePath(layout, safeId);
  try {
    if (!existsSync(path)) {
      return { ok: false, error: `rule not installed: ${safeId}` };
    }
    unlinkSync(path);
    return { ok: true, removed: resolve(path) };
  } catch (err) {
    return {
      ok: false,
      error: `remove failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ═══ Reader convenience ═══════════════════════════════════════════════════

/**
 * Read an installed rule's body. Callers (wizard / CLI preview / MCP
 * server) use this to show the rule before the user commits to it.
 */
export function readInstalledRule(id: string, layout: RulesFsLayout): string | null {
  try {
    const path = rulePath(layout, sanitizeRuleId(id));
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
