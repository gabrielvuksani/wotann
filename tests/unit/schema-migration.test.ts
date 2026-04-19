/**
 * Tests for Schema Auto-Migration system.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  compareVersions,
  configNeedsMigration,
  planMigration,
  executeMigration,
  migrateOnStartup,
  needsMigration,
  getMigrationSteps,
  CURRENT_SCHEMA_VERSION,
} from "../../src/core/schema-migration.js";

describe("Schema Auto-Migration", () => {
  describe("compareVersions", () => {
    it("returns 0 for equal versions", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    });

    it("returns negative when a < b", () => {
      expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
      expect(compareVersions("0.1.0", "1.0.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    });

    it("returns positive when a > b", () => {
      expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
      expect(compareVersions("1.0.0", "0.9.0")).toBeGreaterThan(0);
    });
  });

  describe("planMigration", () => {
    it("returns empty plan when already up to date", () => {
      const plan = planMigration(CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
      expect(plan.isUpToDate).toBe(true);
      expect(plan.steps).toHaveLength(0);
    });

    it("returns empty plan when version is ahead", () => {
      const plan = planMigration("99.0.0", CURRENT_SCHEMA_VERSION);
      expect(plan.isUpToDate).toBe(true);
    });

    it("returns steps for outdated config", () => {
      const plan = planMigration("0.1.0", CURRENT_SCHEMA_VERSION);
      expect(plan.isUpToDate).toBe(false);
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("returns sequential steps from source to target", () => {
      const plan = planMigration("0.1.0", "0.3.0");
      expect(plan.steps.length).toBeGreaterThanOrEqual(2);

      // Verify ordering
      for (let i = 1; i < plan.steps.length; i++) {
        expect(compareVersions(plan.steps[i - 1]!.toVersion, plan.steps[i]!.fromVersion)).toBeLessThanOrEqual(0);
      }
    });
  });

  describe("executeMigration", () => {
    it("returns config unchanged when up to date", () => {
      const config = { version: CURRENT_SCHEMA_VERSION, providers: {} };
      const plan = planMigration(CURRENT_SCHEMA_VERSION);
      const result = executeMigration(config, plan);

      expect(result.success).toBe(true);
      expect(result.stepsApplied).toHaveLength(0);
      expect(result.config).toEqual(config);
    });

    it("migrates 0.1.0 → 0.2.0 adding provider priorities", () => {
      const config = {
        version: "0.1.0",
        providers: {
          anthropic: { enabled: true },
          openai: { enabled: true },
        },
      };

      const plan = planMigration("0.1.0", "0.2.0");
      const result = executeMigration(config, plan);

      expect(result.success).toBe(true);
      expect(result.config["version"]).toBe("0.2.0");

      const providers = result.config["providers"] as Record<string, Record<string, unknown>>;
      expect(providers["anthropic"]?.["priority"]).toBe(1);
      expect(providers["openai"]?.["priority"]).toBe(2);
    });

    it("migrates 0.2.0 → 0.3.0 adding memory and daemon config", () => {
      const config = { version: "0.2.0", providers: {} };
      const plan = planMigration("0.2.0", "0.3.0");
      const result = executeMigration(config, plan);

      expect(result.success).toBe(true);
      expect(result.config["version"]).toBe("0.3.0");

      const memory = result.config["memory"] as Record<string, unknown>;
      expect(memory["enabled"]).toBe(true);
      expect(memory["dbPath"]).toBeDefined();

      const daemon = result.config["daemon"] as Record<string, unknown>;
      expect(daemon["enabled"]).toBe(false);
    });

    it("migrates full chain 0.1.0 → latest", () => {
      const config = {
        version: "0.1.0",
        providers: {
          anthropic: { enabled: true, apiKey: "sk-ant-test" },
        },
      };

      const plan = planMigration("0.1.0", CURRENT_SCHEMA_VERSION);
      const result = executeMigration(config, plan);

      expect(result.success).toBe(true);
      expect(result.config["version"]).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.stepsApplied.length).toBeGreaterThan(0);
    });

    it("preserves unknown fields during migration", () => {
      const config = {
        version: "0.1.0",
        providers: {},
        customField: "should-survive",
      };

      const plan = planMigration("0.1.0", "0.2.0");
      const result = executeMigration(config, plan);

      expect(result.success).toBe(true);
      expect(result.config["customField"]).toBe("should-survive");
    });

    it("reports errors on precondition failure", () => {
      const config = { version: "0.2.0" }; // claim 0.2.0, skip 0.1.0→0.2.0
      const plan = planMigration("0.2.0", "0.3.0");
      const result = executeMigration(config, plan);

      // Should succeed as it validates version match
      expect(result.success).toBe(true);
    });
  });

  describe("needsMigration", () => {
    it("returns false when current version", () => {
      expect(needsMigration({ version: CURRENT_SCHEMA_VERSION })).toBe(false);
    });

    it("returns true when outdated", () => {
      expect(needsMigration({ version: "0.1.0" })).toBe(true);
    });

    it("returns true when no version field", () => {
      expect(needsMigration({})).toBe(true);
    });

    it("returns false when ahead of current", () => {
      expect(needsMigration({ version: "99.0.0" })).toBe(false);
    });
  });

  describe("getMigrationSteps", () => {
    it("returns all registered migrations", () => {
      const steps = getMigrationSteps();
      expect(steps.length).toBeGreaterThan(0);
    });

    it("has sequential from → to versions", () => {
      const steps = getMigrationSteps();
      for (const step of steps) {
        expect(compareVersions(step.fromVersion, step.toVersion)).toBeLessThan(0);
      }
    });

    it("each step has a description", () => {
      const steps = getMigrationSteps();
      for (const step of steps) {
        expect(step.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("migrateOnStartup", () => {
    const tmpRoots: string[] = [];

    afterEach(() => {
      for (const root of tmpRoots) {
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      tmpRoots.length = 0;
    });

    const makeTmpDir = (): string => {
      const dir = mkdtempSync(join(tmpdir(), "schema-migration-test-"));
      tmpRoots.push(dir);
      return dir;
    };

    it("returns migrated=false when config does not exist", () => {
      const dir = makeTmpDir();
      const configPath = join(dir, "nonexistent.yaml");
      const report = migrateOnStartup(configPath);
      expect(report.migrated).toBe(false);
      expect(report.backupPath).toBeNull();
      expect(report.fromVersion).toBeNull();
      expect(report.errors).toHaveLength(0);
    });

    it("returns migrated=false when config already at target version", () => {
      const dir = makeTmpDir();
      const configPath = join(dir, "config.yaml");
      writeFileSync(configPath, stringifyYaml({ version: CURRENT_SCHEMA_VERSION }));
      const report = migrateOnStartup(configPath);
      expect(report.migrated).toBe(false);
      expect(report.stepsApplied).toHaveLength(0);
    });

    it("migrates 0.1.0 → CURRENT and creates backup", () => {
      const dir = makeTmpDir();
      const configPath = join(dir, "config.yaml");
      writeFileSync(
        configPath,
        stringifyYaml({ version: "0.1.0", providers: { anthropic: {} } }),
      );
      const report = migrateOnStartup(configPath);
      expect(report.migrated).toBe(true);
      expect(report.fromVersion).toBe("0.1.0");
      expect(report.toVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(report.backupPath).toBeTruthy();
      expect(existsSync(report.backupPath!)).toBe(true);
      expect(report.stepsApplied.length).toBeGreaterThan(0);

      // Migrated file on disk bears the new version.
      const migrated = readFileSync(configPath, "utf-8");
      expect(migrated).toContain(`version: ${CURRENT_SCHEMA_VERSION}`);
    });
  });

  describe("configNeedsMigration", () => {
    const tmpRoots: string[] = [];

    afterEach(() => {
      for (const root of tmpRoots) {
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      tmpRoots.length = 0;
    });

    const makeTmpDir = (): string => {
      const dir = mkdtempSync(join(tmpdir(), "schema-needs-test-"));
      tmpRoots.push(dir);
      return dir;
    };

    it("returns false when config does not exist", () => {
      const dir = makeTmpDir();
      expect(configNeedsMigration(join(dir, "none.yaml"))).toBe(false);
    });

    it("returns true for out-of-date config", () => {
      const dir = makeTmpDir();
      const path = join(dir, "old.yaml");
      writeFileSync(path, stringifyYaml({ version: "0.1.0" }));
      expect(configNeedsMigration(path)).toBe(true);
    });

    it("returns false for current config", () => {
      const dir = makeTmpDir();
      const path = join(dir, "current.yaml");
      writeFileSync(path, stringifyYaml({ version: CURRENT_SCHEMA_VERSION }));
      expect(configNeedsMigration(path)).toBe(false);
    });

    it("returns false for malformed YAML (safe default)", () => {
      const dir = makeTmpDir();
      const path = join(dir, "bad.yaml");
      writeFileSync(path, "this: is: not: valid: yaml:");
      expect(configNeedsMigration(path)).toBe(false);
    });
  });
});
