/**
 * C23 — Session recap + auto-naming tests.
 */

import { describe, it, expect } from "vitest";
import {
  autoNameFromSnapshot,
  buildRecap,
  renderRecap,
  slugifyTitle,
} from "../../src/core/session-recap.js";
import type { SessionSnapshot } from "../../src/core/session-resume.js";
import { getTierModel } from "../_helpers/model-tier.js";

// PROVIDER-AGNOSTIC: snapshot's provider/model are unused by the recap
// logic — the test verifies title-naming, not model behavior.
const { provider: SNAP_PROVIDER, model: SNAP_MODEL } = getTierModel("strong");

function mkSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  const now = Date.now();
  return {
    version: 2,
    sessionId: "test-session",
    createdAt: now - 10_000,
    savedAt: now,
    provider: SNAP_PROVIDER,
    model: SNAP_MODEL,
    workingDir: "/tmp/wotann-harness",
    conversation: [],
    activeTasks: [],
    modeCycle: "build",
    contextTokensUsed: 0,
    totalCost: 0,
    trackedFiles: [],
    memoryContext: "",
    doomLoopHistory: [],
    frozenFiles: [],
    customData: {},
    ...overrides,
  };
}

describe("autoNameFromSnapshot", () => {
  it("prefers in-progress task description", () => {
    const snap = mkSnapshot({
      activeTasks: [
        {
          id: "t1",
          description: "Fix the authentication bug",
          status: "in-progress",
          startedAt: Date.now(),
          files: [],
        },
      ],
    });
    expect(autoNameFromSnapshot(snap)).toBe("the authentication bug");
  });

  it("falls back to first user message when no tasks", () => {
    const snap = mkSnapshot({
      conversation: [
        {
          role: "user",
          content: "Help me refactor the payment module",
          timestamp: Date.now(),
        },
      ],
    });
    // "Help" is imperative — stripped
    expect(autoNameFromSnapshot(snap)).toBe("me refactor the payment module");
  });

  it("falls back to workdir + date when no tasks or messages", () => {
    const snap = mkSnapshot({ workingDir: "/home/user/myproject" });
    const name = autoNameFromSnapshot(snap);
    expect(name).toMatch(/^myproject-\d{4}-\d{2}-\d{2}$/);
  });

  it("truncates long titles with ellipsis", () => {
    const long = "Implement the new " + "really long description ".repeat(10);
    const snap = mkSnapshot({
      activeTasks: [
        { id: "t", description: long, status: "in-progress", startedAt: Date.now(), files: [] },
      ],
    });
    const name = autoNameFromSnapshot(snap);
    expect(name.length).toBeLessThanOrEqual(61);
    expect(name.endsWith("…")).toBe(true);
  });

  it("normalises multi-line and collapsed whitespace", () => {
    const snap = mkSnapshot({
      conversation: [
        {
          role: "user",
          content: "please   \n\n  fix\tthis bug",
          timestamp: Date.now(),
        },
      ],
    });
    expect(autoNameFromSnapshot(snap)).toBe("fix this bug");
  });

  it("skips trivial (<=3 char) task descriptions", () => {
    const snap = mkSnapshot({
      activeTasks: [
        { id: "t1", description: "hi", status: "in-progress", startedAt: Date.now(), files: [] },
        {
          id: "t2",
          description: "Ship the Arrow indexer",
          status: "paused",
          startedAt: Date.now(),
          files: [],
        },
      ],
    });
    expect(autoNameFromSnapshot(snap)).toBe("the Arrow indexer");
  });
});

describe("slugifyTitle", () => {
  it("converts to kebab-case", () => {
    expect(slugifyTitle("Fix The Auth Bug!")).toBe("fix-the-auth-bug");
  });

  it("trims leading/trailing separators", () => {
    expect(slugifyTitle("  hello world  ")).toBe("hello-world");
  });

  it("caps at 60 chars", () => {
    expect(slugifyTitle("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("buildRecap", () => {
  it("extracts last assistant gist", () => {
    const snap = mkSnapshot({
      conversation: [
        { role: "user", content: "start", timestamp: 1 },
        {
          role: "assistant",
          content: "I added the Cognee builtin. Next up is the session recap module.",
          timestamp: 2,
        },
      ],
    });
    const recap = buildRecap(snap);
    expect(recap.lastAction).toBe("I added the Cognee builtin");
  });

  it("identifies next step from active task", () => {
    const snap = mkSnapshot({
      activeTasks: [
        {
          id: "t1",
          description: "Write the recap tests",
          status: "in-progress",
          startedAt: Date.now(),
          files: [],
        },
      ],
    });
    expect(buildRecap(snap).nextStep).toBe("Write the recap tests");
  });

  it("collects blockers from failed tasks", () => {
    const snap = mkSnapshot({
      activeTasks: [
        {
          id: "t1",
          description: "Apple Dev ID notarisation",
          status: "failed",
          startedAt: Date.now(),
          files: [],
        },
        {
          id: "t2",
          description: "Sentry DSN missing",
          status: "failed",
          startedAt: Date.now(),
          files: [],
        },
      ],
    });
    expect(buildRecap(snap).blockers).toEqual([
      "Apple Dev ID notarisation",
      "Sentry DSN missing",
    ]);
  });

  it("counts tracked files and reports cost", () => {
    const snap = mkSnapshot({
      trackedFiles: ["a.ts", "b.ts", "c.ts"],
      totalCost: 0.2345,
      contextTokensUsed: 17500,
    });
    const recap = buildRecap(snap);
    expect(recap.filesTouchedCount).toBe(3);
    expect(recap.costUsd).toBe(0.2345);
    expect(recap.contextTokens).toBe(17500);
  });

  it("returns non-negative age even if savedAt is in the future", () => {
    // Clock drift between save machine and resume machine
    const snap = mkSnapshot({ savedAt: Date.now() + 10_000 });
    expect(buildRecap(snap).ageMinutes).toBe(0);
  });
});

describe("renderRecap", () => {
  it("produces a compact markdown block", () => {
    const snap = mkSnapshot({
      activeTasks: [
        {
          id: "t1",
          description: "Write the recap tests",
          status: "in-progress",
          startedAt: Date.now(),
          files: [],
        },
      ],
      conversation: [
        { role: "user", content: "start", timestamp: 1 },
        {
          role: "assistant",
          content: "Added the Cognee builtin, now moving to recap.",
          timestamp: 2,
        },
      ],
      trackedFiles: ["a.ts", "b.ts"],
      totalCost: 0.1,
      contextTokensUsed: 5000,
    });
    const rendered = renderRecap(buildRecap(snap));
    expect(rendered).toContain("# Resumed:");
    expect(rendered).toContain("**Last action:**");
    expect(rendered).toContain("**Next step:** Write the recap tests");
    expect(rendered).toContain("2 files touched");
    expect(rendered.length).toBeLessThanOrEqual(500);
  });

  it("omits sections when data is missing", () => {
    const snap = mkSnapshot();
    const rendered = renderRecap(buildRecap(snap));
    expect(rendered).not.toContain("**Last action:**");
    expect(rendered).not.toContain("**Next step:**");
    expect(rendered).not.toContain("**Blocked:**");
    expect(rendered).not.toContain("files touched");
  });

  it("formats age as hours when > 60 minutes", () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const snap = mkSnapshot({ savedAt: twoHoursAgo });
    const rendered = renderRecap(buildRecap(snap));
    expect(rendered).toMatch(/\(2h ago\)/);
  });
});
