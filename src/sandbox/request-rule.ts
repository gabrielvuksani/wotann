/**
 * request_rule — propose an approval rule from a just-approved action
 * (Codex parity, Lane 1).
 *
 * When the user approves a tool call (say `Bash ls /tmp`), we almost
 * always want the next hundred equivalent calls (`ls /var`, `ls .`,
 * `ls src/`) to go through without a prompt. Codex's `request_rule`
 * turns that friction into a one-click rule install:
 *
 *     user approves `ls /tmp`
 *       → proposeRule(action) → RuleDraft { pattern: /^ls\b/ }
 *       → user accepts draft → rule added to ApprovalRuleEngine
 *       → rule persisted to ~/.wotann/approval-rules.json
 *
 * This module does two jobs:
 *   1. Pure: heuristics that turn a specific action into a reasonable
 *      generalised pattern. The caller can show the draft to the user
 *      and let them accept/edit/reject BEFORE any state mutates.
 *   2. I/O: read + write the persisted rule file, round-tripping the
 *      already-shipped SerializedRule shape from approval-rules.ts so
 *      the two modules stay on one wire format.
 *
 * Security: the persisted file is the user's own home directory. We
 * write atomically (tmp → rename) so a crash can't leave a half-written
 * JSON. We NEVER load a rule that matches the empty string — a bug in
 * the heuristic could otherwise auto-approve everything.
 */

import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type {
  ApprovalAction,
  ApprovalRule,
  ApprovalScope,
  SerializedRule,
} from "./approval-rules.js";

// ── Types ──────────────────────────────────────────────

/** A user-approved or user-denied action we can generalise from. */
export interface ApprovedAction {
  readonly toolName: string;
  /** The raw tool input — usually a string (Bash command) or object (Write args). */
  readonly input: unknown;
  /** What the user decided for this specific action. */
  readonly action: ApprovalAction;
  /** Optional free-text note captured from the UI when the user accepted. */
  readonly note?: string;
}

/**
 * A rule draft — the heuristic-generated suggestion that will be shown
 * to the user before any state mutates. Never auto-installed.
 */
export interface RuleDraft {
  /**
   * Human-readable explanation of what the rule covers. Shown in the
   * UI ("Auto-approve all `ls` commands?").
   */
  readonly summary: string;
  /** Pattern to match — string (literal substring) or RegExp. */
  readonly pattern: string | RegExp;
  /** Which tool this rule applies to (undefined = any tool). */
  readonly toolName: string | undefined;
  /** Proposed action on match — usually mirrors the original approval. */
  readonly action: "allow" | "deny";
  /** Session vs persistent — default session so a bad draft expires fast. */
  readonly scope: ApprovalScope;
  /**
   * Confidence 0–1 that this pattern will not over-generalise. Low =
   * rely on user edit; high = offer an "install" default button.
   */
  readonly confidence: number;
}

export interface PersistedRules {
  /** Schema version — bumped if the serialized shape changes. */
  readonly version: 1;
  readonly rules: readonly SerializedRule[];
  readonly updatedAt: string;
}

/** Default location — override for tests via `storePath` option. */
export const DEFAULT_RULES_PATH = resolveWotannHomeSubdir("approval-rules.json");
export const PERSISTED_RULES_VERSION = 1 as const;

// ── Heuristics: ApprovedAction → RuleDraft ─────────────

/**
 * Propose a rule from an approved action. Returns a single best-guess
 * draft; the caller may also request alternatives via
 * `proposeRuleCandidates`.
 */
export function proposeRule(approved: ApprovedAction): RuleDraft {
  const candidates = proposeRuleCandidates(approved);
  // First candidate is always the safest-confidence one.
  return candidates[0] ?? literalFallback(approved);
}

/**
 * Propose up to 3 candidate rules ordered by confidence DESC. A UI can
 * show these as a radio list so the user picks the right generalisation.
 */
export function proposeRuleCandidates(approved: ApprovedAction): readonly RuleDraft[] {
  const drafts: RuleDraft[] = [];

  if (isBashLike(approved)) {
    drafts.push(...bashDrafts(approved));
  } else if (isWriteLike(approved)) {
    drafts.push(...writeDrafts(approved));
  } else {
    drafts.push(...jsonInputDrafts(approved));
  }

  // Always include a literal-exact fallback so the user can lock a rule
  // down to just this one input if the heuristics over-generalise.
  drafts.push(literalFallback(approved));

  // Deduplicate identical drafts (pattern + toolName collision) — keep
  // the HIGHEST-confidence one of each.
  return dedupeByKey(drafts);
}

/** Convert an accepted draft into a concrete ApprovalRule. */
export function draftToRule(draft: RuleDraft, reason?: string): ApprovalRule {
  const id = `req-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const base = {
    id,
    pattern: draft.pattern,
    action: draft.action,
    scope: draft.scope,
  } as const;
  return {
    ...base,
    ...(draft.toolName !== undefined ? { toolName: draft.toolName } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

// ── Persistence — read/write ~/.wotann/approval-rules.json ──

export interface PersistenceOptions {
  /** Override persist path (tests point this at a temp dir). */
  readonly storePath?: string;
}

/**
 * Load persisted rules. Returns an empty list when the file is missing
 * or unparseable — the caller treats "no rules yet" as a normal state.
 * A corrupt file is logged to stderr (callers can choose to quarantine).
 */
export function loadPersistedRules(opts: PersistenceOptions = {}): readonly SerializedRule[] {
  const path = opts.storePath ?? DEFAULT_RULES_PATH;
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Partial<PersistedRules>;
  if (obj.version !== PERSISTED_RULES_VERSION) return [];
  if (!Array.isArray(obj.rules)) return [];
  // Filter out the "matches empty string" footgun defensively — a bug
  // elsewhere must not auto-approve everything.
  return obj.rules.filter((r) => isSafeSerializedRule(r));
}

/**
 * Append an accepted rule to disk. Writes atomically (tmp → rename).
 * Creates the parent directory if missing. Returns the count of rules
 * after the write so the caller can display "N rules saved".
 */
export function appendPersistedRule(rule: SerializedRule, opts: PersistenceOptions = {}): number {
  if (!isSafeSerializedRule(rule)) {
    throw new Error(
      `appendPersistedRule: refusing to persist rule "${rule.id}" — empty/unsafe pattern`,
    );
  }
  const existing = loadPersistedRules(opts);
  // Dedup by id so re-accepting the same draft does not pollute the file.
  const next = [...existing.filter((r) => r.id !== rule.id), rule];
  savePersistedRules(next, opts);
  return next.length;
}

/** Overwrite the persisted rules file with a new set. Atomic. */
export function savePersistedRules(
  rules: readonly SerializedRule[],
  opts: PersistenceOptions = {},
): void {
  const path = opts.storePath ?? DEFAULT_RULES_PATH;
  const safe = rules.filter((r) => isSafeSerializedRule(r));
  const payload: PersistedRules = {
    version: PERSISTED_RULES_VERSION,
    rules: safe,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tmp, path);
}

/** Remove a single persisted rule by id. Returns true if removed. */
export function removePersistedRule(id: string, opts: PersistenceOptions = {}): boolean {
  const existing = loadPersistedRules(opts);
  const next = existing.filter((r) => r.id !== id);
  if (next.length === existing.length) return false;
  savePersistedRules(next, opts);
  return true;
}

// ── Heuristics — private implementations ───────────────

function isBashLike(a: ApprovedAction): boolean {
  if (typeof a.input !== "string") return false;
  const name = a.toolName.toLowerCase();
  return name === "bash" || name === "shell" || name === "exec" || name === "unified_exec";
}

function isWriteLike(a: ApprovedAction): boolean {
  if (!a.input || typeof a.input !== "object") return false;
  const name = a.toolName.toLowerCase();
  return name === "write" || name === "edit" || name === "multiedit";
}

function bashDrafts(a: ApprovedAction): RuleDraft[] {
  const command = (a.input as string).trim();
  const head = extractLeadingWord(command);
  const drafts: RuleDraft[] = [];

  if (head) {
    // "ls /tmp" → regex /^ls\b/ — the primary generalisation. Ranked
    // ABOVE the literal-exact fallback (0.95) so `proposeRule()`
    // returns the useful Codex-style generalisation by default while
    // keeping the literal available in `proposeRuleCandidates` for
    // users who want to lock down to the exact call.
    drafts.push({
      summary: `Auto-${a.action === "deny" ? "deny" : "approve"} \`${head}\` commands`,
      pattern: new RegExp(`^${escapeRegex(head)}\\b`),
      toolName: a.toolName,
      action: a.action === "deny" ? "deny" : "allow",
      scope: a.action === "deny" ? "session" : "persistent",
      confidence: 0.97,
    });

    // "ls /tmp -la" → regex /^ls\s/ — slightly stricter, rejects `ls-tree` false positive.
    drafts.push({
      summary: `Auto-${a.action === "deny" ? "deny" : "approve"} \`${head} …\` commands`,
      pattern: new RegExp(`^${escapeRegex(head)}\\s`),
      toolName: a.toolName,
      action: a.action === "deny" ? "deny" : "allow",
      scope: "session",
      confidence: 0.85,
    });
  }

  return drafts;
}

function writeDrafts(a: ApprovedAction): RuleDraft[] {
  const path = extractPath(a.input);
  if (!path) return [];
  const dir = extractDir(path);
  if (!dir) return [];
  const drafts: RuleDraft[] = [];
  const dirLiteral = JSON.stringify(dir); // e.g. `"safe/"`
  drafts.push({
    summary: `Auto-${a.action === "deny" ? "deny" : "approve"} writes under ${dir}`,
    // The pattern matches the serialized JSON form of Write-style args
    // because ApprovalRuleEngine.stringifyInput JSON-encodes objects.
    pattern: new RegExp(`"path":${escapeRegex(dirLiteral).slice(0, -1)}`),
    toolName: a.toolName,
    action: a.action === "deny" ? "deny" : "allow",
    scope: a.action === "deny" ? "session" : "persistent",
    confidence: 0.7,
  });
  return drafts;
}

function jsonInputDrafts(a: ApprovedAction): RuleDraft[] {
  // Fallback for unknown tools: propose a rule keyed by the JSON-stringified
  // input's top-level shape. Low-confidence — user almost always wants to
  // pick the literal-exact fallback instead.
  if (!a.input || typeof a.input !== "object") return [];
  const keys = Object.keys(a.input as Record<string, unknown>).sort();
  if (keys.length === 0) return [];
  const pattern = new RegExp(
    `^\\{` + keys.map((k) => `[^}]*"${escapeRegex(k)}"`).join("") + `.*\\}$`,
    "s",
  );
  return [
    {
      summary: `Auto-${a.action === "deny" ? "deny" : "approve"} ${a.toolName} calls with keys [${keys.join(", ")}]`,
      pattern,
      toolName: a.toolName,
      action: a.action === "deny" ? "deny" : "allow",
      scope: "session",
      confidence: 0.4,
    },
  ];
}

function literalFallback(a: ApprovedAction): RuleDraft {
  const literal = typeof a.input === "string" ? a.input : safeStringify(a.input);
  return {
    summary: `Auto-${a.action === "deny" ? "deny" : "approve"} this exact ${a.toolName} call`,
    pattern: literal,
    toolName: a.toolName,
    action: a.action === "deny" ? "deny" : "allow",
    scope: "session",
    confidence: 0.95,
  };
}

// ── Pure helpers ───────────────────────────────────────

function extractLeadingWord(command: string): string | null {
  const match = command.match(/^([A-Za-z0-9._\-/]+)/);
  return match?.[1] ?? null;
}

function extractPath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const candidate = obj["path"] ?? obj["file_path"] ?? obj["filePath"];
  return typeof candidate === "string" ? candidate : null;
}

function extractDir(path: string): string | null {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return null;
  return path.slice(0, idx + 1); // include trailing slash so it's a directory match
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function dedupeByKey(drafts: readonly RuleDraft[]): readonly RuleDraft[] {
  const seen = new Map<string, RuleDraft>();
  for (const d of drafts) {
    const key = `${d.toolName ?? "*"}::${d.action}::${patternKey(d.pattern)}::${d.scope}`;
    const prev = seen.get(key);
    if (!prev || prev.confidence < d.confidence) {
      seen.set(key, d);
    }
  }
  // Sort by confidence DESC, keeping literal-exact fallback near the top
  // so at minimum the user gets a safe option.
  return [...seen.values()].sort((a, b) => b.confidence - a.confidence);
}

function patternKey(pattern: string | RegExp): string {
  if (pattern instanceof RegExp) return `re:${pattern.source}:${pattern.flags}`;
  return `lit:${pattern}`;
}

/**
 * Reject a SerializedRule whose pattern matches the empty string — a
 * bug in the proposer or a corrupt file must not auto-approve every
 * tool call the harness ever makes.
 */
function isSafeSerializedRule(rule: SerializedRule): boolean {
  if (!rule || typeof rule !== "object") return false;
  if (!rule.id || !rule.patternSource) return false;
  if (rule.patternIsRegex) {
    try {
      const re = new RegExp(rule.patternSource, rule.patternFlags);
      // Dangerous: matches the empty input. This would auto-approve
      // a tool call with no args — reject it.
      if (re.test("")) return false;
    } catch {
      return false; // invalid regex
    }
  } else {
    // Literal-substring pattern: reject empty string ONLY. A short string
    // like "ls" is fine — it matches meaningful inputs.
    if (rule.patternSource.length === 0) return false;
  }
  return true;
}
