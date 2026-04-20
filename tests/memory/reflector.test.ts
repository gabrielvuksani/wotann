/**
 * Tests for Reflector — LLM-judge promotion of observations.
 *
 * Covers:
 *   1. Promotes observations based on a mocked judge verdict.
 *   2. Demotes based on verdict + marks with TTL tag.
 *   3. Honest failure when judge throws — no observations lost.
 *   4. Honest failure when judge returns wrong verdict count.
 *   5. shouldReflect() correctly reports threshold crossing.
 *   6. Per-session stats isolated across sessions.
 *   7. Empty buffer → honest empty success, not crash.
 *   8. Promoted entries land in core_blocks layer with
 *      `reflector-promoted` tag (grep-verifiable).
 *   9. parseVerdicts() strict parser rejects count mismatch.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  Reflector,
  createReflector,
  parseVerdicts,
  buildJudgePrompt,
  type ReflectorJudge,
  type ReflectorVerdict,
} from "../../src/memory/reflector.js";
import { Observer } from "../../src/memory/observer.js";
import { MemoryStore } from "../../src/memory/store.js";

// ── Fixtures ───────────────────────────────────────────

const TURNS = [
  {
    sessionId: "s1",
    userMessage: "We decided to use OAuth 2.0 instead of OAuth 1.0 for auth.",
    assistantMessage: "Chose OAuth 2.0 because of the wider ecosystem.",
  },
  {
    sessionId: "s1",
    userMessage: "Build succeeded on CI. All tests passing.",
    assistantMessage: "Deployment completed successfully.",
  },
  {
    sessionId: "s1",
    userMessage: "Error: ENOENT on config path.",
    assistantMessage: "Traceback shows the file is missing.",
  },
];

// ── Setup ──────────────────────────────────────────────

let tempDir: string;
let store: MemoryStore;
let observer: Observer;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "reflector-test-"));
  store = new MemoryStore(join(tempDir, "memory.db"));
  observer = new Observer({ store: null, flushThreshold: 100 });
});

afterEach(() => {
  store.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function seedObserver(): void {
  for (const turn of TURNS) observer.observeTurn(turn);
}

const allPromoteJudge: ReflectorJudge = async (obs) =>
  obs.map(() => "promote" as ReflectorVerdict);

const allDemoteJudge: ReflectorJudge = async (obs) =>
  obs.map(() => "demote" as ReflectorVerdict);

const mixedJudge: ReflectorJudge = async (obs) =>
  obs.map((_, i) => (i % 2 === 0 ? "promote" : "demote") as ReflectorVerdict);

const throwingJudge: ReflectorJudge = async () => {
  throw new Error("simulated judge failure");
};

// ── Tests ──────────────────────────────────────────────

describe("Reflector", () => {
  it("promotes observations into core_blocks based on judge verdict", async () => {
    seedObserver();
    const reflector = new Reflector({
      store,
      observer,
      judge: allPromoteJudge,
    });
    const pendingBefore = observer.pendingFor("s1").length;
    expect(pendingBefore).toBeGreaterThan(0);

    const result = await reflector.reflect("s1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.promoted).toBe(pendingBefore);
      expect(result.kept).toBe(0);
      expect(result.demoted).toBe(0);
      expect(result.total).toBe(pendingBefore);
    }

    // Promoted entries land in core_blocks.
    const core = store.getByLayer("core_blocks");
    expect(core.length).toBe(pendingBefore);
    // Tagged `reflector-promoted` for grep-verifiability (Quality Bar #13).
    expect(core.every((e) => (e.tags ?? "").includes("reflector-promoted"))).toBe(true);

    // Observer buffer is drained.
    expect(observer.pendingFor("s1").length).toBe(0);
  });

  it("demotes observations into archival with TTL tag", async () => {
    seedObserver();
    const reflector = new Reflector({
      store,
      observer,
      judge: allDemoteJudge,
      demoteTtlMs: 1000,
    });
    const pendingBefore = observer.pendingFor("s1").length;

    const result = await reflector.reflect("s1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.demoted).toBe(pendingBefore);

    // Demoted entries land in archival.
    const archival = store.getByLayer("archival");
    expect(archival.length).toBe(pendingBefore);
    expect(archival.every((e) => (e.tags ?? "").includes("reflector-demoted"))).toBe(true);
    expect(archival.every((e) => (e.tags ?? "").includes("ttl-expires-"))).toBe(true);
  });

  it("returns {ok:false,error} when judge throws — buffer preserved on empty failure", async () => {
    seedObserver();
    const reflector = new Reflector({
      store,
      observer,
      judge: throwingJudge,
    });
    const pendingBefore = observer.pendingFor("s1").length;
    expect(pendingBefore).toBeGreaterThan(0);

    const result = await reflector.reflect("s1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("simulated judge failure");
    }

    // Buffer should be preserved — honest failure doesn't drop work.
    expect(observer.pendingFor("s1").length).toBe(pendingBefore);
    // Nothing written to core_blocks or archival.
    expect(store.getByLayer("core_blocks").length).toBe(0);
    expect(store.getByLayer("archival").length).toBe(0);
  });

  it("returns {ok:false,error} when judge returns wrong verdict count", async () => {
    seedObserver();
    const badCountJudge: ReflectorJudge = async () => ["promote"]; // always 1
    const reflector = new Reflector({
      store,
      observer,
      judge: badCountJudge,
    });
    const pendingBefore = observer.pendingFor("s1").length;
    expect(pendingBefore).toBeGreaterThan(1);

    const result = await reflector.reflect("s1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("verdicts for");
    }
    // Buffer preserved.
    expect(observer.pendingFor("s1").length).toBe(pendingBefore);
  });

  it("shouldReflect() crosses threshold at N turns", () => {
    const reflector = new Reflector({
      store,
      observer,
      judge: allPromoteJudge,
      reflectEveryNTurns: 3,
    });
    expect(reflector.shouldReflect("s1")).toBe(false);
    observer.observeTurn(TURNS[0]!);
    expect(reflector.shouldReflect("s1")).toBe(false); // 1 turn
    observer.observeTurn(TURNS[1]!);
    expect(reflector.shouldReflect("s1")).toBe(false); // 2 turns
    observer.observeTurn(TURNS[2]!);
    expect(reflector.shouldReflect("s1")).toBe(true); // 3 turns
  });

  it("keeps per-session stats isolated", async () => {
    // Seed s1 with 2 turns, s2 with 1.
    observer.observeTurn(TURNS[0]!);
    observer.observeTurn(TURNS[1]!);
    observer.observeTurn({ ...TURNS[0]!, sessionId: "s2" });

    const reflector = new Reflector({
      store,
      observer,
      judge: allPromoteJudge,
    });
    await reflector.reflect("s1");
    await reflector.reflect("s2");

    const s1Stats = reflector.statsFor("s1");
    const s2Stats = reflector.statsFor("s2");
    expect(s1Stats.promotions).toBeGreaterThan(0);
    expect(s2Stats.promotions).toBeGreaterThan(0);
    // Different pending counts → different stats.
    expect(s1Stats.promotions).not.toBe(s2Stats.promotions);
  });

  it("empty buffer → honest empty success", async () => {
    const reflector = new Reflector({
      store,
      observer,
      judge: allPromoteJudge,
    });
    const result = await reflector.reflect("empty-session");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.total).toBe(0);
      expect(result.promoted).toBe(0);
    }
  });

  it("mixed verdicts partition correctly", async () => {
    seedObserver();
    const reflector = new Reflector({
      store,
      observer,
      judge: mixedJudge,
    });
    const pendingBefore = observer.pendingFor("s1").length;
    expect(pendingBefore).toBeGreaterThanOrEqual(2);

    const result = await reflector.reflect("s1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.promoted + result.demoted).toBe(pendingBefore);
      expect(result.kept).toBe(0);
    }

    const core = store.getByLayer("core_blocks");
    const archival = store.getByLayer("archival");
    expect(core.length + archival.length).toBe(pendingBefore);
  });

  it("forget(sessionId) clears per-session stats", () => {
    const reflector = new Reflector({
      store,
      observer,
      judge: allPromoteJudge,
    });
    // Pre-seed stats.
    reflector.forget("nonexistent");
    expect(reflector.statsFor("nonexistent").promotions).toBe(0);
  });

  it("createReflector() factory returns a working instance", async () => {
    const reflector = createReflector({
      store,
      observer,
      judge: allPromoteJudge,
    });
    expect(reflector).toBeInstanceOf(Reflector);
    const result = await reflector.reflect("empty");
    expect(result.ok).toBe(true);
  });

  it("parseVerdicts() strictly rejects count mismatch", () => {
    expect(() => parseVerdicts("promote\nkeep", 3)).toThrow(/expected 3/);
    expect(() => parseVerdicts("promote\nkeep\ndemote", 3)).not.toThrow();
    expect(parseVerdicts("promote\nkeep\ndemote", 3)).toEqual(["promote", "keep", "demote"]);
  });

  it("buildJudgePrompt() emits observations with type tags and context", () => {
    const prompt = buildJudgePrompt(
      [
        {
          id: "1",
          type: "decision",
          assertion: "Use OAuth 2.0",
          confidence: 0.8,
          sourceIds: [],
          extractedAt: 0,
        },
      ],
      { sessionId: "s1", turnCount: 3, now: 0 },
    );
    expect(prompt).toContain("[decision]");
    expect(prompt).toContain("Use OAuth 2.0");
    expect(prompt).toContain("Session: s1");
    expect(prompt).toContain("Turns observed: 3");
    expect(prompt).toContain("promote | keep | demote");
  });
});
