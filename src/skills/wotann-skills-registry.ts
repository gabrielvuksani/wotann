/**
 * WOTANN curated skills registry — Tier 12 batch D.
 *
 * Surfaces 10 high-value skills ported from OpenClaw (Apache-2) into
 * `.wotann/skills/`. The prompt engine queries this registry to recommend
 * skills based on user intent / file context / triggers.
 *
 * Each entry is a pure data record. The actual SKILL.md / .md file lives
 * under `.wotann/skills/<id>.md` and is loaded on demand via the existing
 * `SkillRegistry` (see `loader.ts`). This file is the discovery surface —
 * a stable identifier-to-metadata mapping that the prompt engine, palette
 * UI, and CLI all share.
 *
 * Pure data only. No process.env reads, no fs reads, no network. Callers
 * inject those concerns via the existing loader.
 */

/**
 * Coarse category for skill grouping in the palette / docs.
 *
 * `quality` covers code review, refactor, simplification.
 * `debugging` covers bug-finding workflows.
 * `security` covers OWASP and secret handling.
 * `performance` covers profiling and optimization.
 * `testing` covers test design and coverage.
 * `architecture` covers API and system design.
 * `database` covers schema migrations.
 * `operations` covers runbooks (incident response, deployments).
 * `research` covers multi-source investigation.
 */
export type WotannSkillCategory =
  | "quality"
  | "debugging"
  | "security"
  | "performance"
  | "testing"
  | "architecture"
  | "database"
  | "operations"
  | "research";

/**
 * One skill entry. The `file` field is relative to the project root so
 * loaders can resolve `<projectDir>/<file>` directly.
 *
 * `triggers` are short phrase fragments the user might say which suggest
 * the skill should be considered. They are not regexes — they are matched
 * case-insensitively as substrings.
 *
 * The shape is immutable: callers MUST treat each entry as readonly. Use
 * `withSkill` / `withCategory` helpers below to build derived data.
 */
export interface WotannSkillEntry {
  readonly id: string;
  readonly file: string;
  readonly description: string;
  readonly triggers: readonly string[];
  readonly category: WotannSkillCategory;
}

const SKILLS_BASE_DIR = ".wotann/skills" as const;

/**
 * The 10 curated skills shipped with WOTANN. Order is intentional: the
 * most-frequently-needed entries come first so palette UIs that show a
 * top-N list pick the highest-value defaults.
 */
export const WOTANN_SKILLS: readonly WotannSkillEntry[] = [
  {
    id: "research-deep",
    file: `${SKILLS_BASE_DIR}/research-deep.md`,
    description:
      "Comprehensive multi-source research with cross-checking, citation tracking, and synthesis",
    triggers: [
      "research",
      "investigate the landscape",
      "compare options",
      "what does the evidence",
      "literature review",
      "gather sources",
    ],
    category: "research",
  },
  {
    id: "code-review",
    file: `${SKILLS_BASE_DIR}/code-review.md`,
    description: "Multi-pass code review with severity-tiered findings (CRITICAL/HIGH/MEDIUM/LOW)",
    triggers: [
      "review this code",
      "review the pr",
      "review the diff",
      "look over my code",
      "code review",
      "pr review",
    ],
    category: "quality",
  },
  {
    id: "debug-systematic",
    file: `${SKILLS_BASE_DIR}/debug-systematic.md`,
    description: "Hypothesis-driven systematic debugging with evidence ledger and bisection",
    triggers: [
      "debug",
      "why does this fail",
      "find the bug",
      "investigate failure",
      "test failing",
      "unexpected behavior",
    ],
    category: "debugging",
  },
  {
    id: "refactor-safe",
    file: `${SKILLS_BASE_DIR}/refactor-safe.md`,
    description:
      "Refactor with tests-first safety net, semantic preservation, and incremental verification",
    triggers: [
      "refactor",
      "restructure",
      "extract",
      "rename across files",
      "split this module",
      "clean up structure",
    ],
    category: "quality",
  },
  {
    id: "security-audit",
    file: `${SKILLS_BASE_DIR}/security-audit.md`,
    description:
      "OWASP-aligned security audit covering injection, auth, secrets, crypto, and supply chain",
    triggers: [
      "security audit",
      "owasp",
      "audit auth",
      "check for vulnerabilities",
      "security review",
      "pentest",
    ],
    category: "security",
  },
  {
    id: "performance-profile",
    file: `${SKILLS_BASE_DIR}/performance-profile.md`,
    description:
      "Performance profiling with measure-first methodology, hot-path isolation, and regression gates",
    triggers: [
      "profile performance",
      "make it faster",
      "optimize",
      "slow endpoint",
      "p99 latency",
      "memory leak",
      "cpu hot",
    ],
    category: "performance",
  },
  {
    id: "api-design",
    file: `${SKILLS_BASE_DIR}/api-design.md`,
    description:
      "API design principles for REST, GraphQL, and RPC with versioning, error model, and contract testing",
    triggers: [
      "design api",
      "api endpoint",
      "rest design",
      "graphql schema",
      "openapi",
      "rpc contract",
    ],
    category: "architecture",
  },
  {
    id: "test-coverage",
    file: `${SKILLS_BASE_DIR}/test-coverage.md`,
    description:
      "Comprehensive test coverage with unit/integration/e2e layering and meaningful assertions",
    triggers: [
      "write tests",
      "add tests",
      "test coverage",
      "tdd",
      "missing tests",
      "regression test",
    ],
    category: "testing",
  },
  {
    id: "database-migration",
    file: `${SKILLS_BASE_DIR}/database-migration.md`,
    description:
      "Safe database migration with backwards-compat, expand-contract, and rollback procedures",
    triggers: [
      "database migration",
      "schema change",
      "alter table",
      "rename column",
      "drop column",
      "backfill",
      "expand contract",
    ],
    category: "database",
  },
  {
    id: "incident-response",
    file: `${SKILLS_BASE_DIR}/incident-response.md`,
    description:
      "Production incident response runbook with severity, comms, mitigation, and postmortem",
    triggers: [
      "incident",
      "production down",
      "outage",
      "site is down",
      "users affected",
      "postmortem",
      "page on-call",
    ],
    category: "operations",
  },
];

/**
 * Lookup a skill by id. Returns null when no skill matches — callers
 * should treat unknown ids as a non-fatal "no match" condition rather
 * than throwing, so user typos don't abort prompt construction.
 */
export function findSkillById(id: string): WotannSkillEntry | null {
  for (const skill of WOTANN_SKILLS) {
    if (skill.id === id) return skill;
  }
  return null;
}

/**
 * All skills in the given category. Returns an empty array (not null) so
 * callers can iterate without null-checks.
 */
export function skillsByCategory(category: WotannSkillCategory): readonly WotannSkillEntry[] {
  const out: WotannSkillEntry[] = [];
  for (const skill of WOTANN_SKILLS) {
    if (skill.category === category) out.push(skill);
  }
  return out;
}

/**
 * Match a free-form user input against the trigger phrases of every
 * skill. Returns at most `limit` candidates ordered by trigger-match
 * count (descending), with stable tie-breaking by id (ascending).
 *
 * The input is lowercased and matched as substrings — this is
 * intentionally simple. For richer matching the prompt engine should
 * use the SkillRegistry from `loader.ts` which adds path globs and
 * always-active flags.
 */
export function matchSkillsByTrigger(
  input: string,
  limit: number = 3,
): readonly WotannSkillEntry[] {
  if (input.length === 0 || limit <= 0) return [];
  const haystack = input.toLowerCase();
  const scored: { readonly skill: WotannSkillEntry; readonly score: number }[] = [];

  for (const skill of WOTANN_SKILLS) {
    let matches = 0;
    for (const trigger of skill.triggers) {
      if (haystack.includes(trigger.toLowerCase())) matches += 1;
    }
    if (matches > 0) scored.push({ skill, score: matches });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.skill.id.localeCompare(b.skill.id);
  });

  return scored.slice(0, limit).map((s) => s.skill);
}

/**
 * The set of all distinct categories represented by the registry. Useful
 * for palette UIs that group skills by section.
 */
export function listCategories(): readonly WotannSkillCategory[] {
  const seen = new Set<WotannSkillCategory>();
  for (const skill of WOTANN_SKILLS) {
    seen.add(skill.category);
  }
  return [...seen].sort();
}

/**
 * Total count of registered skills. Stable across releases unless a
 * skill is intentionally added/removed; callers can use this for a
 * lightweight registry-version check in tests.
 */
export const WOTANN_SKILL_COUNT: number = WOTANN_SKILLS.length;
