/**
 * Tests for src/cli/tricks/tmux-pull.ts (T12.2).
 *
 * Strategy: stub the runner so tests don't depend on tmux being
 * installed. We assert:
 *   - The argv passed to the runner matches the documented tmux flags.
 *   - The result-shape mapping for clean exit (ok:true).
 *   - The known failure-mode pattern matching (no server, missing
 *     session, ENOENT) returns the documented `reason` strings.
 *   - Validation errors come back as honest-stub results, not throws.
 */

import { describe, it, expect, vi } from "vitest";
import {
  tmuxPull,
  type TmuxRunner,
} from "../../../src/cli/tricks/tmux-pull.js";

// ── Helpers ───────────────────────────────────────────

/**
 * Returns a vi spy that is itself callable as a TmuxRunner. Tests
 * read its mock metadata via `spy.mock.calls[i]` (vitest's stock
 * shape), not the legacy `spy.mock.mock.calls[i]` double-nesting.
 */
type RunnerSpy = TmuxRunner & {
  mock: { calls: readonly (readonly unknown[])[] };
};

function makeRunner(opts: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}): RunnerSpy {
  const spy = vi.fn(async (_file: string, _args: readonly string[]) => ({
    exitCode: opts.exitCode,
    stdout: opts.stdout ?? "",
    stderr: opts.stderr ?? "",
  }));
  return spy as unknown as RunnerSpy;
}

// ── argv shape ────────────────────────────────────────

describe("tmuxPull — argv shape", () => {
  it("invokes tmux capture-pane with -p -J -S -<lines> -t <session>", async () => {
    const runner = makeRunner({ exitCode: 0, stdout: "pane content" });
    const r = await tmuxPull({ session: "build", lines: 200, runner });
    expect(r.ok).toBe(true);
    expect(runner).toHaveBeenCalledWith("tmux", [
      "capture-pane",
      "-p",
      "-J",
      "-S",
      "-200",
      "-t",
      "build",
    ]);
  });

  it("uses default of 200 lines when omitted", async () => {
    const runner = makeRunner({ exitCode: 0, stdout: "" });
    await tmuxPull({ session: "x", runner });
    expect(runner.mock.calls[0]?.[1]).toContain("-200");
  });

  it("appends pane id with colon when supplied", async () => {
    const runner = makeRunner({ exitCode: 0, stdout: "" });
    await tmuxPull({ session: "build", pane: "0.1", runner });
    const args = runner.mock.calls[0]?.[1] as readonly string[];
    expect(args[args.length - 1]).toBe("build:0.1");
  });

  it("respects custom tmuxBin override", async () => {
    const runner = makeRunner({ exitCode: 0, stdout: "" });
    await tmuxPull({ session: "x", tmuxBin: "/opt/tmux/bin/tmux", runner });
    expect(runner.mock.calls[0]?.[0]).toBe("/opt/tmux/bin/tmux");
  });

  it("caps lines to 100_000 to prevent runaway memory", async () => {
    const runner = makeRunner({ exitCode: 0, stdout: "" });
    await tmuxPull({ session: "x", lines: 10_000_000, runner });
    expect(runner.mock.calls[0]?.[1]).toContain("-100000");
  });
});

// ── ok-path result shape ──────────────────────────────

describe("tmuxPull — ok path", () => {
  it("returns content + lines + session on clean exit", async () => {
    const runner = makeRunner({ exitCode: 0, stdout: "captured-content\n" });
    const r = await tmuxPull({ session: "build", lines: 50, runner });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe("captured-content\n");
    expect(r.lines).toBe(50);
    expect(r.session).toBe("build");
  });
});

// ── Honest-stub failure-mode mapping ──────────────────

describe("tmuxPull — failure-mode mapping (matrix row tmux_pull no session)", () => {
  it("maps 'no server running' stderr to the documented reason", async () => {
    const runner = makeRunner({
      exitCode: 1,
      stderr: "no server running on /tmp/tmux-1000/default",
    });
    const r = await tmuxPull({ session: "x", runner });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("tmux-pull: no tmux server running");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/no server running/);
  });

  it("maps 'no tmux server' variant to the same reason", async () => {
    const runner = makeRunner({ exitCode: 1, stderr: "no tmux server" });
    const r = await tmuxPull({ session: "x", runner });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("tmux-pull: no tmux server running");
  });

  it("maps missing session stderr to a session-named reason", async () => {
    const runner = makeRunner({
      exitCode: 1,
      stderr: "can't find session: build",
    });
    const r = await tmuxPull({ session: "build", runner });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('session "build" not found');
  });

  it("maps ENOENT (tmux missing) to a binary-not-found reason", async () => {
    const runner = makeRunner({
      exitCode: 127,
      stderr: "spawn tmux ENOENT",
    });
    const r = await tmuxPull({ session: "x", runner });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("tmux-pull: tmux binary not found in PATH");
  });

  it("falls back to a generic exit-code reason for unknown stderr", async () => {
    const runner = makeRunner({ exitCode: 7, stderr: "weird tmux error" });
    const r = await tmuxPull({ session: "x", runner });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("tmux exited 7");
  });
});

// ── Validation ────────────────────────────────────────

describe("tmuxPull — input validation (QB #6)", () => {
  it("rejects empty session", async () => {
    const r = await tmuxPull({ session: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/non-empty/);
  });

  it("rejects non-string session", async () => {
    // @ts-expect-error — runtime validation
    const r = await tmuxPull({ session: 42 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/non-empty/);
  });

  it("rejects lines < 1", async () => {
    const r = await tmuxPull({ session: "x", lines: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/lines must be >= 1/);
  });

  it("rejects non-finite lines", async () => {
    const r = await tmuxPull({ session: "x", lines: Number.NaN });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/lines must be >= 1/);
  });
});
