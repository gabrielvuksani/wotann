/**
 * MCP server registry + skill marketplace.
 * Config-based server registration, import from Claude Code, hot-add.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import { generateManifest, writeManifest, type MarketplaceManifest } from "./manifest.js";

const execFileAsync = promisify(execFile);

// ── MCP Server Registry ─────────────────────────────────────

export interface MCPServerConfig {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly transport: "stdio" | "http";
  readonly env?: Record<string, string>;
  readonly enabled: boolean;
  readonly autoStart?: boolean;
}

export interface MCPTool {
  readonly serverName: string;
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface MCPRegistryOptions {
  readonly projectDir?: string;
  readonly qmdCommand?: string;
  readonly autoRegisterBuiltins?: boolean;
}

export class MCPRegistry {
  private readonly servers: Map<string, MCPServerConfig> = new Map();
  private readonly tools: Map<string, MCPTool[]> = new Map();
  private readonly projectDir: string;
  private readonly qmdCommand: string;

  constructor(options: MCPRegistryOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd());
    this.qmdCommand = options.qmdCommand ?? process.env["QMD_COMMAND"] ?? "qmd";

    if (options.autoRegisterBuiltins) {
      this.registerBuiltins();
    }
  }

  register(config: MCPServerConfig): void {
    this.servers.set(config.name, config);
  }

  unregister(name: string): void {
    this.servers.delete(name);
    this.tools.delete(name);
  }

  getServer(name: string): MCPServerConfig | undefined {
    return this.servers.get(name);
  }

  getAllServers(): readonly MCPServerConfig[] {
    return [...this.servers.values()];
  }

  getEnabledServers(): readonly MCPServerConfig[] {
    return [...this.servers.values()].filter((s) => s.enabled);
  }

  registerBuiltins(): number {
    let registered = 0;
    if (this.registerQMDServer()) registered++;
    if (this.registerCogneeServer()) registered++;
    if (this.registerOmiServer()) registered++;
    return registered;
  }

  /**
   * C15 — Cognee MCP wrapper. Cognee is an external memory system exposing
   * the four verbs `remember`, `recall`, `forget`, `improve` over stdio
   * when the `cognee` CLI is installed (pipx install cognee). We register
   * it as a non-autostart MCP source so the memory router can optionally
   * consult it alongside WOTANN's built-in memory. Opt-in: disabled by
   * default, users enable via `wotann mcp enable cognee`.
   */
  registerCogneeServer(): boolean {
    if (this.servers.has("cognee")) return true;
    // Prefer a user-provided path (COGNEE_CMD) to accommodate pipx/uv
    // venvs; fall back to the bare command name so PATH lookup happens.
    const bin = process.env["COGNEE_CMD"] ?? "cognee";
    if (!commandExists(bin)) return false;

    this.register({
      name: "cognee",
      command: bin,
      args: ["mcp"],
      transport: "stdio",
      env: {
        COGNEE_PROJECT_ROOT: this.projectDir,
      },
      // Opt-in by default — cognee routes memory to an external model/DB
      // which is not a choice WOTANN wants to make silently.
      enabled: false,
      autoStart: false,
    });
    return true;
  }

  /**
   * C18 — Omi MCP integration. Omi is a personal-memory MCP server
   * ($HOME/.omi/mcp). Like Cognee, registered disabled-by-default so the
   * user opts in explicitly — Omi memories may contain personal
   * cross-context data that should not leak into code tasks without
   * explicit consent.
   */
  registerOmiServer(): boolean {
    if (this.servers.has("omi")) return true;
    const bin = process.env["OMI_CMD"] ?? "omi";
    if (!commandExists(bin)) return false;

    this.register({
      name: "omi",
      command: bin,
      args: ["mcp"],
      transport: "stdio",
      env: {
        OMI_PROJECT_ROOT: this.projectDir,
      },
      enabled: false,
      autoStart: false,
    });
    return true;
  }

  registerQMDServer(): boolean {
    if (this.servers.has("qmd")) return true;
    if (!commandExists(this.qmdCommand)) return false;

    this.register({
      name: "qmd",
      command: this.qmdCommand,
      args: ["mcp"],
      transport: "stdio",
      env: {
        QMD_PROJECT_ROOT: this.projectDir,
      },
      enabled: true,
      autoStart: false,
    });
    return true;
  }

  /**
   * Import MCP servers from Claude Code settings.
   */
  importFromClaudeCode(): number {
    const claudeSettingsPath = join(homedir(), ".claude", "settings.json");
    if (!existsSync(claudeSettingsPath)) return 0;

    try {
      const raw = readFileSync(claudeSettingsPath, "utf-8");
      const settings = JSON.parse(raw) as Record<string, unknown>;
      const mcpServers = settings["mcpServers"] as Record<string, unknown> | undefined;
      if (!mcpServers) return 0;

      let imported = 0;
      for (const [name, config] of Object.entries(mcpServers)) {
        if (typeof config === "object" && config !== null) {
          const c = config as Record<string, unknown>;
          this.register({
            name,
            command: String(c["command"] ?? ""),
            args: (c["args"] as string[]) ?? [],
            transport: "stdio",
            env: c["env"] as Record<string, string> | undefined,
            enabled: true,
          });
          imported++;
        }
      }
      return imported;
    } catch {
      return 0;
    }
  }

  /**
   * Import from Cursor, Windsurf, Codex, or VSCode configs.
   *
   * VSCode is a special case — MCP servers live under the `mcp` key of
   * `settings.json` (not a dedicated `mcp.json`). Both stable and
   * Insiders paths are probed; the first one that exists wins.
   */
  importFromTool(tool: "cursor" | "windsurf" | "codex" | "vscode"): number {
    if (tool === "vscode") return this.importFromVscode();

    const paths: Record<string, string> = {
      cursor: join(homedir(), ".cursor", "mcp.json"),
      windsurf: join(homedir(), ".windsurf", "mcp.json"),
      codex: join(homedir(), ".codex", "mcp.json"),
    };

    const configPath = paths[tool];
    if (!configPath || !existsSync(configPath)) return 0;

    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const servers = config["mcpServers"] ?? config["servers"];
      if (!servers || typeof servers !== "object") return 0;

      let imported = 0;
      for (const [name, serverConfig] of Object.entries(servers as Record<string, unknown>)) {
        if (typeof serverConfig === "object" && serverConfig !== null) {
          const c = serverConfig as Record<string, unknown>;
          this.register({
            name: `${tool}-${name}`,
            command: String(c["command"] ?? ""),
            args: (c["args"] as string[]) ?? [],
            transport: "stdio",
            env: c["env"] as Record<string, string> | undefined,
            enabled: true,
          });
          imported++;
        }
      }
      return imported;
    } catch {
      return 0;
    }
  }

  /**
   * Wave 4E: Import MCP servers from VSCode's `settings.json`. VSCode's
   * MCP support (built-in as of the Nov 2025 release) puts server
   * definitions under `settings.json -> mcp.servers`. We probe both
   * stable (`~/.config/Code/User/settings.json` or `~/Library/Application
   * Support/Code/User/settings.json`) and Insiders paths.
   *
   * Honest failure: if no known VSCode settings file exists, returns 0.
   * Malformed JSON also returns 0 (logged to stderr by callers if needed).
   */
  importFromVscode(): number {
    const candidates = vscodeSettingsCandidates();
    for (const configPath of candidates) {
      if (!existsSync(configPath)) continue;
      try {
        const raw = readFileSync(configPath, "utf-8");
        // VSCode settings may include trailing commas / // comments; use a
        // tolerant parser so the first byte of an unparseable file doesn't
        // crash the whole import.
        const stripped = stripJsonComments(raw);
        const config = JSON.parse(stripped) as Record<string, unknown>;
        const mcpBlock = (config["mcp"] as Record<string, unknown> | undefined) ?? {};
        const servers = (mcpBlock["servers"] ?? mcpBlock["mcpServers"]) as
          | Record<string, unknown>
          | undefined;
        if (!servers || typeof servers !== "object") return 0;

        let imported = 0;
        for (const [name, serverConfig] of Object.entries(servers)) {
          if (typeof serverConfig === "object" && serverConfig !== null) {
            const c = serverConfig as Record<string, unknown>;
            this.register({
              name: `vscode-${name}`,
              command: String(c["command"] ?? ""),
              args: (c["args"] as string[]) ?? [],
              transport: "stdio",
              env: c["env"] as Record<string, string> | undefined,
              enabled: true,
            });
            imported++;
          }
        }
        return imported;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  /**
   * Wave 4E: Persist the current in-memory registry to
   * `~/.wotann/mcp.json` so subsequent runs pick it up. Returns the path
   * written. Honest: only writes servers that have a non-empty command
   * (skeleton entries get dropped to avoid producing unusable exports).
   */
  persistToDisk(filePath?: string): string {
    const out = filePath ?? defaultMcpConfigPath();
    const dir = dirname(out);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const payload: Record<string, unknown> = {
      version: "1.0.0",
      generatedBy: "wotann",
      generatedAt: new Date().toISOString(),
      mcpServers: Object.fromEntries(
        [...this.servers.values()]
          .filter((s) => s.command !== "")
          .map((s) => [
            s.name,
            {
              command: s.command,
              args: s.args,
              transport: s.transport,
              ...(s.env ? { env: s.env } : {}),
              enabled: s.enabled,
              ...(s.autoStart !== undefined ? { autoStart: s.autoStart } : {}),
            },
          ]),
      ),
    };

    writeFileSync(out, JSON.stringify(payload, null, 2));
    return out;
  }

  /**
   * Wave 4E: Load servers from `~/.wotann/mcp.json` (or a custom path).
   * Complements `persistToDisk`. Returns the number of servers loaded.
   */
  loadFromDisk(filePath?: string): number {
    const src = filePath ?? defaultMcpConfigPath();
    if (!existsSync(src)) return 0;
    try {
      const raw = readFileSync(src, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const servers = parsed["mcpServers"] as Record<string, unknown> | undefined;
      if (!servers || typeof servers !== "object") return 0;

      let loaded = 0;
      for (const [name, serverConfig] of Object.entries(servers)) {
        if (typeof serverConfig === "object" && serverConfig !== null) {
          const c = serverConfig as Record<string, unknown>;
          const command = String(c["command"] ?? "");
          if (!command) continue;
          this.register({
            name,
            command,
            args: (c["args"] as string[]) ?? [],
            transport:
              (c["transport"] as "stdio" | "http" | undefined) === "http" ? "http" : "stdio",
            env: c["env"] as Record<string, string> | undefined,
            enabled: c["enabled"] === false ? false : true,
            ...(c["autoStart"] !== undefined ? { autoStart: c["autoStart"] === true } : {}),
          });
          loaded++;
        }
      }
      return loaded;
    } catch {
      return 0;
    }
  }

  /**
   * Wave 4E: Export the current registry in an ACP-compatible shape so
   * other clients (Zed, Cursor, etc.) can import WOTANN's config. The
   * wire format matches the ACP v1 `McpServerConfig` variants (stdio +
   * http) so the output can be fed into any ACP-speaking host.
   */
  exportAcp(): {
    readonly version: string;
    readonly servers: ReadonlyArray<
      | {
          readonly transport: "stdio";
          readonly name: string;
          readonly command: string;
          readonly args: readonly string[];
          readonly env?: readonly { readonly name: string; readonly value: string }[];
        }
      | {
          readonly transport: "http";
          readonly name: string;
          readonly command: string;
          readonly args: readonly string[];
        }
    >;
  } {
    const servers = [...this.servers.values()]
      .filter((s) => s.enabled && s.command !== "")
      .map((s) => {
        if (s.transport === "http") {
          return {
            transport: "http" as const,
            name: s.name,
            command: s.command,
            args: s.args,
          };
        }
        const entry = {
          transport: "stdio" as const,
          name: s.name,
          command: s.command,
          args: s.args,
        };
        if (s.env && Object.keys(s.env).length > 0) {
          return {
            ...entry,
            env: Object.entries(s.env).map(([name, value]) => ({ name, value })),
          };
        }
        return entry;
      });

    return { version: "1.0.0", servers };
  }

  getServerCount(): number {
    return this.servers.size;
  }
}

// ── Skill Marketplace ───────────────────────────────────────

export interface MarketplaceSkill {
  readonly name: string;
  readonly description: string;
  readonly author: string;
  readonly version: string;
  readonly downloads: number;
  readonly rating: number;
  readonly category: string;
  readonly url: string;
  readonly sourcePath?: string;
}

export type SkillEvalGrade = "gold" | "silver" | "bronze" | "unrated";

export interface SkillEvalResult {
  readonly skillName: string;
  readonly grade: SkillEvalGrade;
  readonly staticScore: number;
  readonly llmScore: number;
  readonly overallScore: number;
  readonly issues: readonly string[];
}

export interface SkillMarketplaceOptions {
  readonly searchRoots?: readonly string[];
  readonly gitBinary?: string;
  /** Base directory for marketplace-installed skills. Defaults to ~/.wotann/marketplace/ */
  readonly marketplaceDir?: string;
}

/** Metadata persisted alongside a marketplace-installed skill. */
export interface InstalledSkillMeta {
  readonly name: string;
  readonly repo: string;
  readonly installedAt: string;
  readonly description: string;
  readonly version: string;
}

/** Result from a GitHub marketplace search. */
export interface GitHubSkillResult {
  readonly name: string;
  readonly fullName: string;
  readonly description: string;
  readonly url: string;
  readonly stars: number;
  readonly updatedAt: string;
}

export class SkillMarketplace {
  private readonly searchRoots: readonly string[];
  private readonly gitBinary: string;
  private readonly marketplaceDir: string;

  constructor(options: SkillMarketplaceOptions = {}) {
    this.searchRoots = options.searchRoots ?? defaultSearchRoots(process.cwd());
    this.gitBinary = options.gitBinary ?? "git";
    this.marketplaceDir = options.marketplaceDir ?? join(homedir(), ".wotann", "marketplace");
  }

  /**
   * Search the marketplace for skills.
   */
  async search(query: string): Promise<readonly MarketplaceSkill[]> {
    const normalized = query.trim().toLowerCase();
    const discovered = discoverSkills(this.searchRoots);

    return discovered
      .filter((skill) => {
        if (!normalized) return true;
        return [skill.name, skill.description, skill.category, skill.author, skill.url].some(
          (field) => field.toLowerCase().includes(normalized),
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Install a skill from the marketplace.
   */
  async install(name: string, targetDir: string): Promise<boolean> {
    mkdirSync(targetDir, { recursive: true });

    if (looksLikeGitSource(name)) {
      return installFromGit(name, targetDir, this.gitBinary);
    }

    if (existsSync(name)) {
      return installFromPath(name, targetDir);
    }

    const match = (await this.search(name)).find(
      (skill) => skill.name === name || skill.url === name,
    );
    if (!match?.sourcePath) return false;

    return installFromPath(match.sourcePath, targetDir);
  }

  /**
   * Install a skill from a GitHub repository.
   *
   * Clones the repo to ~/.wotann/marketplace/{repo-name}/, reads SKILL.md
   * from the repo root, and persists installation metadata.
   *
   * @param repo - GitHub repo in "owner/name" format (e.g. "acme/wotann-skill-lint")
   * @returns The installed skill metadata, or null if installation failed.
   */
  async installFromGitHub(repo: string): Promise<InstalledSkillMeta | null> {
    const repoName = extractRepoName(repo);
    const repoUrl = repo.startsWith("https://") ? repo : `https://github.com/${repo}.git`;

    const installDir = join(this.marketplaceDir, repoName);

    // If already installed, remove old version first
    if (existsSync(installDir)) {
      rmSync(installDir, { recursive: true, force: true });
    }

    mkdirSync(this.marketplaceDir, { recursive: true });

    try {
      execFileSync(this.gitBinary, ["clone", "--depth", "1", repoUrl, installDir], {
        stdio: "ignore",
        timeout: 60_000,
      });
    } catch {
      return null;
    }

    // Read SKILL.md from the cloned repo
    const skillPath = join(installDir, "SKILL.md");
    const skillContent = existsSync(skillPath) ? readFileSync(skillPath, "utf-8") : "";
    const frontmatter = extractFrontmatter(skillContent);

    const meta: InstalledSkillMeta = {
      name: String(frontmatter["name"] ?? repoName),
      repo,
      installedAt: new Date().toISOString(),
      description: String(frontmatter["description"] ?? ""),
      version: String(frontmatter["version"] ?? "0.0.0"),
    };

    // Persist metadata alongside the skill
    writeFileSync(join(installDir, ".wotann-meta.json"), JSON.stringify(meta, null, 2));

    return meta;
  }

  /**
   * Search GitHub for repositories with the `wotann-skill` topic.
   *
   * Uses the `gh` CLI (GitHub CLI) to search for repos matching the query
   * that are tagged with the `wotann-skill` topic. Falls back to a basic
   * git-ls-remote check if `gh` is not available.
   *
   * @param query - Search term to filter results
   * @returns Array of matching GitHub skill repos
   */
  async searchMarketplace(query: string): Promise<readonly GitHubSkillResult[]> {
    // Attempt to use `gh` CLI for GitHub search
    const ghAvailable = commandExists("gh");
    if (!ghAvailable) {
      return [];
    }

    try {
      const searchQuery = query ? `${query} topic:wotann-skill` : "topic:wotann-skill";

      const { stdout } = await execFileAsync(
        "gh",
        [
          "search",
          "repos",
          searchQuery,
          "--json",
          "name,fullName,description,url,stargazersCount,updatedAt",
          "--limit",
          "25",
        ],
        { timeout: 15_000 },
      );

      const results = JSON.parse(stdout) as readonly RawGitHubSearchResult[];

      return results.map((r) => ({
        name: r.name,
        fullName: r.fullName,
        description: r.description ?? "",
        url: r.url,
        stars: r.stargazersCount,
        updatedAt: r.updatedAt,
      }));
    } catch {
      return [];
    }
  }

  /**
   * List all skills installed via the marketplace.
   *
   * Reads the ~/.wotann/marketplace/ directory and returns metadata
   * for each installed skill. Skills without .wotann-meta.json are
   * listed with inferred metadata from directory name.
   */
  listInstalled(): readonly InstalledSkillMeta[] {
    if (!existsSync(this.marketplaceDir)) {
      return [];
    }

    const entries = readdirSync(this.marketplaceDir, { withFileTypes: true });
    const installed: InstalledSkillMeta[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const metaPath = join(this.marketplaceDir, entry.name, ".wotann-meta.json");

      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as InstalledSkillMeta;
          installed.push(meta);
          continue;
        } catch {
          // Fall through to inferred metadata
        }
      }

      // Infer metadata from directory contents
      const skillPath = join(this.marketplaceDir, entry.name, "SKILL.md");
      const skillContent = existsSync(skillPath) ? readFileSync(skillPath, "utf-8") : "";
      const frontmatter = extractFrontmatter(skillContent);

      installed.push({
        name: String(frontmatter["name"] ?? entry.name),
        repo: "",
        installedAt: "",
        description: String(frontmatter["description"] ?? ""),
        version: String(frontmatter["version"] ?? "0.0.0"),
      });
    }

    return installed;
  }

  /**
   * Regenerate the marketplace manifest from current skills and plugins.
   * Scans the skills and plugins directories and writes a fresh manifest.
   *
   * @param manifestPath - Where to write the manifest JSON (defaults to ~/.wotann/marketplace-manifest.json)
   * @returns The generated manifest
   */
  regenerateManifest(manifestPath?: string): MarketplaceManifest {
    const skillsDir = this.searchRoots[0] ?? join(process.cwd(), ".wotann", "skills");
    const pluginsDir = join(dirname(skillsDir), "plugins");
    const outputPath = manifestPath ?? join(this.marketplaceDir, "manifest.json");

    const manifest = generateManifest(skillsDir, pluginsDir);
    writeManifest(manifest, outputPath);
    return manifest;
  }

  /**
   * Evaluate a skill's quality.
   */
  evaluateStatic(skillContent: string): SkillEvalResult {
    const issues: string[] = [];
    let score = 100;

    // Check frontmatter
    if (!skillContent.startsWith("---")) {
      issues.push("Missing YAML frontmatter");
      score -= 20;
    }

    // Check for name and description
    if (!skillContent.includes("name:")) {
      issues.push("Missing name field");
      score -= 15;
    }
    if (!skillContent.includes("description:")) {
      issues.push("Missing description field");
      score -= 15;
    }

    // Check length (too short = likely stub)
    if (skillContent.length < 200) {
      issues.push("Content too short (likely a stub)");
      score -= 20;
    }

    // Check for instructions
    if (!skillContent.includes("#")) {
      issues.push("No markdown headers found");
      score -= 10;
    }

    const grade: SkillEvalGrade =
      score >= 90 ? "gold" : score >= 70 ? "silver" : score >= 50 ? "bronze" : "unrated";

    return {
      skillName: "evaluated",
      grade,
      staticScore: Math.max(0, score),
      llmScore: 0,
      overallScore: Math.max(0, score),
      issues,
    };
  }
}

function defaultSearchRoots(cwd: string): readonly string[] {
  return [
    join(cwd, ".wotann", "skills"),
    join(cwd, "skills"),
    join(cwd, ".agents", "skills"),
    join(cwd, ".claude", "skills"),
  ];
}

function discoverSkills(roots: readonly string[]): readonly MarketplaceSkill[] {
  const discovered = new Map<string, MarketplaceSkill>();

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const candidate of walkSkillCandidates(root)) {
      const parsed = parseSkillMetadata(candidate);
      if (!parsed) continue;
      discovered.set(parsed.url, parsed);
    }
  }

  return [...discovered.values()];
}

function* walkSkillCandidates(root: string): Generator<string> {
  if (!existsSync(root)) return;

  const stats = statSync(root);
  if (!stats.isDirectory()) {
    if (isCandidateSkillFile(root)) yield root;
    return;
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      const bundleSkill = join(fullPath, "SKILL.md");
      if (existsSync(bundleSkill)) {
        yield bundleSkill;
      }
      yield* walkSkillCandidates(fullPath);
      continue;
    }

    if (entry.isFile() && isCandidateSkillFile(fullPath)) {
      yield fullPath;
    }
  }
}

function isCandidateSkillFile(filePath: string): boolean {
  return filePath.endsWith("SKILL.md") || filePath.endsWith(".md");
}

function parseSkillMetadata(filePath: string): MarketplaceSkill | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const frontmatter = extractFrontmatter(raw);
    const description = getDescription(raw, frontmatter);
    const name = String(frontmatter["name"] ?? inferSkillName(filePath));

    if (!name || !description) return null;

    const sourcePath = basename(filePath) === "SKILL.md" ? dirname(filePath) : filePath;

    return {
      name,
      description,
      author: String(frontmatter["author"] ?? "local"),
      version: String(frontmatter["version"] ?? "0.0.0"),
      downloads: 0,
      rating: 0,
      category: String(frontmatter["category"] ?? "local"),
      url: filePath,
      sourcePath,
    };
  } catch {
    return null;
  }
}

function extractFrontmatter(raw: string): Record<string, unknown> {
  if (!raw.startsWith("---")) return {};

  const endIndex = raw.indexOf("\n---", 4);
  if (endIndex === -1) return {};

  try {
    const parsed = YAML.parse(raw.slice(4, endIndex));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function getDescription(raw: string, frontmatter: Record<string, unknown>): string {
  const fromFrontmatter = frontmatter["description"];
  if (typeof fromFrontmatter === "string" && fromFrontmatter.trim().length > 0) {
    return fromFrontmatter.trim();
  }

  const withoutFrontmatter = raw.startsWith("---")
    ? raw.slice(raw.indexOf("\n---", 4) + 4).trim()
    : raw.trim();

  const firstContentLine = withoutFrontmatter
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));

  return firstContentLine ?? "";
}

function inferSkillName(filePath: string): string {
  return basename(filePath) === "SKILL.md"
    ? basename(dirname(filePath))
    : basename(filePath, ".md");
}

function looksLikeGitSource(source: string): boolean {
  return (
    source.startsWith("git@") ||
    source.startsWith("https://") ||
    source.startsWith("ssh://") ||
    source.startsWith("file://") ||
    source.endsWith(".git")
  );
}

function installFromGit(source: string, targetDir: string, gitBinary: string): boolean {
  const tempDir = mkdtempSync(join(tmpdir(), "wotann-marketplace-"));

  try {
    execFileSync(gitBinary, ["clone", "--depth", "1", source, tempDir], {
      stdio: "ignore",
    });
    const installSource = selectInstallSource(tempDir);
    return installFromPath(installSource, targetDir);
  } catch {
    return false;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function installFromPath(source: string, targetDir: string): boolean {
  const resolvedSource = resolve(source);
  if (!existsSync(resolvedSource)) return false;

  const sourceStats = statSync(resolvedSource);
  const normalizedSource =
    sourceStats.isFile() && basename(resolvedSource) === "SKILL.md"
      ? dirname(resolvedSource)
      : resolvedSource;
  const destName = basename(normalizedSource);
  const destination = uniqueDestination(join(targetDir, destName));

  cpSync(normalizedSource, destination, { recursive: true });
  return existsSync(destination);
}

function selectInstallSource(repoDir: string): string {
  const rootSkill = join(repoDir, "SKILL.md");
  if (existsSync(rootSkill)) return repoDir;

  const nested = discoverSkills([repoDir]).find((skill) => skill.sourcePath);
  return nested?.sourcePath ?? repoDir;
}

function uniqueDestination(baseDestination: string): string {
  if (!existsSync(baseDestination)) return baseDestination;

  let index = 2;
  let candidate = `${baseDestination}-${index}`;
  while (existsSync(candidate)) {
    index++;
    candidate = `${baseDestination}-${index}`;
  }
  return candidate;
}

function commandExists(command: string): boolean {
  if (!command) return false;
  if (command.startsWith("/") && existsSync(command)) return true;

  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wave 4E: Default path for WOTANN's MCP config file. Lives at
 * `~/.wotann/mcp.json`. Users or tests can override with
 * `WOTANN_MCP_CONFIG_PATH` env var.
 */
function defaultMcpConfigPath(): string {
  return process.env["WOTANN_MCP_CONFIG_PATH"] ?? join(homedir(), ".wotann", "mcp.json");
}

/**
 * Wave 4E: Candidate VSCode settings paths across platforms. Probes
 * Stable then Insiders, macOS then Linux then Windows.
 * `WOTANN_VSCODE_SETTINGS_PATH` overrides all of them for test isolation.
 */
function vscodeSettingsCandidates(): readonly string[] {
  const override = process.env["WOTANN_VSCODE_SETTINGS_PATH"];
  if (override) return [override];

  const home = homedir();
  const macCode = join(home, "Library", "Application Support", "Code", "User", "settings.json");
  const macInsiders = join(
    home,
    "Library",
    "Application Support",
    "Code - Insiders",
    "User",
    "settings.json",
  );
  const linuxCode = join(home, ".config", "Code", "User", "settings.json");
  const linuxInsiders = join(home, ".config", "Code - Insiders", "User", "settings.json");
  const appdata = process.env["APPDATA"];
  const winCode = appdata ? join(appdata, "Code", "User", "settings.json") : "";
  const winInsiders = appdata ? join(appdata, "Code - Insiders", "User", "settings.json") : "";

  return [macCode, macInsiders, linuxCode, linuxInsiders, winCode, winInsiders].filter(
    (p) => p.length > 0,
  );
}

/**
 * Wave 4E: Strip // line comments and block comments from a JSON-ish
 * payload so VSCode's JSONC settings can be parsed with `JSON.parse`.
 * Quoted strings are preserved (including escaped quotes).
 */
function stripJsonComments(raw: string): string {
  let out = "";
  let i = 0;
  const n = raw.length;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  while (i < n) {
    const ch = raw[i]!;
    const next = i + 1 < n ? raw[i + 1] : "";

    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < n) {
        out += raw[i + 1];
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch as '"' | "'";
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < n && raw[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Extract the repo name from a GitHub "owner/name" string or full URL.
 * "acme/wotann-skill-lint" -> "wotann-skill-lint"
 * "https://github.com/acme/wotann-skill-lint.git" -> "wotann-skill-lint"
 */
function extractRepoName(repo: string): string {
  // Handle full URLs
  const urlMatch = repo.match(/\/([^/]+?)(?:\.git)?$/);
  if (urlMatch?.[1]) return urlMatch[1];

  // Handle owner/name format
  const parts = repo.split("/");
  return parts[parts.length - 1] ?? repo;
}

/** Raw shape returned by `gh search repos --json`. */
interface RawGitHubSearchResult {
  readonly name: string;
  readonly fullName: string;
  readonly description: string | null;
  readonly url: string;
  readonly stargazersCount: number;
  readonly updatedAt: string;
}
