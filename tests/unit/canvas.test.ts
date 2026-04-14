import { describe, it, expect } from "vitest";
import { CanvasEditor } from "../../src/ui/canvas.js";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("Canvas Editor", () => {
  function createTempFile(content: string): string {
    const dir = join(tmpdir(), "wotann-test-canvas-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "test.ts");
    writeFileSync(filePath, content);
    return filePath;
  }

  it("opens a canvas session for a file", () => {
    const filePath = createTempFile("line 1\nline 2\nline 3\n");
    const editor = new CanvasEditor();
    const session = editor.openCanvas(filePath);

    expect(session).toBeDefined();
    expect(session.filePath).toBe(filePath);
    expect(session.originalContent).toBe("line 1\nline 2\nline 3\n");
    expect(session.hunks).toHaveLength(0);
  });

  it("proposes a hunk", () => {
    const filePath = createTempFile("line 1\nline 2\nline 3\n");
    const editor = new CanvasEditor();
    const session = editor.openCanvas(filePath);

    const hunk = editor.proposeHunk(session.id, 2, 2, "LINE TWO", "Capitalize line 2");
    expect(hunk).toBeDefined();
    expect(hunk!.status).toBe("pending");
    expect(hunk!.originalContent).toBe("line 2");
    expect(hunk!.proposedContent).toBe("LINE TWO");
  });

  it("accepts a hunk and applies it", () => {
    const filePath = createTempFile("line 1\nline 2\nline 3\n");
    const editor = new CanvasEditor();
    const session = editor.openCanvas(filePath);

    const hunk = editor.proposeHunk(session.id, 2, 2, "LINE TWO", "Capitalize");
    const accepted = editor.acceptHunk(session.id, hunk!.id);
    expect(accepted).toBe(true);

    const updated = editor.getSession(session.id);
    expect(updated!.currentContent).toContain("LINE TWO");
    expect(updated!.currentContent).not.toContain("line 2");
  });

  it("rejects a hunk", () => {
    const filePath = createTempFile("line 1\nline 2\nline 3\n");
    const editor = new CanvasEditor();
    const session = editor.openCanvas(filePath);

    const hunk = editor.proposeHunk(session.id, 2, 2, "LINE TWO", "Capitalize");
    const rejected = editor.rejectHunk(session.id, hunk!.id);
    expect(rejected).toBe(true);

    const updated = editor.getSession(session.id);
    expect(updated!.currentContent).toContain("line 2"); // unchanged
  });

  it("undo reverts the last accepted hunk", () => {
    const filePath = createTempFile("line 1\nline 2\nline 3\n");
    const editor = new CanvasEditor();
    const session = editor.openCanvas(filePath);

    const hunk = editor.proposeHunk(session.id, 2, 2, "LINE TWO", "Capitalize");
    editor.acceptHunk(session.id, hunk!.id);
    editor.undoLastHunk(session.id);

    const restored = editor.getSession(session.id);
    expect(restored!.currentContent).toContain("line 2"); // reverted
  });

  it("getStats returns correct counts", () => {
    const filePath = createTempFile("a\nb\nc\nd\n");
    const editor = new CanvasEditor();
    const session = editor.openCanvas(filePath);

    const h1 = editor.proposeHunk(session.id, 1, 1, "A", "cap");
    const h2 = editor.proposeHunk(session.id, 2, 2, "B", "cap");
    const h3 = editor.proposeHunk(session.id, 3, 3, "C", "cap");

    editor.acceptHunk(session.id, h1!.id);
    editor.rejectHunk(session.id, h2!.id);

    const stats = editor.getStats(session.id);
    expect(stats!.totalHunks).toBe(3);
    expect(stats!.acceptedHunks).toBe(1);
    expect(stats!.rejectedHunks).toBe(1);
    expect(stats!.pendingHunks).toBe(1);
  });

  it("acceptAll accepts all pending hunks", () => {
    const filePath = createTempFile("a\nb\nc\n");
    const editor = new CanvasEditor();
    const session = editor.openCanvas(filePath);

    editor.proposeHunk(session.id, 1, 1, "A", "cap");
    editor.proposeHunk(session.id, 2, 2, "B", "cap");

    const count = editor.acceptAll(session.id);
    expect(count).toBe(2);
  });

  it("closeCanvas removes the session", () => {
    const filePath = createTempFile("test\n");
    const editor = new CanvasEditor();
    const session = editor.openCanvas(filePath);
    editor.closeCanvas(session.id);
    expect(editor.getSession(session.id)).toBeUndefined();
  });
});
