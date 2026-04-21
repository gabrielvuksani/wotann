/**
 * ACP registry `agent.json` manifest — publisher side (P1-C10).
 *
 * Zed + JetBrains + Air launched a joint **public ACP registry** in
 * Jan 2026 (https://github.com/agentclientprotocol/registry). Users of
 * those IDEs can pick any listed agent from a dropdown and the host
 * spawns it over stdio — no per-agent configuration needed.
 *
 * This module is the inverse of `src/marketplace/acp-agent-registry.ts`
 * (which CONSUMES the registry to let WOTANN drive external agents):
 * here WOTANN PUBLISHES itself into the registry so Zed/JetBrains/Air
 * users can drive **WOTANN** as their backend.
 *
 * The wire shape matches upstream FORMAT.md strictly so a manifest
 * produced by `buildManifest()` can be dropped into the registry PR
 * without edits. Three distribution flavours are supported: `binary`,
 * `npx`, `uvx` (WOTANN ships via npm, so `npx` is the canonical path).
 *
 * HONEST FAILURE MODES (QB #5):
 *   - malformed package.json -> throws BuildManifestError (not silent defaults)
 *   - missing required fields on package.json -> throws with explicit reason
 *   - the returned manifest is a plain object ready for JSON.stringify;
 *     callers validate via `validateManifest()` before writing/submitting
 *
 * Upstream reference:
 *   https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md
 *   https://github.com/agentclientprotocol/registry/blob/main/claude-acp/agent.json
 */

import { readFileSync } from "node:fs";
import { ACP_PROTOCOL_VERSION } from "./protocol.js";

// Manifest shape (FORMAT.md compliant) ───────────────────────

/**
 * Per-agent `agent.json` shape as declared by the registry FORMAT.md.
 * Only fields marked `required` by upstream are mandatory; everything
 * else is optional and omitted when not provided. Unknown-to-upstream
 * fields (like `capabilities.acp`) ride under the recognised top-level
 * keys — the registry CI ignores keys it doesn't know.
 */
export interface AcpRegistryManifest {
  /** Unique kebab-case identifier. Must match the registry directory name. */
  readonly id: string;
  /** Human-readable display name shown in IDE dropdowns. */
  readonly name: string;
  /** Semver (e.g. "0.4.0"). */
  readonly version: string;
  /** One-line description (<120 chars recommended by FORMAT.md). */
  readonly description: string;
  readonly repository?: string;
  readonly website?: string;
  readonly authors?: readonly string[];
  readonly license?: string;
  readonly icon?: string;
  /**
   * Exactly one distribution method is required by the registry. Multiple
   * may be provided (rare) but the IDE picks the first it can satisfy.
   */
  readonly distribution: AcpRegistryDistribution;
  /**
   * Extended capabilities block — not part of the FORMAT.md required
   * set, but recognised by Zed 0.3+ to populate IDE capability hints
   * (which transports WOTANN honours, which tools it exposes, etc.).
   * Kept under a dedicated `capabilities` key so the upstream linter
   * treats it as a pass-through.
   */
  readonly capabilities?: AcpRegistryCapabilities;
  /** Free-form tags — used for filtering in the registry UI. */
  readonly tags?: readonly string[];
}

/** Distribution block — at least one transport must be declared. */
export interface AcpRegistryDistribution {
  readonly binary?: AcpBinaryDistribution;
  readonly npx?: AcpNpxDistribution;
  readonly uvx?: AcpUvxDistribution;
}

export interface AcpBinaryDistribution {
  /** Map of platform identifier -> download URL. Platforms per FORMAT.md. */
  readonly platforms: Readonly<Record<AcpPlatform, AcpBinaryArtifact>>;
}

export interface AcpBinaryArtifact {
  readonly url: string;
  /** Optional checksum, e.g. "sha256:abc..." */
  readonly checksum?: string;
}

export type AcpPlatform =
  | "darwin-aarch64"
  | "darwin-x86_64"
  | "linux-aarch64"
  | "linux-x86_64"
  | "windows-aarch64"
  | "windows-x86_64";

export interface AcpNpxDistribution {
  /** npm package spec, e.g. "wotann@^0.4.0" */
  readonly package: string;
  /** Optional extra args appended after the package (e.g. ["acp"]). */
  readonly args?: readonly string[];
}

export interface AcpUvxDistribution {
  /** PyPI package spec. */
  readonly package: string;
  readonly args?: readonly string[];
}

/**
 * Extended capabilities block — mirrors ACP v1 `AgentCapabilities` plus
 * WOTANN-specific hints about tools/models/languages so the IDE can
 * surface a rich capability preview before installation.
 */
export interface AcpRegistryCapabilities {
  readonly acp: {
    readonly version: number;
    readonly transports: readonly ("stdio" | "http" | "sse" | "websocket")[];
    readonly loadSession?: boolean;
    readonly promptCapabilities?: {
      readonly image?: boolean;
      readonly audio?: boolean;
      readonly embeddedContext?: boolean;
    };
    readonly mcpCapabilities?: {
      readonly stdio?: boolean;
      readonly http?: boolean;
      readonly sse?: boolean;
    };
  };
  /** True if WOTANN supports being an MCP host (it does). */
  readonly mcp: boolean;
  /** Tools the agent exposes via `tools/list`. */
  readonly tools: readonly string[];
  /** Programming languages with first-class support. */
  readonly languages: readonly string[];
  /** Providers the agent can route to. Empty = provider-agnostic, user-configured. */
  readonly models: readonly string[];
}

// BuildManifest errors ──────────────────────────────────────

/**
 * Thrown when `buildManifest()` can't produce a valid manifest — e.g.
 * package.json is missing, unreadable, or lacks required fields.
 * Surfaced as an explicit error (not a silent default) per QB #5.
 */
export class BuildManifestError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BuildManifestError";
  }
}

// Build from package.json ───────────────────────────────────

export interface BuildManifestOptions {
  /** Absolute or relative path to package.json. Required. */
  readonly packageJsonPath: string;
  /** Override the registry `id`. Defaults to `wotann-acp` (kebab-case of pkg). */
  readonly id?: string;
  /** Override description (package.json `description` is used by default). */
  readonly description?: string;
  /** Providers list — usually passed in from the runtime's ProviderRegistry. */
  readonly models?: readonly string[];
  /** Tool names (Bash, Read, Edit, ...). Callers pass this from the tool registry. */
  readonly tools?: readonly string[];
  /** Languages with first-class support (defaults to `["typescript","javascript"]`). */
  readonly languages?: readonly string[];
  /** Default icon URL to embed. */
  readonly icon?: string;
}

/** Minimal PackageJson shape — we only read fields we need. */
interface PackageJsonShape {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly license?: string;
  readonly author?: string | { readonly name?: string };
  readonly homepage?: string;
  readonly repository?: string | { readonly url?: string };
}

/**
 * Build a registry-ready manifest from the project's `package.json`.
 *
 * The manifest's `distribution` always includes an npx transport (WOTANN
 * ships on npm and every FORMAT.md example uses npx for JS agents).
 * Binary and uvx distributions are intentionally omitted — adding them
 * is a later release step (requires actual built binaries on GitHub
 * Releases).
 *
 * @throws BuildManifestError if package.json is missing or malformed.
 */
export function buildManifest(options: BuildManifestOptions): AcpRegistryManifest {
  const pkg = readPackageJson(options.packageJsonPath);

  if (typeof pkg.name !== "string" || pkg.name.length === 0) {
    throw new BuildManifestError("package.json is missing a `name` field");
  }
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new BuildManifestError("package.json is missing a `version` field");
  }
  const description = options.description ?? pkg.description;
  if (typeof description !== "string" || description.length === 0) {
    throw new BuildManifestError(
      "package.json is missing a `description` field and no override was provided",
    );
  }

  const id = options.id ?? defaultIdFromName(pkg.name);
  const authors = extractAuthors(pkg);
  const repository = extractRepository(pkg);
  const website = typeof pkg.homepage === "string" ? pkg.homepage : undefined;
  const license = typeof pkg.license === "string" ? pkg.license : undefined;

  // Distribution — npx is the canonical JS path per FORMAT.md.
  const distribution: AcpRegistryDistribution = {
    npx: {
      package: `${pkg.name}@^${majorMinor(pkg.version)}`,
      args: ["acp"],
    },
  };

  const capabilities: AcpRegistryCapabilities = {
    acp: {
      version: ACP_PROTOCOL_VERSION,
      transports: ["stdio"],
      loadSession: false,
      promptCapabilities: {
        image: false,
        audio: false,
        embeddedContext: false,
      },
      mcpCapabilities: {
        stdio: true,
        http: false,
        sse: false,
      },
    },
    mcp: true,
    tools: options.tools ?? [],
    languages: options.languages ?? ["typescript", "javascript"],
    models: options.models ?? [],
  };

  // Build the manifest as a plain object so TS structural typing doesn't
  // force us to inline optionals with spreads that look ugly downstream.
  const base: Mutable<AcpRegistryManifest> = {
    id,
    name: displayNameFromPackage(pkg.name),
    version: pkg.version,
    description,
    distribution,
    capabilities,
  };
  if (repository !== undefined) base.repository = repository;
  if (website !== undefined) base.website = website;
  if (authors.length > 0) base.authors = authors;
  if (license !== undefined) base.license = license;
  if (options.icon !== undefined) base.icon = options.icon;
  return base;
}

// Helpers ────────────────────────────────────────────────────

function readPackageJson(path: string): PackageJsonShape {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new BuildManifestError(
      `Unable to read package.json at ${path}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new BuildManifestError(
      `package.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BuildManifestError("package.json top-level value is not an object");
  }
  return parsed as PackageJsonShape;
}

function defaultIdFromName(name: string): string {
  // Registry IDs are lowercase kebab-case, so strip npm scopes like @scope/foo.
  const cleaned = name.startsWith("@") ? (name.split("/")[1] ?? name.slice(1)) : name;
  return cleaned.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

function displayNameFromPackage(name: string): string {
  const cleaned = name.startsWith("@") ? (name.split("/")[1] ?? name.slice(1)) : name;
  // Convert kebab / underscore to Title Case for display.
  return cleaned
    .split(/[-_]+/)
    .map((segment) =>
      segment.length === 0 ? segment : segment[0]!.toUpperCase() + segment.slice(1).toLowerCase(),
    )
    .join(" ");
}

function majorMinor(version: string): string {
  // Handles "0.4.0" / "0.4.0-rc.1" / "v0.4.0" / "1.2.3+build".
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  if (!m) return version;
  return `${m[1]}.${m[2]}.0`;
}

function extractAuthors(pkg: PackageJsonShape): readonly string[] {
  if (typeof pkg.author === "string") return [pkg.author];
  if (pkg.author && typeof pkg.author === "object" && typeof pkg.author.name === "string") {
    return [pkg.author.name];
  }
  return [];
}

function extractRepository(pkg: PackageJsonShape): string | undefined {
  if (typeof pkg.repository === "string") return pkg.repository;
  if (pkg.repository && typeof pkg.repository === "object") {
    // npm stores `"repository": { "type": "git", "url": "..." }`.
    const url = pkg.repository.url;
    if (typeof url === "string") {
      // Strip `git+` prefix and `.git` suffix common in package.json.
      return url.replace(/^git\+/, "").replace(/\.git$/, "");
    }
  }
  return undefined;
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] };
