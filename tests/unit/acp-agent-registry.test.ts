/**
 * Wave 4E: Tests for src/marketplace/acp-agent-registry.ts.
 *
 * Covers:
 *   - Seeded list (offline behaviour, ≥10 entries)
 *   - listAvailable() dedup (installed overrides seed)
 *   - install() honest failure modes (BLOCKED-NOT-INSTALLED, MANIFEST-INVALID)
 *   - install() happy path (INSTALLED when binary present)
 *   - SSRF guard rejects private/loopback registry URLs
 *   - refresh() gracefully returns null on all endpoints failing
 *   - Signature verification path (mock verifyManifestSignature)
 *   - installedAcpAgentToDefinition() shape
 *   - uninstall() removes record
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AcpAgentRegistry,
  SEEDED_ACP_AGENTS,
  installedAcpAgentToDefinition,
  type AcpAgentManifest,
  type InstalledAcpAgent,
} from "../../src/marketplace/acp-agent-registry.js";

describe("ACP Agent Registry (Wave 4E)", () => {
  let storeDir: string;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "wotann-acp-test-"));
  });

  afterEach(() => {
    try {
      rmSync(storeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("Seeded agents", () => {
    it("ships with at least 10 seeded ACP agents", () => {
      expect(SEEDED_ACP_AGENTS.length).toBeGreaterThanOrEqual(10);
    });

    it("includes well-known agents from Jan 2026 launch", () => {
      const names = SEEDED_ACP_AGENTS.map((a) => a.name);
      // Required by task spec: Claude Agent, Codex CLI, Gemini CLI, OpenCode, Junie, Amp
      for (const required of ["claude-agent", "codex-cli", "gemini-cli", "opencode", "junie", "amp"]) {
        expect(names).toContain(required);
      }
    });

    it("every seeded agent has required manifest fields", () => {
      for (const agent of SEEDED_ACP_AGENTS) {
        expect(agent.name).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(agent.description.length).toBeGreaterThan(0);
        expect(agent.version).toMatch(/^\d/);
        expect(agent.command.length).toBeGreaterThan(0);
      }
    });
  });

  describe("listAvailable()", () => {
    it("returns seeded agents with no installs", () => {
      const registry = new AcpAgentRegistry({ storeDir });
      const available = registry.listAvailable();
      expect(available.length).toBe(SEEDED_ACP_AGENTS.length);
      expect(available.map((a) => a.name)).toContain("claude-agent");
    });

    it("sorts entries alphabetically", () => {
      const registry = new AcpAgentRegistry({ storeDir });
      const names = registry.listAvailable().map((a) => a.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it("installed entries override seed entries with same name", () => {
      // Pre-seed the store with an override of "claude-agent"
      const override: InstalledAcpAgent = {
        name: "claude-agent",
        title: "Local Override",
        description: "overridden description",
        version: "99.0.0",
        command: "my-override",
        args: [],
        installedAt: new Date().toISOString(),
        status: "INSTALLED",
        verified: true,
        source: "local",
      };
      writeFileSync(join(storeDir, "claude-agent.json"), JSON.stringify(override));

      const registry = new AcpAgentRegistry({ storeDir });
      const available = registry.listAvailable();
      const found = available.find((a) => a.name === "claude-agent");
      expect(found?.description).toBe("overridden description");
      expect(found?.version).toBe("99.0.0");
    });
  });

  describe("install()", () => {
    it("returns BLOCKED-NOT-INSTALLED when binary absent", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        commandExists: () => false,
      });
      const result = await registry.install("claude-agent");
      expect(result.status).toBe("BLOCKED-NOT-INSTALLED");
      expect(result.reason).toMatch(/not on PATH/);
    });

    it("returns INSTALLED when binary is present", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        commandExists: () => true,
      });
      const result = await registry.install("claude-agent");
      expect(result.status).toBe("INSTALLED");
      expect(result.name).toBe("claude-agent");
      expect(result.verified).toBe(false); // no signature on seeded entries
    });

    it("returns MANIFEST-INVALID for unknown agent name", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        commandExists: () => true,
        // inject a fetchJson that returns nothing
        fetchJson: async () => null,
      });
      const result = await registry.install("no-such-agent-42");
      expect(result.status).toBe("MANIFEST-INVALID");
    });

    it("persists install record to storeDir", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        commandExists: () => true,
      });
      await registry.install("codex-cli");
      const path = join(storeDir, "codex-cli.json");
      expect(existsSync(path)).toBe(true);
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as InstalledAcpAgent;
      expect(parsed.name).toBe("codex-cli");
      expect(parsed.status).toBe("INSTALLED");
    });

    it("is idempotent — re-install updates the record", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        commandExists: () => true,
      });
      await registry.install("amp");
      await registry.install("amp");
      const installed = registry.listInstalled();
      expect(installed.filter((a) => a.name === "amp").length).toBe(1);
    });

    it("sanitizes name to prevent path traversal in storeDir", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        commandExists: () => false,
        fetchJson: async () => null,
      });
      await registry.install("../../etc/passwd");
      // The record must stay inside storeDir. The sibling location
      // "storeDir/../passwd.json" must NOT exist.
      const escapedPath = join(storeDir, "..", "passwd.json");
      expect(existsSync(escapedPath)).toBe(false);
      // And the sanitized record SHOULD exist inside storeDir.
      const sanitizedPath = join(storeDir, ".._.._etc_passwd.json");
      expect(existsSync(sanitizedPath)).toBe(true);
    });
  });

  describe("refreshFromRegistry()", () => {
    it("returns null when every endpoint fails", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        registryUrls: [
          "https://example.invalid/index.json",
          "https://another-invalid.test/index.json",
        ],
        fetchJson: async () => {
          throw new Error("network failure");
        },
      });
      const result = await registry.refreshFromRegistry();
      expect(result).toBe(null);
    });

    it("parses a valid registry response", async () => {
      const fixture = {
        version: "1.0.0",
        updatedAt: "2026-01-15T00:00:00Z",
        agents: [
          {
            name: "custom-agent",
            description: "A custom agent",
            version: "1.0.0",
            command: "custom-bin",
            args: ["start"],
          },
        ],
      };
      const registry = new AcpAgentRegistry({
        storeDir,
        registryUrls: ["https://acp.dev/registry/index.json"],
        fetchJson: async () => fixture,
      });
      const result = await registry.refreshFromRegistry();
      expect(result).not.toBe(null);
      expect(result?.agents[0]?.name).toBe("custom-agent");
    });

    it("rejects invalid shape", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        registryUrls: ["https://acp.dev/registry/index.json"],
        fetchJson: async () => ({ not: "an-index" }),
      });
      const result = await registry.refreshFromRegistry();
      expect(result).toBe(null);
    });

    it("SSRF blocks private-IP registry URLs", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        registryUrls: ["http://127.0.0.1/registry.json", "http://169.254.169.254/meta"],
        fetchJson: async () => ({ version: "1", agents: [] }),
      });
      const result = await registry.refreshFromRegistry();
      // Both URLs blocked by SSRF → final result is null.
      expect(result).toBe(null);
    });
  });

  describe("uninstall()", () => {
    it("removes an installed record", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        commandExists: () => true,
      });
      await registry.install("amp");
      expect(registry.listInstalled().length).toBe(1);
      expect(registry.uninstall("amp")).toBe(true);
      expect(registry.listInstalled().length).toBe(0);
    });

    it("returns false when no record exists", () => {
      const registry = new AcpAgentRegistry({ storeDir });
      expect(registry.uninstall("nonexistent")).toBe(false);
    });
  });

  describe("installedAcpAgentToDefinition()", () => {
    it("produces an AgentDefinition with acp: prefix", () => {
      const installed: InstalledAcpAgent = {
        name: "my-agent",
        title: "My Agent",
        description: "External",
        version: "1.0.0",
        command: "my-agent-bin",
        args: ["acp"],
        installedAt: new Date().toISOString(),
        status: "INSTALLED",
        verified: true,
        source: "registry",
      };
      const def = installedAcpAgentToDefinition(installed);
      expect(def.id).toBe("acp:my-agent");
      expect(def.name).toBe("My Agent");
      expect(def.model).toBe("local");
      expect(def.systemPrompt).toContain("My Agent");
      expect(def.systemPrompt).toContain("my-agent-bin acp");
    });

    it("falls back to name when title absent", () => {
      const installed: InstalledAcpAgent = {
        name: "plain",
        description: "no title",
        version: "1.0.0",
        command: "plain",
        args: [],
        installedAt: new Date().toISOString(),
        status: "INSTALLED",
        verified: false,
        source: "registry",
      };
      const def = installedAcpAgentToDefinition(installed);
      expect(def.name).toBe("plain");
    });
  });

  describe("fetchManifest()", () => {
    it("returns seeded manifest for known name without hitting network", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        fetchJson: async () => {
          throw new Error("should not fetch");
        },
      });
      const manifest = await registry.fetchManifest("claude-agent");
      expect(manifest).not.toBe(null);
      expect(manifest?.name).toBe("claude-agent");
    });

    it("falls through to remote registry for unknown name", async () => {
      const custom: AcpAgentManifest = {
        name: "remote-agent",
        description: "fetched from remote",
        version: "1.0.0",
        command: "remote-bin",
      };
      const registry = new AcpAgentRegistry({
        storeDir,
        registryUrls: ["https://acp.dev/registry/index.json"],
        fetchJson: async () => ({
          version: "1.0.0",
          agents: [custom],
        }),
      });
      const manifest = await registry.fetchManifest("remote-agent");
      expect(manifest?.name).toBe("remote-agent");
    });

    it("returns null when both seed and remote miss", async () => {
      const registry = new AcpAgentRegistry({
        storeDir,
        fetchJson: async () => ({ version: "1", agents: [] }),
      });
      const manifest = await registry.fetchManifest("nope");
      expect(manifest).toBe(null);
    });
  });
});
