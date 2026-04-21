import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  execFileSync,
} from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureBootstrapSnapshot,
  formatSnapshotForPrompt,
  SessionBootstrapCache,
  type BootstrapSnapshot,
} from "../../src/core/bootstrap-snapshot.js";

describe("bootstrap-snapshot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-bootstrap-"));
    // Make it a real git repo so the git sub-capture succeeds
    execFileSync("git", ["init", "--initial-branch=main", "--quiet"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tempDir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: tempDir });

    writeFileSync(join(tempDir, "README.md"), "# test\n");
    execFileSync("git", ["add", "-A"], { cwd: tempDir });
    execFileSync(
      "git",
      ["commit", "-m", "initial", "--quiet", "--no-gpg-sign"],
      { cwd: tempDir },
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("captureBootstrapSnapshot", () => {
    it("produces all 6 top-level fields plus metadata", async () => {
      const snap = await captureBootstrapSnapshot({ workspaceRoot: tempDir });

      expect(snap.workspaceRoot).toBe(tempDir);
      expect(snap.capturedAt).toBeInstanceOf(Date);
      // all six fields present
      expect(snap.tree).toBeDefined();
      expect(snap.git).toBeDefined();
      expect(snap.env).toBeDefined();
      expect(snap.services).toBeDefined();
      expect(snap.logs).toBeDefined();
      expect(snap.lockfiles).toBeDefined();
    });

    it("filters secret-bearing env keys (KEY/TOKEN/SECRET/PASSWORD/AUTH)", async () => {
      const overrides: NodeJS.ProcessEnv = {
        PATH: "/usr/bin",
        HOME: "/home/test",
        MY_API_KEY: "sk-leaked-1234",
        GITHUB_TOKEN: "gh-leaked",
        DATABASE_PASSWORD: "hunter2",
        APP_SECRET: "shhh",
        AUTH_BEARER: "xyz",
        MY_PRIVATE_KEY: "-----BEGIN-----",
        HARMLESS_VAR: "ok",
        NODE_ENV: "test",
      };

      const snap = await captureBootstrapSnapshot({
        workspaceRoot: tempDir,
        processOverrides: { env: overrides },
      });

      expect(snap.env.captured).toBe(true);
      if (!snap.env.captured) throw new Error("unreachable");

      // Secrets redacted
      expect(snap.env.value["MY_API_KEY"]).toBeUndefined();
      expect(snap.env.value["GITHUB_TOKEN"]).toBeUndefined();
      expect(snap.env.value["DATABASE_PASSWORD"]).toBeUndefined();
      expect(snap.env.value["APP_SECRET"]).toBeUndefined();
      expect(snap.env.value["AUTH_BEARER"]).toBeUndefined();
      expect(snap.env.value["MY_PRIVATE_KEY"]).toBeUndefined();

      // Non-secrets + allowlist kept
      expect(snap.env.value["PATH"]).toBe("/usr/bin");
      expect(snap.env.value["HOME"]).toBe("/home/test");
      expect(snap.env.value["NODE_ENV"]).toBe("test");
      expect(snap.env.value["HARMLESS_VAR"]).toBe("ok");
    });

    it("detects dirty workspace after an uncommitted change", async () => {
      const clean = await captureBootstrapSnapshot({ workspaceRoot: tempDir });
      expect(clean.git.captured).toBe(true);
      if (!clean.git.captured) throw new Error("unreachable");
      expect(clean.git.value.dirty).toBe(false);
      expect(clean.git.value.branch).toBe("main");
      expect(clean.git.value.head).toMatch(/^[a-f0-9]{40}$/);

      // Introduce a dirty change
      writeFileSync(join(tempDir, "new.txt"), "uncommitted\n");

      const dirty = await captureBootstrapSnapshot({ workspaceRoot: tempDir });
      expect(dirty.git.captured).toBe(true);
      if (!dirty.git.captured) throw new Error("unreachable");
      expect(dirty.git.value.dirty).toBe(true);
      expect(dirty.git.value.head).toBe(clean.git.value.head); // same commit
    });

    it("produces stable lockfile sha across captures when content unchanged", async () => {
      writeFileSync(
        join(tempDir, "package-lock.json"),
        JSON.stringify({ name: "x", lockfileVersion: 3 }),
      );
      writeFileSync(join(tempDir, "Cargo.lock"), "# lock\n");

      const snap1 = await captureBootstrapSnapshot({ workspaceRoot: tempDir });
      const snap2 = await captureBootstrapSnapshot({ workspaceRoot: tempDir });

      expect(snap1.lockfiles.captured).toBe(true);
      expect(snap2.lockfiles.captured).toBe(true);
      if (!snap1.lockfiles.captured || !snap2.lockfiles.captured) {
        throw new Error("unreachable");
      }

      const byPath1 = new Map(snap1.lockfiles.value.map((e) => [e.path, e.sha256]));
      const byPath2 = new Map(snap2.lockfiles.value.map((e) => [e.path, e.sha256]));

      expect(byPath1.get("package-lock.json")).toBeDefined();
      expect(byPath1.get("Cargo.lock")).toBeDefined();
      expect(byPath1.get("package-lock.json")).toBe(byPath2.get("package-lock.json"));
      expect(byPath1.get("Cargo.lock")).toBe(byPath2.get("Cargo.lock"));

      // And changing content changes the sha
      writeFileSync(join(tempDir, "package-lock.json"), "different-content");
      const snap3 = await captureBootstrapSnapshot({ workspaceRoot: tempDir });
      if (!snap3.lockfiles.captured) throw new Error("unreachable");
      const byPath3 = new Map(snap3.lockfiles.value.map((e) => [e.path, e.sha256]));
      expect(byPath3.get("package-lock.json")).not.toBe(byPath1.get("package-lock.json"));
    });

    it("honest-failure: unreachable git dir produces captured:false with reason", async () => {
      // Run the capture in a scratch dir that is NOT a git repo
      const nonGit = mkdtempSync(join(tmpdir(), "wotann-nogit-"));
      try {
        const snap = await captureBootstrapSnapshot({ workspaceRoot: nonGit });
        expect(snap.git.captured).toBe(false);
        if (snap.git.captured) throw new Error("unreachable");
        expect(snap.git.reason).toMatch(/git exec failed/);
        // The rest still captures cleanly — one failure doesn't taint others
        expect(snap.env.captured).toBe(true);
        expect(snap.services.captured).toBe(true);
      } finally {
        rmSync(nonGit, { recursive: true, force: true });
      }
    });

    it("honest-failure: missing kairos log dir returns captured:false with reason", async () => {
      const snap = await captureBootstrapSnapshot({ workspaceRoot: tempDir });
      expect(snap.logs.captured).toBe(false);
      if (snap.logs.captured) throw new Error("unreachable");
      expect(snap.logs.reason).toMatch(/no kairos log dir/);
    });

    it("captures kairos log tail when a log file exists", async () => {
      const logDir = join(tempDir, ".wotann", "logs");
      mkdirSync(logDir, { recursive: true });
      const logFile = join(logDir, "2026-04-20.jsonl");
      for (let i = 0; i < 5; i++) {
        appendFileSync(logFile, `{"seq":${i},"msg":"line${i}"}\n`);
      }

      const snap = await captureBootstrapSnapshot({
        workspaceRoot: tempDir,
        logTailLines: 3,
      });

      expect(snap.logs.captured).toBe(true);
      if (!snap.logs.captured) throw new Error("unreachable");
      expect(snap.logs.value.path).toBe(logFile);
      expect(snap.logs.value.tail.length).toBe(3);
      expect(snap.logs.value.tail[2]).toContain('"seq":4');
    });

    it("tree capture ignores node_modules/.git/dist/.wotann", async () => {
      mkdirSync(join(tempDir, "node_modules", "foo"), { recursive: true });
      mkdirSync(join(tempDir, "dist"), { recursive: true });
      mkdirSync(join(tempDir, ".wotann"), { recursive: true });
      mkdirSync(join(tempDir, "src"), { recursive: true });
      writeFileSync(join(tempDir, "src", "index.ts"), "export {};");
      writeFileSync(join(tempDir, "node_modules", "foo", "pkg.js"), "");
      writeFileSync(join(tempDir, "dist", "main.js"), "");

      const snap = await captureBootstrapSnapshot({ workspaceRoot: tempDir });
      expect(snap.tree.captured).toBe(true);
      if (!snap.tree.captured) throw new Error("unreachable");
      const joined = snap.tree.value.join("\n");
      expect(joined).toContain("src/");
      expect(joined).toContain("index.ts");
      expect(joined).not.toContain("node_modules");
      expect(joined).not.toContain("dist/");
      expect(joined).not.toContain(".wotann");
    });

    it("services capture includes uptime/RSS/heap and uses process overrides", async () => {
      const snap = await captureBootstrapSnapshot({
        workspaceRoot: tempDir,
        processOverrides: {
          uptime: () => 123,
          memoryUsage: () => ({
            rss: 100 * 1024 * 1024,
            heapTotal: 80 * 1024 * 1024,
            heapUsed: 60 * 1024 * 1024,
            external: 0,
            arrayBuffers: 0,
          }),
        },
      });

      expect(snap.services.captured).toBe(true);
      if (!snap.services.captured) throw new Error("unreachable");
      expect(snap.services.value.uptimeSeconds).toBe(123);
      expect(snap.services.value.rssBytes).toBe(100 * 1024 * 1024);
      expect(snap.services.value.heapUsedBytes).toBe(60 * 1024 * 1024);
      // openPorts is always a CaptureResult (succeeded or honest-skipped)
      expect(snap.services.value.openPorts).toBeDefined();
      expect(
        snap.services.value.openPorts.captured === true ||
          snap.services.value.openPorts.captured === false,
      ).toBe(true);
    });
  });

  describe("formatSnapshotForPrompt", () => {
    it("produces a well-formed markdown section with all subheadings", async () => {
      const snap = await captureBootstrapSnapshot({ workspaceRoot: tempDir });
      const md = formatSnapshotForPrompt(snap);

      expect(md).toContain("## Environment Bootstrap Snapshot");
      expect(md).toContain("### Git");
      expect(md).toContain("### Working Tree");
      expect(md).toContain("### Lockfiles");
      expect(md).toContain("### Services");
      expect(md).toContain("### Recent Daemon Logs");
      expect(md).toContain("### Environment (filtered, non-secret)");
      // contains the workspace root
      expect(md).toContain(tempDir);
    });

    it("explicitly surfaces skipped sub-captures (not silent omit)", async () => {
      const nonGit = mkdtempSync(join(tmpdir(), "wotann-nogit-"));
      try {
        const snap = await captureBootstrapSnapshot({ workspaceRoot: nonGit });
        const md = formatSnapshotForPrompt(snap);
        expect(md).toMatch(/skipped:/);
      } finally {
        rmSync(nonGit, { recursive: true, force: true });
      }
    });
  });

  describe("SessionBootstrapCache", () => {
    it("bypass mode short-circuits capture entirely", async () => {
      const cache = new SessionBootstrapCache();
      const snap = await cache.getOrCapture({
        workspaceRoot: tempDir,
        bypass: true,
      });

      expect(snap.tree.captured).toBe(false);
      expect(snap.git.captured).toBe(false);
      expect(snap.env.captured).toBe(false);
      expect(snap.services.captured).toBe(false);
      expect(snap.logs.captured).toBe(false);
      expect(snap.lockfiles.captured).toBe(false);
      // reason identifies bypass
      const reasons: string[] = [];
      for (const r of [snap.tree, snap.git, snap.env, snap.services, snap.logs, snap.lockfiles]) {
        if (!r.captured) reasons.push(r.reason);
      }
      expect(reasons.every((r) => r.includes("bypassed"))).toBe(true);
    });

    it("caches snapshot across calls (same reference returned)", async () => {
      const cache = new SessionBootstrapCache();
      const s1 = await cache.getOrCapture({ workspaceRoot: tempDir });
      const s2 = await cache.getOrCapture({ workspaceRoot: tempDir });
      expect(s1).toBe(s2);
      expect(cache.peek()).toBe(s1);
    });

    it("invalidate clears the cache and re-captures", async () => {
      const cache = new SessionBootstrapCache();
      const s1 = await cache.getOrCapture({ workspaceRoot: tempDir });
      cache.invalidate();
      expect(cache.peek()).toBeNull();
      const s2 = await cache.getOrCapture({ workspaceRoot: tempDir });
      expect(s1).not.toBe(s2);
    });

    it("per-session isolation: two caches with different roots stay separate", async () => {
      const otherDir = mkdtempSync(join(tmpdir(), "wotann-bootstrap-other-"));
      try {
        execFileSync("git", ["init", "--initial-branch=main", "--quiet"], { cwd: otherDir });
        execFileSync("git", ["config", "user.email", "t@t.co"], { cwd: otherDir });
        execFileSync("git", ["config", "user.name", "T"], { cwd: otherDir });
        execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: otherDir });
        writeFileSync(join(otherDir, "MARKER.md"), "other\n");
        execFileSync("git", ["add", "-A"], { cwd: otherDir });
        execFileSync(
          "git",
          ["commit", "-m", "other", "--quiet", "--no-gpg-sign"],
          { cwd: otherDir },
        );

        const cacheA = new SessionBootstrapCache();
        const cacheB = new SessionBootstrapCache();

        const snapA = await cacheA.getOrCapture({ workspaceRoot: tempDir });
        const snapB = await cacheB.getOrCapture({ workspaceRoot: otherDir });

        expect(snapA.workspaceRoot).toBe(tempDir);
        expect(snapB.workspaceRoot).toBe(otherDir);
        expect(snapA).not.toBe(snapB);

        // Each cache is independent: peek returns the right snapshot
        expect(cacheA.peek()?.workspaceRoot).toBe(tempDir);
        expect(cacheB.peek()?.workspaceRoot).toBe(otherDir);

        // The git HEADs should differ since these are two distinct repos
        if (snapA.git.captured && snapB.git.captured) {
          expect(snapA.git.value.head).not.toBe(snapB.git.value.head);
        }
      } finally {
        rmSync(otherDir, { recursive: true, force: true });
      }
    });
  });

  describe("integration-shape sanity", () => {
    it("snapshot is JSON-serialisable (for log persistence, WAL)", async () => {
      const snap: BootstrapSnapshot = await captureBootstrapSnapshot({
        workspaceRoot: tempDir,
      });
      // Round-trip through JSON without throwing
      const json = JSON.stringify(snap);
      expect(json.length).toBeGreaterThan(0);
      const parsed = JSON.parse(json) as { workspaceRoot: string };
      expect(parsed.workspaceRoot).toBe(tempDir);
    });
  });
});
