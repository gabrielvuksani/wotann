/**
 * Tests for src/cli/tricks/terminal-run.ts (T12.2).
 *
 * Strategy:
 *   - Pure-shape tests for argv validation (honest-stub posture).
 *   - End-to-end tests against /bin/sh / node since execFileNoThrow is
 *     deliberately not mockable (it imports node:child_process at call
 *     time). Tests use small, fast subprocesses (echo, false, node -e)
 *     so the suite stays under 1s on a laptop.
 */

import { describe, it, expect } from "vitest";
import { runTerminal } from "../../../src/cli/tricks/terminal-run.js";

describe("runTerminal — argv validation (honest-stub QB #6)", () => {
  it("rejects empty argv", async () => {
    const r = await runTerminal({ argv: [] });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(-1);
    expect(r.error).toMatch(/non-empty array/);
  });

  it("rejects missing argv[0]", async () => {
    // @ts-expect-error — testing runtime validation
    const r = await runTerminal({ argv: [undefined, "x"] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/argv\[0\]/);
  });

  it("rejects non-string args", async () => {
    // @ts-expect-error — testing runtime validation
    const r = await runTerminal({ argv: ["echo", 123] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/every arg must be a string/);
  });
});

describe("runTerminal — real subprocess (clean exit)", () => {
  it("captures stdout from echo", async () => {
    const r = await runTerminal({ argv: ["echo", "hello world"] });
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("hello world");
    expect(r.stderr).toBe("");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures stderr separately from stdout via node", async () => {
    const r = await runTerminal({
      argv: [process.execPath, "-e", "process.stderr.write('err-out'); process.stdout.write('std-out')"],
    });
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("std-out");
    expect(r.stderr).toBe("err-out");
  });
});

describe("runTerminal — non-zero exit", () => {
  it("returns ok:false with exit code from `false`", async () => {
    const r = await runTerminal({ argv: ["false"] });
    expect(r.ok).toBe(false);
    expect(r.exitCode).not.toBe(0);
    expect(r.error).toMatch(/exited with code/);
  });

  it("returns ok:false but preserves stdout/stderr on node exit(2)", async () => {
    const r = await runTerminal({
      argv: [process.execPath, "-e", "console.log('oops'); process.exit(2)"],
    });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stdout.trim()).toBe("oops");
  });
});

describe("runTerminal — argv form prevents shell injection (QB #13 spirit)", () => {
  it("treats `;` and `&&` literally, not as shell separators", async () => {
    // If argv[1] were interpreted by a shell, this would print "hi".
    // Because we use execFile, echo prints the literal string instead.
    const r = await runTerminal({ argv: ["echo", "; echo hi"] });
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe("; echo hi");
    expect(r.stdout).not.toContain("hi\n; echo");
  });
});

describe("runTerminal — durationMs is monotonic non-negative", () => {
  it("reports a duration on a quick echo", async () => {
    const r = await runTerminal({ argv: ["echo", "x"] });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.durationMs).toBeLessThan(60_000);
  });
});
