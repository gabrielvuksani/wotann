/**
 * Constraint validators for evolved variants.
 *
 * Every variant must pass these gates before becoming eligible to
 * replace its parent. Mirrors the "Guardrails" section of
 * research/hermes-agent-self-evolution/PLAN.md but adapted for WOTANN's
 * naming conventions and skill file shape.
 */

import { ConstraintReport, EvolveTarget } from "./types.js";

const MAX_SKILL_BYTES = 15_360; // 15 KB — matches hermes constraint
const MAX_TOOL_DESC_BYTES = 500;

const FORBIDDEN_TOKENS: ReadonlyArray<string> = ["TODO", "FIXME", "XXX", "<placeholder>"];

export function validateConstraints(
  target: EvolveTarget,
  candidateContent: string,
): ConstraintReport {
  const violations: string[] = [];

  // 1. Size limits
  const sizeBytes = Buffer.byteLength(candidateContent, "utf8");
  if (target.kind === "skill" && sizeBytes > MAX_SKILL_BYTES) {
    violations.push(`Skill exceeds ${MAX_SKILL_BYTES}-byte cap (got ${sizeBytes})`);
  }
  if (target.kind === "tool-description" && sizeBytes > MAX_TOOL_DESC_BYTES) {
    violations.push(`Tool description exceeds ${MAX_TOOL_DESC_BYTES}-byte cap (got ${sizeBytes})`);
  }

  // 2. Forbidden placeholder tokens
  for (const tok of FORBIDDEN_TOKENS) {
    if (candidateContent.includes(tok)) {
      violations.push(`Contains forbidden token "${tok}"`);
    }
  }

  // 3. Skill files must keep their YAML frontmatter intact
  if (target.kind === "skill" && !candidateContent.startsWith("---")) {
    violations.push("Skill file lost YAML frontmatter (must start with ---)");
  }

  // 4. No empty content
  if (candidateContent.trim().length === 0) {
    violations.push("Variant content is empty");
  }

  // 5. Skill files must keep a `name:` field in frontmatter
  if (target.kind === "skill" && !/^name:\s*\S+/m.test(candidateContent)) {
    violations.push("Skill file lost `name:` frontmatter field");
  }

  return { passed: violations.length === 0, violations };
}

export function exposesSecret(content: string): boolean {
  return /(?:sk-[A-Za-z0-9_-]{20,}|api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_-]{20,})/i.test(content);
}
