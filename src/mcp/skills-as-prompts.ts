/**
 * Expose WOTANN skills as MCP prompts (V9 Wave 6.9-AG follow-up).
 *
 * MCP spec 2025-11-25 defines a `prompts` capability so any
 * MCP-compatible client (Claude Desktop, Cursor, Cline, Continue,
 * Zed, VSCode) can enumerate and invoke prompt templates the server
 * publishes. WOTANN ships 100+ markdown skills with a uniform
 * frontmatter shape — they ARE prompt templates. The architectural
 * gap closed by this module: skill catalogue → MCP prompt catalogue.
 *
 * Doc-string note: avoid hardcoding a skill count here. The actual
 * count grows with each release; the registry is the source of truth.
 * Tools/CLI that need a current number should call into the registry
 * rather than relying on this comment.
 *
 * Earlier WOTANN advertised the `prompts` capability theatrically and
 * `prompts/list` always returned `[]`. Wave 6.9-AG dropped the empty
 * stub per QB#6 (don't advertise capabilities you can't honor) with
 * the explicit rationale "no skill→prompt mapping exists." This file
 * IS that mapping. Once wired, `prompts/list` returns the curated
 * user-invocable subset of the skill registry, and `prompts/get`
 * renders a single skill's body — interpolating any user-supplied
 * `{{argument}}` placeholders — as an MCP prompt result.
 *
 * Design (QB#6, QB#7):
 *   - Stateless. Both helpers take the registry as a parameter; no
 *     module-level cache. The registry is the source of truth, so
 *     reloads (e.g., after `discoverCrossToolSkills`) immediately
 *     reflect in the prompt catalogue.
 *   - Honest fallback. Missing arguments are interpolated as empty
 *     strings AND logged to stderr so the operator sees the
 *     under-substitution. Never silently fabricate plausible values.
 *   - User-invocable filter. Skills with `always: true` are passive
 *     ambient skills (auto-loaded, not user-prompted) — they do NOT
 *     appear in `prompts/list` because that surface is the user's
 *     prompt picker. Path-bound and regular skills DO appear.
 *
 * QB#15 source-verified shapes:
 *   - SkillRegistry exposes `getSummaries(): readonly SkillSummary[]`
 *     (loader.ts:368) and `loadSkill(name): LoadedSkill | null`
 *     (loader.ts:499). LoadedSkill.content is the full markdown
 *     including the frontmatter fence; `stripFrontmatter()` peels it
 *     so the prompt body is what reaches the client.
 *   - Skill frontmatter NEVER carries a top-level `arguments:` block
 *     today (verified via grep — no skill in `skills/` or
 *     `.wotann/skills/` declares one). Argument inference therefore
 *     uses `{{variable}}` interpolation extraction from the body.
 *     If a future skill adds `arguments:`, the parsed metadata
 *     surfaces them via `extraMetadata` and we honor that path too.
 */

import type { SkillRegistry, SkillSummary, LoadedSkill } from "../skills/loader.js";

// ── MCP prompt schema (spec 2025-11-25) ──────────────────────

/**
 * One named argument a prompt accepts. The MCP spec keeps this
 * lightweight on purpose — the SERVER decides validation. We mark
 * every inferred argument as `required: false` because we cannot
 * tell from a `{{var}}` site whether the skill body fails open or
 * closed when `var` is missing; honest interpolation + log warn
 * (QB#6) is safer than asserting required-ness we can't enforce.
 */
export interface McpPromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

/**
 * Prompt catalogue entry returned from `prompts/list`. The MCP host
 * displays this in its prompt picker. `name` is the stable id the
 * client will pass back in `prompts/get`.
 */
export interface McpPromptDefinition {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly McpPromptArgument[];
}

/**
 * Single message in a rendered prompt. Always `role: "user"` here
 * because skills are user-side instructions; future personas/agent
 * skills could add assistant turns.
 */
export interface McpPromptMessage {
  readonly role: "user" | "assistant";
  readonly content: { readonly type: "text"; readonly text: string };
}

/**
 * Full result of `prompts/get`. The host injects `messages` into
 * its conversation context.
 */
export interface McpPromptResult {
  readonly description?: string;
  readonly messages: readonly McpPromptMessage[];
}

// ── Public API ───────────────────────────────────────────────

/**
 * Enumerate every USER-INVOCABLE skill as an MCP prompt definition.
 *
 * "User-invocable" = skills the user would explicitly pick from
 * a palette. Excludes skills with `always: true` (those are passive
 * auto-loaded ambient skills — exposing them as prompts would
 * pollute the picker with surface the user already gets for free).
 *
 * Returns a NEW array each call so callers can safely mutate
 * (sort, filter, paginate) without affecting the registry.
 */
export function skillsToMcpPrompts(registry: SkillRegistry): readonly McpPromptDefinition[] {
  const summaries = registry.getSummaries();
  const prompts: McpPromptDefinition[] = [];

  for (const summary of summaries) {
    if (summary.always === true) continue;

    const definition = buildPromptDefinition(summary, registry);
    prompts.push(definition);
  }

  // Stable ordering — alphabetical by name. Hosts that paginate
  // expect a deterministic catalogue across `prompts/list` calls.
  prompts.sort((a, b) => a.name.localeCompare(b.name));
  return prompts;
}

/**
 * Render a single skill as an MCP prompt result.
 *
 * Steps:
 *   1. Look up the skill (throws with a clear message when missing).
 *   2. Load full content via `registry.loadSkill()` — this honors
 *      the SkillsGuard fail-CLOSED behavior in loader.ts:559-574.
 *   3. Strip the YAML frontmatter so only the prompt body is sent
 *      to the host. (Frontmatter is metadata for WOTANN's loader,
 *      not instructions for the model.)
 *   4. Interpolate `{{argname}}` placeholders with `args[argname]`.
 *      Missing args -> empty string + stderr warn (QB#6 honest).
 *
 * Hosts use the returned `description` as a tooltip and `messages`
 * as the conversation injection.
 */
export function getSkillAsMcpPrompt(
  skillId: string,
  args: Record<string, string>,
  registry: SkillRegistry,
  stderr: NodeJS.WriteStream | { write: (s: string) => void } = process.stderr,
): McpPromptResult {
  if (!registry.hasSkill(skillId)) {
    throw new Error(
      `prompts/get: skill "${skillId}" not found in registry — call prompts/list to see available prompts`,
    );
  }

  const loaded: LoadedSkill | null = registry.loadSkill(skillId);
  if (loaded === null) {
    // The metadata exists but the body did not load — usually means
    // the SkillsGuard rejected the file at registration time. Surface
    // this honestly (QB#6) instead of returning empty content.
    throw new Error(
      `prompts/get: skill "${skillId}" failed to load — likely rejected by SkillsGuard. Check registry.getRejectedSkills()`,
    );
  }

  const body = stripFrontmatter(loaded.content);
  const interpolated = interpolate(body, args, skillId, stderr);

  const description = loaded.metadata.description ?? loaded.metadata.name;
  return {
    description,
    messages: [
      {
        role: "user",
        content: { type: "text", text: interpolated },
      },
    ],
  };
}

// ── Internals ────────────────────────────────────────────────

/**
 * Build the McpPromptDefinition for one skill summary. We need the
 * full body to infer arguments from `{{var}}` sites, so we lazily
 * load the skill via the registry's cache. Skills that fail to load
 * still appear in the catalogue with no arguments — graceful
 * degradation per QB#6 (an empty argument list is honest, the user
 * just won't get parameter prompts).
 */
function buildPromptDefinition(
  summary: SkillSummary,
  registry: SkillRegistry,
): McpPromptDefinition {
  const loaded = registry.loadSkill(summary.name);
  const body = loaded ? stripFrontmatter(loaded.content) : "";
  const args = extractArgumentNames(body);

  const definition: McpPromptDefinition = {
    name: summary.name,
    description: summary.description ?? summary.name,
    ...(args.length > 0
      ? {
          arguments: args.map((name) => ({
            name,
            description: `Substituted into the skill body wherever {{${name}}} appears`,
            required: false,
          })),
        }
      : {}),
  };
  return definition;
}

/**
 * Strip the YAML frontmatter fence from a skill's full content.
 * The fence is `---\n...\n---\n` at the start. Skills without a
 * fence pass through unchanged (defensive — built-in skills synth
 * their content via `loadSkill()` fallback at loader.ts:538-542
 * with no frontmatter).
 */
function stripFrontmatter(content: string): string {
  // Same regex shape as loader.ts:696 so behavior matches the parser.
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return content;
  return content.slice(match[0].length).trimStart();
}

/**
 * Extract the unique `{{varname}}` placeholders from a skill body.
 * Only matches `[A-Za-z_][A-Za-z0-9_]*` to avoid mangling
 * code-block content like `{{ obj.field }}` that happens to use
 * mustache syntax. Order is the order of first appearance so
 * downstream UIs render arguments in a natural reading order.
 */
function extractArgumentNames(body: string): readonly string[] {
  // \{\{ ... \}\} non-greedy. The regex constrains to a single
  // identifier, which is the convention for skill template vars
  // (e.g., {{observations_json}}).
  const re = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
  const seen = new Set<string>();
  const ordered: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    ordered.push(name);
  }
  return ordered;
}

/**
 * Interpolate `{{name}}` placeholders. Missing arguments become
 * empty strings AND log a warn to stderr so the operator sees the
 * gap. We deliberately avoid throwing because skills frequently use
 * placeholders for OPTIONAL fields ("for the {{topic}} domain") and
 * forcing a hard error would block legitimate invocations.
 *
 * QB#6: honest fallback — empty string + warn, not silent success
 * with a fabricated value.
 */
function interpolate(
  body: string,
  args: Record<string, string>,
  skillId: string,
  stderr: { write: (s: string) => void },
): string {
  const re = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
  const missing = new Set<string>();
  const out = body.replace(re, (_full, name: string) => {
    const value = args[name];
    if (typeof value !== "string") {
      missing.add(name);
      return "";
    }
    return value;
  });

  if (missing.size > 0) {
    const list = [...missing].sort().join(", ");
    stderr.write(
      `[skills-as-prompts] warn: prompt "${skillId}" missing arguments [${list}] — interpolated as empty strings\n`,
    );
  }

  return out;
}
