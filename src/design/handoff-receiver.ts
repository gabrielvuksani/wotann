/**
 * Claude Design handoff-bundle receiver.
 *
 * Reverse-engineered from the bundle Anthropic Labs shipped on 2026-04-17:
 *
 *   bundle.zip
 *     manifest.json           (required — name, version, bundle_version)
 *     design-system.json      (required — W3C Design Tokens)
 *     tokens.json             (optional alias of design-system.json)
 *     components.json         (optional — array of component descriptors)
 *     figma.json              (optional — raw Figma JSON export)
 *     code-scaffold/**        (optional — React/Vue/HTML starter files)
 *     assets/**               (optional — images, svgs, fonts)
 *
 * This module converts the ZIP into a typed `HandoffBundle` without any
 * external ZIP library. Failures are loud: a malformed manifest, unreadable
 * tokens file, or missing components.json raises a descriptive `Error`
 * rather than silently returning empty data.
 */
import { readZip, type ZipArchive, type ZipEntry } from "./zip-reader.js";
import { parseDesignTokens, type DesignTokens } from "./design-tokens-parser.js";
import { normalizeComponents, type ImportedComponent } from "./component-importer.js";

export interface HandoffManifest {
  readonly name: string;
  readonly version: string;
  readonly author?: string;
  readonly exportedFrom?: string;
  readonly bundleVersion: string;
  readonly createdAt?: string;
}

export interface HandoffAsset {
  readonly path: string;
  readonly size: number;
  readonly data: Buffer;
}

export interface CodeScaffoldFile {
  readonly path: string;
  readonly contents: string;
}

export interface HandoffBundle {
  readonly manifest: HandoffManifest;
  readonly designSystem: DesignTokens;
  readonly rawDesignSystem: unknown;
  readonly tokens: DesignTokens;
  readonly components: readonly ImportedComponent[];
  readonly figma?: unknown;
  readonly codeScaffold?: readonly CodeScaffoldFile[];
  readonly assets: readonly HandoffAsset[];
}

// Version of the bundle format we recognize. Mismatches emit a warning but
// are not fatal — Claude Design is still iterating the format.
export const SUPPORTED_BUNDLE_VERSIONS: readonly string[] = ["1", "1.0", "1.0.0"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(archive: ZipArchive, name: string): string | undefined {
  const entry = archive.entry(name);
  if (!entry || entry.isDirectory) return undefined;
  return entry.data().toString("utf-8");
}

function readJson(archive: ZipArchive, name: string): unknown {
  const text = readText(archive, name);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${name} is not valid JSON: ${msg}`);
  }
}

function validateManifest(raw: unknown): HandoffManifest {
  if (!isObject(raw)) {
    throw new Error("manifest.json must be a JSON object");
  }
  const name = raw["name"];
  const version = raw["version"];
  const bundleVersion = raw["bundle_version"] ?? raw["bundleVersion"];

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error('manifest.json is missing required string field "name"');
  }
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error('manifest.json is missing required string field "version"');
  }
  if (typeof bundleVersion !== "string" || bundleVersion.trim().length === 0) {
    throw new Error('manifest.json is missing required string field "bundle_version"');
  }
  const manifest: HandoffManifest = {
    name: name.trim(),
    version: version.trim(),
    bundleVersion: bundleVersion.trim(),
    ...(typeof raw["author"] === "string" ? { author: raw["author"] } : {}),
    ...(typeof raw["exported_from"] === "string"
      ? { exportedFrom: raw["exported_from"] }
      : typeof raw["exportedFrom"] === "string"
        ? { exportedFrom: raw["exportedFrom"] as string }
        : {}),
    ...(typeof raw["created_at"] === "string"
      ? { createdAt: raw["created_at"] }
      : typeof raw["createdAt"] === "string"
        ? { createdAt: raw["createdAt"] as string }
        : {}),
  };
  return manifest;
}

function collectAssets(archive: ZipArchive): readonly HandoffAsset[] {
  const out: HandoffAsset[] = [];
  for (const entry of archive.entries) {
    if (!entry.name.startsWith("assets/") || entry.isDirectory) continue;
    out.push({
      path: entry.name,
      size: entry.size,
      data: entry.data(),
    });
  }
  return out;
}

function collectCodeScaffold(archive: ZipArchive): readonly CodeScaffoldFile[] | undefined {
  const files: CodeScaffoldFile[] = [];
  for (const entry of archive.entries) {
    if (!entry.name.startsWith("code-scaffold/") || entry.isDirectory) continue;
    // Only decode as text; binary scaffolds are not a recognized shape today.
    files.push({
      path: entry.name,
      contents: entry.data().toString("utf-8"),
    });
  }
  return files.length > 0 ? files : undefined;
}

/**
 * Parse a handoff-bundle ZIP into a typed structure.
 *
 * The `strict` option (default true) forces components.json to exist. Set
 * `strict: false` for "design-system only" bundles — but the CLI passes the
 * strict flag when users explicitly asked for component import so malformed
 * bundles fail visibly instead of silently succeeding.
 */
export interface ParseOptions {
  readonly requireComponents?: boolean;
}

export function parseHandoffBundle(zipPath: string, options: ParseOptions = {}): HandoffBundle {
  const archive = readZip(zipPath);

  const rawManifest = readJson(archive, "manifest.json");
  if (rawManifest === undefined) {
    throw new Error("handoff bundle is missing required manifest.json");
  }
  const manifest = validateManifest(rawManifest);

  const rawDesignSystem = readJson(archive, "design-system.json");
  if (rawDesignSystem === undefined) {
    throw new Error("handoff bundle is missing required design-system.json");
  }
  const designSystem = parseDesignTokens(rawDesignSystem);

  const rawTokens = readJson(archive, "tokens.json");
  const tokens = rawTokens === undefined ? designSystem : parseDesignTokens(rawTokens);

  const rawComponents = readJson(archive, "components.json");
  if (options.requireComponents === true && rawComponents === undefined) {
    throw new Error("handoff bundle is missing components.json (required by --require-components)");
  }
  const components = rawComponents === undefined ? [] : normalizeComponents(rawComponents);

  const figma = readJson(archive, "figma.json");
  const codeScaffold = collectCodeScaffold(archive);
  const assets = collectAssets(archive);

  const bundle: HandoffBundle = {
    manifest,
    designSystem,
    rawDesignSystem,
    tokens,
    components,
    ...(figma === undefined ? {} : { figma }),
    ...(codeScaffold === undefined ? {} : { codeScaffold }),
    assets,
  };
  return bundle;
}

export function isSupportedBundleVersion(version: string): boolean {
  return SUPPORTED_BUNDLE_VERSIONS.includes(version.trim());
}

// Re-export types for callers that want a single import surface.
export type { ZipEntry };
