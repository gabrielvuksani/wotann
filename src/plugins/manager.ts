/**
 * npm-based plugin installer.
 * Installs plugin packages into .wotann/plugins for local discovery/loading.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-io.js";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { HookHandler } from "../hooks/engine.js";

export interface InstalledPlugin {
  readonly name: string;
  readonly version: string;
  readonly path: string;
  readonly source: string;
}

export interface LoadedPluginModule extends InstalledPlugin {
  readonly hooks: readonly HookHandler[];
  readonly panels: readonly string[];
}

interface PluginLockfile {
  readonly installed: readonly InstalledPlugin[];
}

interface PluginPackageJson {
  readonly main?: string;
  readonly wotann?: {
    readonly entry?: string;
    readonly panels?: readonly string[];
  };
}

export class PluginManager {
  private readonly pluginsDir: string;
  private readonly lockfilePath: string;

  constructor(pluginsDir: string) {
    this.pluginsDir = pluginsDir;
    this.lockfilePath = join(pluginsDir, "registry.json");
  }

  install(spec: string): InstalledPlugin {
    mkdirSync(this.pluginsDir, { recursive: true });

    const installed = existsSync(spec) ? this.installFromPath(spec) : this.installFromNpm(spec);

    this.recordInstall(installed);
    return installed;
  }

  listInstalled(): readonly InstalledPlugin[] {
    if (!existsSync(this.lockfilePath)) return [];

    try {
      const lockfile = JSON.parse(readFileSync(this.lockfilePath, "utf-8")) as PluginLockfile;
      return lockfile.installed ?? [];
    } catch {
      return [];
    }
  }

  async loadInstalled(): Promise<readonly LoadedPluginModule[]> {
    const loaded: LoadedPluginModule[] = [];

    for (const plugin of this.listInstalled()) {
      const module = await loadPluginModule(plugin);
      if (module) {
        loaded.push(module);
      }
    }

    return loaded;
  }

  private installFromPath(source: string): InstalledPlugin {
    const resolved = resolve(source);
    const packageDir = resolved;
    const metadata = readPackageMetadata(packageDir);
    const destination = uniqueDestination(join(this.pluginsDir, sanitizeName(metadata.name)));

    cpSync(packageDir, destination, { recursive: true });
    return {
      name: metadata.name,
      version: metadata.version,
      path: destination,
      source: resolved,
    };
  }

  private installFromNpm(spec: string): InstalledPlugin {
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-plugin-"));

    try {
      const tarball = execFileSync("npm", ["pack", spec], {
        cwd: tempDir,
        encoding: "utf-8",
      })
        .trim()
        .split("\n")
        .pop();

      if (!tarball) {
        throw new Error(`npm pack returned no tarball for ${spec}`);
      }

      execFileSync("tar", ["-xzf", tarball, "-C", tempDir], { cwd: tempDir, stdio: "ignore" });
      const packageDir = join(tempDir, "package");
      const metadata = readPackageMetadata(packageDir);
      const destination = uniqueDestination(join(this.pluginsDir, sanitizeName(metadata.name)));

      cpSync(packageDir, destination, { recursive: true });
      return {
        name: metadata.name,
        version: metadata.version,
        path: destination,
        source: spec,
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private recordInstall(plugin: InstalledPlugin): void {
    const current = this.listInstalled().filter((entry) => entry.name !== plugin.name);
    const next: PluginLockfile = {
      installed: [...current, plugin],
    };
    // Wave 6.5-UU (H-22) — plugin lockfile is the source of truth for
    // installed plugins. Atomic write so a crash mid-save can't lose
    // the install record (forcing re-install).
    writeFileAtomic(this.lockfilePath, JSON.stringify(next, null, 2));
  }
}

function readPackageMetadata(packageDir: string): { name: string; version: string } {
  const packageJsonPath = join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {
      name: basename(packageDir),
      version: "0.0.0",
    };
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    name?: string;
    version?: string;
  };

  return {
    name: packageJson.name ?? basename(packageDir),
    version: packageJson.version ?? "0.0.0",
  };
}

function sanitizeName(name: string): string {
  return name.replace(/^@/, "").replace(/\//g, "-");
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

async function loadPluginModule(plugin: InstalledPlugin): Promise<LoadedPluginModule | null> {
  const packageJsonPath = join(plugin.path, "package.json");
  if (!existsSync(packageJsonPath)) return null;

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PluginPackageJson;
  const entry = packageJson.wotann?.entry ?? packageJson.main ?? "dist/index.js";
  const entryPath = join(plugin.path, entry);
  if (!existsSync(entryPath)) return null;

  try {
    const imported = (await import(pathToFileURL(entryPath).href)) as {
      wotannPlugin?: { hooks?: readonly HookHandler[]; panels?: readonly string[] };
      default?: { hooks?: readonly HookHandler[]; panels?: readonly string[] };
    };
    const runtime = imported.wotannPlugin ?? imported.default ?? {};

    return {
      ...plugin,
      hooks: runtime.hooks ?? [],
      panels: runtime.panels ?? packageJson.wotann?.panels ?? [],
    };
  } catch {
    return null;
  }
}
