/**
 * `.wotann.yml` — committable project stack config (C27).
 *
 * Solo's idea: instead of every dev on a team having to re-run init
 * and pick the same providers/skills/hooks, commit a `.wotann.yml`
 * at the repo root that declares the shared setup. New clones
 * inherit the team's choices automatically; personal overrides live
 * in `~/.wotann/overrides.yml` and merge on top.
 *
 * Schema is intentionally small (v1):
 *   version, providers, skills, hooks, mcp, team. Everything is
 *   optional — callers treat a missing field as "use default".
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";

// ── Schema ───────────────────────────────────────────────────

export interface WotannYamlV1 {
  readonly version: 1;
  readonly providers?: WotannProvidersConfig;
  readonly skills?: WotannSkillsConfig;
  readonly hooks?: WotannHooksConfig;
  readonly mcp?: WotannMcpConfig;
  readonly team?: WotannTeamConfig;
}

export interface WotannProvidersConfig {
  readonly primary?: string;
  readonly fallback?: readonly string[];
  readonly models?: Record<string, string>;
}

export interface WotannSkillsConfig {
  readonly enabled?: readonly string[];
  readonly disabled?: readonly string[];
}

export interface WotannHooksConfig {
  readonly profile?: "minimal" | "standard" | "strict";
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export interface WotannMcpConfig {
  readonly autoStart?: readonly string[];
  readonly disabled?: readonly string[];
}

export interface WotannTeamConfig {
  readonly envHints?: readonly string[];
  readonly requiredCLIs?: readonly string[];
}

export interface ValidatedConfig {
  readonly config: WotannYamlV1;
  readonly problems: readonly string[];
}

// ── Parse + validate ─────────────────────────────────────────

/**
 * Parse a YAML string into a WotannYamlV1. Missing or malformed
 * fields surface as `problems` rather than thrown errors — callers
 * decide whether to refuse or warn.
 */
export function parseWotannYaml(source: string): ValidatedConfig {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = YAML.parse(source);
  } catch (err) {
    return {
      config: { version: 1 },
      problems: [`yaml parse error: ${err instanceof Error ? err.message : "unknown"}`],
    };
  }
  if (raw === null || raw === undefined) {
    return { config: { version: 1 }, problems: ["file is empty"] };
  }
  if (typeof raw !== "object") {
    return {
      config: { version: 1 },
      problems: [`expected a YAML object at root, got ${typeof raw}`],
    };
  }
  const obj = raw as Record<string, unknown>;

  const version = obj["version"];
  if (version !== undefined && version !== 1) {
    problems.push(`unsupported version: ${String(version)} (only 1 supported)`);
  }

  const config: WotannYamlV1 = {
    version: 1,
    providers: parseProviders(obj["providers"], problems),
    skills: parseSkills(obj["skills"], problems),
    hooks: parseHooks(obj["hooks"], problems),
    mcp: parseMcp(obj["mcp"], problems),
    team: parseTeam(obj["team"], problems),
  };

  return { config, problems };
}

function parseProviders(raw: unknown, problems: string[]): WotannProvidersConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    problems.push("providers: expected an object");
    return undefined;
  }
  const out: {
    primary?: string;
    fallback?: readonly string[];
    models?: Record<string, string>;
  } = {};
  const primary = raw["primary"];
  if (typeof primary === "string") out.primary = primary;
  else if (primary !== undefined) problems.push("providers.primary: expected string");

  const fallback = raw["fallback"];
  if (Array.isArray(fallback) && fallback.every((v) => typeof v === "string")) {
    out.fallback = fallback as readonly string[];
  } else if (fallback !== undefined) {
    problems.push("providers.fallback: expected string[]");
  }

  const models = raw["models"];
  if (isObject(models)) {
    const normalised: Record<string, string> = {};
    let ok = true;
    for (const [k, v] of Object.entries(models)) {
      if (typeof v !== "string") {
        ok = false;
        break;
      }
      normalised[k] = v;
    }
    if (ok) out.models = normalised;
    else problems.push("providers.models: expected Record<string,string>");
  } else if (models !== undefined) {
    problems.push("providers.models: expected object");
  }
  return out;
}

function parseSkills(raw: unknown, problems: string[]): WotannSkillsConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    problems.push("skills: expected an object");
    return undefined;
  }
  return {
    enabled: readStringArray(raw["enabled"], "skills.enabled", problems),
    disabled: readStringArray(raw["disabled"], "skills.disabled", problems),
  };
}

function parseHooks(raw: unknown, problems: string[]): WotannHooksConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    problems.push("hooks: expected an object");
    return undefined;
  }
  const profileRaw = raw["profile"];
  let profile: "minimal" | "standard" | "strict" | undefined;
  if (profileRaw === "minimal" || profileRaw === "standard" || profileRaw === "strict") {
    profile = profileRaw;
  } else if (profileRaw !== undefined) {
    problems.push(`hooks.profile: expected minimal|standard|strict, got ${String(profileRaw)}`);
  }
  return {
    profile,
    allow: readStringArray(raw["allow"], "hooks.allow", problems),
    deny: readStringArray(raw["deny"], "hooks.deny", problems),
  };
}

function parseMcp(raw: unknown, problems: string[]): WotannMcpConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    problems.push("mcp: expected an object");
    return undefined;
  }
  return {
    autoStart: readStringArray(raw["autoStart"], "mcp.autoStart", problems),
    disabled: readStringArray(raw["disabled"], "mcp.disabled", problems),
  };
}

function parseTeam(raw: unknown, problems: string[]): WotannTeamConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    problems.push("team: expected an object");
    return undefined;
  }
  return {
    envHints: readStringArray(raw["envHints"], "team.envHints", problems),
    requiredCLIs: readStringArray(raw["requiredCLIs"], "team.requiredCLIs", problems),
  };
}

function readStringArray(
  raw: unknown,
  field: string,
  problems: string[],
): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
    return raw as readonly string[];
  }
  problems.push(`${field}: expected string[]`);
  return undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ── Serialize ────────────────────────────────────────────────

export function renderWotannYaml(config: WotannYamlV1): string {
  // YAML.stringify respects declaration order, so we order fields
  // manually to keep diffs stable across unrelated edits.
  const clean: Record<string, unknown> = { version: 1 };
  if (config.providers) clean["providers"] = config.providers;
  if (config.skills) clean["skills"] = config.skills;
  if (config.hooks) clean["hooks"] = config.hooks;
  if (config.mcp) clean["mcp"] = config.mcp;
  if (config.team) clean["team"] = config.team;
  return YAML.stringify(clean, { indent: 2 });
}

// ── Merge (overrides layer over project) ─────────────────────

/**
 * Merge personal overrides into a project config. Strategy:
 *   - scalars/strings in override win
 *   - arrays union (dedupe preserves first-seen order)
 *   - object fields recurse with the same rules
 */
export function mergeConfigs(base: WotannYamlV1, override: WotannYamlV1): WotannYamlV1 {
  return {
    version: 1,
    providers: mergeProviders(base.providers, override.providers),
    skills: mergeSkills(base.skills, override.skills),
    hooks: mergeHooks(base.hooks, override.hooks),
    mcp: mergeMcp(base.mcp, override.mcp),
    team: mergeTeam(base.team, override.team),
  };
}

function mergeProviders(
  a: WotannProvidersConfig | undefined,
  b: WotannProvidersConfig | undefined,
): WotannProvidersConfig | undefined {
  if (!a && !b) return undefined;
  return {
    primary: b?.primary ?? a?.primary,
    fallback: unionStrings(a?.fallback, b?.fallback),
    models: { ...(a?.models ?? {}), ...(b?.models ?? {}) },
  };
}

function mergeSkills(
  a: WotannSkillsConfig | undefined,
  b: WotannSkillsConfig | undefined,
): WotannSkillsConfig | undefined {
  if (!a && !b) return undefined;
  return {
    enabled: unionStrings(a?.enabled, b?.enabled),
    disabled: unionStrings(a?.disabled, b?.disabled),
  };
}

function mergeHooks(
  a: WotannHooksConfig | undefined,
  b: WotannHooksConfig | undefined,
): WotannHooksConfig | undefined {
  if (!a && !b) return undefined;
  return {
    profile: b?.profile ?? a?.profile,
    allow: unionStrings(a?.allow, b?.allow),
    deny: unionStrings(a?.deny, b?.deny),
  };
}

function mergeMcp(
  a: WotannMcpConfig | undefined,
  b: WotannMcpConfig | undefined,
): WotannMcpConfig | undefined {
  if (!a && !b) return undefined;
  return {
    autoStart: unionStrings(a?.autoStart, b?.autoStart),
    disabled: unionStrings(a?.disabled, b?.disabled),
  };
}

function mergeTeam(
  a: WotannTeamConfig | undefined,
  b: WotannTeamConfig | undefined,
): WotannTeamConfig | undefined {
  if (!a && !b) return undefined;
  return {
    envHints: unionStrings(a?.envHints, b?.envHints),
    requiredCLIs: unionStrings(a?.requiredCLIs, b?.requiredCLIs),
  };
}

function unionStrings(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!a && !b) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of a ?? []) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  for (const s of b ?? []) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// ── Startup loader — project + personal override merge ──────

export const PROJECT_CONFIG_FILENAMES: readonly string[] = [".wotann.yml", ".wotann.yaml"];
export const PERSONAL_OVERRIDE_PATH = join(".wotann", "overrides.yml");

export interface LoadWotannYamlResult {
  readonly config: WotannYamlV1;
  readonly sources: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Load `.wotann.yml` from `projectDir` (checking both `.yml` and
 * `.yaml` extensions) and merge with the personal override at
 * `~/.wotann/overrides.yml`. Missing files are not errors — callers
 * pass the returned config unchanged even when every source file was
 * absent. Problems from the parser bubble up but do not replace the
 * partial config that came with them.
 *
 * Merge precedence: PERSONAL override > PROJECT config. Both reference
 * the version-1 schema; unknown keys are preserved verbatim in
 * parseWotannYaml / renderWotannYaml so this function is
 * schema-stable across minor upgrades.
 */
export function loadWotannYaml(
  projectDir: string = process.cwd(),
  home: string = homedir(),
): LoadWotannYamlResult {
  const sources: string[] = [];
  const problems: string[] = [];
  let merged: WotannYamlV1 = { version: 1 };

  // Project file — first extension wins.
  for (const fn of PROJECT_CONFIG_FILENAMES) {
    const path = join(projectDir, fn);
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        const parsed = parseWotannYaml(raw);
        merged = mergeConfigs(merged, parsed.config);
        sources.push(path);
        for (const p of parsed.problems) problems.push(`${path}: ${p}`);
      } catch (err) {
        problems.push(`${path}: read error: ${err instanceof Error ? err.message : "unknown"}`);
      }
      break;
    }
  }

  // Personal overrides — layer on top of project config.
  const overridePath = join(home, PERSONAL_OVERRIDE_PATH);
  if (existsSync(overridePath)) {
    try {
      const raw = readFileSync(overridePath, "utf-8");
      const parsed = parseWotannYaml(raw);
      merged = mergeConfigs(merged, parsed.config);
      sources.push(overridePath);
      for (const p of parsed.problems) problems.push(`${overridePath}: ${p}`);
    } catch (err) {
      problems.push(
        `${overridePath}: read error: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  return { config: merged, sources, problems };
}

/**
 * Pure merge helper for callers that already have parsed configs in
 * hand (e.g. tests, onboarding wizard). Thin alias for mergeConfigs
 * that makes the "base + overrides" direction explicit.
 */
export function applyOverrides(project: WotannYamlV1, personal: WotannYamlV1): WotannYamlV1 {
  return mergeConfigs(project, personal);
}
