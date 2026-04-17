/**
 * Agent Skills Open-Standard Adapter (agentskills.io format).
 *
 * Session-6 competitor-win port (P10). Adopt the SKILL.md frontmatter
 * shape shared across OpenAI Skills, Hermes Agent, and Superpowers —
 * making every skill in those ecosystems a drop-in WOTANN skill without
 * translation. The adapter is one-way (parse external format into
 * WOTANN's internal SkillEntry) rather than a bidirectional migration,
 * since WOTANN's existing skills already load via the same frontmatter
 * path; this module adds a FORMAL TYPE for the cross-ecosystem shape.
 *
 * Frontmatter schema (agentskills.io v1.0):
 *
 *   ---
 *   name: string (unique identifier, kebab-case preferred)
 *   description: string (one-sentence purpose)
 *   version?: string (semver, default "1.0.0")
 *   license?: string (SPDX identifier, default "UNLICENSED")
 *   domain?: string ("software-development" | "research" | "devops" | ...)
 *   tier?: string ("system" | "curated" | "experimental", default "curated")
 *   author?: { name: string; email?: string; url?: string }
 *   triggers?: string[]  (phrases that should auto-invoke the skill)
 *   requires?: string[]  (tool names the skill uses — gates loading)
 *   outputs?: string[]   (artifacts/signals produced on success)
 *   ---
 *
 *   # Body (markdown) — optional heading + paragraphs, rendered into the
 *   # system prompt when the skill triggers.
 */

export type SkillTier = "system" | "curated" | "experimental";

export interface SkillAuthor {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
}

export interface AgentSkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly license?: string;
  readonly domain?: string;
  readonly tier?: SkillTier;
  readonly author?: SkillAuthor;
  readonly triggers?: readonly string[];
  readonly requires?: readonly string[];
  readonly outputs?: readonly string[];
}

export interface AgentSkill extends AgentSkillFrontmatter {
  readonly body: string;
  readonly sourcePath: string;
}

/**
 * Parse an agentskills.io-format SKILL.md file. Returns null when the
 * file lacks frontmatter OR the required name/description fields. Tolerant
 * of YAML keys in any order and of blank lines around the `---` fences.
 * Does NOT execute any code — pure string parse.
 */
export function parseAgentSkillFile(content: string, sourcePath: string): AgentSkill | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return null;
  const [, rawFrontmatter, body] = match;
  const frontmatter = parseAgentSkillFrontmatter(rawFrontmatter ?? "");
  if (!frontmatter) return null;
  return { ...frontmatter, body: (body ?? "").trim(), sourcePath };
}

/**
 * Parse the YAML-subset frontmatter. We don't pull a full YAML parser
 * because agentskills.io is deliberately flat — just `key: value` and
 * `key: [a, b]` and `key: {name: X}`. Handling the full YAML grammar
 * adds weight without buying anything for skill files.
 */
export function parseAgentSkillFrontmatter(raw: string): AgentSkillFrontmatter | null {
  const fields: Record<string, unknown> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    fields[key] = coerceYamlValue(value);
  }
  const name = fields["name"];
  const description = fields["description"];
  if (typeof name !== "string" || typeof description !== "string") return null;
  return {
    name: name.trim(),
    description: description.trim(),
    version: typeof fields["version"] === "string" ? (fields["version"] as string) : undefined,
    license: typeof fields["license"] === "string" ? (fields["license"] as string) : undefined,
    domain: typeof fields["domain"] === "string" ? (fields["domain"] as string) : undefined,
    tier: toSkillTier(fields["tier"]),
    author: toAuthor(fields["author"]),
    triggers: toStringArray(fields["triggers"]),
    requires: toStringArray(fields["requires"]),
    outputs: toStringArray(fields["outputs"]),
  };
}

/** Coerce a raw frontmatter value into primitive / array / object. */
function coerceYamlValue(value: string): unknown {
  if (!value) return "";
  // Quoted string
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  // Array — `[a, b, c]` or `[a,b]`
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    if (!inner.trim()) return [];
    return inner
      .split(",")
      .map((p) => p.trim().replace(/^["']|["']$/g, ""))
      .filter((p) => p.length > 0);
  }
  // Inline object — `{name: X, email: Y}`
  if (value.startsWith("{") && value.endsWith("}")) {
    const obj: Record<string, string> = {};
    const inner = value.slice(1, -1);
    for (const pair of inner.split(",")) {
      const [k, ...vs] = pair.split(":");
      if (!k || vs.length === 0) continue;
      obj[k.trim()] = vs
        .join(":")
        .trim()
        .replace(/^["']|["']$/g, "");
    }
    return obj;
  }
  // Bare string
  return value;
}

function toSkillTier(value: unknown): SkillTier | undefined {
  if (value === "system" || value === "curated" || value === "experimental") return value;
  return undefined;
}

function toAuthor(value: unknown): SkillAuthor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj["name"] !== "string") return undefined;
  return {
    name: obj["name"] as string,
    email: typeof obj["email"] === "string" ? (obj["email"] as string) : undefined,
    url: typeof obj["url"] === "string" ? (obj["url"] as string) : undefined,
  };
}

function toStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((v): v is string => typeof v === "string");
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Validate an AgentSkill against the agentskills.io v1.0 minimums.
 * Returns a list of human-readable problems (empty when valid).
 * Does NOT mutate the skill.
 */
export function validateAgentSkill(skill: AgentSkill): readonly string[] {
  const problems: string[] = [];
  if (!skill.name || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(skill.name)) {
    problems.push(
      "name must be non-empty and start+end with alphanumerics; hyphens allowed internally",
    );
  }
  if (!skill.description || skill.description.length < 5) {
    problems.push("description must be at least 5 characters");
  }
  if (skill.version && !/^\d+\.\d+\.\d+/.test(skill.version)) {
    problems.push("version must follow semver (e.g. '1.0.0')");
  }
  if (skill.body.length === 0) {
    problems.push("body must be non-empty — the skill needs content to inject");
  }
  return problems;
}

/**
 * Render an AgentSkill back to the canonical SKILL.md format. Useful
 * for exporting a WOTANN skill as a portable file other ecosystems can
 * consume without transformation.
 */
export function renderAgentSkillFile(skill: AgentSkill): string {
  const fm: string[] = ["---", `name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.version) fm.push(`version: ${skill.version}`);
  if (skill.license) fm.push(`license: ${skill.license}`);
  if (skill.domain) fm.push(`domain: ${skill.domain}`);
  if (skill.tier) fm.push(`tier: ${skill.tier}`);
  if (skill.author) {
    const parts: string[] = [`name: ${skill.author.name}`];
    if (skill.author.email) parts.push(`email: ${skill.author.email}`);
    if (skill.author.url) parts.push(`url: ${skill.author.url}`);
    fm.push(`author: {${parts.join(", ")}}`);
  }
  if (skill.triggers && skill.triggers.length > 0) {
    fm.push(`triggers: [${skill.triggers.map((t) => JSON.stringify(t)).join(", ")}]`);
  }
  if (skill.requires && skill.requires.length > 0) {
    fm.push(`requires: [${skill.requires.map((t) => JSON.stringify(t)).join(", ")}]`);
  }
  if (skill.outputs && skill.outputs.length > 0) {
    fm.push(`outputs: [${skill.outputs.map((t) => JSON.stringify(t)).join(", ")}]`);
  }
  fm.push("---", "");
  return `${fm.join("\n")}\n${skill.body}\n`;
}
