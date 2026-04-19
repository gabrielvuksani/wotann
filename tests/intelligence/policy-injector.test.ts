import { describe, it, expect, afterEach } from "vitest";
import {
  TAU_BENCH_RETAIL_POLICY,
  TAU_BENCH_AIRLINE_POLICY,
  getPolicy,
  injectPolicy,
  injectPolicyByDomain,
  registerCustomPolicy,
  clearCustomPolicy,
  loadPolicyFromFile,
} from "../../src/intelligence/policy-injector.js";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

afterEach(() => {
  clearCustomPolicy();
});

describe("built-in policies", () => {
  it("retail policy has id, content, reminder", () => {
    expect(TAU_BENCH_RETAIL_POLICY.id).toBe("tau-bench-retail-v1");
    expect(TAU_BENCH_RETAIL_POLICY.content).toContain("30 days");
    expect(TAU_BENCH_RETAIL_POLICY.reminder).toContain("30/90 day");
  });

  it("airline policy has id, content, reminder", () => {
    expect(TAU_BENCH_AIRLINE_POLICY.id).toBe("tau-bench-airline-v1");
    expect(TAU_BENCH_AIRLINE_POLICY.content).toContain("24-hour");
    expect(TAU_BENCH_AIRLINE_POLICY.reminder).toContain("24-hour");
  });

  it("retail policy is bounded (~450 tokens)", () => {
    // Rough char-count check: ~4 chars/token, allow generous ceiling.
    // This is a test that guards against future policy-bloat that would
    // burn context budget.
    expect(TAU_BENCH_RETAIL_POLICY.content.length).toBeLessThan(3000);
  });

  it("airline policy is bounded", () => {
    expect(TAU_BENCH_AIRLINE_POLICY.content.length).toBeLessThan(3000);
  });
});

describe("getPolicy", () => {
  it("returns retail policy for 'retail' domain", () => {
    expect(getPolicy("retail")).toBe(TAU_BENCH_RETAIL_POLICY);
  });

  it("returns airline policy for 'airline' domain", () => {
    expect(getPolicy("airline")).toBe(TAU_BENCH_AIRLINE_POLICY);
  });

  it("returns null for unregistered custom domain", () => {
    expect(getPolicy("custom")).toBeNull();
  });

  it("throws for unknown domain", () => {
    // @ts-expect-error intentionally passing invalid domain
    expect(() => getPolicy("banking")).toThrow(/unknown domain/);
  });
});

describe("injectPolicy", () => {
  const samplePolicy = {
    id: "sample",
    name: "Sample",
    version: "0.0.1",
    content: "# Rules\nDo X, not Y.",
    reminder: "Do X, not Y.",
  };

  it("prepends policy content before existing system prompt", () => {
    const out = injectPolicy("You are a helpful assistant.", samplePolicy);
    expect(out.indexOf("# Rules")).toBeLessThan(out.indexOf("You are a helpful"));
  });

  it("uses full content by default", () => {
    const out = injectPolicy("sp", samplePolicy);
    expect(out).toContain("Do X, not Y");
  });

  it("uses reminder when fullContent=false", () => {
    const out = injectPolicy("sp", samplePolicy, { fullContent: false });
    expect(out).toContain("Do X, not Y.");
    expect(out).not.toContain("# Rules\nDo X"); // not the full content
  });

  it("includes name and version in header", () => {
    const out = injectPolicy("sp", samplePolicy);
    expect(out).toContain("Active Policy: Sample (0.0.1)");
  });

  it("returns only the policy block when system prompt is empty", () => {
    const out = injectPolicy("", samplePolicy);
    expect(out).toContain("# Rules");
    expect(out.trim().endsWith("Do X, not Y.")).toBe(true);
  });

  it("uses custom separator when provided", () => {
    const out = injectPolicy("sp", samplePolicy, { separator: "\n===\n" });
    expect(out).toContain("\n===\n");
  });

  it("falls back to content when reminder is undefined", () => {
    const noReminderPolicy = { ...samplePolicy, reminder: undefined };
    const out = injectPolicy("sp", noReminderPolicy, { fullContent: false });
    expect(out).toContain("# Rules");
  });
});

describe("injectPolicyByDomain", () => {
  it("injects retail policy for 'retail'", () => {
    const out = injectPolicyByDomain("Base prompt.", "retail");
    expect(out).toContain("Retail Customer-Service Policy");
  });

  it("injects airline policy for 'airline'", () => {
    const out = injectPolicyByDomain("Base prompt.", "airline");
    expect(out).toContain("Airline Customer-Service Policy");
  });

  it("returns unchanged prompt when domain is 'custom' and unregistered", () => {
    const base = "Base prompt.";
    expect(injectPolicyByDomain(base, "custom")).toBe(base);
  });

  it("injects registered custom policy", () => {
    registerCustomPolicy({
      id: "custom-x",
      name: "Custom",
      version: "1",
      content: "Custom rules here.",
    });
    const out = injectPolicyByDomain("sp", "custom");
    expect(out).toContain("Custom rules here");
  });
});

describe("loadPolicyFromFile", () => {
  it("reads a file and wraps it as a PolicyDocument", async () => {
    const path = join(tmpdir(), `wotann-policy-test-${Date.now()}.md`);
    await writeFile(path, "# My Policy\nRule 1.\nRule 2.\n");
    try {
      const policy = await loadPolicyFromFile(path);
      expect(policy.content).toContain("Rule 1");
      expect(policy.version).toBe("custom");
      expect(policy.id).not.toContain(".md");
    } finally {
      await unlink(path).catch(() => undefined);
    }
  });

  it("accepts overrides for id/name/version/reminder", async () => {
    const path = join(tmpdir(), `wotann-policy-test-${Date.now()}.txt`);
    await writeFile(path, "content");
    try {
      const policy = await loadPolicyFromFile(path, {
        id: "explicit-id",
        name: "Explicit",
        version: "2.3.4",
        reminder: "r",
      });
      expect(policy.id).toBe("explicit-id");
      expect(policy.name).toBe("Explicit");
      expect(policy.version).toBe("2.3.4");
      expect(policy.reminder).toBe("r");
    } finally {
      await unlink(path).catch(() => undefined);
    }
  });
});

describe("registerCustomPolicy / clearCustomPolicy", () => {
  it("register overwrites previous custom", () => {
    registerCustomPolicy({ id: "a", name: "A", version: "1", content: "A rules" });
    registerCustomPolicy({ id: "b", name: "B", version: "1", content: "B rules" });
    const out = injectPolicyByDomain("sp", "custom");
    expect(out).toContain("B rules");
    expect(out).not.toContain("A rules");
  });

  it("clear returns custom to null", () => {
    registerCustomPolicy({ id: "a", name: "A", version: "1", content: "A rules" });
    clearCustomPolicy();
    expect(getPolicy("custom")).toBeNull();
  });
});
