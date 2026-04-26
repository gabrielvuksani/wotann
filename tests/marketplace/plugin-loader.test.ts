/**
 * Tests for `src/marketplace/plugin-loader.ts` — V9 T14.1 plugin
 * discovery + manifest validation.
 *
 * The loader takes a `pluginsRoot` directory, scans `<name>/` subdirs
 * for `plugin.json` (or `manifest.json`), and returns:
 *   - `ok:true` + plugins[] + skipped[] when the root is reachable
 *     (per-plugin failures populate `skipped[]`, never abort).
 *   - `ok:false` + error when the root itself is unreadable.
 *
 * Why these tests:
 *   - Empty / missing root — must return ok:true with empty arrays
 *     (otherwise a fresh user with no plugins gets an error).
 *   - Unreadable root — must surface `ok:false` so the runtime can
 *     report a real configuration problem.
 *   - Valid plugin — round-trips a complete manifest into the
 *     `LoadedPlugin` shape with bins resolved to absolute paths.
 *   - Malformed manifest — added to `skipped[]` with a `reason`,
 *     does NOT throw, and does not block other plugins from loading.
 *
 * Constraints:
 *   - mkdtempSync for fixture roots; rmSync in afterEach.
 *   - We use the *injectable* fs surface (`PluginLoaderFs`) for the
 *     unreadable-root and malformed-manifest cases so we don't have
 *     to fight POSIX permissions on CI (which differs across OSes).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPlugins,
  type PluginLoaderFs,
} from "../../src/marketplace/plugin-loader.js";

describe("loadPlugins — root handling", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "wotann-plugins-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns ok:true with empty plugins/skipped when pluginsRoot does not exist", () => {
    const ghost = join(tempRoot, "does-not-exist");
    const result = loadPlugins({ pluginsRoot: ghost });

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow for TS
    expect(result.plugins).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("returns ok:true with empty plugins/skipped when pluginsRoot exists but has no children", () => {
    const result = loadPlugins({ pluginsRoot: tempRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugins).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("returns ok:false with an error when pluginsRoot is unreadable (readdir throws)", () => {
    // Use the injectable fs surface so we don't depend on POSIX
    // permissions, which vary on CI / Windows.
    const fs: PluginLoaderFs = {
      existsSync: () => true,
      readFileSync: () => "",
      readdirSync: () => {
        throw new Error("EACCES: permission denied, scandir");
      },
      statSync: () => ({ isDirectory: () => false, mode: 0 }),
    };

    const result = loadPlugins({ pluginsRoot: "/forbidden", fs });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("failed to read pluginsRoot");
    expect(result.error).toContain("EACCES");
  });
});

describe("loadPlugins — valid plugin directory", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "wotann-plugins-valid-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("parses a plugin.json with bin entries into LoadedPlugin records", () => {
    const pluginDir = join(tempRoot, "linter-pro");
    mkdirSync(pluginDir, { recursive: true });

    // Create the bin executable (with exec bit) so validateBin accepts it.
    const binPath = join(pluginDir, "bin", "lint.sh");
    mkdirSync(join(pluginDir, "bin"), { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env bash\necho lint\n");
    chmodSync(binPath, 0o755);

    writeFileSync(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "linter-pro",
        bins: [
          {
            name: "lint",
            path: "bin/lint.sh",
            description: "Run the linter",
            argv: ["--strict"],
            env: { LINT_LEVEL: "warn" },
            timeout_ms: 30000,
          },
        ],
      }),
    );

    const result = loadPlugins({ pluginsRoot: tempRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugins).toHaveLength(1);
    const [plugin] = result.plugins;
    expect(plugin.name).toBe("linter-pro");
    expect(plugin.bins).toHaveLength(1);
    const [bin] = plugin.bins;
    expect(bin.name).toBe("lint");
    expect(bin.executable).toBe(binPath);
    expect(bin.argv).toEqual(["--strict"]);
    expect(bin.env).toEqual({ LINT_LEVEL: "warn" });
    expect(bin.timeoutMs).toBe(30000);
    expect(bin.description).toBe("Run the linter");
  });

  it("qualifies bin names with the plugin name when qualifyNames:true", () => {
    const pluginDir = join(tempRoot, "tools");
    mkdirSync(pluginDir, { recursive: true });
    const binPath = join(pluginDir, "bin", "fmt");
    mkdirSync(join(pluginDir, "bin"), { recursive: true });
    writeFileSync(binPath, "#!/bin/sh\n");
    chmodSync(binPath, 0o755);
    writeFileSync(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "tools",
        bins: [{ name: "fmt", path: "bin/fmt" }],
      }),
    );

    const result = loadPlugins({ pluginsRoot: tempRoot, qualifyNames: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugins[0]?.bins[0]?.name).toBe("tools.fmt");
  });
});

describe("loadPlugins — malformed manifests are skipped, not fatal", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "wotann-plugins-bad-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("adds a plugin with malformed JSON manifest to skipped[] (no throw)", () => {
    const pluginDir = join(tempRoot, "broken");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "plugin.json"), "not json{{{");

    const result = loadPlugins({ pluginsRoot: tempRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugins).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain("invalid manifest");
    expect(result.skipped[0]?.reason).toContain("JSON parse failed");
  });

  it("skips a plugin with no manifest file at all (no throw)", () => {
    const pluginDir = join(tempRoot, "empty");
    mkdirSync(pluginDir, { recursive: true });

    const result = loadPlugins({ pluginsRoot: tempRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugins).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain("no manifest");
  });

  it("loads a valid plugin alongside a malformed one (failures don't block)", () => {
    // good plugin
    const goodDir = join(tempRoot, "good");
    mkdirSync(join(goodDir, "bin"), { recursive: true });
    const goodBin = join(goodDir, "bin", "run");
    writeFileSync(goodBin, "#!/bin/sh\n");
    chmodSync(goodBin, 0o755);
    writeFileSync(
      join(goodDir, "plugin.json"),
      JSON.stringify({ name: "good", bins: [{ name: "run", path: "bin/run" }] }),
    );

    // broken plugin
    const badDir = join(tempRoot, "broken");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "plugin.json"), "{{{");

    const result = loadPlugins({ pluginsRoot: tempRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugins.map((p) => p.name)).toEqual(["good"]);
    expect(result.skipped.some((s) => s.dir.endsWith("broken"))).toBe(true);
  });

  it("ignores hidden meta directories silently (.git, .DS_Store)", () => {
    mkdirSync(join(tempRoot, ".git"), { recursive: true });
    mkdirSync(join(tempRoot, ".DS_Store"), { recursive: true });

    const result = loadPlugins({ pluginsRoot: tempRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plugins).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
