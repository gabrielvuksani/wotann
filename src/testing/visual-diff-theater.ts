/**
 * Visual Diff Theater -- rich diff viewing with per-hunk accept/reject.
 * Goes beyond text diff: structured hunk management with accept/reject
 * semantics and formatted text rendering.
 *
 * Creates diff sessions from file changes, breaks them into hunks,
 * allows granular accept/reject per hunk, then applies accepted changes.
 */

import { randomUUID } from "node:crypto";

// -- Types -------------------------------------------------------------------

export interface FileChange {
  readonly filePath: string;
  readonly oldContent: string;
  readonly newContent: string;
}

export interface DiffHunk {
  readonly id: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
  readonly status: "pending" | "accepted" | "rejected";
  readonly context: string;
}

export interface DiffSession {
  readonly id: string;
  readonly files: readonly string[];
  readonly hunks: readonly DiffHunk[];
  readonly createdAt: number;
  readonly status: "active" | "applied" | "discarded";
}

export interface ApplyResult {
  readonly sessionId: string;
  readonly appliedHunks: number;
  readonly rejectedHunks: number;
  readonly filesAffected: readonly string[];
  readonly resultContent: ReadonlyMap<string, string>;
}

// -- Implementation ----------------------------------------------------------

export class VisualDiffTheater {
  private readonly sessions: Map<string, MutableSession> = new Map();

  /**
   * Create a diff session from file changes.
   */
  createSession(changes: readonly FileChange[]): DiffSession {
    const sessionId = `ds_${randomUUID().slice(0, 8)}`;
    const allHunks: DiffHunk[] = [];

    for (const change of changes) {
      const hunks = computeHunks(change, sessionId);
      allHunks.push(...hunks);
    }

    const session: MutableSession = {
      id: sessionId,
      files: [...new Set(changes.map((c) => c.filePath))],
      hunks: allHunks,
      createdAt: Date.now(),
      status: "active",
      originalChanges: changes,
    };

    this.sessions.set(sessionId, session);

    return toReadonlySession(session);
  }

  /**
   * Get hunks for a specific file in a session.
   */
  getHunks(sessionId: string, filePath: string): readonly DiffHunk[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.hunks.filter((h) => h.filePath === filePath);
  }

  /**
   * Get all hunks in a session.
   */
  getAllHunks(sessionId: string): readonly DiffHunk[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return [...session.hunks];
  }

  /**
   * Accept a specific hunk.
   */
  acceptHunk(sessionId: string, hunkId: string): void {
    this.setHunkStatus(sessionId, hunkId, "accepted");
  }

  /**
   * Reject a specific hunk.
   */
  rejectHunk(sessionId: string, hunkId: string): void {
    this.setHunkStatus(sessionId, hunkId, "rejected");
  }

  /**
   * Accept all pending hunks in a session.
   */
  acceptAll(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.hunks = session.hunks.map((h) =>
      h.status === "pending" ? { ...h, status: "accepted" as const } : h,
    );
  }

  /**
   * Reject all pending hunks in a session.
   */
  rejectAll(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.hunks = session.hunks.map((h) =>
      h.status === "pending" ? { ...h, status: "rejected" as const } : h,
    );
  }

  /**
   * Apply accepted hunks and produce final content.
   */
  applyAccepted(sessionId: string): ApplyResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        sessionId,
        appliedHunks: 0,
        rejectedHunks: 0,
        filesAffected: [],
        resultContent: new Map(),
      };
    }

    const resultContent = new Map<string, string>();
    const filesAffected = new Set<string>();

    for (const change of session.originalChanges) {
      const fileHunks = session.hunks.filter((h) => h.filePath === change.filePath);
      const acceptedHunks = fileHunks.filter((h) => h.status === "accepted");

      if (acceptedHunks.length === 0) {
        // No accepted hunks -- keep original
        resultContent.set(change.filePath, change.oldContent);
        continue;
      }

      if (acceptedHunks.length === fileHunks.length) {
        // All accepted -- use new content entirely
        resultContent.set(change.filePath, change.newContent);
        filesAffected.add(change.filePath);
        continue;
      }

      // Partial accept -- reconstruct from hunks
      const merged = applyPartialHunks(change.oldContent, change.newContent, fileHunks);
      resultContent.set(change.filePath, merged);
      filesAffected.add(change.filePath);
    }

    const applied = session.hunks.filter((h) => h.status === "accepted").length;
    const rejected = session.hunks.filter((h) => h.status === "rejected").length;

    session.status = "applied";

    return {
      sessionId,
      appliedHunks: applied,
      rejectedHunks: rejected,
      filesAffected: [...filesAffected],
      resultContent,
    };
  }

  /**
   * Render a formatted text diff for a session.
   */
  renderDiff(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return "Session not found.";

    const lines: string[] = [`=== Diff Session ${sessionId} ===`, ""];

    for (const filePath of session.files) {
      const fileHunks = session.hunks.filter((h) => h.filePath === filePath);
      lines.push(`--- ${filePath}`);
      lines.push(`+++ ${filePath}`);
      lines.push("");

      for (const hunk of fileHunks) {
        const statusBadge = hunk.status === "accepted" ? "[ACCEPTED]"
          : hunk.status === "rejected" ? "[REJECTED]"
          : "[PENDING]";

        lines.push(`@@ lines ${hunk.startLine}-${hunk.endLine} ${statusBadge} @@`);

        for (const old of hunk.oldLines) {
          lines.push(`- ${old}`);
        }
        for (const nw of hunk.newLines) {
          lines.push(`+ ${nw}`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): DiffSession | null {
    const session = this.sessions.get(sessionId);
    return session ? toReadonlySession(session) : null;
  }

  /**
   * Discard a session.
   */
  discardSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "discarded";
    }
  }

  // -- Private ---------------------------------------------------------------

  private setHunkStatus(sessionId: string, hunkId: string, status: DiffHunk["status"]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.hunks = session.hunks.map((h) =>
      h.id === hunkId ? { ...h, status } : h,
    );
  }
}

// -- Internal mutable type ---------------------------------------------------

interface MutableSession {
  readonly id: string;
  readonly files: readonly string[];
  hunks: DiffHunk[];
  readonly createdAt: number;
  status: DiffSession["status"];
  readonly originalChanges: readonly FileChange[];
}

function toReadonlySession(s: MutableSession): DiffSession {
  return {
    id: s.id,
    files: s.files,
    hunks: [...s.hunks],
    createdAt: s.createdAt,
    status: s.status,
  };
}

// -- Diff computation --------------------------------------------------------

function computeHunks(change: FileChange, _sessionId: string): DiffHunk[] {
  const oldLines = change.oldContent.split("\n");
  const newLines = change.newContent.split("\n");

  const hunks: DiffHunk[] = [];
  let hunkStart: number | null = null;
  let hunkOld: string[] = [];
  let hunkNew: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine !== newLine) {
      if (hunkStart === null) hunkStart = i;
      if (oldLine !== undefined) hunkOld.push(oldLine);
      if (newLine !== undefined) hunkNew.push(newLine);
    } else {
      if (hunkStart !== null) {
        hunks.push({
          id: `hk_${randomUUID().slice(0, 8)}`,
          filePath: change.filePath,
          startLine: hunkStart + 1,
          endLine: i,
          oldLines: hunkOld,
          newLines: hunkNew,
          status: "pending",
          context: buildContext(oldLines, hunkStart, i),
        });
        hunkStart = null;
        hunkOld = [];
        hunkNew = [];
      }
    }
  }

  // Flush last hunk
  if (hunkStart !== null) {
    hunks.push({
      id: `hk_${randomUUID().slice(0, 8)}`,
      filePath: change.filePath,
      startLine: hunkStart + 1,
      endLine: maxLen,
      oldLines: hunkOld,
      newLines: hunkNew,
      status: "pending",
      context: buildContext(oldLines, hunkStart, maxLen),
    });
  }

  return hunks;
}

function buildContext(lines: readonly string[], start: number, end: number): string {
  const ctxStart = Math.max(0, start - 2);
  const ctxEnd = Math.min(lines.length, end + 2);
  return lines.slice(ctxStart, ctxEnd).join("\n");
}

function applyPartialHunks(
  oldContent: string,
  _newContent: string,
  hunks: readonly DiffHunk[],
): string {
  const oldLines = oldContent.split("\n");
  const result = [...oldLines];

  // Apply accepted hunks in reverse order to preserve line numbers
  const accepted = hunks
    .filter((h) => h.status === "accepted")
    .sort((a, b) => b.startLine - a.startLine);

  for (const hunk of accepted) {
    const startIdx = hunk.startLine - 1;
    const removeCount = hunk.oldLines.length;
    result.splice(startIdx, removeCount, ...hunk.newLines);
  }

  return result.join("\n");
}
