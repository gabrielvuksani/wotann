/**
 * Self-Crystallization — auto-skill-from-successful-run.
 *
 * Session-6 competitor port (GenericAgent's signature feature, MIT
 * license, priority 10 per research agent). On task success, extract
 * the (user prompt, tool-call sequence, final diff) tuple into a new
 * SKILL.md file under `~/.wotann/skills/auto/<slug>.md`. The auto
 * skills are flagged `tier: experimental` so the registry can
 * distinguish them from `curated` skills and the UI can prompt the
 * user to review/promote them.
 *
 * Workflow:
 *   1. Runtime/autonomous executor completes a task with exit 0
 *      (tests pass + proof bundle sealed)
 *   2. Call crystallizeSuccess({prompt, toolCalls, diff, title}) →
 *      returns a validated AgentSkill + writes it to disk
 *   3. Next time a similar prompt arrives, the skill registry matches
 *      via `triggers` and injects the skill body into the system prompt
 *
 * The extracted skill body is a compact recipe: the original prompt
 * (anonymized — no absolute paths, no API keys), a bulleted list of
 * the tool-call sequence (names only, not full args — privacy), and
 * a short verification clause ("tests green, diff applied, no
 * regressions"). Users review + promote to `tier: curated` via the
 * skill-review UI (session-7 work).
 */

import { existsSync, mkdirSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import type { AgentSkill } from "./skill-standard.js";
import { renderAgentSkillFile, validateAgentSkill } from "./skill-standard.js";

export interface CrystallizationInput {
  /** User prompt that kicked off the successful run. */
  readonly prompt: string;
  /** Ordered list of tool names invoked during the run. */
  readonly toolCalls: readonly string[];
  /** Short summary of the diff / outcome (e.g. "3 files, +42 -8"). */
  readonly diffSummary: string;
  /** Optional human title override. When omitted, derived from prompt. */
  readonly title?: string;
  /** Optional target directory for the skill file. Defaults to ~/.wotann/skills/auto/ */
  readonly outputDir?: string;
  /** Skip disk write — useful for tests that want the struct without IO. */
  readonly dryRun?: boolean;
}

export interface CrystallizationResult {
  readonly skill: AgentSkill;
  readonly written: boolean;
  readonly path: string;
  readonly problems: readonly string[];
}

/**
 * Turn a prompt into a kebab-case slug <= 48 chars for filename use.
 */
export function slugifyPrompt(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const slug = words.slice(0, 6).join("-").slice(0, 48);
  return slug || `auto-${Date.now().toString(36)}`;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "was",
  "are",
  "have",
  "will",
  "please",
  "can",
  "you",
  "me",
]);

/**
 * Redact likely secrets / absolute paths from the prompt so the
 * crystallized skill doesn't leak local filesystem layout or tokens.
 */
export function redactPrompt(raw: string): string {
  let text = raw;
  // Absolute home-relative paths → /HOME/...
  text = text.replace(new RegExp(homedir().replace(/[/\\]/g, "[/\\\\]"), "g"), "/HOME");
  // Common secret patterns
  text = text.replace(/sk-[a-zA-Z0-9_-]{20,}/g, "<redacted-api-key>");
  text = text.replace(/ghp_[a-zA-Z0-9]{20,}/g, "<redacted-gh-token>");
  text = text.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, (m) =>
    m.length >= 40 ? "<redacted-base64>" : m,
  );
  // Long hex strings (potential tokens)
  text = text.replace(/\b[0-9a-f]{32,}\b/gi, "<redacted-hex>");
  return text;
}

/**
 * Build an AgentSkill from a successful run and optionally write it
 * to disk. Returns the skill + validation problems + write status.
 */
export function crystallizeSuccess(input: CrystallizationInput): CrystallizationResult {
  const safePrompt = redactPrompt(input.prompt).trim();
  const title = (input.title ?? safePrompt.split(/[.!?\n]/)[0] ?? "auto-skill").slice(0, 96);
  const slug = slugifyPrompt(safePrompt);
  const outputDir = input.outputDir ?? resolveWotannHomeSubdir("skills", "auto");
  const filepath = join(outputDir, `${slug}.md`);

  const toolSequence = input.toolCalls.length > 0 ? input.toolCalls.join(" → ") : "(none recorded)";

  const body = [
    `Auto-generated WOTANN skill — crystallized from a successful task run.`,
    ``,
    `## Trigger phrase`,
    safePrompt,
    ``,
    `## Recipe`,
    `When a similar task arrives, use this sequence as a starting point:`,
    ``,
    `\`\`\``,
    toolSequence,
    `\`\`\``,
    ``,
    `## Verification`,
    `- Applied diff summary: ${input.diffSummary}`,
    `- Tests, typecheck, lint all green on the original run`,
    `- Proof bundle sealed before this skill was emitted`,
    ``,
    `## Status`,
    `This skill is \`tier: experimental\`. The WOTANN skill-review UI can`,
    `promote it to \`curated\` after a human review confirms the recipe is`,
    `safe to apply automatically. Until then it's available as a reference`,
    `the model can consult but is not auto-triggered for arbitrary prompts.`,
  ].join("\n");

  const skill: AgentSkill = {
    name: slug,
    description: title,
    version: "0.1.0",
    license: "UNLICENSED",
    tier: "experimental",
    triggers: [safePrompt.slice(0, 120)],
    body,
    sourcePath: filepath,
  };

  const problems = validateAgentSkill(skill);
  if (problems.length > 0 || input.dryRun) {
    return { skill, written: false, path: filepath, problems };
  }

  try {
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    // Wave 6.5-UU (H-22) — crystallized agent skill file. Atomic write.
    writeFileAtomic(filepath, renderAgentSkillFile(skill), { mode: 0o600 });
    return { skill, written: true, path: filepath, problems };
  } catch (err) {
    return {
      skill,
      written: false,
      path: filepath,
      problems: [`write failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
