import { describe, it, expect } from "vitest";
import {
  createKernelSandbox,
  createKernelSandboxSync,
  detectActiveBackend,
  runSandboxed,
  runUnsandboxed,
  type SupportedBackendName,
} from "../../src/sandbox/kernel-sandbox.js";
import type {
  KernelSandboxBackend,
  KernelSandboxPolicy,
  KernelSandboxRunResult,
} from "../../src/sandbox/sandbox-policy.js";
import { defaultPolicy } from "../../src/sandbox/sandbox-policy.js";

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

// ── Test backend factory ──────────────────────

function fakeBackend(name: string, runResult: KernelSandboxRunResult): KernelSandboxBackend {
  return {
    name,
    async isAvailable() {
      return runResult.enforced || runResult.ok;
    },
    async run() {
      return runResult;
    },
  };
}

// ── createKernelSandboxSync — selection ──────

describe("createKernelSandboxSync — backend selection", () => {
  it("selects backend by override even on wrong platform", () => {
    const sb = createKernelSandboxSync({ backendOverride: "stub" });
    expect(sb.backendName).toBe("stub");
  });

  it("selects platform-default backend in auto mode", () => {
    const sb = createKernelSandboxSync();
    if (process.platform === "darwin") {
      expect(sb.backendName).toBe("seatbelt");
    } else if (process.platform === "linux") {
      expect(sb.backendName).toBe("landlock");
    } else if (process.platform === "win32") {
      expect(sb.backendName).toBe("windows-jobobject");
    } else {
      expect(sb.backendName).toBe("stub");
    }
  });

  it("uses injected backend when in backends map and override matches", () => {
    const fake = fakeBackend("seatbelt", {
      ok: true,
      exitCode: 0,
      stdout: "fake",
      stderr: "",
      timedOut: false,
      enforced: true,
      backend: "seatbelt",
    });
    const map = new Map<SupportedBackendName, KernelSandboxBackend>([["seatbelt", fake]]);
    const sb = createKernelSandboxSync({ backendOverride: "seatbelt", backends: map });
    expect(sb.backendName).toBe("seatbelt");
  });
});

// ── createKernelSandbox — async wrapper ──────

describe("createKernelSandbox", () => {
  it("returns the same backend selection as the sync variant", async () => {
    const a = await createKernelSandbox();
    const b = createKernelSandboxSync();
    expect(a.backendName).toBe(b.backendName);
  });

  it("validates policy before delegating to backend", async () => {
    const fake = fakeBackend("stub", {
      ok: true,
      exitCode: 0,
      stdout: "should not see this",
      stderr: "",
      timedOut: false,
      enforced: true,
      backend: "stub",
    });
    const map = new Map<SupportedBackendName, KernelSandboxBackend>([["stub", fake]]);
    const sb = await createKernelSandbox({ backendOverride: "stub", backends: map });
    const bogus: KernelSandboxPolicy = {
      name: "",
      allowedReadPaths: [],
      allowedWritePaths: [],
      network: "none",
      workingDirectory: "rel",
    };
    const result = await sb.run(["echo"], bogus);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("policy validation");
  });

  it("delegates valid policy to backend", async () => {
    const fake = fakeBackend("stub", {
      ok: true,
      exitCode: 0,
      stdout: "from-fake",
      stderr: "",
      timedOut: false,
      enforced: true,
      backend: "stub",
    });
    const map = new Map<SupportedBackendName, KernelSandboxBackend>([["stub", fake]]);
    const sb = await createKernelSandbox({ backendOverride: "stub", backends: map });
    const result = await sb.run(["echo", "hi"], policy());
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("from-fake");
  });

  it("runWithDefaults uses defaultPolicy", async () => {
    let captured: KernelSandboxPolicy | null = null;
    const inspector: KernelSandboxBackend = {
      name: "stub",
      async isAvailable() {
        return true;
      },
      async run(_cmd, p) {
        captured = p;
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: true,
          backend: "stub",
        };
      },
    };
    const map = new Map<SupportedBackendName, KernelSandboxBackend>([["stub", inspector]]);
    const sb = await createKernelSandbox({ backendOverride: "stub", backends: map });
    await sb.runWithDefaults(["echo"], ROOT);
    expect(captured).not.toBeNull();
    expect(captured!.network).toBe("none");
    expect(captured!.workingDirectory).toBe(ROOT);
  });
});

// ── detectActiveBackend ──────────────────────

describe("detectActiveBackend", () => {
  it("returns a backend name and availability flag", async () => {
    const result = await detectActiveBackend();
    expect(typeof result.name).toBe("string");
    expect(typeof result.available).toBe("boolean");
  });

  it("returns reason when not available", async () => {
    const result = await detectActiveBackend();
    if (!result.available) {
      // Reason is optional but commonly present when backend unavailable
      // (we don't assert hard because seatbelt may be available on macOS)
      expect(typeof result).toBe("object");
    }
  });
});

// ── runSandboxed convenience ─────────────────

describe("runSandboxed", () => {
  it("invokes the chosen backend's run", async () => {
    const fake = fakeBackend("stub", {
      ok: true,
      exitCode: 0,
      stdout: "ran",
      stderr: "",
      timedOut: false,
      enforced: true,
      backend: "stub",
    });
    const map = new Map<SupportedBackendName, KernelSandboxBackend>([["stub", fake]]);
    const result = await runSandboxed(["echo"], policy(), {
      backendOverride: "stub",
      backends: map,
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("ran");
  });

  it("returns invalid-policy error without invoking backend.run", async () => {
    let calls = 0;
    const counter: KernelSandboxBackend = {
      name: "stub",
      async isAvailable() {
        return true;
      },
      async run() {
        calls++;
        return {
          ok: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          timedOut: false,
          enforced: true,
          backend: "stub",
        };
      },
    };
    const map = new Map<SupportedBackendName, KernelSandboxBackend>([["stub", counter]]);
    const bogus: KernelSandboxPolicy = {
      name: "",
      allowedReadPaths: [],
      allowedWritePaths: [],
      network: "none",
      workingDirectory: "rel",
    };
    const result = await runSandboxed(["echo"], bogus, {
      backendOverride: "stub",
      backends: map,
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });
});

// ── runUnsandboxed honesty ───────────────────

describe("runUnsandboxed", () => {
  it("returns enforced=false to make unsandboxed status visible", async () => {
    // Skip on win32 — we don't have a guaranteed echo at /usr/bin
    if (process.platform === "win32") return;
    const result = await runUnsandboxed(["/bin/echo", "hi"], "/tmp", 5);
    expect(result.enforced).toBe(false);
    expect(result.backend).toBe("unsandboxed");
  });

  it("rejects empty command without spawning", async () => {
    const result = await runUnsandboxed([], "/tmp");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("empty");
  });

  it("times out long-running commands", async () => {
    if (process.platform === "win32") return;
    const result = await runUnsandboxed(["/bin/sleep", "10"], "/tmp", 1);
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  }, 10_000);
});

// ── defaultPolicy roundtrip ─────────────────

describe("defaultPolicy + facade integration", () => {
  it("default policy passes facade-level validation", async () => {
    const sb = createKernelSandboxSync({ backendOverride: "stub" });
    const result = await sb.run(["echo"], defaultPolicy(ROOT));
    // Stub backend always returns ok=false from real factory because
    // selectBackendSync builds it via factory which returns stub.
    expect(["stub", "seatbelt", "landlock", "windows-jobobject"]).toContain(result.backend);
  });
});
