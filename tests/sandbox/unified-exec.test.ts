import { describe, it, expect, beforeEach } from "vitest";
import {
  UnifiedExecSession,
  parseBuiltin,
  extractInlineEnv,
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
