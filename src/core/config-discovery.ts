/**
 * Universal Config Discovery — scan for configs from all known agent tools.
 *
 * Inspired by oh-my-pi's approach of reading configs from 8+ tools.
 * WOTANN can discover and import settings from:
 * - .wotann/ (our own config)
 * - .claude/ (Claude Code)
 * - .cursor/ (Cursor)
 * - .codex/ (Codex CLI)
 * - .gemini/ (Gemini Code Assist)
 * - .crush/ (Crush)
 * - .cline/ (Cline)
 * - .copilot/ (GitHub Copilot)
 *
 * Each discovered config can be reviewed and selectively imported.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import {
  classifyProvider,
  getUsageProfile,
  type BillingModel,
  type UsageProfile,
} from "../providers/usage-intelligence.js";

// ── Types ────────────────────────────────────────────────────

export interface DiscoveredConfig {
  readonly tool: AgentTool;
  readonly path: string;
  readonly settings: Record<string, unknown>;
  readonly rules: readonly DiscoveredRule[];
  readonly skills: readonly DiscoveredSkill[];
  readonly configFiles: readonly string[];
}

export interface DiscoveredRule {
  readonly name: string;
  readonly content: string;
  readonly source: string;
}

export interface DiscoveredSkill {
  readonly name: string;
  readonly path: string;
  readonly source: string;
}

export interface DiscoveryResult {
  readonly configs: readonly DiscoveredConfig[];
  readonly totalTools: number;
  readonly discoveredTools: number;
  readonly scanDurationMs: number;
}

export interface ImportResult {
  readonly imported: boolean;
  readonly rulesImported: number;
  readonly skillsImported: number;
  readonly settingsMerged: number;
  readonly warnings: readonly string[];
}

/**
 * Per-provider usage hint derived at discovery time. Merges each
 * detected provider's billing classification (from usage-intelligence)
 * into a record the runtime consumes to enable maxPowerMode,
 * showCostWarnings, and task routing defaults.
 */
export interface UsageDiscoveryHint {
  readonly providerId: string;
  readonly billingModel: BillingModel;
  readonly profile: UsageProfile;
  readonly source: "env-api-key" | "env-subscription" | "local-binary" | "free-tier";
}

/**
 * Aggregate of per-provider hints for the current environment.
 * Consumers use this to decide defaults for:
 *   - maxPowerMode — always true when any subscription/local present
 *   - showCostWarnings — true iff ANY pay-per-token API key is set
 */
export interface UsageDiscoveryResult {
  readonly hints: readonly UsageDiscoveryHint[];
  readonly maxPowerMode: boolean;
  readonly showCostWarnings: boolean;
  readonly hasSubscription: boolean;
  readonly hasApiKey: boolean;
}

export type AgentTool =
  | "wotann"
  | "claude"
  | "cursor"
  | "codex"
  | "gemini"
  | "crush"
  | "cline"
  | "copilot";

// ── Tool Definitions ─────────────────────────────────────────

interface ToolDefinition {
  readonly tool: AgentTool;
  readonly dirName: string;
  readonly configFileNames: readonly string[];
  readonly rulesDir?: string;
  readonly skillsDir?: string;
}

const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    tool: "wotann",
    dirName: ".wotann",
    configFileNames: ["config.yaml", "config.yml", "config.json"],
    rulesDir: "rules",
    skillsDir: "skills",
  },
  {
    tool: "claude",
    dirName: ".claude",
    configFileNames: ["settings.json", "CLAUDE.md"],
    rulesDir: "rules",
    skillsDir: "skills",
  },
  {
    tool: "cursor",
    dirName: ".cursor",
    configFileNames: ["settings.json", "rules"],
    rulesDir: "rules",
  },
  {
    tool: "codex",
    dirName: ".codex",
    configFileNames: ["config.json", "codex.md", "AGENTS.md"],
  },
  {
    tool: "gemini",
    dirName: ".gemini",
    configFileNames: ["settings.json", "GEMINI.md"],
    rulesDir: "rules",
  },
  {
    tool: "crush",
    dirName: ".crush",
    configFileNames: ["config.json", "crush.yaml"],
    rulesDir: "rules",
  },
  {
    tool: "cline",
    dirName: ".cline",
    configFileNames: ["config.json", "settings.json"],
    rulesDir: "rules",
  },
  {
    tool: "copilot",
    dirName: ".copilot",
    configFileNames: ["config.json", "settings.json"],
  },
];

// ── Config Discovery ─────────────────────────────────────────

export class ConfigDiscovery {
  /**
   * Scan home directory and project directory for agent tool configs.
   * Returns all discovered configurations across all known tools.
   */
  discover(homeDir: string, projectDir: string): DiscoveryResult {
    const startTime = Date.now();
    const configs: DiscoveredConfig[] = [];
    const searchDirs = deduplicatePaths([homeDir, projectDir]);

    for (const toolDef of TOOL_DEFINITIONS) {
      for (const searchDir of searchDirs) {
        const toolPath = join(searchDir, toolDef.dirName);
        if (!existsSync(toolPath) || !isDirectory(toolPath)) continue;

        const config = this.scanToolDirectory(toolDef, toolPath);
        if (config) {
          configs.push(config);
        }
      }
    }

    return {
      configs,
      totalTools: TOOL_DEFINITIONS.length,
      discoveredTools: new Set(configs.map((c) => c.tool)).size,
      scanDurationMs: Date.now() - startTime,
    };
  }

  /**
   * List all discovered configs in a human-readable format.
   */
  listDiscovered(result: DiscoveryResult): readonly string[] {
    if (result.configs.length === 0) {
      return ["No agent tool configurations discovered."];
    }

    const lines: string[] = [
      `Discovered ${result.discoveredTools} of ${result.totalTools} known agent tools:`,
      "",
    ];

    for (const config of result.configs) {
      lines.push(`  [${config.tool}] ${config.path}`);
      lines.push(`    Config files: ${config.configFiles.length}`);
      lines.push(`    Rules: ${config.rules.length}`);
      lines.push(`    Skills: ${config.skills.length}`);
      lines.push("");
    }

    lines.push(`Scan completed in ${result.scanDurationMs}ms.`);
    return lines;
  }

  /**
   * Import settings from a discovered config into a WOTANN-compatible format.
   * Returns the merged settings and any warnings.
   */
  importSettings(config: DiscoveredConfig): ImportResult {
    const warnings: string[] = [];
    let settingsMerged = 0;

    // Import settings
    const safeKeys = extractSafeSettings(config.settings);
    settingsMerged = Object.keys(safeKeys).length;

    // Validate rules
    for (const rule of config.rules) {
      if (rule.content.length > 50_000) {
        warnings.push(`Rule "${rule.name}" from ${config.tool} exceeds 50KB, skipping.`);
      }
    }

    // Validate skills
    for (const skill of config.skills) {
      if (!existsSync(skill.path)) {
        warnings.push(`Skill "${skill.name}" from ${config.tool} path not found, skipping.`);
      }
    }

    const validRules = config.rules.filter((r) => r.content.length <= 50_000);
    const validSkills = config.skills.filter((s) => existsSync(s.path));

    return {
      imported: settingsMerged > 0 || validRules.length > 0 || validSkills.length > 0,
      rulesImported: validRules.length,
      skillsImported: validSkills.length,
      settingsMerged,
      warnings,
    };
  }

  /**
   * Inspect process environment variables to detect which providers
   * the user has credentials or local binaries for, then classify each
   * via `usage-intelligence`. Emits `{maxPowerMode: true}` when any
   * subscription/local provider is present, and `{showCostWarnings: true}`
   * when the user has configured a raw pay-per-token API key.
   *
   * No I/O beyond reading `env` — safe to call at startup and at
   * every config-reload without cost.
   */
  discoverUsageProfile(env: NodeJS.ProcessEnv = process.env): UsageDiscoveryResult {
    const hints: UsageDiscoveryHint[] = [];

    const push = (providerId: string, source: UsageDiscoveryHint["source"]): void => {
      const billing = classifyProvider(providerId);
      const profile = getUsageProfile(providerId);
      hints.push({ providerId, billingModel: billing, profile, source });
    };

    // Subscription / managed auth — via env hints or local tokens.
    if (env["CLAUDE_CODE_SUBSCRIPTION"] || env["ANTHROPIC_SUBSCRIPTION_TOKEN"]) {
      push("anthropic-subscription", "env-subscription");
    }
    if (env["OPENAI_SESSION_KEY"] || env["CODEX_SESSION"]) {
      push("codex", "env-subscription");
    }
    if (env["GITHUB_COPILOT_TOKEN"] || env["COPILOT_SESSION"]) {
      push("copilot", "env-subscription");
    }

    // Pay-per-token API keys.
    if (env["ANTHROPIC_API_KEY"]) push("anthropic", "env-api-key");
    if (env["OPENAI_API_KEY"]) push("openai", "env-api-key");
    if (env["AZURE_OPENAI_API_KEY"]) push("azure", "env-api-key");
    if (env["AWS_ACCESS_KEY_ID"] && env["AWS_SECRET_ACCESS_KEY"]) {
      push("bedrock", "env-api-key");
    }
    if (env["GOOGLE_APPLICATION_CREDENTIALS"]) push("vertex", "env-api-key");

    // Free tiers / local.
    if (env["GEMINI_API_KEY"] || env["GOOGLE_API_KEY"]) push("gemini", "free-tier");
    if (env["GROQ_API_KEY"] || env["CEREBRAS_API_KEY"] || env["OPENROUTER_API_KEY"]) {
      push("free", "free-tier");
    }
    if (env["OLLAMA_HOST"] || env["OLLAMA_MODELS"]) {
      push("ollama", "local-binary");
    }

    // Aggregate
    const hasSubscription = hints.some((h) => h.billingModel === "subscription");
    const hasLocal = hints.some((h) => h.billingModel === "local");
    const hasFree = hints.some((h) => h.billingModel === "free");
    const hasApiKey = hints.some((h) => h.billingModel === "api");
    const maxPowerMode = hasSubscription || hasLocal || hasFree || hasApiKey;
    // Cost warnings only when ALL-subscription isn't the case — if a
    // user has a raw API key anywhere, warn before expensive ops.
    const showCostWarnings = hasApiKey;

    return {
      hints,
      maxPowerMode,
      showCostWarnings,
      hasSubscription,
      hasApiKey,
    };
  }

  // ── Private Helpers ────────────────────────────────────────

  private scanToolDirectory(toolDef: ToolDefinition, toolPath: string): DiscoveredConfig | null {
    const configFiles: string[] = [];
    const settings: Record<string, unknown> = {};

    // Scan for config files
    for (const fileName of toolDef.configFileNames) {
      const filePath = join(toolPath, fileName);
      if (existsSync(filePath) && !isDirectory(filePath)) {
        configFiles.push(fileName);
        const content = safeReadFile(filePath);
        if (content) {
          settings[fileName] = tryParseJson(content) ?? content;
        }
      }
    }

    // No config files found — skip
    if (configFiles.length === 0) return null;

    // Scan for rules
    const rules: DiscoveredRule[] = [];
    if (toolDef.rulesDir) {
      const rulesPath = join(toolPath, toolDef.rulesDir);
      if (existsSync(rulesPath) && isDirectory(rulesPath)) {
        const ruleFiles = safeReadDir(rulesPath);
        for (const ruleFile of ruleFiles) {
          const rulePath = join(rulesPath, ruleFile);
          if (!isDirectory(rulePath)) {
            const content = safeReadFile(rulePath);
            if (content) {
              rules.push({
                name: basename(ruleFile, ".md"),
                content,
                source: toolDef.tool,
              });
            }
          }
        }
      }
    }

    // Scan for skills
    const skills: DiscoveredSkill[] = [];
    if (toolDef.skillsDir) {
      const skillsPath = join(toolPath, toolDef.skillsDir);
      if (existsSync(skillsPath) && isDirectory(skillsPath)) {
        const skillFiles = safeReadDir(skillsPath);
        for (const skillFile of skillFiles) {
          const skillPath = join(skillsPath, skillFile);
          skills.push({
            name: basename(skillFile, ".md"),
            path: skillPath,
            source: toolDef.tool,
          });
        }
      }
    }

    return {
      tool: toolDef.tool,
      path: toolPath,
      settings,
      rules,
      skills,
      configFiles,
    };
  }
}

// ── Module-Level Helpers ─────────────────────────────────────

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function safeReadDir(path: string): readonly string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function deduplicatePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)];
}

/**
 * Extract settings that are safe to import (exclude secrets, tokens, API keys).
 */
function extractSafeSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const secretPatterns = /key|token|secret|password|credential|auth/i;
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (secretPatterns.test(key)) continue;
    if (typeof value === "string" && secretPatterns.test(value)) continue;
    safe[key] = value;
  }

  return safe;
}
