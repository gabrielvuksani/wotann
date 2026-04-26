/**
 * Auto-Update System — keeps WOTANN aware of new models, skills, and plugins.
 *
 * Architecture:
 * 1. Model Registry Monitor — checks Ollama library + HuggingFace trending for new models
 * 2. Skill Discovery — checks curated skill repos for updates
 * 3. Plugin Registry — checks npm/community registry for new plugins
 *
 * Runs on KAIROS heartbeat schedule (configurable, default: every 6 hours)
 * All checks use public APIs — no authentication needed.
 * Results are cached to ~/.wotann/registry-cache.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolveWotannHome, resolveWotannHomeSubdir } from "../utils/wotann-home.js";

// ── Types ──────────────────────────────────────────────

interface ModelUpdate {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly size: string;
  readonly description: string;
  readonly isNew: boolean;
  readonly discoveredAt: number;
}

interface RegistryCache {
  readonly lastCheck: number;
  readonly models: readonly ModelUpdate[];
  readonly recommendedModels: readonly string[];
}

// ── Constants ──────────────────────────────────────────

const CACHE_PATH = resolveWotannHomeSubdir("registry-cache.json");
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Curated list of high-quality models to recommend for local use */
const RECOMMENDED_OLLAMA_MODELS = [
  // Coding
  "qwen3-coder-next",
  "devstral",
  "codestral",
  // General
  "gemma4",
  "llama4",
  "phi-4",
  "mistral-large",
  // Reasoning
  "deepseek-r1",
  "qwen3.5:27b",
  // Small & fast
  "gemma4:2b",
  "phi-4-mini",
  "llama4:scout",
  // Chinese/multilingual
  "glm-5",
  "glm-5.1",
] as const;

// ── Cache Management ───────────────────────────────────

function loadCache(): RegistryCache {
  try {
    if (existsSync(CACHE_PATH)) {
      return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as RegistryCache;
    }
  } catch {
    /* ignore parse errors */
  }
  return { lastCheck: 0, models: [], recommendedModels: [] };
}

function saveCache(cache: RegistryCache): void {
  const dir = resolveWotannHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// ── Ollama Model Discovery ─────────────────────────────

/**
 * Check Ollama for installed models and compare against recommended list.
 * Returns models that are recommended but not yet installed.
 */
async function checkOllamaModels(ollamaHost: string): Promise<readonly ModelUpdate[]> {
  const updates: ModelUpdate[] = [];

  try {
    const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      models: Array<{
        name: string;
        size: number;
        details?: { parameter_size?: string; quantization_level?: string };
      }>;
    };
    const installedNames = new Set(data.models.map((m) => m.name.replace(":latest", "")));

    // Check which recommended models aren't installed
    for (const rec of RECOMMENDED_OLLAMA_MODELS) {
      if (!installedNames.has(rec)) {
        updates.push({
          id: rec,
          name: rec,
          provider: "ollama",
          size: "varies",
          description: `Recommended model available on Ollama. Run: ollama pull ${rec}`,
          isNew: true,
          discoveredAt: Date.now(),
        });
      }
    }

    // Also check Ollama library for trending models
    try {
      const libraryRes = await fetch("https://ollama.com/api/models?sort=popular&limit=10", {
        signal: AbortSignal.timeout(5000),
      });
      if (libraryRes.ok) {
        const libraryData = (await libraryRes.json()) as {
          models?: Array<{ name: string; description?: string }>;
        };
        for (const m of libraryData.models ?? []) {
          if (!installedNames.has(m.name) && !updates.some((u) => u.id === m.name)) {
            updates.push({
              id: m.name,
              name: m.name,
              provider: "ollama-trending",
              size: "varies",
              description: m.description ?? "Trending on Ollama",
              isNew: true,
              discoveredAt: Date.now(),
            });
          }
        }
      }
    } catch {
      /* trending API not available */
    }
  } catch {
    /* Ollama not running */
  }

  return updates;
}

// ── Main Check Function ────────────────────────────────

/**
 * Run a full update check. Called by KAIROS heartbeat.
 * Returns new models/updates discovered since last check.
 */
export async function checkForUpdates(): Promise<{
  readonly newModels: readonly ModelUpdate[];
  readonly cached: boolean;
}> {
  const cache = loadCache();

  // Skip if checked recently
  if (Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
    return { newModels: cache.models.filter((m) => m.isNew), cached: true };
  }

  const ollamaHost = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  const newModels = await checkOllamaModels(ollamaHost);

  const updatedCache: RegistryCache = {
    lastCheck: Date.now(),
    models: newModels,
    recommendedModels: [...RECOMMENDED_OLLAMA_MODELS],
  };
  saveCache(updatedCache);

  return { newModels, cached: false };
}

/**
 * Get the recommended models list for the UI.
 */
export function getRecommendedModels(): readonly string[] {
  return RECOMMENDED_OLLAMA_MODELS;
}

/**
 * Pull a recommended model via Ollama.
 */
export async function pullModel(modelName: string): Promise<{ success: boolean; error?: string }> {
  const ollamaHost = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  try {
    const res = await fetch(`${ollamaHost}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: false }),
      signal: AbortSignal.timeout(600000), // 10 min timeout for downloads
    });
    if (res.ok) {
      return { success: true };
    }
    return { success: false, error: `Ollama returned ${res.status}` };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}
