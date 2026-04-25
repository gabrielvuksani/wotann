/**
 * SOP PRD writer — produces a Product Requirements Document (markdown).
 *
 * Stage 1 of 5. Owns:
 *   - Goal statement
 *   - User stories (3-7 items)
 *   - Acceptance criteria
 *   - Non-goals (explicit out-of-scope)
 *
 * Validation: the artifact must contain headed sections for each of the
 * required parts. Empty/malformed → invalid → orchestrator retries.
 *
 * QB #6: validation is strict; missing section = invalid, not "valid with warning."
 */

import type { SopArtifact, StageWriter, StageWriterInput, StageWriterResult } from "../types.js";

const PRD_SYSTEM_PROMPT = [
  "You are a senior product manager. Given a one-line product idea, produce a concise PRD.",
  "",
  "Output a markdown document with EXACTLY these top-level sections:",
  "  # Product Goal",
  "  # User Stories",
  "  # Acceptance Criteria",
  "  # Non-Goals",
  "",
  "Constraints:",
  "  - Goal: 1-2 sentences.",
  "  - User Stories: 3-7 bullets, each in 'As a __, I want __, so that __' form.",
  "  - Acceptance Criteria: testable bullets.",
  "  - Non-Goals: explicit out-of-scope items.",
  "Output ONLY the markdown document, no preface or commentary.",
].join("\n");

const REQUIRED_SECTIONS = [
  "# Product Goal",
  "# User Stories",
  "# Acceptance Criteria",
  "# Non-Goals",
] as const;

export const prdWriter: StageWriter = {
  stage: "prd",
  writeArtifact: async (input: StageWriterInput): Promise<StageWriterResult> => {
    const prompt = [PRD_SYSTEM_PROMPT, "", `Product Idea: ${input.idea}`].join("\n");

    let resp;
    try {
      resp = await input.model.query(prompt, { maxTokens: 2000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `prd model failure: ${msg}` };
    }

    const validation = validatePrd(resp.text);
    const artifact: SopArtifact = {
      stage: "prd",
      filename: "requirements.md",
      contentType: "markdown",
      content: resp.text.trim(),
      validation,
      tokensIn: resp.tokensIn,
      tokensOut: resp.tokensOut,
      createdAt: Date.now(),
    };
    return { ok: true, artifact };
  },
};

/**
 * Validate a PRD draft. Checks for all required sections.
 * Per-call, no shared state.
 */
export function validatePrd(text: string): SopArtifact["validation"] {
  const errors: string[] = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!text.includes(section)) {
      errors.push(`missing section: ${section}`);
    }
  }
  // User-story heuristic: at least 3 bullets in the User Stories section.
  const userStoriesIdx = text.indexOf("# User Stories");
  if (userStoriesIdx >= 0) {
    const after = text.slice(userStoriesIdx);
    const nextSectionIdx = after.indexOf("\n# ", 1);
    const block = nextSectionIdx > 0 ? after.slice(0, nextSectionIdx) : after;
    const bulletCount = (block.match(/^[\s]*[-*]\s/gm) ?? []).length;
    if (bulletCount < 3)
      errors.push(`User Stories must have at least 3 bullets (found ${bulletCount})`);
  }

  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}
