/**
 * Interactive Diff Preview Engine.
 *
 * Computes diffs between original and proposed file changes, then allows
 * hunk-by-hunk or file-level accept/reject decisions BEFORE changes are applied.
 *
 * This is the logic engine — the TUI component (DiffViewer.tsx) handles rendering.
 *
 * WORKFLOW:
 * 1. Agent proposes file edits
 * 2. DiffEngine computes unified diff between original and proposed
 * 3. User reviews hunks and accepts/rejects each one
 * 4. Only accepted hunks are applied to the filesystem
 * 5. Rejected hunks are logged for learning
 *
 * FEATURES:
 * - Hunk-level granularity (accept individual changes)
 * - File-level batch accept/reject
 * - Conflict detection (file changed since proposal)
 * - Dry-run mode (preview without applying)
 * - Undo support via shadow git integration
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

// ── Types ────────────────────────────────────────────────

export interface DiffHunk {
  readonly id: string;
  readonly startLineOriginal: number;
  readonly endLineOriginal: number;
  readonly startLineProposed: number;
  readonly endLineProposed: number;
  readonly originalLines: readonly string[];
  readonly proposedLines: readonly string[];
  readonly contextBefore: readonly string[];
  readonly contextAfter: readonly string[];
}

export type HunkDecision = "accept" | "reject" | "pending";

export interface HunkReview {
  readonly hunkId: string;
  readonly decision: HunkDecision;
  readonly reason?: string;
}

export interface FileDiffProposal {
  readonly filePath: string;
  readonly originalContent: string;
  readonly proposedContent: string;
  readonly originalHash: string;
  readonly hunks: readonly DiffHunk[];
  readonly createdAt: number;
  readonly description: string;
}

export interface DiffApplyResult {
  readonly filePath: string;
  readonly applied: boolean;
  readonly hunksAccepted: number;
  readonly hunksRejected: number;
  readonly totalHunks: number;
  readonly conflictDetected: boolean;
  readonly resultContent: string;
  readonly error?: string;
}

export interface DiffSession {
  readonly id: string;
  readonly proposals: readonly FileDiffProposal[];
  readonly reviews: ReadonlyMap<string, HunkReview>;
  readonly createdAt: number;
}

// ── Diff Computation ─────────────────────────────────────

/**
 * Compute the diff hunks between original and proposed content.
 * Uses a simple LCS-based diff algorithm.
 */
export function computeDiff(
  originalContent: string,
  proposedContent: string,
  contextLines: number = 3,
): readonly DiffHunk[] {
  const originalLines = originalContent.split("\n");
  const proposedLines = proposedContent.split("\n");

  // Find changed regions using simple line comparison
  const changes = findChangedRegions(originalLines, proposedLines);

  // Convert to hunks with context
  return changes.map((change, idx) => {
    const contextBefore = originalLines.slice(
      Math.max(0, change.originalStart - contextLines),
      change.originalStart,
    );
    const contextAfter = originalLines.slice(
      change.originalEnd,
      Math.min(originalLines.length, change.originalEnd + contextLines),
    );

    return {
      id: `hunk-${idx}`,
      startLineOriginal: change.originalStart + 1, // 1-indexed
      endLineOriginal: change.originalEnd + 1,
      startLineProposed: change.proposedStart + 1,
      endLineProposed: change.proposedEnd + 1,
      originalLines: originalLines.slice(change.originalStart, change.originalEnd),
      proposedLines: proposedLines.slice(change.proposedStart, change.proposedEnd),
      contextBefore,
      contextAfter,
    };
  });
}

interface ChangedRegion {
  readonly originalStart: number;
  readonly originalEnd: number;
  readonly proposedStart: number;
  readonly proposedEnd: number;
}

function findChangedRegions(
  original: readonly string[],
  proposed: readonly string[],
): readonly ChangedRegion[] {
  const regions: ChangedRegion[] = [];
  let i = 0;
  let j = 0;

  while (i < original.length || j < proposed.length) {
    // Skip matching lines
    if (i < original.length && j < proposed.length && original[i] === proposed[j]) {
      i++;
      j++;
      continue;
    }

    // Found a difference — find its extent
    const origStart = i;
    const propStart = j;

    // Look ahead for the next matching line
    const { origEnd, propEnd } = findNextMatch(original, proposed, i, j);
    i = origEnd;
    j = propEnd;

    // Only record if there's actually a change
    if (origStart !== origEnd || propStart !== propEnd) {
      regions.push({
        originalStart: origStart,
        originalEnd: origEnd,
        proposedStart: propStart,
        proposedEnd: propEnd,
      });
    }
  }

  return regions;
}

function findNextMatch(
  original: readonly string[],
  proposed: readonly string[],
  origStart: number,
  propStart: number,
): { origEnd: number; propEnd: number } {
  // Search for the next line that matches in both arrays
  const lookahead = 50; // max lines to look ahead

  for (let offset = 1; offset <= lookahead; offset++) {
    // Check if original[origStart + offset] matches something in proposed
    for (let j = propStart; j <= Math.min(propStart + offset, proposed.length - 1); j++) {
      if (origStart + offset < original.length && original[origStart + offset] === proposed[j]) {
        return { origEnd: origStart + offset, propEnd: j };
      }
    }
    // Check if proposed[propStart + offset] matches something in original
    for (let i = origStart; i <= Math.min(origStart + offset, original.length - 1); i++) {
      if (propStart + offset < proposed.length && original[i] === proposed[propStart + offset]) {
        return { origEnd: i, propEnd: propStart + offset };
      }
    }
  }

  // No match found — rest of both files differ
  return { origEnd: original.length, propEnd: proposed.length };
}

// ── Proposal Creation ────────────────────────────────────

/**
 * Create a diff proposal for a file change.
 * Reads the current file content and computes hunks against proposed content.
 */
export function createProposal(
  filePath: string,
  proposedContent: string,
  description: string,
): FileDiffProposal {
  const originalContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";

  const originalHash = createHash("sha256").update(originalContent).digest("hex");
  const hunks = computeDiff(originalContent, proposedContent);

  return {
    filePath,
    originalContent,
    proposedContent,
    originalHash,
    hunks,
    createdAt: Date.now(),
    description,
  };
}

/**
 * Create a proposal from in-memory content (no filesystem access).
 */
export function createProposalFromContent(
  filePath: string,
  originalContent: string,
  proposedContent: string,
  description: string,
): FileDiffProposal {
  const originalHash = createHash("sha256").update(originalContent).digest("hex");
  const hunks = computeDiff(originalContent, proposedContent);

  return {
    filePath,
    originalContent,
    proposedContent,
    originalHash,
    hunks,
    createdAt: Date.now(),
    description,
  };
}

// ── Conflict Detection ───────────────────────────────────

/**
 * Check if the file has been modified since the proposal was created.
 */
export function detectConflict(proposal: FileDiffProposal): boolean {
  if (!existsSync(proposal.filePath)) {
    // File was deleted — that's a conflict if we expected it to exist
    return proposal.originalContent.length > 0;
  }

  const currentContent = readFileSync(proposal.filePath, "utf-8");
  const currentHash = createHash("sha256").update(currentContent).digest("hex");
  return currentHash !== proposal.originalHash;
}

// ── Hunk Application ─────────────────────────────────────

/**
 * Apply accepted hunks to produce the final content.
 * Only hunks marked as "accept" are applied; rejected hunks keep original content.
 */
export function applyReviews(
  proposal: FileDiffProposal,
  reviews: ReadonlyMap<string, HunkReview>,
): string {
  const originalLines = proposal.originalContent.split("\n");
  const proposedLines = proposal.proposedContent.split("\n");

  // If all hunks are accepted, return proposed content directly
  const allAccepted = proposal.hunks.every((h) => reviews.get(h.id)?.decision === "accept");
  if (allAccepted) return proposal.proposedContent;

  // If all hunks are rejected, return original content
  const allRejected = proposal.hunks.every((h) => reviews.get(h.id)?.decision === "reject");
  if (allRejected) return proposal.originalContent;

  // Partial application — build result line by line
  const result: string[] = [];
  let origIdx = 0;

  for (const hunk of proposal.hunks) {
    const hunkOrigStart = hunk.startLineOriginal - 1; // 0-indexed
    const hunkOrigEnd = hunk.endLineOriginal - 1;
    const review = reviews.get(hunk.id);

    // Add unchanged lines before this hunk
    while (origIdx < hunkOrigStart && origIdx < originalLines.length) {
      result.push(originalLines[origIdx]!);
      origIdx++;
    }

    if (review?.decision === "accept") {
      // Add proposed lines
      result.push(...hunk.proposedLines);
    } else {
      // Keep original lines
      result.push(...hunk.originalLines);
    }

    origIdx = hunkOrigEnd;
  }

  // Add remaining unchanged lines
  while (origIdx < originalLines.length) {
    result.push(originalLines[origIdx]!);
    origIdx++;
  }

  return result.join("\n");
}

// ── Apply to Filesystem ──────────────────────────────────

/**
 * Apply reviewed diff to the filesystem.
 * Checks for conflicts and only applies accepted hunks.
 */
export function applyDiff(
  proposal: FileDiffProposal,
  reviews: ReadonlyMap<string, HunkReview>,
  dryRun: boolean = false,
): DiffApplyResult {
  // Conflict check — only meaningful when we're about to write.
  // In dry-run mode the caller is just asking what *would* happen;
  // disk state is irrelevant.
  const conflictDetected = !dryRun && existsSync(proposal.filePath) && detectConflict(proposal);
  if (conflictDetected) {
    return {
      filePath: proposal.filePath,
      applied: false,
      hunksAccepted: 0,
      hunksRejected: 0,
      totalHunks: proposal.hunks.length,
      conflictDetected: true,
      resultContent: proposal.originalContent,
      error: "File has been modified since proposal was created",
    };
  }

  const hunksAccepted = proposal.hunks.filter(
    (h) => reviews.get(h.id)?.decision === "accept",
  ).length;
  const hunksRejected = proposal.hunks.filter(
    (h) => reviews.get(h.id)?.decision === "reject",
  ).length;

  const resultContent = applyReviews(proposal, reviews);

  if (!dryRun && hunksAccepted > 0) {
    writeFileSync(proposal.filePath, resultContent, "utf-8");
  }

  return {
    filePath: proposal.filePath,
    applied: !dryRun && hunksAccepted > 0,
    hunksAccepted,
    hunksRejected,
    totalHunks: proposal.hunks.length,
    conflictDetected: false,
    resultContent,
  };
}

// ── Batch Operations ─────────────────────────────────────

/**
 * Accept all hunks in a proposal.
 */
export function acceptAll(proposal: FileDiffProposal): ReadonlyMap<string, HunkReview> {
  const reviews = new Map<string, HunkReview>();
  for (const hunk of proposal.hunks) {
    reviews.set(hunk.id, { hunkId: hunk.id, decision: "accept" });
  }
  return reviews;
}

/**
 * Reject all hunks in a proposal.
 */
export function rejectAll(proposal: FileDiffProposal): ReadonlyMap<string, HunkReview> {
  const reviews = new Map<string, HunkReview>();
  for (const hunk of proposal.hunks) {
    reviews.set(hunk.id, { hunkId: hunk.id, decision: "reject" });
  }
  return reviews;
}

/**
 * Get a summary of diff statistics for a proposal.
 */
export function getDiffStats(proposal: FileDiffProposal): {
  readonly totalHunks: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly filesChanged: number;
} {
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const hunk of proposal.hunks) {
    linesAdded += hunk.proposedLines.length;
    linesRemoved += hunk.originalLines.length;
  }

  return {
    totalHunks: proposal.hunks.length,
    linesAdded,
    linesRemoved,
    filesChanged: 1,
  };
}
