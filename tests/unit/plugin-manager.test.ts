import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginManager } from "../../src/plugins/manager.js";

describe("PluginManager", () => {
  it("installs a local npm-style plugin directory", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "wotann-plugin-source-"));
    const pluginsDir = mkdtempSync(join(tmpdir(), "wotann-plugin-target-"));

    try {
      mkdirSync(join(sourceDir, "dist"), { recursive: true });
      writeFileSync(join(sourceDir, "package.json"), JSON.stringify({
        name: "@wotann/example-plugin",
        version: "1.2.3",
      }, null, 2));
      writeFileSync(join(sourceDir, "dist", "index.js"), "export const plugin = true;\n");

      const manager = new PluginManager(pluginsDir);
      const installed = manager.install(sourceDir);

      expect(installed.name).toBe("@wotann/example-plugin");
      expect(existsSync(installed.path)).toBe(true);
      expect(manager.listInstalled()).toHaveLength(1);
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(pluginsDir, { recursive: true, force: true });
    }
  });

  it("loads installed plugin hooks and panels", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "wotann-plugin-source-"));
    const pluginsDir = mkdtempSync(join(tmpdir(), "wotann-plugin-target-"));

    try {
      mkdirSync(join(sourceDir, "dist"), { recursive: true });
      writeFileSync(join(sourceDir, "package.json"), JSON.stringify({
        name: "@wotann/runtime-plugin",
        version: "0.1.0",
        main: "dist/index.js",
        wotann: { panels: ["review"] },
      }, null, 2));
      writeFileSync(join(sourceDir, "dist", "index.js"), [
        "export const wotannPlugin = {",
        "  hooks: [{",
        "    name: 'PluginHook',",
        "    event: 'SessionStart',",
        "    profile: 'standard',",
        "    handler() { return { action: 'allow' }; }",
        "  }],",
        "  panels: ['review']",
        "};",
      ].join("\n"));

      const manager = new PluginManager(pluginsDir);
      manager.install(sourceDir);
      const loaded = await manager.loadInstalled();

      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.hooks[0]?.name).toBe("PluginHook");
      expect(loaded[0]?.panels).toContain("review");
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(pluginsDir, { recursive: true, force: true });
    }
  });
});
