/**
 * Mutator — generates candidate variants from a baseline.
 *
 * Two strategies:
 *
 *   "reflective" — read recent execution traces (failure modes,
 *   recurring corrections, abandoned tool sequences) and propose a
 *   targeted edit to the baseline that addresses one specific failure
 *   pattern. This is the GEPA-style mutation strategy.
 *
 *   "random" — generate variants by tweaking formatting or rephrasing
 *   without consulting traces. Used as a fallback when there are
 *   fewer than 3 trace examples to ground reflection in.
 *
 * The mutator does NOT call the LLM directly — it returns a list of
 * MutationProposal objects that the optimizer turns into candidates by
 * dispatching to whichever provider is configured. This keeps the
 * mutator unit-testable without mocking provider clients.
 */

import { Variant, MutationContext, EvolveTarget } from "./types.js";

export interface MutationProposal {
  readonly id: string;
  readonly diffHint: string;
  readonly rationale: string;
}

export function proposeMutations(
  ctx: MutationContext,
  count: number,
): ReadonlyArray<MutationProposal> {
  const proposals: MutationProposal[] = [];
  const seedRoot = `mut-${Date.now().toString(36)}`;

  if (ctx.strategy === "reflective" && ctx.recentFailures.length > 0) {
    for (let i = 0; i < count; i++) {
      const failure = ctx.recentFailures[i % ctx.recentFailures.length] ?? "(unknown failure)";
      proposals.push({
        id: `${seedRoot}-r${i}`,
        diffHint: `Address recurring failure: ${failure.slice(0, 200)}`,
        rationale: failure,
      });
    }
    return proposals;
  }

  // Random strategy: generic tweaks
  const tweaks: ReadonlyArray<readonly [string, string]> = [
    ["clarify-purpose", "Make the skill's first paragraph more specific about WHEN to use it"],
    ["add-counter-example", "Add a 'do NOT use when' counter-example to the description"],
    ["tighten-steps", "Tighten step descriptions — remove filler words, lead with verbs"],
    ["concrete-example", "Replace one abstract directive with a concrete code-style example"],
    ["explicit-stops", "Add explicit STOP markers where the agent should pause for the user"],
    ["error-path", "Document one common failure path and how to recover"],
    [
      "preconditions",
      "Add a 'preconditions checked' section listing what must be true before running",
    ],
    ["invariants", "Document one invariant that must hold across the skill's operations"],
  ];
  for (let i = 0; i < count; i++) {
    const tweak = tweaks[i % tweaks.length];
    if (!tweak) continue;
    const [hint, rationale] = tweak;
    proposals.push({
      id: `${seedRoot}-t${i}`,
      diffHint: hint,
      rationale,
    });
  }
  return proposals;
}

export function buildMutationPrompt(
  baseline: string,
  proposal: MutationProposal,
  target: EvolveTarget,
): string {
  const targetDesc =
    target.kind === "skill"
      ? `skill file "${target.name}" at ${target.path}`
      : target.kind === "prompt-section"
        ? `prompt section "${target.section}" in ${target.path}`
        : `tool description for "${target.toolName}"`;

  return [
    `You are evolving a ${targetDesc}. The current version is shown between <BASELINE> tags.`,
    "",
    `Apply this targeted improvement: ${proposal.diffHint}`,
    `Rationale: ${proposal.rationale}`,
    "",
    "Constraints:",
    "- Preserve the file's overall structure (frontmatter, headers).",
    "- Only output the FULL updated content, no commentary.",
    "- Do not introduce TODO/FIXME placeholders.",
    "- Stay under 15,000 bytes for skill files.",
    "",
    "<BASELINE>",
    baseline,
    "</BASELINE>",
  ].join("\n");
}

/**
 * Pure-function variant assembler used in tests. Takes a baseline +
 * the LLM's proposed text and produces a Variant struct.
 */
export function assembleVariant(args: {
  parentId: string | null;
  generation: number;
  proposal: MutationProposal;
  llmOutput: string;
}): Variant {
  return {
    id: args.proposal.id,
    content: args.llmOutput.trim(),
    parentId: args.parentId,
    generation: args.generation,
    mutationReasoning: args.proposal.rationale,
  };
}
