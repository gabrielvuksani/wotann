/**
 * Runner — high-level facade that wires the optimizer to the configured
 * provider and the project's skill files / trace history.
 *
 * Most users invoke evolution via `wotann evolve <skill>`. The CLI
 * imports this module and calls `evolveSkill()`. We keep this layer
 * thin so the CLI's UX changes (table formatting, progress bars,
 * confirmation prompts) don't churn the optimizer.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import { runOptimization, MutationCaller } from "./optimizer.js";
import { EvaluationCaller } from "./evaluator.js";
import { EvolveExample, OptimizeRunSummary } from "./types.js";

export interface EvolveSkillArgs {
  readonly skillPath: string;
  readonly examples: ReadonlyArray<EvolveExample>;
  readonly mutate: MutationCaller;
  readonly evaluate: EvaluationCaller;
  readonly recentFailures?: ReadonlyArray<string>;
  readonly write?: boolean; // when true, write the winning variant back over the skill file
  readonly generations?: number;
}

export async function evolveSkill(args: EvolveSkillArgs): Promise<OptimizeRunSummary> {
  const baseline = readFileSync(args.skillPath, "utf8");
  const skillName = extractSkillName(baseline) ?? args.skillPath;
  const summary = await runOptimization({
    target: { kind: "skill", path: args.skillPath, name: skillName },
    baseline,
    examples: args.examples,
    mutate: args.mutate,
    evaluate: args.evaluate,
    recentFailures: args.recentFailures ?? [],
    strategy: args.recentFailures && args.recentFailures.length > 0 ? "reflective" : "random",
    generations: args.generations,
  });

  if (args.write && summary.bestScore > summary.baselineScore) {
    const archive = resolveWotannHomeSubdir("evolution-archive");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archiveName = `${stamp}-${skillName}.md`;
    writeFileSync(`${archive}/${archiveName}`, baseline, { encoding: "utf8", mode: 0o600 });
    writeFileSync(args.skillPath, summary.winnerContent, "utf8");
  }

  return summary;
}

function extractSkillName(content: string): string | null {
  const match = content.match(/^name:\s*(\S.*)$/m);
  return match?.[1]?.trim() ?? null;
}

/**
 * Build a synthetic evaluation set from a skill's frontmatter
 * description + triggers. Used when the user passes `--eval-source
 * synthetic`. Real-data eval comes from session DB queries; this is
 * the day-1 fallback so `wotann evolve` works on a fresh install.
 */
export function buildSyntheticExamples(skillContent: string): ReadonlyArray<EvolveExample> {
  const triggerLine = skillContent.match(/^triggers:\s*$([\s\S]*?)(?:^---|^[a-zA-Z])/m)?.[1] ?? "";
  const triggers = triggerLine
    .split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter((l) => l.length > 0);
  const description =
    skillContent.match(/^description:\s*(.+?)(?:\n[a-zA-Z])/ms)?.[1]?.trim() ?? "";

  if (triggers.length === 0) {
    return [
      {
        id: "synthetic-1",
        input: description.slice(0, 200),
        expectedOutcome: "Skill applied successfully without violations.",
      },
    ];
  }
  return triggers.slice(0, 5).map((t, i) => ({
    id: `synthetic-${i}`,
    input: t,
    expectedOutcome: description.slice(0, 200),
  }));
}
