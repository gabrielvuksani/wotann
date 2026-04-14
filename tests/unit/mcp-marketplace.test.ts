import { describe, it, expect } from "vitest";
import { MCPMarketplace, type MCPServerEntry } from "../../src/marketplace/mcp-marketplace.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("MCP Marketplace", () => {
  function createTestMarketplace(): { marketplace: MCPMarketplace; dir: string } {
    const dir = join(tmpdir(), "wotann-test-mcp-" + randomUUID());
    mkdirSync(dir, { recursive: true });
    const marketplace = new MCPMarketplace({
      configPath: join(dir, "mcp-servers.json"),
      installDir: join(dir, "mcp-servers"),
    });
    return { marketplace, dir };
  }

  it("lists available MCP servers", () => {
    const { marketplace } = createTestMarketplace();
    const available = marketplace.listAvailable();
    expect(available.length).toBeGreaterThan(0);
    expect(available.some((s) => s.name === "github-mcp")).toBe(true);
  });

  it("searches by name", () => {
    const { marketplace } = createTestMarketplace();
    const results = marketplace.search("github");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("github-mcp");
  });

  it("searches by tool name", () => {
    const { marketplace } = createTestMarketplace();
    const results = marketplace.search("query");
    expect(results.some((s) => s.name === "postgres-mcp")).toBe(true);
  });

  it("searches by category", () => {
    const { marketplace } = createTestMarketplace();
    const results = marketplace.search("", "database");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("postgres-mcp");
  });

  it("installs a server", () => {
    const { marketplace } = createTestMarketplace();
    const available = marketplace.listAvailable();
    const github = available.find((s) => s.name === "github-mcp")!;

    const installed = marketplace.install(github);
    expect(installed.name).toBe("github-mcp");
    expect(installed.enabled).toBe(true);

    const list = marketplace.listInstalled();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("github-mcp");
  });

  it("blocks critical risk installations", () => {
    const { marketplace } = createTestMarketplace();
    const dangerous: MCPServerEntry = {
      name: "bad-mcp",
      version: "1.0.0",
      author: "unknown",
      description: "suspicious server",
      tools: [],
      installCommand: "npm install bad-mcp",
      category: "other",
      security: { audited: false, networkAccess: true, fileAccess: true, riskLevel: "critical" },
    };

    expect(() => marketplace.install(dangerous)).toThrow(/critical security risk/);
  });

  it("uninstalls a server", () => {
    const { marketplace } = createTestMarketplace();
    const available = marketplace.listAvailable();
    marketplace.install(available[0]!);

    expect(marketplace.uninstall(available[0]!.name)).toBe(true);
    expect(marketplace.listInstalled()).toHaveLength(0);
  });

  it("toggles a server on/off", () => {
    const { marketplace } = createTestMarketplace();
    const available = marketplace.listAvailable();
    marketplace.install(available[0]!);

    expect(marketplace.toggle(available[0]!.name, false)).toBe(true);
    expect(marketplace.listInstalled()[0]!.enabled).toBe(false);

    expect(marketplace.toggle(available[0]!.name, true)).toBe(true);
    expect(marketplace.listInstalled()[0]!.enabled).toBe(true);
  });

  it("updates health status", () => {
    const { marketplace } = createTestMarketplace();
    const available = marketplace.listAvailable();
    marketplace.install(available[0]!);

    marketplace.updateHealth(available[0]!.name, "healthy", 45, 0.01);
    const server = marketplace.listInstalled()[0]!;
    expect(server.healthStatus).toBe("healthy");
    expect(server.avgLatencyMs).toBe(45);
    expect(server.errorRate).toBe(0.01);
  });

  it("security scan identifies findings", () => {
    const { marketplace } = createTestMarketplace();
    const puppeteer = marketplace.listAvailable().find((s) => s.name === "puppeteer-mcp")!;

    const scan = marketplace.scanSecurity(puppeteer);
    expect(scan.findings).toBeDefined();
    expect(scan.findings!.length).toBeGreaterThan(0);
    expect(scan.findings!.some((f) => f.includes("network access"))).toBe(true);
  });
});
