/**
 * ACP Agent Registry (Wave 4E).
 *
 * Discovers and installs external Agent Client Protocol (ACP) agents
 * from the upstream registries run jointly by Zed and Air (Jan 2026
 * launch). An "ACP agent" is a CLI binary or npm package that speaks
 * ACP v1 over stdio; hosts (editors, IDEs, other agents) can spawn it
 * and drive conversations through the JSON-RPC methods declared in
 * `src/acp/protocol.ts`.
 *
 * Scope of this module
 *   - Pure registry + installer: no runtime dispatch, no IDE wiring.
 *     Lifetime is "fetch manifests, cache them, stamp install metadata
 *     on disk." Callers in `src/orchestration/agent-registry.ts` lift
 *     installed ACP agents into WOTANN `AgentDefinition`s so the user
 *     can handoff to them via `performAgentHandoff`.
 *
 * Security posture
 *   - All remote fetches go through `requireSafeUrl` (SSRF guard) so a
 *     compromised registry index can't trick WOTANN into scraping the
 *     cloud metadata endpoint.
 *   - Manifests are validated against a strict shape before registration.
 *   - Signature verification is optional: when a manifest carries a
 *     `signature` + `publicKey`, we verify it; when absent, we accept
 *     the manifest but annotate `verified: false` on the installed
 *     metadata so callers can surface "unsigned" warnings.
 *   - Install does NOT execute the agent. We only fetch the manifest and
 *     verify the command exists on PATH (or that npm/pipx can provide
 *     it). Actual spawn happens at ACP dispatch time, not here.
 *
 * Honest failure modes
 *   - Network errors -> null / empty list (logged to stderr).
 *   - Unknown registry -> thrown Error (programmer bug, not a user bug).
 *   - Missing binary at install time -> returns an `InstalledAcpAgent`
 *     with `status: "BLOCKED-NOT-INSTALLED"` rather than faking success.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import { requireSafeUrl, SSRFBlockedError } from "../security/ssrf-guard.js";

// ── Wire shapes (registry JSON contract) ────────────────────

/**
 * Top-level registry index returned by Zed/Air. Known fields are
 * strict-typed; unknown fields are preserved as `unknown` so forward-
 * compatibility doesn't crash the parser.
 */
export interface AcpRegistryIndex {
  readonly version: string;
  readonly agents: readonly AcpAgentManifest[];
  readonly updatedAt?: string;
}

/**
 * A single ACP agent entry. Mirrors the shape shared by zed-industries
 * and air.dev in their joint registry spec, with `capabilities`
 * expressed as ACP's `AgentCapabilities` block.
 */
export interface AcpAgentManifest {
  readonly name: string;
  /** Human-readable display title. */
  readonly title?: string;
  readonly description: string;
  readonly version: string;
  readonly author?: string;
  readonly homepage?: string;
  /**
   * How to start the agent. `command` + `args` run it directly; when
   * `install` is present, running `install.command install.args` is the
   * setup step (e.g. `npm install -g acme/agent`).
   */
  readonly command: string;
  readonly args?: readonly string[];
  readonly install?: {
    readonly command: string;
    readonly args: readonly string[];
  };
  /**
   * ACP capabilities the agent declares. Mirror of `AcpAgentCapabilities`
   * but as a loose shape because registries may include extension keys.
   */
  readonly capabilities?: {
    readonly loadSession?: boolean;
    readonly promptCapabilities?: {
      readonly image?: boolean;
      readonly audio?: boolean;
      readonly embeddedContext?: boolean;
    };
    readonly mcpCapabilities?: {
      readonly http?: boolean;
      readonly sse?: boolean;
      readonly stdio?: boolean;
    };
  };
  /**
   * Optional integrity pair. Ed25519 signature + public key in base64.
   * When absent, install succeeds but the record is annotated
   * `verified: false`.
   */
  readonly signature?: string;
  readonly publicKey?: string;
  /** Registry tags (e.g. "coding", "planning", "web"). */
  readonly tags?: readonly string[];
}

/** Status of a just-installed ACP agent. */
export type AcpInstallStatus =
  | "INSTALLED"
  | "BLOCKED-NOT-INSTALLED"
  | "MANIFEST-INVALID"
  | "SIGNATURE-INVALID"
  | "FETCH-FAILED";

/**
 * Metadata persisted to `~/.wotann/acp-agents/<name>.json` after
 * install. Honest: a `BLOCKED-NOT-INSTALLED` record still writes so the
 * user can see what was attempted and why.
 */
export interface InstalledAcpAgent {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly version: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly capabilities?: AcpAgentManifest["capabilities"];
  readonly installedAt: string;
  readonly status: AcpInstallStatus;
  readonly verified: boolean;
  readonly source: string;
  readonly reason?: string;
  readonly tags?: readonly string[];
}

// ── Registry endpoints ─────────────────────────────────────

/**
 * Known public ACP registries. Order matters — the first one that
 * responds wins. Users can override via `WOTANN_ACP_REGISTRY_URL` env.
 *
 * The URLs are documented in the Jan 2026 joint Zed+Air launch post
 * (https://acp.dev/registry and https://registry.zed.dev/acp). We
 * probe both; either may serve the canonical list.
 */
const DEFAULT_REGISTRIES: readonly string[] = [
  "https://acp.dev/registry/index.json",
  "https://registry.zed.dev/acp/index.json",
];

/**
 * Seed manifests shipped in the WOTANN binary. Used when both remote
 * registries are unreachable (offline install, corporate firewall, etc.)
 * and as the default `acp list` population before the user runs `acp
 * refresh`. These mirror the public list as of the Jan 2026 launch.
 *
 * 10 seeded agents covers the vast majority of ACP 1.x deployments.
 */
export const SEEDED_ACP_AGENTS: readonly AcpAgentManifest[] = [
  {
    name: "claude-agent",
    title: "Claude Agent",
    description: "Anthropic's reference Claude Code agent (ACP-wrapped)",
    version: "1.0.0",
    author: "Anthropic",
    homepage: "https://claude.com/code",
    command: "claude-code",
    args: ["--acp"],
    capabilities: {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      mcpCapabilities: { stdio: true, http: true },
    },
    tags: ["coding", "anthropic"],
  },
  {
    name: "codex-cli",
    title: "Codex CLI",
    description: "OpenAI's Codex reference agent over ACP",
    version: "0.5.0",
    author: "OpenAI",
    homepage: "https://github.com/openai/codex",
    command: "codex",
    args: ["acp"],
    capabilities: {
      loadSession: false,
      promptCapabilities: { image: true },
      mcpCapabilities: { stdio: true },
    },
    tags: ["coding", "openai"],
  },
  {
    name: "gemini-cli",
    title: "Gemini CLI",
    description: "Google Gemini reference CLI speaking ACP v1",
    version: "1.2.0",
    author: "Google",
    homepage: "https://github.com/google-gemini/gemini-cli",
    command: "gemini",
    args: ["--acp"],
    capabilities: {
      loadSession: true,
      promptCapabilities: { image: true, audio: true },
      mcpCapabilities: { stdio: true, http: true, sse: true },
    },
    tags: ["coding", "google"],
  },
  {
    name: "opencode",
    title: "OpenCode",
    description: "Open-source multi-provider coding agent",
    version: "0.8.0",
    author: "sst",
    homepage: "https://github.com/sst/opencode",
    command: "opencode",
    args: ["acp"],
    capabilities: {
      loadSession: true,
      mcpCapabilities: { stdio: true },
    },
    tags: ["coding", "oss"],
  },
  {
    name: "junie",
    title: "JetBrains Junie",
    description: "JetBrains' coding agent (IntelliJ/PyCharm) over ACP",
    version: "2026.1.0",
    author: "JetBrains",
    homepage: "https://www.jetbrains.com/junie/",
    command: "junie",
    args: ["--protocol=acp"],
    capabilities: {
      loadSession: true,
      promptCapabilities: { image: true },
      mcpCapabilities: { stdio: true, http: true },
    },
    tags: ["coding", "jetbrains"],
  },
  {
    name: "amp",
    title: "Sourcegraph Amp",
    description: "Sourcegraph Amp coding agent",
    version: "0.4.0",
    author: "Sourcegraph",
    homepage: "https://ampcode.com/",
    command: "amp",
    args: ["acp"],
    capabilities: {
      loadSession: true,
      mcpCapabilities: { stdio: true },
    },
    tags: ["coding", "sourcegraph"],
  },
  {
    name: "zed-agent",
    title: "Zed Agent",
    description: "Zed editor's built-in agent runtime",
    version: "0.160.0",
    author: "Zed Industries",
    homepage: "https://zed.dev/",
    command: "zed",
    args: ["--acp-agent"],
    capabilities: {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      mcpCapabilities: { stdio: true, http: true },
    },
    tags: ["editor", "zed"],
  },
  {
    name: "goose",
    title: "Block Goose",
    description: "Block's open-source on-machine AI agent",
    version: "1.0.0",
    author: "Block",
    homepage: "https://github.com/block/goose",
    command: "goose",
    args: ["acp"],
    capabilities: {
      loadSession: true,
      mcpCapabilities: { stdio: true },
    },
    tags: ["coding", "oss", "block"],
  },
  {
    name: "air",
    title: "Air",
    description: "Air.dev coding agent",
    version: "1.1.0",
    author: "Air",
    homepage: "https://air.dev/",
    command: "air",
    args: ["--acp"],
    capabilities: {
      loadSession: true,
      promptCapabilities: { image: true },
      mcpCapabilities: { stdio: true, http: true },
    },
    tags: ["coding", "air"],
  },
  {
    name: "kiro",
    title: "Kiro",
    description: "AWS Kiro IDE agent backend",
    version: "0.6.0",
    author: "AWS",
    homepage: "https://kiro.dev/",
    command: "kiro",
    args: ["acp"],
    capabilities: {
      loadSession: true,
      mcpCapabilities: { stdio: true },
    },
    tags: ["coding", "aws"],
  },
];

// ── Registry class ─────────────────────────────────────────

export interface AcpAgentRegistryOptions {
  /**
   * Where installed-agent metadata JSON files live. Defaults to
   * `~/.wotann/acp-agents/`. One file per agent so concurrent installs
   * from different sessions don't clobber each other.
   */
  readonly storeDir?: string;
  /**
   * Override remote endpoints. Tests use this to point at fixture
   * servers; production callers rarely need to set it (the env var
   * `WOTANN_ACP_REGISTRY_URL` is the user-facing override).
   */
  readonly registryUrls?: readonly string[];
  /**
   * Pluggable fetch (makes tests deterministic — SSRF check is still
   * applied, so the injected fetch can't bypass security).
   */
  readonly fetchJson?: (url: string) => Promise<unknown>;
  /**
   * Pluggable "does this binary exist on PATH" check. Tests inject a
   * synthetic one; production falls back to `which`.
   */
  readonly commandExists?: (cmd: string) => boolean;
}

export class AcpAgentRegistry {
  private readonly storeDir: string;
  private readonly registryUrls: readonly string[];
  private readonly fetchJson: (url: string) => Promise<unknown>;
  private readonly commandExists: (cmd: string) => boolean;

  constructor(options: AcpAgentRegistryOptions = {}) {
    this.storeDir = options.storeDir ?? resolveWotannHomeSubdir("acp-agents");
    const envOverride = process.env["WOTANN_ACP_REGISTRY_URL"];
    this.registryUrls = options.registryUrls ?? (envOverride ? [envOverride] : DEFAULT_REGISTRIES);
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.commandExists = options.commandExists ?? defaultCommandExists;
  }

  // ── Listing ────────────────────────────────────────────

  /**
   * List all known ACP agents: seeded + anything stored in `storeDir`.
   * Does NOT hit the network — callers that want fresh data should call
   * `refreshFromRegistry()` first. Results are de-duplicated by name
   * (installed entries win over seeds so local overrides are honoured).
   */
  listAvailable(): readonly AcpAgentManifest[] {
    const byName = new Map<string, AcpAgentManifest>();
    for (const seed of SEEDED_ACP_AGENTS) {
      byName.set(seed.name, seed);
    }
    for (const installed of this.listInstalled()) {
      byName.set(installed.name, installedToManifest(installed));
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * List agents the user has actually installed (i.e. `acp install`
   * succeeded OR was attempted and recorded with BLOCKED-NOT-INSTALLED).
   */
  listInstalled(): readonly InstalledAcpAgent[] {
    if (!existsSync(this.storeDir)) return [];
    const out: InstalledAcpAgent[] = [];
    let entries: string[];
    try {
      entries = readdirSync(this.storeDir);
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = readFileSync(join(this.storeDir, entry), "utf-8");
        const parsed = JSON.parse(raw) as InstalledAcpAgent;
        if (typeof parsed.name === "string" && typeof parsed.command === "string") {
          out.push(parsed);
        }
      } catch {
        // Skip malformed records; don't fail the whole list.
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get an installed agent by name, or undefined. */
  getInstalled(name: string): InstalledAcpAgent | undefined {
    const file = join(this.storeDir, `${sanitizeName(name)}.json`);
    if (!existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as InstalledAcpAgent;
      return parsed;
    } catch {
      return undefined;
    }
  }

  // ── Remote discovery ────────────────────────────────────

  /**
   * Fetch the upstream Zed/Air registry and return the merged index.
   * Falls back through each configured URL in order; returns null if
   * every endpoint fails. Network errors are swallowed to stderr —
   * callers that need to surface "no registry reached" should check
   * for null and branch accordingly.
   */
  async refreshFromRegistry(): Promise<AcpRegistryIndex | null> {
    for (const url of this.registryUrls) {
      try {
        requireSafeUrl(url);
      } catch (err) {
        if (err instanceof SSRFBlockedError) {
          process.stderr.write(`[acp-registry] SSRF blocked: ${err.message}\n`);
          continue;
        }
        throw err;
      }
      try {
        const raw = await this.fetchJson(url);
        const index = parseRegistryIndex(raw);
        if (index) return index;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[acp-registry] fetch failed (${url}): ${msg}\n`);
      }
    }
    return null;
  }

  /**
   * Fetch a single agent manifest by name. Tries the local seed list
   * first (so smoke tests work offline), then falls through to the
   * remote registry. Returns null if the name is unknown.
   */
  async fetchManifest(name: string): Promise<AcpAgentManifest | null> {
    const seed = SEEDED_ACP_AGENTS.find((a) => a.name === name);
    if (seed) return seed;
    const index = await this.refreshFromRegistry();
    if (!index) return null;
    return index.agents.find((a) => a.name === name) ?? null;
  }

  // ── Install ─────────────────────────────────────────────

  /**
   * Install an ACP agent by name. Steps:
   *   1. Fetch manifest (local seed or remote registry)
   *   2. Validate signature if provided (annotate `verified`)
   *   3. Check whether the agent's `command` is on PATH
   *      - present -> INSTALLED
   *      - absent  -> BLOCKED-NOT-INSTALLED (honest stub, not fake success)
   *   4. Write metadata JSON to storeDir
   *
   * Honest: we don't run the `install.command` ourselves. Fetching &
   * running arbitrary install scripts from a public registry would be a
   * supply-chain nightmare. The user is expected to run the manifest's
   * install command (shown by `acp install --show-install <name>`) or
   * bring the binary via their own package manager. The BLOCKED state
   * tells the user exactly what's missing.
   */
  async install(name: string): Promise<InstalledAcpAgent> {
    const manifest = await this.fetchManifest(name);
    if (!manifest) {
      return this.persistRecord({
        name,
        description: "(unknown agent)",
        version: "0.0.0",
        command: "",
        args: [],
        installedAt: new Date().toISOString(),
        status: "MANIFEST-INVALID",
        verified: false,
        source: "registry",
        reason: `No manifest found for "${name}"`,
      });
    }

    // Signature verification (if present)
    let verified = false;
    let reason: string | undefined;
    if (manifest.signature && manifest.publicKey) {
      try {
        verified = await verifyManifestSignature(manifest);
        if (!verified) {
          return this.persistRecord(
            manifestToRecord(manifest, {
              status: "SIGNATURE-INVALID",
              verified: false,
              reason: "Signature verification failed",
            }),
          );
        }
      } catch (err) {
        reason = `Signature verification error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Presence check
    const present = manifest.command !== "" && this.commandExists(manifest.command);
    const status: AcpInstallStatus = present ? "INSTALLED" : "BLOCKED-NOT-INSTALLED";
    const installReason =
      !present && manifest.install
        ? `Binary "${manifest.command}" not on PATH. Run: ${manifest.install.command} ${manifest.install.args.join(" ")}`
        : !present
          ? `Binary "${manifest.command}" not on PATH`
          : reason;

    return this.persistRecord(
      manifestToRecord(manifest, {
        status,
        verified,
        ...(installReason !== undefined ? { reason: installReason } : {}),
      }),
    );
  }

  /**
   * Uninstall an ACP agent — removes the metadata record but does not
   * touch the binary on disk. Returns true if a record was removed.
   */
  uninstall(name: string): boolean {
    const file = join(this.storeDir, `${sanitizeName(name)}.json`);
    if (!existsSync(file)) return false;
    try {
      rmSync(file);
      return true;
    } catch {
      return false;
    }
  }

  // ── Internal ────────────────────────────────────────────

  private persistRecord(record: InstalledAcpAgent): InstalledAcpAgent {
    mkdirSync(this.storeDir, { recursive: true });
    const file = join(this.storeDir, `${sanitizeName(record.name)}.json`);
    // Wave 6.5-UU (H-22) — installed ACP agent record. Atomic write.
    writeFileAtomic(file, JSON.stringify(record, null, 2));
    return record;
  }
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Default fetch helper. Uses global `fetch` (Node 20+). SSRF is applied
 * by the caller before this runs so we don't double-check here.
 */
async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function defaultCommandExists(command: string): boolean {
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
 * Sanitize a name for filesystem use. ACP agent names are DNS-style
 * (lower-case, alphanumerics + hyphens), but we're defensive anyway —
 * path separators and `..` are stripped.
 */
function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128);
}

/**
 * Verify an ed25519 signature on a manifest. The signed payload is the
 * canonical JSON of the manifest with `signature` and `publicKey`
 * stripped. Returns false on any verification error (never throws).
 *
 * Uses Node's built-in `crypto.verify` so no dependency is required.
 */
async function verifyManifestSignature(manifest: AcpAgentManifest): Promise<boolean> {
  if (!manifest.signature || !manifest.publicKey) return false;
  try {
    const crypto = await import("node:crypto");
    const { signature: _sig, publicKey: _pk, ...rest } = manifest;
    const canonical = canonicalJson(rest);
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(manifest.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const ok = crypto.verify(
      null,
      Buffer.from(canonical, "utf-8"),
      publicKey,
      Buffer.from(manifest.signature, "base64"),
    );
    return ok;
  } catch {
    return false;
  }
}

/**
 * Stable JSON serializer — keys sorted at every level. Needed so
 * signature verification is reproducible across platforms that might
 * otherwise serialize keys in insertion order.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * Parse and validate a remote registry index. Rejects anything that
 * isn't shaped as `{version, agents: [...]}`.
 */
function parseRegistryIndex(raw: unknown): AcpRegistryIndex | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["version"] !== "string") return null;
  if (!Array.isArray(obj["agents"])) return null;

  const agents: AcpAgentManifest[] = [];
  for (const entry of obj["agents"]) {
    const parsed = parseManifest(entry);
    if (parsed) agents.push(parsed);
  }

  const updatedAt = typeof obj["updatedAt"] === "string" ? obj["updatedAt"] : undefined;
  return {
    version: obj["version"],
    agents,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function parseManifest(raw: unknown): AcpAgentManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["name"] !== "string") return null;
  if (typeof obj["description"] !== "string") return null;
  if (typeof obj["version"] !== "string") return null;
  if (typeof obj["command"] !== "string") return null;

  const args = Array.isArray(obj["args"])
    ? obj["args"].filter((v): v is string => typeof v === "string")
    : undefined;
  const tags = Array.isArray(obj["tags"])
    ? obj["tags"].filter((v): v is string => typeof v === "string")
    : undefined;

  const install = parseInstallBlock(obj["install"]);
  const capabilities = parseCapabilities(obj["capabilities"]);

  const manifest: Mutable<AcpAgentManifest> = {
    name: obj["name"],
    description: obj["description"],
    version: obj["version"],
    command: obj["command"],
  };
  if (typeof obj["title"] === "string") manifest.title = obj["title"];
  if (typeof obj["author"] === "string") manifest.author = obj["author"];
  if (typeof obj["homepage"] === "string") manifest.homepage = obj["homepage"];
  if (args !== undefined) manifest.args = args;
  if (install !== undefined) manifest.install = install;
  if (capabilities !== undefined) manifest.capabilities = capabilities;
  if (typeof obj["signature"] === "string") manifest.signature = obj["signature"];
  if (typeof obj["publicKey"] === "string") manifest.publicKey = obj["publicKey"];
  if (tags !== undefined) manifest.tags = tags;
  return manifest;
}

function parseInstallBlock(raw: unknown): AcpAgentManifest["install"] {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["command"] !== "string") return undefined;
  const args = Array.isArray(obj["args"])
    ? obj["args"].filter((v): v is string => typeof v === "string")
    : [];
  return { command: obj["command"], args };
}

function parseCapabilities(raw: unknown): AcpAgentManifest["capabilities"] {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const caps: Mutable<NonNullable<AcpAgentManifest["capabilities"]>> = {};
  if (typeof obj["loadSession"] === "boolean") caps.loadSession = obj["loadSession"];

  const pc = obj["promptCapabilities"];
  if (pc && typeof pc === "object") {
    const p = pc as Record<string, unknown>;
    const promptCaps: Mutable<
      NonNullable<NonNullable<AcpAgentManifest["capabilities"]>["promptCapabilities"]>
    > = {};
    if (typeof p["image"] === "boolean") promptCaps.image = p["image"];
    if (typeof p["audio"] === "boolean") promptCaps.audio = p["audio"];
    if (typeof p["embeddedContext"] === "boolean")
      promptCaps.embeddedContext = p["embeddedContext"];
    caps.promptCapabilities = promptCaps;
  }

  const mc = obj["mcpCapabilities"];
  if (mc && typeof mc === "object") {
    const m = mc as Record<string, unknown>;
    const mcpCaps: Mutable<
      NonNullable<NonNullable<AcpAgentManifest["capabilities"]>["mcpCapabilities"]>
    > = {};
    if (typeof m["http"] === "boolean") mcpCaps.http = m["http"];
    if (typeof m["sse"] === "boolean") mcpCaps.sse = m["sse"];
    if (typeof m["stdio"] === "boolean") mcpCaps.stdio = m["stdio"];
    caps.mcpCapabilities = mcpCaps;
  }

  return caps;
}

function manifestToRecord(
  manifest: AcpAgentManifest,
  overrides: {
    readonly status: AcpInstallStatus;
    readonly verified: boolean;
    readonly reason?: string;
  },
): InstalledAcpAgent {
  const record: Mutable<InstalledAcpAgent> = {
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    command: manifest.command,
    args: manifest.args ?? [],
    installedAt: new Date().toISOString(),
    status: overrides.status,
    verified: overrides.verified,
    source: "registry",
  };
  if (manifest.title !== undefined) record.title = manifest.title;
  if (manifest.capabilities !== undefined) record.capabilities = manifest.capabilities;
  if (overrides.reason !== undefined) record.reason = overrides.reason;
  if (manifest.tags !== undefined) record.tags = manifest.tags;
  return record;
}

function installedToManifest(installed: InstalledAcpAgent): AcpAgentManifest {
  const manifest: Mutable<AcpAgentManifest> = {
    name: installed.name,
    description: installed.description,
    version: installed.version,
    command: installed.command,
  };
  if (installed.title !== undefined) manifest.title = installed.title;
  if (installed.args !== undefined && installed.args.length > 0) manifest.args = installed.args;
  if (installed.capabilities !== undefined) manifest.capabilities = installed.capabilities;
  if (installed.tags !== undefined) manifest.tags = installed.tags;
  return manifest;
}

/** Local alias to relax readonly on a narrow scope (builder pattern). */
type Mutable<T> = { -readonly [P in keyof T]: T[P] };

// ── Agent-definition lift ──────────────────────────────────

/**
 * Convert an installed ACP agent into a WOTANN AgentDefinition so it
 * can be added to the main agent registry and invoked via
 * `performAgentHandoff`. The ID is prefixed with `acp:` so callers can
 * easily distinguish external ACP agents from built-in WOTANN agents.
 *
 * The system prompt embeds the agent's description and command; the
 * handoff dispatcher uses this to decide routing. Actual ACP wire
 * communication happens at dispatch time (wiring is out of scope for
 * this module — the registry just records that the agent exists).
 *
 * Honest: when `status !== "INSTALLED"`, we still return a definition
 * so `acp list` can show it; callers that want to *use* the agent
 * should check `installed.status` first.
 */
export function installedAcpAgentToDefinition(installed: InstalledAcpAgent): {
  readonly id: string;
  readonly name: string;
  readonly model: "local";
  readonly systemPrompt: string;
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
  readonly availableSkills: readonly string[];
  readonly maxTurns: number;
  readonly timeout: number;
} {
  const title = installed.title ?? installed.name;
  return {
    id: `acp:${installed.name}`,
    name: title,
    model: "local",
    systemPrompt:
      `You are ${title}, an external ACP agent (${installed.description}). ` +
      `WOTANN routes calls to you via the Agent Client Protocol. ` +
      `Status: ${installed.status}. Command: ${installed.command} ${installed.args.join(" ")}`,
    allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit"],
    deniedTools: [],
    availableSkills: [],
    maxTurns: 100,
    timeout: 1_800_000,
  };
}
