import { describe, it, expect } from "vitest";
import { loadTrackedRepos } from "../../src/monitoring/source-monitor.js";
import { join } from "node:path";

const CONFIG_PATH = join(__dirname, "../../../research/monitor-config.yaml");

describe("Source Monitor", () => {
  describe("loadTrackedRepos", () => {
    it("loads repos from monitor-config.yaml", () => {
      const repos = loadTrackedRepos(CONFIG_PATH);
      expect(repos.length).toBeGreaterThan(0);
    });

    it("parses repo names correctly", () => {
      const repos = loadTrackedRepos(CONFIG_PATH);
      const names = repos.map((r) => r.name);
      expect(names).toContain("agents");
      expect(names).toContain("deepagents");
    });

    it("parses remote URLs", () => {
      const repos = loadTrackedRepos(CONFIG_PATH);
      const agents = repos.find((r) => r.name === "agents");
      expect(agents?.remote).toContain("github.com");
    });

    it("parses priority levels", () => {
      const repos = loadTrackedRepos(CONFIG_PATH);
      const priorities = new Set(repos.map((r) => r.priority));
      expect(priorities.has("high") || priorities.has("medium") || priorities.has("low")).toBe(true);
    });

    it("parses watch patterns", () => {
      const repos = loadTrackedRepos(CONFIG_PATH);
      const withPatterns = repos.filter((r) => r.watchPatterns.length > 0);
      expect(withPatterns.length).toBeGreaterThan(0);
    });

    it("returns empty array for nonexistent config", () => {
      const repos = loadTrackedRepos("/nonexistent/config.yaml");
      expect(repos).toEqual([]);
    });
  });
});
