import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigDiscovery } from "../../src/core/config-discovery.js";
import type { DiscoveredConfig, DiscoveryResult } from "../../src/core/config-discovery.js";
import * as fs from "node:fs";

// Mock fs module
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

describe("ConfigDiscovery", () => {
  const mockedFs = vi.mocked(fs);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setupMockFs = (directories: Record<string, { files: Record<string, string>; subdirs?: Record<string, Record<string, string>> }>) => {
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const path = String(p);
      for (const [dir, data] of Object.entries(directories)) {
        if (path === dir) return true;
        for (const file of Object.keys(data.files)) {
          if (path === `${dir}/${file}`) return true;
        }
        if (data.subdirs) {
          for (const [subdir, subFiles] of Object.entries(data.subdirs)) {
            if (path === `${dir}/${subdir}`) return true;
            for (const subFile of Object.keys(subFiles)) {
              if (path === `${dir}/${subdir}/${subFile}`) return true;
            }
          }
        }
      }
      return false;
    });

    mockedFs.statSync.mockImplementation((p: fs.PathLike) => {
      const path = String(p);
      const isDirPath = Object.keys(directories).includes(path) ||
        Object.entries(directories).some(([dir, data]) =>
          data.subdirs && Object.keys(data.subdirs).some((sub) => path === `${dir}/${sub}`),
        );

      return { isDirectory: () => isDirPath } as fs.Stats;
    });

    mockedFs.readdirSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const path = String(p);
      for (const [dir, data] of Object.entries(directories)) {
        if (data.subdirs) {
          for (const [subdir, subFiles] of Object.entries(data.subdirs)) {
            if (path === `${dir}/${subdir}`) {
              return Object.keys(subFiles) as unknown as fs.Dirent[];
            }
          }
        }
      }
      return [] as unknown as fs.Dirent[];
    });

    mockedFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const path = String(p);
      for (const [dir, data] of Object.entries(directories)) {
        for (const [file, content] of Object.entries(data.files)) {
          if (path === `${dir}/${file}`) return content;
        }
        if (data.subdirs) {
          for (const [subdir, subFiles] of Object.entries(data.subdirs)) {
            for (const [file, content] of Object.entries(subFiles)) {
              if (path === `${dir}/${subdir}/${file}`) return content;
            }
          }
        }
      }
      throw new Error(`ENOENT: ${path}`);
    });
  };

  describe("discover", () => {
    it("discovers Claude configs", () => {
      setupMockFs({
        "/home/user/.claude": {
          files: { "settings.json": '{"theme": "dark"}' },
          subdirs: {
            rules: { "coding.md": "# Coding Rules" },
          },
        },
      });

      const discovery = new ConfigDiscovery();
      const result = discovery.discover("/home/user", "/project");

      expect(result.discoveredTools).toBe(1);
      expect(result.configs[0]!.tool).toBe("claude");
      expect(result.configs[0]!.configFiles).toContain("settings.json");
    });

    it("discovers multiple tools", () => {
      setupMockFs({
        "/home/user/.claude": {
          files: { "settings.json": '{"theme": "dark"}' },
        },
        "/home/user/.cursor": {
          files: { "settings.json": '{"editor": "vscode"}' },
        },
      });

      const discovery = new ConfigDiscovery();
      const result = discovery.discover("/home/user", "/project");

      expect(result.discoveredTools).toBe(2);
      const tools = result.configs.map((c) => c.tool);
      expect(tools).toContain("claude");
      expect(tools).toContain("cursor");
    });

    it("returns empty when no tools found", () => {
      setupMockFs({});

      const discovery = new ConfigDiscovery();
      const result = discovery.discover("/home/user", "/project");

      expect(result.discoveredTools).toBe(0);
      expect(result.configs).toHaveLength(0);
    });

    it("scans both home and project directories", () => {
      setupMockFs({
        "/home/user/.wotann": {
          files: { "config.yaml": "version: 0.1.0" },
        },
        "/project/.wotann": {
          files: { "config.yaml": "version: 0.2.0" },
        },
      });

      const discovery = new ConfigDiscovery();
      const result = discovery.discover("/home/user", "/project");

      // Should find wotann in both locations
      const wotannConfigs = result.configs.filter((c) => c.tool === "wotann");
      expect(wotannConfigs.length).toBe(2);
    });

    it("deduplicates when home and project are the same", () => {
      setupMockFs({
        "/home/user/.claude": {
          files: { "settings.json": '{}' },
        },
      });

      const discovery = new ConfigDiscovery();
      const result = discovery.discover("/home/user", "/home/user");

      const claudeConfigs = result.configs.filter((c) => c.tool === "claude");
      expect(claudeConfigs.length).toBe(1);
    });

    it("reports scan duration", () => {
      setupMockFs({});

      const discovery = new ConfigDiscovery();
      const result = discovery.discover("/home/user", "/project");

      expect(result.scanDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("listDiscovered", () => {
    it("formats discovered configs as readable lines", () => {
      const result: DiscoveryResult = {
        configs: [
          {
            tool: "claude",
            path: "/home/.claude",
            settings: {},
            rules: [{ name: "coding", content: "# Rules", source: "claude" }],
            skills: [],
            configFiles: ["settings.json"],
          },
        ],
        totalTools: 8,
        discoveredTools: 1,
        scanDurationMs: 5,
      };

      const discovery = new ConfigDiscovery();
      const lines = discovery.listDiscovered(result);

      expect(lines.some((l) => l.includes("claude"))).toBe(true);
      expect(lines.some((l) => l.includes("1 of 8"))).toBe(true);
    });

    it("handles no configs gracefully", () => {
      const result: DiscoveryResult = {
        configs: [],
        totalTools: 8,
        discoveredTools: 0,
        scanDurationMs: 1,
      };

      const discovery = new ConfigDiscovery();
      const lines = discovery.listDiscovered(result);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("No agent tool configurations");
    });
  });

  describe("importSettings", () => {
    it("imports valid rules and settings", () => {
      const config: DiscoveredConfig = {
        tool: "claude",
        path: "/home/.claude",
        settings: { "settings.json": { theme: "dark", editor: "vscode" } },
        rules: [{ name: "coding", content: "# Rules", source: "claude" }],
        skills: [],
        configFiles: ["settings.json"],
      };

      mockedFs.existsSync.mockReturnValue(true);

      const discovery = new ConfigDiscovery();
      const result = discovery.importSettings(config);

      expect(result.imported).toBe(true);
      expect(result.settingsMerged).toBeGreaterThan(0);
      expect(result.rulesImported).toBe(1);
    });

    it("skips rules exceeding size limit", () => {
      const config: DiscoveredConfig = {
        tool: "cursor",
        path: "/home/.cursor",
        settings: {},
        rules: [{ name: "huge", content: "x".repeat(60_000), source: "cursor" }],
        skills: [],
        configFiles: ["settings.json"],
      };

      const discovery = new ConfigDiscovery();
      const result = discovery.importSettings(config);

      expect(result.rulesImported).toBe(0);
      expect(result.warnings.some((w) => w.includes("50KB"))).toBe(true);
    });

    it("filters out secret-containing settings", () => {
      const config: DiscoveredConfig = {
        tool: "codex",
        path: "/home/.codex",
        settings: {
          "config.json": {
            api_key: "sk-123",
            theme: "dark",
            secret_token: "abc",
            editor: "vim",
          },
        },
        rules: [],
        skills: [],
        configFiles: ["config.json"],
      };

      const discovery = new ConfigDiscovery();
      const result = discovery.importSettings(config);

      // Only non-secret settings should be imported
      expect(result.settingsMerged).toBeGreaterThan(0);
    });

    it("warns for missing skill paths", () => {
      mockedFs.existsSync.mockReturnValue(false);

      const config: DiscoveredConfig = {
        tool: "claude",
        path: "/home/.claude",
        settings: {},
        rules: [],
        skills: [{ name: "my-skill", path: "/nonexistent/skill.md", source: "claude" }],
        configFiles: ["settings.json"],
      };

      const discovery = new ConfigDiscovery();
      const result = discovery.importSettings(config);

      expect(result.skillsImported).toBe(0);
      expect(result.warnings.some((w) => w.includes("not found"))).toBe(true);
    });
  });

  describe("discoverUsageProfile", () => {
    it("returns empty when no env vars are set", () => {
      const discovery = new ConfigDiscovery();
      const result = discovery.discoverUsageProfile({});
      expect(result.hints).toHaveLength(0);
      expect(result.maxPowerMode).toBe(false);
      expect(result.showCostWarnings).toBe(false);
      expect(result.hasSubscription).toBe(false);
      expect(result.hasApiKey).toBe(false);
    });

    it("emits maxPowerMode=true when subscription is present", () => {
      const discovery = new ConfigDiscovery();
      const result = discovery.discoverUsageProfile({
        CLAUDE_CODE_SUBSCRIPTION: "1",
      });
      expect(result.hasSubscription).toBe(true);
      expect(result.maxPowerMode).toBe(true);
      expect(result.showCostWarnings).toBe(false);
      expect(result.hints[0]?.providerId).toBe("anthropic-subscription");
      expect(result.hints[0]?.billingModel).toBe("subscription");
    });

    it("emits showCostWarnings=true when raw API key is set", () => {
      const discovery = new ConfigDiscovery();
      const result = discovery.discoverUsageProfile({
        ANTHROPIC_API_KEY: "sk-ant-fake",
      });
      expect(result.hasApiKey).toBe(true);
      expect(result.showCostWarnings).toBe(true);
      expect(result.maxPowerMode).toBe(true);
      expect(result.hints[0]?.providerId).toBe("anthropic");
      expect(result.hints[0]?.billingModel).toBe("api");
    });

    it("identifies free-tier providers (gemini, groq)", () => {
      const discovery = new ConfigDiscovery();
      const result = discovery.discoverUsageProfile({
        GEMINI_API_KEY: "g-fake",
        GROQ_API_KEY: "gr-fake",
      });
      expect(result.maxPowerMode).toBe(true);
      expect(result.showCostWarnings).toBe(false);
      const ids = result.hints.map((h) => h.providerId);
      expect(ids).toContain("gemini");
      expect(ids).toContain("free");
    });

    it("identifies local Ollama via OLLAMA_HOST", () => {
      const discovery = new ConfigDiscovery();
      const result = discovery.discoverUsageProfile({
        OLLAMA_HOST: "http://localhost:11434",
      });
      expect(result.maxPowerMode).toBe(true);
      expect(result.showCostWarnings).toBe(false);
      expect(result.hints[0]?.providerId).toBe("ollama");
      expect(result.hints[0]?.source).toBe("local-binary");
    });

    it("mixes subscription + API key — maxPowerMode AND showCostWarnings both true", () => {
      const discovery = new ConfigDiscovery();
      const result = discovery.discoverUsageProfile({
        CLAUDE_CODE_SUBSCRIPTION: "1",
        OPENAI_API_KEY: "sk-openai-fake",
      });
      expect(result.hasSubscription).toBe(true);
      expect(result.hasApiKey).toBe(true);
      expect(result.maxPowerMode).toBe(true);
      expect(result.showCostWarnings).toBe(true);
    });

    it("each hint carries its classified profile", () => {
      const discovery = new ConfigDiscovery();
      const result = discovery.discoverUsageProfile({
        ANTHROPIC_API_KEY: "sk-ant-fake",
      });
      const hint = result.hints[0]!;
      expect(hint.profile.billingModel).toBe("api");
      expect(hint.profile.maxPowerMode).toBe(true);
      expect(hint.profile.showCostWarnings).toBe(true);
    });
  });
});
