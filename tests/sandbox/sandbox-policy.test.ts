import { describe, it, expect } from "vitest";
import {
  validatePolicy,
  isInside,
  defaultPolicy,
  stubResult,
  type KernelSandboxPolicy,
} from "../../src/sandbox/sandbox-policy.js";
import { join } from "node:path";

const ROOT = process.platform === "win32" ? "C:\\sandbox" : "/sandbox";

function basePolicy(overrides: Partial<KernelSandboxPolicy> = {}): KernelSandboxPolicy {
  return {
    name: "t",
    allowedReadPaths: [ROOT],
    allowedWritePaths: [],
    network: "none",
    workingDirectory: ROOT,
    ...overrides,
  };
}

// ── isInside ───────────────────────────────────

describe("isInside", () => {
  it("returns true for child of parent", () => {
    expect(isInside(join(ROOT, "sub"), ROOT)).toBe(true);
  });
  it("returns true for same path", () => {
    expect(isInside(ROOT, ROOT)).toBe(true);
  });
  it("returns false for sibling path", () => {
    const sibling = process.platform === "win32" ? "C:\\other" : "/other";
    expect(isInside(sibling, ROOT)).toBe(false);
  });
  it("returns false for path that's a prefix but not a subdir", () => {
    expect(isInside(ROOT + "x", ROOT)).toBe(false);
  });
});

// ── validatePolicy ───────────────────────────────

describe("validatePolicy", () => {
  it("accepts a minimal valid policy", () => {
    const result = validatePolicy(basePolicy());
    expect(result.ok).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validatePolicy(basePolicy({ name: "" }));
    expect(result.ok).toBe(false);
  });

  it("rejects relative read paths", () => {
    const result = validatePolicy(basePolicy({ allowedReadPaths: ["./relative"] }));
    expect(result.ok).toBe(false);
  });

  it("rejects read paths with parent traversal", () => {
    const result = validatePolicy(basePolicy({ allowedReadPaths: [ROOT + "/../etc"] }));
    expect(result.ok).toBe(false);
  });

  it("rejects relative write paths", () => {
    const result = validatePolicy(
      basePolicy({ allowedWritePaths: ["relative"] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects non-absolute working directory", () => {
    const result = validatePolicy(basePolicy({ workingDirectory: "rel" }));
    expect(result.ok).toBe(false);
  });

  it("rejects working directory not in any allowed path", () => {
    const outsideDir = process.platform === "win32" ? "C:\\elsewhere" : "/elsewhere";
    const result = validatePolicy(
      basePolicy({ allowedReadPaths: [ROOT], workingDirectory: outsideDir }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts wd in allowedWritePaths even if not in readPaths", () => {
    const result = validatePolicy(
      basePolicy({ allowedReadPaths: [], allowedWritePaths: [ROOT], workingDirectory: ROOT }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unknown network mode", () => {
    const result = validatePolicy(
      basePolicy({ network: "weird" as KernelSandboxPolicy["network"] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects invalid network endpoint", () => {
    const result = validatePolicy(
      basePolicy({
        network: "restricted",
        allowedNetworkEndpoints: ["nohost"],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts host:port endpoint", () => {
    const result = validatePolicy(
      basePolicy({ network: "restricted", allowedNetworkEndpoints: ["api.example.com:443"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts host:* endpoint", () => {
    const result = validatePolicy(
      basePolicy({ network: "restricted", allowedNetworkEndpoints: ["api.example.com:*"] }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects timeoutSeconds <= 0", () => {
    const result = validatePolicy(basePolicy({ timeoutSeconds: 0 }));
    expect(result.ok).toBe(false);
  });

  it("rejects negative memoryLimitMb", () => {
    const result = validatePolicy(basePolicy({ memoryLimitMb: -1 }));
    expect(result.ok).toBe(false);
  });
});

// ── defaultPolicy ───────────────────────────────

describe("defaultPolicy", () => {
  it("creates a deny-by-default policy", () => {
    const p = defaultPolicy(ROOT);
    expect(p.network).toBe("none");
    expect(p.allowedWritePaths).toEqual([]);
    expect(p.allowedReadPaths).toContain(ROOT);
    expect(p.workingDirectory).toBe(ROOT);
  });

  it("returns a policy that passes validation", () => {
    const p = defaultPolicy(ROOT);
    const v = validatePolicy(p);
    expect(v.ok).toBe(true);
  });
});

// ── stubResult ─────────────────────────────────

describe("stubResult", () => {
  it("returns ok=false with reason and zero state", () => {
    const r = stubResult("test reason");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("test reason");
    expect(r.enforced).toBe(false);
    expect(r.exitCode).toBeNull();
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });
  it("uses default backend name 'stub'", () => {
    const r = stubResult("x");
    expect(r.backend).toBe("stub");
  });
  it("accepts custom backend name", () => {
    const r = stubResult("x", "seatbelt");
    expect(r.backend).toBe("seatbelt");
  });
});
