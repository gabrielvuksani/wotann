/**
 * E2E test: exercises actual CLI commands via subprocess execution.
 * Tests wotann init, providers, doctor, skills, config, and extended utility commands.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../../src/memory/store.js";
import { AuditTrail } from "../../src/telemetry/audit-trail.js";

const NODE = process.execPath;
// Prefer the pre-compiled dist/ build for e2e runs. tsx JIT-transpiles the
// entire src/ tree (~150 files) on every invocation which makes each subprocess
// take 3-15s before any real work starts. When the tree is already built
// (CI / release / post-`npm run build`), use `dist/index.js` directly — one
// Node startup, ~100ms per command. Fallback to tsx keeps the test runnable
// in a fresh clone before the first build.
const DIST_CLI = join(__dirname, "../../dist/index.js");
const TSX_PATH = join(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const SRC_CLI = join(__dirname, "../../src/index.ts");
const HAS_DIST = existsSync(DIST_CLI);
const CLI_ARGS: readonly string[] = HAS_DIST ? [DIST_CLI] : [TSX_PATH, SRC_CLI];

// Commands that import the full runtime graph (187 imports, ~20s cold-cache
// on slow/fresh disks) need a larger headroom than the default 15s. Any
// command that transitively imports `core/runtime.js` goes through
// `channels/dispatch.js`, `channels/next.js`, and friends. Simple commands
// (providers, doctor, config) stay fast.
const CLI_TIMEOUT_MS = 45_000;

function runCLI(args: string[], cwd: string): string {
  try {
    return execFileSync(NODE, [...CLI_ARGS, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: CLI_TIMEOUT_MS,
      env: {
        ...process.env,
        // Clear provider env vars so tests are deterministic
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
        GH_TOKEN: "",
        GITHUB_TOKEN: "",
        CODEX_API_KEY: "",
        CODEX_AUTH_JSON_PATH: "/nonexistent",
        OLLAMA_URL: "http://localhost:99999",
        GEMINI_API_KEY: "",
        WOTANN_SKIP_CLI_CHECK: "1",
      },
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
}

// Each subprocess can take up to CLI_TIMEOUT_MS. A test may call runCLI more
// than once (add → list → remove) so the vitest per-test timeout must be a
// multiple of that. 90s is enough headroom for a triple-command test.
describe("E2E: CLI Commands", { timeout: 90_000 }, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-e2e-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("wotann init", () => {
    it("creates .wotann/ directory with all 8 bootstrap files", () => {
      const output = runCLI(["init"], tempDir);

      expect(output).toContain("Workspace created");
      expect(existsSync(join(tempDir, ".wotann"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "SOUL.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "IDENTITY.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "USER.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "AGENTS.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "TOOLS.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "HEARTBEAT.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "BOOTSTRAP.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "MEMORY.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "config.yaml"))).toBe(true);
    });

    it("creates subdirectories (rules, skills, hooks, agents, personas)", () => {
      runCLI(["init"], tempDir);

      expect(existsSync(join(tempDir, ".wotann", "rules"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "skills"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "hooks"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "agents"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "personas"))).toBe(true);
    });

    it("wotann init --free configures Ollama-first", () => {
      const output = runCLI(["init", "--free"], tempDir);

      expect(output).toContain("Free-tier setup");
      expect(output).toContain("Ollama");

      const config = readFileSync(join(tempDir, ".wotann", "config.yaml"), "utf-8");
      expect(config).toContain("ollama");
      expect(config).toContain("q8_0");
    });

    it("refuses to overwrite existing workspace", () => {
      runCLI(["init"], tempDir);
      const output = runCLI(["init"], tempDir);

      expect(output).toContain("already exists");
    });
  });

  describe("wotann providers", () => {
    it("lists all 11 providers", () => {
      const output = runCLI(["providers"], tempDir);

      expect(output).toContain("Provider Status");
      expect(output).toContain("anthropic");
      expect(output).toContain("openai");
      expect(output).toContain("codex");
      expect(output).toContain("copilot");
      expect(output).toContain("ollama");
      expect(output).toContain("gemini");
      expect(output).toContain("huggingface");
      expect(output).toContain("free");
      expect(output).toContain("azure");
      expect(output).toContain("bedrock");
      expect(output).toContain("vertex");
    });

    it("shows 0 active when no env vars set", () => {
      const output = runCLI(["providers"], tempDir);
      // 18 providers: anthropic, openai, codex, copilot, ollama, gemini, huggingface, free,
      // azure, bedrock, vertex, mistral, deepseek, perplexity, xai, together, fireworks, sambanova
      expect(output).toContain("0 of 18");
    });

    it("reports context reality for configured providers", () => {
      const output = runCLI(["context"], tempDir);
      expect(output).toContain("Context Reality");
      expect(output).toContain("No configured providers");
    });
  });

  describe("wotann doctor", () => {
    it("reports Node.js version check", () => {
      runCLI(["init"], tempDir);
      const output = runCLI(["doctor"], tempDir);

      expect(output).toContain("Node.js");
      expect(output).toContain("✓");
    });

    it("reports workspace presence", () => {
      runCLI(["init"], tempDir);
      const output = runCLI(["doctor"], tempDir);

      expect(output).toContain("Workspace");
    });
  });

  describe("wotann skills list", () => {
    it("lists available skills by category", () => {
      const output = runCLI(["skills", "list"], tempDir);

      expect(output).toContain("skills available");
      expect(output).toContain("typescript-pro");
      expect(output).toContain("react-expert");
      expect(output).toContain("python-pro");
    });
  });

  describe("wotann skills search", () => {
    it("finds matching skills", () => {
      const output = runCLI(["skills", "search", "python"], tempDir);
      expect(output).toContain("python-pro");
    });

    it("reports no results for bad queries", () => {
      const output = runCLI(["skills", "search", "zzz_nonexistent_zzz"], tempDir);
      expect(output).toContain("No matching");
    });
  });

  describe("wotann config", () => {
    it("shows current configuration", () => {
      const output = runCLI(["config"], tempDir);
      expect(output).toContain("version");
      expect(output).toContain("hooks");
    });
  });

  describe("wotann mcp list", () => {
    it("shows MCP server status", () => {
      const output = runCLI(["mcp", "list"], tempDir);
      expect(output).toContain("MCP Servers");
    });
  });

  describe("wotann channels policy", () => {
    it("adds, lists, and removes dispatch policies", () => {
      const addOutput = runCLI([
        "channels",
        "policy-add",
        "--id", "triage",
        "--label", "Inbox Triage",
        "--channel", "telegram",
        "--sender", "alice",
        "--workspace", "dispatch/inbox",
        "--mode", "plan",
        "--provider", "openai",
        "--model", "gpt-5.4",
      ], tempDir);

      expect(addOutput).toContain("Saved dispatch policy triage");
      expect(existsSync(join(tempDir, ".wotann", "dispatch", "policies.json"))).toBe(true);

      const listOutput = runCLI(["channels", "policy-list"], tempDir);
      expect(listOutput).toContain("WOTANN Channel Policies");
      expect(listOutput).toContain("triage");
      expect(listOutput).toContain("Inbox Triage");
      expect(listOutput).toContain("dispatch/inbox");
      expect(listOutput).toContain("openai / gpt-5.4");

      const removeOutput = runCLI(["channels", "policy-remove", "triage"], tempDir);
      expect(removeOutput).toContain("Removed dispatch policy triage");
    });
  });

  describe("wotann lsp rename", () => {
    it("renames a TypeScript symbol across files", () => {
      writeFileSync(join(tempDir, "a.ts"), [
        "export function fetchData(input: string): string {",
        "  return input.toUpperCase();",
        "}",
        "",
      ].join("\n"));
      writeFileSync(join(tempDir, "b.ts"), [
        'import { fetchData } from "./a";',
        'export const value = fetchData("hi");',
        "",
      ].join("\n"));

      const output = runCLI(["lsp", "rename", "a.ts", "1", "17", "loadData", "--apply"], tempDir);

      expect(output).toContain("Applied rename");
      expect(readFileSync(join(tempDir, "a.ts"), "utf-8")).toContain("loadData");
      expect(readFileSync(join(tempDir, "b.ts"), "utf-8")).toContain("loadData");
    });
  });

  describe("wotann dream", () => {
    it("runs forced autoDream consolidation and persists outputs", () => {
      const store = new MemoryStore(join(tempDir, ".wotann", "memory.db"));
      try {
        for (let i = 0; i < 5; i++) {
          store.captureEvent("tool_call", `Observation ${i} about TypeScript typing`, "Read", "session-1");
        }
        store.memoryInsert("feedback", "review-1", "No, that's wrong. Don't use any types.");
        store.memoryInsert("feedback", "review-2", "Yes, exactly. Keep doing that.");
      } finally {
        store.close();
      }

      const output = runCLI(["dream", "--force"], tempDir);

      expect(output).toContain("autoDream complete");
      expect(existsSync(join(tempDir, ".wotann", "gotchas.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".wotann", "instincts.json"))).toBe(true);
      expect(readFileSync(join(tempDir, ".wotann", "gotchas.md"), "utf-8")).toContain("Don't use any types");
    });
  });

  describe("wotann audit", () => {
    it("queries the audit trail with filters", () => {
      const audit = new AuditTrail(join(tempDir, ".wotann", "audit.db"));
      try {
        audit.record({
          id: "audit-1",
          sessionId: "s1",
          timestamp: "2026-04-02T12:00:00Z",
          tool: "Read",
          riskLevel: "low",
          success: true,
        });
        audit.record({
          id: "audit-2",
          sessionId: "s2",
          timestamp: "2026-04-02T12:05:00Z",
          tool: "Bash",
          riskLevel: "high",
          success: false,
        });
      } finally {
        audit.close();
      }

      const output = runCLI(["audit", "--tool", "Read"], tempDir);
      expect(output).toContain("Audit Trail");
      expect(output).toContain("audit-1");
      expect(output).toContain("Read");
    });
  });

  describe("wotann next", () => {
    it("routes through the runtime and surfaces harness errors cleanly", () => {
      const output = runCLI(["next"], tempDir);
      expect(output).toContain("WOTANN Next");
      expect(output).toContain("No providers configured");
    });
  });

  describe("wotann voice status", () => {
    it("shows detected voice capabilities", () => {
      const output = runCLI(["voice", "status"], tempDir);
      expect(output).toContain("Voice Mode");
      expect(output).toContain("Push-to-talk");
      expect(output).toContain("STT");
      expect(output).toContain("TTS");
    });
  });

  describe("wotann.local status", () => {
    it("shows local model status and KV cache configuration", () => {
      const output = runCLI(["local", "status"], tempDir);
      expect(output).toContain("Local Model Status");
      expect(output).toContain("KV cache");
      expect(output).toContain("Ollama");
    });
  });

  describe("wotann daemon lifecycle", () => {
    // Skipped on CI runners that don't have a writable ~/.wotann/ + free
    // socket port + ability to spawn long-lived background processes.
    // Set WOTANN_E2E_DAEMON=1 locally to exercise this path.
    const itDaemon = process.env["WOTANN_E2E_DAEMON"] === "1" ? it : it.skip;
    itDaemon("starts in the background, reports status, and stops cleanly", async () => {
      runCLI(["init"], tempDir);

      const startOutput = runCLI(["daemon", "start"], tempDir);
      expect(startOutput).toContain("daemon started");

      // Poll daemon status with retries — the daemon process may need time to
      // fully initialize after the PID file is written. The previous fixed
      // 1200ms sleep was flaky because it raced with daemon initialization.
      const deadline = Date.now() + 8_000;
      let statusOutput = "";
      let daemonRunning = false;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          statusOutput = runCLI(["daemon", "status"], tempDir);
          if (statusOutput.includes("daemon running")) {
            daemonRunning = true;
            break;
          }
        } catch {
          // CLI might fail transiently during startup, keep retrying
        }
      }
      expect(daemonRunning).toBe(true);
      expect(statusOutput).toContain("Heartbeat tasks");

      const stopOutput = runCLI(["daemon", "stop"], tempDir);
      expect(stopOutput).toContain("stopped");
    }, 20_000);
  });
});
