import { describe, it, expect } from "vitest";
import { loadTrackedRepos } from "../../src/monitoring/source-monitor.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

// Quality bar #13 — no silent skips. The previous version of this file
// gated every test on `existsSync("../../../research/monitor-config.yaml")`,
// which is a PARENT-repo path that CI never checks out. Every
// `itIfConfig` block silently `.skip`-ed and the suite reported "N tests
// passed" with zero assertions actually running. The fix: ship a
// deterministic fixture under `tests/fixtures/` so the core parser
// contract is exercised on every CI run. A separate opt-in block keeps
// the real-world parity check for local dev, but only when the live
// config is reachable — AND the opt-in block uses `it.skip` with an
// explicit reason instead of a hidden conditional reassignment.

const FIXTURE_PATH = join(__dirname, "../fixtures/monitor-config.test.yaml");
const LIVE_CONFIG_PATH = join(__dirname, "../../../research/monitor-config.yaml");
const HAS_LIVE_CONFIG = existsSync(LIVE_CONFIG_PATH);

describe("Source Monitor — loadTrackedRepos (fixture-driven, always-on)", () => {
  it("loads repos from the test-fixture yaml", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    // Fixture contains exactly 3 cloned_repos entries — any drift here
    // is either fixture corruption or parser regression.
    expect(repos.length).toBe(3);
  });

  it("parses repo names from all three entries", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    const names = repos.map((r) => r.name);
    expect(names).toEqual(["agents", "deepagents", "opcode"]);
  });

  it("parses remote URLs as github.com origins", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    const agents = repos.find((r) => r.name === "agents");
    expect(agents).toBeDefined();
    expect(agents?.remote).toBe("https://github.com/wshobson/agents.git");
  });

  it("parses all three priority levels from the fixture", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    const priorities = new Set(repos.map((r) => r.priority));
    // Fixture has exactly one of each: high / medium / low.
    expect(priorities.has("high")).toBe(true);
    expect(priorities.has("medium")).toBe(true);
    expect(priorities.has("low")).toBe(true);
  });

  it("parses all three check_schedule values from the fixture", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    const schedules = new Set(repos.map((r) => r.checkSchedule));
    expect(schedules.has("daily")).toBe(true);
    expect(schedules.has("weekly")).toBe(true);
    expect(schedules.has("monthly")).toBe(true);
  });

  it("parses inline watch_patterns arrays with quoted strings", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    const agents = repos.find((r) => r.name === "agents");
    expect(agents?.watchPatterns).toEqual(["plugins/**", "skills/**", "tools/**"]);
  });

  it("parses inline extracted_features arrays", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    const deep = repos.find((r) => r.name === "deepagents");
    expect(deep?.extractedFeatures).toEqual([
      "trust-the-model",
      "tiered tool loading",
    ]);
  });

  it("defaults watchPatterns and extractedFeatures to empty when absent", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    // `opcode` entry deliberately omits watch_patterns +
    // extracted_features to exercise the default-empty-array branch.
    const opcode = repos.find((r) => r.name === "opcode");
    expect(opcode).toBeDefined();
    expect(opcode?.watchPatterns).toEqual([]);
    expect(opcode?.extractedFeatures).toEqual([]);
  });

  it("returns empty array for nonexistent config", () => {
    const repos = loadTrackedRepos("/nonexistent/config.yaml");
    expect(repos).toEqual([]);
  });

  it("returns readonly TrackedRepo shape (required fields populated)", () => {
    const repos = loadTrackedRepos(FIXTURE_PATH);
    for (const repo of repos) {
      expect(typeof repo.name).toBe("string");
      expect(repo.name.length).toBeGreaterThan(0);
      expect(typeof repo.branch).toBe("string");
      expect(["high", "medium", "low"]).toContain(repo.priority);
      expect(["daily", "weekly", "monthly"]).toContain(repo.checkSchedule);
      expect(Array.isArray(repo.watchPatterns)).toBe(true);
      expect(Array.isArray(repo.extractedFeatures)).toBe(true);
    }
  });
});

// Opt-in live-config parity check. Runs only when the parent-repo's
// `research/monitor-config.yaml` is reachable (typical local dev). On
// CI (where only `wotann/` is checked out) the file is absent and the
// tests are explicitly `.skip`-ed — visible in test output (not
// silently dropped). Quality bar #13: skips must be visible.
// When HAS_LIVE_CONFIG is false, `.skip` keeps the test name so the
// skip reason is visible in vitest's run summary.
describe("Source Monitor — live config parity (opt-in, local-only)", () => {
  const itOrSkip = HAS_LIVE_CONFIG ? it : it.skip;

  itOrSkip(
    "live config yields same TrackedRepo shape as fixture (requires ../../research/monitor-config.yaml)",
    () => {
      const repos = loadTrackedRepos(LIVE_CONFIG_PATH);
      // The real config has many more repos than the fixture; here we
      // only verify the core shape invariants still hold. Note: the
      // live yaml uses a wider priority vocabulary (`dormant` in
      // addition to high/medium/low) so we only assert non-empty
      // string, not the fixture's strict union.
      expect(repos.length).toBeGreaterThan(0);
      for (const repo of repos) {
        expect(typeof repo.name).toBe("string");
        expect(repo.name.length).toBeGreaterThan(0);
        expect(typeof repo.priority).toBe("string");
        expect(repo.priority.length).toBeGreaterThan(0);
        expect(["daily", "weekly", "monthly"]).toContain(repo.checkSchedule);
      }
    },
  );

  itOrSkip(
    "live config contains expected canonical repos: agents, deepagents (requires parent-repo checkout)",
    () => {
      const repos = loadTrackedRepos(LIVE_CONFIG_PATH);
      const names = repos.map((r) => r.name);
      expect(names).toContain("agents");
      expect(names).toContain("deepagents");
    },
  );
});
