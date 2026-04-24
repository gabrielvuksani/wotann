/**
 * Tier 11 T11.3 — Cloud-offload shared base coverage.
 *
 * Exercises the three shared modules (adapter.ts, snapshot.ts,
 * session-handle.ts) without touching any of the three concrete
 * adapters. Scope: registry mechanics, snapshot capture with
 * injected shell + env, secret-shape filtering, per-session handle
 * lifecycle, idempotent complete(), listener wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCloudOffloadRegistry,
  isCloudOffloadProvider,
  type CloudOffloadAdapter,
  type CloudOffloadProvider,
  type CloudOffloadSession,
  type OffloadFrame,
  type StartOffloadOptions,
} from "../../../src/providers/cloud-offload/adapter.js";
import {
  captureCloudSnapshot,
  isSecretShapedKey,
  DEFAULT_ENV_ALLOWLIST,
  type ShellExec,
  type ShellExecResult,
} from "../../../src/providers/cloud-offload/snapshot.js";
import { createSessionHandle } from "../../../src/providers/cloud-offload/session-handle.js";

// ── Helpers ────────────────────────────────────────────────

function stubAdapter(
  provider: CloudOffloadProvider,
  tag = "stub",
): CloudOffloadAdapter {
  const sessions = new Map<string, CloudOffloadSession>();
  return {
    provider,
    async start(_opts: StartOffloadOptions): Promise<CloudOffloadSession> {
      const s: CloudOffloadSession = {
        sessionId: `${tag}-${sessions.size}`,
        provider,
        status: "pending",
        startedAt: 0,
        costUsd: 0,
        tokensUsed: 0,
      };
      sessions.set(s.sessionId, s);
      return s;
    },
    async cancel(sessionId: string): Promise<boolean> {
      return sessions.delete(sessionId);
    },
    async status(sessionId: string): Promise<CloudOffloadSession | null> {
      return sessions.get(sessionId) ?? null;
    },
    async list(): Promise<readonly CloudOffloadSession[]> {
      return Array.from(sessions.values());
    },
  };
}

function makeShellExec(
  responses: Record<string, ShellExecResult | null>,
): ShellExec {
  return (cmd, args, _cwd) => {
    const key = `${cmd} ${args.join(" ")}`;
    // Match either the full key or just the command prefix.
    if (key in responses) return responses[key] ?? null;
    if (cmd in responses) return responses[cmd] ?? null;
    return { stdout: "", stderr: "", code: 0 };
  };
}

// ── Registry tests ─────────────────────────────────────────

describe("createCloudOffloadRegistry", () => {
  it("returns an empty registry initially", () => {
    const registry = createCloudOffloadRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.has("anthropic-managed")).toBe(false);
    expect(registry.get("anthropic-managed")).toBe(null);
  });

  it("registers + retrieves an adapter by provider name", () => {
    const registry = createCloudOffloadRegistry();
    const adapter = stubAdapter("anthropic-managed");
    registry.register(adapter);
    expect(registry.has("anthropic-managed")).toBe(true);
    expect(registry.get("anthropic-managed")).toBe(adapter);
    expect(registry.list().length).toBe(1);
  });

  it("supports all 3 providers side-by-side", () => {
    const registry = createCloudOffloadRegistry();
    registry.register(stubAdapter("anthropic-managed"));
    registry.register(stubAdapter("fly-sprites"));
    registry.register(stubAdapter("cloudflare-agents"));
    expect(registry.list().length).toBe(3);
    expect(registry.has("fly-sprites")).toBe(true);
    expect(registry.has("cloudflare-agents")).toBe(true);
  });

  it("last-wins on duplicate register", () => {
    const registry = createCloudOffloadRegistry();
    const first = stubAdapter("fly-sprites", "first");
    const second = stubAdapter("fly-sprites", "second");
    registry.register(first);
    registry.register(second);
    expect(registry.list().length).toBe(1);
    expect(registry.get("fly-sprites")).toBe(second);
  });

  it("keeps per-caller isolation — two registries don't share state", () => {
    const r1 = createCloudOffloadRegistry();
    const r2 = createCloudOffloadRegistry();
    r1.register(stubAdapter("fly-sprites"));
    expect(r1.has("fly-sprites")).toBe(true);
    expect(r2.has("fly-sprites")).toBe(false);
  });

  it("get() returns null for unknown provider without throwing", () => {
    const registry = createCloudOffloadRegistry();
    expect(registry.get("cloudflare-agents")).toBe(null);
  });
});

describe("isCloudOffloadProvider", () => {
  it("accepts the three known providers", () => {
    expect(isCloudOffloadProvider("anthropic-managed")).toBe(true);
    expect(isCloudOffloadProvider("fly-sprites")).toBe(true);
    expect(isCloudOffloadProvider("cloudflare-agents")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isCloudOffloadProvider("")).toBe(false);
    expect(isCloudOffloadProvider("modal")).toBe(false);
    expect(isCloudOffloadProvider(null)).toBe(false);
    expect(isCloudOffloadProvider(42)).toBe(false);
  });
});

// ── Snapshot tests ─────────────────────────────────────────

describe("captureCloudSnapshot — env allowlist", () => {
  const clockNow = () => 1_700_000_000_000;

  it("DEFAULT_ENV_ALLOWLIST excludes common secret env names", () => {
    const secretNames = [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "GITHUB_TOKEN",
      "MY_PASSWORD",
      "FOO_KEY",
      "HF_TOKEN",
    ];
    for (const name of secretNames) {
      expect(DEFAULT_ENV_ALLOWLIST).not.toContain(name);
    }
  });

  it("isSecretShapedKey flags secret-shaped keys", () => {
    expect(isSecretShapedKey("ANTHROPIC_API_KEY")).toBe(true);
    expect(isSecretShapedKey("OPENAI_API_KEY")).toBe(true);
    expect(isSecretShapedKey("AWS_ACCESS_KEY_ID")).toBe(true);
    expect(isSecretShapedKey("GITHUB_TOKEN")).toBe(true);
    expect(isSecretShapedKey("MY_PASSWORD")).toBe(true);
    expect(isSecretShapedKey("FOO_SECRET")).toBe(true);
    expect(isSecretShapedKey("SERVICE_AUTH")).toBe(true);
  });

  it("isSecretShapedKey lets safe keys through", () => {
    expect(isSecretShapedKey("PATH")).toBe(false);
    expect(isSecretShapedKey("HOME")).toBe(false);
    expect(isSecretShapedKey("NODE_VERSION")).toBe(false);
    expect(isSecretShapedKey("TZ")).toBe(false);
  });

  it("rejects secret-shaped keys even if they sneak into the allowlist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wotann-offload-"));
    const out = join(dir, "out");
    try {
      const result = await captureCloudSnapshot({
        cwd: dir,
        outputDir: out,
        envAllowlist: ["ANTHROPIC_API_KEY", "PATH"],
        env: { ANTHROPIC_API_KEY: "sk-secret", PATH: "/usr/bin" },
        shellExec: makeShellExec({
          "git rev-parse HEAD": { stdout: "deadbeef\n", stderr: "", code: 0 },
          "git status --porcelain": { stdout: "", stderr: "", code: 0 },
        }),
        now: clockNow,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.snapshot.envAllowlist["ANTHROPIC_API_KEY"]).toBeUndefined();
        expect(result.snapshot.envAllowlist["PATH"]).toBe("/usr/bin");
        expect(
          result.snapshot.warnings.some((w) => w.includes("ANTHROPIC_API_KEY")),
        ).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("captureCloudSnapshot — cwd + git capture", () => {
  it("returns ok:false when cwd is empty", async () => {
    const r = await captureCloudSnapshot({ cwd: "", outputDir: "/tmp/x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cwd");
  });

  it("returns ok:false when cwd does not exist", async () => {
    const r = await captureCloudSnapshot({
      cwd: "/definitely/not/a/real/path/xqz",
      outputDir: "/tmp/x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("does not exist");
  });

  it("captures git HEAD when shell returns it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wotann-offload-git-"));
    const out = join(dir, "out");
    try {
      const shell = vi.fn<ShellExec>((cmd, args, _cwd) => {
        if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
          return { stdout: "abc123\n", stderr: "", code: 0 };
        }
        if (cmd === "git" && args[0] === "status") {
          return { stdout: " M file.ts\n", stderr: "", code: 0 };
        }
        return { stdout: "", stderr: "", code: 0 };
      });
      const r = await captureCloudSnapshot({
        cwd: dir,
        outputDir: out,
        env: { PATH: "/usr/bin" },
        shellExec: shell,
        now: () => 1,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.snapshot.gitHead).toBe("abc123");
        expect(r.snapshot.gitStatus).toBe(" M file.ts\n");
        expect(existsSync(out)).toBe(true);
      }
      expect(shell).toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns gitHead=null when repo doesn't exist (non-zero exit)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wotann-offload-nogit-"));
    const out = join(dir, "out");
    try {
      const r = await captureCloudSnapshot({
        cwd: dir,
        outputDir: out,
        env: { PATH: "/usr/bin" },
        shellExec: makeShellExec({
          "git rev-parse HEAD": { stdout: "", stderr: "fatal: not a git repo", code: 128 },
          "git status --porcelain": { stdout: "", stderr: "fatal", code: 128 },
        }),
        now: () => 1,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.snapshot.gitHead).toBe(null);
        expect(r.snapshot.gitStatus).toBe(null);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves to absolute cwd path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wotann-offload-abs-"));
    const out = join(dir, "out");
    try {
      const r = await captureCloudSnapshot({
        cwd: dir,
        outputDir: out,
        env: {},
        shellExec: makeShellExec({}),
        now: () => 42,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.snapshot.cwd.startsWith("/")).toBe(true);
        expect(r.snapshot.capturedAt).toBe(42);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits warning when cwd exceeds maxTarballBytes (du pre-check)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wotann-offload-big-"));
    writeFileSync(join(dir, "one.txt"), "hello");
    const out = join(dir, "out");
    try {
      // du reports 500_000 KB = ~500MB, way over the 1KB cap we pass.
      const r = await captureCloudSnapshot({
        cwd: dir,
        outputDir: out,
        includeTarball: true,
        maxTarballBytes: 1024,
        env: {},
        shellExec: makeShellExec({
          "git rev-parse HEAD": { stdout: "x\n", stderr: "", code: 0 },
          "git status --porcelain": { stdout: "", stderr: "", code: 0 },
          "du -sk": { stdout: "500000\t.\n", stderr: "", code: 0 },
          du: { stdout: "500000\t.\n", stderr: "", code: 0 },
        }),
        now: () => 1,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.snapshot.tarballPath).toBeUndefined();
        expect(r.snapshot.sizeBytes).toBe(0);
        expect(r.snapshot.warnings.some((w) => w.includes("exceeds"))).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes through memoryExportPath when includeMemory is true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wotann-offload-mem-"));
    const out = join(dir, "out");
    try {
      const r = await captureCloudSnapshot({
        cwd: dir,
        outputDir: out,
        includeMemory: true,
        memoryExportPath: "/tmp/memory.jsonl",
        env: {},
        shellExec: makeShellExec({}),
        now: () => 1,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.snapshot.memoryExportPath).toBe("/tmp/memory.jsonl");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── SessionHandle tests ────────────────────────────────────

describe("createSessionHandle", () => {
  let tick: number;
  const clock = (): number => ++tick;

  beforeEach(() => {
    tick = 99;
  });

  it("initial snapshot is pending with zero cost/tokens", () => {
    const h = createSessionHandle({
      sessionId: "s1",
      provider: "fly-sprites",
      now: clock,
    });
    const snap = h.getSnapshot();
    expect(snap.status).toBe("pending");
    expect(snap.costUsd).toBe(0);
    expect(snap.tokensUsed).toBe(0);
    expect(snap.provider).toBe("fly-sprites");
    expect(snap.sessionId).toBe("s1");
    expect(snap.endedAt).toBeUndefined();
  });

  it("uses injected clock deterministically", () => {
    const h = createSessionHandle({
      sessionId: "clk",
      provider: "anthropic-managed",
      now: clock,
    });
    expect(h.startedAt).toBe(100);
  });

  it("addCost accumulates positive values", () => {
    const h = createSessionHandle({
      sessionId: "s",
      provider: "anthropic-managed",
    });
    h.addCost(0.5);
    h.addCost(0.25);
    expect(h.getSnapshot().costUsd).toBeCloseTo(0.75);
  });

  it("addCost rejects negative, NaN, Infinity", () => {
    const h = createSessionHandle({ sessionId: "s", provider: "fly-sprites" });
    h.addCost(1);
    h.addCost(-5);
    h.addCost(NaN);
    h.addCost(Infinity);
    expect(h.getSnapshot().costUsd).toBe(1);
  });

  it("addTokens accumulates non-negative integers only", () => {
    const h = createSessionHandle({ sessionId: "s", provider: "cloudflare-agents" });
    h.addTokens(10);
    h.addTokens(5);
    h.addTokens(-3);
    h.addTokens(1.7);
    expect(h.getSnapshot().tokensUsed).toBe(15);
  });

  it("recordFrame promotes pending → running for non-terminal frames", () => {
    const h = createSessionHandle({ sessionId: "s", provider: "fly-sprites" });
    expect(h.getSnapshot().status).toBe("pending");
    const frame: OffloadFrame = {
      sessionId: "s",
      kind: "stdout",
      content: "hello",
      timestamp: 1,
    };
    h.recordFrame(frame);
    expect(h.getSnapshot().status).toBe("running");
  });

  it("recordFrame fires onUpdate listener", () => {
    const onUpdate = vi.fn();
    const h = createSessionHandle({
      sessionId: "s",
      provider: "fly-sprites",
      onUpdate,
    });
    h.recordFrame({
      sessionId: "s",
      kind: "stdout",
      content: "x",
      timestamp: 1,
    });
    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    expect(lastCall?.[0].status).toBe("running");
  });

  it("addCost fires onUpdate with fresh snapshot", () => {
    const onUpdate = vi.fn();
    const h = createSessionHandle({
      sessionId: "s",
      provider: "anthropic-managed",
      onUpdate,
    });
    h.addCost(0.1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [snap] = onUpdate.mock.calls[0] ?? [];
    expect(snap.costUsd).toBeCloseTo(0.1);
  });

  it("complete() marks status terminal and sets endedAt", () => {
    const h = createSessionHandle({
      sessionId: "s",
      provider: "fly-sprites",
      now: clock,
    });
    const final = h.complete("completed");
    expect(final.status).toBe("completed");
    expect(final.endedAt).toBeDefined();
    expect(final.endedAt! >= h.startedAt).toBe(true);
  });

  it("complete() is idempotent — repeated calls return same endedAt", () => {
    const h = createSessionHandle({
      sessionId: "s",
      provider: "cloudflare-agents",
      now: clock,
    });
    const first = h.complete("failed");
    const second = h.complete("completed");
    expect(second.status).toBe("failed");
    expect(second.endedAt).toBe(first.endedAt);
  });

  it("two handles with the same sessionId do not share state", () => {
    const h1 = createSessionHandle({ sessionId: "dup", provider: "fly-sprites" });
    const h2 = createSessionHandle({ sessionId: "dup", provider: "fly-sprites" });
    h1.addCost(1);
    h2.addCost(5);
    expect(h1.getSnapshot().costUsd).toBe(1);
    expect(h2.getSnapshot().costUsd).toBe(5);
  });

  it("getSnapshot returns a fresh object each call", () => {
    const h = createSessionHandle({ sessionId: "s", provider: "fly-sprites" });
    const s1 = h.getSnapshot();
    const s2 = h.getSnapshot();
    expect(s1).not.toBe(s2);
    expect(s1).toEqual(s2);
  });

  it("addCost after complete is accepted but does not resurrect endedAt", () => {
    const h = createSessionHandle({
      sessionId: "s",
      provider: "anthropic-managed",
      now: clock,
    });
    const final = h.complete("completed");
    h.addCost(0.25);
    const after = h.getSnapshot();
    expect(after.costUsd).toBeCloseTo(0.25);
    expect(after.endedAt).toBe(final.endedAt);
    expect(after.status).toBe("completed");
  });
});
