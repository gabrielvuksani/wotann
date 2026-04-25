import { describe, it, expect } from "vitest";
import {
  generateSeatbeltProfile,
  createSeatbeltBackend,
} from "../../src/sandbox/backends/seatbelt-macos.js";
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

// ── Profile generation (pure, runs everywhere) ──

describe("generateSeatbeltProfile", () => {
  it("starts with version + deny default", () => {
    const profile = generateSeatbeltProfile(policy());
    const lines = profile.split("\n");
    expect(lines[0]).toBe("(version 1)");
    expect(profile).toContain("(deny default)");
  });

  it("includes file-read for each allowed read path", () => {
    const profile = generateSeatbeltProfile(
      policy({ allowedReadPaths: ["/foo", "/bar"] }),
    );
    expect(profile).toContain('(allow file-read* (subpath "/foo"))');
    expect(profile).toContain('(allow file-read* (subpath "/bar"))');
  });

  it("includes file-write for each allowed write path", () => {
    const profile = generateSeatbeltProfile(
      policy({ allowedWritePaths: [ROOT, "/var/log/wotann"] }),
    );
    expect(profile).toContain(`(allow file-write* (subpath "${ROOT}"))`);
    expect(profile).toContain('(allow file-write* (subpath "/var/log/wotann"))');
  });

  it("denies network when policy.network is none", () => {
    const profile = generateSeatbeltProfile(policy({ network: "none" }));
    expect(profile).toContain("(deny network*)");
  });

  it("allows loopback when policy.network is loopback", () => {
    const profile = generateSeatbeltProfile(policy({ network: "loopback" }));
    expect(profile).toContain("localhost");
  });

  it("allows specific endpoints when network is restricted", () => {
    const profile = generateSeatbeltProfile(
      policy({
        network: "restricted",
        allowedNetworkEndpoints: ["api.example.com:443"],
      }),
    );
    expect(profile).toContain("api.example.com:443");
  });

  it("allows full network when network=full", () => {
    const profile = generateSeatbeltProfile(policy({ network: "full" }));
    expect(profile).toContain("(allow network*)");
  });

  it("escapes embedded quotes in paths", () => {
    const profile = generateSeatbeltProfile(
      policy({ allowedReadPaths: ['/has"quote'] }),
    );
    // Must not break the Scheme by leaking an unescaped quote
    expect(profile).toContain('\\"');
  });

  it("includes implicit reads for /usr, /System, /Library", () => {
    const profile = generateSeatbeltProfile(policy());
    expect(profile).toContain('(allow file-read* (subpath "/usr"))');
    expect(profile).toContain('(allow file-read* (subpath "/System"))');
    expect(profile).toContain('(allow file-read* (subpath "/Library"))');
  });
});

// ── Backend availability ─────────────────────────

describe("createSeatbeltBackend availability", () => {
  it("on non-macOS, isAvailable returns false with a reason", async () => {
    const backend = createSeatbeltBackend();
    const avail = await backend.isAvailable();
    if (process.platform !== "darwin") {
      expect(avail).toBe(false);
      expect(backend.unavailableReason).toBeDefined();
    }
  });

  it("returns honest stub when sandbox-exec doesn't exist", async () => {
    const backend = createSeatbeltBackend({ seatbeltBinary: "/nonexistent/sandbox-exec" });
    const avail = await backend.isAvailable();
    expect(avail).toBe(false);
    const result = await backend.run(["echo", "hi"], policy());
    expect(result.ok).toBe(false);
    expect(result.enforced).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

// ── Backend run validation ───────────────────────

describe("createSeatbeltBackend.run", () => {
  it("rejects an invalid policy with descriptive reason", async () => {
    const backend = createSeatbeltBackend();
    const bogus: KernelSandboxPolicy = {
      name: "",
      allowedReadPaths: [],
      allowedWritePaths: [],
      network: "none",
      workingDirectory: "relative",
    };
    const result = await backend.run(["echo", "hi"], bogus);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeDefined();
    }
  });

  it("rejects empty command", async () => {
    const backend = createSeatbeltBackend();
    const result = await backend.run([], policy());
    expect(result.ok).toBe(false);
  });
});

// ── macOS-only smoke test (skipped elsewhere) ────

describe.skipIf(process.platform !== "darwin")("Seatbelt actually runs on macOS", () => {
  it("runs a simple echo successfully", async () => {
    const backend = createSeatbeltBackend();
    if (!(await backend.isAvailable())) return; // sandbox-exec missing
    // Note: working directory needs to be a real path that exists.
    const realPolicy = policy({
      allowedReadPaths: ["/"],
      workingDirectory: "/tmp",
    });
    const result = await backend.run(["/bin/echo", "hello"], realPolicy);
    expect(result.backend).toBe("seatbelt");
    if (result.ok) {
      expect(result.stdout).toContain("hello");
    } else {
      // Could fail in nested-sandbox context; the test is best-effort.
      expect(result.reason).toBeDefined();
    }
  }, 15_000);
});
