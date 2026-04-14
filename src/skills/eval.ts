import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";

/**
 * Skill Evaluation Framework — 3-layer quality assessment.
 *
 * LAYERS:
 * 1. Static Analysis — check structure, metadata, triggers, file size
 * 2. LLM Judge — have a model rate the skill's quality and usefulness
 * 3. Monte Carlo — run the skill N times on sample prompts, measure outcomes
 *
 * QUALITY BADGES:
 * - Platinum: passes all 3 layers, >90% Monte Carlo success rate
 * - Gold: passes static + LLM, >70% Monte Carlo
 * - Silver: passes static, LLM rates "good"
 * - Bronze: passes static analysis only
 * - Unrated: not yet evaluated
 */

export type QualityBadge = "platinum" | "gold" | "silver" | "bronze" | "unrated";

export interface SkillEvalResult {
  readonly skillName: string;
  readonly badge: QualityBadge;
  readonly staticScore: number;
  readonly llmScore: number;
  readonly monteCarloScore: number;
  readonly issues: readonly EvalIssue[];
  readonly evaluatedAt: string;
}

export interface EvalIssue {
  readonly layer: "static" | "llm" | "monte-carlo";
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
}

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly triggers?: readonly string[];
  readonly category?: string;
  readonly context?: string;
  readonly contentLength: number;
}

// ── Layer 1: Static Analysis ─────────────────────────────

/**
 * Evaluate a skill's structure and metadata.
 * Returns a score from 0-1 and any issues found.
 */
export function evaluateStatic(metadata: SkillMetadata, content: string): {
  score: number;
  issues: readonly EvalIssue[];
} {
  const issues: EvalIssue[] = [];
  let score = 1.0;

  // Name check
  if (!metadata.name || metadata.name.length < 2) {
    issues.push({ layer: "static", severity: "error", message: "Skill name is missing or too short" });
    score -= 0.3;
  }

  // Description check
  if (!metadata.description || metadata.description.length < 10) {
    issues.push({ layer: "static", severity: "error", message: "Description is missing or too short" });
    score -= 0.2;
  }

  // Content length check
  if (content.length < 50) {
    issues.push({ layer: "static", severity: "error", message: "Skill content is too short (< 50 chars)" });
    score -= 0.3;
  }
  if (content.length > 50_000) {
    issues.push({ layer: "static", severity: "warning", message: "Skill content is very long (> 50K chars). Consider splitting." });
    score -= 0.1;
  }

  // Trigger check
  if (!metadata.triggers || metadata.triggers.length === 0) {
    issues.push({ layer: "static", severity: "warning", message: "No trigger patterns defined. Skill won't auto-activate." });
    score -= 0.1;
  }

  // Category check
  if (!metadata.category) {
    issues.push({ layer: "static", severity: "info", message: "No category defined. Skill won't appear in categorized listings." });
    score -= 0.05;
  }

  // Check for common SKILL.md structure
  if (!content.includes("---")) {
    issues.push({ layer: "static", severity: "warning", message: "Missing frontmatter (---). Standard skills use YAML frontmatter." });
    score -= 0.1;
  }

  return { score: Math.max(0, score), issues };
}

// ── Layer 2: LLM Judge ───────────────────────────────────

/**
 * Build a prompt for an LLM to judge skill quality.
 * The LLM rates the skill on clarity, usefulness, and completeness.
 */
export function buildLLMJudgePrompt(skillName: string, skillContent: string): string {
  return [
    "You are evaluating an AI agent skill definition for quality.",
    "",
    `Skill name: ${skillName}`,
    `Skill content (${skillContent.length} chars):`,
    "```",
    skillContent.slice(0, 5000),
    "```",
    "",
    "Rate this skill on a scale of 0-10 for each criterion:",
    "1. CLARITY: Is the skill's purpose clear? Are instructions unambiguous?",
    "2. USEFULNESS: Would this skill actually help an AI agent do better work?",
    "3. COMPLETENESS: Does it cover edge cases? Does it have examples?",
    "4. TRIGGER_ACCURACY: Are the trigger patterns specific enough?",
    "",
    "Respond with JSON: {\"clarity\": N, \"usefulness\": N, \"completeness\": N, \"trigger_accuracy\": N, \"overall\": N}",
  ].join("\n");
}

/**
 * Parse an LLM's quality rating response.
 * Returns a normalized score from 0-1.
 */
export function parseLLMJudgeResponse(response: string): number {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (!jsonMatch) return 0.5; // Default to medium if no JSON found

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, number>;
    const overall = parsed["overall"] ?? (
      ((parsed["clarity"] ?? 5) + (parsed["usefulness"] ?? 5) + (parsed["completeness"] ?? 5) + (parsed["trigger_accuracy"] ?? 5)) / 4
    );

    return Math.max(0, Math.min(1, overall / 10));
  } catch {
    return 0.5;
  }
}

// ── Badge Assignment ─────────────────────────────────────

/**
 * Assign a quality badge based on evaluation scores.
 */
export function assignBadge(
  staticScore: number,
  llmScore: number,
  monteCarloScore: number,
): QualityBadge {
  if (staticScore >= 0.8 && llmScore >= 0.8 && monteCarloScore >= 0.9) return "platinum";
  if (staticScore >= 0.7 && llmScore >= 0.7 && monteCarloScore >= 0.7) return "gold";
  if (staticScore >= 0.6 && llmScore >= 0.6) return "silver";
  if (staticScore >= 0.5) return "bronze";
  return "unrated";
}

// ── Cross-Harness Skill Import ───────────────────────────

/**
 * Scan known skill directories for importable skills.
 * Checks: .wotann/skills/, .claude/skills/, .cursor/skills/, .agents/skills/
 */
export function discoverImportableSkills(projectDir: string): readonly {
  source: string;
  path: string;
  name: string;
}[] {
  const skillDirs = [
    { source: "wotann", path: join(projectDir, ".wotann", "skills") },
    { source: "claude", path: join(homedir(), ".claude", "skills") },
    { source: "claude-project", path: join(projectDir, ".claude", "skills") },
    { source: "cursor", path: join(projectDir, ".cursor", "skills") },
    { source: "agents", path: join(projectDir, ".agents", "skills") },
  ];

  const skills: { source: string; path: string; name: string }[] = [];

  for (const dir of skillDirs) {
    if (!existsSync(dir.path)) continue;
    try {
      skills.push(...discoverSkillsInDirectory(dir.source, dir.path));
    } catch {
      // Skip inaccessible directories
    }
  }

  return skills;
}

function discoverSkillsInDirectory(
  source: string,
  dirPath: string,
): readonly { source: string; path: string; name: string }[] {
  if (!existsSync(dirPath)) return [];

  const skills: { source: string; path: string; name: string }[] = [];
  const entries = readdirSync(dirPath, { withFileTypes: true })
    .filter((entry: import("node:fs").Dirent) => !entry.name.startsWith(".") && entry.name !== "node_modules")
    .sort((a: import("node:fs").Dirent, b: import("node:fs").Dirent) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isFile() && entry.name.endsWith(".md")) {
      skills.push({
        source,
        path: fullPath,
        name: entry.name.replace(/\.md$/, ""),
      });
      continue;
    }

    if (!entry.isDirectory()) continue;

    const skillFilePath = join(fullPath, "SKILL.md");
    if (existsSync(skillFilePath)) {
      let skillName = entry.name;
      try {
        const content = readFileSync(skillFilePath, "utf-8");
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (match?.[1]) {
          const frontmatter = parse(match[1]) as Record<string, unknown>;
          if (typeof frontmatter["name"] === "string" && frontmatter["name"].length > 0) {
            skillName = frontmatter["name"];
          }
        }
      } catch {
        // Fall back to directory name if parsing fails.
      }

      skills.push({
        source,
        path: skillFilePath,
        name: skillName,
      });
      continue;
    }

    skills.push(...discoverSkillsInDirectory(source, fullPath));
  }

  return skills;
}
