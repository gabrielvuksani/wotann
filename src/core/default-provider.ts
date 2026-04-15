/**
 * Resolve the initial default provider/model for the runtime and UI (S1-18).
 *
 * Priority order (first hit wins):
 *   1. Explicit option passed by the caller
 *   2. `WOTANN_DEFAULT_PROVIDER` / `WOTANN_DEFAULT_MODEL` env vars
 *   3. `defaultProvider` / `defaultModel` keys in `~/.wotann/wotann.yaml`
 *   4. First enabled entry in `providers:` map in `~/.wotann/wotann.yaml`
 *   5. First provider-specific env key present — see PROVIDER_DEFAULTS.envKeys
 *   6. `null` — indicates "no provider configured", UI should prompt the user
 *      to add one rather than silently picking a vendor
 *
 * There is NO hardcoded fallback. Every model string in this file is read
 * from the single-source-of-truth PROVIDER_DEFAULTS table.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { detectProviderFromEnv, PROVIDER_DEFAULTS } from "../providers/model-defaults.js";

export interface DefaultProvider {
  readonly provider: string;
  readonly model: string | null;
}

/**
 * Read `~/.wotann/wotann.yaml` and return the first enabled provider, if any.
 * Returns null when the file is missing, malformed, or has no enabled
 * providers — callers treat null as "no config yet, show onboarding."
 */
function readYamlDefault(
  configPath: string = join(homedir(), ".wotann", "wotann.yaml"),
): DefaultProvider | null {
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const cfg = parsed as Record<string, unknown>;

    // 1) Explicit `defaultProvider` key takes priority if the user set one.
    const explicitProvider =
      typeof cfg["defaultProvider"] === "string" ? (cfg["defaultProvider"] as string) : null;
    const explicitModel =
      typeof cfg["defaultModel"] === "string" ? (cfg["defaultModel"] as string) : null;
    if (explicitProvider) {
      // If the user specified a provider but not a model, fall through to the
      // canonical default for that provider rather than leaving it null —
      // that's what they'd want "defaultProvider: anthropic" to mean.
      const fallbackModel = PROVIDER_DEFAULTS[explicitProvider]?.defaultModel ?? null;
      return { provider: explicitProvider, model: explicitModel ?? fallbackModel };
    }

    // 2) First enabled provider in the providers map.
    const providers = cfg["providers"];
    if (providers && typeof providers === "object" && !Array.isArray(providers)) {
      for (const [name, entryUnknown] of Object.entries(providers)) {
        if (!entryUnknown || typeof entryUnknown !== "object") continue;
        const entry = entryUnknown as Record<string, unknown>;
        if (entry["enabled"] === false) continue;
        const explicitEntryModel =
          typeof entry["model"] === "string" ? (entry["model"] as string) : null;
        const canonicalModel = PROVIDER_DEFAULTS[name]?.defaultModel ?? null;
        return { provider: name, model: explicitEntryModel ?? canonicalModel };
      }
    }
  } catch {
    // Malformed YAML — treat as unconfigured.
  }
  return null;
}

/**
 * Main entry point. Returns the best guess for the UI's initial
 * provider/model, or null if the user has configured nothing.
 */
export function resolveDefaultProvider(options?: {
  readonly configPath?: string;
  readonly env?: NodeJS.ProcessEnv;
}): DefaultProvider | null {
  const env = options?.env ?? process.env;

  // 1. Explicit env override — if user sets WOTANN_DEFAULT_PROVIDER we use
  //    the canonical model for that provider unless they also set
  //    WOTANN_DEFAULT_MODEL to override.
  const envProvider = env["WOTANN_DEFAULT_PROVIDER"];
  const envModel = env["WOTANN_DEFAULT_MODEL"];
  if (envProvider) {
    const canonicalModel = PROVIDER_DEFAULTS[envProvider]?.defaultModel ?? null;
    return { provider: envProvider, model: envModel ?? canonicalModel };
  }

  // 2. wotann.yaml
  const fromYaml = readYamlDefault(options?.configPath);
  if (fromYaml) return fromYaml;

  // 3. First provider-specific env key present (delegated to model-defaults).
  const fromEnv = detectProviderFromEnv(env);
  if (fromEnv) return fromEnv;

  // 4. Nothing configured
  return null;
}
