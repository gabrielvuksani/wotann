/**
 * Simple policy language — Cedar-inspired but vastly smaller.
 *
 * A policy file is a list of rules with `permit` or `forbid` effect
 * and clauses on principal / action / resource. Match operators are
 * == (equality), in (set membership), ~ (substring), glob (file
 * glob with star wildcard).
 *
 * Evaluation: forbid wins over permit (explicit deny), default is
 * forbid (no rule matched -> deny). This matches the safe subset
 * of Cedar's semantics most users will write.
 */

export interface DecisionRequest {
  readonly principal: string;
  readonly action: string;
  readonly resource: string;
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

export interface PolicyDecision {
  readonly effect: "permit" | "forbid";
  readonly matchedRule: number | null;
  readonly reason: string;
}

export interface PolicyRule {
  readonly effect: "permit" | "forbid";
  readonly principal?: Matcher;
  readonly action?: Matcher;
  readonly resource?: Matcher;
}

type Matcher =
  | { readonly kind: "eq"; readonly value: string }
  | { readonly kind: "in"; readonly values: ReadonlyArray<string> }
  | { readonly kind: "substring"; readonly fragment: string }
  | { readonly kind: "glob"; readonly pattern: string };

const RULE_LINE_RE = /^\s*(permit|forbid)\s*\(\s*(.*)\s*\)\s*;?\s*$/;
const CLAUSE_RE =
  /\s*(principal|action|resource)\s*(==|in|~|glob)\s*(\[[^\]]*\]|"[^"]*"|'[^']*')\s*,?/g;

export function parsePolicy(text: string): ReadonlyArray<PolicyRule> {
  const rules: PolicyRule[] = [];
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;
    const m = RULE_LINE_RE.exec(trimmed);
    if (!m) continue;
    const effect = m[1] as "permit" | "forbid";
    const rule: PolicyRule = parseClauses(m[2] ?? "", effect);
    rules.push(rule);
  }
  return rules;
}

function parseClauses(body: string, effect: "permit" | "forbid"): PolicyRule {
  const result: { -readonly [K in keyof PolicyRule]?: PolicyRule[K] } = { effect };
  let m: RegExpExecArray | null;
  CLAUSE_RE.lastIndex = 0;
  while ((m = CLAUSE_RE.exec(body)) !== null) {
    const subject = m[1] as "principal" | "action" | "resource";
    const op = m[2] as "==" | "in" | "~" | "glob";
    const literal = m[3]!;
    const matcher = literalToMatcher(op, literal);
    result[subject] = matcher;
  }
  return result as PolicyRule;
}

function literalToMatcher(op: "==" | "in" | "~" | "glob", literal: string): Matcher {
  if (op === "in") {
    const inner = literal.replace(/^\[|\]$/g, "");
    const values = inner
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s.length > 0);
    return { kind: "in", values };
  }
  const value = literal.replace(/^["']|["']$/g, "");
  if (op === "==") return { kind: "eq", value };
  if (op === "~") return { kind: "substring", fragment: value };
  return { kind: "glob", pattern: value };
}

export function matchesMatcher(input: string, matcher: Matcher | undefined): boolean {
  if (!matcher) return true;
  if (matcher.kind === "eq") return matcher.value === input || matcher.value === "*";
  if (matcher.kind === "in") return matcher.values.includes(input);
  if (matcher.kind === "substring") return input.includes(matcher.fragment);
  return globMatch(matcher.pattern, input);
}

function globMatch(pattern: string, input: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "::DOUBLESTAR::")
        .replace(/\*/g, "[^/]*")
        .replace(/::DOUBLESTAR::/g, ".*") +
      "$",
  );
  return regex.test(input);
}

export function evaluatePolicy(
  rules: ReadonlyArray<PolicyRule>,
  request: DecisionRequest,
): PolicyDecision {
  let permitMatch: number | null = null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (
      matchesMatcher(request.principal, rule.principal) &&
      matchesMatcher(request.action, rule.action) &&
      matchesMatcher(request.resource, rule.resource)
    ) {
      if (rule.effect === "forbid") {
        return { effect: "forbid", matchedRule: i, reason: `Forbid rule ${i} matched` };
      }
      if (permitMatch === null) permitMatch = i;
    }
  }
  if (permitMatch !== null) {
    return {
      effect: "permit",
      matchedRule: permitMatch,
      reason: `Permit rule ${permitMatch} matched`,
    };
  }
  return { effect: "forbid", matchedRule: null, reason: "No rule matched (default forbid)" };
}
