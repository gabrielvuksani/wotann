/**
 * Schema Auto-Migration System.
 *
 * Version-aware config migration that automatically upgrades user configs
 * when WOTANN is updated. Each migration is a pure function that transforms
 * config from version N to version N+1.
 *
 * DESIGN PRINCIPLES:
 * - Migrations are immutable transforms (old config → new config)
 * - Each migration has a pre-check that validates preconditions
 * - Backup is created before any migration runs
 * - Migrations are idempotent (running twice is safe)
 * - Unknown fields are preserved (forward compatibility)
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// ── Types ────────────────────────────────────────────────

export interface MigrationStep {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly description: string;
  readonly migrate: (config: Record<string, unknown>) => Record<string, unknown>;
  readonly validate: (config: Record<string, unknown>) => boolean;
}

export interface MigrationResult {
  readonly success: boolean;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly stepsApplied: readonly string[];
  readonly backupPath: string | null;
  readonly errors: readonly string[];
  readonly config: Record<string, unknown>;
}

export interface MigrationPlan {
  readonly currentVersion: string;
  readonly targetVersion: string;
  readonly steps: readonly MigrationStep[];
  readonly isUpToDate: boolean;
}

// ── Version Comparison ───────────────────────────────────

function parseVersion(version: string): readonly [number, number, number] {
  const parts = version.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0] as const;
}

export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

// ── Migration Registry ───────────────────────────────────

const MIGRATIONS: readonly MigrationStep[] = [
  {
    fromVersion: "0.1.0",
    toVersion: "0.2.0",
    description: "Add provider priority field and normalize provider config",
    migrate(config) {
      const providers = (config["providers"] ?? {}) as Record<string, Record<string, unknown>>;
      const normalized: Record<string, Record<string, unknown>> = {};
      let priority = 1;

      for (const [name, providerConfig] of Object.entries(providers)) {
        normalized[name] = {
          ...providerConfig,
          priority: providerConfig["priority"] ?? priority,
          enabled: providerConfig["enabled"] ?? true,
        };
        priority++;
      }

      return { ...config, providers: normalized, version: "0.2.0" };
    },
    validate(config) {
      return typeof config["version"] === "string";
    },
  },
  {
    fromVersion: "0.2.0",
    toVersion: "0.3.0",
    description: "Add memory config with SQLite defaults and daemon config",
    migrate(config) {
      const memory = (config["memory"] ?? {}) as Record<string, unknown>;
      const daemon = (config["daemon"] ?? {}) as Record<string, unknown>;

      return {
        ...config,
        memory: {
          enabled: true,
          dbPath: ".wotann/memory.db",
          maxEntries: 10000,
          ...memory,
        },
        daemon: {
          enabled: false,
          tickInterval: 60000,
          ...daemon,
        },
        version: "0.3.0",
      };
    },
    validate(config) {
      return config["version"] === "0.2.0";
    },
  },
  {
    fromVersion: "0.3.0",
    toVersion: "0.4.0",
    description: "Add hooks profile, UI theme, and cost tracking defaults",
    migrate(config) {
      const hooks = (config["hooks"] ?? {}) as Record<string, unknown>;
      const ui = (config["ui"] ?? {}) as Record<string, unknown>;

      return {
        ...config,
        hooks: {
          profile: "standard",
          ...hooks,
        },
        ui: {
          theme: "default",
          panels: ["chat"],
          ...ui,
        },
        costTracking: {
          enabled: true,
          dailyBudgetUsd: 10.0,
          warningThreshold: 0.8,
        },
        version: "0.4.0",
      };
    },
    validate(config) {
      return config["version"] === "0.3.0";
    },
  },
  {
    fromVersion: "0.4.0",
    toVersion: "0.5.0",
    description: "Restructure provider auth: separate apiKey from oauth tokens",
    migrate(config) {
      const providers = (config["providers"] ?? {}) as Record<string, Record<string, unknown>>;
      const updated: Record<string, Record<string, unknown>> = {};

      for (const [name, providerConfig] of Object.entries(providers)) {
        const { apiKey, ...rest } = providerConfig;
        updated[name] = {
          ...rest,
          auth: apiKey
            ? { method: "api-key", token: apiKey }
            : providerConfig["auth"] ?? { method: "local" },
        };
      }

      return { ...config, providers: updated, version: "0.5.0" };
    },
    validate(config) {
      return config["version"] === "0.4.0";
    },
  },
];

// ── Current Version ──────────────────────────────────────

export const CURRENT_SCHEMA_VERSION = "0.5.0";

// ── Migration Engine ─────────────────────────────────────

/**
 * Build a migration plan from current version to target.
 */
export function planMigration(
  currentVersion: string,
  targetVersion: string = CURRENT_SCHEMA_VERSION,
): MigrationPlan {
  if (compareVersions(currentVersion, targetVersion) >= 0) {
    return { currentVersion, targetVersion, steps: [], isUpToDate: true };
  }

  const applicableSteps = MIGRATIONS.filter(
    (m) =>
      compareVersions(m.fromVersion, currentVersion) >= 0 &&
      compareVersions(m.toVersion, targetVersion) <= 0,
  ).sort((a, b) => compareVersions(a.fromVersion, b.fromVersion));

  return {
    currentVersion,
    targetVersion,
    steps: applicableSteps,
    isUpToDate: applicableSteps.length === 0,
  };
}

/**
 * Execute a migration plan against a config object.
 * Returns a new config — does NOT mutate the input.
 */
export function executeMigration(
  config: Record<string, unknown>,
  plan: MigrationPlan,
): MigrationResult {
  if (plan.isUpToDate) {
    return {
      success: true,
      fromVersion: plan.currentVersion,
      toVersion: plan.targetVersion,
      stepsApplied: [],
      backupPath: null,
      errors: [],
      config,
    };
  }

  let current = { ...config };
  const appliedSteps: string[] = [];
  const errors: string[] = [];

  for (const step of plan.steps) {
    if (!step.validate(current)) {
      errors.push(
        `Precondition failed for migration ${step.fromVersion} → ${step.toVersion}: ${step.description}`,
      );
      break;
    }

    try {
      current = step.migrate(current);
      appliedSteps.push(`${step.fromVersion} → ${step.toVersion}: ${step.description}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Migration ${step.fromVersion} → ${step.toVersion} failed: ${message}`);
      break;
    }
  }

  return {
    success: errors.length === 0,
    fromVersion: plan.currentVersion,
    toVersion: errors.length === 0
      ? plan.targetVersion
      : (current["version"] as string) ?? plan.currentVersion,
    stepsApplied: appliedSteps,
    backupPath: null,
    errors,
    config: current,
  };
}

/**
 * Migrate a YAML config file on disk.
 * Creates a timestamped backup before modifying.
 */
export function migrateConfigFile(
  configPath: string,
  targetVersion: string = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  if (!existsSync(configPath)) {
    return {
      success: false,
      fromVersion: "unknown",
      toVersion: targetVersion,
      stepsApplied: [],
      backupPath: null,
      errors: [`Config file not found: ${configPath}`],
      config: {},
    };
  }

  // Read and parse
  const raw = readFileSync(configPath, "utf-8");
  let config: Record<string, unknown>;
  try {
    config = parseYaml(raw) as Record<string, unknown>;
  } catch {
    return {
      success: false,
      fromVersion: "unknown",
      toVersion: targetVersion,
      stepsApplied: [],
      backupPath: null,
      errors: ["Failed to parse YAML config"],
      config: {},
    };
  }

  const currentVersion = (config["version"] as string) ?? "0.1.0";

  // Plan migration
  const plan = planMigration(currentVersion, targetVersion);
  if (plan.isUpToDate) {
    return {
      success: true,
      fromVersion: currentVersion,
      toVersion: targetVersion,
      stepsApplied: [],
      backupPath: null,
      errors: [],
      config,
    };
  }

  // Create backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.backup-${timestamp}`;
  copyFileSync(configPath, backupPath);

  // Execute migration
  const result = executeMigration(config, plan);

  // Write migrated config
  if (result.success) {
    const yaml = stringifyYaml(result.config);
    writeFileSync(configPath, yaml, "utf-8");
  }

  return { ...result, backupPath };
}

/**
 * Check if a config needs migration without actually migrating.
 */
export function needsMigration(
  config: Record<string, unknown>,
  targetVersion: string = CURRENT_SCHEMA_VERSION,
): boolean {
  const currentVersion = (config["version"] as string) ?? "0.1.0";
  return compareVersions(currentVersion, targetVersion) < 0;
}

/**
 * Get all registered migration steps.
 */
export function getMigrationSteps(): readonly MigrationStep[] {
  return MIGRATIONS;
}
