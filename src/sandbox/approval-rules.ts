/**
 * Approval-rule engine — Phase 5 Codex parity (request_rule).
 *
 * Codex's `request_rule` lets the agent propose a rule like "auto-approve
 * bash commands matching ^ls\s+" instead of re-prompting the user for
 * each equivalent call. Rules apply for the rest of the session (or
 * persist to disk), short-circuiting the approval UI to `allow`/`deny`.
 *
 * Without rule-caching, a 500-task benchmark with even 10 "always-safe"
 * tool calls per task = 5000 approval prompts. With rules, the first
 * match installs the rule and the other 4999 go through automatically.
 *
 * Design:
 *   - ApprovalRule is a {pattern, toolName, action, scope, expiresAt?}
 *   - ApprovalRuleEngine.evaluate() checks rules in insertion order and
 *     returns the FIRST match
 *   - "persistent" rules can be serialized to JSON + restored on
 *     session start (caller owns the fs — this module is pure)
 *   - Patterns are string-literal OR RegExp (pre-compiled)
 *
 * The engine itself has no side effects — callers use it as a pure
 * policy decider in their existing approval flow.
 */

// ── Types ──────────────────────────────────────────────

export type ApprovalAction = "allow" | "deny" | "ask";

export type ApprovalScope = "session" | "persistent";

export interface ApprovalRule {
  /** Stable id for the rule (used for removal + dedup). */
  readonly id: string;
  /**
   * The tool name this rule applies to. Undefined = ANY tool (pattern
   * matches across the entire tool surface — use sparingly).
   */
  readonly toolName?: string;
  /**
   * Pattern matched against the string-concatenated representation of
   * the tool input. For Bash: matches the command string. For Write:
   * matches the file path. Pattern types:
   *   - string → literal substring match (case-sensitive)
   *   - RegExp → regex match
   */
  readonly pattern: string | RegExp;
  /** What to do when matched. */
  readonly action: "allow" | "deny";
  /** session = until engine reset, persistent = serializable to disk. */
  readonly scope: ApprovalScope;
  /** Unix ms — when this rule stops being active. Undefined = never expires. */
  readonly expiresAt?: number;
  /** Free-text explanation (for UI display). */
  readonly reason?: string;
}

export interface EvaluationResult {
  readonly action: ApprovalAction;
  readonly matchedRuleId: string | null;
  readonly reason: string;
}

export interface SerializedRule {
  readonly id: string;
  readonly toolName?: string;
  readonly patternSource: string;
  readonly patternFlags?: string;
  readonly patternIsRegex: boolean;
  readonly action: "allow" | "deny";
  readonly scope: ApprovalScope;
  readonly expiresAt?: number;
  readonly reason?: string;
}

// ── Engine ─────────────────────────────────────────────

export class ApprovalRuleEngine {
  private rules: ApprovalRule[] = [];
  private readonly now: () => number;

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Install a rule. Rules are evaluated in insertion order; later rules
   * for the same pattern do NOT overwrite earlier ones (remove first).
   */
  addRule(rule: ApprovalRule): void {
    if (!rule.id) throw new Error("ApprovalRuleEngine: rule.id is required");
    this.rules.push(rule);
  }

  /** Remove a rule by id. Returns true if removed, false if not found. */
  removeRule(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  /** Return all currently-installed rules (immutable snapshot). */
  listRules(): readonly ApprovalRule[] {
    return [...this.rules];
  }

  /** Remove all session-scoped rules. Persistent ones stay. */
  clearSessionRules(): number {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.scope !== "session");
    return before - this.rules.length;
  }

  /**
   * Evaluate a proposed tool call against all active rules.
   * Short-circuits on first match. Returns `ask` when no rule applies.
   */
  evaluate(toolName: string, input: unknown): EvaluationResult {
    const now = this.now();
    const target = stringifyInput(input);

    for (const rule of this.rules) {
      // Expiry check
      if (rule.expiresAt !== undefined && rule.expiresAt <= now) continue;
      // Tool name check
      if (rule.toolName !== undefined && rule.toolName !== toolName) continue;
      // Pattern match
      const matched = matchPattern(rule.pattern, target);
      if (!matched) continue;

      return {
        action: rule.action,
        matchedRuleId: rule.id,
        reason: rule.reason ?? `matched rule ${rule.id}`,
      };
    }

    return {
      action: "ask",
      matchedRuleId: null,
      reason: "no rule matched — requires manual approval",
    };
  }

  /** Serialize PERSISTENT rules for on-disk storage. */
  serializePersistent(): readonly SerializedRule[] {
    return this.rules
      .filter((r) => r.scope === "persistent")
      .map((r) => ({
        id: r.id,
        ...(r.toolName !== undefined ? { toolName: r.toolName } : {}),
        patternSource: r.pattern instanceof RegExp ? r.pattern.source : r.pattern,
        ...(r.pattern instanceof RegExp ? { patternFlags: r.pattern.flags } : {}),
        patternIsRegex: r.pattern instanceof RegExp,
        action: r.action,
        scope: r.scope,
        ...(r.expiresAt !== undefined ? { expiresAt: r.expiresAt } : {}),
        ...(r.reason !== undefined ? { reason: r.reason } : {}),
      }));
  }

  /** Restore previously-serialized rules. Invalid entries are skipped. */
  loadSerialized(serialized: readonly SerializedRule[]): number {
    let loaded = 0;
    for (const s of serialized) {
      if (!s.id) continue;
      let pattern: string | RegExp;
      try {
        pattern = s.patternIsRegex ? new RegExp(s.patternSource, s.patternFlags) : s.patternSource;
      } catch {
        continue; // skip invalid regex
      }
      this.addRule({
        id: s.id,
        ...(s.toolName !== undefined ? { toolName: s.toolName } : {}),
        pattern,
        action: s.action,
        scope: s.scope,
        ...(s.expiresAt !== undefined ? { expiresAt: s.expiresAt } : {}),
        ...(s.reason !== undefined ? { reason: s.reason } : {}),
      });
      loaded++;
    }
    return loaded;
  }
}

// ── Helpers ────────────────────────────────────────────

function stringifyInput(input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function matchPattern(pattern: string | RegExp, target: string): boolean {
  if (pattern instanceof RegExp) {
    // Reset lastIndex in case of /g flag
    pattern.lastIndex = 0;
    return pattern.test(target);
  }
  return target.includes(pattern);
}

/**
 * Convenience constructor: build a "user approved pattern X for tool Y"
 * rule with a fresh id.
 */
export function makeSessionAllowRule(
  toolName: string | undefined,
  pattern: string | RegExp,
  reason?: string,
): ApprovalRule {
  const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    ...(toolName !== undefined ? { toolName } : {}),
    pattern,
    action: "allow",
    scope: "session",
    ...(reason !== undefined ? { reason } : {}),
  };
}
