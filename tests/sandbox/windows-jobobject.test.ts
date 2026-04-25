import { describe, it, expect, vi } from "vitest";
import {
  buildJobObjectLimits,
  createWindowsJobObjectBackend,
} from "../../src/sandbox/backends/windows-jobobject.js";
import type { KernelSandboxPolicy } from "../../src/sandbox/sandbox-policy.js";

const ROOT = process.platform === "win32" ? "C:\\sandbox" : "/sandbox";

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

// ── buildJobObjectLimits ────────────────────

describe("buildJobObjectLimits", () => {
  it("converts memoryLimitMb to bytes", () => {
    const limits = buildJobObjectLimits(policy({ memoryLimitMb: 256 }));
    expect(limits.memoryLimitBytes).toBe(256 * 1024 * 1024);
  });

  it("uses default 512MB when memoryLimitMb absent", () => {
    const limits = buildJobObjectLimits(policy());
    expect(limits.memoryLimitBytes).toBe(512 * 1024 * 1024);
  });

  it("processCountLimit is 1 when allowChildProcesses=false", () => {
    const limits = buildJobObjectLimits(policy({ allowChildProcesses: false }));
    expect(limits.processCountLimit).toBe(1);
  });

  it("processCountLimit is multiple when allowChildProcesses=true", () => {
    const limits = buildJobObjectLimits(policy({ allowChildProcesses: true }));
    expect(limits.processCountLimit).toBeGreaterThan(1);
  });

  it("includes UI restrictions enabled by default", () => {
    const limits = buildJobObjectLimits(policy());
    expect(limits.uiRestrictions.desktop).toBe(true);
    expect(limits.uiRestrictions.readClipboard).toBe(true);
    expect(limits.uiRestrictions.writeClipboard).toBe(true);
  });

  it("preserves allowedReadPaths and allowedWritePaths", () => {
    const limits = buildJobObjectLimits(
      policy({ allowedReadPaths: [ROOT, ROOT + "_lib"], allowedWritePaths: [ROOT] }),
    );
    expect(limits.allowedReadPaths).toEqual([ROOT, ROOT + "_lib"]);
    expect(limits.allowedWritePaths).toEqual([ROOT]);
  });

  it("preserves networkPolicy + endpoints", () => {
    const limits = buildJobObjectLimits(
      policy({
        network: "restricted",
        allowedNetworkEndpoints: ["api.example.com:443"],
      }),
    );
    expect(limits.networkPolicy).toBe("restricted");
    expect(limits.allowedNetworkEndpoints).toEqual(["api.example.com:443"]);
  });

  it("killOnJobClose is always true", () => {
    const limits = buildJobObjectLimits(policy());
    expect(limits.killOnJobClose).toBe(true);
  });
});

// ── Backend availability ────────────────────

describe("createWindowsJobObjectBackend availability", () => {
  it("on non-Windows, isAvailable returns false with reason", async () => {
    if (process.platform === "win32") return;
    const backend = createWindowsJobObjectBackend();
    expect(await backend.isAvailable()).toBe(false);
    expect(backend.unavailableReason).toContain("win32");
  });

  it("on Windows without addon, isAvailable returns false (honest stub)", async () => {
    if (process.platform !== "win32") return;
    const backend = createWindowsJobObjectBackend();
    expect(await backend.isAvailable()).toBe(false);
    expect(backend.unavailableReason).toContain("native addon");
  });

  it("isAvailable returns true if pretendAddonAvailable + on Windows", async () => {
    if (process.platform !== "win32") return;
    const backend = createWindowsJobObjectBackend({ pretendAddonAvailable: true });
    expect(await backend.isAvailable()).toBe(true);
  });
});

// ── Stub honesty ────────────────────────────

describe("createWindowsJobObjectBackend stub behavior", () => {
  it("on non-Windows, run returns ok=false with platform reason", async () => {
    if (process.platform === "win32") return;
    const backend = createWindowsJobObjectBackend();
    const result = await backend.run(["dir"], policy());
    expect(result.ok).toBe(false);
    expect(result.enforced).toBe(false);
    expect(result.reason).toContain("win32");
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects invalid policy with reason", async () => {
    const backend = createWindowsJobObjectBackend({ pretendAddonAvailable: true });
    if (process.platform !== "win32") return;
    const bogus: KernelSandboxPolicy = {
      name: "",
      allowedReadPaths: [],
      allowedWritePaths: [],
      network: "none",
      workingDirectory: "rel",
    };
    const result = await backend.run(["dir"], bogus);
    expect(result.ok).toBe(false);
  });

  it("rejects empty command", async () => {
    const backend = createWindowsJobObjectBackend({ pretendAddonAvailable: true });
    if (process.platform !== "win32") return;
    const result = await backend.run([], policy());
    expect(result.ok).toBe(false);
  });
});

// ── Injected addon runner (test simulation) ─

describe("createWindowsJobObjectBackend with injected addon runner", () => {
  it("delegates to addon runner when provided", async () => {
    if (process.platform !== "win32") {
      // The backend short-circuits on non-win32 — that's correct behavior;
      // we just verify the wiring contract.
      const backend = createWindowsJobObjectBackend({
        addonRunner: vi.fn().mockResolvedValue({
          ok: true,
          exitCode: 0,
          stdout: "fake",
          stderr: "",
          timedOut: false,
          enforced: true,
          backend: "windows-jobobject",
        }),
      });
      const result = await backend.run(["dir"], policy());
      expect(result.ok).toBe(false); // platform check still fires
      return;
    }
    const runner = vi.fn(async () => ({
      ok: true,
      exitCode: 0,
      stdout: "fake",
      stderr: "",
      timedOut: false,
      enforced: true,
      backend: "windows-jobobject",
    }));
    const backend = createWindowsJobObjectBackend({ addonRunner: runner });
    const result = await backend.run(["dir"], policy());
    expect(runner).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("fake");
  });

  it("captures addon runner exceptions as ok=false", async () => {
    if (process.platform !== "win32") return;
    const runner = vi.fn(async () => {
      throw new Error("addon crash");
    });
    const backend = createWindowsJobObjectBackend({ addonRunner: runner });
    const result = await backend.run(["dir"], policy());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("addon crash");
  });
});
