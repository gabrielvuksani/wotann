/**
 * C17 — WOTANN Raven state machine tests.
 */

import { describe, it, expect } from "vitest";
import {
  deriveMood,
  initialState,
  nextDelayMs,
  renderAscii,
  tick,
  RAVEN_TUNING,
  type RavenContext,
  type RavenState,
} from "../../src/ui/raven/raven-state.js";

const defaultCtx: RavenContext = {
  idleMs: 100,
  toolActive: false,
  recentErrors: 0,
  justCompleted: false,
  listening: false,
};

describe("deriveMood priority", () => {
  it("error beats everything", () => {
    expect(
      deriveMood({
        ...defaultCtx,
        recentErrors: 2,
        toolActive: true,
        justCompleted: true,
        listening: true,
      }),
    ).toBe("error");
  });

  it("celebrating when justCompleted with no errors", () => {
    expect(deriveMood({ ...defaultCtx, justCompleted: true })).toBe("celebrating");
  });

  it("listening when mic is open", () => {
    expect(deriveMood({ ...defaultCtx, listening: true })).toBe("listening");
  });

  it("thinking during tool activity", () => {
    expect(deriveMood({ ...defaultCtx, toolActive: true })).toBe("thinking");
  });

  it("preening after long idle", () => {
    expect(
      deriveMood({
        ...defaultCtx,
        idleMs: RAVEN_TUNING.preeningAfterIdleMs + 1,
      }),
    ).toBe("preening");
  });

  it("alert on very recent activity", () => {
    expect(deriveMood({ ...defaultCtx, idleMs: 500 })).toBe("alert");
  });

  it("idle otherwise", () => {
    expect(deriveMood({ ...defaultCtx, idleMs: 10_000 })).toBe("idle");
  });
});

describe("tick state transitions", () => {
  it("bumps revision each call", () => {
    const s0 = initialState(1000);
    const s1 = tick(s0, defaultCtx, 1100);
    const s2 = tick(s1, defaultCtx, 1200);
    expect(s1.revision).toBe(1);
    expect(s2.revision).toBe(2);
  });

  it("resets `since` when mood changes", () => {
    const s0: RavenState = { ...initialState(1000), mood: "idle", since: 1000 };
    const s1 = tick(s0, { ...defaultCtx, toolActive: true }, 2000);
    expect(s1.mood).toBe("thinking");
    expect(s1.since).toBe(2000);
  });

  it("keeps `since` when mood unchanged", () => {
    const s0: RavenState = { ...initialState(1000), mood: "idle", since: 1000 };
    const s1 = tick(s0, { ...defaultCtx, idleMs: 10_000 }, 2000);
    expect(s1.mood).toBe("idle");
    expect(s1.since).toBe(1000);
  });

  it("eases energy toward the mood target", () => {
    let s = initialState(0);
    // Idle → energy target 0.3, start at 0.3 so should stay near 0.3
    for (let i = 0; i < 10; i++) s = tick(s, { ...defaultCtx, idleMs: 10_000 }, i * 100);
    expect(s.energy).toBeCloseTo(0.3, 1);

    // Flip to error (target 0.85)
    for (let i = 0; i < 20; i++) s = tick(s, { ...defaultCtx, recentErrors: 3 }, 1000 + i * 100);
    expect(s.energy).toBeGreaterThan(0.7);
  });

  it("flips facing on error or celebrating mood changes", () => {
    const s0: RavenState = { ...initialState(0), facing: "right", mood: "idle" };
    const s1 = tick(s0, { ...defaultCtx, recentErrors: 2 }, 100);
    expect(s1.facing).toBe("left");
    const s2 = tick(s1, { ...defaultCtx, recentErrors: 2 }, 200);
    expect(s2.facing).toBe("left"); // mood still error, no further flip
  });

  it("preserves facing on non-dramatic mood changes", () => {
    const s0: RavenState = { ...initialState(0), facing: "right", mood: "idle" };
    const s1 = tick(s0, { ...defaultCtx, toolActive: true }, 100);
    expect(s1.facing).toBe("right");
  });

  it("error winks the eye for playfulness", () => {
    const s0 = initialState(0);
    const s1 = tick(s0, { ...defaultCtx, recentErrors: 3 }, 100);
    expect(s1.eye).toBe("wink");
  });
});

describe("nextDelayMs aperiodic schedule", () => {
  it("stays within tuning bounds", () => {
    const s = initialState(0);
    for (let i = 0; i < 100; i++) {
      const d = nextDelayMs(s);
      expect(d).toBeGreaterThanOrEqual(RAVEN_TUNING.minTickDelayMs);
      expect(d).toBeLessThanOrEqual(RAVEN_TUNING.maxTickDelayMs);
    }
  });

  it("thinking is markedly faster than preening", () => {
    const pin = () => 0.5; // deterministic centre of jitter window
    const thinking: RavenState = { ...initialState(0), mood: "thinking" };
    const preening: RavenState = { ...initialState(0), mood: "preening" };
    const dT = nextDelayMs(thinking, pin);
    const dP = nextDelayMs(preening, pin);
    expect(dT).toBeLessThan(dP);
  });

  it("is aperiodic — consecutive samples differ with non-constant random", () => {
    let counter = 0;
    const pseudo = () => {
      counter = (counter * 9301 + 49297) % 233280;
      return counter / 233280;
    };
    const s: RavenState = { ...initialState(0), mood: "idle" };
    const samples = Array.from({ length: 10 }, () => nextDelayMs(s, pseudo));
    const unique = new Set(samples);
    // ≥ 7 distinct values out of 10 means the jitter is doing its job.
    expect(unique.size).toBeGreaterThanOrEqual(7);
  });

  it("deterministic with a pinned random", () => {
    const s: RavenState = { ...initialState(0), mood: "thinking" };
    const a = nextDelayMs(s, () => 0.5);
    const b = nextDelayMs(s, () => 0.5);
    expect(a).toBe(b);
  });
});

describe("renderAscii", () => {
  it("produces distinct glyphs for each mood", () => {
    const moods = ["idle", "alert", "thinking", "listening", "error", "celebrating", "preening"] as const;
    const rendered = moods.map((m) => renderAscii({ ...initialState(0), mood: m, energy: 0.8 }));
    const unique = new Set(rendered);
    expect(unique.size).toBeGreaterThanOrEqual(5); // some moods may share due to body/beak overlap
  });

  it("mirrors when facing flips", () => {
    const right = renderAscii({ ...initialState(0), facing: "right" });
    const left = renderAscii({ ...initialState(0), facing: "left" });
    expect(right).not.toBe(left);
  });

  it("preening uses the low-energy body", () => {
    const ascii = renderAscii({ ...initialState(0), mood: "preening", energy: 0.15 });
    expect(ascii).toContain(".");
  });
});
