/**
 * V9 T14.1 — session-recap tests (returning-user variant of the
 * first-run flow).
 */

import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../src/session/fleet-view.js";
import {
  buildSessionRecap,
  formatSessionLine,
  formatTaskLine,
  pickRecapSessions,
  pickRecapTasks,
  type UnfinishedTask,
} from "../../src/cli/session-recap.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function session(
  id: string,
  name: string,
  lastStepAt: number,
  overrides?: Partial<SessionSummary>,
): SessionSummary {
  return {
    id,
    name,
    status: "active",
    surface: "cli",
    progressPct: null,
    lastStepAt,
    currentAction: null,
    creator: "u1",
    claimedBy: null,
    ...(overrides ?? {}),
  } as SessionSummary;
}

function task(id: string, summary: string, lastActivityAt: number): UnfinishedTask {
  return { id, summary, lastActivityAt };
}

const fixedClock = () => 1_700_000_000_000;

// ── pickRecapSessions ─────────────────────────────────────────────────────

describe("pickRecapSessions", () => {
  it("sorts by lastStepAt descending and caps at max", () => {
    const sessions: SessionSummary[] = [
      session("old", "old", 100),
      session("new", "new", 300),
      session("mid", "mid", 200),
    ];
    const picked = pickRecapSessions(sessions, 2);
    expect(picked.map((s) => s.id)).toEqual(["new", "mid"]);
  });

  it("filters out failed sessions", () => {
    const sessions: SessionSummary[] = [
      session("a", "alive", 200),
      session("b", "dead", 300, { status: "failed" as SessionSummary["status"] }),
    ];
    const picked = pickRecapSessions(sessions, 5);
    expect(picked.map((s) => s.id)).toEqual(["a"]);
  });

  it("returns empty when all sessions are failed", () => {
    const sessions: SessionSummary[] = [
      session("a", "a", 100, { status: "failed" as SessionSummary["status"] }),
    ];
    expect(pickRecapSessions(sessions, 3)).toHaveLength(0);
  });
});

// ── pickRecapTasks ────────────────────────────────────────────────────────

describe("pickRecapTasks", () => {
  it("sorts by lastActivityAt desc + caps at max", () => {
    const picked = pickRecapTasks(
      [task("a", "A", 100), task("b", "B", 300), task("c", "C", 200)],
      2,
    );
    expect(picked.map((t) => t.id)).toEqual(["b", "c"]);
  });
});

// ── formatSessionLine ─────────────────────────────────────────────────────

describe("formatSessionLine", () => {
  it("includes name + status", () => {
    const s = session("id", "deploy prod", 100);
    expect(formatSessionLine(s)).toContain("deploy prod");
    expect(formatSessionLine(s)).toContain("active");
  });

  it("includes progress percent when present", () => {
    const s = session("id", "x", 100, { progressPct: 42 });
    expect(formatSessionLine(s)).toContain("[42%]");
  });

  it("includes currentAction when present", () => {
    const s = session("id", "x", 100, { currentAction: "running tests" });
    expect(formatSessionLine(s)).toContain("running tests");
  });

  it("truncates long names", () => {
    const longName = "a".repeat(100);
    const s = session("id", longName, 100);
    const line = formatSessionLine(s);
    expect(line.length).toBeLessThan(100);
    expect(line).toContain("…");
  });
});

// ── formatTaskLine ────────────────────────────────────────────────────────

describe("formatTaskLine", () => {
  it("formats a basic task", () => {
    const t = task("t1", "finish feature X", 100);
    expect(formatTaskLine(t)).toContain("finish feature X");
  });

  it("includes surface hint when provided", () => {
    const t: UnfinishedTask = { ...task("t1", "X", 100), surface: "desktop" };
    expect(formatTaskLine(t)).toContain("@desktop");
  });

  it("truncates long summaries", () => {
    const t = task("t1", "a".repeat(200), 100);
    const line = formatTaskLine(t);
    expect(line).toContain("…");
  });
});

// ── buildSessionRecap ─────────────────────────────────────────────────────

describe("buildSessionRecap — empty + brief-absence paths", () => {
  it("returns an empty recap when lastSeenAt is less than minHoursAway", () => {
    const now = fixedClock();
    const recap = buildSessionRecap(
      {
        pastSessions: [session("a", "a", now - 1000)],
        unfinishedTasks: [task("t", "t", now - 1000)],
        lastSeenAt: now - 30 * 60_000, // 30 min ago
        now: () => now,
      },
      { minHoursAway: 1 },
    );
    expect(recap.hasContent).toBe(false);
    expect(recap.sessionCount).toBe(0);
    expect(recap.openTaskCount).toBe(0);
    expect(recap.lines).toEqual([{ kind: "empty", text: "" }]);
  });

  it("returns 'all caught up' when no sessions + no tasks", () => {
    const recap = buildSessionRecap({
      pastSessions: [],
      unfinishedTasks: [],
      now: fixedClock,
    });
    expect(recap.hasContent).toBe(false);
    expect(recap.title).toBe("All caught up.");
  });
});

describe("buildSessionRecap — content path", () => {
  const now = fixedClock();
  const input = {
    pastSessions: [
      session("s1", "finish deploy", now - 3 * 86_400_000),
      session("s2", "debug regressor", now - 1 * 86_400_000),
    ],
    unfinishedTasks: [
      task("t1", "fix auth regression", now - 2 * 86_400_000),
      task("t2", "ship v0.6", now - 86_400_000),
    ],
    lastSeenAt: now - 2 * 86_400_000, // 2 days ago
    now: () => now,
  };

  it("hasContent true when there are sessions or tasks", () => {
    const recap = buildSessionRecap(input);
    expect(recap.hasContent).toBe(true);
    expect(recap.sessionCount).toBeGreaterThan(0);
    expect(recap.openTaskCount).toBeGreaterThan(0);
  });

  it("title is Welcome back", () => {
    const recap = buildSessionRecap(input);
    expect(recap.title).toBe("Welcome back.");
  });

  it("includes a time-away line with a days-ago phrase", () => {
    const recap = buildSessionRecap(input);
    const away = recap.lines.find((l) => l.kind === "time-away");
    expect(away?.text).toMatch(/days? ago/);
  });

  it("lists recent sessions first (most-recent first)", () => {
    const recap = buildSessionRecap(input);
    const sessionLines = recap.lines.filter((l) => l.kind === "session");
    expect(sessionLines[0]?.text).toContain("debug regressor");
    expect(sessionLines[1]?.text).toContain("finish deploy");
  });

  it("lists open tasks with most-recent-first ordering", () => {
    const recap = buildSessionRecap(input);
    const taskLines = recap.lines.filter((l) => l.kind === "task");
    expect(taskLines[0]?.text).toContain("ship v0.6");
    expect(taskLines[1]?.text).toContain("fix auth regression");
  });

  it("caps sessions at maxSessions option", () => {
    const big = {
      ...input,
      pastSessions: Array.from({ length: 10 }, (_, i) =>
        session(`s${i}`, `task-${i}`, now - i * 1000),
      ),
    };
    const recap = buildSessionRecap(big, { maxSessions: 2 });
    expect(recap.sessionCount).toBe(2);
  });

  it("caps tasks at maxTasks option, but openTaskCount reflects full count in 'Open tasks (N)' copy", () => {
    const big = {
      ...input,
      unfinishedTasks: Array.from({ length: 10 }, (_, i) =>
        task(`t${i}`, `t-${i}`, now - i * 1000),
      ),
    };
    const recap = buildSessionRecap(big, { maxTasks: 3 });
    expect(recap.openTaskCount).toBe(3);
    const header = recap.lines.find(
      (l) => l.kind === "hint" && l.text.includes("Open tasks"),
    );
    expect(header?.text).toContain("Open tasks (10)");
  });

  it("ends with a helpful hint", () => {
    const recap = buildSessionRecap(input);
    const last = recap.lines[recap.lines.length - 1];
    expect(last?.kind).toBe("hint");
    expect(last?.text).toMatch(/resume|prompt/i);
  });
});

// ── Time-format edge cases (via recap) ────────────────────────────────────

describe("buildSessionRecap — time-away copy", () => {
  const base = fixedClock();
  function recapAt(agoMs: number) {
    return buildSessionRecap(
      {
        pastSessions: [session("s", "x", base - agoMs)],
        unfinishedTasks: [],
        lastSeenAt: base - agoMs,
        now: () => base,
      },
      { minHoursAway: 0 },
    );
  }

  it("renders minutes when <1h", () => {
    const recap = recapAt(30 * 60_000);
    const away = recap.lines.find((l) => l.kind === "time-away");
    expect(away?.text).toMatch(/minute/);
  });

  it("renders hours when <1d", () => {
    const recap = recapAt(5 * 3_600_000);
    const away = recap.lines.find((l) => l.kind === "time-away");
    expect(away?.text).toMatch(/hours?/);
  });

  it("renders days when <30d", () => {
    const recap = recapAt(5 * 86_400_000);
    const away = recap.lines.find((l) => l.kind === "time-away");
    expect(away?.text).toMatch(/days?/);
  });

  it("renders months for >30d", () => {
    const recap = recapAt(60 * 86_400_000);
    const away = recap.lines.find((l) => l.kind === "time-away");
    expect(away?.text).toMatch(/months?/);
  });
});
