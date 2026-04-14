import { describe, it, expect } from "vitest";
import { ForcedVerificationMiddleware } from "../../src/middleware/forced-verification.js";
import type { VerificationRunner } from "../../src/middleware/forced-verification.js";

const mockRunner: VerificationRunner = {
  async runTypecheck() { return { success: true, output: "" }; },
  async runTests() { return { success: true, output: "" }; },
  async runLint() { return { success: true, output: "" }; },
};

const failingRunner: VerificationRunner = {
  async runTypecheck() { return { success: false, output: "error TS2304: Cannot find name 'foo'" }; },
  async runTests() { return { success: false, output: "FAIL tests/unit/foo.test.ts" }; },
  async runLint() { return { success: true, output: "" }; },
};

describe("ForcedVerificationMiddleware", () => {
  it("triggers verification on Write to .ts files", () => {
    const m = new ForcedVerificationMiddleware();
    expect(m.shouldVerify("Write", "/src/foo.ts")).toBe(true);
    expect(m.isPending()).toBe(true);
  });

  it("triggers verification on Edit to .ts files", () => {
    const m = new ForcedVerificationMiddleware();
    expect(m.shouldVerify("Edit", "/src/bar.tsx")).toBe(true);
  });

  it("skips verification for non-code files", () => {
    const m = new ForcedVerificationMiddleware();
    expect(m.shouldVerify("Write", "/README.md")).toBe(false);
    expect(m.shouldVerify("Write", "/config.yaml")).toBe(false);
    expect(m.shouldVerify("Write", "/styles.css")).toBe(false);
    expect(m.shouldVerify("Write", "/data.json")).toBe(false);
  });

  it("skips verification for non-write tools", () => {
    const m = new ForcedVerificationMiddleware();
    expect(m.shouldVerify("Read", "/src/foo.ts")).toBe(false);
    expect(m.shouldVerify("Bash", "ls")).toBe(false);
  });

  it("passes verification when all checks succeed", async () => {
    const m = new ForcedVerificationMiddleware();
    m.queueFile("/src/foo.ts");
    const result = await m.verify(mockRunner);

    expect(result.passed).toBe(true);
    expect(result.typecheckOk).toBe(true);
    expect(result.testsOk).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails verification when checks fail", async () => {
    const m = new ForcedVerificationMiddleware();
    m.queueFile("/src/foo.ts");
    const result = await m.verify(failingRunner);

    expect(result.passed).toBe(false);
    expect(result.typecheckOk).toBe(false);
    expect(result.testsOk).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("TS2304");
  });

  it("clears pending flag after verification", async () => {
    const m = new ForcedVerificationMiddleware();
    m.queueFile("/src/foo.ts");
    expect(m.isPending()).toBe(true);

    await m.verify(mockRunner);
    expect(m.isPending()).toBe(false);
  });

  it("formats passing result for model", async () => {
    const m = new ForcedVerificationMiddleware();
    m.queueFile("/src/foo.ts");
    const result = await m.verify(mockRunner);
    const formatted = m.formatResultForModel(result);

    expect(formatted).toContain("PASSED");
    expect(formatted).toContain("ok");
  });

  it("formats failing result with error details", async () => {
    const m = new ForcedVerificationMiddleware();
    m.queueFile("/src/foo.ts");
    const result = await m.verify(failingRunner);
    const formatted = m.formatResultForModel(result);

    expect(formatted).toContain("FAILED");
    expect(formatted).toContain("Fix these issues");
  });

  it("tracks statistics", async () => {
    const m = new ForcedVerificationMiddleware();

    m.queueFile("/src/a.ts");
    await m.verify(mockRunner);

    m.queueFile("/src/b.ts");
    await m.verify(failingRunner);

    const stats = m.getStats();
    expect(stats.total).toBe(2);
    expect(stats.passed).toBe(1);
    expect(stats.passRate).toBe(0.5);
  });

  it("respects disabled typecheck", async () => {
    const m = new ForcedVerificationMiddleware({ typecheck: false });
    m.queueFile("/src/foo.ts");
    const result = await m.verify(failingRunner);

    // Typecheck disabled, so typecheckOk should be true (skipped)
    expect(result.typecheckOk).toBe(true);
  });
});
