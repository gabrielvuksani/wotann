/**
 * Inline fuzzy matcher for the command palette.
 *
 * Scoring:
 *   - exact prefix match on title:    1000
 *   - exact substring in title:        500
 *   - exact substring in description:  250
 *   - subsequence match (VSCode-like): 10 per char matched, with bonuses
 *     for consecutive matches and word-boundary matches
 *   - no match:                          0
 */

export interface FuzzyMatchResult {
  readonly score: number;
  readonly matches: readonly number[];
}

const MIN_SCORE_SUBSEQUENCE = 10;
const CONSECUTIVE_BONUS = 15;
const WORD_BOUNDARY_BONUS = 25;
const PREFIX_MATCH = 1000;
const CONTAINS_TITLE = 500;
const CONTAINS_DESC = 250;

/** Compute a fuzzy match score. Returns 0 if no match. */
export function fuzzyScore(query: string, title: string, description = ""): number {
  if (!query) return 1; // empty query matches anything trivially
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  const d = description.toLowerCase();

  if (t.startsWith(q)) return PREFIX_MATCH + (title.length - query.length);
  if (t.includes(q)) return CONTAINS_TITLE;
  if (d.includes(q)) return CONTAINS_DESC;

  return subsequenceScore(q, t);
}

/**
 * VSCode-style subsequence match. Rewards consecutive char runs and
 * word-boundary hits. Returns 0 if not all query chars are found in order.
 */
function subsequenceScore(query: string, target: string): number {
  let score = 0;
  let qi = 0;
  let consecutive = 0;
  let prevWasSeparator = true;

  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    const qc = query[qi];
    const tc = target[ti];
    if (qc && tc && qc === tc) {
      let step = MIN_SCORE_SUBSEQUENCE;
      if (consecutive > 0) step += CONSECUTIVE_BONUS;
      if (prevWasSeparator) step += WORD_BOUNDARY_BONUS;
      score += step;
      consecutive += 1;
      qi += 1;
    } else {
      consecutive = 0;
    }
    prevWasSeparator = tc === " " || tc === "-" || tc === "_" || tc === ".";
  }

  // Must consume the full query
  return qi === query.length ? score : 0;
}
