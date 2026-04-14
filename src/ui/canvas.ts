/**
 * Canvas Mode — real-time collaborative document editing.
 *
 * Inspired by OpenClaw Canvas and Microsoft Copilot Canvas.
 * Creates a split-view editing experience where:
 * - Agent proposes changes as diff hunks
 * - User accepts/rejects per hunk
 * - Live preview for web content
 * - Undo stack per hunk
 *
 * ARCHITECTURE:
 * Canvas is a middleware layer between the agent and the file system.
 * Instead of directly writing files, the agent proposes Hunks.
 * Each Hunk is a unified diff that the user can accept or reject.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type HunkStatus = "pending" | "accepted" | "rejected" | "modified";

export interface CanvasHunk {
  readonly id: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly originalContent: string;
  readonly proposedContent: string;
  readonly explanation: string;
  readonly status: HunkStatus;
  readonly createdAt: number;
}

export interface CanvasSession {
  readonly id: string;
  readonly filePath: string;
  readonly originalContent: string;
  readonly currentContent: string;
  readonly hunks: readonly CanvasHunk[];
  readonly createdAt: number;
  readonly lastModified: number;
}

export interface CanvasStats {
  readonly totalHunks: number;
  readonly pendingHunks: number;
  readonly acceptedHunks: number;
  readonly rejectedHunks: number;
  readonly modifiedHunks: number;
}

export class CanvasEditor {
  private sessions: Map<string, CanvasSession> = new Map();

  /**
   * Open a file in canvas mode.
   */
  openCanvas(filePath: string): CanvasSession {
    const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
    const session: CanvasSession = {
      id: randomUUID(),
      filePath,
      originalContent: content,
      currentContent: content,
      hunks: [],
      createdAt: Date.now(),
      lastModified: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Propose a change hunk.
   */
  proposeHunk(
    sessionId: string,
    startLine: number,
    endLine: number,
    proposedContent: string,
    explanation: string,
  ): CanvasHunk | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const lines = session.currentContent.split("\n");
    const originalContent = lines.slice(startLine - 1, endLine).join("\n");

    const hunk: CanvasHunk = {
      id: randomUUID(),
      filePath: session.filePath,
      startLine,
      endLine,
      originalContent,
      proposedContent,
      explanation,
      status: "pending",
      createdAt: Date.now(),
    };

    this.sessions.set(sessionId, {
      ...session,
      hunks: [...session.hunks, hunk],
      lastModified: Date.now(),
    });

    return hunk;
  }

  /**
   * Accept a hunk and apply it to the file content.
   */
  acceptHunk(sessionId: string, hunkId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const hunkIndex = session.hunks.findIndex((h) => h.id === hunkId);
    if (hunkIndex === -1) return false;

    const hunk = session.hunks[hunkIndex]!;
    if (hunk.status !== "pending") return false;

    // Apply the change
    const lines = session.currentContent.split("\n");
    const before = lines.slice(0, hunk.startLine - 1);
    const after = lines.slice(hunk.endLine);
    const newContent = [...before, ...hunk.proposedContent.split("\n"), ...after].join("\n");

    const updatedHunk = { ...hunk, status: "accepted" as const };
    const updatedHunks = session.hunks.map((h, i) => i === hunkIndex ? updatedHunk : h);

    this.sessions.set(sessionId, {
      ...session,
      currentContent: newContent,
      hunks: updatedHunks,
      lastModified: Date.now(),
    });

    return true;
  }

  /**
   * Reject a hunk.
   */
  rejectHunk(sessionId: string, hunkId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const hunkIndex = session.hunks.findIndex((h) => h.id === hunkId);
    if (hunkIndex === -1) return false;

    const updatedHunk = { ...session.hunks[hunkIndex]!, status: "rejected" as const };
    const updatedHunks = session.hunks.map((h, i) => i === hunkIndex ? updatedHunk : h);

    this.sessions.set(sessionId, {
      ...session,
      hunks: updatedHunks,
      lastModified: Date.now(),
    });

    return true;
  }

  /**
   * Save the canvas to disk (apply all accepted hunks).
   */
  saveCanvas(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    writeFileSync(session.filePath, session.currentContent, "utf-8");
    return true;
  }

  /**
   * Get a unified diff of all accepted changes.
   */
  getDiff(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return "";

    const originalLines = session.originalContent.split("\n");
    const currentLines = session.currentContent.split("\n");
    const diff: string[] = [`--- a/${session.filePath}`, `+++ b/${session.filePath}`];

    const maxLen = Math.max(originalLines.length, currentLines.length);
    for (let i = 0; i < maxLen; i++) {
      const orig = originalLines[i];
      const curr = currentLines[i];
      if (orig === curr) {
        diff.push(` ${orig ?? ""}`);
      } else {
        if (orig !== undefined) diff.push(`-${orig}`);
        if (curr !== undefined) diff.push(`+${curr}`);
      }
    }

    return diff.join("\n");
  }

  /**
   * Undo the last accepted hunk.
   */
  undoLastHunk(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Find the last accepted hunk
    const lastAccepted = [...session.hunks].reverse().find((h) => h.status === "accepted");
    if (!lastAccepted) return false;

    // Revert the content change
    const lines = session.currentContent.split("\n");
    const before = lines.slice(0, lastAccepted.startLine - 1);
    const after = lines.slice(lastAccepted.startLine - 1 + lastAccepted.proposedContent.split("\n").length);
    const revertedContent = [...before, ...lastAccepted.originalContent.split("\n"), ...after].join("\n");

    const updatedHunks = session.hunks.map((h) =>
      h.id === lastAccepted.id ? { ...h, status: "pending" as const } : h,
    );

    this.sessions.set(sessionId, {
      ...session,
      currentContent: revertedContent,
      hunks: updatedHunks,
      lastModified: Date.now(),
    });

    return true;
  }

  /**
   * Accept all pending hunks at once.
   */
  acceptAll(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;

    let accepted = 0;
    for (const hunk of session.hunks) {
      if (hunk.status === "pending") {
        if (this.acceptHunk(sessionId, hunk.id)) accepted++;
      }
    }
    return accepted;
  }

  /**
   * Get stats for a canvas session.
   */
  getStats(sessionId: string): CanvasStats | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      totalHunks: session.hunks.length,
      pendingHunks: session.hunks.filter((h) => h.status === "pending").length,
      acceptedHunks: session.hunks.filter((h) => h.status === "accepted").length,
      rejectedHunks: session.hunks.filter((h) => h.status === "rejected").length,
      modifiedHunks: session.hunks.filter((h) => h.status === "modified").length,
    };
  }

  getSession(sessionId: string): CanvasSession | undefined {
    return this.sessions.get(sessionId);
  }

  closeCanvas(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
