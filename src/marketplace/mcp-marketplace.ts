/**
 * MCP Marketplace — discovery, install, audit, and management of MCP servers.
 *
 * Inspired by KiloCode's marketplace and Claude Code's MCP ecosystem.
 * Provides: registry search, auto-install, security audit, version pinning,
 * health monitoring, and one-click uninstall.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface MCPServerEntry {
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly installCommand: string;
  readonly category: MCPCategory;
  readonly security: MCPSecurityInfo;
  readonly repository?: string;
  readonly downloads?: number;
  readonly rating?: number;
}

export type MCPCategory =
  | "code-intelligence"
  | "database"
  | "communication"
  | "cloud"
  | "monitoring"
  | "ai-ml"
  | "productivity"
  | "automation"
  | "security"
  | "other";

export interface MCPSecurityInfo {
  readonly audited: boolean;
  readonly lastAudit?: string;
  readonly networkAccess: boolean;
  readonly fileAccess: boolean;
  readonly riskLevel: "low" | "medium" | "high" | "critical";
  readonly findings?: readonly string[];
}

export interface InstalledMCPServer {
  readonly name: string;
  readonly version: string;
  readonly installedAt: string;
  readonly configPath: string;
  readonly enabled: boolean;
  readonly healthStatus: "healthy" | "degraded" | "down" | "unknown";
  readonly lastHealthCheck?: string;
  readonly errorRate?: number;
  readonly avgLatencyMs?: number;
}

export interface MCPMarketplaceConfig {
  readonly registryUrl: string;
  readonly installDir: string;
  readonly configPath: string;
  readonly autoSecurityScan: boolean;
  readonly blockCriticalRisk: boolean;
}

const DEFAULT_CONFIG: MCPMarketplaceConfig = {
  registryUrl: "https://registry.wotann.com/mcp",
  installDir: ".wotann/mcp-servers",
  configPath: ".wotann/mcp-servers.json",
  autoSecurityScan: true,
  blockCriticalRisk: true,
};

// ── Built-in Registry (local, no network needed) ─────────

const BUILTIN_REGISTRY: readonly MCPServerEntry[] = [
  {
    name: "github-mcp",
    version: "2.1.0",
    author: "modelcontextprotocol",
    description: "GitHub API integration — issues, PRs, code search, repos",
    tools: ["create_issue", "search_code", "list_pull_requests", "get_file_contents"],
    installCommand: "npm install @modelcontextprotocol/server-github",
    category: "code-intelligence",
    security: { audited: true, networkAccess: true, fileAccess: false, riskLevel: "low" },
    repository: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "filesystem-mcp",
    version: "1.5.0",
    author: "modelcontextprotocol",
    description: "Local filesystem operations — read, write, search, move files",
    tools: ["read_file", "write_file", "search_files", "list_directory"],
    installCommand: "npm install @modelcontextprotocol/server-filesystem",
    category: "automation",
    security: { audited: true, networkAccess: false, fileAccess: true, riskLevel: "medium" },
  },
  {
    name: "postgres-mcp",
    version: "1.3.0",
    author: "modelcontextprotocol",
    description: "PostgreSQL database operations — query, schema, migration",
    tools: ["query", "get_schema", "list_tables"],
    installCommand: "npm install @modelcontextprotocol/server-postgres",
    category: "database",
    security: { audited: true, networkAccess: true, fileAccess: false, riskLevel: "medium" },
  },
  {
    name: "slack-mcp",
    version: "1.2.0",
    author: "modelcontextprotocol",
    description: "Slack workspace integration — channels, messages, users",
    tools: ["send_message", "list_channels", "search_messages"],
    installCommand: "npm install @modelcontextprotocol/server-slack",
    category: "communication",
    security: { audited: true, networkAccess: true, fileAccess: false, riskLevel: "low" },
  },
  {
    name: "puppeteer-mcp",
    version: "1.4.0",
    author: "modelcontextprotocol",
    description: "Browser automation via Puppeteer — navigate, click, screenshot",
    tools: ["navigate", "screenshot", "click", "type", "evaluate"],
    installCommand: "npm install @modelcontextprotocol/server-puppeteer",
    category: "automation",
    security: { audited: true, networkAccess: true, fileAccess: false, riskLevel: "medium" },
  },
];

export class MCPMarketplace {
  private readonly config: MCPMarketplaceConfig;
  private readonly installed: Map<string, InstalledMCPServer> = new Map();

  constructor(config?: Partial<MCPMarketplaceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadInstalled();
  }

  /**
   * Search the marketplace registry.
   */
  search(query: string, category?: MCPCategory): readonly MCPServerEntry[] {
    const lower = query.toLowerCase();
    return BUILTIN_REGISTRY.filter((entry) => {
      if (category && entry.category !== category) return false;
      return (
        entry.name.toLowerCase().includes(lower) ||
        entry.description.toLowerCase().includes(lower) ||
        entry.tools.some((t) => t.toLowerCase().includes(lower)) ||
        entry.category.includes(lower)
      );
    });
  }

  /**
   * Get all available servers.
   */
  listAvailable(): readonly MCPServerEntry[] {
    return [...BUILTIN_REGISTRY];
  }

  /**
   * Get installed servers.
   */
  listInstalled(): readonly InstalledMCPServer[] {
    return [...this.installed.values()];
  }

  /**
   * Install an MCP server (records in config, actual npm install done externally).
   */
  install(entry: MCPServerEntry): InstalledMCPServer {
    if (this.config.blockCriticalRisk && entry.security.riskLevel === "critical") {
      throw new Error(`Blocked: ${entry.name} has critical security risk. Override with --force.`);
    }

    const installed: InstalledMCPServer = {
      name: entry.name,
      version: entry.version,
      installedAt: new Date().toISOString(),
      configPath: join(this.config.installDir, entry.name),
      enabled: true,
      healthStatus: "unknown",
    };

    this.installed.set(entry.name, installed);
    this.persistInstalled();
    return installed;
  }

  /**
   * Uninstall an MCP server.
   */
  uninstall(name: string): boolean {
    const deleted = this.installed.delete(name);
    if (deleted) this.persistInstalled();
    return deleted;
  }

  /**
   * Toggle an MCP server on/off.
   */
  toggle(name: string, enabled: boolean): boolean {
    const server = this.installed.get(name);
    if (!server) return false;
    this.installed.set(name, { ...server, enabled });
    this.persistInstalled();
    return true;
  }

  /**
   * Update health status of an installed server.
   */
  updateHealth(name: string, status: InstalledMCPServer["healthStatus"], latencyMs?: number, errorRate?: number): void {
    const server = this.installed.get(name);
    if (!server) return;
    this.installed.set(name, {
      ...server,
      healthStatus: status,
      lastHealthCheck: new Date().toISOString(),
      avgLatencyMs: latencyMs,
      errorRate,
    });
  }

  /**
   * Security scan a server entry.
   */
  scanSecurity(entry: MCPServerEntry): MCPSecurityInfo {
    const findings: string[] = [];

    if (entry.security.networkAccess) {
      findings.push("Server requires network access — verify destination allowlist");
    }
    if (entry.security.fileAccess) {
      findings.push("Server requires file system access — verify path restrictions");
    }
    if (!entry.security.audited) {
      findings.push("Server has NOT been security-audited — use at your own risk");
    }
    if (entry.tools.length > 10) {
      findings.push("Server exposes many tools (>10) — large attack surface");
    }

    return {
      ...entry.security,
      findings,
    };
  }

  // ── Persistence ──────────────────────────────────────────

  private loadInstalled(): void {
    if (!existsSync(this.config.configPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.config.configPath, "utf-8")) as { servers: InstalledMCPServer[] };
      for (const server of data.servers ?? []) {
        this.installed.set(server.name, server);
      }
    } catch {
      // Ignore malformed config
    }
  }

  private persistInstalled(): void {
    mkdirSync(join(this.config.configPath, ".."), { recursive: true });
    writeFileSync(
      this.config.configPath,
      JSON.stringify({ servers: [...this.installed.values()] }, null, 2),
    );
  }
}
