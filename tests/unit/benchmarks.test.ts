import { describe, it, expect } from "vitest";
import { createDefaultBenchmarks, runBenchmarks } from "../../src/telemetry/benchmarks.js";

describe("Benchmarks", () => {
  it("creates default benchmark suite", () => {
    const suite = createDefaultBenchmarks();
    expect(suite.id).toBe("wotann-default-v1");
    expect(suite.tests.length).toBeGreaterThan(3);
    expect(suite.tests.every((t) => t.id && t.name && t.category)).toBe(true);
  });

  it("runs all default benchmarks", async () => {
    const suite = createDefaultBenchmarks();
    const bundle = await runBenchmarks(suite, {
      os: "test",
      node: process.version,
      providers: ["anthropic"],
    });

    expect(bundle.version).toBe("1.0.0");
    expect(bundle.harness).toBe("wotann");
    expect(bundle.results.length).toBe(suite.tests.length);
    expect(bundle.summary.total).toBe(suite.tests.length);
    expect(bundle.summary.passed + bundle.summary.failed).toBe(bundle.summary.total);
  });

  it("boot-time benchmark passes (under 2s)", async () => {
    const suite = createDefaultBenchmarks();
    const bootTest = suite.tests.find((t) => t.id === "boot-time")!;

    const result = await bootTest.run();
    expect(result.passed).toBe(true);
    expect(result.value).toBeLessThan(2000);
    expect(result.unit).toBe("ms");
  });

  it("fallback-latency benchmark passes", async () => {
    const suite = createDefaultBenchmarks();
    const test = suite.tests.find((t) => t.id === "fallback-latency")!;

    const result = await test.run();
    expect(result.passed).toBe(true);
    expect(result.value).toBeLessThan(500);
  });

  it("security-compliance benchmark passes", async () => {
    const suite = createDefaultBenchmarks();
    const test = suite.tests.find((t) => t.id === "security-compliance")!;

    const result = await test.run();
    expect(result.passed).toBe(true);
    expect(result.value).toBeGreaterThanOrEqual(80);
    expect(result.unit).toBe("%");
  });

  it("proof bundle has correct environment info", async () => {
    const suite = createDefaultBenchmarks();
    const bundle = await runBenchmarks(suite, {
      os: "darwin",
      node: "v22.0.0",
      providers: ["anthropic", "openai"],
    });

    expect(bundle.environment.os).toBe("darwin");
    expect(bundle.environment.node).toBe("v22.0.0");
    expect(bundle.environment.providers).toEqual(["anthropic", "openai"]);
  });

  it("calculates average improvement", async () => {
    const suite = createDefaultBenchmarks();
    const bundle = await runBenchmarks(suite, { os: "test", node: "v22", providers: [] });

    // avgImprovement should be a number
    expect(typeof bundle.summary.avgImprovement).toBe("number");
  });
});
