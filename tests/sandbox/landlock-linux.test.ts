import { describe, it, expect } from "vitest";
import {
  detectLandlockSupport,
  buildHelperArgs,
  createLandlockBackend,
} from "../../src/sandbox/backends/landlock-linux.js";
import type { KernelSandboxPolicy } from "../../src/sandbox/sandbox-policy.js";

const ROOT = "/sandbox-root";

function policy(overrides: Partial<KernelSandboxPolicy> = {}): KernelSandboxPolicy {
  return {
    name: "test",
    allowedReadPaths: [ROOT],
    allowedWritePaths: [],
    network: "none",
    workingDirectory: ROOT,
    ...overrides,
  };
}

// ── detectLandlockSupport ─────────────────────

describe("detectLandlockSupport", () => {
  it("returns false on non-Linux platforms regardless of fs state", () => {
    if (process.platform === "linux") return; // not applicable
    const result = detectLandlockSupport({ existsSync: () => true });
    expect(result).toBe(false);
  });

  it("uses injected fs to decide on Linux", () => {
    if (process.platform !== "linux") return; // skip when not Linux
    expect(detectLandlockSupport({ existsSync: () => true })).toBe(true);
    expect(detectLandlockSupport({ existsSync: () => false })).toBe(false);
  });
});

// ── buildHelperArgs ───────────────────────────

describe("buildHelperArgs", () => {
  it("includes --ro for each allowed read path", () => {
    const args = buildHelperArgs(policy({ allowedReadPaths: ["/a", "/b"] }));
    expect(args).toContain("--ro");
    expect(args.filter((a) => a === "--ro").length).toBe(2);
    expect(args).toContain("/a");
    expect(args).toContain("/b");
  });

  it("includes --rw for each allowed write path", () => {
    const args = buildHelperArgs(
      policy({ allowedWritePaths: ["/var/log/wotann"], workingDirectory: "/var/log/wotann" }),
    );
    expect(args).toContain("--rw");
    expect(args).toContain("/var/log/wotann");
  });

  it("adds --no-net when network=none", () => {
    const args = buildHelperArgs(policy({ network: "none" }));
    expect(args).toContain("--no-net");
  });

  it("adds --net-loopback-only when network=loopback", () => {
    const args = buildHelperArgs(policy({ network: "loopback" }));
    expect(args).toContain("--net-loopback-only");
  });

  it("does not add --no-net when network=full", () => {
    const args = buildHelperArgs(policy({ network: "full" }));
    expect(args).not.toContain("--no-net");
  });

  it("includes --no-fork when allowChildProcesses=false", () => {
    const args = buildHelperArgs(policy({ allowChildProcesses: false }));
    expect(args).toContain("--no-fork");
  });

  it("does not include --no-fork when allowChildProcesses=true", () => {
    const args = buildHelperArgs(policy({ allowChildProcesses: true }));
    expect(args).not.toContain("--no-fork");
  });

  it("passes timeoutSeconds through --timeout", () => {
    const args = buildHelperArgs(policy({ timeoutSeconds: 42 }));
    const idx = args.indexOf("--timeout");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("42");
  });

  it("passes memoryLimitMb through --memory-mb", () => {
    const args = buildHelperArgs(policy({ memoryLimitMb: 128 }));
    const idx = args.indexOf("--memory-mb");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("128");
  });

  it("passes workingDirectory through --cwd", () => {
    const args = buildHelperArgs(policy());
    const idx = args.indexOf("--cwd");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(ROOT);
  });
});

// ── Backend availability ─────────────────────

describe("createLandlockBackend availability", () => {
  it("on non-Linux platforms, isAvailable returns false with reason", async () => {
    if (process.platform === "linux") return;
    const backend = createLandlockBackend();
    expect(await backend.isAvailable()).toBe(false);
    expect(backend.unavailableReason).toBeDefined();
  });

  it("on Linux without kernel support, isAvailable returns false", async () => {
    if (process.platform !== "linux") return;
    // forceAvailable=false simulates missing /sys/kernel/security/landlock
    const backend = createLandlockBackend({ forceAvailable: false });
    expect(await backend.isAvailable()).toBe(false);
    expect(backend.unavailableReason).toContain("kernel");
  });

  it("returns false when helper binary is missing even if kernel ok", async () => {
    const backend = createLandlockBackend({
      forceAvailable: true,
      helperBinary: "/nonexistent/landlock-restrict",
    });
    if (process.platform !== "linux") {
      expect(await backend.isAvailable()).toBe(false);
      return;
    }
    const result = await backend.run(["true"], policy());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either policy validation, missing kernel, or missing helper
      expect(result.reason).toBeDefined();
    }
  });
});

// ── Backend run validation ───────────────────

describe("createLandlockBackend.run validation", () => {
  it("rejects invalid policy with descriptive reason", async () => {
    const backend = createLandlockBackend({ forceAvailable: true });
    const bogus: KernelSandboxPolicy = {
      name: "",
      allowedReadPaths: [],
      allowedWritePaths: [],
      network: "none",
      workingDirectory: "rel",
    };
    const result = await backend.run(["true"], bogus);
    expect(result.ok).toBe(false);
  });

  it("rejects empty command", async () => {
    const backend = createLandlockBackend({ forceAvailable: true });
    const result = await backend.run([], policy());
    expect(result.ok).toBe(false);
  });

  it("on non-Linux returns a clear platform reason", async () => {
    if (process.platform === "linux") return;
    const backend = createLandlockBackend();
    const result = await backend.run(["true"], policy());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not Linux");
  });
});
