import { describe, it, expect, beforeEach } from "vitest";
import {
  UnifiedExecSession,
  parseBuiltin,
  extractInlineEnv,
  SHELL_SNAPSHOT_VERSION,
  serializeShellSnapshot,
  deserializeShellSnapshot,
  type ShellSnapshot,
} from "../../src/sandbox/unified-exec.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("parseBuiltin", () => {
  it("returns null for non-builtin", () => {
    expect(parseBuiltin("ls -la")).toBeNull();
    expect(parseBuiltin("git status")).toBeNull();
  });

  it("parses cd with arg", () => {
    expect(parseBuiltin("cd /tmp")).toEqual({ kind: "cd", args: ["/tmp"] });
  });

  it("parses cd with no arg", () => {
    expect(parseBuiltin("cd")).toEqual({ kind: "cd", args: [] });
  });

  it("parses export multiple", () => {
    expect(parseBuiltin("export A=1 B=2")).toEqual({ kind: "export", args: ["A=1", "B=2"] });
  });

  it("parses unset", () => {
    expect(parseBuiltin("unset FOO BAR")).toEqual({ kind: "unset", args: ["FOO", "BAR"] });
  });

  it("handles quoted args", () => {
    expect(parseBuiltin("cd 'path with spaces'")).toEqual({
      kind: "cd",
      args: ["path with spaces"],
    });
  });
});

describe("extractInlineEnv", () => {
  it("returns null for plain commands", () => {
    expect(extractInlineEnv("ls -la")).toBeNull();
  });

  it("extracts single inline var", () => {
    expect(extractInlineEnv("FOO=bar ls")).toEqual({
      vars: { FOO: "bar" },
      remainder: "ls",
    });
  });

  it("extracts multiple inline vars", () => {
    expect(extractInlineEnv("A=1 B=2 echo hi")).toEqual({
      vars: { A: "1", B: "2" },
      remainder: "echo hi",
    });
  });
});

describe("UnifiedExecSession — cd persistence", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wotann-uex-"));
  });

  it("cd updates internal cwd", async () => {
    const session = new UnifiedExecSession({ cwd: tempDir });
    expect(session.cwd).toBe(tempDir);
    const r = await session.run("cd /tmp");
    expect(r.exitCode).toBe(0);
    expect(session.cwd).toBe("/tmp");
  });

  it("cd to nonexistent returns error and preserves cwd", async () => {
    const session = new UnifiedExecSession({ cwd: tempDir });
    const r = await session.run("cd /nonexistent-xyz-12345");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("No such");
    expect(session.cwd).toBe(tempDir);
  });

  it("pwd reflects post-cd cwd", async () => {
    const session = new UnifiedExecSession({ cwd: tempDir });
    await session.run("cd /tmp");
    const r = await session.run("pwd");
    expect(r.stdout.trim()).toBe("/tmp");
  });

  it("cd with relative path resolves against current cwd", async () => {
    const session = new UnifiedExecSession({ cwd: "/tmp" });
    await session.run("cd ..");
    expect(session.cwd).toBe("/");
  });
});

describe("UnifiedExecSession — env persistence", () => {
  it("export + echo round-trip", async () => {
    const session = new UnifiedExecSession();
    await session.run("export MY_TEST_VAR=hello_world");
    expect(session.env["MY_TEST_VAR"]).toBe("hello_world");
    const r = await session.run("echo $MY_TEST_VAR");
    expect(r.stdout.trim()).toBe("hello_world");
  });

  it("unset removes env", async () => {
    const session = new UnifiedExecSession();
    await session.run("export FOO=1");
    await session.run("unset FOO");
    expect(session.env["FOO"]).toBeUndefined();
  });

  it("inline X=Y cmd sets env AND runs cmd", async () => {
    const session = new UnifiedExecSession();
    const r = await session.run("DYNAMIC=42 echo $DYNAMIC");
    expect(r.stdout.trim()).toBe("42");
    expect(session.env["DYNAMIC"]).toBe("42");
  });

  it("env built-in prints sorted vars", async () => {
    const session = new UnifiedExecSession({ env: { B: "2", A: "1" } });
    const r = await session.run("env");
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toBe("A=1");
    expect(lines[1]).toBe("B=2");
  });
});

describe("UnifiedExecSession — shell execution", () => {
  it("runs plain commands via /bin/sh", async () => {
    const session = new UnifiedExecSession();
    const r = await session.run("echo hello");
    expect(r.stdout.trim()).toBe("hello");
    expect(r.exitCode).toBe(0);
  });

  it("captures non-zero exit codes", async () => {
    const session = new UnifiedExecSession();
    const r = await session.run("false");
    expect(r.exitCode).not.toBe(0);
  });

  it("pipes across commands in one run call", async () => {
    const session = new UnifiedExecSession();
    const r = await session.run("echo abc | tr a-z A-Z");
    expect(r.stdout.trim()).toBe("ABC");
  });
});

describe("UnifiedExecSession — snapshot/restore", () => {
  it("snapshot captures cwd + env + history", async () => {
    const session = new UnifiedExecSession();
    await session.run("cd /tmp");
    await session.run("export FOO=bar");
    const snap = session.snapshot();
    expect(snap.cwd).toBe("/tmp");
    expect(snap.env["FOO"]).toBe("bar");
    expect(snap.history.length).toBeGreaterThanOrEqual(2);
  });

  it("restore resets state", async () => {
    const session = new UnifiedExecSession();
    await session.run("cd /tmp");
    const snap = session.snapshot();
    await session.run("cd /");
    expect(session.cwd).toBe("/");
    session.restore(snap);
    expect(session.cwd).toBe("/tmp");
  });
});

describe("UnifiedExecSession — history", () => {
  it("retains commands up to maxHistory", async () => {
    const session = new UnifiedExecSession({ maxHistory: 3 });
    await session.run("echo 1");
    await session.run("echo 2");
    await session.run("echo 3");
    await session.run("echo 4");
    const snap = session.snapshot();
    expect(snap.history).toHaveLength(3);
    expect(snap.history[0]?.command).toBe("echo 2");
  });
});

describe("UnifiedExecSession — shell_snapshot (Codex parity)", () => {
  it("shellSnapshot() carries version + capturedAt + state", async () => {
    const session = new UnifiedExecSession();
    await session.run("cd /tmp");
    await session.run("export PHASE_D_TEST=1");
    const snap = session.shellSnapshot();
    expect(snap.version).toBe(SHELL_SNAPSHOT_VERSION);
    expect(typeof snap.capturedAt).toBe("number");
    expect(snap.cwd).toBe("/tmp");
    expect(snap.env["PHASE_D_TEST"]).toBe("1");
  });

  it("fromSnapshot() rehydrates cwd + env into a NEW session", async () => {
    // Task spec: "start session, run `cd /tmp && export X=1`, snapshot,
    //   create new session, restore → new session at /tmp with X=1."
    const producer = new UnifiedExecSession();
    await producer.run("cd /tmp");
    await producer.run("export X=1");
    const snap = producer.shellSnapshot();

    const consumer = UnifiedExecSession.fromSnapshot(snap);
    expect(consumer).not.toBe(producer);
    expect(consumer.cwd).toBe("/tmp");
    expect(consumer.env["X"]).toBe("1");

    // Prove env persists into the next child spawn in the NEW session.
    const r = await consumer.run("echo $X");
    expect(r.stdout.trim()).toBe("1");
  });

  it("fromSnapshot() accepts a plain SessionSnapshot too", async () => {
    const producer = new UnifiedExecSession();
    await producer.run("cd /tmp");
    const plain = producer.snapshot(); // SessionSnapshot, no version
    const consumer = UnifiedExecSession.fromSnapshot(plain);
    expect(consumer.cwd).toBe("/tmp");
  });

  it("restore() on an existing session accepts ShellSnapshot", async () => {
    const a = new UnifiedExecSession();
    await a.run("cd /tmp");
    const snap = a.shellSnapshot();
    const b = new UnifiedExecSession();
    expect(b.cwd).not.toBe("/tmp");
    b.restore(snap);
    expect(b.cwd).toBe("/tmp");
  });
});

describe("serializeShellSnapshot / deserializeShellSnapshot", () => {
  it("round-trips a ShellSnapshot via JSON", async () => {
    const session = new UnifiedExecSession();
    await session.run("cd /tmp");
    await session.run("export ROUND_TRIP=ok");
    const snap = session.shellSnapshot();

    const json = serializeShellSnapshot(snap);
    expect(typeof json).toBe("string");
    const restored = deserializeShellSnapshot(json);
    expect(restored.version).toBe(SHELL_SNAPSHOT_VERSION);
    expect(restored.cwd).toBe("/tmp");
    expect(restored.env["ROUND_TRIP"]).toBe("ok");
  });

  it("wraps a plain SessionSnapshot into versioned JSON", async () => {
    const session = new UnifiedExecSession();
    await session.run("cd /tmp");
    const plain = session.snapshot();
    const json = serializeShellSnapshot(plain);
    const parsed = JSON.parse(json) as { version?: number };
    expect(parsed.version).toBe(SHELL_SNAPSHOT_VERSION);
  });

  it("rejects malformed JSON", () => {
    expect(() => deserializeShellSnapshot("{not-json")).toThrow(/invalid JSON/);
  });

  it("rejects unsupported version", () => {
    const bad = JSON.stringify({
      version: 99,
      capturedAt: 0,
      cwd: "/tmp",
      env: {},
      history: [],
    });
    expect(() => deserializeShellSnapshot(bad)).toThrow(/unsupported version/);
  });

  it("rejects missing cwd", () => {
    const bad = JSON.stringify({
      version: SHELL_SNAPSHOT_VERSION,
      capturedAt: 0,
      env: {},
      history: [],
    });
    expect(() => deserializeShellSnapshot(bad)).toThrow(/missing cwd/);
  });

  it("rejects malformed history entry", () => {
    const bad = JSON.stringify({
      version: SHELL_SNAPSHOT_VERSION,
      capturedAt: 0,
      cwd: "/tmp",
      env: {},
      history: [{ command: "x" }], // missing exitCode + ranAt
    });
    expect(() => deserializeShellSnapshot(bad)).toThrow(/exitCode must be a number/);
  });

  it("drops non-string env values defensively", () => {
    const bad = JSON.stringify({
      version: SHELL_SNAPSHOT_VERSION,
      capturedAt: 0,
      cwd: "/tmp",
      env: { OK: "yes", BAD: 123 }, // number should be dropped
      history: [],
    });
    const out = deserializeShellSnapshot(bad);
    expect(out.env["OK"]).toBe("yes");
    expect(out.env["BAD"]).toBeUndefined();
  });

  it("a deserialized snapshot is assignable to ShellSnapshot", async () => {
    const session = new UnifiedExecSession();
    await session.run("cd /tmp");
    const json = serializeShellSnapshot(session.shellSnapshot());
    const typed: ShellSnapshot = deserializeShellSnapshot(json);
    expect(typed.version).toBe(SHELL_SNAPSHOT_VERSION);
  });
});
