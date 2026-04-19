/**
 * Sandboxed multi-patch voting — Phase 4 Sprint B2 item 20.
 *
 * Single-sample patch scoring has high variance: one temperature sample
 * might pass 47/50 tests, another might pass 43/50 on the same task.
 * Multi-patch voting runs N candidate patches (typically 3) in isolated
 * sandboxes, scores each via patch-scorer, then picks the winner by a
 * composite of test-pass count, regression count, and diff size.
 *
 * Quorum rules matter — if all 3 patches regress (introduce newlyFailing
 * tests), we should return "abstain" rather than the least-bad patch.
 * Benchmarks where no viable patch exists are better scored as 0 than
 * as a guess.
 *
 * This module runs patches SERIALLY (via patch-scorer) for correctness —
 * shadow-git restore between runs guarantees isolation. Parallel runs
 * would race on the working tree and corrupt each other.
 *
 * Integrates with patch-scorer: every patch goes through scorePatch
 * so the voting layer never touches disk directly.
 */

import {
  scorePatch,
  type PatchDescriptor,
  type PatchScore,
  type PatchScorerOptions,
} from "./patch-scorer.js";

// ── Types ──────────────────────────────────────────────

export interface VoteResult {
  /** Index of the winning patch (into the input array), or null on abstain. */
  readonly winnerIndex: number | null;
  /**
   * Why we picked (or abstained). Human-readable.
   */
  readonly reason: string;
  /** Per-patch scored results (same order as input). */
  readonly scores: readonly PatchScore[];
  /** Test IDs that ALL patches agree pass. */
  readonly consensusPassing: readonly string[];
  /** Test IDs that ALL patches agree fail. */
  readonly consensusFailing: readonly string[];
  /** Test IDs where patches disagree (at least one passes, at least one fails). */
  readonly contentiousTests: readonly string[];
  /** Abstain triggered? True when no patch meets the quorum threshold. */
  readonly abstained: boolean;
}

export interface VotingOptions {
  /**
   * Minimum composite score any patch must reach to be eligible. Patches
   * below this are never picked. Default 0 — meaning at least break-even
   * (no net regressions).
   */
  readonly minCompositeScore?: number;
  /**
   * If all patches have compositeScore <= this, abstain. Default 0.
   * Set to -Infinity to NEVER abstain (always pick the least-bad).
   */
  readonly abstainThreshold?: number;
  /**
   * When composite scores tie, prefer smaller diffs (fewer files, fewer
   * bytes). Default true. Set false to keep insertion order as tiebreaker.
   */
  readonly preferSmaller?: boolean;
}

// ── Voter ──────────────────────────────────────────────

/**
 * Run N candidate patches through isolated scoring and pick the winner
 * by compositeScore. Abstains when no patch meets the threshold.
 *
 * Patches run SERIALLY via patch-scorer's ShadowGit-backed isolation.
 */
export async function voteOnPatches(
  patches: readonly PatchDescriptor[],
  scorerOptions: PatchScorerOptions,
  votingOptions: VotingOptions = {},
): Promise<VoteResult> {
  const minCompositeScore = votingOptions.minCompositeScore ?? 0;
  const abstainThreshold = votingOptions.abstainThreshold ?? 0;
  const preferSmaller = votingOptions.preferSmaller ?? true;

  if (patches.length === 0) {
    return {
      winnerIndex: null,
      reason: "no patches to vote on",
      scores: [],
      consensusPassing: [],
      consensusFailing: [],
      contentiousTests: [],
      abstained: true,
    };
  }

  // 1. Score each patch (serially — isolation via shadow-git)
  const scores: PatchScore[] = [];
  for (const patch of patches) {
    const score = await scorePatch(patch, scorerOptions);
    scores.push(score);
  }

  // 2. Compute consensus + contentious tests
  const consensusPassing: string[] = [];
  const consensusFailing: string[] = [];
  const contentiousTests: string[] = [];
  const allTestIds = new Set<string>();
  for (const s of scores) {
    for (const id of s.after.passingTestIds) allTestIds.add(id);
    for (const id of s.after.failingTestIds) allTestIds.add(id);
  }
  for (const id of allTestIds) {
    let passCount = 0;
    let failCount = 0;
    for (const s of scores) {
      if (s.after.passingTestIds.has(id)) passCount++;
      if (s.after.failingTestIds.has(id)) failCount++;
    }
    if (passCount === scores.length) consensusPassing.push(id);
    else if (failCount === scores.length) consensusFailing.push(id);
    else if (passCount > 0 && failCount > 0) contentiousTests.push(id);
  }
  consensusPassing.sort();
  consensusFailing.sort();
  contentiousTests.sort();

  // 3. Pick winner
  const eligible = scores
    .map((score, index) => ({ index, score }))
    .filter(({ score }) => score.compositeScore >= minCompositeScore);

  if (eligible.length === 0) {
    return {
      winnerIndex: null,
      reason: `no patch met minCompositeScore=${minCompositeScore} (best was ${Math.max(...scores.map((s) => s.compositeScore))})`,
      scores,
      consensusPassing,
      consensusFailing,
      contentiousTests,
      abstained: true,
    };
  }

  eligible.sort((a, b) => {
    if (a.score.compositeScore !== b.score.compositeScore) {
      return b.score.compositeScore - a.score.compositeScore;
    }
    if (!preferSmaller) return a.index - b.index;
    const patchA = patches[a.index];
    const patchB = patches[b.index];
    const aFiles = patchA?.files.length ?? 0;
    const bFiles = patchB?.files.length ?? 0;
    if (aFiles !== bFiles) return aFiles - bFiles;
    const aBytes = (patchA?.files ?? []).reduce((s, f) => s + f.newContent.length, 0);
    const bBytes = (patchB?.files ?? []).reduce((s, f) => s + f.newContent.length, 0);
    return aBytes - bBytes;
  });

  const bestCandidate = eligible[0];
  if (!bestCandidate) {
    // Unreachable given the length check above, but type-narrows safely.
    return {
      winnerIndex: null,
      reason: "no eligible candidate after sort",
      scores,
      consensusPassing,
      consensusFailing,
      contentiousTests,
      abstained: true,
    };
  }

  // 4. Abstain check — if even the best doesn't beat the abstainThreshold
  if (bestCandidate.score.compositeScore <= abstainThreshold) {
    return {
      winnerIndex: null,
      reason: `best compositeScore=${bestCandidate.score.compositeScore} <= abstainThreshold=${abstainThreshold}`,
      scores,
      consensusPassing,
      consensusFailing,
      contentiousTests,
      abstained: true,
    };
  }

  return {
    winnerIndex: bestCandidate.index,
    reason: `compositeScore=${bestCandidate.score.compositeScore}, newlyPassing=${bestCandidate.score.newlyPassing.length}, newlyFailing=${bestCandidate.score.newlyFailing.length}`,
    scores,
    consensusPassing,
    consensusFailing,
    contentiousTests,
    abstained: false,
  };
}

/**
 * Summarise a vote result as human-readable text. Good for CLI output
 * and for feeding back to the model ("here's why we picked patch 2…").
 */
export function summariseVote(result: VoteResult): string {
  const lines: string[] = [];
  lines.push(
    `Voting result: ${result.abstained ? "ABSTAIN" : `winner = patch #${result.winnerIndex}`}`,
  );
  lines.push(`Reason: ${result.reason}`);
  lines.push(
    `Per-patch compositeScore: [${result.scores.map((s) => s.compositeScore).join(", ")}]`,
  );
  lines.push(`Consensus passing: ${result.consensusPassing.length} test(s)`);
  lines.push(`Consensus failing: ${result.consensusFailing.length} test(s)`);
  lines.push(`Contentious: ${result.contentiousTests.length} test(s)`);
  if (result.contentiousTests.length > 0) {
    lines.push(
      `  → ${result.contentiousTests.slice(0, 5).join(", ")}${result.contentiousTests.length > 5 ? ", …" : ""}`,
    );
  }
  return lines.join("\n");
}
